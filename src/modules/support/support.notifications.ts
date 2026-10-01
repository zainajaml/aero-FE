import { env } from "../../config/env.js";
import { db } from "../../database/client.js";
import { RateLimitedError } from "../../shared/http/errors.js";
import { logger } from "../../shared/observability/logger.js";
import { LIMITS, enforceRateLimit } from "../../shared/security/rate-limit.js";
import { sendTemplateEmail } from "../notifications/email.service.js";
import { providerSendDelayMs } from "../notifications/email.repository.js";
import { findProfile } from "../users/profiles.repository.js";
import { displayName } from "../users/names.js";
import { parseCommentBody } from "../tickets/rich-text.js";
import * as repo from "./support.repository.js";

const supportUrl = () => env.APP_URL;
const previewOf = (body: string, max: number) => {
  const text = parseCommentBody(body).text.trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Requester activity → every super admin (rate limited per issue, paced by send_delay_ms). */
export async function alertAdmins(input: {
  actorId: string;
  issue: repo.IssueRow;
  kind: "new_ticket" | "new_message";
  body: string;
}) {
  try {
    await enforceRateLimit({
      namespace: "support:notify:issue",
      identifier: input.issue.id,
      windows: LIMITS.supportNotifyIssue,
    });
    const admins = (await repo.superAdmins(db)).filter((admin) => admin.id !== input.actorId);
    if (admins.length === 0) return;
    const requester = await findProfile(db, input.issue.userId);
    const delay = Math.min(Math.max(await providerSendDelayMs(db), 0), 2_000);
    for (const [index, admin] of admins.entries()) {
      if (index > 0 && delay > 0) await sleep(delay);
      await sendTemplateEmail({
        template: "support-admin-alert",
        to: admin.email,
        data: {
          kind: input.kind,
          subject: input.issue.subject,
          ticketNumber: input.issue.ticketNumber,
          requesterName: displayName(requester, requester?.email ?? "A user"),
          messagePreview: previewOf(input.body, 280),
          supportUrl: supportUrl(),
        },
        metadata: {
          support_issue_id: input.issue.id,
          actor_id: input.actorId,
          kind: `support_${input.kind}`,
        },
      });
    }
  } catch (error) {
    if (!(error instanceof RateLimitedError))
      logger.error({ err: error }, "support admin alert failed");
  }
}

/** Admin reply → the requester (never to themselves). */
export async function notifyRequester(input: {
  actorId: string;
  issue: repo.IssueRow;
  body: string;
}) {
  if (input.issue.userId === input.actorId) return;
  try {
    await enforceRateLimit({
      namespace: "support:notify:issue",
      identifier: input.issue.id,
      windows: LIMITS.supportNotifyIssue,
    });
    const owner = await findProfile(db, input.issue.userId);
    if (!owner?.email) return;
    await sendTemplateEmail({
      template: "support-reply",
      to: owner.email,
      data: {
        subject: input.issue.subject,
        replyPreview: previewOf(input.body, 280),
        supportUrl: supportUrl(),
        recipientName: displayName(owner, ""),
      },
      metadata: {
        support_issue_id: input.issue.id,
        actor_id: input.actorId,
        kind: "support_reply",
      },
    });
  } catch (error) {
    if (!(error instanceof RateLimitedError))
      logger.error({ err: error }, "support reply notification failed");
  }
}
