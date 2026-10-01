import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./_shared.js";
import { users } from "./users.js";

export const TIMEZONES = ["PKT", "IST", "AEST"] as const;

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    fullName: text("full_name"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    avatarUrl: text("avatar_url"),
    email: text("email"),
    jobTitle: text("job_title"),
    timezone: text("timezone").notNull().default("PKT"),
    isProvisional: boolean("is_provisional").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: uuid("archived_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    check("profiles_timezone_check", sql`${t.timezone} IN ('PKT', 'IST', 'AEST')`),
    index("profiles_archived_at_idx").on(t.archivedAt),
    index("profiles_email_lower_idx").on(sql`lower(${t.email})`),
  ],
);
