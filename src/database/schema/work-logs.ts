import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tickets } from "./tickets.js";
import { users } from "./users.js";

export const workLogs = pgTable(
  "work_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    // RESTRICT: logged time survives user removal; users with activity are archived instead.
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    minutes: integer("minutes").notNull(),
    note: text("note"),
    resourceType: text("resource_type"),
    loggedAt: timestamp("logged_at", { withTimezone: true }).notNull().defaultNow(),
    jiraWorklogId: text("jira_worklog_id"),
  },
  (t) => [
    check("work_logs_minutes_check", sql`${t.minutes} > 0`),
    index("idx_work_logs_ticket").on(t.ticketId),
    index("idx_work_logs_user").on(t.userId),
    uniqueIndex("work_logs_jira_ref_unique")
      .on(t.ticketId, t.jiraWorklogId)
      .where(sql`${t.jiraWorklogId} IS NOT NULL`),
  ],
);
