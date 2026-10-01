import type { Response } from "express";
import { db } from "../../database/client.js";
import {
  deleteObjects,
  getObjectStream,
  putObject,
} from "../../integrations/storage/object-storage.js";
import { ForbiddenError, NotFoundError } from "../../shared/http/errors.js";
import {
  assertCanWrite,
  requireProjectMember,
  requireProjectWriter,
  visibleProjectIds,
} from "../access/access.service.js";
import type { Actor } from "../access/access.types.js";
import * as policy from "../access/access.policy.js";
import { writeAuditEvent } from "../audit/audit.service.js";
import { objectKeyFor, readUpload } from "../files/upload.js";
import * as repo from "./documents.repository.js";

const toMeta = (row: Awaited<ReturnType<typeof repo.listDocuments>>[number]) => ({
  id: row.id,
  projectId: row.projectId,
  parentId: row.parentId,
  folderId: row.folderId,
  title: row.title,
  icon: row.icon,
  position: Number(row.position),
  file: row.fileMime ? { mime: row.fileMime, size: row.fileSize } : null,
  createdBy: row.createdBy,
  updatedAt: row.updatedAt.toISOString(),
});
const toFolder = (row: repo.FolderRow) => ({
  id: row.id,
  projectId: row.projectId,
  name: row.name,
  position: row.position,
  createdBy: row.createdBy,
});

const audit = (
  actor: Actor,
  projectId: string,
  action: "create" | "update" | "delete",
  table: string,
  value: string,
) =>
  writeAuditEvent({
    actorUserId: actor.userId,
    action,
    event: `${table}.title`,
    table,
    projectId,
    link: "/documents",
    summary: value,
  });

async function requireDocument(actor: Actor, id: string) {
  const document = await repo.findDocument(db, id);
  if (!document) throw new NotFoundError("Document", "DOCUMENT_NOT_FOUND");
  try {
    const scope = await requireProjectMember(actor, document.projectId);
    return { document, scope };
  } catch {
    throw new NotFoundError("Document", "DOCUMENT_NOT_FOUND");
  }
}

async function requireFolder(actor: Actor, id: string) {
  const folder = await repo.findFolder(db, id);
  if (!folder) throw new NotFoundError("Folder", "FOLDER_NOT_FOUND");
  const scope = await requireProjectMember(actor, folder.projectId).catch(() => {
    throw new NotFoundError("Folder", "FOLDER_NOT_FOUND");
  });
  return { folder, scope };
}

async function assertFolder(projectId: string, folderId?: string | null) {
  if (folderId && !(await repo.folderInProject(db, folderId, projectId)))
    throw new NotFoundError("Folder", "FOLDER_NOT_FOUND");
}

/** Library metadata (no content) for one project, or every visible project when none is given. */
export async function library(actor: Actor, projectIds?: string[]) {
  const ids = await visibleProjectIds(actor, projectIds);
  const [documents, folders] = await Promise.all([
    repo.listDocuments(db, ids),
    repo.listFolders(db, ids),
  ]);
  return { documents: documents.map(toMeta), folders: folders.map(toFolder) };
}

export async function tags(actor: Actor, projectId?: string) {
  const ids = await visibleProjectIds(actor, projectId ? [projectId] : undefined);
  return repo.listTitles(db, ids, 200);
}

export async function getDocument(actor: Actor, id: string) {
  const { document, scope } = await requireDocument(actor, id);
  return {
    ...toMeta(document),
    content: document.content,
    canEdit: policy.canWriteProject(actor, scope),
    canDelete:
      policy.canManageProject(actor, scope) ||
      (document.createdBy === actor.userId && policy.canWriteProject(actor, scope)),
  };
}

export async function createDocument(
  actor: Actor,
  projectId: string,
  input: { folderId?: string | null; parentId?: string | null; title?: string },
) {
  await requireProjectWriter(actor, projectId);
  await assertFolder(projectId, input.folderId);
  if (input.parentId) {
    const parent = await repo.findDocument(db, input.parentId);
    if (!parent || parent.projectId !== projectId)
      throw new NotFoundError("Document", "DOCUMENT_NOT_FOUND");
  }
  const row = await repo.insertDocument(db, {
    projectId,
    folderId: input.folderId ?? null,
    parentId: input.parentId ?? null,
    title: input.title?.trim() || "Untitled",
    createdBy: actor.userId,
    updatedBy: actor.userId,
    position: Date.now(),
  });
  await audit(actor, projectId, "create", "documents", row.title);
  return toMeta(row);
}

