import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { DbExecutor } from "../../database/client.js";
import { profiles, projects, ticketEpics, tickets, workLogs } from "../../database/schema/index.js";

// Read queries behind the MCP tools. Every function takes the set of project ids the caller may
// read (resolved by the access module), so the queries can only narrow, never widen, visibility.

export type ProjectSummaryRow = {
  id: string;
  name: string;
  key: string;
  account_id: string;
  description: string | null;
};

const projectColumns = {
  id: projects.id,
  name: projects.name,
  key: projects.key,
  account_id: projects.accountId,
  description: projects.description,
};

/** `%text%` for ILIKE, with the same character stripping as the source PostgREST filter. */
function containsPattern(text: string): string | null {
  const needle = text.trim().replace(/[%,()]/g, " ");
  return needle ? `%${needle}%` : null;
}

function projectFilter(
  visibleIds: string[],
  filters: { accountId?: string | undefined; query?: string | undefined },
): SQL | undefined {
  // Archived projects are read-only and hidden from the app, so the connector never offers them.
  const conditions: (SQL | undefined)[] = [
    inArray(projects.id, visibleIds),
    isNull(projects.archivedAt),
  ];
  if (filters.accountId) conditions.push(eq(projects.accountId, filters.accountId));
  const pattern = filters.query ? containsPattern(filters.query) : null;
  if (pattern) conditions.push(or(ilike(projects.name, pattern), ilike(projects.key, pattern)));
  return and(...conditions);
}

export async function listProjects(
  db: DbExecutor,
  visibleIds: string[],
  filters: { accountId?: string | undefined; query?: string | undefined } = {},
): Promise<ProjectSummaryRow[]> {
  if (visibleIds.length === 0) return [];
  return db
    .select(projectColumns)
    .from(projects)
    .where(projectFilter(visibleIds, filters))
    .orderBy(asc(projects.name));
}

export async function listProjectsPage(
  db: DbExecutor,
  visibleIds: string[],
  filters: { accountId?: string | undefined; query?: string | undefined },
  page: { limit: number; offset: number },
): Promise<{ rows: ProjectSummaryRow[]; total: number }> {
  if (visibleIds.length === 0) return { rows: [], total: 0 };
  const where = projectFilter(visibleIds, filters);
  const [rows, [totalRow]] = await Promise.all([
    db
      .select(projectColumns)
      .from(projects)
      .where(where)
      .orderBy(asc(projects.name), asc(projects.id))
      .limit(page.limit)
      .offset(page.offset),
    db.select({ total: count() }).from(projects).where(where),
  ]);
  return { rows, total: totalRow?.total ?? rows.length };
}

