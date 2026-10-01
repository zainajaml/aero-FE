import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./_shared.js";
import { accounts } from "./accounts.js";
import { projects } from "./projects.js";
import { users } from "./users.js";

export const jiraImports = pgTable(
  "jira_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    cloudId: text("cloud_id").notNull(),
    jiraProjectId: text("jira_project_id").notNull(),
    jiraProjectKey: text("jira_project_key").notNull(),
    jiraProjectName: text("jira_project_name").notNull(),
    projectType: text("project_type").notNull().default("kanban"),
    phase: text("phase").notNull().default("setup"),
    pageToken: text("page_token"),
    processedIssues: integer("processed_issues").notNull().default(0),
    totalIssues: integer("total_issues").notNull().default(0),
    importedComments: integer("imported_comments").notNull().default(0),
    importedWorklogs: integer("imported_worklogs").notNull().default(0),
    importedAttachments: integer("imported_attachments").notNull().default(0),
    sprintMap: jsonb("sprint_map")
      .notNull()
      .default(sql`'{}'::jsonb`),
    newUsers: jsonb("new_users")
      .notNull()
      .default(sql`'[]'::jsonb`),
    jiraUsers: jsonb("jira_users")
      .notNull()
      .default(sql`'[]'::jsonb`),
    warnings: jsonb("warnings")
      .notNull()
      .default(sql`'[]'::jsonb`),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("jira_imports_user_idx").on(t.userId, t.createdAt.desc())],
);
