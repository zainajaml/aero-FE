import { db } from "../../database/client.js";
import { isUniqueViolation } from "../../shared/http/database-errors.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../shared/http/errors.js";
import * as policy from "../access/access.policy.js";
import { requireProjectManager, requireProjectMember } from "../access/access.service.js";
import { listVisibleProjectAccounts } from "../access/access.repository.js";
import type { Actor } from "../access/access.types.js";
import { writeAuditEvent } from "../audit/audit.service.js";
import { listProjectAccessibleUsers } from "../users/people.repository.js";
import { normalizeProjectKey, type ProjectType } from "./project-defaults.js";
import * as repo from "./projects.repository.js";

export function toProjectDto(row: repo.ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    key: row.key,
    accountId: row.accountId,
    clientAccount: row.clientAccount,
    ownerId: row.ownerId,
    description: row.description,
    projectType: row.projectType as ProjectType,
    createdAt: row.createdAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    archivedBy: row.archivedBy,
  };
}

function requireAccountAdminOf(actor: Actor, accountId: string, message: string) {
  if (!policy.isSuperAdmin(actor) && !policy.isAccountAdmin(actor, accountId))
    throw new ForbiddenError(message);
}

const keyTaken = (key: string) =>
  new ConflictError(`Project key ${key} is already in use`, "PROJECT_KEY_TAKEN");

function translateKeyConflict(key: string) {
  return (error: unknown): never => {
    if (isUniqueViolation(error, "projects_key_unique")) throw keyTaken(key);
    throw error;
  };
}

/** Every project the actor can read, archived ones included (ports the projects SELECT policy). */
export async function listVisibleProjects(actor: Actor) {
  const rows = policy.isSuperAdmin(actor)
    ? await repo.listProjects(db, { all: true })
    : await repo.listProjects(db, {
        ids: (await listVisibleProjectAccounts(db, actor, false)).map((p) => p.projectId),
      });
  return rows.map(toProjectDto);
}

async function visibleProjectIds(actor: Actor, ids: string[]): Promise<string[]> {
  if (policy.isSuperAdmin(actor)) return ids;
  const visible = new Set(
    (await listVisibleProjectAccounts(db, actor, false)).map((p) => p.projectId),
  );
  return ids.filter((id) => visible.has(id));
}

export async function createProject(
  actor: Actor,
  input: {
    accountId: string;
    name: string;
    key: string;
    projectType: ProjectType;
    clientAccount?: string | null;
    description?: string | null;
  },
) {
  requireAccountAdminOf(actor, input.accountId, "You are not an admin of this account");
  const key = normalizeProjectKey(input.key);
  if (key.length < 2) throw new ValidationError("Project key must be 2-8 letters or numbers");
  const project = await db
    .transaction(async (tx) => {
      if (await repo.isKeyTaken(tx, key)) throw keyTaken(key);
      const created = await repo.insertProject(tx, {
        name: input.name.trim(),
        key,
        accountId: input.accountId,
        clientAccount: input.clientAccount?.trim() || null,
        description: input.description?.trim() || null,
        projectType: input.projectType,
        ownerId: actor.userId,
      });
      // Account admins already reach every project of their account and cannot hold a seat in it.
      if (!policy.isAccountAdmin(actor, input.accountId))
        await repo.addProjectAdmin(tx, created.id, actor.userId);
      await repo.insertDefaultColumns(tx, created.id, input.projectType);
      await repo.inheritRateCard(tx, created.id, input.accountId);
      return created;
    })
    .catch(translateKeyConflict(key));
  await writeAuditEvent({
    actorUserId: actor.userId,
    action: "create",
    event: "project.created",
    table: "projects",
    entityId: project.id,
    projectId: project.id,
    accountId: input.accountId,
    link: "/projects",
    summary: `Created project ${project.name}`,
    metadata: { project_type: input.projectType },
  });
  return toProjectDto(project);
}

/** Project managers edit details; the board style switch keeps existing columns (as in the source). */
export async function updateProject(
  actor: Actor,
  projectId: string,
  input: {
    name?: string;
    key?: string;
    projectType?: ProjectType;
    clientAccount?: string | null;
    description?: string | null;
  },
) {
  await requireProjectManager(actor, projectId);
  const key = input.key !== undefined ? normalizeProjectKey(input.key) : undefined;
  if (key !== undefined && key.length < 1) throw new ValidationError("Name and key required");
  const updated = await db
    .transaction(async (tx) => {
      if (key && (await repo.isKeyTaken(tx, key, projectId))) throw keyTaken(key);
      return repo.updateProject(tx, projectId, {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(key !== undefined ? { key } : {}),
        ...(input.projectType !== undefined ? { projectType: input.projectType } : {}),
        ...(input.clientAccount !== undefined
          ? { clientAccount: input.clientAccount?.trim() || null }
          : {}),
        ...(input.description !== undefined
          ? { description: input.description?.trim() || null }
          : {}),
      });
    })
    .catch(translateKeyConflict(key ?? ""));
  if (!updated) throw new NotFoundError("Project", "PROJECT_NOT_FOUND");
  await writeAuditEvent({
    actorUserId: actor.userId,
    action: "update",
    event: "project.updated",
    table: "projects",
    entityId: projectId,
    projectId,
    link: "/projects",
    summary: `Updated project ${updated.name}`,
    metadata: { fields: Object.keys(input) },
  });
  return toProjectDto(updated);
}

