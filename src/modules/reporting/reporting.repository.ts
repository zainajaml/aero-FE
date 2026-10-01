import { and, asc, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import type { DbExecutor } from "../../database/client.js";
import {
  boardColumns,
  comments,
  profiles,
  projectMembers,
  sprints,
  tickets,
  workLogs,
} from "../../database/schema/index.js";

export type WorkLogFilter = {
  projectIds: string[];
  sprintIds?: string[];
  ticketIds?: string[];
  userIds?: string[];
  from?: Date;
  to?: Date;
};

export function listWorkLogs(db: DbExecutor, filter: WorkLogFilter) {
  const conditions: SQL[] = [inArray(tickets.projectId, filter.projectIds)];
  if (filter.sprintIds?.length) conditions.push(inArray(tickets.sprintId, filter.sprintIds));
  if (filter.ticketIds?.length) conditions.push(inArray(workLogs.ticketId, filter.ticketIds));
  if (filter.userIds?.length) conditions.push(inArray(workLogs.userId, filter.userIds));
  if (filter.from) conditions.push(gte(workLogs.loggedAt, filter.from));
  if (filter.to) conditions.push(lt(workLogs.loggedAt, filter.to));
  return db
    .select({
      id: workLogs.id,
      ticketId: workLogs.ticketId,
      projectId: tickets.projectId,
      userId: workLogs.userId,
      minutes: workLogs.minutes,
      loggedAt: workLogs.loggedAt,
      note: workLogs.note,
      resourceType: workLogs.resourceType,
    })
    .from(workLogs)
    .innerJoin(tickets, eq(tickets.id, workLogs.ticketId))
    .where(and(...conditions))
    .orderBy(asc(workLogs.loggedAt), asc(workLogs.id));
}

export type TicketSearch = {
  projectIds: string[];
  sprintIds?: string[];
  assigneeIds?: string[];
  ids?: string[];
};

/** Tickets with their stage name and done flag (`is_done` columns are done). */
export function searchTickets(db: DbExecutor, filter: TicketSearch) {
  const conditions: SQL[] = [inArray(tickets.projectId, filter.projectIds)];
  if (filter.sprintIds?.length) conditions.push(inArray(tickets.sprintId, filter.sprintIds));
  if (filter.assigneeIds?.length) conditions.push(inArray(tickets.assigneeId, filter.assigneeIds));
  if (filter.ids?.length) conditions.push(inArray(tickets.id, filter.ids));
  return db
    .select({
      id: tickets.id,
      projectId: tickets.projectId,
      sprintId: tickets.sprintId,
      columnId: tickets.columnId,
      code: tickets.code,
      title: tickets.title,
      type: tickets.type,
      priority: tickets.priority,
      assigneeId: tickets.assigneeId,
      estimateMinutes: tickets.estimateMinutes,
      dueDate: tickets.dueDate,
      updatedAt: tickets.updatedAt,
      stageName: boardColumns.name,
      isDone: sql<boolean>`coalesce(${boardColumns.isDone}, false)`,
    })
    .from(tickets)
    .leftJoin(boardColumns, eq(boardColumns.id, tickets.columnId))
    .where(and(...conditions))
    .orderBy(desc(tickets.updatedAt));
}

export function listSprints(db: DbExecutor, projectIds: string[], statuses?: string[]) {
  const conditions: SQL[] = [inArray(sprints.projectId, projectIds)];
  if (statuses?.length) conditions.push(inArray(sprints.status, statuses));
  return db
    .select()
    .from(sprints)
    .where(and(...conditions))
    .orderBy(sql`${sprints.endsAt} desc nulls last`, asc(sprints.position));
}

export function commentsForTickets(db: DbExecutor, ticketIds: string[]) {
  if (ticketIds.length === 0) return Promise.resolve([]);
  return db
    .select({
      ticketId: comments.ticketId,
      authorId: comments.authorId,
      body: comments.body,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .where(inArray(comments.ticketId, ticketIds))
    .orderBy(asc(comments.createdAt));
}

export function memberUserIds(db: DbExecutor, projectIds: string[]) {
  if (projectIds.length === 0) return Promise.resolve([]);
  return db
    .selectDistinct({ userId: projectMembers.userId })
    .from(projectMembers)
    .innerJoin(profiles, eq(profiles.id, projectMembers.userId))
    .where(and(inArray(projectMembers.projectId, projectIds), sql`${profiles.archivedAt} is null`));
}

export function projectRolesFor(db: DbExecutor, projectIds: string[]) {
  if (projectIds.length === 0) return Promise.resolve([]);
  return db
    .select({
      projectId: projectMembers.projectId,
      userId: projectMembers.userId,
      role: projectMembers.role,
    })
    .from(projectMembers)
    .where(inArray(projectMembers.projectId, projectIds));
}
