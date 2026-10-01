import { createElement } from "react";
import { render } from "@react-email/render";
import pRetry, { AbortError } from "p-retry";
import { db } from "../../database/client.js";
import { emailTransport } from "../../integrations/email/transport.js";
import { RateLimitedError } from "../../shared/http/errors.js";
import { logger } from "../../shared/observability/logger.js";
import { LIMITS, enforceRateLimit } from "../../shared/security/rate-limit.js";
import * as repo from "./email.repository.js";
import { unsubscribeLinks } from "./unsubscribe.js";
import { TEMPLATES, type TemplateName } from "./templates/registry.js";
import type { TemplateEntry } from "./templates/template-entry.js";

export const SITE_NAME = "Space Scope";

/** Optional notification mail carries one-click unsubscribe headers (RFC 8058); account mail does not. */
const UNSUBSCRIBABLE = new Set<TemplateName>([
  "comment-mention",
  "ticket-assignment",
  "support-reply",
  "support-admin-alert",
]);

export type SendEmailInput = {
  template: TemplateName;
  to: string;
  data: Record<string, unknown>;
  /** Extra context stored with the log row (ticket id, project id, ...). Never secrets. */
  metadata?: Record<string, unknown>;
  /** Auth emails skip the per-recipient budget; their endpoints are rate limited instead. */
  skipRecipientLimit?: boolean;
};

export type SendEmailResult = {
  status: "sent" | "suppressed" | "rate_limited" | "deferred" | "failed";
  logId?: string;
};

const PROVIDER_BACKOFF_MS = 5 * 60 * 1000;

function isTransient(error: unknown): boolean {
  const smtp = error as { responseCode?: number; code?: string };
  if (typeof smtp.responseCode === "number")
    return smtp.responseCode >= 400 && smtp.responseCode < 500;
  return ["ECONNECTION", "ETIMEDOUT", "ECONNRESET", "ESOCKET", "EDNS"].includes(smtp.code ?? "");
}

async function renderTemplate(template: TemplateName, data: Record<string, unknown>) {
  const entry: TemplateEntry = TEMPLATES[template];
  const element = createElement(entry.component, data);
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  const subject = typeof entry.subject === "function" ? entry.subject(data) : entry.subject;
  return { html, text, subject };
}

/**
 * Renders, logs and delivers one email. Expected non-delivery outcomes (suppressed recipient,
 * exhausted per-recipient budget, provider backoff) are logged and returned, never thrown, so a
 * notification failure never undoes the business action that triggered it.
 */
export async function sendTemplateEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const to = input.to.trim().toLowerCase();
  const { html, text, subject } = await renderTemplate(input.template, input.data);
  const base = {
    templateName: input.template,
    recipientEmail: to,
    subject,
    html,
    metadata: input.metadata,
  };

  if (await repo.isSuppressed(db, to)) {
    const logId = await repo.insertEmailLog(db, { ...base, status: "suppressed" });
    return { status: "suppressed", logId };
  }
  if (!input.skipRecipientLimit) {
    try {
      await enforceRateLimit({
        namespace: "email:recipient",
        identifier: to,
        windows: LIMITS.emailRecipient,
        failClosed: false,
      });
    } catch (error) {
      if (!(error instanceof RateLimitedError)) throw error;
      const logId = await repo.insertEmailLog(db, {
        ...base,
        status: "failed",
        errorMessage: "recipient rate limit",
      });
      return { status: "rate_limited", logId };
    }
  }
  const backoffUntil = await repo.providerBackoffUntil(db);
  if (backoffUntil && backoffUntil > new Date()) {
    const logId = await repo.insertEmailLog(db, {
      ...base,
      status: "failed",
      errorMessage: "provider backoff",
    });
    return { status: "deferred", logId };
  }

  const logId = await repo.insertEmailLog(db, { ...base, status: "pending" });
  const links = UNSUBSCRIBABLE.has(input.template) ? unsubscribeLinks(to) : null;
  const headers = links
    ? {
        "List-Unsubscribe": `<${links.oneClick}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      }
    : undefined;
  return deliverLogged(logId, { to, subject, html, text, ...(headers ? { headers } : {}) });
}

/** Delivers an already-logged message with bounded retries; used for first sends and admin retries. */
export async function deliverLogged(
  logId: string,
  message: {
    to: string;
    subject: string;
    html: string;
    text: string;
    headers?: Record<string, string>;
  },
): Promise<SendEmailResult> {
  try {
    const { messageId } = await pRetry(
      async () => {
        try {
          return await emailTransport.send(message);
        } catch (error) {
          if (!isTransient(error)) throw new AbortError(error as Error);
          throw error;
        }
      },
      { retries: 2, minTimeout: 500, maxTimeout: 4000, randomize: true },
    );
    await repo.updateEmailLog(db, logId, { status: "sent", messageId });
    return { status: "sent", logId };
  } catch (error) {
    if (isTransient(error))
      await repo.setProviderBackoff(db, new Date(Date.now() + PROVIDER_BACKOFF_MS));
    logger.error({ err: error, logId }, "email delivery failed");
    await repo.updateEmailLog(db, logId, { status: "failed", errorMessage: "delivery failed" });
    return { status: "failed", logId };
  }
}
