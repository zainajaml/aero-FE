import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./_shared.js";
import { accounts } from "./accounts.js";
import { users } from "./users.js";

export const PROJECT_TYPES = ["sprint", "kanban"] as const;

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    key: text("key").notNull().unique(),
    description: text("description"),
    /** Free-text client label shown and searched in project lists. */
    clientAccount: text("client_account"),
    projectType: text("project_type").notNull().default("sprint"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    jiraCloudId: text("jira_cloud_id"),
    jiraProjectId: text("jira_project_id"),
    jiraProjectKey: text("jira_project_key"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: uuid("archived_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    check("projects_project_type_check", sql`${t.projectType} IN ('sprint', 'kanban')`),
    index("projects_account_id_idx").on(t.accountId),
    index("projects_archived_at_idx")
      .on(t.archivedAt)
      .where(sql`${t.archivedAt} IS NOT NULL`),
    uniqueIndex("projects_jira_ref_unique")
      .on(t.accountId, t.jiraCloudId, t.jiraProjectId)
      .where(sql`${t.jiraProjectId} IS NOT NULL`),
  ],
);
