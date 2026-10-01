import { db, type DbExecutor } from "../../database/client.js";
import { deleteObjects } from "../../integrations/storage/object-storage.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../shared/http/errors.js";
import {
  assertCanWrite,
  requireProjectMember,
  requireProjectWriter,
} from "../access/access.service.js";
import type { Actor, ProjectScope } from "../access/access.types.js";
import { writeAuditEvent } from "../audit/audit.service.js";
import { notifyAssignee, notifyMentions } from "../notifications/dispatch.service.js";
import { findProject } from "../projects/projects.repository.js";
import { midpoint } from "../sprints/sprints.service.js";
import * as sprintsRepo from "../sprints/sprints.repository.js";
import { listProjectAccessibleUsers } from "../users/people.repository.js";
import { attachmentKeysForTickets } from "./attachments.repository.js";
import { descriptionHasContent, docToText, extractMentionIds } from "./rich-text.js";
import {
  assertTicketUnlocked,
  isManager,
  requireTicketReader,
  requireTicketWriter,
  type TicketRow,
} from "./ticket-access.js";
import * as repo from "./tickets.repository.js";

export const MAX_ESTIMATE_MINUTES = 999 * 60 + 59;

// ------------------------------------------------------------------ DTOs

export function toTicketSummary(row: repo.TicketSummaryRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    sprintId: row.sprintId,
    columnId: row.columnId,
    code: row.code,
    title: row.title,
    type: row.type,
    priority: row.priority,
    assigneeId: row.assigneeId,
    reporterId: row.reporterId,
    estimateMinutes: row.estimateMinutes,
    storyPoints: row.storyPoints,
    position: Number(row.position),
    dueDate: row.dueDate,
    released: row.released,
    releasedAt: row.releasedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    loggedMinutes: row.loggedMinutes,
    epicIds: row.epicIds,
  };
}

async function detailDto(ticketId: string) {
  const row = await repo.findTicketDetail(db, ticketId);
  if (!row) throw new NotFoundError("Ticket", "TICKET_NOT_FOUND");
  return { ...toTicketSummary(row), descriptionJson: row.descriptionJson };
}

// ------------------------------------------------------------------ validation helpers

type Refs = {
  sprintId?: string | null;
  columnId?: string | null;
  assigneeId?: string | null;
  epicIds?: string[];
};

/** Every referenced sprint, column, assignee and epic must belong to the ticket's project. */
async function validateRefs(executor: DbExecutor, projectId: string, refs: Refs) {
  if (refs.sprintId) {
    const sprint = await sprintsRepo.findSprint(executor, projectId, refs.sprintId);
    if (!sprint) throw new NotFoundError("Sprint", "SPRINT_NOT_FOUND");
    if (sprint.status === "completed") {
      throw new ConflictError(
        "Tickets cannot be moved into a completed sprint",
        "SPRINT_COMPLETED",
      );
    }
  }
  if (refs.columnId) {
    const columns = await repo.findColumnsInProject(executor, projectId);
    if (!columns.some((column) => column.id === refs.columnId))
      throw new NotFoundError("Column", "COLUMN_NOT_FOUND");
  }
  if (refs.assigneeId) {
    const people = await listProjectAccessibleUsers(executor, projectId);
    if (!people.some((person) => person.userId === refs.assigneeId)) {
      throw new ValidationError("The assignee must have access to this project", [
        { path: "body.assigneeId", message: "Not a project member" },
      ]);
    }
  }
  if (refs.epicIds && refs.epicIds.length > 0) {
    const valid = await repo.epicIdsInProject(executor, projectId, refs.epicIds);
    if (valid.length !== new Set(refs.epicIds).size)
      throw new NotFoundError("Epic", "EPIC_NOT_FOUND");
  }
}

async function columnName(executor: DbExecutor, projectId: string, columnId: string) {
  const column = (await repo.findColumnsInProject(executor, projectId)).find(
    (c) => c.id === columnId,
  );
  return column?.name ?? "";
}

const auditTicket = (
  actor: Actor,
  projectId: string,
  action: "create" | "update" | "delete",
  field: string,
  value: string,
  link = "/backlog",
) =>
  writeAuditEvent({
    actorUserId: actor.userId,
    action,
    event: `tickets.${field}`,
    table: "tickets",
    projectId,
    link,
    summary: value,
  });

