import { pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { tickets } from "./tickets.js";
import { users } from "./users.js";

export const ticketWatchers = pgTable(
  "ticket_watchers",
  {
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.ticketId, t.userId] })],
);
