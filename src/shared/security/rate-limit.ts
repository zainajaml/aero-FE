import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { sql } from "drizzle-orm";
import { db } from "../../database/client.js";
import { RateLimitedError } from "../http/errors.js";
import { logger } from "../observability/logger.js";

export type RateWindow = { limit: number; windowSeconds: number };

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Every limiter budget in one place (ported from the source LIMITS table, plus auth endpoints). */
export const LIMITS = {
  authSignIn: [
    { limit: 10, windowSeconds: 10 * MINUTE },
    { limit: 50, windowSeconds: DAY },
  ],
  authSignUp: [
    { limit: 10, windowSeconds: HOUR },
    { limit: 30, windowSeconds: DAY },
  ],
  authEmailAction: [
    { limit: 5, windowSeconds: 10 * MINUTE },
    { limit: 20, windowSeconds: DAY },
  ],
  // OAuth endpoints used by MCP clients, per IP. Many users connect through the same hosted
  // clients (e.g. Claude), so these stay generous while still bounding open registration.
  oauthRegister: [
    { limit: 20, windowSeconds: 10 * MINUTE },
    { limit: 200, windowSeconds: DAY },
  ],
  oauthToken: [{ limit: 120, windowSeconds: MINUTE }],
  mcpRead: [{ limit: 60, windowSeconds: MINUTE }],
  mcpCreate: [
    { limit: 10, windowSeconds: MINUTE },
    { limit: 100, windowSeconds: DAY },
  ],
  inviteCreateActor: [
    { limit: 10, windowSeconds: MINUTE },
    { limit: 100, windowSeconds: DAY },
  ],
  inviteCreateAccount: [{ limit: 200, windowSeconds: DAY }],
  inviteResendInvitation: [
    { limit: 3, windowSeconds: 10 * MINUTE },
    { limit: 10, windowSeconds: DAY },
  ],
  inviteResendActor: [{ limit: 20, windowSeconds: HOUR }],
  invitePublicLookup: [
    { limit: 20, windowSeconds: 10 * MINUTE },
    { limit: 60, windowSeconds: DAY },
  ],
  invitePublicAccept: [
    { limit: 5, windowSeconds: 10 * MINUTE },
    { limit: 20, windowSeconds: DAY },
  ],
  invitePublicSource: [
    { limit: 30, windowSeconds: 10 * MINUTE },
    { limit: 200, windowSeconds: DAY },
  ],
  aiSummaryUser: [
    { limit: 10, windowSeconds: MINUTE },
    { limit: 120, windowSeconds: DAY },
  ],
  emailRecipient: [
    { limit: 12, windowSeconds: 10 * MINUTE },
    { limit: 60, windowSeconds: DAY },
  ],
  emailRetryActor: [
    { limit: 10, windowSeconds: 10 * MINUTE },
    { limit: 60, windowSeconds: DAY },
  ],
  supportNotifyIssue: [
    { limit: 10, windowSeconds: 10 * MINUTE },
    { limit: 60, windowSeconds: DAY },
  ],
} satisfies Record<string, RateWindow[]>;

export type RateLimitInput = {
  namespace: string;
  /** Trusted identity for the counter (user id, invitation id, IP). Never client-chosen. */
  identifier: string;
  windows: RateWindow[];
  cost?: number;
  /** When the counter store fails: true rejects the request, false allows it and logs. */
  failClosed?: boolean;
};

const SALT = "aero-zenith-flow:rate-limit:v1";

function hashIdentifier(namespace: string, identifier: string): string {
  return createHash("sha256").update(`${SALT}|${namespace}|${identifier}`).digest("hex");
}

/** Consumes one unit in every window and throws RateLimitedError when any window is exhausted. */
export async function enforceRateLimit(input: RateLimitInput): Promise<void> {
  const identifierHash = hashIdentifier(input.namespace, input.identifier);
  const windows = [...input.windows].sort((a, b) => a.windowSeconds - b.windowSeconds);

  for (const window of windows) {
    let row: { allowed: boolean; reset_at: Date | string } | undefined;
    try {
      const result = await db.execute<{ allowed: boolean; reset_at: Date | string }>(
        sql`select allowed, reset_at from public.consume_rate_limit(
          ${input.namespace}, ${identifierHash}, ${window.windowSeconds}, ${window.limit}, ${input.cost ?? 1})`,
      );
      row = result.rows[0];
      if (!row) throw new Error("empty rate-limit response");
    } catch (error) {
      logger.error({ err: error, namespace: input.namespace }, "rate-limit store unavailable");
      if (input.failClosed ?? true) throw new RateLimitedError(30);
      return;
    }
    if (!row.allowed) {
      const resetAt = new Date(row.reset_at).getTime();
      throw new RateLimitedError(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)));
    }
  }
}

/** Express middleware limiting by client IP (and optionally a body field such as email). */
export function rateLimitByRequest(
  namespace: string,
  windows: RateWindow[],
  bodyKey?: string,
): RequestHandler {
  return (req, _res, next) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const keyed =
      bodyKey && typeof body[bodyKey] === "string" ? String(body[bodyKey]).toLowerCase() : "";
    enforceRateLimit({ namespace, identifier: `${req.ip ?? "unknown"}|${keyed}`, windows })
      .then(() => next())
      .catch(next);
  };
}
