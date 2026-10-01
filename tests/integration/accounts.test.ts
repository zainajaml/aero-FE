import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/database/client.js";
import { accountAdmins, projects } from "../../src/database/schema/index.js";
import {
  APP_ORIGIN,
  addMember,
  createAccount,
  createActor,
  createProject,
  makeAccountAdmin,
} from "../support/actors.js";
import { resetDatabase } from "../support/db.js";

beforeEach(resetDatabase);

describe("accounts", () => {
  it("shows accounts that contain the caller's projects or that they administer", async () => {
    const mine = await createAccount("Mine");
    const other = await createAccount("Other");
    const project = await createProject(mine.id);
    await createProject(other.id);
    const member = await createActor();
    await addMember(project.id, member.id, "developer");
    expect(
      (await member.agent.get("/api/v1/accounts")).body.data.map((a: { name: string }) => a.name),
    ).toEqual(["Mine"]);
    expect((await member.agent.get("/api/v1/accounts/administered")).status).toBe(403);
  });

  it("lets an account admin create, rename and delete accounts with confirmation", async () => {
    const owner = await createActor();
    await makeAccountAdmin((await createAccount("First")).id, owner.id);
    const created = await owner.agent
      .post("/api/v1/accounts")
      .set("Origin", APP_ORIGIN)
      .send({ name: "Second Co" });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect(created.body.data.slug).toBe("second-co");
    expect(
      await db.select().from(accountAdmins).where(eq(accountAdmins.accountId, id)),
    ).toHaveLength(1);

    const clash = await owner.agent
      .patch(`/api/v1/accounts/${id}`)
      .set("Origin", APP_ORIGIN)
      .send({ name: "First" });
    expect(clash.status).toBe(409);

    await createProject(id);
    const unforced = await owner.agent.delete(`/api/v1/accounts/${id}`).set("Origin", APP_ORIGIN);
    expect(unforced.status).toBe(409);
    const forced = await owner.agent
      .delete(`/api/v1/accounts/${id}?force=true`)
      .set("Origin", APP_ORIGIN);
    expect(forced.body.data).toEqual({ deletedProjects: 1 });
    expect(await db.select().from(projects).where(eq(projects.accountId, id))).toHaveLength(0);
  });

  it("denies changes to accounts the caller does not administer", async () => {
    const target = await createAccount("Target");
    const intruder = await createActor();
    await makeAccountAdmin((await createAccount("Theirs")).id, intruder.id);
    expect(
      (
        await intruder.agent
          .patch(`/api/v1/accounts/${target.id}`)
          .set("Origin", APP_ORIGIN)
          .send({ name: "Hacked" })
      ).status,
    ).toBe(403);
    expect(
      (
        await intruder.agent
          .delete(`/api/v1/accounts/${target.id}?force=true`)
          .set("Origin", APP_ORIGIN)
      ).status,
    ).toBe(403);
  });

  it("summarises the caller's workspace", async () => {
    const administered = await createAccount("Admin Co");
    const p1 = await createProject(administered.id);
    const elsewhere = await createAccount("Client Co");
    const p2 = await createProject(elsewhere.id);
    const actor = await createActor();
    await makeAccountAdmin(administered.id, actor.id);
    await addMember(p2.id, actor.id, "developer");
    const { body } = await actor.agent.get("/api/v1/me/workspace");
    expect(body.data.accounts).toEqual([
      expect.objectContaining({
        id: administered.id,
        projects: [expect.objectContaining({ id: p1.id })],
      }),
    ]);
    expect(body.data.projects).toEqual([
      expect.objectContaining({
        id: p2.id,
        role: "developer",
        accountName: "Client Co",
        members: 1,
      }),
    ]);
  });
});