const ticketRef = (ticket: TicketRow) => ({
  id: ticket.id,
  projectId: ticket.projectId,
  title: ticket.title,
  code: ticket.code,
});

// ------------------------------------------------------------------ reads

export async function listTickets(actor: Actor, projectId: string) {
  await requireProjectMember(actor, projectId);
  return (await repo.listProjectTickets(db, projectId)).map(toTicketSummary);
}

export async function getTicket(actor: Actor, ticketId: string) {
  await requireTicketReader(actor, ticketId);
  return detailDto(ticketId);
}

export async function listProjectEstimates(actor: Actor, projectId: string) {
  await requireProjectMember(actor, projectId);
  return repo.listProjectEstimates(db, projectId);
}

export async function listStageHistory(actor: Actor, projectId: string) {
  await requireProjectMember(actor, projectId);
  return (await repo.listProjectStageHistory(db, projectId)).map((row) => ({
    id: row.id,
    ticketId: row.ticketId,
    columnId: row.columnId,
    columnName: row.columnName,
    enteredAt: row.enteredAt.toISOString(),
    movedBy: row.movedBy,
  }));
}

// ------------------------------------------------------------------ create

export type CreateTicketInput = {
  title: string;
  descriptionJson: unknown;
  type: string;
  priority: string;
  columnId?: string | null;
  sprintId?: string | null;
  assigneeId?: string | null;
  storyPoints?: number | null;
  dueDate?: string | null;
  epicIds?: string[];
  estimates?: { resourceType: string; minutes: number; estimatedAt?: string }[];
};

/**
 * Creates a ticket in one transaction: next `KEY-n` code, bottom position of its sprint or backlog,
 * initial stage history, epic links and estimate rows (estimate total kept in sync).
 */
export async function createTicket(actor: Actor, projectId: string, input: CreateTicketInput) {
  await requireProjectWriter(actor, projectId);
  if (!descriptionHasContent(input.descriptionJson)) {
    throw new ValidationError("Description is required", [
      { path: "body.descriptionJson", message: "Description is required" },
    ]);
  }
  const estimates = (input.estimates ?? []).filter((estimate) => estimate.minutes > 0);
  const total = estimates.reduce((sum, estimate) => sum + estimate.minutes, 0);
  if (total > MAX_ESTIMATE_MINUTES) throw new ValidationError("Maximum estimate is 999h 59m");
  const project = await findProject(db, projectId);
  if (!project) throw new NotFoundError("Project", "PROJECT_NOT_FOUND");

  const ticket = await db.transaction(async (tx) => {
    await validateRefs(tx, projectId, input);
    await repo.lockProjectTicketCodes(tx, projectId);
    const created = await repo.insertTicket(tx, {
      projectId,
      code: `${project.key}-${await repo.nextCodeNumber(tx, projectId)}`,
      title: input.title.trim(),
      descriptionJson: input.descriptionJson,
      type: input.type,
      priority: input.priority,
      columnId: input.columnId ?? null,
      sprintId: input.sprintId ?? null,
      assigneeId: input.assigneeId ?? null,
      reporterId: actor.userId,
      storyPoints: input.storyPoints ?? null,
      dueDate: input.dueDate ?? null,
      estimateMinutes: total,
      position: await repo.bottomPosition(tx, projectId, input.sprintId ?? null),
    });
    if (created.columnId) {
      await repo.insertStageHistory(tx, [
        {
          ticketId: created.id,
          projectId,
          columnId: created.columnId,
          columnName: await columnName(tx, projectId, created.columnId),
          movedBy: actor.userId,
        },
      ]);
    }
    await repo.replaceTicketEpics(tx, created.id, [...new Set(input.epicIds ?? [])]);
    await repo.insertEstimates(
      tx,
      estimates.map((estimate) => ({
        ticketId: created.id,
        resourceType: estimate.resourceType,
        minutes: estimate.minutes,
        ...(estimate.estimatedAt ? { estimatedAt: new Date(estimate.estimatedAt) } : {}),
      })),
    );
    return created;
  });

  await auditTicket(actor, projectId, "create", "title", ticket.title);
  if (ticket.assigneeId)
    await notifyAssignee({
      actorId: actor.userId,
      ticket: ticketRef(ticket),
      assigneeId: ticket.assigneeId,
    });
  return detailDto(ticket.id);
}

