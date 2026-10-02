import { createHash, randomBytes } from "node:crypto";

const INVITE_TTL_DAYS = 7;

/** 64 hex chars of randomness; only the hash is stored. */
export function newInvitationToken(): { token: string; tokenHash: string; expiresAt: Date } {
  const token = randomBytes(32).toString("hex");
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
  };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Syntactic check run after rate limiting; malformed and unknown tokens get identical answers. */
export function isWellFormedToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}$/.test(token);
}
