import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DbExecutor } from "../../database/client.js";
import {
  boardColumns,
  epics,
  ticketEpics,
  ticketEstimates,
  ticketStageHistory,
  tickets,
  workLogs,
} from "../../database/schema/index.js";
import type { TicketRow } from "./ticket-access.js";

// Correlated subqueries reference the outer row explicitly: inside a subquery drizzle would render
// ${tickets.id} as a bare "id", which binds to the inner table instead.
const outerTicketId = sql.raw(`"tickets"."id"`);
const loggedMinutes = sql<number>`coalesce((select sum(w.minutes)::int from ${workLogs} w where w.ticket_id = ${outerTicketId}), 0)`;
const epicIds = sql<
  string[]
>`coalesce((select array_agg(te.epic_id order by te.created_at) from ${ticketEpics} te where te.ticket_id = ${outerTicketId}), '{}')`;

const summaryColumns = {
  id: tickets.id,
  projectId: tickets.projectId,
  sprintId: tickets.sprintId,
  columnId: tickets.columnId,
  code: tickets.code,
  title: tickets.title,
  type: tickets.type,
  priority: tickets.priority,
  assigneeId: tickets.assigneeId,
  reporterId: tickets.reporterId,
  estimateMinutes: tickets.estimateMinutes,
  storyPoints: tickets.storyPoints,
  position: tickets.position,
  dueDate: tickets.dueDate,
  released: tickets.released,
  releasedAt: tickets.releasedAt,
  createdAt: tickets.createdAt,
  updatedAt: tickets.updatedAt,
  loggedMinutes,
  epicIds,
};

export type TicketSummaryRow = Awaited<ReturnType<typeof listProjectTickets>>[number];

export function listProjectTickets(db: DbExecutor, projectId: string) {
  return db
    .select(summaryColumns)
    .from(tickets)
    .where(eq(tickets.projectId, projectId))
    .orderBy(desc(tickets.createdAt));
}

export async function findTicketDetail(db: DbExecutor, ticketId: string) {
  const [row] = await db
    .select({ ...summaryColumns, descriptionJson: tickets.descriptionJson })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  return row ?? null;
}

export async function findTicketsInProject(db: DbExecutor, projectId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select({
      id: tickets.id,
      sprintId: tickets.sprintId,
      columnId: tickets.columnId,
      title: tickets.title,
      loggedMinutes,
    })
    .from(tickets)
    .where(and(eq(tickets.projectId, projectId), inArray(tickets.id, ids)));
}

/** Serializes code allocation per project for the rest of the transaction. */
export async function lockProjectTicketCodes(db: DbExecutor, projectId: string) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`ticket-code:${projectId}`}))`);
}

export async function nextCodeNumber(db: DbExecutor, projectId: string): Promise<number> {
  const [row] = await db
    .select({
      max: sql<number>`coalesce(max((regexp_match(${tickets.code}, '(\\d+)$'))[1]::int), 0)`,
    })
    .from(tickets)
    .where(eq(tickets.projectId, projectId));
  return (row?.max ?? 0) + 1;
}

/** Bottom of the sprint (or backlog) for user-sorted order. */
export async function bottomPosition(
  db: DbExecutor,
  projectId: string,
  sprintId: string | null,
): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${tickets.position})` })
    .from(tickets)
    .where(
      and(
        eq(tickets.projectId, projectId),
        sprintId ? eq(tickets.sprintId, sprintId) : isNull(tickets.sprintId),
      ),
    );
  return Number(row?.max ?? 0) + 1;
}

export async function insertTicket(
  db: DbExecutor,
  row: typeof tickets.$inferInsert,
): Promise<TicketRow> {
  const [inserted] = await db.insert(tickets).values(row).returning();
  return inserted!;
}

export async function updateTicket(
  db: DbExecutor,
  ticketId: string,
  patch: Partial<typeof tickets.$inferInsert>,
): Promise<TicketRow> {
  const [row] = await db.update(tickets).set(patch).where(eq(tickets.id, ticketId)).returning();
  return row!;
}

