import { db } from "../../database/client.js";
import { deleteObjects, putObject } from "../../integrations/storage/object-storage.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../shared/http/errors.js";
import * as policy from "../access/access.policy.js";
import type { Actor } from "../access/access.types.js";
import { INLINE_IMAGE_TYPES, VIDEO_TYPES, objectKeyFor, readUpload } from "../files/upload.js";
import { commentHasContent } from "../tickets/rich-text.js";
import { displayName } from "../users/names.js";
import * as notify from "./support.notifications.js";
import * as repo from "./support.repository.js";

const isAdmin = (actor: Actor) => policy.isSuperAdmin(actor);

const toIssue = (row: Awaited<ReturnType<typeof repo.listIssues>>[number]) => ({
  id: row.id,
  ticketNumber: row.ticketNumber,
  subject: row.subject,
  status: row.status as "open" | "closed",
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  owner: {
    id: row.userId,
    name: displayName(
      {
        fullName: row.ownerFullName,
        firstName: row.ownerFirstName,
        lastName: row.ownerLastName,
        email: row.ownerEmail,
      },
      "Unknown",
    ),
    avatarUrl: row.ownerAvatarUrl,
  },
});

/** Owner or super admin; anything else is the same 404. */
async function requireIssue(actor: Actor, issueId: string) {
  const issue = await repo.findIssue(db, issueId);
  if (!issue || (issue.userId !== actor.userId && !isAdmin(actor)))
    throw new NotFoundError("Support ticket", "SUPPORT_ISSUE_NOT_FOUND");
  return issue;
}

export async function listIssues(
  actor: Actor,
  filter: { status?: "open" | "closed"; ascending: boolean },
) {
  const rows = await repo.listIssues(db, {
    ...filter,
    ownerId: isAdmin(actor) ? undefined : actor.userId,
  });
  return rows.map(toIssue);
}

export async function openCount(actor: Actor) {
  return { count: await repo.countOpen(db, isAdmin(actor) ? undefined : actor.userId) };
}

/** Creates the ticket and its optional first message in one transaction; admins are alerted after commit. */
export async function createIssue(
  actor: Actor,
  input: { subject: string; description?: string | null },
) {
  const description =
    input.description && commentHasContent(input.description) ? input.description : null;
  const { issue, message } = await db.transaction(async (tx) => {
    const created = await repo.insertIssue(tx, actor.userId, input.subject.trim());
    const first = description
      ? await repo.insertMessage(tx, {
          issueId: created.id,
          authorId: actor.userId,
          body: description,
        })
      : null;
    return { issue: created, message: first };
  });
  if (!isAdmin(actor))
    await notify.alertAdmins({
      actorId: actor.userId,
      issue,
      kind: "new_ticket",
      body: input.subject,
    });
  return {
    issue: toIssue((await repo.findIssueView(db, issue.id))!),
    messageId: message?.id ?? null,
  };
}

export async function getIssue(actor: Actor, issueId: string) {
  await requireIssue(actor, issueId);
  const issue = (await repo.findIssueView(db, issueId))!;
  const messages = await repo.listMessages(db, issueId);
  return {
    issue: toIssue(issue),
    messages: messages.map(({ message, ...author }) => ({
      id: message.id,
      authorId: message.authorId,
      author: { name: displayName(author, "Unknown"), avatarUrl: author.avatarUrl },
      body: message.body,
      attachmentKey: message.imagePath,
      createdAt: message.createdAt.toISOString(),
      editedAt: message.editedAt?.toISOString() ?? null,
      canEdit: message.authorId === actor.userId && issue.status === "open",
    })),
  };
}

/** Posts a message (optionally with an image/video stored under the issue) and routes the notification. */
export async function postMessage(
  actor: Actor,
  issueId: string,
  body: string,
  file: Express.Multer.File | undefined,
) {
  const issue = await requireIssue(actor, issueId);
  if (!commentHasContent(body) && !file)
    throw new ValidationError("Write a message or attach a file");
  let key: string | null = null;
  if (file) {
    const upload = await readUpload(file, [...INLINE_IMAGE_TYPES, ...VIDEO_TYPES]);
    key = objectKeyFor(issueId, upload.originalName);
    await putObject("support", key, upload.buffer, upload.contentType);
  }
  const message = await db
    .transaction(async (tx) => {
      const inserted = await repo.insertMessage(tx, {
        issueId,
        authorId: actor.userId,
        body,
        imagePath: key,
      });
      await repo.touchIssue(tx, issueId);
      return inserted;
    })
    .catch(async (error: unknown) => {
      if (key) await deleteObjects("support", [key]).catch(() => undefined);
      throw error;
    });
  if (isAdmin(actor)) await notify.notifyRequester({ actorId: actor.userId, issue, body });
  else await notify.alertAdmins({ actorId: actor.userId, issue, kind: "new_message", body });
  return { id: message.id, createdAt: message.createdAt.toISOString(), attachmentKey: key };
}

/** Authors edit their own messages while the ticket is open. */
export async function editMessage(actor: Actor, issueId: string, messageId: string, body: string) {
  const issue = await requireIssue(actor, issueId);
  const message = await repo.findMessage(db, issueId, messageId);
  if (!message) throw new NotFoundError("Message", "SUPPORT_MESSAGE_NOT_FOUND");
  if (message.authorId !== actor.userId)
    throw new ForbiddenError("Only the author can edit this message");
  if (issue.status !== "open")
    throw new ConflictError("Closed tickets cannot be edited", "SUPPORT_ISSUE_CLOSED");
  if (!commentHasContent(body) && !message.imagePath)
    throw new ValidationError("A message cannot be empty");
  const updated = await repo.updateMessageBody(db, messageId, body);
  return { id: updated.id, editedAt: updated.editedAt!.toISOString() };
}

export async function setStatus(actor: Actor, issueId: string, status: "open" | "closed") {
  await requireIssue(actor, issueId);
  await repo.setIssueStatus(db, issueId, status);
  return getIssue(actor, issueId).then((result) => result.issue);
}

export async function deleteIssue(actor: Actor, issueId: string) {
  await requireIssue(actor, issueId);
  const keys = await repo.attachmentKeys(db, issueId);
  await repo.deleteIssue(db, issueId);
  await deleteObjects("support", keys).catch(() => undefined);
}
