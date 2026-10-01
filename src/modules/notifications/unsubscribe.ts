import { createHmac, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { env } from "../../config/env.js";
import { db } from "../../database/client.js";
import { suppressedEmails } from "../../database/schema/index.js";

// Unsubscribe tokens are `base64url(email).hmac` signed with AUTH_SECRET: links in old emails keep
// working, nothing secret is stored, and a token only ever unsubscribes the address it was minted for.

const sign = (payload: string) =>
  createHmac("sha256", `${env.AUTH_SECRET}:unsubscribe`).update(payload).digest("base64url");

export function unsubscribeToken(email: string): string {
  const payload = Buffer.from(email.trim().toLowerCase()).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function emailFromToken(token: string): string | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature || signature.length > 64) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return Buffer.from(payload, "base64url").toString("utf8");
}

export const unsubscribeLinks = (email: string) => {
  const token = encodeURIComponent(unsubscribeToken(email));
  return {
    page: `${env.APP_URL}/unsubscribe?token=${token}`,
    oneClick: `${env.API_URL}/api/v1/email/unsubscribe?token=${token}`,
  };
};

export async function isSuppressedEmail(email: string): Promise<boolean> {
  const rows = await db
    .select({ id: suppressedEmails.id })
    .from(suppressedEmails)
    .where(sql`lower(${suppressedEmails.email}) = lower(${email})`)
    .limit(1);
  return rows.length > 0;
}

/** Idempotent: returns false when the address was already unsubscribed. */
export async function suppress(
  email: string,
  reason: string,
  metadata?: Record<string, unknown>,
): Promise<boolean> {
  const rows = await db
    .insert(suppressedEmails)
    .values({ email: email.toLowerCase(), reason, metadata })
    .onConflictDoNothing()
    .returning({ id: suppressedEmails.id });
  return rows.length > 0;
}
