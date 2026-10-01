import { and, desc, eq } from "drizzle-orm";
import { db } from "../../database/client.js";
import { workLogs } from "../../database/schema/index.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../shared/http/errors.js";
import type { Actor } from "../access/access.types.js";
import { writeAuditEvent } from "../audit/audit.service.js";
import { listProjectAccessibleUsers } from "../users/people.repository.js";
import {
  isManager,
  requireTicketReader,
  requireTicketWriter,
  type TicketContext,
} from "../tickets/ticket-access.js";

type WorkLogRow = typeof workLogs.$inferSelect;
const toDto = (row: WorkLogRow) => ({
  id: row.id,
  ticketId: row.ticketId,
  userId: row.userId,
  minutes: row.minutes,
  note: row.note,
  resourceType: row.resourceType,
  loggedAt: row.loggedAt.toISOString(),
});

async function assertCanLogFor(actor: Actor, context: TicketContext, userId: string) {
  if (userId === actor.userId) return;
  if (!isManager(actor, context.scope)) throw new ForbiddenError("You can only log your own time");
  const people = await listProjectAccessibleUsers(db, context.ticket.projectId);
  if (!people.some((person) => person.userId === userId)) {
    throw new ValidationError("The person must have access to this project", [
      { path: "body.userId", message: "Not a project member" },
    ]);
  }
}

async function requireWorkLog(ticketId: string, workLogId: string) {
  const [row] = await db
    .select()
    .from(workLogs)
    .where(and(eq(workLogs.id, workLogId), eq(workLogs.ticketId, ticketId)))
    .limit(1);
  if (!row) throw new NotFoundError("Work log", "WORK_LOG_NOT_FOUND");
  return row;
}

const audit = (
  actor: Actor,
  projectId: string,
  action: "create" | "update" | "delete",
  value: string,
) =>
  writeAuditEvent({
    actorUserId: actor.userId,
    action,
    event: "work_logs.work log",
    table: "work_logs",
    projectId,
    link: "/backlog",
    summary: value,
  });

export async function listWorkLogs(actor: Actor, ticketId: string) {
  await requireTicketReader(actor, ticketId);
  return (
    await db
      .select()
      .from(workLogs)
      .where(eq(workLogs.ticketId, ticketId))
      .orderBy(desc(workLogs.loggedAt))
  ).map(toDto);
}

type WorkLogInput = {
  minutes: number;
  note: string;
  loggedAt: string;
  userId?: string;
  resourceType?: string | null;
};

/** Members log their own time; project managers may log for anyone with project access. */
export async function addWorkLog(actor: Actor, ticketId: string, input: WorkLogInput) {
  const context = await requireTicketWriter(actor, ticketId);
  const userId = input.userId ?? actor.userId;
  await assertCanLogFor(actor, context, userId);
  const [row] = await db
    .insert(workLogs)
    .values({
      ticketId,
      userId,
      minutes: input.minutes,
      note: input.note.trim(),
      loggedAt: new Date(input.loggedAt),
      resourceType: input.resourceType?.trim() || null,
    })
    .returning();
  await audit(actor, context.ticket.projectId, "create", row!.note ?? "work log");
  return toDto(row!);
}

/** Owner or project manager; a manager may also reassign the log to another person. */
export async function updateWorkLog(
  actor: Actor,
  ticketId: string,
  workLogId: string,
  input: Partial<WorkLogInput>,
) {
  const context = await requireTicketWriter(actor, ticketId);
  const current = await requireWorkLog(ticketId, workLogId);
  if (current.userId !== actor.userId && !isManager(actor, context.scope))
    throw new ForbiddenError("You can only change your own time");
  if (input.userId !== undefined && input.userId !== current.userId)
    await assertCanLogFor(actor, context, input.userId);
  const [row] = await db
    .update(workLogs)
    .set({
      ...(input.minutes !== undefined ? { minutes: input.minutes } : {}),
      ...(input.note !== undefined ? { note: input.note.trim() } : {}),
      ...(input.loggedAt !== undefined ? { loggedAt: new Date(input.loggedAt) } : {}),
      ...(input.userId !== undefined ? { userId: input.userId } : {}),
      ...(input.resourceType !== undefined
        ? { resourceType: input.resourceType?.trim() || null }
        : {}),
    })
    .where(eq(workLogs.id, workLogId))
    .returning();
  await audit(actor, context.ticket.projectId, "update", row!.note ?? "work log");
  return toDto(row!);
}

export async function deleteWorkLog(actor: Actor, ticketId: string, workLogId: string) {
  const context = await requireTicketWriter(actor, ticketId);
  const current = await requireWorkLog(ticketId, workLogId);
  if (current.userId !== actor.userId && !isManager(actor, context.scope))
    throw new ForbiddenError("You can only remove your own time");
  await db.delete(workLogs).where(eq(workLogs.id, workLogId));
}