/** File-backed document: stored first, then recorded; the object is removed again if recording fails. */
export async function uploadDocumentFile(
  actor: Actor,
  projectId: string,
  file: Express.Multer.File | undefined,
  folderId: string | null,
) {
  await requireProjectWriter(actor, projectId);
  await assertFolder(projectId, folderId);
  const upload = await readUpload(file);
  const key = objectKeyFor(projectId, upload.originalName);
  await putObject("documents", key, upload.buffer, upload.contentType);
  const row = await repo
    .insertDocument(db, {
      projectId,
      folderId,
      title: upload.originalName.slice(0, 255),
      filePath: key,
      fileMime: upload.contentType,
      fileSize: upload.size,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      position: Date.now(),
    })
    .catch(async (error: unknown) => {
      await deleteObjects("documents", [key]).catch(() => undefined);
      throw error;
    });
  await audit(actor, projectId, "create", "documents", row.title);
  return toMeta(row);
}

export async function updateDocument(
  actor: Actor,
  id: string,
  input: { title?: string; content?: unknown; icon?: string | null },
) {
  const { document, scope } = await requireDocument(actor, id);
  assertCanWrite(actor, scope);
  const row = await repo.updateDocument(db, id, {
    ...(input.title !== undefined ? { title: input.title.trim() || "Untitled" } : {}),
    ...(input.content !== undefined ? { content: input.content } : {}),
    ...(input.icon !== undefined ? { icon: input.icon } : {}),
    updatedBy: actor.userId,
  });
  await audit(actor, document.projectId, "update", "documents", row.title);
  return toMeta(row);
}

export async function moveDocument(actor: Actor, id: string, folderId: string | null) {
  const { document, scope } = await requireDocument(actor, id);
  assertCanWrite(actor, scope);
  await assertFolder(document.projectId, folderId);
  const row = await repo.updateDocument(db, id, { folderId, parentId: null });
  await audit(actor, document.projectId, "update", "documents", row.title);
  return toMeta(row);
}

/** Managers, or the creator while still an editing member; sub-pages and stored files go too. */
export async function deleteDocument(actor: Actor, id: string) {
  const { document, scope } = await requireDocument(actor, id);
  const own = document.createdBy === actor.userId && policy.canWriteProject(actor, scope);
  if (!own && !policy.canManageProject(actor, scope))
    throw new ForbiddenError("Only the author or a project admin can delete this document");
  const files = await repo.subtreeFiles(db, id);
  await repo.deleteDocument(db, id);
  await deleteObjects("documents", files).catch(() => undefined);
  await audit(actor, document.projectId, "delete", "documents", document.title);
}

/** Streams a file-backed document through the API (same-origin for previews). */
export async function streamDocumentFile(
  actor: Actor,
  id: string,
  res: Response,
  download: boolean,
) {
  const { document } = await requireDocument(actor, id);
  if (!document.filePath) throw new NotFoundError("File", "FILE_NOT_FOUND");
  const object = await getObjectStream("documents", document.filePath);
  res.setHeader(
    "Content-Type",
    document.fileMime ?? object.contentType ?? "application/octet-stream",
  );
  if (object.contentLength) res.setHeader("Content-Length", String(object.contentLength));
  res.setHeader(
    "Content-Disposition",
    `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(document.title)}`,
  );
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("Content-Security-Policy", "sandbox");
  await new Promise<void>((resolve, reject) => {
    object.body.on("error", reject);
    res.on("finish", () => resolve());
    object.body.pipe(res);
  });
}

// ------------------------------------------------------------------ folders

export async function createFolder(actor: Actor, projectId: string, name?: string) {
  await requireProjectWriter(actor, projectId);
  const row = await repo.insertFolder(db, {
    projectId,
    name: name?.trim() || "New Folder",
    createdBy: actor.userId,
    position: Date.now(),
  });
  await audit(actor, projectId, "create", "document_folders", row.name);
  return toFolder(row);
}

export async function updateFolder(
  actor: Actor,
  id: string,
  input: { name?: string; position?: number },
) {
  const { folder, scope } = await requireFolder(actor, id);
  assertCanWrite(actor, scope);
  const row = await repo.updateFolder(db, id, {
    ...(input.name !== undefined ? { name: input.name.trim() || "New Folder" } : {}),
    ...(input.position !== undefined ? { position: input.position } : {}),
  });
  await audit(actor, folder.projectId, "update", "document_folders", row.name);
  return toFolder(row);
}

/** Creator (while an editing member) or manager; its documents become ungrouped. */
export async function deleteFolder(actor: Actor, id: string) {
  const { folder, scope } = await requireFolder(actor, id);
  const own = folder.createdBy === actor.userId && policy.canWriteProject(actor, scope);
  if (!own && !policy.canManageProject(actor, scope))
    throw new ForbiddenError("Only the folder's creator or a project admin can delete it");
  await repo.deleteFolder(db, id);
  await audit(actor, folder.projectId, "delete", "document_folders", folder.name);
}
