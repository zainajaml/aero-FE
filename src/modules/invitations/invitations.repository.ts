import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/client.js";
import {
  accountAdmins,
  invitations,
  profiles,
  projectMembers,
  projects,
  userRoles,
  users,
} from "../../database/schema/index.js";
import type { AppRole } from "../../database/schema/_shared.js";

export type InvitationRow = typeof invitations.$inferSelect;

/** A bound uuid[] literal (drizzle expands bare JS arrays into value lists, not arrays). */
const uuidArray = (ids: string[]) =>
  sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::uuid[]`;

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

export async function findById(db: DbExecutor, id: string): Promise<InvitationRow | null> {
  const [row] = await db.select().from(invitations).where(eq(invitations.id, id)).limit(1);
  return row ?? null;
}

export async function insertInvitation(
  db: DbExecutor,
  row: typeof invitations.$inferInsert,
): Promise<InvitationRow> {
  const [inserted] = await db.insert(invitations).values(row).returning();
  return inserted!;
}

/** Issues a new token and restarts the expiry window; only while still pending. */
export async function refreshToken(
  db: DbExecutor,
  id: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<InvitationRow | null> {
  const [row] = await db
    .update(invitations)
    .set({ tokenHash, expiresAt, createdAt: new Date() })
    .where(
      and(eq(invitations.id, id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)),
    )
    .returning();
  return row ?? null;
}

export async function revoke(db: DbExecutor, id: string): Promise<boolean> {
  const rows = await db
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(invitations.id, id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)),
    )
    .returning({ id: invitations.id });
  return rows.length > 0;
}

/** Pending (not accepted, not revoked) invitations for an email, newest first. */
export async function listPendingForEmail(db: DbExecutor, email: string): Promise<InvitationRow[]> {
  return db
    .select()
    .from(invitations)
    .where(
      and(
        sql`lower(${invitations.email}) = lower(${email})`,
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    )
    .orderBy(desc(invitations.createdAt));
}

/** Pending, unexpired invitations touching any of the projects (for seat counting). */
export async function listOpenForProjects(
  db: DbExecutor,
  projectIds: string[],
): Promise<InvitationRow[]> {
  if (projectIds.length === 0) return [];
  return db
    .select()
    .from(invitations)
    .where(
      and(
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        sql`${invitations.expiresAt} > now()`,
        or(
          inArray(invitations.projectId, projectIds),
          sql`${invitations.projectIds} && ${uuidArray(projectIds)}`,
        ),
      ),
    );
}

export async function projectsByIds(db: DbExecutor, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select({ id: projects.id, name: projects.name, accountId: projects.accountId })
    .from(projects)
    .where(inArray(projects.id, ids));
}

export async function findUserIdByEmail(db: DbExecutor, email: string): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);
  return row?.id ?? null;
}

export async function memberProjectIds(
  db: DbExecutor,
  userId: string,
  projectIds: string[],
): Promise<string[]> {
  if (projectIds.length === 0) return [];
  const rows = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(and(eq(projectMembers.userId, userId), inArray(projectMembers.projectId, projectIds)));
  return rows.map((row) => row.projectId);
}

export async function administeredAccountIds(
  db: DbExecutor,
  userId: string,
  accountIds: string[],
): Promise<string[]> {
  if (accountIds.length === 0) return [];
  const rows = await db
    .select({ accountId: accountAdmins.accountId })
    .from(accountAdmins)
    .where(and(eq(accountAdmins.userId, userId), inArray(accountAdmins.accountId, accountIds)));
  return rows.map((row) => row.accountId);
}

/** Active, non-super-admin members per project, excluding the caller (seat counting). */
export async function seatedMembers(db: DbExecutor, projectIds: string[], excludeUserId: string) {
  if (projectIds.length === 0) return [];
  return db
    .select({ projectId: projectMembers.projectId, userId: projectMembers.userId })
    .from(projectMembers)
    .innerJoin(profiles, eq(profiles.id, projectMembers.userId))
    .where(
      and(
        inArray(projectMembers.projectId, projectIds),
        sql`${projectMembers.userId} <> ${excludeUserId}`,
        isNull(profiles.archivedAt),
        sql`not exists (select 1 from ${userRoles} ur where ur.user_id = ${projectMembers.userId} and ur.role = 'super_admin')`,
      ),
    );
}

export async function profileName(db: DbExecutor, userId: string) {
  const [row] = await db
    .select({
      fullName: profiles.fullName,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return row ?? null;
}
