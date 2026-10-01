import { sql } from "drizzle-orm";
import { check, date, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./_shared.js";
import { users } from "./users.js";

export const TIME_OFF_KINDS = ["holiday", "sick", "other"] as const;

export const timeOff = pgTable(
  "time_off",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("holiday"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    note: text("note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("time_off_kind_check", sql`${t.kind} IN ('holiday', 'sick', 'other')`),
    check("time_off_date_order", sql`${t.endDate} >= ${t.startDate}`),
    index("idx_time_off_user").on(t.userId),
  ],
);
