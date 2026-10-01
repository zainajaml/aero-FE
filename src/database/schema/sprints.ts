import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt } from "./_shared.js";
import { projects } from "./projects.js";

export const SPRINT_STATUSES = ["planned", "active", "completed"] as const;

export const sprints = pgTable(
  "sprints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    goal: text("goal"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    status: text("status").notNull().default("planned"),
    position: doublePrecision("position").notNull().default(0),
    jiraSprintId: text("jira_sprint_id"),
    createdAt: createdAt(),
  },
  (t) => [
    check("sprints_status_check", sql`${t.status} IN ('planned', 'active', 'completed')`),
    index("idx_sprints_project").on(t.projectId),
    uniqueIndex("sprints_jira_ref_unique")
      .on(t.projectId, t.jiraSprintId)
      .where(sql`${t.jiraSprintId} IS NOT NULL`),
  ],
);
