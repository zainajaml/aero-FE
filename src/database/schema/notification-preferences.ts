import { sql } from "drizzle-orm";
import { boolean, jsonb, pgTable, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./_shared.js";
import { users } from "./users.js";

export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  ticketAssignmentEmail: boolean("ticket_assignment_email").notNull().default(true),
  prefs: jsonb("prefs")
    .$type<Record<string, boolean>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
