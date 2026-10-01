import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/database/client.js";
import { boardColumns, projectMembers } from "../../src/database/schema/index.js";
import {
  APP_ORIGIN,
  addMember,
  createAccount,
  createActor,
  createProject,
} from "../support/actors.js";
import { resetDatabase } from "../support/db.js";

beforeEach(resetDatabase);

describe("onboarding wizard", () => {
  it("creates a workspace, makes the caller account admin, then renames on step-back", async () => {
    const actor = await createActor();
    const created = await actor.agent
      .post("/api/v1/onboarding/workspace")
      .set("Origin", APP_ORIGIN)
      .send({ name: "Acme Co", firstName: "Ann", lastName: "Lee" });
    expect(created.status).toBe(200);
    const accountId = created.body.data.accountId as string;
    expect((await actor.agent.get("/api/v1/me/access")).body.data).toMatchObject({
      status: "active",
      globalRoles: ["account_admin"],
      adminAccountIds: [accountId],
    });

    const renamed = await actor.agent
      .post("/api/v1/onboarding/workspace")
      .set("Origin", APP_ORIGIN)
      .send({ name: "Acme Inc" });
    expect(renamed.body.data.accountId).toBe(accountId);
    const state = await actor.agent.get("/api/v1/onboarding");
    expect(state.body.data).toMatchObject({
      accountId,
      accountName: "Acme Inc",
      hasMembership: true,
    });
  });

  it("creates the first project with board columns for its type and switches them on step-back", async () => {
    const actor = await createActor();
    const { body } = await actor.agent
      .post("/api/v1/onboarding/workspace")
      .set("Origin", APP_ORIGIN)
      .send({ name: "Beta" });
    const accountId = body.data.accountId as string;
    const project = await actor.agent
      .post("/api/v1/onboarding/first-project")
      .set("Origin", APP_ORIGIN)
      .send({ accountId, name: "Website", key: "web-1!", projectType: "kanban" });
    expect(project.status).toBe(200);
    const projectId = project.body.data.projectId as string;
    const kanban = await db
      .select()
      .from(boardColumns)
      .where(eq(boardColumns.projectId, projectId));
    expect(kanban.map((c) => c.name)).toEqual(["To Do", "In Progress", "In Review", "Done"]);
    expect(
      await db.select().from(projectMembers).where(eq(projectMembers.projectId, projectId)),
    ).toHaveLength(0);

    await actor.agent
      .post("/api/v1/onboarding/first-project")
      .set("Origin", APP_ORIGIN)
      .send({ accountId, name: "Website", key: "WEB1", projectType: "sprint", projectId });
    const sprint = await db
      .select()
      .from(boardColumns)
      .where(eq(boardColumns.projectId, projectId));
    expect(sprint).toHaveLength(6);
    const state = await actor.agent.get("/api/v1/onboarding");
    expect(state.body.data).toMatchObject({ projectId, projectKey: "WEB1", projectType: "sprint" });
  });

  it("rejects taken keys, foreign accounts, duplicate workspace names and already-onboarded users", async () => {
    const owner = await createActor();
    const { body } = await owner.agent
      .post("/api/v1/onboarding/workspace")
      .set("Origin", APP_ORIGIN)
      .send({ name: "Gamma" });
    await owner.agent
      .post("/api/v1/onboarding/first-project")
      .set("Origin", APP_ORIGIN)
      .send({ accountId: body.data.accountId, name: "P", key: "GAM", projectType: "sprint" });

    const other = await createActor();
    const foreign = await other.agent
      .post("/api/v1/onboarding/first-project")
      .set("Origin", APP_ORIGIN)
      .send({ accountId: body.data.accountId, name: "X", key: "XX", projectType: "sprint" });
    expect(foreign.status).toBe(403);
    const sameName = await other.agent
      .post("/api/v1/onboarding/workspace")
      .set("Origin", APP_ORIGIN)
      .send({ name: "Gamma" });
    expect(sameName.status).toBe(409);
    expect(sameName.body.error.code).toBe("ACCOUNT_NAME_TAKEN");
    const { body: otherWs } = await other.agent
      .post("/api/v1/onboarding/workspace")
      .set("Origin", APP_ORIGIN)
      .send({ name: "Delta" });
    const taken = await other.agent
      .post("/api/v1/onboarding/first-project")
      .set("Origin", APP_ORIGIN)
      .send({ accountId: otherWs.data.accountId, name: "Y", key: "gam", projectType: "sprint" });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe("PROJECT_KEY_TAKEN");

    const member = await createActor({ roles: ["developer"] });
    await addMember((await createProject((await createAccount()).id)).id, member.id, "developer");
    const blocked = await member.agent
      .post("/api/v1/onboarding/workspace")
      .set("Origin", APP_ORIGIN)
      .send({ name: "Epsilon" });
    expect(blocked.status).toBe(409);
  });

  it("validates input", async () => {
    const actor = await createActor();
    const response = await actor.agent
      .post("/api/v1/onboarding/workspace")
      .set("Origin", APP_ORIGIN)
      .send({ name: "x" });
    expect(response.status).toBe(400);
    expect(response.body.error.details[0].path).toBe("body.name");
  });
});
