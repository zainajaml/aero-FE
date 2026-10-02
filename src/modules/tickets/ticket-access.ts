import { eq } from "drizzle-orm";
import { db, type DbExecutor } from "../../database/client.js";
import { sprints, tickets } from "../../database/schema/index.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../shared/http/errors.js";
import * as policy from "../access/access.policy.js";
import { assertCanWrite, requireProjectMember } from "../access/access.service.js";
import type { Actor, ProjectScope } from "../access/access.types.js";

export type TicketRow = typeof tickets.$inferSelect;
export type TicketContext = { ticket: TicketRow; scope: ProjectScope; sprintStatus: string | null };

async function loadTicket(
  executor: DbExecutor,
  ticketId: string,
): Promise<{ ticket: TicketRow; sprintStatus: string | null } | null> {
  const [row] = await executor
    .select({ ticket: tickets, sprintStatus: sprints.status })
    .from(tickets)
    .leftJoin(sprints, eq(sprints.id, tickets.sprintId))
    .where(eq(tickets.id, ticketId))
    .limit(1);
  return row ?? null;
}

/** A ticket the actor can see; unknown and invisible tickets are the same 404. */
export async function requireTicketReader(actor: Actor, ticketId: string): Promise<TicketContext> {
  const row = await loadTicket(db, ticketId);
  if (!row) throw new NotFoundError("Ticket", "TICKET_NOT_FOUND");
  try {
    const scope = await requireProjectMember(actor, row.ticket.projectId);
    return { ...row, scope };
  } catch {
    throw new NotFoundError("Ticket", "TICKET_NOT_FOUND");
  }
}

/** Tickets in completed sprints are read-only (the source dialog's sprint lock, now server-side). */
export function assertTicketUnlocked(context: { sprintStatus: string | null }) {
  if (context.sprintStatus === "completed") {
    throw new ConflictError(
      "This ticket belongs to a completed sprint and is read-only.",
      "SPRINT_COMPLETED",
    );
  }
}

/** Member, not a viewer, project not archived, ticket not in a completed sprint. */
export async function requireTicketWriter(actor: Actor, ticketId: string): Promise<TicketContext> {
  const context = await requireTicketReader(actor, ticketId);
  assertCanWrite(actor, context.scope);
  assertTicketUnlocked(context);
  return context;
}

export function isManager(actor: Actor, scope: ProjectScope): boolean {
  return policy.canManageProject(actor, scope);
}

export function requireManager(
  actor: Actor,
  scope: ProjectScope,
  message = "Only project admins can do this",
) {
  if (!isManager(actor, scope)) throw new ForbiddenError(message);
}
