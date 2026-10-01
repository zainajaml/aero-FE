import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/database/client.js";
import { emailSendLog } from "../../src/database/schema/index.js";
import { app, mailFor, outbox } from "../support/actors.js";
import { resetDatabase } from "../support/db.js";
import { call, doc, newTicket, projectWorld } from "../support/project-world.js";

beforeEach(async () => {
  await resetDatabase();
  outbox().length = 0;
});

describe("notification log", () => {
  it("shows people their own mail, admins their projects' mail, and hides self-triggered mail", async () => {
    const w = await projectWorld();
    await newTicket(w.developer, w.project.id, { assigneeId: w.teammate.id });
    const teammateView = (await call(w.teammate, "get", "/notifications")).body.data;
    expect(
      teammateView.items.filter(
        (i: { templateName: string }) => i.templateName === "ticket-assignment",
      ),
    ).toHaveLength(1);
    expect(teammateView.items[0]).toMatchObject({ projectId: w.project.id, author: "Dev Eloper" });
    expect(
      (await call(w.developer, "get", "/notifications")).body.data.items.filter(
        (i: { templateName: string }) => i.templateName === "ticket-assignment",
      ),
    ).toHaveLength(0);
    const managerView = (await call(w.manager, "get", "/notifications")).body.data;
    expect(
      managerView.items.some((i: { recipient: string }) => i.recipient === w.teammate.email),
    ).toBe(true);
    expect(
      (await call(w.outsider, "get", "/notifications")).body.data.items.some(
        (i: { recipient: string }) => i.recipient === w.teammate.email,
      ),
    ).toBe(false);
    expect(
      (await call(w.teammate, "get", "/notifications/unseen-count")).body.data.count,
    ).toBeGreaterThan(0);
  });

  it("retries failed mail for admins in scope only", async () => {
    const w = await projectWorld();
    const [failed] = await db
      .insert(emailSendLog)
      .values({
        templateName: "ticket-assignment",
        recipientEmail: w.teammate.email,
        status: "failed",
        subject: "Assigned",
        html: "<p>hi</p>",
        metadata: { project_id: w.project.id },
      })
      .returning();
    expect((await call(w.developer, "post", `/notifications/${failed!.id}/retry`)).status).toBe(
      403,
    );
    expect((await call(w.outsider, "post", `/notifications/${failed!.id}/retry`)).status).toBe(404);
    const retried = await call(w.manager, "post", `/notifications/${failed!.id}/retry`);
    expect(retried.body.data.status).toBe("sent");
    expect(mailFor(w.teammate.email).some((m) => m.subject === "Assigned")).toBe(true);
    expect(
      (await call(w.manager, "post", `/notifications/${retried.body.data.logId}/retry`)).body.error
        .code,
    ).toBe("NOT_RETRYABLE");
  });
});

describe("unsubscribe", () => {
  it("adds one-click headers to notification mail and suppresses future sends", async () => {
    const w = await projectWorld();
    const t = await newTicket(w.developer, w.project.id);
    await call(w.developer, "patch", `/tickets/${t.id}`, {
      descriptionJson: doc("ping ", [{ id: w.teammate.id, label: "Tea" }]),
    });
    const message = mailFor(w.teammate.email)[0]!;
    const header = message.headers?.["List-Unsubscribe"] ?? "";
    const token = decodeURIComponent(/token=([^>]+)>/.exec(header)![1]!);
    expect(
      (await request(app).get("/api/v1/email/unsubscribe").query({ token })).body.data,
    ).toEqual({ valid: true, alreadyUnsubscribed: false });
    expect(
      (
        await request(app)
          .get("/api/v1/email/unsubscribe")
          .query({ token: `${token}x` })
      ).status,
    ).toBe(404);
    const oneClick = await request(app)
      .post(`/api/v1/email/unsubscribe?token=${encodeURIComponent(token)}`)
      .type("form")
      .send({ "List-Unsubscribe": "One-Click" });
    expect(oneClick.body.data).toEqual({ valid: true, alreadyUnsubscribed: false });
    expect(
      (await request(app).post("/api/v1/email/unsubscribe").send({ token })).body.data
        .alreadyUnsubscribed,
    ).toBe(true);

    outbox().length = 0;
    await call(w.developer, "patch", `/tickets/${t.id}`, {
      descriptionJson: doc("again ", [
        { id: w.teammate.id, label: "Tea" },
        { id: w.manager.id, label: "Pat" },
      ]),
    });
    expect(mailFor(w.teammate.email)).toHaveLength(0);
  });
});
