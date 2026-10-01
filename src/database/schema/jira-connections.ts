import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./_shared.js";
import { users } from "./users.js";

/** Per-user Atlassian OAuth connection. Tokens are AES-256-GCM envelopes ("v1.<iv>.<ct>"). */
export const jiraConnections = pgTable("jira_connections", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  cloudId: text("cloud_id").notNull(),
  siteUrl: text("site_url"),
  siteName: text("site_name"),
  accountEmail: text("account_email"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  scope: text("scope"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
