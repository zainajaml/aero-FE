import { lt } from "drizzle-orm";
import { db, type DbExecutor } from "../../database/client.js";
import {
  oauthAccessTokens,
  oauthRefreshTokens,
  rateLimitCounters,
  verifications,
} from "../../database/schema/index.js";
import { logger } from "../../shared/observability/logger.js";

const HOUR = 60 * 60 * 1000;

/** Deletes rows that can never be used again: finished rate-limit windows and expired auth tokens. */
export async function purgeExpiredRows(executor: DbExecutor = db, now = new Date()) {
  const counts = await Promise.all(
    [rateLimitCounters, verifications, oauthAccessTokens, oauthRefreshTokens].map(async (table) => {
      const deleted = await executor
        .delete(table)
        .where(lt(table.expiresAt, now))
        .returning({ expiresAt: table.expiresAt });
      return deleted.length;
    }),
  );
  const [rateLimits, verificationRows, accessTokens, refreshTokens] = counts;
  return { rateLimits, verifications: verificationRows, accessTokens, refreshTokens };
}

/**
 * Runs the purge hourly in-process (replaces Supabase's opportunistic purge). Deletes are
 * idempotent, so several API instances running it concurrently is harmless.
 */
export function startMaintenance() {
  const run = () =>
    purgeExpiredRows()
      .then((result) => logger.info({ purged: result }, "expired rows purged"))
      .catch((error: unknown) => logger.warn({ err: error }, "expired-row purge failed"));
  const timer = setInterval(run, HOUR);
  timer.unref();
  void run();
  return () => clearInterval(timer);
}
