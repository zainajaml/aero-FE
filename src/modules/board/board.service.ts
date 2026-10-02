import { db } from "../../database/client.js";
import { NotFoundError, ValidationError } from "../../shared/http/errors.js";
import { requireProjectManager, requireProjectMember } from "../access/access.service.js";
import type { Actor } from "../access/access.types.js";
import { writeAuditEvent } from "../audit/audit.service.js";
import * as repo from "./board.repository.js";

const toColumnDto = (row: repo.ColumnRow) => ({
  id: row.id,
  projectId: row.projectId,
  name: row.name,
  orderIndex: row.orderIndex,
  isDone: row.isDone,
});

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
    event: `board_columns.${field}`,
    table: "board_columns",
    projectId,
    link: "/board",
    summary: value,
  });

export async function listColumns(actor: Actor, projectId: string) {
  await requireProjectMember(actor, projectId);
  return (await repo.listColumns(db, projectId)).map(toColumnDto);
}

// Column management follows the source RLS rule (project managers); archived projects are blocked by the DB.
export async function addColumn(actor: Actor, projectId: string, name: string) {
  await requireProjectManager(actor, projectId);
  const row = await repo.insertColumn(db, projectId, name.trim());
  await audit(actor, projectId, "create", "name", row.name);
  return toColumnDto(row);
}

export async function updateColumn(
  actor: Actor,
  projectId: string,
  columnId: string,
  patch: { name?: string; isDone?: boolean },
) {
  await requireProjectManager(actor, projectId);
  if (!(await repo.findColumn(db, projectId, columnId)))
    throw new NotFoundError("Column", "COLUMN_NOT_FOUND");
  const row = await repo.updateColumn(db, columnId, {
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.isDone !== undefined ? { isDone: patch.isDone } : {}),
  });
  if (patch.name !== undefined) await audit(actor, projectId, "update", "name", row.name);
  if (patch.isDone !== undefined)
    await audit(actor, projectId, "update", "is_done", String(row.isDone));
  return toColumnDto(row);
}

/** Deleting a column leaves its tickets without a column (FK SET NULL), as in the source. */
export async function deleteColumn(actor: Actor, projectId: string, columnId: string) {
  await requireProjectManager(actor, projectId);
  const column = await repo.findColumn(db, projectId, columnId);
  if (!column) throw new NotFoundError("Column", "COLUMN_NOT_FOUND");
  await repo.deleteColumn(db, columnId);
  await audit(actor, projectId, "delete", "name", column.name);
}

/** Atomic reorder: the body lists every column of the project in its new order. */
export async function reorderColumns(actor: Actor, projectId: string, columnIds: string[]) {
  await requireProjectManager(actor, projectId);
  return db.transaction(async (tx) => {
    const columns = await repo.listColumns(tx, projectId);
    const known = new Set(columns.map((c) => c.id));
    if (
      columnIds.length !== columns.length ||
      columnIds.some((id) => !known.has(id)) ||
      new Set(columnIds).size !== columnIds.length
    ) {
      throw new ValidationError("Provide every column of the project exactly once");
    }
    for (const [index, id] of columnIds.entries())
      await repo.updateColumn(tx, id, { orderIndex: index });
    return (await repo.listColumns(tx, projectId)).map(toColumnDto);
  });
}
