import { and, eq, isNotNull } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/database/client.js";
import {
  attachments,
  comments,
  epics,
  jiraConnections,
  jiraImports,
  jiraOauthStates,
  profiles,
  projectMembers,
  projects,
  sprints,
  ticketEpics,
  tickets,
  workLogs,
} from "../../src/database/schema/index.js";
import { createCredentialCipher } from "../../src/integrations/atlassian/credential-crypto.js";
import {
  APP_ORIGIN,
  addMember,
  app,
  createAccount,
  createActor,
  createProject,
  makeAccountAdmin,
  type TestActor,
} from "../support/actors.js";
import { resetDatabase } from "../support/db.js";
import { CLOUD_ID, FakeAtlassian, OTHER_CLOUD_ID } from "../support/fake-atlassian.js";

const cipher = createCredentialCipher(process.env.JIRA_TOKEN_ENCRYPTION_KEY!);
let atlassian: FakeAtlassian;

beforeEach(async () => {
  await resetDatabase();
  atlassian = new FakeAtlassian().install();
});
afterEach(() => atlassian.restore());

function call(
  actor: TestActor,
  method: "get" | "post" | "put" | "delete",
  path: string,
  body?: object,
) {
  const req = actor.agent[method](`/api/v1${path}`).set("Origin", APP_ORIGIN);
  return body ? req.send(body) : req;
}

const callback = (query: Record<string, string>) =>
  request(app).get("/api/v1/jira/oauth/callback").query(query);

async function startConnect(actor: TestActor): Promise<string> {
  const response = await call(actor, "post", "/jira/connect");
  expect(response.status).toBe(200);
  return new URL(response.body.data.authorizeUrl).searchParams.get("state")!;
}

async function connect(actor: TestActor) {
  const state = await startConnect(actor);
  const response = await callback({ code: "good-code", state });
  expect(response.text).toContain("Jira connected");
}

async function adminWithConnection() {
  const account = await createAccount();
  const admin = await createActor({ name: "Importing Admin" });
  await makeAccountAdmin(account.id, admin.id);
  await connect(admin);
  return { account, admin };
}

const startBody = (accountId: string, cloudId = CLOUD_ID) => ({
  accountId,
  cloudId,
  jiraProjectId: "10000",
  jiraProjectKey: "DEMO",
  jiraProjectName: "Demo Project",
});

async function runImport(actor: TestActor, accountId: string) {
  const started = await call(actor, "post", "/jira/imports", startBody(accountId));
  expect(started.status).toBe(201);
  let progress = started.body.data;
  for (let i = 0; i < 10 && progress.phase !== "done" && progress.phase !== "error"; i += 1) {
    const step = await call(actor, "post", `/jira/imports/${progress.id}/step`);
    expect(step.status).toBe(200);
    progress = step.body.data;
  }
  return progress;
}

