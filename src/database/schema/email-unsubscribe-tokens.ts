import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./_shared.js";

export const emailUnsubscribeTokens = pgTable(
  "email_unsubscribe_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    // SHA-256 of the token embedded in the unsubscribe link.
    tokenHash: text("token_hash").notNull().unique(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("email_unsubscribe_tokens_email_lower_key").on(sql`lower(${t.email})`)],
);
