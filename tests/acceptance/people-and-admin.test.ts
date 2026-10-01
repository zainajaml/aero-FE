import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { APP_ORIGIN, app, createActor, outbox } from "../support/actors.js";
import { resetDatabase } from "../support/db.js";
import { call, newTicket, projectWorld } from "../support/project-world.js";

beforeEach(async () => {
  await resetDatabase();
  outbox().length = 0;
});

describe("private profile and notification preferences", () => {
  it("reads back private HR details and rejects unknown employment statuses", async () => {
    const actor = await createActor();
    const empty = await actor.agent.get("/api/v1/me/private");
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual({
      mobile: null,
      employeeNumber: null,
      employmentStatus: null,
    });
    const rejected = await actor.agent
      .patch("/api/v1/me/private")
      .set("Origin", APP_ORIGIN)
      .send({ employmentStatus: "intern" });
    expect(rejected.status).toBe(400);
    await actor.agent
      .patch("/api/v1/me/private")
      .set("Origin", APP_ORIGIN)
      .send({ mobile: " 555-0100 ", employmentStatus: "contract" });
    expect((await actor.agent.get("/api/v1/me/private")).body.data).toEqual({
      mobile: "555-0100",
      employeeNumber: null,
      employmentStatus: "contract",
    });
  });

  it("stores per-trigger preferences and validates the trigger key", async () => {
    const actor = await createActor();
    expect((await actor.agent.get("/api/v1/me/notification-preferences")).body.data).toEqual({});
    const set = await actor.agent
      .put("/api/v1/me/notification-preferences/ticket-assigned")
      .set("Origin", APP_ORIGIN)
      .send({ enabled: false });
    expect(set.status).toBe(200);
    expect(set.body.data).toEqual({ key: "ticket-assigned", enabled: false });
    const listed = await actor.agent.get("/api/v1/me/notification-preferences");
    expect(listed.status).toBe(200);
    expect(listed.body.data).toEqual({ "ticket-assigned": false });

    const badKey = await actor.agent
      .put("/api/v1/me/notification-preferences/Not_A_Key")
      .set("Origin", APP_ORIGIN)
      .send({ enabled: true });
    expect(badKey.status).toBe(400);
    const badBody = await actor.agent
      .put("/api/v1/me/notification-preferences/ticket-assigned")
      .set("Origin", APP_ORIGIN)
      .send({ enabled: "yes" });
    expect(badBody.status).toBe(400);
  });
});

describe("accounts administration", () => {
  it("shows administered accounts with projects and lets their admin rename them", async () => {
    const w = await projectWorld();
    const administered = await call(w.accountAdmin, "get", "/accounts/administered");
    expect(administered.status).toBe(200);
    expect(administered.body.data).toMatchObject([
      { id: w.account.id, projects: [{ id: w.project.id, key: w.project.key }] },
    ]);

    const path = `/accounts/${w.account.id}`;
    expect((await call(w.manager, "patch", path, { name: "Hijack" })).status).toBe(403);
    const renamed = await call(w.accountAdmin, "patch", path, { name: "Renamed Co" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data).toMatchObject({ id: w.account.id, name: "Renamed Co" });
    expect((await call(w.accountAdmin, "patch", path, { slug: "Not A Slug!" })).status).toBe(400);
  });
});

describe("notifications", () => {
  it("shows a notification with its HTML to the recipient only", async () => {
    const w = await projectWorld();
    await newTicket(w.developer, w.project.id, { assigneeId: w.teammate.id });
    const items = (await call(w.teammate, "get", "/notifications")).body.data.items as {
      id: string;
      templateName: string;
    }[];
    const assignment = items.find((i) => i.templateName === "ticket-assignment")!;
    const detail = await call(w.teammate, "get", `/notifications/${assignment.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({ id: assignment.id });
    expect(detail.body.data.html).toContain("<");
    const hidden = await call(w.outsider, "get", `/notifications/${assignment.id}`);
    expect(hidden.status).toBe(404);
    expect(hidden.body.error.code).toBe("NOTIFICATION_NOT_FOUND");
  });
});

describe("reports", () => {
  it("lists sprints of visible projects filtered by status and validates filters", async () => {
    const w = await projectWorld();
    const planned = (
      await call(w.developer, "post", `/projects/${w.project.id}/sprints`, { name: "Next" })
    ).body.data;
    const active = (
      await call(w.developer, "post", `/projects/${w.project.id}/sprints`, { name: "Now" })
    ).body.data;
    await call(w.developer, "post", `/projects/${w.project.id}/sprints/${active.id}/start`);

    const all = await call(w.viewer, "get", "/reports/sprints");
    expect(all.status).toBe(200);
    expect(all.body.data.map((s: { id: string }) => s.id).sort()).toEqual(
      [planned.id, active.id].sort(),
    );
    const activeOnly = await call(w.viewer, "get", "/reports/sprints?statuses=active");
    expect(activeOnly.body.data.map((s: { id: string }) => s.id)).toEqual([active.id]);
    expect((await call(w.outsider, "get", "/reports/sprints")).body.data).toEqual([]);
    expect((await call(w.viewer, "get", "/reports/sprints?statuses=archived")).status).toBe(400);
    expect((await call(w.viewer, "get", "/reports/sprints?projectIds=nope")).status).toBe(400);
  });
});

describe("admin ticket reassignment", () => {
  it("moves a user's open tickets to a teammate with access and rejects outsiders", async () => {
    const w = await projectWorld();
    const t = await newTicket(w.manager, w.project.id, {
      columnId: w.columns[0].id,
      assigneeId: w.developer.id,
    });
    const path = `/admin/users/${w.developer.id}/reassign-tickets`;
    expect((await call(w.developer, "post", path, { assigneeId: null })).status).toBe(403);
    expect((await call(w.accountAdmin, "post", path, { assigneeId: w.outsider.id })).status).toBe(
      400,
    );
    const moved = await call(w.accountAdmin, "post", path, { assigneeId: w.teammate.id });
    expect(moved.status).toBe(200);
    expect(moved.body.data).toEqual({ reassignedTickets: 1 });
    expect((await call(w.manager, "get", `/tickets/${t.id}`)).body.data.assigneeId).toBe(
      w.teammate.id,
    );
  });
});

describe("public endpoints reject bad input", () => {
  it("answers 404 for an invalid one-click unsubscribe token", async () => {
    const response = await request(app).post("/api/v1/email/unsubscribe?token=forged").send({});
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("UNSUBSCRIBE_TOKEN_INVALID");
  });

  it("answers 400 for an oversized Jira OAuth callback state", async () => {
    const response = await request(app)
      .get("/api/v1/jira/oauth/callback")
      .query({ code: "x", state: "s".repeat(600) });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
  });
});
