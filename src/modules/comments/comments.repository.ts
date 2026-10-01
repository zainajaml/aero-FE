import { asc, eq } from "drizzle-orm";
import type { DbExecutor } from "../../database/client.js";
import { comments } from "../../database/schema/index.js";

export type CommentRow = typeof comments.$inferSelect;

export async function findComment(db: DbExecutor, commentId: string): Promise<CommentRow | null> {
  const [row] = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
  return row ?? null;
}

export const listForTicket = (db: DbExecutor, ticketId: string) =>
  db
    .select()
    .from(comments)
    .where(eq(comments.ticketId, ticketId))
    .orderBy(asc(comments.createdAt));

export async function insert(
  db: DbExecutor,
  row: typeof comments.$inferInsert,
): Promise<CommentRow> {
  const [inserted] = await db.insert(comments).values(row).returning();
  return inserted!;
}

export async function updateBody(
  db: DbExecutor,
  commentId: string,
  body: string,
): Promise<CommentRow> {
  const [row] = await db
    .update(comments)
    .set({ body })
    .where(eq(comments.id, commentId))
    .returning();
  return row!;
}

export async function remove(db: DbExecutor, commentId: string) {
  await db.delete(comments).where(eq(comments.id, commentId));
}
