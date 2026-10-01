import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./_shared.js";

/** Append-only audit trail. No FKs on purpose: entries outlive the users/projects they mention. */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    action: text("action").notNull(),
    tableName: text("table_name"),
    field: text("field"),
    value: text("value"),
    link: text("link"),
    projectId: uuid("project_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("idx_audit_logs_created_at").on(t.createdAt.desc()),
    index("idx_audit_logs_project_created").on(t.projectId, t.createdAt.desc()),
    index("idx_audit_logs_user").on(t.userId),
  ],
);
