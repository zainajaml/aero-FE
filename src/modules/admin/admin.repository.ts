import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/client.js";
import {
  accountAdmins,
  accounts,
  invitations,
  profiles,
  projectMembers,
  projects,
  userRoles,
  users,
} from "../../database/schema/index.js";

export const loadProfiles = (db: DbExecutor) =>
  db
    .select({
      id: profiles.id,
      email: profiles.email,
      fullName: profiles.fullName,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
      jobTitle: profiles.jobTitle,
      createdAt: profiles.createdAt,
      archivedAt: profiles.archivedAt,
    })
    .from(profiles)
    .orderBy(desc(profiles.createdAt));

export const loadRoles = (db: DbExecutor) =>
  db.select({ userId: userRoles.userId, role: userRoles.role }).from(userRoles);
export const loadMemberships = (db: DbExecutor) =>
  db
    .select({
      userId: projectMembers.userId,
      projectId: projectMembers.projectId,
      role: projectMembers.role,
    })
    .from(projectMembers);
export const loadAccountAdmins = (db: DbExecutor) =>
  db
    .select({ userId: accountAdmins.userId, accountId: accountAdmins.accountId })
    .from(accountAdmins);
export const loadProjects = (db: DbExecutor) =>
  db
    .select({
      id: projects.id,
      name: projects.name,
      key: projects.key,
      accountId: projects.accountId,
    })
    .from(projects)
    .orderBy(asc(projects.name));
export const loadAccounts = (db: DbExecutor) =>
  db.select({ id: accounts.id, name: accounts.name }).from(accounts).orderBy(asc(accounts.name));
export const loadPendingInvitations = (db: DbExecutor) =>
  db
    .select()
    .from(invitations)
    .where(and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
    .orderBy(desc(invitations.createdAt));

/** Users with any footprint (ports users_with_activity): such users are archived, never deleted. */
export async function usersWithActivity(db: DbExecutor, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const list = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const result = await db.execute<{ user_id: string }>(sql`
    select u.id as user_id from unnest(array[${list}]) as u(id)
    where exists (select 1 from work_logs where user_id = u.id)
       or exists (select 1 from comments where author_id = u.id)
       or exists (select 1 from support_messages where author_id = u.id)
       or exists (select 1 from audit_logs where user_id = u.id)
       or exists (select 1 from attachments where uploaded_by = u.id)
       or exists (select 1 from ticket_stage_history where moved_by = u.id)
       or exists (select 1 from documents where created_by = u.id)
       or exists (select 1 from epics where created_by = u.id)
       or exists (select 1 from tickets where reporter_id = u.id or assignee_id = u.id)`);
  return new Set(result.rows.map((row) => row.user_id));
}

export async function rolesOf(db: DbExecutor, userId: string) {
  return (
    await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId))
  ).map((r) => r.role);
}

export async function membershipsOf(db: DbExecutor, userId: string) {
  return db
    .select({ projectId: projectMembers.projectId, role: projectMembers.role })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId));
}

export async function adminAccountsOf(db: DbExecutor, userId: string) {
  return (
    await db
      .select({ accountId: accountAdmins.accountId })
      .from(accountAdmins)
      .where(eq(accountAdmins.userId, userId))
  ).map((r) => r.accountId);
}

export async function projectAccounts(db: DbExecutor, projectIds: string[]) {
  if (projectIds.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ id: projects.id, accountId: projects.accountId })
    .from(projects)
    .where(inArray(projects.id, projectIds));
  return new Map(rows.map((row) => [row.id, row.accountId]));
}

export async function projectIdsOfAccounts(db: DbExecutor, accountIds: string[]) {
  if (accountIds.length === 0) return [];
  return (
    await db
      .select({ id: projects.id })
      .from(projects)
      .where(inArray(projects.accountId, accountIds))
  ).map((r) => r.id);
}

export async function otherAdminExists(db: DbExecutor, accountId: string, exceptUserId: string) {
  const rows = await db
    .select({ userId: accountAdmins.userId })
    .from(accountAdmins)
    .where(and(eq(accountAdmins.accountId, accountId), ne(accountAdmins.userId, exceptUserId)))
    .limit(1);
  return rows.length > 0;
}

export async function setSingleRole(
  db: DbExecutor,
  userId: string,
  role: (typeof userRoles.$inferInsert)["role"],
) {
  await db.delete(userRoles).where(eq(userRoles.userId, userId));
  await db.insert(userRoles).values({ userId, role });
}

export async function removeAccountAdmins(
  db: DbExecutor,
  userId: string,
  accountIds: string[] | null,
) {
  if (accountIds !== null && accountIds.length === 0) return;
  await db
    .delete(accountAdmins)
    .where(
      and(
        eq(accountAdmins.userId, userId),
        accountIds ? inArray(accountAdmins.accountId, accountIds) : undefined,
      ),
    );
}

export async function addAccountAdminGrants(db: DbExecutor, userId: string, accountIds: string[]) {
  if (accountIds.length === 0) return;
  await db
    .insert(accountAdmins)
    .values(accountIds.map((accountId) => ({ accountId, userId })))
    .onConflictDoNothing();
}

export async function removeMemberships(db: DbExecutor, userId: string, projectIds: string[]) {
  if (projectIds.length === 0) return;
  await db
    .delete(projectMembers)
    .where(and(eq(projectMembers.userId, userId), inArray(projectMembers.projectId, projectIds)));
}

export async function upsertMemberships(
  db: DbExecutor,
  userId: string,
  projectIds: string[],
  role: (typeof projectMembers.$inferInsert)["role"],
) {
  if (projectIds.length === 0) return;
  await db
    .insert(projectMembers)
    .values(projectIds.map((projectId) => ({ projectId, userId, role })))
    .onConflictDoUpdate({
      target: [projectMembers.projectId, projectMembers.userId],
      set: { role },
    });
}

export async function findUserEmail(db: DbExecutor, userId: string) {
  const [row] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.email ?? null;
}

export async function emailTaken(db: DbExecutor, email: string, exceptUserId: string) {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(sql`lower(${users.email}) = lower(${email})`, ne(users.id, exceptUserId)))
    .limit(1);
  return rows.length > 0;
}

export async function setUserEmail(db: DbExecutor, userId: string, email: string) {
  await db.update(users).set({ email, emailVerified: false }).where(eq(users.id, userId));
  await db.update(profiles).set({ email }).where(eq(profiles.id, userId));
}

export async function deleteIdentity(db: DbExecutor, userId: string) {
  await db.delete(users).where(eq(users.id, userId));
}