// ------------------------------------------------------------------ update (ticket dialog save)

export type UpdateTicketInput = Partial<Omit<CreateTicketInput, "estimates">>;

const AUDITED_FIELDS = [
  "assigneeId",
  "priority",
  "type",
  "sprintId",
  "storyPoints",
  "dueDate",
] as const;
const AUDIT_FIELD_NAMES: Record<(typeof AUDITED_FIELDS)[number], string> = {
  assigneeId: "assignee_id",
  priority: "priority",
  type: "type",
  sprintId: "sprint_id",
  storyPoints: "story_points",
  dueDate: "due_date",
};

/** One transaction for the dialog save: fields, column change + stage history, epic set. */
export async function updateTicket(actor: Actor, ticketId: string, input: UpdateTicketInput) {
  const { ticket, scope } = await requireTicketWriter(actor, ticketId);
  if (input.descriptionJson !== undefined && !descriptionHasContent(input.descriptionJson)) {
    throw new ValidationError("Description is required");
  }
  const changes = {
    ...(input.title !== undefined ? { title: input.title.trim() } : {}),
    ...(input.descriptionJson !== undefined ? { descriptionJson: input.descriptionJson } : {}),
    ...(input.type !== undefined ? { type: input.type } : {}),
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
    ...(input.sprintId !== undefined && input.sprintId !== ticket.sprintId
      ? { sprintId: input.sprintId }
      : {}),
    ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
    ...(input.storyPoints !== undefined ? { storyPoints: input.storyPoints } : {}),
    ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
    ...(input.columnId !== undefined ? { columnId: input.columnId } : {}),
  };
  const columnChanged = input.columnId !== undefined && input.columnId !== ticket.columnId;

  await db.transaction(async (tx) => {
    await validateRefs(tx, ticket.projectId, {
      sprintId: changes.sprintId,
      columnId: columnChanged ? input.columnId : undefined,
      assigneeId: input.assigneeId !== ticket.assigneeId ? input.assigneeId : undefined,
      epicIds: input.epicIds,
    });
    await repo.updateTicket(tx, ticketId, changes);
    if (columnChanged && input.columnId) {
      await repo.insertStageHistory(tx, [
        {
          ticketId,
          projectId: ticket.projectId,
          columnId: input.columnId,
          columnName: await columnName(tx, ticket.projectId, input.columnId),
          movedBy: actor.userId,
        },
      ]);
    }
    if (input.epicIds !== undefined)
      await repo.replaceTicketEpics(tx, ticketId, [...new Set(input.epicIds)]);
  });

  for (const field of AUDITED_FIELDS) {
    const value = input[field];
    if (value !== undefined && value !== ticket[field])
      await auditTicket(
        actor,
        scope.projectId,
        "update",
        AUDIT_FIELD_NAMES[field],
        value === null ? "—" : String(value),
      );
  }
  await auditTicket(actor, scope.projectId, "update", "title", changes.title ?? ticket.title);

  const updated = { ...ticket, ...changes };
  if (input.assigneeId && input.assigneeId !== ticket.assigneeId) {
    await notifyAssignee({
      actorId: actor.userId,
      ticket: ticketRef(updated),
      assigneeId: input.assigneeId,
    });
  }
  if (input.descriptionJson !== undefined) {
    const before = new Set(extractMentionIds(ticket.descriptionJson));
    const added = extractMentionIds(input.descriptionJson).filter((id) => !before.has(id));
    if (added.length > 0) {
      await notifyMentions({
        actorId: actor.userId,
        ticket: ticketRef(updated),
        commentText: docToText(input.descriptionJson),
        mentionedUserIds: added,
      });
    }
  }
  return detailDto(ticketId);
}

// ------------------------------------------------------------------ move (drag & drop, stage dropdown)

