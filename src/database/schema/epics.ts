import { sql } from "drizzle-orm";
import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./_shared.js";
import { projects } from "./projects.js";
import { users } from "./users.js";

export const epics = pgTable(
  "epics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    jiraIssueKey: text("jira_issue_key"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("epics_project_name_unique").on(t.projectId, sql`lower(${t.name})`),
    index("idx_epics_project").on(t.projectId),
    uniqueIndex("epics_jira_ref_unique")
      .on(t.projectId, t.jiraIssueKey)
      .where(sql`${t.jiraIssueKey} IS NOT NULL`),
  ],
);
