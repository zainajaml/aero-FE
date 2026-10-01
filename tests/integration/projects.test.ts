import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/database/client.js";
import {
  boardColumns,
  profiles,
  projectMembers,
  rateCard,
  tickets,
} from "../../src/database/schema/index.js";
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

async function world() {
  const account = await createAccount();
  const otherAccount = await createAccount();
  const project = await createProject(account.id);
  const otherProject = await createProject(otherAccount.id);
  const accountAdmin = await createActor();
  await makeAccountAdmin(account.id, accountAdmin.id);
  const projectAdmin = await createActor();
  await addMember(project.id, projectAdmin.id, "admin");
  const developer = await createActor();
  await addMember(project.id, developer.id, "developer");
  const viewer = await createActor();
  await addMember(project.id, viewer.id, "viewer");
  const outsider = await createActor();
  await addMember(otherProject.id, outsider.id, "admin");
  const superAdmin = await createActor({ roles: ["super_admin"] });
  return {
    account,
    otherAccount,
    project,
    otherProject,
    accountAdmin,
    projectAdmin,
    developer,
    viewer,
    outsider,
    superAdmin,
  };
}

const send = (
  agent: Awaited<ReturnType<typeof createActor>>["agent"],
  method: "post" | "patch" | "put" | "delete",
  path: string,
  body?: object,
) => agent[method](`/api/v1${path}`).set("Origin", APP_ORIGIN).send(body);

describe("GET /projects", () => {
  it("returns only readable projects, archived ones included", async () => {
    const w = await world();
    const ids = async (actor: { agent: typeof w.developer.agent }) =>
      (await actor.agent.get("/api/v1/projects")).body.data.map((p: { id: string }) => p.id);
    expect(await ids(w.developer)).toEqual([w.project.id]);
    expect(await ids(w.outsider)).toEqual([w.otherProject.id]);
    expect((await ids(w.superAdmin)).sort()).toEqual([w.project.id, w.otherProject.id].sort());
    await send(w.accountAdmin.agent, "post", `/projects/${w.project.id}/archive`);
    expect(await ids(w.accountAdmin)).toEqual([w.project.id]);
    const [row] = (await w.accountAdmin.agent.get("/api/v1/projects")).body.data;
    expect(row).toMatchObject({ archivedBy: w.accountAdmin.id, archivedAt: expect.any(String) });
  });
});

describe("POST /projects", () => {
  it("lets account admins create projects with default columns and an inherited rate card", async () => {
    const w = await world();
    await db.insert(rateCard).values([
      { projectId: w.project.id, role: "Developer", hourlyRate: "50.00" },
      { projectId: w.project.id, role: "QA", location: "PK", hourlyRate: "30.00" },
    ]);
    const response = await send(w.accountAdmin.agent, "post", "/projects", {
      accountId: w.account.id,
      name: "Mobile",
      key: "mob",
      projectType: "kanban",
    });
    expect(response.status).toBe(201);
    const id = response.body.data.id as string;
    expect(response.body.data).toMatchObject({
      key: "MOB",
      projectType: "kanban",
      ownerId: w.accountAdmin.id,
    });
    expect(await db.select().from(boardColumns).where(eq(boardColumns.projectId, id))).toHaveLength(
      4,
    );
    expect(
      (await db.select().from(rateCard).where(eq(rateCard.projectId, id)))
        .map((r) => r.role)
        .sort(),
    ).toEqual(["Developer", "QA"]);
    expect(
      await db.select().from(projectMembers).where(eq(projectMembers.projectId, id)),
    ).toHaveLength(0);
  });

  it("makes a super admin creator the project admin, and rejects others and taken keys", async () => {
    const w = await world();
    const created = await send(w.superAdmin.agent, "post", "/projects", {
      accountId: w.account.id,
      name: "Ops",
      key: "OPS",
      projectType: "sprint",
    });
    expect(created.status).toBe(201);
    expect(
      await db
        .select()
        .from(projectMembers)
        .where(eq(projectMembers.projectId, created.body.data.id)),
    ).toEqual([expect.objectContaining({ userId: w.superAdmin.id, role: "admin" })]);
    expect(
      (
        await send(w.projectAdmin.agent, "post", "/projects", {
          accountId: w.account.id,
          name: "X",
          key: "XX",
          projectType: "sprint",
        })
      ).status,
    ).toBe(403);
    const taken = await send(w.accountAdmin.agent, "post", "/projects", {
      accountId: w.account.id,
      name: "Dup",
      key: "ops",
      projectType: "sprint",
    });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe("PROJECT_KEY_TAKEN");
  });
});