export type MoveTicketInput = {
  /** Omit to keep the current sprint; null moves to the backlog. */
  sprintId?: string | null;
  columnId?: string | null;
  /** Neighbours in the destination list, for manual ordering. */
  afterTicketId?: string | null;
  beforeTicketId?: string | null;
};

export async function moveTicket(actor: Actor, ticketId: string, input: MoveTicketInput) {
  const { ticket } = await requireTicketWriter(actor, ticketId);
  const sprintChanged = input.sprintId !== undefined && input.sprintId !== ticket.sprintId;
  const columnChanged = input.columnId !== undefined && input.columnId !== ticket.columnId;
  const reposition = input.afterTicketId !== undefined || input.beforeTicketId !== undefined;

  let destinationColumnName = "";
  await db.transaction(async (tx) => {
    await validateRefs(tx, ticket.projectId, {
      sprintId: sprintChanged ? input.sprintId : undefined,
      columnId: columnChanged ? input.columnId : undefined,
    });
    let position: number | undefined;
    if (reposition) {
      const positions = await repo.zoneNeighbourPositions(tx, ticket.projectId, [
        input.afterTicketId,
        input.beforeTicketId,
      ]);
      position = midpoint(
        input.afterTicketId ? (positions.get(input.afterTicketId) ?? null) : null,
        input.beforeTicketId ? (positions.get(input.beforeTicketId) ?? null) : null,
      );
    }
    await repo.updateTicket(tx, ticketId, {
      ...(sprintChanged ? { sprintId: input.sprintId } : {}),
      ...(columnChanged ? { columnId: input.columnId } : {}),
      ...(position !== undefined ? { position } : {}),
    });
    if (columnChanged && input.columnId) {
      destinationColumnName = await columnName(tx, ticket.projectId, input.columnId);
      await repo.insertStageHistory(tx, [
        {
          ticketId,
          projectId: ticket.projectId,
          columnId: input.columnId,
          columnName: destinationColumnName,
          movedBy: actor.userId,
        },
      ]);
    }
  });

  if (sprintChanged) {
    const sprint = input.sprintId
      ? await sprintsRepo.findSprint(db, ticket.projectId, input.sprintId)
      : null;
    await auditTicket(actor, ticket.projectId, "update", "sprint", sprint?.name ?? "Backlog");
  }
  if (columnChanged)
    await auditTicket(actor, ticket.projectId, "update", "column", destinationColumnName, "/board");
  return detailDto(ticketId);
}

// ------------------------------------------------------------------ bulk operations

async function requireBulkTickets(actor: Actor, projectId: string, ticketIds: string[]) {
  const scope = await requireProjectWriter(actor, projectId);
  const rows = await repo.findTicketsInProject(db, projectId, [...new Set(ticketIds)]);
  if (rows.length !== new Set(ticketIds).size)
    throw new NotFoundError("Ticket", "TICKET_NOT_FOUND");
  const completed = new Set(
    (await sprintsRepo.listSprints(db, projectId))
      .filter((sprint) => sprint.status === "completed")
      .map((sprint) => sprint.id),
  );
  if (rows.some((row) => row.sprintId && completed.has(row.sprintId))) {
    throw new ConflictError(
      "Some tickets belong to a completed sprint and are read-only.",
      "SPRINT_COMPLETED",
    );
  }
  return { scope, rows };
}

export async function bulkMoveTickets(
  actor: Actor,
  projectId: string,
  ticketIds: string[],
  sprintId: string | null,
) {
  await requireBulkTickets(actor, projectId, ticketIds);
  await db.transaction(async (tx) => {
    await validateRefs(tx, projectId, { sprintId });
    await repo.updateTickets(tx, ticketIds, { sprintId });
  });
  const sprint = sprintId ? await sprintsRepo.findSprint(db, projectId, sprintId) : null;
  await auditTicket(actor, projectId, "update", "sprint", sprint?.name ?? "Backlog");
  return { updated: ticketIds.length };
}

export type BulkUpdateInput = {
  ticketIds: string[];
  set: {
    columnId?: string | null;
    assigneeId?: string | null;
    priority?: string;
    type?: string;
    sprintId?: string | null;
    dueDate?: string | null;
  };
  addEpicIds?: string[];
};

