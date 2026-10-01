import { beforeEach, describe, expect, it } from "vitest";
import { APP_ORIGIN } from "../support/actors.js";
import { resetDatabase } from "../support/db.js";
import { call, newTicket, projectWorld } from "../support/project-world.js";

beforeEach(resetDatabase);

describe("board columns", () => {
  it("lists columns to members and lets only managers rename or delete them", async () => {
    const w = await projectWorld();
    const listed = await call(w.viewer, "get", `/projects/${w.project.id}/columns`);
    expect(listed.status).toBe(200);
    expect(listed.body.data.map((c: { name: string }) => c.name)).toEqual([
      "To Do",
      "In Progress",
      "Done",
    ]);
    expect((await call(w.outsider, "get", `/projects/${w.project.id}/columns`)).status).toBe(404);

    const column = w.columns[1];
    const path = `/projects/${w.project.id}/columns/${column.id}`;
    expect((await call(w.developer, "patch", path, { name: "Doing" })).status).toBe(403);
    expect((await call(w.manager, "patch", path, { name: "  " })).status).toBe(400);
    const renamed = await call(w.manager, "patch", path, { name: "Doing", isDone: false });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data).toMatchObject({ id: column.id, name: "Doing", isDone: false });

    expect((await call(w.developer, "delete", path)).status).toBe(403);
    expect((await call(w.manager, "delete", path)).status).toBe(204);
    expect((await call(w.manager, "delete", path)).status).toBe(404);
    expect(
      (await call(w.viewer, "get", `/projects/${w.project.id}/columns`)).body.data,
    ).toHaveLength(2);
  });
});

describe("sprints", () => {
  it("lists, edits and reorders planned sprints; started sprints cannot move", async () => {
    const w = await projectWorld();
    const create = async (name: string) =>
      (await call(w.developer, "post", `/projects/${w.project.id}/sprints`, { name })).body.data;
    const first = await create("Sprint 1");
    const second = await create("Sprint 2");

    const listed = await call(w.viewer, "get", `/projects/${w.project.id}/sprints`);
    expect(listed.status).toBe(200);
    expect(listed.body.data.map((s: { id: string }) => s.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect((await call(w.outsider, "get", `/projects/${w.project.id}/sprints`)).status).toBe(404);

    const path = `/projects/${w.project.id}/sprints/${first.id}`;
    expect((await call(w.viewer, "patch", path, { name: "Nope" })).status).toBe(403);
    expect(
      (
        await call(w.developer, "patch", path, {
          startsAt: "2026-02-10T00:00:00Z",
          endsAt: "2026-02-01T00:00:00Z",
        })
      ).status,
    ).toBe(400);
    const edited = await call(w.developer, "patch", path, { name: "Kickoff", goal: "Ship" });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ name: "Kickoff", goal: "Ship", status: "planned" });

    const moved = await call(w.developer, "post", `${path}/move`, { afterSprintId: second.id });
    expect(moved.status).toBe(200);
    expect(moved.body.data.position).toBeGreaterThan(second.position);

    expect((await call(w.developer, "post", `${path}/start`)).status).toBe(200);
    const blocked = await call(w.developer, "post", `${path}/move`, { beforeSprintId: second.id });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("SPRINT_STARTED");
  });
});

