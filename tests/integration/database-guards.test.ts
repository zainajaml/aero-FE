import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/database/client.js";
import {
  boardColumns,
  projectMembers,
  projects,
  supportIssues,
  tickets,
  userRoles,
} from "../../src/database/schema/index.js";
import { translateDatabaseError } from "../../src/shared/http/database-errors.js";
import { addMember, createAccount, createActor, createProject } from "../support/actors.js";
import { resetDatabase } from "../support/db.js";

beforeEach(resetDatabase);

async function captureError(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    return translateDatabaseError(error);
  }
  throw new Error("expected the database to reject the write");
}

describe("archived project guard", () => {
  it("blocks writes to an archived project and its children, but allows restore", async () => {
    const account = await createAccount();
    const project = await createProject(account.id);
    const [column] = await db
      .insert(boardColumns)
      .values({ projectId: project.id, name: "To Do" })
      .returning();
    await db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.id, project.id));

    const renamed = await captureError(() =>
      db.update(projects).set({ name: "Renamed" }).where(eq(projects.id, project.id)),
    );
    expect(renamed?.code).toBe("PROJECT_ARCHIVED");
    const child = await captureError(() =>
      db
        .insert(tickets)
        .values({ projectId: project.id, columnId: column!.id, code: "X-1", title: "Blocked" }),
    );
    expect(child?.code).toBe("PROJECT_ARCHIVED");

    await db
      .update(projects)
      .set({ archivedAt: null, archivedBy: null })
      .where(eq(projects.id, project.id));
    await db
      .insert(tickets)
      .values({ projectId: project.id, code: "X-1", title: "Allowed after restore" });
  });

  it("lets a project be deleted with its children even when archived", async () => {
    const account = await createAccount();
    const project = await createProject(account.id);
    await db.insert(tickets).values({ projectId: project.id, code: "X-1", title: "t" });
    await db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.id, project.id));
    await db.delete(projects).where(eq(projects.id, project.id));
    expect(await db.select().from(tickets)).toHaveLength(0);
  });
});

describe("account admin exclusivity", () => {
  it("rejects project roles for admins of the project's account", async () => {
    const account = await createAccount();
    const project = await createProject(account.id);
    const actor = await createActor();
    await db.execute(
      sql`insert into account_admins (account_id, user_id) values (${account.id}, ${actor.id})`,
    );
    const error = await captureError(() => addMember(project.id, actor.id, "developer"));
    expect(error?.code).toBe("ACCOUNT_ADMIN_PROJECT_ROLE");
  });

  it("removes existing seats in administered accounts when the account_admin role is granted", async () => {
    const account = await createAccount();
    const project = await createProject(account.id);
    const actor = await createActor();
    await addMember(project.id, actor.id, "developer");
    await db.execute(
      sql`alter table project_members disable trigger project_members_block_account_admin`,
    );
    await db.execute(
      sql`insert into account_admins (account_id, user_id) values (${account.id}, ${actor.id})`,
    );
    await db.execute(
      sql`alter table project_members enable trigger project_members_block_account_admin`,
    );
    await db.insert(userRoles).values({ userId: actor.id, role: "account_admin" });
    expect(
      await db.select().from(projectMembers).where(eq(projectMembers.userId, actor.id)),
    ).toHaveLength(0);
  });
});

describe("support ticket numbers and updated_at", () => {
  it("assigns a six-character ticket number and maintains updated_at", async () => {
    const actor = await createActor();
    const [issue] = await db
      .insert(supportIssues)
      .values({ userId: actor.id, subject: "Help" })
      .returning();
    expect(issue!.ticketNumber).toMatch(/^[A-Z0-9]{6}$/);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const [updated] = await db
      .update(supportIssues)
      .set({ status: "closed" })
      .where(eq(supportIssues.id, issue!.id))
      .returning();
    expect(updated!.updatedAt.getTime()).toBeGreaterThan(issue!.updatedAt.getTime());
  });
});
