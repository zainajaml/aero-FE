import { and, eq, ne } from "drizzle-orm";
import type { DbExecutor } from "../../database/client.js";
import { accountAdmins, projectMembers, userRoles } from "../../database/schema/index.js";

export async function firstAdministeredAccountId(
  db: DbExecutor,
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ accountId: accountAdmins.accountId })
    .from(accountAdmins)
    .where(eq(accountAdmins.userId, userId))
    .limit(1);
  return row?.accountId ?? null;
}

export async function isAccountAdminOf(
  db: DbExecutor,
  userId: string,
  accountId: string,
): Promise<boolean> {
  const rows = await db
    .select({ accountId: accountAdmins.accountId })
    .from(accountAdmins)
    .where(and(eq(accountAdmins.userId, userId), eq(accountAdmins.accountId, accountId)))
    .limit(1);
  return rows.length > 0;
}

export async function hasProjectMembership(db: DbExecutor, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId))
    .limit(1);
  return rows.length > 0;
}

/** The workspace creator becomes its account admin; any other leftover role is removed. */
export async function makeSoleAccountAdmin(
  db: DbExecutor,
  userId: string,
  accountId: string,
): Promise<void> {
  await db.insert(accountAdmins).values({ accountId, userId }).onConflictDoNothing();
  await db
    .delete(userRoles)
    .where(and(eq(userRoles.userId, userId), ne(userRoles.role, "account_admin")));
  await db.insert(userRoles).values({ userId, role: "account_admin" }).onConflictDoNothing();
}