describe("Jira OAuth connection", () => {
  it("returns the Atlassian consent URL and stores a single-use state for the caller", async () => {
    const actor = await createActor();
    const response = await call(actor, "post", "/jira/connect");
    expect(response.status).toBe(200);
    const url = new URL(response.body.data.authorizeUrl);
    expect(url.origin).toBe("https://auth.atlassian.com");
    expect(url.searchParams.get("client_id")).toBe("test-jira-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("http://api.test/api/v1/jira/oauth/callback");
    const [row] = await db.select().from(jiraOauthStates);
    expect(row).toMatchObject({ state: url.searchParams.get("state"), userId: actor.id });
  });

  it("rejects unknown, expired and reused states without storing a connection", async () => {
    const actor = await createActor();
    const unknown = await callback({ code: "good-code", state: "not-a-real-state" });
    expect(unknown.status).toBe(200);
    expect(unknown.text).toContain("Invalid or expired state");

    const stale = await startConnect(actor);
    await db
      .update(jiraOauthStates)
      .set({ createdAt: new Date(Date.now() - 16 * 60_000) })
      .where(eq(jiraOauthStates.state, stale));
    expect((await callback({ code: "good-code", state: stale })).text).toContain("expired");
    expect(await db.select().from(jiraOauthStates)).toHaveLength(0);
    expect(await db.select().from(jiraConnections)).toHaveLength(0);

    const state = await startConnect(actor);
    expect((await callback({ code: "good-code", state })).text).toContain("Jira connected");
    const reused = await callback({ code: "good-code", state });
    expect(reused.text).toContain("Invalid or expired state");
    expect(atlassian.calls.filter((c) => c.url.pathname === "/oauth/token")).toHaveLength(1);
  });

  it("escapes provider error text and reports a failed code exchange", async () => {
    const actor = await createActor();
    const cancelled = await callback({ error: "<script>alert(1)</script>" });
    expect(cancelled.text).not.toContain("<script>alert(1)");
    expect(cancelled.text).toContain("&lt;script&gt;");
    const failed = await callback({ code: "bad-code", state: await startConnect(actor) });
    expect(failed.text).toContain("Could not complete the Atlassian token exchange");
    expect(await db.select().from(jiraConnections)).toHaveLength(0);
  });

  it("stores encrypted tokens and answers with a page that posts only to the app origin", async () => {
    const actor = await createActor();
    const state = await startConnect(actor);
    const response = await callback({ code: "good-code", state });
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    const nonce = /script-src 'nonce-([^']+)'/.exec(
      String(response.headers["content-security-policy"]),
    )![1];
    expect(response.text).toContain(`<script nonce="${nonce}">`);
    expect(response.text).toContain('"http://app.test"');
    expect(response.text).not.toContain('"*"');
    expect(response.text).toContain("http://app.test/jira?jira=connected");

    const [row] = await db.select().from(jiraConnections);
    expect(row).toMatchObject({ userId: actor.id, cloudId: CLOUD_ID, siteName: "Acme" });
    expect(row!.accessToken).not.toBe("access-token-initial");
    expect(row!.accessToken).toMatch(/^v1\.[\w-]+\.[\w-]+$/);
    expect(row!.refreshToken).not.toContain("refresh-token-initial");
    expect(cipher.decrypt(row!.accessToken)).toBe("access-token-initial");
    expect(cipher.decrypt(row!.refreshToken!)).toBe("refresh-token-initial");

    const status = await call(actor, "get", "/jira/status");
    expect(status.body.data).toMatchObject({
      connected: true,
      configured: true,
      cloudId: CLOUD_ID,
    });
    expect(JSON.stringify(status.body)).not.toContain("access-token");
  });

  it("lists and switches sites, refusing sites the connection was not granted", async () => {
    const actor = await createActor();
    await connect(actor);
    const sites = await call(actor, "get", "/jira/sites");
    expect(sites.body.data).toEqual([
      expect.objectContaining({ cloudId: CLOUD_ID, active: true }),
      expect.objectContaining({ cloudId: OTHER_CLOUD_ID, active: false }),
    ]);
    expect((await call(actor, "put", "/jira/site", { cloudId: "nope" })).status).toBe(404);
    const switched = await call(actor, "put", "/jira/site", { cloudId: OTHER_CLOUD_ID });
    expect(switched.status).toBe(200);
    const [row] = await db.select().from(jiraConnections);
    expect(row!.cloudId).toBe(OTHER_CLOUD_ID);

    expect((await call(actor, "delete", "/jira/connection")).status).toBe(204);
    expect(await db.select().from(jiraConnections)).toHaveLength(0);
    expect((await call(actor, "get", "/jira/projects")).body.data).toEqual([]);
  });

  it("refreshes an expiring token once even under concurrent requests", async () => {
    const actor = await createActor();
    await connect(actor);
    await db.update(jiraConnections).set({ expiresAt: new Date(Date.now() - 1000) });
    const responses = await Promise.all([1, 2, 3].map(() => call(actor, "get", "/jira/projects")));
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([expect.objectContaining({ key: "DEMO" })]);
    }
    expect(atlassian.refreshCount).toBe(1);
    const [row] = await db.select().from(jiraConnections);
    expect(cipher.decrypt(row!.accessToken)).toBe("access-token-refreshed-1");
    expect(cipher.decrypt(row!.refreshToken!)).toBe("refresh-token-1");
    const used = atlassian.callsTo("/project/search").map((c) => c.authorization);
    expect(new Set(used)).toEqual(new Set(["Bearer access-token-refreshed-1"]));
  });

  it("searches issues of a project", async () => {
    const actor = await createActor();
    await connect(actor);
    const response = await call(actor, "get", "/jira/issues?projectKey=DEMO&query=login");
    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(2);
    expect(response.body.data.issues[0]).toMatchObject({
      key: "DEMO-1",
      comments: [{ body: "Looks good" }],
      worklogs: [{ timeSpentSeconds: 3600 }],
    });
    const jql = atlassian.callsTo("/search/jql")[0]!.url.searchParams.get("jql");
    expect(jql).toBe('project = "DEMO" AND text ~ "login" ORDER BY updated DESC');
    expect((await call(actor, "get", '/jira/issues?projectKey=DE"MO')).status).toBe(400);
  });
});