/** Bulk edit in one transaction; stage history is recorded for every ticket whose column changes. */
export async function bulkUpdateTickets(actor: Actor, projectId: string, input: BulkUpdateInput) {
  const { rows } = await requireBulkTickets(actor, projectId, input.ticketIds);
  await db.transaction(async (tx) => {
    await validateRefs(tx, projectId, { ...input.set, epicIds: input.addEpicIds });
    if (Object.keys(input.set).length > 0) await repo.updateTickets(tx, input.ticketIds, input.set);
    if (input.set.columnId) {
      const name = await columnName(tx, projectId, input.set.columnId);
      await repo.insertStageHistory(
        tx,
        rows
          .filter((row) => row.columnId !== input.set.columnId)
          .map((row) => ({
            ticketId: row.id,
            projectId,
            columnId: input.set.columnId!,
            columnName: name,
            movedBy: actor.userId,
          })),
      );
    }
    await repo.addTicketEpics(tx, input.ticketIds, input.addEpicIds ?? []);
  });
  await auditTicket(actor, projectId, "update", "bulk edit", String(input.ticketIds.length));
  return { updated: input.ticketIds.length };
}

/** Deletion rules (source UI rules, now enforced): managers only, no logged time, not in a completed sprint. */
function deletionBlocker(row: { loggedMinutes: number }): string | null {
  return row.loggedMinutes > 0 ? "HAS_LOGGED_TIME" : null;
}

async function removeTickets(ticketIds: string[]) {
  const keys = await attachmentKeysForTickets(db, ticketIds);
  await repo.deleteTickets(db, ticketIds);
  await deleteObjects("attachments", keys).catch(() => undefined);
}

export async function deleteTicket(actor: Actor, ticketId: string) {
  const context = await requireTicketReader(actor, ticketId);
  assertCanWrite(actor, context.scope);
  assertTicketUnlocked(context);
  if (!isManager(actor, context.scope))
    throw new ForbiddenError("Only project admins can delete tickets");
  const [row] = await repo.findTicketsInProject(db, context.ticket.projectId, [ticketId]);
  if (row && deletionBlocker(row))
    throw new ConflictError("Tickets with logged time cannot be deleted", "HAS_LOGGED_TIME");
  await removeTickets([ticketId]);
  await auditTicket(actor, context.ticket.projectId, "delete", "title", context.ticket.title);
}

export async function bulkDeleteTickets(actor: Actor, projectId: string, ticketIds: string[]) {
  const scope = await requireProjectWriter(actor, projectId);
  if (!isManagerOf(actor, scope))
    throw new ForbiddenError("Only project admins can delete tickets");
  const rows = await repo.findTicketsInProject(db, projectId, [...new Set(ticketIds)]);
  const completed = new Set(
    (await sprintsRepo.listSprints(db, projectId))
      .filter((s) => s.status === "completed")
      .map((s) => s.id),
  );
  const skipped: { id: string; reason: string }[] = [];
  const deletable: string[] = [];
  for (const row of rows) {
    const reason =
      row.sprintId && completed.has(row.sprintId) ? "SPRINT_COMPLETED" : deletionBlocker(row);
    if (reason) skipped.push({ id: row.id, reason });
    else deletable.push(row.id);
  }
  for (const id of ticketIds)
    if (!rows.some((row) => row.id === id)) skipped.push({ id, reason: "NOT_FOUND" });
  await removeTickets(deletable);
  if (deletable.length > 0)
    await auditTicket(actor, projectId, "delete", "count", String(deletable.length));
  return { deleted: deletable, skipped };
}

const isManagerOf = (actor: Actor, scope: ProjectScope) => isManager(actor, scope);

/** Replaces the ticket's epic links (backlog dropdown, gantt drag and dialog all use the full set). */
export async function setTicketEpics(actor: Actor, ticketId: string, epicIds: string[]) {
  const { ticket } = await requireTicketWriter(actor, ticketId);
  await db.transaction(async (tx) => {
    await validateRefs(tx, ticket.projectId, { epicIds });
    await repo.replaceTicketEpics(tx, ticketId, [...new Set(epicIds)]);
  });
  return detailDto(ticketId);
}
