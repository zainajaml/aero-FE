import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/database/client.js";
import { sprints, ticketStageHistory, workLogs } from "../../src/database/schema/index.js";
import { mailFor, outbox } from "../support/actors.js";
import { resetDatabase } from "../support/db.js";
import { call, doc, newTicket, projectWorld } from "../support/project-world.js";

beforeEach(async () => {
  await resetDatabase();
  outbox().length = 0;
});

async function sprint(projectId: string, status: "planned" | "active" | "completed" = "planned") {
  const [row] = await db
    .insert(sprints)
    .values({ projectId, name: `S-${status}`, status })
    .returning();
  return row!;
}

describe("ticket creation", () => {
  it("assigns sequential codes even under concurrency, bottom positions, history, epics and estimates", async () => {
    const w = await projectWorld();
    const epic = (
      await call(w.developer, "post", `/projects/${w.project.id}/epics`, { name: "Checkout" })
    ).body.data;
    const first = await newTicket(w.developer, w.project.id, {
      columnId: w.columns[0].id,
      epicIds: [epic.id],
      estimates: [
        { resourceType: "Developer", minutes: 90 },
        { resourceType: "QA", minutes: 30 },
        { resourceType: "PM", minutes: 0 },
      ],
    });
    expect(first.code).toBe(`${w.project.key}-1`);
    expect(first.estimateMinutes).toBe(120);
    expect(
      (
        await db.select().from(ticketStageHistory).where(eq(ticketStageHistory.ticketId, first.id))
      )[0],
    ).toMatchObject({ columnName: "To Do", movedBy: w.developer.id });
    expect(
      (await call(w.developer, "get", `/tickets/${first.id}/estimates`)).body.data,
    ).toHaveLength(2);

    const parallel = await Promise.all(
      Array.from({ length: 5 }, () => newTicket(w.developer, w.project.id)),
    );
    expect(new Set(parallel.map((t) => t.code)).size).toBe(5);
    const all = (await call(w.developer, "get", `/projects/${w.project.id}/tickets`)).body.data as {
      code: string;
      position: number;
      epicIds: string[];
    }[];
    expect(all.map((t) => t.code).sort()).toEqual(
      Array.from({ length: 6 }, (_, i) => `${w.project.key}-${i + 1}`).sort(),
    );
    expect(all.find((t) => t.code.endsWith("-1"))!.epicIds).toEqual([epic.id]);
  });

  it("enforces membership, viewer read-only, valid references and content", async () => {
    const w = await projectWorld();
    const body = { title: "X", descriptionJson: doc("y"), type: "task", priority: "low" };
    expect((await call(w.viewer, "post", `/projects/${w.project.id}/tickets`, body)).status).toBe(
      403,
    );
    expect((await call(w.outsider, "post", `/projects/${w.project.id}/tickets`, body)).status).toBe(
      404,
    );
    expect(
      (
        await call(w.developer, "post", `/projects/${w.project.id}/tickets`, {
          ...body,
          descriptionJson: doc("  "),
        })
      ).status,
    ).toBe(400);
    const done = await sprint(w.project.id, "completed");
    expect(
      (
        await call(w.developer, "post", `/projects/${w.project.id}/tickets`, {
          ...body,
          sprintId: done.id,
        })
      ).body.error.code,
    ).toBe("SPRINT_COMPLETED");
    expect(
      (
        await call(w.developer, "post", `/projects/${w.project.id}/tickets`, {
          ...body,
          assigneeId: w.outsider.id,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(w.developer, "post", `/projects/${w.project.id}/tickets`, {
          ...body,
          estimates: [
            { resourceType: "D", minutes: 59_999 },
            { resourceType: "Q", minutes: 1 },
          ],
        })
      ).status,
    ).toBe(400);
  });

  it("emails the assignee (not when assigning yourself)", async () => {
    const w = await projectWorld();
    await newTicket(w.developer, w.project.id, { assigneeId: w.developer.id });
    await newTicket(w.developer, w.project.id, { assigneeId: w.teammate.id });
    expect(mailFor(w.teammate.email)).toHaveLength(1);
    expect(mailFor(w.developer.email)).toHaveLength(0);
  });
});

describe("ticket updates and moves", () => {
  it("saves fields, records stage history on column change and replaces epics", async () => {
    const w = await projectWorld();
    const t = await newTicket(w.developer, w.project.id);
    const e1 = (await call(w.developer, "post", `/projects/${w.project.id}/epics`, { name: "A" }))
      .body.data;
    const saved = await call(w.developer, "patch", `/tickets/${t.id}`, {
      title: "Renamed",
      columnId: w.columns[1].id,
      epicIds: [e1.id],
      priority: "high",
    });
    expect(saved.body.data).toMatchObject({
      title: "Renamed",
      columnId: w.columns[1].id,
      epicIds: [e1.id],
      priority: "high",
    });
    expect(
      await db.select().from(ticketStageHistory).where(eq(ticketStageHistory.ticketId, t.id)),
    ).toHaveLength(1);
    expect(
      (await call(w.developer, "put", `/tickets/${t.id}/epics`, { epicIds: [] })).body.data.epicIds,
    ).toEqual([]);
  });

  it("notifies only newly mentioned people in a description", async () => {
    const w = await projectWorld();
    const t = await newTicket(w.developer, w.project.id);
    await call(w.developer, "patch", `/tickets/${t.id}`, {
      descriptionJson: doc("hi ", [{ id: w.teammate.id, label: "Tea" }]),
    });
    await call(w.developer, "patch", `/tickets/${t.id}`, {
      descriptionJson: doc("hi again ", [{ id: w.teammate.id, label: "Tea" }]),
    });
    expect(mailFor(w.teammate.email)).toHaveLength(1);
  });

  it("orders manually between neighbours and refuses moves into completed sprints", async () => {
    const w = await projectWorld();
    const a = await newTicket(w.developer, w.project.id);
    const b = await newTicket(w.developer, w.project.id);
    const c = await newTicket(w.developer, w.project.id);
    const moved = await call(w.developer, "post", `/tickets/${c.id}/move`, {
      afterTicketId: a.id,
      beforeTicketId: b.id,
    });
    expect(moved.body.data.position).toBe((a.position + b.position) / 2);
    const done = await sprint(w.project.id, "completed");
    expect(
      (await call(w.developer, "post", `/tickets/${a.id}/move`, { sprintId: done.id })).body.error
        .code,
    ).toBe("SPRINT_COMPLETED");
    await call(w.developer, "post", `/tickets/${a.id}/move`, { columnId: w.columns[2].id });
    expect(
      await db.select().from(ticketStageHistory).where(eq(ticketStageHistory.ticketId, a.id)),
    ).toHaveLength(1);
  });

  it("locks tickets in completed sprints", async () => {
    const w = await projectWorld();
    const active = await sprint(w.project.id, "active");
    const t = await newTicket(w.developer, w.project.id, { sprintId: active.id });
    await db.update(sprints).set({ status: "completed" }).where(eq(sprints.id, active.id));
    expect(
      (await call(w.developer, "patch", `/tickets/${t.id}`, { title: "No" })).body.error.code,
    ).toBe("SPRINT_COMPLETED");
    expect(
      (
        await call(w.developer, "post", `/tickets/${t.id}/work-logs`, {
          minutes: 15,
          note: "n",
          loggedAt: new Date().toISOString(),
        })
      ).status,
    ).toBe(409);
  });

  it("bulk edits with stage history and rejects locked tickets", async () => {
    const w = await projectWorld();
    const a = await newTicket(w.developer, w.project.id);
    const b = await newTicket(w.developer, w.project.id);
    const res = await call(w.developer, "post", `/projects/${w.project.id}/tickets/bulk-update`, {
      ticketIds: [a.id, b.id],
      set: { columnId: w.columns[1].id, priority: "high" },
    });
    expect(res.body.data).toEqual({ updated: 2 });
    expect(await db.select().from(ticketStageHistory)).toHaveLength(2);
    const moved = await call(w.developer, "post", `/projects/${w.project.id}/tickets/bulk-move`, {
      ticketIds: [a.id],
      sprintId: (await sprint(w.project.id, "active")).id,
    });
    expect(moved.status).toBe(200);
  });
});

describe("bulk edit and create extras", () => {
  it("accepts an epics-only bulk edit but rejects an empty one", async () => {
    const w = await projectWorld();
    const a = await newTicket(w.developer, w.project.id);
    const epic = (await call(w.developer, "post", `/projects/${w.project.id}/epics`, { name: "E" }))
      .body.data;
    const ok = await call(w.developer, "post", `/projects/${w.project.id}/tickets/bulk-update`, {
      ticketIds: [a.id],
      addEpicIds: [epic.id],
    });
    expect(ok.status).toBe(200);
    expect((await call(w.developer, "get", `/tickets/${a.id}`)).body.data.epicIds).toEqual([
      epic.id,
    ]);
    const empty = await call(w.developer, "post", `/projects/${w.project.id}/tickets/bulk-update`, {
      ticketIds: [a.id],
      set: {},
    });
    expect(empty.status).toBe(400);
  });

  it("keeps the estimate date picked at creation", async () => {
    const w = await projectWorld();
    const ticket = await newTicket(w.developer, w.project.id, {
      estimates: [{ resourceType: "QA", minutes: 60, estimatedAt: "2026-03-04T10:00:00.000Z" }],
    });
    const estimates = (await call(w.developer, "get", `/tickets/${ticket.id}/estimates`)).body.data;
    expect(estimates[0].estimatedAt).toBe("2026-03-04T10:00:00.000Z");
  });
});

describe("ticket deletion", () => {
  it("allows managers to delete tickets without logged time only", async () => {
    const w = await projectWorld();
    const free = await newTicket(w.developer, w.project.id);
    const logged = await newTicket(w.developer, w.project.id);
    await db.insert(workLogs).values({ ticketId: logged.id, userId: w.developer.id, minutes: 30 });
    expect((await call(w.developer, "delete", `/tickets/${free.id}`)).status).toBe(403);
    expect((await call(w.manager, "delete", `/tickets/${logged.id}`)).body.error.code).toBe(
      "HAS_LOGGED_TIME",
    );
    const bulk = await call(w.manager, "post", `/projects/${w.project.id}/tickets/bulk-delete`, {
      ticketIds: [free.id, logged.id],
    });
    expect(bulk.body.data).toEqual({
      deleted: [free.id],
      skipped: [{ id: logged.id, reason: "HAS_LOGGED_TIME" }],
    });
  });
});

describe("sprints", () => {
  it("creates sprints on top, completes them moving only unfinished tickets, and deletes them safely", async () => {
    const w = await projectWorld();
    const s1 = (
      await call(w.developer, "post", `/projects/${w.project.id}/sprints`, { name: "One" })
    ).body.data;
    const s2 = (
      await call(w.developer, "post", `/projects/${w.project.id}/sprints`, { name: "Two" })
    ).body.data;
    expect(s2.position).toBeLessThan(s1.position);
    expect(
      (
        await call(w.developer, "post", `/projects/${w.project.id}/sprints`, {
          name: "Bad",
          startsAt: "2026-10-05T00:00:00Z",
          endsAt: "2026-10-01T00:00:00Z",
        })
      ).status,
    ).toBe(400);

    await call(w.developer, "post", `/projects/${w.project.id}/sprints/${s1.id}/start`);
    const open = await newTicket(w.developer, w.project.id, {
      sprintId: s1.id,
      columnId: w.columns[1].id,
    });
    const finished = await newTicket(w.developer, w.project.id, {
      sprintId: s1.id,
      columnId: w.columns[2].id,
    });
    expect(
      (
        await call(w.developer, "post", `/projects/${w.project.id}/sprints/${s1.id}/complete`, {
          moveOpenTicketsTo: s1.id,
        })
      ).status,
    ).toBe(400);
    const completed = await call(
      w.developer,
      "post",
      `/projects/${w.project.id}/sprints/${s1.id}/complete`,
      { moveOpenTicketsTo: s2.id },
    );
    expect(completed.body.data.movedTicketIds).toEqual([open.id]);
    const after = (await call(w.developer, "get", `/projects/${w.project.id}/tickets`)).body
      .data as { id: string; sprintId: string }[];
    expect(after.find((t) => t.id === open.id)!.sprintId).toBe(s2.id);
    expect(after.find((t) => t.id === finished.id)!.sprintId).toBe(s1.id);
    expect(
      (await call(w.developer, "post", `/projects/${w.project.id}/sprints/${s1.id}/move`, {})).body
        .error.code,
    ).toBe("SPRINT_STARTED");

    expect(
      (await call(w.developer, "delete", `/projects/${w.project.id}/sprints/${s2.id}`)).status,
    ).toBe(204);
    const final = (await call(w.developer, "get", `/projects/${w.project.id}/tickets`)).body
      .data as { id: string; sprintId: string | null }[];
    expect(final.find((t) => t.id === open.id)!.sprintId).toBeNull();
    expect(
      (await call(w.viewer, "post", `/projects/${w.project.id}/sprints`, { name: "V" })).status,
    ).toBe(403);
  });
});

describe("board columns", () => {
  it("are managed by project managers with atomic reordering", async () => {
    const w = await projectWorld();
    expect(
      (await call(w.developer, "post", `/projects/${w.project.id}/columns`, { name: "QA" })).status,
    ).toBe(403);
    const added = (
      await call(w.manager, "post", `/projects/${w.project.id}/columns`, { name: "QA" })
    ).body.data;
    expect(added.orderIndex).toBe(3);
    const ids = [added.id, w.columns[0].id, w.columns[1].id, w.columns[2].id];
    expect(
      (
        await call(w.manager, "put", `/projects/${w.project.id}/columns/order`, {
          columnIds: ids.slice(1),
        })
      ).status,
    ).toBe(400);
    const ordered = (
      await call(w.manager, "put", `/projects/${w.project.id}/columns/order`, { columnIds: ids })
    ).body.data;
    expect(ordered.map((c: { id: string }) => c.id)).toEqual(ids);
  });
});

describe("estimates, work logs, comments, attachments, epics", () => {
  it("keeps the estimate total in sync and reserves edits for managers", async () => {
    const w = await projectWorld();
    const t = await newTicket(w.developer, w.project.id);
    const added = (
      await call(w.developer, "post", `/tickets/${t.id}/estimates`, {
        resourceType: "Dev",
        minutes: 60,
      })
    ).body.data;
    expect((await call(w.developer, "get", `/tickets/${t.id}`)).body.data.estimateMinutes).toBe(60);
    expect(
      (await call(w.developer, "patch", `/tickets/${t.id}/estimates/${added.id}`, { minutes: 30 }))
        .status,
    ).toBe(403);
    await call(w.manager, "patch", `/tickets/${t.id}/estimates/${added.id}`, { minutes: 45 });
    expect((await call(w.developer, "get", `/tickets/${t.id}`)).body.data.estimateMinutes).toBe(45);
    await call(w.manager, "delete", `/tickets/${t.id}/estimates/${added.id}`);
    expect((await call(w.developer, "get", `/tickets/${t.id}`)).body.data.estimateMinutes).toBe(0);
  });

  it("lets members log their own time and managers log or reassign for others", async () => {
    const w = await projectWorld();
    const t = await newTicket(w.developer, w.project.id);
    const at = new Date().toISOString();
    expect(
      (
        await call(w.developer, "post", `/tickets/${t.id}/work-logs`, {
          minutes: 15,
          note: "n",
          loggedAt: at,
          userId: w.teammate.id,
        })
      ).status,
    ).toBe(403);
    const own = (
      await call(w.developer, "post", `/tickets/${t.id}/work-logs`, {
        minutes: 15,
        note: "own",
        loggedAt: at,
      })
    ).body.data;
    expect(own.userId).toBe(w.developer.id);
    expect(
      (
        await call(w.manager, "post", `/tickets/${t.id}/work-logs`, {
          minutes: 30,
          note: "for",
          loggedAt: at,
          userId: w.teammate.id,
        })
      ).body.data.userId,
    ).toBe(w.teammate.id);
    expect(
      (await call(w.teammate, "patch", `/tickets/${t.id}/work-logs/${own.id}`, { note: "x" }))
        .status,
    ).toBe(403);
    expect(
      (
        await call(w.manager, "patch", `/tickets/${t.id}/work-logs/${own.id}`, {
          userId: w.teammate.id,
        })
      ).body.data.userId,
    ).toBe(w.teammate.id);
    expect((await call(w.developer, "get", `/tickets/${t.id}`)).body.data.loggedMinutes).toBe(45);
  });

  it("threads replies, emails mentions and reply authors, and restricts edits", async () => {
    const w = await projectWorld();
    const t = await newTicket(w.developer, w.project.id);
    const body = JSON.stringify(doc("look ", [{ id: w.teammate.id, label: "Tea" }]));
    const top = (await call(w.developer, "post", `/tickets/${t.id}/comments`, { body })).body.data;
    expect(mailFor(w.teammate.email)).toHaveLength(1);
    const reply = (
      await call(w.teammate, "post", `/tickets/${t.id}/comments`, { body: "ok", parentId: top.id })
    ).body.data;
    const nested = (
      await call(w.manager, "post", `/tickets/${t.id}/comments`, {
        body: "me too",
        parentId: reply.id,
      })
    ).body.data;
    expect(nested.parentId).toBe(top.id);
    expect(mailFor(w.developer.email)).toHaveLength(2);
    expect(
      (await call(w.developer, "post", `/tickets/${t.id}/comments`, { body: "   " })).status,
    ).toBe(400);
    expect(
      (await call(w.teammate, "patch", `/tickets/${t.id}/comments/${top.id}`, { body: "hijack" }))
        .status,
    ).toBe(403);
    expect((await call(w.teammate, "delete", `/tickets/${t.id}/comments/${top.id}`)).status).toBe(
      403,
    );
    expect((await call(w.manager, "delete", `/tickets/${t.id}/comments/${top.id}`)).status).toBe(
      204,
    );
    expect((await call(w.developer, "get", `/tickets/${t.id}/comments`)).body.data).toHaveLength(0);
  });

  it("stores attachments privately and limits who can fetch or remove them", async () => {
    const w = await projectWorld();
    const t = await newTicket(w.developer, w.project.id);
    const upload = await w.developer.agent
      .post(`/api/v1/tickets/${t.id}/attachments`)
      .set("Origin", "http://app.test")
      .attach("file", Buffer.from("hello"), "notes.txt");
    expect(upload.status).toBe(201);
    const id = upload.body.data.id as string;
    const url = (await call(w.viewer, "get", `/tickets/${t.id}/attachments/${id}/url`)).body.data
      .url as string;
    expect(await (await fetch(url)).text()).toBe("hello");
    expect((await call(w.outsider, "get", `/tickets/${t.id}/attachments/${id}/url`)).status).toBe(
      404,
    );
    expect((await call(w.teammate, "delete", `/tickets/${t.id}/attachments/${id}`)).status).toBe(
      403,
    );
    expect((await call(w.manager, "delete", `/tickets/${t.id}/attachments/${id}`)).status).toBe(
      204,
    );
  });

  it("keeps epic names unique and reserves deletion for managers", async () => {
    const w = await projectWorld();
    const e = (
      await call(w.developer, "post", `/projects/${w.project.id}/epics`, { name: "Billing" })
    ).body.data;
    expect(
      (await call(w.developer, "post", `/projects/${w.project.id}/epics`, { name: "billing" })).body
        .error.code,
    ).toBe("EPIC_NAME_TAKEN");
    const t = await newTicket(w.developer, w.project.id, { epicIds: [e.id] });
    expect(
      (await call(w.developer, "delete", `/projects/${w.project.id}/epics/${e.id}`)).status,
    ).toBe(403);
    expect(
      (await call(w.manager, "delete", `/projects/${w.project.id}/epics/${e.id}`)).status,
    ).toBe(204);
    expect((await call(w.developer, "get", `/tickets/${t.id}`)).body.data.epicIds).toEqual([]);
  });
});
