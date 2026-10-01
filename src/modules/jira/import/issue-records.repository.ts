import { and, asc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import type { DbExecutor } from "../../../database/client.js";
import {
  attachments,
  comments,
  epics,
  ticketEpics,
  tickets,
  workLogs,
} from "../../../database/schema/index.js";

export async function maxTicketPosition(db: DbExecutor, projectId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<string | number | null>`max(${tickets.position})` })
    .from(tickets)
    .where(eq(tickets.projectId, projectId));
  return Number(row?.max ?? 0);
}

export async function ticketsByJiraIds(db: DbExecutor, projectId: string, issueIds: string[]) {
  if (issueIds.length === 0) return [];
  return db
    .select({ id: tickets.id, jiraIssueId: tickets.jiraIssueId })
    .from(tickets)
    .where(and(eq(tickets.projectId, projectId), inArray(tickets.jiraIssueId, issueIds)));
}

export type TicketFields = Omit<typeof tickets.$inferInsert, "id" | "code" | "position">;

/** Inserts unless any unique key (code or Jira reference) is taken; returns the new id or null. */
export async function tryInsertTicket(
  db: DbExecutor,
  values: TicketFields & { code: string; position: number },
): Promise<string | null> {
  const [row] = await db
    .insert(tickets)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: tickets.id });
  return row?.id ?? null;
}

export async function updateTicket(db: DbExecutor, id: string, values: TicketFields) {
  await db.update(tickets).set(values).where(eq(tickets.id, id));
}

export async function setAssignee(
  db: DbExecutor,
  projectId: string,
  ticketIds: string[],
  userId: string,
): Promise<void> {
  if (ticketIds.length === 0) return;
  await db
    .update(tickets)
    .set({ assigneeId: userId })
    .where(and(eq(tickets.projectId, projectId), inArray(tickets.id, ticketIds)));
}

/** Imported tickets of a project in id order, for paged attribution repair. */
export async function jiraTicketsPage(
  db: DbExecutor,
  projectId: string,
  afterTicketId: string | null,
  limit: number,
) {
  return db
    .select({ id: tickets.id, jiraIssueKey: tickets.jiraIssueKey })
    .from(tickets)
    .where(
      and(
        eq(tickets.projectId, projectId),
        isNotNull(tickets.jiraIssueKey),
        ...(afterTicketId ? [gt(tickets.id, afterTicketId)] : []),
      ),
    )
    .orderBy(asc(tickets.id))
    .limit(limit);
}

export async function jiraEpics(db: DbExecutor, projectId: string) {
  return db
    .select({ id: epics.id, jiraIssueKey: epics.jiraIssueKey })
    .from(epics)
    .where(and(eq(epics.projectId, projectId), isNotNull(epics.jiraIssueKey)));
}

/** Creates the epic for a Jira epic key (or finds it); null when its name is already taken. */
export async function ensureEpic(
  db: DbExecutor,
  values: { projectId: string; jiraIssueKey: string; name: string; createdBy: string },
): Promise<string | null> {
  const [inserted] = await db
    .insert(epics)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: epics.id });
  if (inserted) return inserted.id;
  const [existing] = await db
    .select({ id: epics.id })
    .from(epics)
    .where(and(eq(epics.projectId, values.projectId), eq(epics.jiraIssueKey, values.jiraIssueKey)));
  return existing?.id ?? null;
}

export async function linkEpic(db: DbExecutor, ticketId: string, epicId: string): Promise<void> {
  await db.insert(ticketEpics).values({ ticketId, epicId }).onConflictDoNothing();
}

export async function jiraComments(db: DbExecutor, ticketIds: string[]) {
  if (ticketIds.length === 0) return [];
  return db
    .select({
      id: comments.id,
      ticketId: comments.ticketId,
      authorId: comments.authorId,
      body: comments.body,
      jiraCommentId: comments.jiraCommentId,
    })
    .from(comments)
    .where(and(inArray(comments.ticketId, ticketIds), isNotNull(comments.jiraCommentId)));
}

export async function jiraWorklogs(db: DbExecutor, ticketIds: string[]) {
  if (ticketIds.length === 0) return [];
  return db
    .select({
      id: workLogs.id,
      ticketId: workLogs.ticketId,
      userId: workLogs.userId,
      note: workLogs.note,
      jiraWorklogId: workLogs.jiraWorklogId,
    })
    .from(workLogs)
    .where(and(inArray(workLogs.ticketId, ticketIds), isNotNull(workLogs.jiraWorklogId)));
}

export async function jiraAttachments(db: DbExecutor, ticketIds: string[]) {
  if (ticketIds.length === 0) return [];
  return db
    .select({ ticketId: attachments.ticketId, jiraAttachmentId: attachments.jiraAttachmentId })
    .from(attachments)
    .where(and(inArray(attachments.ticketId, ticketIds), isNotNull(attachments.jiraAttachmentId)));
}

/** Returns true when inserted (false when this Jira comment is already on the ticket). */
export async function insertComment(
  db: DbExecutor,
  values: typeof comments.$inferInsert,
): Promise<boolean> {
  const rows = await db
    .insert(comments)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: comments.id });
  return rows.length > 0;
}

export async function updateComment(
  db: DbExecutor,
  id: string,
  patch: { body?: string; authorId?: string },
) {
  await db.update(comments).set(patch).where(eq(comments.id, id));
}

export async function insertWorklog(
  db: DbExecutor,
  values: typeof workLogs.$inferInsert,
): Promise<boolean> {
  const rows = await db
    .insert(workLogs)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: workLogs.id });
  return rows.length > 0;
}

export async function updateWorklog(
  db: DbExecutor,
  id: string,
  patch: { note?: string; userId?: string },
) {
  await db.update(workLogs).set(patch).where(eq(workLogs.id, id));
}

export async function insertAttachment(
  db: DbExecutor,
  values: typeof attachments.$inferInsert,
): Promise<boolean> {
  const rows = await db
    .insert(attachments)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: attachments.id });
  return rows.length > 0;
}

/** Moves everything a placeholder identity holds in one project onto the real person. */
export async function reassignPlaceholder(
  db: DbExecutor,
  projectId: string,
  placeholderId: string,
  userId: string,
): Promise<void> {
  const projectTickets = db
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.projectId, projectId));
  await db
    .update(comments)
    .set({ authorId: userId })
    .where(and(eq(comments.authorId, placeholderId), inArray(comments.ticketId, projectTickets)));
  await db
    .update(workLogs)
    .set({ userId })
    .where(and(eq(workLogs.userId, placeholderId), inArray(workLogs.ticketId, projectTickets)));
}
