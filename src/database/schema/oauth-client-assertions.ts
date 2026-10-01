import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

/** Single-use `private_key_jwt` assertion markers (model "oauthClientAssertion"). */
export const oauthClientAssertions = pgTable("oauth_client_assertions", {
  id: uuid("id").primaryKey().defaultRandom(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
