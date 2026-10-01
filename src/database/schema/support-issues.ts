import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./_shared.js";
import { users } from "./users.js";

export const SUPPORT_STATUSES = ["open", "closed"] as const;

export const supportIssues = pgTable(
  "support_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    status: text("status").notNull().default("open"),
    // Filled by the trg_set_support_ticket_number trigger when omitted.
    ticketNumber: text("ticket_number")
      .notNull()
      .$default(() => ""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("support_issues_status_check", sql`${t.status} IN ('open', 'closed')`),
    uniqueIndex("support_issues_ticket_number_key").on(t.ticketNumber),
    index("idx_support_issues_user").on(t.userId),
    index("idx_support_issues_status").on(t.status),
  ],
);
