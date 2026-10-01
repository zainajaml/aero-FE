import { db } from "../../database/client.js";
import { emailSendLog } from "../../database/schema/index.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../shared/http/errors.js";
import { LIMITS, enforceRateLimit } from "../../shared/security/rate-limit.js";
import * as policy from "../access/access.policy.js";
import { requireAdminScope } from "../access/access.service.js";
import type { Actor } from "../access/access.types.js";
import { deliverLogged } from "./email.service.js";
import { insertEmailLog } from "./email.repository.js";
import * as repo from "./log.repository.js";
import { isSuppressedEmail } from "./unsubscribe.js";

/** Admin scope (super, account or project admin), or null for everyone else. */
const adminScope = (actor: Actor) => requireAdminScope(actor).catch(() => null);

/**
 * Super admins see every message; account and project admins see mail addressed to them, mail about
 * tickets in projects they administer and invitations they sent; everyone else sees their own mail
 * minus mail they triggered themselves.
 */
async function visibility(actor: Actor, personalFeed: boolean): Promise<repo.LogVisibility> {
  if (policy.isSuperAdmin(actor) && !personalFeed) return { all: true };
  const scope = personalFeed ? null : await adminScope(actor);
  return {
    email: actor.email,
    projectIds: scope?.projectIds ?? [],
    actorId: actor.userId,
    hideOwnActions: personalFeed || !scope,
  };
}

const toRow = (row: Awaited<ReturnType<typeof repo.listLog>>["rows"][number]) => {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof meta[key] === "string" ? (meta[key] as string) : null);
  return {
    id: row.id,
    templateName: row.templateName,
    recipient: row.recipientEmail,
    status: row.status,
    subject: row.subject,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    kind: text("kind"),
    author: text("actor_name"),
    projectId: text("project_id"),
    ticketId: text("ticket_id"),
    ticketCode: text("ticket_code"),
    ticketTitle: text("ticket_title"),
  };
};

export async function listNotifications(
  actor: Actor,
  q: { projectId?: string; failedOnly?: boolean; search?: string; page: number; pageSize: number },
) {
  const result = await repo.listLog(db, {
    visibility: await visibility(actor, false),
    projectId: q.projectId,
    failedOnly: q.failedOnly,
    search: q.search,
    limit: q.pageSize,
    offset: (q.page - 1) * q.pageSize,
  });
  return { items: result.rows.map(toRow), total: result.total, failedCount: result.failed };
}

/** Personal feed badge: mail addressed to the caller since a timestamp, excluding their own actions. */
export async function unseenCount(actor: Actor, since?: Date) {
  return { count: await repo.countLog(db, { visibility: await visibility(actor, true), since }) };
}

export async function notificationDetail(actor: Actor, id: string) {
  const row = await repo.findLogRow(db, id, await visibility(actor, false));
  if (!row) throw new NotFoundError("Notification", "NOTIFICATION_NOT_FOUND");
  return { ...toRow(row), html: row.html };
}

/** Re-sends a failed message exactly as composed (admins, within their scope, rate limited). */
export async function retryNotification(actor: Actor, id: string) {
  if (!(await adminScope(actor))) throw new ForbiddenError("Only admins can retry notifications");
  await enforceRateLimit({
    namespace: "email:retry:actor",
    identifier: actor.userId,
    windows: LIMITS.emailRetryActor,
  });
  const row = await repo.findLogRow(db, id, await visibility(actor, false));
  if (!row) throw new NotFoundError("Notification", "NOTIFICATION_NOT_FOUND");
  if (row.status !== "failed")
    throw new ConflictError("Only failed notifications can be retried", "NOT_RETRYABLE");
  if (!row.html || !row.subject)
    throw new ConflictError("The original message content is not available", "NO_STORED_CONTENT");
  if (await isSuppressedEmail(row.recipientEmail))
    throw new ConflictError("The recipient has unsubscribed or bounced", "EMAIL_SUPPRESSED");
  const logId = await insertEmailLog(db, {
    templateName: row.templateName,
    recipientEmail: row.recipientEmail,
    status: "pending",
    subject: row.subject,
    html: row.html,
    metadata: {
      ...(row.metadata ?? {}),
      retry_of: row.id,
      retried_by: actor.userId,
    } satisfies typeof emailSendLog.$inferInsert.metadata,
  });
  const html = row.html;
  const result = await deliverLogged(logId, {
    to: row.recipientEmail,
    subject: row.subject,
    html,
    text: html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  });
  return { status: result.status, logId };
}
