import { db } from "../../database/client.js";
import { deleteObjects } from "../../integrations/storage/object-storage.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../shared/http/errors.js";
import type { Actor } from "../access/access.types.js";
import { notifyMentions, notifyReply } from "../notifications/dispatch.service.js";
import { attachmentKeysForComment } from "../tickets/attachments.repository.js";
import { commentHasContent, extractMentionIds, parseCommentBody } from "../tickets/rich-text.js";
import { isManager, requireTicketReader, requireTicketWriter } from "../tickets/ticket-access.js";
import * as repo from "./comments.repository.js";

const toDto = (row: repo.CommentRow) => ({
  id: row.id,
  ticketId: row.ticketId,
  parentId: row.parentId,
  authorId: row.authorId,
  body: row.body,
  createdAt: row.createdAt.toISOString(),
});

async function requireComment(ticketId: string, commentId: string) {
  const comment = await repo.findComment(db, commentId);
  if (!comment || comment.ticketId !== ticketId)
    throw new NotFoundError("Comment", "COMMENT_NOT_FOUND");
  return comment;
}

export async function listComments(actor: Actor, ticketId: string) {
  await requireTicketReader(actor, ticketId);
  return (await repo.listForTicket(db, ticketId)).map(toDto);
}

/**
 * Adds a comment (serialized TipTap JSON or text). Replies attach to the top-level comment of the
 * thread. Mention and reply emails are built from the stored body. `allowEmpty` covers comments that
 * consist only of attachments uploaded right after.
 */
export async function addComment(
  actor: Actor,
  ticketId: string,
  input: { body: string; parentId?: string | null; allowEmpty?: boolean },
) {
  const { ticket } = await requireTicketWriter(actor, ticketId);
  if (!input.allowEmpty && !commentHasContent(input.body))
    throw new ValidationError("Write a comment or attach a file");
  let parent: repo.CommentRow | null = null;
  if (input.parentId) {
    parent = await requireComment(ticketId, input.parentId);
    if (parent.parentId) parent = await requireComment(ticketId, parent.parentId);
  }
  const comment = await repo.insert(db, {
    ticketId,
    authorId: actor.userId,
    body: input.body,
    parentId: parent?.id ?? null,
  });
  const { doc, text } = parseCommentBody(comment.body);
  const ref = {
    id: ticket.id,
    projectId: ticket.projectId,
    title: ticket.title,
    code: ticket.code,
  };
  const mentions = doc ? extractMentionIds(doc) : [];
  if (mentions.length > 0)
    await notifyMentions({
      actorId: actor.userId,
      ticket: ref,
      commentText: text,
      mentionedUserIds: mentions,
    });
  if (parent)
    await notifyReply({
      actorId: actor.userId,
      ticket: ref,
      parentAuthorId: parent.authorId,
      commentText: text || "(no text)",
    });
  return toDto(comment);
}

/** Authors edit their own comments; only newly added mentions are notified. */
export async function editComment(actor: Actor, ticketId: string, commentId: string, body: string) {
  const { ticket } = await requireTicketWriter(actor, ticketId);
  const current = await requireComment(ticketId, commentId);
  if (current.authorId !== actor.userId)
    throw new ForbiddenError("Only the author can edit this comment");
  const updated = await repo.updateBody(db, commentId, body);
  const before = new Set(extractMentionIds(parseCommentBody(current.body).doc));
  const { doc, text } = parseCommentBody(body);
  const added = extractMentionIds(doc).filter((id) => !before.has(id));
  if (added.length > 0) {
    await notifyMentions({
      actorId: actor.userId,
      ticket: {
        id: ticket.id,
        projectId: ticket.projectId,
        title: ticket.title,
        code: ticket.code,
      },
      commentText: text,
      mentionedUserIds: added,
    });
  }
  return toDto(updated);
}

/** Author or project manager (source RLS); replies and attachment files go with it. */
export async function deleteComment(actor: Actor, ticketId: string, commentId: string) {
  const { scope } = await requireTicketWriter(actor, ticketId);
  const comment = await requireComment(ticketId, commentId);
  if (comment.authorId !== actor.userId && !isManager(actor, scope))
    throw new ForbiddenError("Only the author or a project admin can delete this comment");
  const replies = (await repo.listForTicket(db, ticketId)).filter(
    (row) => row.parentId === commentId,
  );
  const keys = (
    await Promise.all(
      [commentId, ...replies.map((r) => r.id)].map((id) => attachmentKeysForComment(db, id)),
    )
  ).flat();
  await repo.remove(db, commentId);
  await deleteObjects("attachments", keys).catch(() => undefined);
}
