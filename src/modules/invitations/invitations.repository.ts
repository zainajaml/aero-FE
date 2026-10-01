import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/client.js";
import {
  accountAdmins,
  invitations,
  projectMembers,
  projects,
  userRoles,
} from "../../database/schema/index.js";
import type { AppRole } from "../../database/schema/_shared.js";

export type InvitationRow = typeof invitations.$inferSelect;

export async function findByTokenHash(
  db: DbExecutor,
  tokenHash: string,
): Promise<InvitationRow | null> {
  const [row] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.tokenHash, tokenHash))
    .limit(1);
  return row ?? null;
}

/** Latest open (not accepted, not revoked, not expired) invitation for an email. */
export async function findLatestOpenForEmail(
  db: DbExecutor,
  email: string,
): Promise<InvitationRow | null> {
  const [row] = await db
    .select()
    .from(invitations)
    .where(
      and(
        sql`lower(${invitations.email}) = lower(${email})`,
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        sql`${invitations.expiresAt} > now()`,
      ),
    )
    .orderBy(desc(invitations.createdAt))
    .limit(1);
  return row ?? null;
}

export async function listRoles(db: DbExecutor, userId: string): Promise<AppRole[]> {
  const rows = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, userId));
  return rows.map((row) => row.role);
}

export async function addRole(db: DbExecutor, userId: string, role: AppRole): Promise<void> {
  await db.insert(userRoles).values({ userId, role }).onConflictDoNothing();
}

export async function accountIdsOfProjects(
  db: DbExecutor,
  projectIds: string[],
): Promise<string[]> {
  if (projectIds.length === 0) return [];
  const rows = await db
    .selectDistinct({ accountId: projects.accountId })
    .from(projects)
    .where(inArray(projects.id, projectIds));
  return rows.map((row) => row.accountId);
}

export async function addAccountAdmins(
  db: DbExecutor,
  userId: string,
  accountIds: string[],
): Promise<void> {
  if (accountIds.length === 0) return;
  await db
    .insert(accountAdmins)
    .values(accountIds.map((accountId) => ({ accountId, userId })))
    .onConflictDoNothing();
}

export async function upsertProjectMemberships(
  db: DbExecutor,
  userId: string,
  projectIds: string[],
  role: AppRole,
): Promise<void> {
  if (projectIds.length === 0) return;
  await db
    .insert(projectMembers)
    .values(projectIds.map((projectId) => ({ projectId, userId, role })))
    .onConflictDoUpdate({
      target: [projectMembers.projectId, projectMembers.userId],
      set: { role },
    });
}

/** Marks one invitation accepted; a concurrent accept leaves it untouched and returns false. */
export async function markAccepted(db: DbExecutor, invitationId: string): Promise<boolean> {
  const rows = await db
    .update(invitations)
    .set({ acceptedAt: new Date() })
    .where(and(eq(invitations.id, invitationId), isNull(invitations.acceptedAt)))
    .returning({ id: invitations.id });
  return rows.length > 0;
}
