import { and, asc, eq, inArray, min, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/client.js";
import { boardColumns, sprints, tickets } from "../../database/schema/index.js";

export type SprintRow = typeof sprints.$inferSelect;

export const listSprints = (db: DbExecutor, projectId: string) =>
  db
    .select()
    .from(sprints)
    .where(eq(sprints.projectId, projectId))
    .orderBy(asc(sprints.position), asc(sprints.createdAt));

export async function findSprint(
  db: DbExecutor,
  projectId: string,
  sprintId: string,
): Promise<SprintRow | null> {
  const [row] = await db
    .select()
    .from(sprints)
    .where(and(eq(sprints.id, sprintId), eq(sprints.projectId, projectId)))
    .limit(1);
  return row ?? null;
}

export async function lockSprint(db: DbExecutor, sprintId: string): Promise<SprintRow | null> {
  const [row] = await db
    .select()
    .from(sprints)
    .where(eq(sprints.id, sprintId))
    .for("update")
    .limit(1);
  return row ?? null;
}

export async function minPosition(db: DbExecutor, projectId: string): Promise<number | null> {
  const [row] = await db
    .select({ value: min(sprints.position) })
    .from(sprints)
    .where(eq(sprints.projectId, projectId));
  return row?.value ?? null;
}

export async function insertSprint(
  db: DbExecutor,
  row: typeof sprints.$inferInsert,
): Promise<SprintRow> {
  const [inserted] = await db.insert(sprints).values(row).returning();
  return inserted!;
}

export async function updateSprint(
  db: DbExecutor,
  sprintId: string,
  patch: Partial<typeof sprints.$inferInsert>,
): Promise<SprintRow> {
  const [row] = await db.update(sprints).set(patch).where(eq(sprints.id, sprintId)).returning();
  return row!;
}

export async function deleteSprint(db: DbExecutor, sprintId: string) {
  await db.delete(sprints).where(eq(sprints.id, sprintId));
}

/** Tickets of the sprint whose column is not a done column (null column counts as open). */
export async function openTicketIds(db: DbExecutor, sprintId: string): Promise<string[]> {
  const rows = await db
    .select({ id: tickets.id })
    .from(tickets)
    .leftJoin(boardColumns, eq(boardColumns.id, tickets.columnId))
    .where(
      and(
        eq(tickets.sprintId, sprintId),
        sql`not coalesce(${boardColumns.isDone} or lower(trim(${boardColumns.name})) in ('done', 'complete', 'completed'), false)`,
      ),
    );
  return rows.map((row) => row.id);
}

export async function moveTicketsToSprint(
  db: DbExecutor,
  ticketIds: string[],
  sprintId: string | null,
) {
  if (ticketIds.length === 0) return;
  await db.update(tickets).set({ sprintId }).where(inArray(tickets.id, ticketIds));
}

export async function detachTickets(db: DbExecutor, sprintId: string) {
  await db.update(tickets).set({ sprintId: null }).where(eq(tickets.sprintId, sprintId));
}
