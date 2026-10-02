import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/database/client.js";
import { invitations, profiles, projectMembers, users } from "../../src/database/schema/index.js";
import {
  APP_ORIGIN,
  PASSWORD,
  addMember,
  app,
  createAccount,
  createActor,
  createProject,
  mailFor,
  makeAccountAdmin,
  outbox,
  signIn,
} from "../support/actors.js";
import { resetDatabase } from "../support/db.js";

beforeEach(async () => {
  await resetDatabase();
  outbox().length = 0;
});

describe("response envelope", () => {
  it("returns a typed error envelope with request id for anonymous calls", async () => {
    const response = await request(app).get("/api/v1/me/access");
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
      meta: { requestId: expect.any(String) },
    });
    expect(response.headers["x-request-id"]).toBe(response.body.meta.requestId);
  });

  it("returns ROUTE_NOT_FOUND for unknown routes", async () => {
    const response = await request(app).get("/api/v1/does-not-exist");
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
  });

  it("rejects malformed JSON with a validation error", async () => {
    const actor = await createActor();
    const response = await actor.agent
      .post("/api/v1/me")
      .set("Origin", APP_ORIGIN)
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("sign-up and sign-in", () => {
  it("creates a profile and sends a verification email", async () => {
    const response = await request(app)
      .post("/api/auth/sign-up/email")
      .set("Origin", APP_ORIGIN)
      .send({ email: "New.Person@Example.com", password: PASSWORD, name: "New Person" });
    expect(response.status).toBe(200);
    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, response.body.user.id));
    expect(profile).toMatchObject({
      fullName: "New Person",
      firstName: "New",
      lastName: "Person",
      email: "new.person@example.com",
    });
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0]).toMatchObject({
      to: "new.person@example.com",
      subject: "Confirm your email",
    });
  });

  it("refuses sign-in until the email is verified", async () => {
    await request(app)
      .post("/api/auth/sign-up/email")
      .set("Origin", APP_ORIGIN)
      .send({ email: "unverified@example.com", password: PASSWORD, name: "Unverified" });
    const response = await request(app)
      .post("/api/auth/sign-in/email")
      .set("Origin", APP_ORIGIN)
      .send({ email: "unverified@example.com", password: PASSWORD });
    expect(response.status).toBe(403);
  });

  it("does not reveal whether an email exists on a wrong password", async () => {
    const actor = await createActor();
    const wrong = await request(app)
      .post("/api/auth/sign-in/email")
      .set("Origin", APP_ORIGIN)
      .send({ email: actor.email, password: "wrong-password-123" });
    const unknown = await request(app)
      .post("/api/auth/sign-in/email")
      .set("Origin", APP_ORIGIN)
      .send({ email: "nobody@example.com", password: "wrong-password-123" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });
});

describe("GET /me/access", () => {
  it("reports needs_onboarding for a fresh signup", async () => {
    const actor = await createActor();
    const response = await actor.agent.get("/api/v1/me/access");
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      status: "needs_onboarding",
      globalRoles: [],
      adminAccountIds: [],
      projectRoles: {},
      projectAccounts: {},
    });
  });

  it("reports project roles and only the projects the user can see", async () => {
    const account = await createAccount();
    const mine = await createProject(account.id);
    await createProject(account.id);
    const actor = await createActor({ roles: ["developer"] });
    await addMember(mine.id, actor.id, "developer");
    const { body } = await actor.agent.get("/api/v1/me/access");
    expect(body.data.status).toBe("active");
    expect(body.data.projectRoles).toEqual({ [mine.id]: "developer" });
    expect(body.data.projectAccounts).toEqual({ [mine.id]: account.id });
  });

  it("gives account admins every project in their account", async () => {
    const account = await createAccount();
    const other = await createAccount();
    const a = await createProject(account.id);
    const b = await createProject(account.id);
    await createProject(other.id);
    const actor = await createActor();
    await makeAccountAdmin(account.id, actor.id);
    const { body } = await actor.agent.get("/api/v1/me/access");
    expect(body.data.adminAccountIds).toEqual([account.id]);
    expect(Object.keys(body.data.projectAccounts).sort()).toEqual([a.id, b.id].sort());
  });

  it("reports no_access when roles remain but memberships were removed", async () => {
    const actor = await createActor({ roles: ["developer"] });
    const { body } = await actor.agent.get("/api/v1/me/access");
    expect(body.data.status).toBe("no_access");
  });
});

