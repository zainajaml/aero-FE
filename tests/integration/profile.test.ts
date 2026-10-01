import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/database/client.js";
import { profiles } from "../../src/database/schema/index.js";
import {
  APP_ORIGIN,
  addMember,
  createAccount,
  createActor,
  createProject,
} from "../support/actors.js";
import { resetDatabase } from "../support/db.js";

beforeEach(resetDatabase);

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

describe("self-service profile", () => {
  it("edits names and timezone but nothing an admin owns", async () => {
    const actor = await createActor();
    const response = await actor.agent
      .patch("/api/v1/me/profile")
      .set("Origin", APP_ORIGIN)
      .send({
        firstName: " Ada ",
        lastName: "Lovelace",
        timezone: "IST",
        archivedAt: null,
        email: "x@evil.test",
        jobTitle: "CEO",
      });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
      fullName: "Ada Lovelace",
      timezone: "IST",
      email: actor.email,
      jobTitle: null,
    });
    expect(
      (
        await actor.agent
          .patch("/api/v1/me/profile")
          .set("Origin", APP_ORIGIN)
          .send({ timezone: "UTC" })
      ).status,
    ).toBe(400);
  });

  it("does not let an archived user restore themselves", async () => {
    const actor = await createActor();
    await db.update(profiles).set({ archivedAt: new Date() }).where(eq(profiles.id, actor.id));
    const response = await actor.agent
      .patch("/api/v1/me/profile")
      .set("Origin", APP_ORIGIN)
      .send({ archivedAt: null });
    expect(response.status).toBe(403);
    const [row] = await db.select().from(profiles).where(eq(profiles.id, actor.id));
    expect(row!.archivedAt).not.toBeNull();
  });

  it("replaces the avatar and lets teammates (not strangers) sign it", async () => {
    const project = await createProject((await createAccount()).id);
    const actor = await createActor();
    const teammate = await createActor();
    const stranger = await createActor();
    await addMember(project.id, actor.id, "developer");
    await addMember(project.id, teammate.id, "viewer");
    const first = await actor.agent
      .put("/api/v1/me/avatar")
      .set("Origin", APP_ORIGIN)
      .attach("file", PNG, "me.png");
    const second = await actor.agent
      .put("/api/v1/me/avatar")
      .set("Origin", APP_ORIGIN)
      .attach("file", PNG, "me2.png");
    const key = second.body.data.avatarUrl as string;
    expect(key).not.toBe(first.body.data.avatarUrl);
    const sign = (who: typeof teammate) =>
      who.agent
        .post("/api/v1/files/signed-urls")
        .set("Origin", APP_ORIGIN)
        .send({ area: "avatars", keys: [key] });
    expect(Object.keys((await sign(teammate)).body.data.urls)).toEqual([key]);
    expect((await sign(stranger)).body.data.urls).toEqual({});
  });

  it("keeps private details and time off per user", async () => {
    const actor = await createActor();
    const other = await createActor();
    const saved = await actor.agent
      .patch("/api/v1/me/private")
      .set("Origin", APP_ORIGIN)
      .send({ mobile: "+92 300", employmentStatus: "contract" });
    expect(saved.body.data).toEqual({
      mobile: "+92 300",
      employeeNumber: null,
      employmentStatus: "contract",
    });

    const added = await actor.agent
      .post("/api/v1/me/time-off")
      .set("Origin", APP_ORIGIN)
      .send({ kind: "sick", startDate: "2026-10-05", endDate: "2026-10-06" });
    expect(added.status).toBe(201);
    const backwards = await actor.agent
      .post("/api/v1/me/time-off")
      .set("Origin", APP_ORIGIN)
      .send({ kind: "sick", startDate: "2026-10-06", endDate: "2026-10-05" });
    expect(backwards.status).toBe(400);
    expect(
      (
        await other.agent
          .delete(`/api/v1/me/time-off/${added.body.data.id}`)
          .set("Origin", APP_ORIGIN)
      ).status,
    ).toBe(404);
    expect((await actor.agent.get("/api/v1/me/time-off")).body.data).toHaveLength(1);
    expect(
      (
        await actor.agent
          .delete(`/api/v1/me/time-off/${added.body.data.id}`)
          .set("Origin", APP_ORIGIN)
      ).status,
    ).toBe(204);
  });
});
