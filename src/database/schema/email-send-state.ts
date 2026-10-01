import { sql } from "drizzle-orm";
import { check, integer, pgTable, timestamp } from "drizzle-orm/pg-core";
import { updatedAt } from "./_shared.js";

/** Singleton row (id = 1) holding provider-wide sending backoff and pacing. */
export const emailSendState = pgTable(
  "email_send_state",
  {
    id: integer("id").primaryKey().default(1),
    retryAfterUntil: timestamp("retry_after_until", { withTimezone: true }),
    /** Pause between messages of one fan-out send (provider pacing), capped at 2s by the sender. */
    sendDelayMs: integer("send_delay_ms").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [check("email_send_state_singleton", sql`${t.id} = 1`)],
);
