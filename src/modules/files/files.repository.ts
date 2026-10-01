import { and, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/client.js";
import {
  attachments,
  documents,
  supportIssues,
  supportMessages,
  tickets,
} from "../../database/schema/index.js";

export async function projectOfAttachmentKey(db: DbExecutor, key: string): Promise<string | null> {
  const [row] = await db
    .select({ projectId: tickets.projectId })
    .from(attachments)
    .innerJoin(tickets, eq(tickets.id, attachments.ticketId))
    .where(eq(attachments.storagePath, key))
    .limit(1);
  return row?.projectId ?? null;
}

/** Projects whose documents reference this stored file. */
export async function projectsReferencingDocumentFile(
  db: DbExecutor,
  key: string,
): Promise<string[]> {
  const rows = await db
    .select({ projectId: documents.projectId })
    .from(documents)
    .where(eq(documents.filePath, key));
  return rows.map((row) => row.projectId);
}

export async function isSupportIssueOwner(
  db: DbExecutor,
  issueId: string,
  userId: string,
): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(issueId)) return false;
  const rows = await db
    .select({ id: supportIssues.id })
    .from(supportIssues)
    .where(and(eq(supportIssues.id, issueId), eq(supportIssues.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

/** Inline images posted in a support thread are readable by the ticket owner (the source hid them). */
export async function referencedInOwnSupportThread(
  db: DbExecutor,
  key: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: supportMessages.id })
    .from(supportMessages)
    .innerJoin(supportIssues, eq(supportIssues.id, supportMessages.issueId))
    .where(
      and(
        eq(supportIssues.userId, userId),
        sql`strpos(${supportMessages.body}, ${`doc-image://${key}`}) > 0`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}
