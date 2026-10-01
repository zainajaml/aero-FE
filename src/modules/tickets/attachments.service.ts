import { db } from "../../database/client.js";
import {
  deleteObjects,
  putObject,
  signedDownloadUrl,
} from "../../integrations/storage/object-storage.js";
import { ForbiddenError, NotFoundError } from "../../shared/http/errors.js";
import type { Actor } from "../access/access.types.js";
import { objectKeyFor, readUpload } from "../files/upload.js";
import * as repo from "./attachments.repository.js";
import { findComment } from "../comments/comments.repository.js";
import { isManager, requireTicketReader, requireTicketWriter } from "./ticket-access.js";

const toDto = (row: repo.AttachmentRow) => ({
  id: row.id,
  ticketId: row.ticketId,
  commentId: row.commentId,
  context: row.context as "description" | "comment",
  name: row.name,
  mime: row.mime,
  size: row.size,
  storagePath: row.storagePath,
  uploadedBy: row.uploadedBy,
  createdAt: row.createdAt.toISOString(),
});

export async function listAttachments(actor: Actor, ticketId: string) {
  await requireTicketReader(actor, ticketId);
  return (await repo.listForTicket(db, ticketId)).map(toDto);
}

/** Stores the file under `<ticketId>/<uuid>-<name>` and records it on the ticket (or one of its comments). */
export async function uploadAttachment(
  actor: Actor,
  ticketId: string,
  file: Express.Multer.File | undefined,
  commentId: string | null,
) {
  await requireTicketWriter(actor, ticketId);
  if (commentId) {
    const comment = await findComment(db, commentId);
    if (!comment || comment.ticketId !== ticketId)
      throw new NotFoundError("Comment", "COMMENT_NOT_FOUND");
    if (comment.authorId !== actor.userId)
      throw new ForbiddenError("Only the comment author can attach files to it");
  }
  const upload = await readUpload(file);
  const key = objectKeyFor(ticketId, upload.originalName);
  await putObject("attachments", key, upload.buffer, upload.contentType);
  const row = await repo
    .insert(db, {
      ticketId,
      commentId,
      context: commentId ? "comment" : "description",
      storagePath: key,
      name: upload.originalName.slice(0, 255),
      mime: upload.contentType,
      size: upload.size,
      uploadedBy: actor.userId,
    })
    .catch(async (error: unknown) => {
      await deleteObjects("attachments", [key]).catch(() => undefined);
      throw error;
    });
  return toDto(row);
}

/** Download URL with an attachment disposition (prevents inline rendering of uploaded HTML/SVG). */
export async function attachmentUrl(actor: Actor, ticketId: string, attachmentId: string) {
  await requireTicketReader(actor, ticketId);
  const row = await repo.findForTicket(db, ticketId, attachmentId);
  if (!row) throw new NotFoundError("Attachment", "ATTACHMENT_NOT_FOUND");
  return { url: await signedDownloadUrl("attachments", row.storagePath, row.name) };
}

/** Uploader or project manager; removes the stored object together with the row. */
export async function deleteAttachment(actor: Actor, ticketId: string, attachmentId: string) {
  const { scope } = await requireTicketWriter(actor, ticketId);
  const row = await repo.findForTicket(db, ticketId, attachmentId);
  if (!row) throw new NotFoundError("Attachment", "ATTACHMENT_NOT_FOUND");
  if (row.uploadedBy !== actor.userId && !isManager(actor, scope))
    throw new ForbiddenError("Only the uploader or a project admin can remove this file");
  await repo.remove(db, attachmentId);
  await deleteObjects("attachments", [row.storagePath]).catch(() => undefined);
}
