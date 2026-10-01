import { boolean, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./_shared.js";
import { projects } from "./projects.js";

export const boardColumns = pgTable(
  "board_columns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    orderIndex: integer("order_index").notNull().default(0),
    isDone: boolean("is_done").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("idx_board_columns_project").on(t.projectId, t.orderIndex)],
);
