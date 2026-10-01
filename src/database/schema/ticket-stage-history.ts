import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./_shared.js";
import { boardColumns } from "./board-columns.js";
import { projects } from "./projects.js";
import { tickets } from "./tickets.js";
import { users } from "./users.js";

export const ticketStageHistory = pgTable(
  "ticket_stage_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    columnId: uuid("column_id").references(() => boardColumns.id, { onDelete: "set null" }),
    columnName: text("column_name").notNull(),
    enteredAt: timestamp("entered_at", { withTimezone: true }).notNull().defaultNow(),
    movedBy: uuid("moved_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("idx_tsh_ticket").on(t.ticketId, t.enteredAt),
    index("idx_tsh_project").on(t.projectId),
  ],
);
