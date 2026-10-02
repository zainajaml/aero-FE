import { env } from "../../config/env.js";
import { db } from "../../database/client.js";
import { logger } from "../../shared/observability/logger.js";
import { displayName } from "../users/names.js";
import { profileName } from "../users/profiles.repository.js";
import * as repo from "./dispatch.repository.js";
import { sendTemplateEmail } from "./email.service.js";
import { TICKET_ASSIGNED_KEY, filterByPreference } from "./preferences.service.js";

// Ticket notifications. Every input comes from stored data (never from client-supplied text), and a
// failed email never fails the ticket/comment write that triggered it.

type TicketRef = { id: string; projectId: string; title: string; code: string };

const ticketUrl = (ticketId: string) => new URL(`/ticket/${ticketId}`, env.APP_URL).toString();

const meta = (kind: string, actorId: string, actorName: string, ticket: TicketRef) => ({
  kind,
  actor_id: actorId,
  actor_name: actorName,
  project_id: ticket.projectId,
  ticket_id: ticket.id,
  ticket_code: ticket.code,
  ticket_title: ticket.title,
});

function preview(text: string): string {
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

async function actorDisplayName(actorId: string) {
  return displayName(await profileName(db, actorId), "Someone");
}

async function safely(label: string, work: () => Promise<number>): Promise<number> {
  try {
    return await work();
  } catch (error) {
    logger.error({ err: error, notification: label }, "notification dispatch failed");
    return 0;
  }
}

/** Emails people @mentioned in a comment who can access the project (not the author). */
export function notifyMentions(input: {
  actorId: string;
  ticket: TicketRef;
  commentText: string;
  mentionedUserIds: string[];
}) {
  return safely("mention", async () => {
    const candidates = input.mentionedUserIds.filter((id) => id !== input.actorId);
    const allowed = await repo.withProjectAccess(db, input.ticket.projectId, candidates);
    const ids = await filterByPreference(allowed, "user-tagged");
    const actorName = await actorDisplayName(input.actorId);
    let sent = 0;
    for (const recipient of await repo.recipients(db, ids)) {
      const result = await sendTemplateEmail({
        template: "comment-mention",
        to: recipient.email,
        data: {
          recipientName: displayName(recipient, ""),
          actorName,
          ticketTitle: input.ticket.title || "a ticket",
          ticketUrl: ticketUrl(input.ticket.id),
          commentPreview: preview(input.commentText),
        },
        metadata: meta("mention", input.actorId, actorName, input.ticket),
      });
      if (result.status === "sent") sent += 1;
    }
    return sent;
  });
}

/** Emails the author of the parent comment about a reply (unless they replied to themselves). */
export function notifyReply(input: {
  actorId: string;
  ticket: TicketRef;
  parentAuthorId: string;
  commentText: string;
}) {
  return safely("reply", async () => {
    if (input.parentAuthorId === input.actorId) return 0;
    const [allowed] = await filterByPreference([input.parentAuthorId], "comment-reply");
    if (!allowed) return 0;
    const [recipient] = await repo.recipients(db, [allowed]);
    if (!recipient) return 0;
    const actorName = await actorDisplayName(input.actorId);
    const result = await sendTemplateEmail({
      template: "comment-mention",
      to: recipient.email,
      data: {
        recipientName: displayName(recipient, ""),
        actorName,
        ticketTitle: input.ticket.title || "a ticket",
        ticketUrl: ticketUrl(input.ticket.id),
        commentPreview: preview(input.commentText),
        replyToComment: true,
      },
      metadata: meta("reply", input.actorId, actorName, input.ticket),
    });
    return result.status === "sent" ? 1 : 0;
  });
}

/** Emails a newly assigned user who can access the project (never for self-assignment). */
export function notifyAssignee(input: { actorId: string; ticket: TicketRef; assigneeId: string }) {
  return safely("assignment", async () => {
    if (input.assigneeId === input.actorId) return 0;
    const [withAccess] = await repo.withProjectAccess(db, input.ticket.projectId, [
      input.assigneeId,
    ]);
    if (!withAccess) return 0;
    const [allowed] = await filterByPreference([withAccess], TICKET_ASSIGNED_KEY);
    if (!allowed) return 0;
    const [recipient] = await repo.recipients(db, [allowed]);
    if (!recipient) return 0;
    const actorName = await actorDisplayName(input.actorId);
    const result = await sendTemplateEmail({
      template: "ticket-assignment",
      to: recipient.email,
      data: {
        recipientName: displayName(recipient, ""),
        actorName,
        ticketTitle: input.ticket.title || "a ticket",
        ticketCode: input.ticket.code,
        ticketUrl: ticketUrl(input.ticket.id),
      },
      metadata: meta("assignment", input.actorId, actorName, input.ticket),
    });
    return result.status === "sent" ? 1 : 0;
  });
}
