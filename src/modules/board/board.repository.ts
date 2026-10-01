import { and, asc, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/client.js";
import { boardColumns } from "../../database/schema/index.js";

export type ColumnRow = typeof boardColumns.$inferSelect;

export const listColumns = (db: DbExecutor, projectId: string) =>
  db
    .select()
    .from(boardColumns)
    .where(eq(boardColumns.projectId, projectId))
    .orderBy(asc(boardColumns.orderIndex), asc(boardColumns.createdAt));

export async function findColumn(
  db: DbExecutor,
  projectId: string,
  columnId: string,
): Promise<ColumnRow | null> {
  const [row] = await db
    .select()
    .from(boardColumns)
    .where(and(eq(boardColumns.id, columnId), eq(boardColumns.projectId, projectId)))
    .limit(1);
  return row ?? null;
}

export async function insertColumn(
  db: DbExecutor,
  projectId: string,
  name: string,
): Promise<ColumnRow> {
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(boardColumns)
    .where(eq(boardColumns.projectId, projectId));
  const [row] = await db
    .insert(boardColumns)
    .values({ projectId, name, orderIndex: count?.n ?? 0, isDone: false })
    .returning();
  return row!;
}

export async function updateColumn(
  db: DbExecutor,
  columnId: string,
  patch: Partial<Pick<ColumnRow, "name" | "isDone" | "orderIndex">>,
) {
  const [row] = await db
    .update(boardColumns)
    .set(patch)
    .where(eq(boardColumns.id, columnId))
    .returning();
  return row!;
}

export async function deleteColumn(db: DbExecutor, columnId: string) {
  await db.delete(boardColumns).where(eq(boardColumns.id, columnId));
}
