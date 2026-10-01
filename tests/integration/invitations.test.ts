import { eq } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/database/client.js";
import { invitations, projectMembers, users } from "../../src/database/schema/index.js";
import {
  APP_ORIGIN,
  addMember,
  app,
  createAccount,
  createActor,
  createProject,
  makeAccountAdmin,
  outbox,
  signIn,
} from "../support/actors.js";
import { resetDatabase } from "../support/db.js";
import { newInvitationToken } from "../../src/modules/invitations/invitations.tokens.js";

beforeEach(async () => {
  await resetDatabase();
  outbox().length = 0;
});

const tokenFromLastEmail = () => /accept\?token=([a-f0-9]+)/.exec(outbox().at(-1)!.html)![1]!;

async function accountAdminWithProject() {
  const account = await createAccount();
  const project = await createProject(account.id);
  const admin = await createActor();
  await makeAccountAdmin(account.id, admin.id);
  return { account, project, admin };
}

function invite(agent: ReturnType<typeof request.agent>, body: Record<string, unknown>) {
  return agent.post("/api/v1/invitations").set("Origin", APP_ORIGIN).send(body);
}

describe("POST /invitations", () => {
  it("lets an account admin invite into their project, stores only a token hash and emails the link", async () => {
    const { project, admin } = await accountAdminWithProject();
    const response = await invite(admin.agent, {
      email: "New.Dev@Example.com",
      role: "developer",
      projectIds: [project.id],
    });
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      duplicate: false,
      emailQueued: true,
      invitation: { email: "new.dev@example.com", role: "developer" },
    });
    const token = tokenFromLastEmail();
    const [row] = await db.select().from(invitations);
    expect(row!.tokenHash).not.toContain(token);
    expect(row!.tokenHash).toHaveLength(64);
  });

  it("rejects anonymous callers and plain members", async () => {
    const { project } = await accountAdminWithProject();
    expect(
      (
        await request(app)
          .post("/api/v1/invitations")
          .send({ email: "x@example.com", role: "viewer" })
      ).status,
    ).toBe(401);
    const developer = await createActor({ roles: ["developer"] });
    await addMember(project.id, developer.id, "developer");
    const response = await invite(developer.agent, {
      email: "x@example.com",
      role: "viewer",
      projectIds: [project.id],
    });
    expect(response.status).toBe(403);
  });

  it("keeps project admins inside their projects and away from account-level roles", async () => {
    const account = await createAccount();
    const mine = await createProject(account.id);
    const other = await createProject(account.id);
    const projectAdmin = await createActor({ roles: ["admin"] });
    await addMember(mine.id, projectAdmin.id, "admin");
    expect(
      (
        await invite(projectAdmin.agent, {
          email: "a@example.com",
          role: "developer",
          projectIds: [other.id],
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await invite(projectAdmin.agent, {
          email: "a@example.com",
          role: "account_admin",
          projectIds: [mine.id],
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await invite(projectAdmin.agent, {
          email: "a@example.com",
          role: "developer",
          projectIds: [mine.id],
        })
      ).status,
    ).toBe(201);
  });

  it("enforces the super admin email domain and project requirement for client roles", async () => {
    const superAdmin = await createActor({ roles: ["super_admin"] });
    const wrongDomain = await invite(superAdmin.agent, {
      email: "boss@example.com",
      role: "super_admin",
    });
    expect(wrongDomain.status).toBe(400);
    const noProject = await invite(superAdmin.agent, {
      email: "dev@example.com",
      role: "developer",
      projectIds: [],
    });
    expect(noProject.status).toBe(400);
    const ok = await invite(superAdmin.agent, {
      email: "boss@spacemanconsulting.com",
      role: "super_admin",
    });
    expect(ok.status).toBe(201);
  });

  it("reports a duplicate pending invitation without sending again", async () => {
    const { project, admin } = await accountAdminWithProject();
    await invite(admin.agent, {
      email: "dup@example.com",
      role: "viewer",
      projectIds: [project.id],
    });
    const second = await invite(admin.agent, {
      email: "DUP@example.com",
      role: "viewer",
      projectIds: [project.id],
    });
    expect(second.status).toBe(201);
    expect(second.body.data).toMatchObject({ duplicate: true, emailQueued: false });
    expect(outbox().filter((message) => message.to === "dup@example.com")).toHaveLength(1);
  });

  it("refuses to invite an existing member of the project", async () => {
    const { project, admin } = await accountAdminWithProject();
    const member = await createActor();
    await addMember(project.id, member.id, "developer");
    const response = await invite(admin.agent, {
      email: member.email,
      role: "viewer",
      projectIds: [project.id],
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("ALREADY_MEMBER");
  });

  it("caps project admins at 10 people per project", async () => {
    const account = await createAccount();
    const project = await createProject(account.id);
    const projectAdmin = await createActor();
    await addMember(project.id, projectAdmin.id, "admin");
    // Seed nine pending invitations and one member (the per-admin rate limit is 10/min).
    for (let i = 0; i < 9; i += 1) {
      const { tokenHash, expiresAt } = newInvitationToken();
      await db.insert(invitations).values({
        email: `seat${i}@example.com`,
        role: "viewer",
        projectIds: [project.id],
        tokenHash,
        expiresAt,
      });
    }
    await addMember(project.id, (await createActor()).id, "developer");
    const full = await invite(projectAdmin.agent, {
      email: "seat10@example.com",
      role: "viewer",
      projectIds: [project.id],
    });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe("SEAT_LIMIT_REACHED");
  });
});

describe("public lookup and accept-with-password", () => {
  it("describes a valid token and gives identical answers for unknown and malformed tokens", async () => {
    const { project, admin } = await accountAdminWithProject();
    await invite(admin.agent, {
      email: "guest@example.com",
      role: "viewer",
      projectIds: [project.id],
    });
    const token = tokenFromLastEmail();
    const valid = await request(app).post("/api/v1/invitations/lookup").send({ token });
    expect(valid.body.data).toMatchObject({
      valid: true,
      email: "guest@example.com",
      roleLabel: "Viewer",
      userExists: false,
      projectId: project.id,
    });
    const unknown = await request(app)
      .post("/api/v1/invitations/lookup")
      .send({ token: "f".repeat(64) });
    const malformed = await request(app)
      .post("/api/v1/invitations/lookup")
      .send({ token: "<script>" });
    expect(unknown.body.data).toEqual({ valid: false, expired: false });
    expect(malformed.body.data).toEqual(unknown.body.data);
  });

  it("reports expiry without revealing anything else", async () => {
    const { project, admin } = await accountAdminWithProject();
    await invite(admin.agent, {
      email: "late@example.com",
      role: "viewer",
      projectIds: [project.id],
    });
    await db.update(invitations).set({ expiresAt: new Date(Date.now() - 1000) });
    const response = await request(app)
      .post("/api/v1/invitations/lookup")
      .send({ token: tokenFromLastEmail() });
    expect(response.body.data).toEqual({ valid: false, expired: true });
  });

  it("creates a verified account with the invited role, once", async () => {
    const { project, admin } = await accountAdminWithProject();
    await invite(admin.agent, {
      email: "joiner@example.com",
      role: "developer",
      projectIds: [project.id],
      jobTitle: "Engineer",
    });
    const token = tokenFromLastEmail();
    const accepted = await request(app)
      .post("/api/v1/invitations/accept-with-password")
      .send({ token, password: "joiner-password-1", firstName: "Jo", lastName: "Iner" });
    expect(accepted.status).toBe(201);
    const [user] = await db.select().from(users).where(eq(users.email, "joiner@example.com"));
    expect(user!.emailVerified).toBe(true);
    expect(
      await db.select().from(projectMembers).where(eq(projectMembers.userId, user!.id)),
    ).toEqual([expect.objectContaining({ projectId: project.id, role: "developer" })]);

    const agent = request.agent(app);
    await signIn(agent, "joiner@example.com", "joiner-password-1");
    const me = await agent.get("/api/v1/me");
    expect(me.body.data).toMatchObject({ firstName: "Jo", lastName: "Iner", jobTitle: "Engineer" });

    const again = await request(app)
      .post("/api/v1/invitations/accept-with-password")
      .send({ token, password: "another-password-1" });
    expect(again.status).toBe(409);
  });

  it("rate limits lookups per source", async () => {
    let last = 200;
    for (let i = 0; i < 31; i += 1)
      last = (await request(app).post("/api/v1/invitations/lookup").send({ token: "x" })).status;
    expect(last).toBe(429);
  });
});

describe("signed-in accept, resend and revoke", () => {
  it("only accepts invitations addressed to the caller", async () => {
    const { project, admin } = await accountAdminWithProject();
    const existing = await createActor({ email: "existing@example.com" });
    const stranger = await createActor();
    await invite(admin.agent, {
      email: "existing@example.com",
      role: "viewer",
      projectIds: [project.id],
    });
    const token = tokenFromLastEmail();
    const wrong = await stranger.agent
      .post("/api/v1/invitations/accept")
      .set("Origin", APP_ORIGIN)
      .send({ token });
    expect(wrong.status).toBe(403);
    const right = await existing.agent
      .post("/api/v1/invitations/accept")
      .set("Origin", APP_ORIGIN)
      .send({ token });
    expect(right.status).toBe(200);
    expect(right.body.data).toMatchObject({ alreadyAccepted: false, projectId: project.id });
    const access = await existing.agent.get("/api/v1/me/access");
    expect(access.body.data.projectRoles).toEqual({ [project.id]: "viewer" });
  });

  it("resend issues a new link that invalidates the old one; revoke invalidates it entirely", async () => {
    const { project, admin } = await accountAdminWithProject();
    const created = await invite(admin.agent, {
      email: "again@example.com",
      role: "viewer",
      projectIds: [project.id],
    });
    const id = created.body.data.invitation.id as string;
    const oldToken = tokenFromLastEmail();
    const resent = await admin.agent
      .post(`/api/v1/invitations/${id}/resend`)
      .set("Origin", APP_ORIGIN);
    expect(resent.status).toBe(200);
    const newToken = tokenFromLastEmail();
    expect(newToken).not.toBe(oldToken);
    expect(
      (await request(app).post("/api/v1/invitations/lookup").send({ token: oldToken })).body.data
        .valid,
    ).toBe(false);
    expect(
      (await request(app).post("/api/v1/invitations/lookup").send({ token: newToken })).body.data
        .valid,
    ).toBe(true);

    const outsider = await createActor();
    await makeAccountAdmin((await createAccount()).id, outsider.id);
    expect(
      (await outsider.agent.delete(`/api/v1/invitations/${id}`).set("Origin", APP_ORIGIN)).status,
    ).toBe(403);
    expect(
      (await admin.agent.delete(`/api/v1/invitations/${id}`).set("Origin", APP_ORIGIN)).status,
    ).toBe(204);
    expect(
      (await request(app).post("/api/v1/invitations/lookup").send({ token: newToken })).body.data
        .valid,
    ).toBe(false);
  });
});
