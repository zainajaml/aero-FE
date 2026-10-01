import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/client.js";
import {
  profiles,
  supportIssues,
  supportMessages,
  userRoles,
  users,
} from "../../database/schema/index.js";

export type IssueRow = typeof supportIssues.$inferSelect;
export type MessageRow = typeof supportMessages.$inferSelect;

const issueColumns = {
  id: supportIssues.id,
  userId: supportIssues.userId,
  subject: supportIssues.subject,
  status: supportIssues.status,
  ticketNumber: supportIssues.ticketNumber,
  createdAt: supportIssues.createdAt,
  updatedAt: supportIssues.updatedAt,
  ownerFullName: profiles.fullName,
  ownerFirstName: profiles.firstName,
  ownerLastName: profiles.lastName,
  ownerEmail: profiles.email,
  ownerAvatarUrl: profiles.avatarUrl,
};

export function listIssues(
  db: DbExecutor,
  filter: { ownerId?: string; status?: string; ascending: boolean },
) {
  const conditions = [];
  if (filter.ownerId) conditions.push(eq(supportIssues.userId, filter.ownerId));
  if (filter.status) conditions.push(eq(supportIssues.status, filter.status));
  return db
    .select(issueColumns)
    .from(supportIssues)
    .leftJoin(profiles, eq(profiles.id, supportIssues.userId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(filter.ascending ? asc(supportIssues.createdAt) : desc(supportIssues.createdAt));
}

export async function findIssueView(db: DbExecutor, id: string) {
  const [row] = await db
    .select(issueColumns)
    .from(supportIssues)
    .leftJoin(profiles, eq(profiles.id, supportIssues.userId))
    .where(eq(supportIssues.id, id))
    .limit(1);
  return row ?? null;
}

export async function countOpen(db: DbExecutor, ownerId?: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(supportIssues)
    .where(
      and(
        eq(supportIssues.status, "open"),
        ownerId ? eq(supportIssues.userId, ownerId) : undefined,
      ),
    );
  return row?.n ?? 0;
}

export async function findIssue(db: DbExecutor, id: string): Promise<IssueRow | null> {
  const [row] = await db.select().from(supportIssues).where(eq(supportIssues.id, id)).limit(1);
  return row ?? null;
}

export async function insertIssue(
  db: DbExecutor,
  userId: string,
  subject: string,
): Promise<IssueRow> {
  const [row] = await db.insert(supportIssues).values({ userId, subject }).returning();
  return row!;
}

export async function setIssueStatus(
  db: DbExecutor,
  id: string,
  status: string,
): Promise<IssueRow> {
  const [row] = await db
    .update(supportIssues)
    .set({ status })
    .where(eq(supportIssues.id, id))
    .returning();
  return row!;
}

/** Marks activity on the issue (updated_at via trigger). */
export async function touchIssue(db: DbExecutor, id: string) {
  await db.update(supportIssues).set({ updatedAt: new Date() }).where(eq(supportIssues.id, id));
}

export async function deleteIssue(db: DbExecutor, id: string) {
  await db.delete(supportIssues).where(eq(supportIssues.id, id));
}

export function listMessages(db: DbExecutor, issueId: string) {
  return db
    .select({
      message: supportMessages,
      fullName: profiles.fullName,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
      avatarUrl: profiles.avatarUrl,
    })
    .from(supportMessages)
    .leftJoin(profiles, eq(profiles.id, supportMessages.authorId))
    .where(eq(supportMessages.issueId, issueId))
    .orderBy(asc(supportMessages.createdAt));
}

export async function findMessage(
  db: DbExecutor,
  issueId: string,
  messageId: string,
): Promise<MessageRow | null> {
  const [row] = await db
    .select()
    .from(supportMessages)
    .where(and(eq(supportMessages.id, messageId), eq(supportMessages.issueId, issueId)))
    .limit(1);
  return row ?? null;
}

export async function insertMessage(
  db: DbExecutor,
  row: typeof supportMessages.$inferInsert,
): Promise<MessageRow> {
  const [inserted] = await db.insert(supportMessages).values(row).returning();
  return inserted!;
}

export async function updateMessageBody(
  db: DbExecutor,
  id: string,
  body: string,
): Promise<MessageRow> {
  const [row] = await db
    .update(supportMessages)
    .set({ body, editedAt: new Date() })
    .where(eq(supportMessages.id, id))
    .returning();
  return row!;
}

export async function attachmentKeys(db: DbExecutor, issueId: string): Promise<string[]> {
  const rows = await db
    .select({ key: supportMessages.imagePath })
    .from(supportMessages)
    .where(
      and(eq(supportMessages.issueId, issueId), sql`${supportMessages.imagePath} is not null`),
    );
  return rows.map((row) => row.key!);
}

/** Super admins (not archived) who receive support alerts. */
export function superAdmins(db: DbExecutor) {
  return db
    .select({ id: users.id, email: users.email })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .innerJoin(profiles, eq(profiles.id, userRoles.userId))
    .where(and(eq(userRoles.role, "super_admin"), sql`${profiles.archivedAt} is null`));
}
