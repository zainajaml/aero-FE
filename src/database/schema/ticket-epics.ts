import { index, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./_shared.js";
import { epics } from "./epics.js";
import { tickets } from "./tickets.js";

export const ticketEpics = pgTable(
  "ticket_epics",
  {
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    epicId: uuid("epic_id")
      .notNull()
      .references(() => epics.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.ticketId, t.epicId] }),
    index("idx_ticket_epics_epic").on(t.epicId),
  ],
);