describe("archived identities", () => {
  it("are locked out of existing sessions and cannot sign in again", async () => {
    const actor = await createActor({ roles: ["developer"] });
    await db.update(profiles).set({ archivedAt: new Date() }).where(eq(profiles.id, actor.id));
    const existing = await actor.agent.get("/api/v1/me/access");
    expect(existing.status).toBe(403);
    expect(existing.body.error.code).toBe("ACCOUNT_ARCHIVED");
    const again = await request(app)
      .post("/api/auth/sign-in/email")
      .set("Origin", APP_ORIGIN)
      .send({ email: actor.email, password: PASSWORD });
    expect(again.status).toBe(403);
  });
});

describe("CSRF origin check", () => {
  it("rejects cookie-authenticated writes from a foreign origin", async () => {
    const actor = await createActor();
    const response = await actor.agent
      .post("/api/v1/me")
      .set("Origin", "https://evil.example")
      .send({});
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("CSRF_REJECTED");
  });
});

describe("invitation applied after verification (replaces handle_new_user)", () => {
  it("grants the invited project role once the email is verified, not before", async () => {
    const account = await createAccount();
    const project = await createProject(account.id);
    await db.insert(invitations).values({
      email: "Invited@Example.com",
      role: "developer",
      projectIds: [project.id],
      tokenHash: createHash("sha256").update(randomBytes(24)).digest("hex"),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const signUp = await request(app)
      .post("/api/auth/sign-up/email")
      .set("Origin", APP_ORIGIN)
      .send({ email: "invited@example.com", password: PASSWORD, name: "Invited Person" });
    const userId = signUp.body.user.id as string;
    expect(
      await db.select().from(projectMembers).where(eq(projectMembers.userId, userId)),
    ).toHaveLength(0);

    const link = /href="([^"]*verify-email[^"]*)"/
      .exec(outbox()[0]!.html)![1]!
      .replaceAll("&amp;", "&");
    const verifyPath = new URL(link).pathname + new URL(link).search;
    const agent = request.agent(app);
    await agent.get(verifyPath).expect(302);

    const members = await db.select().from(projectMembers).where(eq(projectMembers.userId, userId));
    expect(members).toEqual([
      expect.objectContaining({ projectId: project.id, role: "developer" }),
    ]);
    const [invite] = await db.select().from(invitations);
    expect(invite!.acceptedAt).not.toBeNull();
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.emailVerified).toBe(true);
    await signIn(agent, "invited@example.com");
    const { body } = await agent.get("/api/v1/me/access");
    expect(body.data.status).toBe("active");
  });
});

describe("password reset and change", () => {
  it("resets a forgotten password by emailed token and revokes old sessions", async () => {
    const actor = await createActor();
    const anonymous = request.agent(app);
    const asked = await anonymous
      .post("/api/auth/request-password-reset")
      .set("Origin", APP_ORIGIN)
      .send({ email: actor.email, redirectTo: `${APP_ORIGIN}/reset-password` });
    expect(asked.status).toBe(200);
    // Unknown addresses get the same answer (no account enumeration) and no email.
    const unknown = await anonymous
      .post("/api/auth/request-password-reset")
      .set("Origin", APP_ORIGIN)
      .send({ email: "nobody@example.com", redirectTo: `${APP_ORIGIN}/reset-password` });
    expect(unknown.status).toBe(200);
    expect(outbox().filter((m) => m.to === "nobody@example.com")).toHaveLength(0);

    const mail = mailFor(actor.email).at(-1)!;
    const token = /reset-password\/([A-Za-z0-9_-]+)/.exec(JSON.stringify(mail))![1];
    const bad = await anonymous
      .post("/api/auth/reset-password")
      .set("Origin", APP_ORIGIN)
      .send({ token: "not-a-token", newPassword: "a-brand-new-password" });
    expect(bad.status).toBe(400);
    const reset = await anonymous
      .post("/api/auth/reset-password")
      .set("Origin", APP_ORIGIN)
      .send({ token, newPassword: "a-brand-new-password" });
    expect(reset.status).toBe(200);

    expect((await actor.agent.get("/api/v1/me")).status).toBe(401);
    await expect(signIn(request.agent(app), actor.email)).rejects.toThrow(/401/);
    await signIn(request.agent(app), actor.email, "a-brand-new-password");
  });

  it("changes the password only with the current one", async () => {
    const actor = await createActor();
    const wrong = await actor.agent
      .post("/api/auth/change-password")
      .set("Origin", APP_ORIGIN)
      .send({ currentPassword: "wrong-password-123", newPassword: "another-new-password" });
    expect(wrong.status).toBe(400);
    const changed = await actor.agent
      .post("/api/auth/change-password")
      .set("Origin", APP_ORIGIN)
      .send({
        currentPassword: PASSWORD,
        newPassword: "another-new-password",
        revokeOtherSessions: true,
      });
    expect(changed.status).toBe(200);
    await signIn(request.agent(app), actor.email, "another-new-password");
  });
});