describe("Jira import", () => {
  it("is limited to admins of the target account", async () => {
    const account = await createAccount();
    const project = await createProject(account.id);
    const developer = await createActor();
    await addMember(project.id, developer.id, "developer");
    await connect(developer);
    const otherAdmin = await createActor();
    await makeAccountAdmin((await createAccount()).id, otherAdmin.id);
    await connect(otherAdmin);
    for (const actor of [developer, otherAdmin]) {
      const response = await call(actor, "post", "/jira/imports", startBody(account.id));
      expect(response.status).toBe(403);
      const check = await call(
        actor,
        "get",
        `/jira/projects/10000/imported?accountId=${account.id}`,
      );
      expect(check.status).toBe(403);
    }
    expect(await db.select().from(jiraImports)).toHaveLength(0);
  });

  it("rejects a cloud id that is not the connection's current site", async () => {
    const { account, admin } = await adminWithConnection();
    const response = await call(
      admin,
      "post",
      "/jira/imports",
      startBody(account.id, OTHER_CLOUD_ID),
    );
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("JIRA_SITE_MISMATCH");
  });

  it("keeps import runs private to the user who started them", async () => {
    const { account, admin } = await adminWithConnection();
    const started = await call(admin, "post", "/jira/imports", startBody(account.id));
    const otherAdmin = await createActor();
    await makeAccountAdmin(account.id, otherAdmin.id);
    await connect(otherAdmin);
    const id = started.body.data.id;
    expect((await call(otherAdmin, "get", `/jira/imports/${id}`)).status).toBe(404);
    expect((await call(otherAdmin, "post", `/jira/imports/${id}/step`)).status).toBe(404);
  });

  it("imports a project with sprints, tickets, comments, work logs and files, idempotently", async () => {
    const { account, admin } = await adminWithConnection();
    const alice = await createActor({ name: "Alice Jira" });

    const progress = await runImport(admin, account.id);
    expect(progress).toMatchObject({
      phase: "done",
      processed: 2,
      comments: 1,
      worklogs: 1,
      attachments: 1,
      error: null,
    });

    const [project] = await db.select().from(projects).where(isNotNull(projects.jiraProjectId));
    expect(project).toMatchObject({
      accountId: account.id,
      key: "DEMO",
      projectType: "sprint",
      jiraCloudId: CLOUD_ID,
      jiraProjectId: "10000",
      jiraProjectKey: "DEMO",
    });
    // Account admins reach the project through the account, not a project seat.
    const seats = await db
      .select()
      .from(projectMembers)
      .where(eq(projectMembers.projectId, project!.id));
    expect(seats.some((s) => s.userId === admin.id)).toBe(false);

    const [sprint] = await db.select().from(sprints).where(eq(sprints.projectId, project!.id));
    expect(sprint).toMatchObject({ jiraSprintId: "7", status: "active", name: "Sprint 7" });

    const rows = await db.select().from(tickets).where(eq(tickets.projectId, project!.id));
    const first = rows.find((t) => t.jiraIssueKey === "DEMO-1")!;
    const second = rows.find((t) => t.jiraIssueKey === "DEMO-2")!;
    expect(first).toMatchObject({
      code: "DEMO-1",
      jiraIssueId: "10001",
      sprintId: sprint!.id,
      type: "bug",
      priority: "urgent",
      assigneeId: alice.id,
      estimateMinutes: 120,
      dueDate: "2026-12-01",
    });
    expect(second).toMatchObject({
      code: "DEMO-2",
      sprintId: null,
      type: "story",
      assigneeId: null,
    });
    expect(second.reporterId).toBe(admin.id);

    const [epic] = await db.select().from(epics).where(eq(epics.projectId, project!.id));
    expect(epic).toMatchObject({ jiraIssueKey: "DEMO-9", name: "Big Epic" });
    expect(
      await db.select().from(ticketEpics).where(eq(ticketEpics.ticketId, second.id)),
    ).toHaveLength(1);

    // Bob only exists in Jira: a provisional identity keeps his comment and time attributed.
    const [bob] = await db.select().from(profiles).where(eq(profiles.email, "bob@jira.example"));
    expect(bob).toMatchObject({ isProvisional: true, fullName: "Bob Builder" });
    expect(first.reporterId).toBe(bob!.id);
    const [comment] = await db.select().from(comments).where(eq(comments.ticketId, first.id));
    expect(comment).toMatchObject({ jiraCommentId: "500", authorId: bob!.id, body: "Looks good" });
    const [log] = await db.select().from(workLogs).where(eq(workLogs.ticketId, first.id));
    expect(log).toMatchObject({
      jiraWorklogId: "700",
      userId: bob!.id,
      minutes: 60,
      note: "Investigated",
    });

    const [file] = await db.select().from(attachments).where(eq(attachments.ticketId, first.id));
    expect(file).toMatchObject({ jiraAttachmentId: "900", name: "spec.pdf", uploadedBy: admin.id });
    expect(file!.storagePath.startsWith(`${first.id}/`)).toBe(true);
    // The bearer token went to the API gateway only; the signed media redirect got none.
    const download = atlassian.callsTo("/attachment/content/900")[0]!;
    expect(download.url.origin).toBe("https://api.atlassian.com");
    expect(download.authorization).toMatch(/^Bearer /);
    const media = atlassian.calls.find((c) => c.url.hostname === "api.media.atlassian.com")!;
    expect(media.authorization).toBeNull();

    expect(progress.jiraUsers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Alice Jira", status: "matched" }),
        expect.objectContaining({ email: "bob@jira.example", status: "invitable" }),
        expect.objectContaining({ name: "Hidden Person", status: "unmatched", tickets: 1 }),
      ]),
    );

    // Re-running updates in place: nothing is duplicated.
    const again = await runImport(admin, account.id);
    expect(again.phase).toBe("done");
    expect(await db.select().from(projects).where(isNotNull(projects.jiraProjectId))).toHaveLength(
      1,
    );
    expect(await db.select().from(tickets)).toHaveLength(2);
    expect(await db.select().from(sprints)).toHaveLength(1);
    expect(await db.select().from(comments)).toHaveLength(1);
    expect(await db.select().from(workLogs)).toHaveLength(1);
    expect(await db.select().from(attachments)).toHaveLength(1);
    expect(await db.select().from(epics)).toHaveLength(1);

    const check = await call(admin, "get", `/jira/projects/10000/imported?accountId=${account.id}`);
    expect(check.body.data).toEqual({
      imported: true,
      projectId: project!.id,
      projectName: "Demo Project",
      tickets: 2,
    });
  });

  it("matches unresolved people, invites imported people and repairs attribution", async () => {
    const { account, admin } = await adminWithConnection();
    const progress = await runImport(admin, account.id);
    const [project] = await db.select().from(projects).where(isNotNull(projects.jiraProjectId));
    const teammate = await createActor({ name: "Real Hidden" });
    await addMember(project!.id, teammate.id, "developer");

    const candidates = await call(admin, "get", `/jira/imports/${progress.id}/candidates`);
    expect(candidates.body.data.map((c: { id: string }) => c.id)).toContain(teammate.id);

    const stranger = await createActor();
    const rejected = await call(admin, "post", `/jira/imports/${progress.id}/assign-users`, {
      mappings: [{ key: "acct:acc-hidden", userId: stranger.id }],
    });
    expect(rejected.status).toBe(400);

    const assigned = await call(admin, "post", `/jira/imports/${progress.id}/assign-users`, {
      mappings: [{ key: "acct:acc-hidden", userId: teammate.id }],
    });
    expect(assigned.status).toBe(200);
    expect(assigned.body.data.assigned).toBe(1);
    const [demo2] = await db
      .select()
      .from(tickets)
      .where(and(eq(tickets.projectId, project!.id), eq(tickets.jiraIssueKey, "DEMO-2")));
    expect(demo2!.assigneeId).toBe(teammate.id);

    const invited = await call(admin, "post", `/jira/imports/${progress.id}/invite-users`, {
      emails: ["bob@jira.example", "someone-else@example.com"],
    });
    expect(invited.status).toBe(200);
    expect(invited.body.data).toEqual({ sent: 1, failed: ["someone-else@example.com"] });

    const repaired = await call(
      admin,
      "post",
      `/jira/imports/${progress.id}/repair-attribution`,
      {},
    );
    expect(repaired.status).toBe(200);
    expect(repaired.body.data).toMatchObject({ done: true, comments: 0, worklogs: 0 });
  });

  it("stops with a reconnect message when Jira rejects the token", async () => {
    const { account, admin } = await adminWithConnection();
    const started = await call(admin, "post", "/jira/imports", startBody(account.id));
    await db
      .update(jiraConnections)
      .set({ expiresAt: new Date(Date.now() - 1000), refreshToken: null });
    const step = await call(admin, "post", `/jira/imports/${started.body.data.id}/step`);
    expect(step.status).toBe(200);
    expect(step.body.data).toMatchObject({ phase: "error", needsReconnect: true });
  });
});
