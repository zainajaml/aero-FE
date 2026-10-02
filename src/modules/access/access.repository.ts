import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/client.js";
import {
  accountAdmins,
  profiles,
  projectMembers,
  projects,
  userRoles,
  users,
} from "../../database/schema/index.js";
import type { AppRole } from "../../database/schema/_shared.js";
import type { Actor, ProjectScope } from "./access.types.js";

export async function findActor(db: DbExecutor, userId: string): Promise<Actor | null> {
  const [identity] = await db
    .select({
      userId: users.id,
      email: users.email,
      emailVerified: users.emailVerified,
      archivedAt: profiles.archivedAt,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.id, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!identity) return null;

  const [roleRows, adminRows] = await Promise.all([
    db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId)),
    db
      .select({ accountId: accountAdmins.accountId })
      .from(accountAdmins)
      .where(eq(accountAdmins.userId, userId)),
  ]);

  return {
    userId: identity.userId,
    email: identity.email,
    emailVerified: identity.emailVerified,
    isArchived: identity.archivedAt !== null,
    globalRoles: roleRows.map((row) => row.role),
    adminAccountIds: adminRows.map((row) => row.accountId),
  };
}

export async function findProjectScope(
  db: DbExecutor,
  projectId: string,
  userId: string,
): Promise<ProjectScope | null> {
  const [row] = await db
    .select({
      projectId: projects.id,
      accountId: projects.accountId,
      archivedAt: projects.archivedAt,
      memberRole: projectMembers.role,
    })
    .from(projects)
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)),
    )
    .where(eq(projects.id, projectId))
    .limit(1);
  return row ?? null;
}

export type MembershipRow = { projectId: string; accountId: string; role: AppRole };

export async function listMemberships(db: DbExecutor, userId: string): Promise<MembershipRow[]> {
  return db
    .select({
      projectId: projectMembers.projectId,
      accountId: projects.accountId,
      role: projectMembers.role,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(eq(projectMembers.userId, userId));
}

/** Projects visible to the actor (ports the is_project_member SELECT policy). */
export async function listVisibleProjectAccounts(
  db: DbExecutor,
  actor: Actor,
  isSuperAdmin: boolean,
): Promise<{ projectId: string; accountId: string }[]> {
  const base = db.select({ projectId: projects.id, accountId: projects.accountId }).from(projects);
  if (isSuperAdmin) return base;
  const conditions = [
    sql`exists (select 1 from ${projectMembers} pm where pm.project_id = ${projects.id} and pm.user_id = ${actor.userId})`,
  ];
  if (actor.adminAccountIds.length > 0)
    conditions.push(inArray(projects.accountId, actor.adminAccountIds));
  return base.where(or(...conditions));
}

export async function isUserArchived(db: DbExecutor, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.id, userId), sql`${profiles.archivedAt} is not null`))
    .limit(1);
  return rows.length > 0;
}

export async function listAdminProjectIds(db: DbExecutor, userId: string): Promise<string[]> {
  const rows = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(and(eq(projectMembers.userId, userId), eq(projectMembers.role, "admin")));
  return rows.map((row) => row.projectId);
}

export async function listProjectIdsInAccounts(
  db: DbExecutor,
  accountIds: string[],
): Promise<string[]> {
  if (accountIds.length === 0) return [];
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(inArray(projects.accountId, accountIds));
  return rows.map((row) => row.id);
}

export async function listAllProjectIds(db: DbExecutor): Promise<string[]> {
  return (await db.select({ id: projects.id }).from(projects)).map((row) => row.id);
}
