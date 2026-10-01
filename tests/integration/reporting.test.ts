import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/database/client.js";
import { comments, sprints, workLogs } from "../../src/database/schema/index.js";
import { resetDatabase } from "../support/db.js";
import { call, newTicket, projectWorld } from "../support/project-world.js";

beforeEach(resetDatabase);

describe("reporting", () => {
  it("returns work logs and tickets only from visible projects, filtered by time", async () => {
    const w = await projectWorld();
    const t = await newTicket(w.developer, w.project.id, {
      columnId: w.columns[2].id,
      assigneeId: w.developer.id,
    });
    await db.insert(workLogs).values([
      {
        ticketId: t.id,
        userId: w.developer.id,
        minutes: 60,
        loggedAt: new Date("2026-09-01T10:00:00Z"),
      },
      {
        ticketId: t.id,
        userId: w.teammate.id,
        minutes: 30,
        loggedAt: new Date("2026-09-08T10:00:00Z"),
      },
    ]);
    const all = (await call(w.viewer, "get", "/reports/work-logs")).body.data;
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ projectId: w.project.id, minutes: 60 });
    const windowed = (
      await call(
        w.viewer,
        "get",
        "/reports/work-logs?from=2026-09-05T00:00:00Z&to=2026-09-10T00:00:00Z",
      )
    ).body.data;
    expect(windowed.map((l: { userId: string }) => l.userId)).toEqual([w.teammate.id]);
    expect(
      (await call(w.outsider, "get", `/reports/work-logs?projectIds=${w.project.id}`)).body.data,
    ).toEqual([]);
    const found = (await call(w.developer, "get", `/reports/tickets?assigneeIds=${w.developer.id}`))
      .body.data;
    expect(found).toEqual([expect.objectContaining({ id: t.id, isDone: true, stageName: "Done" })]);
  });

  it("classifies RAG status with the source rules", async () => {
    const w = await projectWorld();
    const [active] = await db
      .insert(sprints)
      .values({ projectId: w.project.id, name: "Active", status: "active" })
      .returning();
    const { boardColumns } = await import("../../src/database/schema/index.js");
    const [test] = await db
      .insert(boardColumns)
      .values({ projectId: w.project.id, name: "Ready to Test", orderIndex: 5 })
      .returning();
    const over = await newTicket(w.developer, w.project.id, {
      sprintId: active!.id,
      estimates: [{ resourceType: "D", minutes: 60 }],
    });
    const chatty = await newTicket(w.developer, w.project.id, {
      sprintId: active!.id,
      columnId: test!.id,
    });
    const both = await newTicket(w.developer, w.project.id, {
      sprintId: active!.id,
      columnId: test!.id,
      estimates: [{ resourceType: "D", minutes: 10 }],
    });
    await newTicket(w.developer, w.project.id, { sprintId: active!.id });
    await db.insert(workLogs).values([
      { ticketId: over.id, userId: w.developer.id, minutes: 90 },
      { ticketId: both.id, userId: w.developer.id, minutes: 20 },
    ]);
    for (const id of [chatty.id, both.id]) {
      await db
        .insert(comments)
        .values([1, 2, 3].map((n) => ({ ticketId: id, authorId: w.developer.id, body: `c${n}` })));
    }
    const report = (await call(w.viewer, "get", `/projects/${w.project.id}/rag-report`)).body.data;
    expect(report.counts).toEqual({ red: 1, orange: 2, green: 1 });
    expect(report.rows[0]).toMatchObject({ ticketId: both.id, status: "red", pctSpent: 200 });
    expect(report.rows.find((r: { ticketId: string }) => r.ticketId === over.id)).toMatchObject({
      status: "orange",
      hoursOrange: true,
      pctSpent: 150,
    });
  });

  it("computes utilisation against prorated 40h weeks", async () => {
    const w = await projectWorld();
    const t = await newTicket(w.developer, w.project.id, { assigneeId: w.developer.id });
    await db
      .insert(workLogs)
      .values({
        ticketId: t.id,
        userId: w.developer.id,
        minutes: 1200,
        loggedAt: new Date("2026-09-08T10:00:00Z"),
      });
    const report = (
      await call(
        w.manager,
        "get",
        `/projects/${w.project.id}/utilization?from=2026-09-07T00:00:00Z&to=2026-09-14T00:00:00Z`,
      )
    ).body.data;
    expect(report.capacityMinutesPerMember).toBe(2400);
    const dev = report.members.find((m: { userId: string }) => m.userId === w.developer.id);
    expect(dev).toMatchObject({ loggedMinutes: 1200, utilization: 50, openTicketCount: 1 });
    expect(
      report.members.some(
        (m: { userId: string; role: string }) =>
          m.userId === w.accountAdmin.id && m.role === "account_admin",
      ),
    ).toBe(true);
    expect(
      (
        await call(
          w.outsider,
          "get",
          `/projects/${w.project.id}/utilization?from=2026-09-07T00:00:00Z&to=2026-09-14T00:00:00Z`,
        )
      ).status,
    ).toBe(404);
  });

  it("limits reportable users to self unless the caller administers the project", async () => {
    const w = await projectWorld();
    const mine = (
      await call(w.developer, "get", `/reports/reportable-users?projectIds=${w.project.id}`)
    ).body.data;
    expect(mine.map((u: { id: string }) => u.id)).toEqual([w.developer.id]);
    const admin = (
      await call(w.accountAdmin, "get", `/reports/reportable-users?projectIds=${w.project.id}`)
    ).body.data;
    expect(admin.length).toBeGreaterThan(4);
  });

  it("summarises comments only for readers and only when AI is configured", async () => {
    const w = await projectWorld();
    const t = await newTicket(w.developer, w.project.id);
    await db
      .insert(comments)
      .values({ ticketId: t.id, authorId: w.developer.id, body: "needs work" });
    expect((await call(w.outsider, "post", `/tickets/${t.id}/comment-summary`)).status).toBe(404);
    const response = await call(w.developer, "post", `/tickets/${t.id}/comment-summary`);
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("AI_NOT_CONFIGURED");
  });
});
