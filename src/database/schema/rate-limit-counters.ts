import { index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { updatedAt } from "./_shared.js";

export const rateLimitCounters = pgTable(
  "rate_limit_counters",
  {
    namespace: text("namespace").notNull(),
    identifierHash: text("identifier_hash").notNull(),
    windowSeconds: integer("window_seconds").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    requestCount: integer("request_count").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.namespace, t.identifierHash, t.windowSeconds, t.windowStart] }),
    index("rate_limit_counters_expires_at_idx").on(t.expiresAt),
  ],
);
