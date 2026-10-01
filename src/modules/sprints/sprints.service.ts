import { db } from "../../database/client.js";
import { ConflictError, NotFoundError, ValidationError } from "../../shared/http/errors.js";
import { requireProjectMember, requireProjectWriter } from "../access/access.service.js";
import type { Actor } from "../access/access.types.js";
import { writeAuditEvent } from "../audit/audit.service.js";
import * as repo from "./sprints.repository.js";

export const toSprintDto = (row: repo.SprintRow) => ({
  id: row.id,
  projectId: row.projectId,
  name: row.name,
  goal: row.goal,
  status: row.status as "planned" | "active" | "completed",
  startsAt: row.startsAt?.toISOString() ?? null,
  endsAt: row.endsAt?.toISOString() ?? null,
  position: row.position,
  createdAt: row.createdAt.toISOString(),
});

type SprintFields = {
  name: string;
  goal?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
};

function assertDateRange(startsAt?: string | null, endsAt?: string | null) {
  if (startsAt && endsAt && new Date(endsAt) < new Date(startsAt)) {
    throw new ValidationError("End date can't be before the start date", [
      { path: "body.endsAt", message: "End date can't be before the start date" },
    ]);
  }
}

const audit = (
  actor: Actor,
  projectId: string,
  action: "create" | "update" | "delete",
  field: string,
  value: string,
) =>
  writeAuditEvent({
    actorUserId: actor.userId,
    action,
    event: `sprints.${field}`,
    table: "sprints",
    projectId,
    link: "/backlog",
    summary: value,
  });

async function requireSprint(projectId: string, sprintId: string) {
  const sprint = await repo.findSprint(db, projectId, sprintId);
  if (!sprint) throw new NotFoundError("Sprint", "SPRINT_NOT_FOUND");
  return sprint;
}

export async function listSprints(actor: Actor, projectId: string) {
  await requireProjectMember(actor, projectId);
  return (await repo.listSprints(db, projectId)).map(toSprintDto);
}

/** New sprints go to the top of the list (position below the current minimum). */
export async function createSprint(actor: Actor, projectId: string, input: SprintFields) {
  await requireProjectWriter(actor, projectId);
  assertDateRange(input.startsAt, input.endsAt);
  const sprint = await db.transaction(async (tx) => {
    const top = await repo.minPosition(tx, projectId);
    return repo.insertSprint(tx, {
      projectId,
      name: input.name.trim(),
      goal: input.goal?.trim() || null,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      status: "planned",
      position: (top ?? 0) - 1,
    });
  });
  await audit(actor, projectId, "create", "name", sprint.name);
  return toSprintDto(sprint);
}

export async function updateSprint(
  actor: Actor,
  projectId: string,
  sprintId: string,
  input: Partial<SprintFields>,
) {
  await requireProjectWriter(actor, projectId);
  const current = await requireSprint(projectId, sprintId);
  const startsAt = input.startsAt !== undefined ? input.startsAt : current.startsAt?.toISOString();
  const endsAt = input.endsAt !== undefined ? input.endsAt : current.endsAt?.toISOString();
  assertDateRange(startsAt, endsAt);
  const sprint = await repo.updateSprint(db, sprintId, {
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.goal !== undefined ? { goal: input.goal?.trim() || null } : {}),
    ...(input.startsAt !== undefined
      ? { startsAt: input.startsAt ? new Date(input.startsAt) : null }
      : {}),
    ...(input.endsAt !== undefined ? { endsAt: input.endsAt ? new Date(input.endsAt) : null } : {}),
  });
  await audit(actor, projectId, "update", "name", sprint.name);
  return toSprintDto(sprint);
}

export async function startSprint(actor: Actor, projectId: string, sprintId: string) {
  await requireProjectWriter(actor, projectId);
  const current = await requireSprint(projectId, sprintId);
  if (current.status === "completed")
    throw new ConflictError("Completed sprints cannot be started again", "SPRINT_COMPLETED");
  const sprint = await repo.updateSprint(db, sprintId, { status: "active", startsAt: new Date() });
  await audit(actor, projectId, "update", "status", "active");
  return toSprintDto(sprint);
}

