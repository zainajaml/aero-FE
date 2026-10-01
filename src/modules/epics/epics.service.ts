import { and, asc, eq } from "drizzle-orm";
import { db } from "../../database/client.js";
import { epics } from "../../database/schema/index.js";
import { isUniqueViolation } from "../../shared/http/database-errors.js";
import { ConflictError, NotFoundError } from "../../shared/http/errors.js";
import {
  requireProjectManager,
  requireProjectMember,
  requireProjectWriter,
} from "../access/access.service.js";
import type { Actor } from "../access/access.types.js";

type EpicRow = typeof epics.$inferSelect;
const toDto = (row: EpicRow) => ({
  id: row.id,
  projectId: row.projectId,
  name: row.name,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
});

const nameTaken = (error: unknown): never => {
  if (isUniqueViolation(error, "epics_project_name_unique"))
    throw new ConflictError("An epic with this name already exists", "EPIC_NAME_TAKEN");
  throw error;
};

async function requireEpic(projectId: string, epicId: string) {
  const [row] = await db
    .select()
    .from(epics)
    .where(and(eq(epics.id, epicId), eq(epics.projectId, projectId)))
    .limit(1);
  if (!row) throw new NotFoundError("Epic", "EPIC_NOT_FOUND");
  return row;
}

export async function listEpics(actor: Actor, projectId: string) {
  await requireProjectMember(actor, projectId);
  return (
    await db.select().from(epics).where(eq(epics.projectId, projectId)).orderBy(asc(epics.name))
  ).map(toDto);
}

export async function createEpic(actor: Actor, projectId: string, name: string) {
  await requireProjectWriter(actor, projectId);
  const [row] = await db
    .insert(epics)
    .values({ projectId, name: name.trim(), createdBy: actor.userId })
    .returning()
    .catch(nameTaken);
  return toDto(row!);
}

export async function renameEpic(actor: Actor, projectId: string, epicId: string, name: string) {
  await requireProjectWriter(actor, projectId);
  await requireEpic(projectId, epicId);
  const [row] = await db
    .update(epics)
    .set({ name: name.trim() })
    .where(eq(epics.id, epicId))
    .returning()
    .catch(nameTaken);
  return toDto(row!);
}

/** Managers only (source RLS); ticket links are removed with it (FK cascade, one statement). */
export async function deleteEpic(actor: Actor, projectId: string, epicId: string) {
  await requireProjectManager(actor, projectId);
  await requireEpic(projectId, epicId);
  await db.delete(epics).where(eq(epics.id, epicId));
}
