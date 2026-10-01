import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./_shared.js";
import { boardColumns } from "./board-columns.js";
import { projects } from "./projects.js";
import { sprints } from "./sprints.js";
import { users } from "./users.js";

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sprintId: uuid("sprint_id").references(() => sprints.id, { onDelete: "set null" }),
    columnId: uuid("column_id").references(() => boardColumns.id, { onDelete: "set null" }),
    code: text("code").notNull(),
    title: text("title").notNull(),
    descriptionJson: jsonb("description_json"),
    type: text("type").notNull().default("task"),
    priority: text("priority").notNull().default("medium"),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    reporterId: uuid("reporter_id").references(() => users.id, { onDelete: "set null" }),
    estimateMinutes: integer("estimate_minutes").notNull().default(0),
    storyPoints: integer("story_points"),
    position: numeric("position", { mode: "number" }).notNull().default(0),
    dueDate: date("due_date"),
    released: boolean("released").notNull().default(false),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    jiraIssueId: text("jira_issue_id"),
    jiraIssueKey: text("jira_issue_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("tickets_project_id_code_key").on(t.projectId, t.code),
    index("idx_tickets_project_created").on(t.projectId, t.createdAt.desc()),
    index("idx_tickets_sprint").on(t.sprintId),
    index("idx_tickets_column").on(t.columnId),
    index("idx_tickets_assignee").on(t.assigneeId),
    uniqueIndex("tickets_jira_ref_unique")
      .on(t.projectId, t.jiraIssueId)
      .where(sql`${t.jiraIssueId} IS NOT NULL`),
  ],
);