/**
 * Completes a sprint in one transaction: unfinished tickets move to the backlog or to another open
 * sprint, finished tickets stay with the completed sprint.
 */
export async function completeSprint(
  actor: Actor,
  projectId: string,
  sprintId: string,
  moveOpenTicketsTo: string | null,
) {
  await requireProjectWriter(actor, projectId);
  const result = await db.transaction(async (tx) => {
    const sprint = await repo.lockSprint(tx, sprintId);
    if (!sprint || sprint.projectId !== projectId)
      throw new NotFoundError("Sprint", "SPRINT_NOT_FOUND");
    if (sprint.status === "completed")
      throw new ConflictError("This sprint is already completed", "SPRINT_COMPLETED");
    if (moveOpenTicketsTo) {
      if (moveOpenTicketsTo === sprintId)
        throw new ValidationError("Choose a different sprint for unfinished tickets");
      const target = await repo.findSprint(tx, projectId, moveOpenTicketsTo);
      if (!target) throw new NotFoundError("Sprint", "SPRINT_NOT_FOUND");
      if (target.status === "completed")
        throw new ConflictError(
          "Unfinished tickets cannot move into a completed sprint",
          "SPRINT_COMPLETED",
        );
    }
    const open = await repo.openTicketIds(tx, sprintId);
    await repo.moveTicketsToSprint(tx, open, moveOpenTicketsTo);
    const completed = await repo.updateSprint(tx, sprintId, {
      status: "completed",
      endsAt: new Date(),
    });
    return { sprint: completed, movedTicketIds: open };
  });
  if (result.movedTicketIds.length > 0) {
    await writeAuditEvent({
      actorUserId: actor.userId,
      action: "update",
      event: "tickets.sprint",
      table: "tickets",
      projectId,
      link: "/backlog",
      summary: moveOpenTicketsTo ? "Moved unfinished tickets to another sprint" : "Backlog",
      metadata: { count: result.movedTicketIds.length },
    });
  }
  await audit(actor, projectId, "update", "status", "completed");
  return { sprint: toSprintDto(result.sprint), movedTicketIds: result.movedTicketIds };
}

/** Deletes a sprint; its tickets return to the backlog in the same transaction. */
export async function deleteSprint(actor: Actor, projectId: string, sprintId: string) {
  await requireProjectWriter(actor, projectId);
  const sprint = await requireSprint(projectId, sprintId);
  await db.transaction(async (tx) => {
    await repo.detachTickets(tx, sprintId);
    await repo.deleteSprint(tx, sprintId);
  });
  await audit(actor, projectId, "delete", "name", sprint.name);
}

/** Reorders an unstarted sprint between two neighbours (fractional position, as in the source). */
export async function moveSprint(
  actor: Actor,
  projectId: string,
  sprintId: string,
  input: { afterSprintId?: string | null; beforeSprintId?: string | null },
) {
  await requireProjectWriter(actor, projectId);
  const sprint = await requireSprint(projectId, sprintId);
  if (sprint.status !== "planned")
    throw new ConflictError(
      "Only sprints that have not started can be reordered",
      "SPRINT_STARTED",
    );
  const neighbour = async (id?: string | null) =>
    id ? (await requireSprint(projectId, id)).position : null;
  const position = midpoint(
    await neighbour(input.afterSprintId),
    await neighbour(input.beforeSprintId),
  );
  return toSprintDto(await repo.updateSprint(db, sprintId, { position }));
}

/** Position between neighbours: midpoint, prev+1, next-1, or 0 for an empty list. */
export function midpoint(previous: number | null, next: number | null): number {
  if (previous !== null && next !== null) return (previous + next) / 2;
  if (previous !== null) return previous + 1;
  if (next !== null) return next - 1;
  return 0;
}
