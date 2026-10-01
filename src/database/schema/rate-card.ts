import { sql } from "drizzle-orm";
import { index, numeric, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./_shared.js";
import { projects } from "./projects.js";

export const rateCard = pgTable(
  "rate_card",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    location: text("location"),
    hourlyRate: numeric("hourly_rate", { precision: 10, scale: 2 }).notNull().default("0"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("rate_card_project_role_location_key").on(
      t.projectId,
      t.role,
      sql`coalesce(${t.location}, '')`,
    ),
    index("rate_card_project_idx").on(t.projectId),
  ],
);