export type TicketRow = {
  id: string;
  code: string;
  title: string;
  descriptionJson: unknown;
  type: string;
  priority: string;
  projectId: string;
  columnId: string | null;
  sprintId: string | null;
  assigneeId: string | null;
  reporterId: string | null;
  estimateMinutes: number;
  storyPoints: number | null;
  dueDate: string | null;
  released: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const ticketColumns = {
  id: tickets.id,
  code: tickets.code,
  title: tickets.title,
  descriptionJson: tickets.descriptionJson,
  type: tickets.type,
  priority: tickets.priority,
  projectId: tickets.projectId,
  columnId: tickets.columnId,
  sprintId: tickets.sprintId,
  assigneeId: tickets.assigneeId,
  reporterId: tickets.reporterId,
  estimateMinutes: tickets.estimateMinutes,
  storyPoints: tickets.storyPoints,
  dueDate: tickets.dueDate,
  released: tickets.released,
  createdAt: tickets.createdAt,
  updatedAt: tickets.updatedAt,
};

export type TicketQuery = {
  projectIds: string[];
  priority?: string | undefined;
  type?: string | undefined;
  released?: boolean | undefined;
  columnIds?: string[] | null;
  sprintId?: string | null;
  /** A user id, or "unassigned" for tickets without an assignee. */
  assignee?: string | null;
  epicId?: string | null;
  overdueBefore?: string | null;
  dueBefore?: string | undefined;
  dueAfter?: string | undefined;
  query?: string | undefined;
  /** Done column ids to exclude (tickets without a column are never done). */
  excludeColumnIds?: string[] | null;
  limit: number;
  offset: number;
};

/** One page of tickets, every filter applied by the database before the page window. */
export async function queryTickets(
  db: DbExecutor,
  q: TicketQuery,
): Promise<{ rows: TicketRow[]; total: number }> {
  if (q.projectIds.length === 0) return { rows: [], total: 0 };
  const conditions: (SQL | undefined)[] = [inArray(tickets.projectId, q.projectIds)];
  if (q.priority) conditions.push(eq(tickets.priority, q.priority));
  if (q.type) conditions.push(eq(tickets.type, q.type));
  if (typeof q.released === "boolean") conditions.push(eq(tickets.released, q.released));
  if (q.columnIds) conditions.push(inArray(tickets.columnId, q.columnIds));
  if (q.sprintId) conditions.push(eq(tickets.sprintId, q.sprintId));
  if (q.assignee === "unassigned") conditions.push(isNull(tickets.assigneeId));
  else if (q.assignee) conditions.push(eq(tickets.assigneeId, q.assignee));
  if (q.epicId) {
    conditions.push(
      sql`exists (select 1 from ${ticketEpics} te where te.ticket_id = ${tickets.id} and te.epic_id = ${q.epicId})`,
    );
  }
  if (q.overdueBefore) conditions.push(lt(tickets.dueDate, q.overdueBefore));
  if (q.dueBefore) conditions.push(lte(tickets.dueDate, q.dueBefore));
  if (q.dueAfter) conditions.push(gte(tickets.dueDate, q.dueAfter));
  const pattern = q.query ? containsPattern(q.query) : null;
  if (pattern) conditions.push(or(ilike(tickets.title, pattern), ilike(tickets.code, pattern)));
  if (q.excludeColumnIds && q.excludeColumnIds.length > 0) {
    conditions.push(
      or(
        isNull(tickets.columnId),
        sql`${tickets.columnId} not in (${sql.join(
          q.excludeColumnIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      ),
    );
  }
  const where = and(...conditions);
  const [rows, [totalRow]] = await Promise.all([
    db
      .select(ticketColumns)
      .from(tickets)
      .where(where)
      .orderBy(desc(tickets.createdAt), desc(tickets.id))
      .limit(q.limit)
      .offset(q.offset),
    db.select({ total: count() }).from(tickets).where(where),
  ]);
  return { rows, total: totalRow?.total ?? rows.length };
}

/** A ticket by id or (case-insensitive) code, only within the given projects. */
export async function findTicket(
  db: DbExecutor,
  projectIds: string[],
  ref: { id: string } | { code: string },
): Promise<TicketRow | null> {
  if (projectIds.length === 0) return null;
  const match =
    "id" in ref ? eq(tickets.id, ref.id) : sql`lower(${tickets.code}) = lower(${ref.code})`;
  const [row] = await db
    .select(ticketColumns)
    .from(tickets)
    .where(and(inArray(tickets.projectId, projectIds), match))
    .limit(1);
  return row ?? null;
}

export async function epicLinks(
  db: DbExecutor,
  ticketIds: string[],
): Promise<{ ticketId: string; epicId: string }[]> {
  if (ticketIds.length === 0) return [];
  return db
    .select({ ticketId: ticketEpics.ticketId, epicId: ticketEpics.epicId })
    .from(ticketEpics)
    .where(inArray(ticketEpics.ticketId, ticketIds));
}

export async function loggedMinutes(
  db: DbExecutor,
  ticketIds: string[],
): Promise<Map<string, number>> {
  if (ticketIds.length === 0) return new Map();
  const rows = await db
    .select({
      ticketId: workLogs.ticketId,
      minutes: sql<number>`coalesce(sum(${workLogs.minutes}), 0)::int`,
    })
    .from(workLogs)
    .where(inArray(workLogs.ticketId, ticketIds))
    .groupBy(workLogs.ticketId);
  return new Map(rows.map((row) => [row.ticketId, Number(row.minutes)]));
}

export async function profileEmails(
  db: DbExecutor,
  userIds: string[],
): Promise<Map<string, string | null>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ id: profiles.id, email: profiles.email })
    .from(profiles)
    .where(inArray(profiles.id, userIds));
  return new Map(rows.map((row) => [row.id, row.email]));
}