describe("epics", () => {
  it("lists epics to members and lets writers rename them uniquely", async () => {
    const w = await projectWorld();
    const create = async (name: string) =>
      (await call(w.developer, "post", `/projects/${w.project.id}/epics`, { name })).body.data;
    const billing = await create("Billing");
    await create("Search");

    const listed = await call(w.viewer, "get", `/projects/${w.project.id}/epics`);
    expect(listed.status).toBe(200);
    expect(listed.body.data.map((e: { name: string }) => e.name)).toEqual(["Billing", "Search"]);
    expect((await call(w.outsider, "get", `/projects/${w.project.id}/epics`)).status).toBe(404);

    const path = `/projects/${w.project.id}/epics/${billing.id}`;
    expect((await call(w.viewer, "patch", path, { name: "Payments" })).status).toBe(403);
    expect((await call(w.developer, "patch", path, { name: "search" })).status).toBe(409);
    const renamed = await call(w.developer, "patch", path, { name: "Payments" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data).toMatchObject({ id: billing.id, name: "Payments" });
  });
});

describe("ticket read models and lifecycle", () => {
  it("reports project estimates and stage history to members only", async () => {
    const w = await projectWorld();
    const t = await newTicket(w.developer, w.project.id, {
      columnId: w.columns[0].id,
      estimates: [{ resourceType: "Developer", minutes: 90 }],
    });
    await call(w.developer, "post", `/tickets/${t.id}/move`, { columnId: w.columns[1].id });

    const estimates = await call(w.viewer, "get", `/projects/${w.project.id}/ticket-estimates`);
    expect(estimates.status).toBe(200);
    expect(estimates.body.data).toEqual([
      { ticketId: t.id, resourceType: "Developer", minutes: 90 },
    ]);
    const history = await call(w.viewer, "get", `/projects/${w.project.id}/stage-history`);
    expect(history.status).toBe(200);
    expect(history.body.data.map((h: { columnName: string }) => h.columnName)).toEqual([
      "To Do",
      "In Progress",
    ]);
    for (const path of ["ticket-estimates", "stage-history"])
      expect((await call(w.outsider, "get", `/projects/${w.project.id}/${path}`)).status).toBe(404);
  });

  it("lists and removes own work logs, and blocks deleting tickets with logged time", async () => {
    const w = await projectWorld();
    const t = await newTicket(w.developer, w.project.id);
    const log = (
      await call(w.developer, "post", `/tickets/${t.id}/work-logs`, {
        minutes: 30,
        note: "pairing",
        loggedAt: new Date().toISOString(),
      })
    ).body.data;

    const listed = await call(w.viewer, "get", `/tickets/${t.id}/work-logs`);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toMatchObject([{ id: log.id, minutes: 30, userId: w.developer.id }]);
    expect((await call(w.outsider, "get", `/tickets/${t.id}/work-logs`)).status).toBe(404);

    const blocked = await call(w.manager, "delete", `/tickets/${t.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("HAS_LOGGED_TIME");

    const logPath = `/tickets/${t.id}/work-logs/${log.id}`;
    expect((await call(w.teammate, "delete", logPath)).status).toBe(403);
    expect((await call(w.developer, "delete", logPath)).status).toBe(204);
    expect((await call(w.developer, "get", `/tickets/${t.id}/work-logs`)).body.data).toEqual([]);

    expect((await call(w.developer, "delete", `/tickets/${t.id}`)).status).toBe(403);
    expect((await call(w.manager, "delete", `/tickets/${t.id}`)).status).toBe(204);
    expect((await call(w.manager, "get", `/tickets/${t.id}`)).status).toBe(404);
  });

  it("lets comment authors edit their comments and lists ticket attachments", async () => {
    const w = await projectWorld();
    const t = await newTicket(w.developer, w.project.id);
    const comment = (await call(w.developer, "post", `/tickets/${t.id}/comments`, { body: "v1" }))
      .body.data;
    const edited = await call(w.developer, "patch", `/tickets/${t.id}/comments/${comment.id}`, {
      body: "v2",
    });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ id: comment.id, body: "v2" });

    const upload = await w.developer.agent
      .post(`/api/v1/tickets/${t.id}/attachments`)
      .set("Origin", APP_ORIGIN)
      .attach("file", Buffer.from("hello"), "notes.txt");
    expect(upload.status).toBe(201);
    const listed = await call(w.viewer, "get", `/tickets/${t.id}/attachments`);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toMatchObject([{ id: upload.body.data.id, name: "notes.txt" }]);
    expect((await call(w.outsider, "get", `/tickets/${t.id}/attachments`)).status).toBe(404);
  });
});

describe("document folders", () => {
  it("lets writers rename folders and creators or managers delete them", async () => {
    const w = await projectWorld();
    const folder = (
      await call(w.developer, "post", `/projects/${w.project.id}/document-folders`, { name: "A" })
    ).body.data;
    const path = `/document-folders/${folder.id}`;

    expect((await call(w.viewer, "patch", path, { name: "B" })).status).toBe(403);
    expect((await call(w.outsider, "patch", path, { name: "B" })).status).toBe(404);
    const renamed = await call(w.teammate, "patch", path, { name: "Specs", position: 5 });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data).toMatchObject({ id: folder.id, name: "Specs", position: 5 });

    expect((await call(w.teammate, "delete", path)).status).toBe(403);
    expect((await call(w.developer, "delete", path)).status).toBe(204);
    expect((await call(w.developer, "delete", path)).status).toBe(404);
  });
});