describe("PATCH/DELETE /projects/:id", () => {
  it("lets managers edit, hides the project from outsiders and denies developers", async () => {
    const w = await world();
    expect(
      (
        await send(w.projectAdmin.agent, "patch", `/projects/${w.project.id}`, {
          name: "Renamed",
          clientAccount: "ACME",
        })
      ).body.data,
    ).toMatchObject({ name: "Renamed", clientAccount: "ACME" });
    expect(
      (await send(w.developer.agent, "patch", `/projects/${w.project.id}`, { name: "No" })).status,
    ).toBe(403);
    expect(
      (await send(w.outsider.agent, "patch", `/projects/${w.project.id}`, { name: "No" })).status,
    ).toBe(404);
  });

  it("makes archived projects read-only until restored", async () => {
    const w = await world();
    expect(
      (await send(w.projectAdmin.agent, "post", `/projects/${w.project.id}/archive`)).status,
    ).toBe(403);
    expect(
      (await send(w.accountAdmin.agent, "post", `/projects/${w.project.id}/archive`)).status,
    ).toBe(200);
    const blocked = await send(w.projectAdmin.agent, "patch", `/projects/${w.project.id}`, {
      name: "Blocked",
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("PROJECT_ARCHIVED");
    await send(w.accountAdmin.agent, "post", `/projects/${w.project.id}/restore`);
    expect(
      (await send(w.projectAdmin.agent, "patch", `/projects/${w.project.id}`, { name: "Back" }))
        .status,
    ).toBe(200);
  });

  it("only lets account admins delete, cascading project content", async () => {
    const w = await world();
    await db.insert(tickets).values({ projectId: w.project.id, code: "P-1", title: "t" });
    expect((await send(w.projectAdmin.agent, "delete", `/projects/${w.project.id}`)).status).toBe(
      403,
    );
    expect((await send(w.accountAdmin.agent, "delete", `/projects/${w.project.id}`)).status).toBe(
      204,
    );
    expect(await db.select().from(tickets)).toHaveLength(0);
  });

  it("moves projects only for admins of both accounts", async () => {
    const w = await world();
    expect(
      (
        await send(w.accountAdmin.agent, "post", `/projects/${w.project.id}/move`, {
          accountId: w.otherAccount.id,
        })
      ).status,
    ).toBe(403);
    const moved = await send(w.superAdmin.agent, "post", `/projects/${w.project.id}/move`, {
      accountId: w.otherAccount.id,
    });
    expect(moved.body.data.accountId).toBe(w.otherAccount.id);
  });
});

describe("project people and stats", () => {
  it("lists members and account admins but never super admins or archived users", async () => {
    const w = await world();
    await addMember(w.project.id, w.superAdmin.id, "admin");
    await db.update(profiles).set({ archivedAt: new Date() }).where(eq(profiles.id, w.viewer.id));
    const people = (await w.developer.agent.get(`/api/v1/projects/${w.project.id}/people`)).body
      .data;
    expect(
      people.map((p: { userId: string; role: string }) => `${p.userId}:${p.role}`).sort(),
    ).toEqual(
      [
        `${w.accountAdmin.id}:account_admin`,
        `${w.projectAdmin.id}:admin`,
        `${w.developer.id}:developer`,
      ].sort(),
    );
    expect((await w.outsider.agent.get(`/api/v1/projects/${w.project.id}/people`)).status).toBe(
      404,
    );
  });

  it("returns stats only for visible projects", async () => {
    const w = await world();
    await db.insert(tickets).values({ projectId: w.project.id, code: "P-1", title: "t" });
    const stats = (
      await w.developer.agent.get(`/api/v1/projects/stats?ids=${w.project.id},${w.otherProject.id}`)
    ).body.data;
    expect(stats).toEqual([
      expect.objectContaining({
        projectId: w.project.id,
        tickets: 1,
        members: 3,
        activeSprint: false,
      }),
    ]);
  });

  it("limits visible profiles to people sharing a project", async () => {
    const w = await world();
    const visible = (
      await w.developer.agent.get(`/api/v1/people?ids=${w.viewer.id},${w.outsider.id}`)
    ).body.data;
    expect(visible.map((p: { id: string }) => p.id)).toEqual([w.viewer.id]);
  });
});

describe("rate card", () => {
  it("lets managers manage rates and rejects developers, duplicates and foreign rows", async () => {
    const w = await world();
    const created = await send(
      w.projectAdmin.agent,
      "post",
      `/projects/${w.project.id}/rate-card`,
      { role: "Developer", hourlyRate: 42.5 },
    );
    expect(created.status).toBe(201);
    expect(created.body.data.hourlyRate).toBe("42.50");
    expect(
      (
        await send(w.developer.agent, "post", `/projects/${w.project.id}/rate-card`, {
          role: "QA",
          hourlyRate: 1,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await send(w.projectAdmin.agent, "post", `/projects/${w.project.id}/rate-card`, {
          role: "Developer",
          hourlyRate: 1,
        })
      ).status,
    ).toBe(409);
    const id = created.body.data.id as string;
    expect(
      (
        await send(w.outsider.agent, "put", `/projects/${w.otherProject.id}/rate-card/${id}`, {
          role: "X",
          hourlyRate: 1,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await send(w.projectAdmin.agent, "put", `/projects/${w.project.id}/rate-card/${id}`, {
          role: "Dev",
          location: "PK",
          hourlyRate: 10,
        })
      ).body.data,
    ).toMatchObject({ role: "Dev", location: "PK", hourlyRate: "10.00" });
    const list = (
      await w.viewer.agent.get(`/api/v1/rate-card?ids=${w.project.id},${w.otherProject.id}`)
    ).body.data;
    expect(list).toHaveLength(1);
    expect(
      (await send(w.projectAdmin.agent, "delete", `/projects/${w.project.id}/rate-card/${id}`))
        .status,
    ).toBe(204);
  });
});
