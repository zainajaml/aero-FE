import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { appRole, createdAt } from "./_shared.js";
import { projects } from "./projects.js";
import { users } from "./users.js";

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    role: appRole("role").notNull(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    projectIds: uuid("project_ids").array(),
    accountIds: uuid("account_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    jobTitle: text("job_title"),
    // SHA-256 of the emailed token; the raw token is never stored.
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("invitations_email_lower_idx").on(sql`lower(${t.email})`)],
);