/** Permanent delete: super admins and admins of the project's account (ports the projects DELETE policy). */
export async function deleteProject(actor: Actor, projectId: string) {
  const project = await repo.findProject(db, projectId);
  if (!project) throw new NotFoundError("Project", "PROJECT_NOT_FOUND");
  requireAccountAdminOf(actor, project.accountId, "Only account admins can delete projects");
  await repo.deleteProject(db, projectId);
  await writeAuditEvent({
    actorUserId: actor.userId,
    action: "delete",
    event: "project.deleted",
    table: "projects",
    entityId: projectId,
    accountId: project.accountId,
    link: "/admin",
    summary: `Deleted project ${project.name}`,
    critical: true,
  });
}

export async function setArchived(actor: Actor, projectId: string, archived: boolean) {
  const project = await repo.findProject(db, projectId);
  if (!project) throw new NotFoundError("Project", "PROJECT_NOT_FOUND");
  requireAccountAdminOf(
    actor,
    project.accountId,
    "Only account admins can archive or restore projects",
  );
  const updated = await repo.updateProject(
    db,
    projectId,
    archived
      ? { archivedAt: new Date(), archivedBy: actor.userId }
      : { archivedAt: null, archivedBy: null },
  );
  await writeAuditEvent({
    actorUserId: actor.userId,
    action: "update",
    event: archived ? "project.archived" : "project.restored",
    table: "projects",
    entityId: projectId,
    projectId,
    accountId: project.accountId,
    link: "/admin",
    summary: `${archived ? "Archived" : "Restored"} project ${project.name}`,
  });
  return toProjectDto(updated!);
}

/** Moving a project requires admin rights on BOTH the source and destination accounts. */
export async function moveProject(actor: Actor, projectId: string, accountId: string) {
  const project = await repo.findProject(db, projectId);
  if (!project) throw new NotFoundError("Project", "PROJECT_NOT_FOUND");
  requireAccountAdminOf(actor, project.accountId, "You are not an admin of this project's account");
  requireAccountAdminOf(actor, accountId, "You are not an admin of the destination account");
  if (project.accountId === accountId) return toProjectDto(project);
  const updated = await repo.updateProject(db, projectId, { accountId });
  await writeAuditEvent({
    actorUserId: actor.userId,
    action: "update",
    event: "project.account_changed",
    table: "projects",
    entityId: projectId,
    projectId,
    accountId,
    link: "/admin",
    summary: "Moved a project to another account",
    metadata: { from_account: project.accountId, to_account: accountId },
    critical: true,
  });
  return toProjectDto(updated!);
}

export async function getProjectStats(actor: Actor, ids: string[]) {
  const stats = await repo.projectStats(db, await visibleProjectIds(actor, ids));
  return stats.map((stat) => ({
    ...stat,
    lastSprintEndsAt: stat.lastSprintEndsAt?.toISOString() ?? null,
  }));
}

export async function listProjectPeople(actor: Actor, projectId: string) {
  await requireProjectMember(actor, projectId);
  return listProjectAccessibleUsers(db, projectId);
}

// ------------------------------------------------------------------ rate card

const toRateDto = (row: repo.RateCardRow) => ({
  id: row.id,
  projectId: row.projectId,
  role: row.role,
  location: row.location,
  hourlyRate: row.hourlyRate,
});

const duplicateRate = (error: unknown): never => {
  if (isUniqueViolation(error, "rate_card_project_role_location_key")) {
    throw new ConflictError("A rate for this role and location already exists", "RATE_EXISTS");
  }
  throw error;
};

export async function listRates(actor: Actor, projectIds: string[]) {
  return (await repo.listRateCard(db, await visibleProjectIds(actor, projectIds))).map(toRateDto);
}

type RateInput = { role: string; location?: string | null; hourlyRate: number };
const ratePatch = (input: RateInput) => ({
  role: input.role.trim(),
  location: input.location?.trim() || null,
  hourlyRate: input.hourlyRate.toFixed(2),
});

export async function createRate(actor: Actor, projectId: string, input: RateInput) {
  await requireProjectManager(actor, projectId);
  const row = await repo.insertRate(db, { projectId, ...ratePatch(input) }).catch(duplicateRate);
  return toRateDto(row);
}

async function requireRate(projectId: string, rateId: string) {
  const rate = await repo.findRate(db, rateId);
  if (!rate || rate.projectId !== projectId) throw new NotFoundError("Rate", "RATE_NOT_FOUND");
  return rate;
}

export async function updateRate(
  actor: Actor,
  projectId: string,
  rateId: string,
  input: RateInput,
) {
  await requireProjectManager(actor, projectId);
  await requireRate(projectId, rateId);
  return toRateDto(await repo.updateRate(db, rateId, ratePatch(input)).catch(duplicateRate));
}

export async function deleteRate(actor: Actor, projectId: string, rateId: string) {
  await requireProjectManager(actor, projectId);
  await requireRate(projectId, rateId);
  await repo.deleteRate(db, rateId);
}
