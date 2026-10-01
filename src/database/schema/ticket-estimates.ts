import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./_shared.js";
import { tickets } from "./tickets.js";

export const ticketEstimates = pgTable(
  "ticket_estimates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    resourceType: text("resource_type").notNull(),
    minutes: integer("minutes").notNull().default(0),
    note: text("note"),
    estimatedAt: timestamp("estimated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index("idx_ticket_estimates_ticket").on(t.ticketId)],
);
