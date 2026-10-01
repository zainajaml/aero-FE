import { beforeEach, describe, expect, it } from "vitest";
import { APP_ORIGIN, createActor, mailFor, outbox } from "../support/actors.js";
import { resetDatabase } from "../support/db.js";
import { call } from "../support/project-world.js";

beforeEach(async () => {
  await resetDatabase();
  outbox().length = 0;
});

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

describe("support desk", () => {
  it("creates tickets atomically, alerts admins and replies to the requester", async () => {
    const admin = await createActor({
      roles: ["super_admin"],
      email: "admin@spacemanconsulting.com",
    });
    const user = await createActor();
    const other = await createActor();
    const created = await call(user, "post", "/support/issues", {
      subject: "Cannot export",
      description: "The CSV is empty",
    });
    expect(created.status).toBe(201);
    const issue = created.body.data.issue;
    expect(issue.ticketNumber).toMatch(/^[A-Z0-9]{6}$/);
    expect(mailFor(admin.email)).toHaveLength(1);

    expect((await call(other, "get", `/support/issues/${issue.id}`)).status).toBe(404);
    expect((await call(admin, "get", "/support/open-count")).body.data.count).toBe(1);
    expect((await call(other, "get", "/support/open-count")).body.data.count).toBe(0);

    const reply = await admin.agent
      .post(`/api/v1/support/issues/${issue.id}/messages`)
      .set("Origin", APP_ORIGIN)
      .field("body", "Looking now")
      .attach("file", PNG, "shot.png");
    expect(reply.status).toBe(201);
    expect(mailFor(user.email)).toHaveLength(1);
    const signed = await call(user, "post", "/files/signed-urls", {
      area: "support",
      keys: [reply.body.data.attachmentKey],
    });
    expect(Object.keys(signed.body.data.urls)).toHaveLength(1);
    expect(
      (
        await call(other, "post", "/files/signed-urls", {
          area: "support",
          keys: [reply.body.data.attachmentKey],
        })
      ).body.data.urls,
    ).toEqual({});

    const detail = (await call(user, "get", `/support/issues/${issue.id}`)).body.data;
    expect(detail.messages).toHaveLength(2);
    expect(detail.messages[0]).toMatchObject({ body: "The CSV is empty", canEdit: true });
    expect(detail.messages[1].canEdit).toBe(false);
  });

  it("restricts edits to authors of open tickets and cleans up on delete", async () => {
    const user = await createActor();
    const issue = (
      await call(user, "post", "/support/issues", { subject: "Q", description: "first" })
    ).body.data.issue;
    const messageId = (await call(user, "get", `/support/issues/${issue.id}`)).body.data.messages[0]
      .id;
    expect(
      (
        await call(user, "patch", `/support/issues/${issue.id}/messages/${messageId}`, {
          body: "edited",
        })
      ).status,
    ).toBe(200);
    await call(user, "patch", `/support/issues/${issue.id}`, { status: "closed" });
    expect(
      (
        await call(user, "patch", `/support/issues/${issue.id}/messages/${messageId}`, {
          body: "again",
        })
      ).body.error.code,
    ).toBe("SUPPORT_ISSUE_CLOSED");
    expect(
      (await call(user, "post", `/support/issues/${issue.id}/messages`, { body: "" })).status,
    ).toBe(400);
    expect((await call(user, "delete", `/support/issues/${issue.id}`)).status).toBe(204);
    expect((await call(user, "get", "/support/issues")).body.data).toEqual([]);
  });
});
