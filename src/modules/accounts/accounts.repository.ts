import { asc, eq, inArray, like, or, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/client.js";
import { accountAdmins, accounts, projectMembers, projects } from "../../database/schema/index.js";

export type AccountRow = typeof accounts.$inferSelect;

export async function findAccount(db: DbExecutor, id: string): Promise<AccountRow | null> {
  const [row] = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  return row ?? null;
}

export async function insertAccount(
  db: DbExecutor,
  row: typeof accounts.$inferInsert,
): Promise<AccountRow> {
  const [inserted] = await db.insert(accounts).values(row).returning();
  return inserted!;
}

export async function renameAccount(db: DbExecutor, id: string, name: string): Promise<void> {
  await db.update(accounts).set({ name }).where(eq(accounts.id, id));
}

export async function slugsLike(db: DbExecutor, base: string): Promise<Set<string>> {
  const rows = await db
    .select({ slug: accounts.slug })
    .from(accounts)
    .where(or(eq(accounts.slug, base), like(accounts.slug, `${base}-%`)));
  return new Set(rows.map((row) => row.slug));
}

export async function listAccounts(
  db: DbExecutor,
  filter: { all: true } | { ids: string[] },
): Promise<AccountRow[]> {
  const base = db.select().from(accounts);
  if ("all" in filter) return base.orderBy(asc(accounts.name));
  if (filter.ids.length === 0) return [];
  return base.where(inArray(accounts.id, filter.ids)).orderBy(asc(accounts.name));
}

export async function updateAccount(
  db: DbExecutor,
  id: string,
  patch: { name?: string; slug?: string },
) {
  const [row] = await db.update(accounts).set(patch).where(eq(accounts.id, id)).returning();
  return row ?? null;
}

export async function addAccountAdmin(db: DbExecutor, accountId: string, userId: string) {
  await db.insert(accountAdmins).values({ accountId, userId }).onConflictDoNothing();
}

/** Deletes the account's projects (their content cascades) and then the account itself. */
export async function deleteAccountCascade(db: DbExecutor, id: string): Promise<number> {
  const removed = await db
    .delete(projects)
    .where(eq(projects.accountId, id))
    .returning({ id: projects.id });
  await db.delete(accounts).where(eq(accounts.id, id));
  return removed.length;
}

export async function countProjects(db: DbExecutor, accountId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(eq(projects.accountId, accountId));
  return row?.count ?? 0;
}

export async function projectsOfAccounts(db: DbExecutor, accountIds: string[]) {
  if (accountIds.length === 0) return [];
  return db
    .select({
      id: projects.id,
      name: projects.name,
      key: projects.key,
      accountId: projects.accountId,
      projectType: projects.projectType,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .where(inArray(projects.accountId, accountIds))
    .orderBy(asc(projects.name));
}

export async function projectsByIds(db: DbExecutor, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select({
      id: projects.id,
      name: projects.name,
      key: projects.key,
      accountId: projects.accountId,
      projectType: projects.projectType,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .where(inArray(projects.id, ids))
    .orderBy(asc(projects.name));
}

export async function memberships(db: DbExecutor, userId: string) {
  return db
    .select({ projectId: projectMembers.projectId, role: projectMembers.role })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId));
}