export async function updateTickets(
  db: DbExecutor,
  ticketIds: string[],
  patch: Partial<typeof tickets.$inferInsert>,
) {
  if (ticketIds.length === 0) return;
  await db.update(tickets).set(patch).where(inArray(tickets.id, ticketIds));
}

export async function deleteTickets(db: DbExecutor, ticketIds: string[]) {
  if (ticketIds.length === 0) return;
  await db.delete(tickets).where(inArray(tickets.id, ticketIds));
}

export async function findColumnsInProject(db: DbExecutor, projectId: string) {
  return db
    .select()
    .from(boardColumns)
    .where(eq(boardColumns.projectId, projectId))
    .orderBy(asc(boardColumns.orderIndex));
}

export async function insertStageHistory(
  db: DbExecutor,
  rows: {
    ticketId: string;
    projectId: string;
    columnId: string;
    columnName: string;
    movedBy: string;
  }[],
) {
  if (rows.length === 0) return;
  await db.insert(ticketStageHistory).values(rows);
}

export async function epicIdsInProject(
  db: DbExecutor,
  projectId: string,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: epics.id })
    .from(epics)
    .where(and(eq(epics.projectId, projectId), inArray(epics.id, ids)));
  return rows.map((row) => row.id);
}

export async function replaceTicketEpics(
  db: DbExecutor,
  ticketId: string,
  epicIdsToKeep: string[],
) {
  await db.delete(ticketEpics).where(eq(ticketEpics.ticketId, ticketId));
  if (epicIdsToKeep.length > 0)
    await db.insert(ticketEpics).values(epicIdsToKeep.map((epicId) => ({ ticketId, epicId })));
}

export async function addTicketEpics(db: DbExecutor, ticketIds: string[], epicIdsToAdd: string[]) {
  const rows = ticketIds.flatMap((ticketId) =>
    epicIdsToAdd.map((epicId) => ({ ticketId, epicId })),
  );
  if (rows.length > 0) await db.insert(ticketEpics).values(rows).onConflictDoNothing();
}

export async function insertEstimates(
  db: DbExecutor,
  rows: (typeof ticketEstimates.$inferInsert)[],
) {
  if (rows.length > 0) await db.insert(ticketEstimates).values(rows);
}

/** Keeps tickets.estimate_minutes equal to the sum of its estimate rows. */
export async function syncEstimateTotal(db: DbExecutor, ticketId: string) {
  await db
    .update(tickets)
    .set({
      estimateMinutes: sql`coalesce((select sum(e.minutes)::int from ${ticketEstimates} e where e.ticket_id = ${ticketId}), 0)`,
    })
    .where(eq(tickets.id, ticketId));
}

export function listProjectEstimates(db: DbExecutor, projectId: string) {
  return db
    .select({
      ticketId: ticketEstimates.ticketId,
      resourceType: ticketEstimates.resourceType,
      minutes: ticketEstimates.minutes,
    })
    .from(ticketEstimates)
    .innerJoin(tickets, eq(tickets.id, ticketEstimates.ticketId))
    .where(eq(tickets.projectId, projectId));
}

export function listProjectStageHistory(db: DbExecutor, projectId: string) {
  return db
    .select()
    .from(ticketStageHistory)
    .where(eq(ticketStageHistory.projectId, projectId))
    .orderBy(asc(ticketStageHistory.enteredAt));
}

export async function zoneNeighbourPositions(
  db: DbExecutor,
  projectId: string,
  ids: (string | null | undefined)[],
) {
  const wanted = ids.filter((id): id is string => Boolean(id));
  if (wanted.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ id: tickets.id, position: tickets.position })
    .from(tickets)
    .where(and(eq(tickets.projectId, projectId), inArray(tickets.id, wanted)));
  return new Map(rows.map((row) => [row.id, Number(row.position)]));
}
