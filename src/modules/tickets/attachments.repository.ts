import { and, desc, eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "../../database/client.js";
import { attachments } from "../../database/schema/index.js";

export type AttachmentRow = typeof attachments.$inferSelect;

export async function attachmentKeysForTickets(
  db: DbExecutor,
  ticketIds: string[],
): Promise<string[]> {
  if (ticketIds.length === 0) return [];
  const rows = await db
    .select({ key: attachments.storagePath })
    .from(attachments)
    .where(inArray(attachments.ticketId, ticketIds));
  return rows.map((row) => row.key);
}

export async function attachmentKeysForComment(
  db: DbExecutor,
  commentId: string,
): Promise<string[]> {
  const rows = await db
    .select({ key: attachments.storagePath })
    .from(attachments)
    .where(eq(attachments.commentId, commentId));
  return rows.map((row) => row.key);
}

export const listForTicket = (db: DbExecutor, ticketId: string) =>
  db
    .select()
    .from(attachments)
    .where(eq(attachments.ticketId, ticketId))
    .orderBy(desc(attachments.createdAt));

export async function findForTicket(
  db: DbExecutor,
  ticketId: string,
  attachmentId: string,
): Promise<AttachmentRow | null> {
  const [row] = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, attachmentId), eq(attachments.ticketId, ticketId)))
    .limit(1);
  return row ?? null;
}

export async function insert(
  db: DbExecutor,
  row: typeof attachments.$inferInsert,
): Promise<AttachmentRow> {
  const [inserted] = await db.insert(attachments).values(row).returning();
  return inserted!;
}

export async function remove(db: DbExecutor, attachmentId: string) {
  await db.delete(attachments).where(eq(attachments.id, attachmentId));
}
