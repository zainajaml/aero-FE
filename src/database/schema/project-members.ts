import { index, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { appRole } from "./_shared.js";
import { projects } from "./projects.js";
import { users } from "./users.js";

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: appRole("role").notNull().default("developer"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index("idx_project_members_user").on(t.userId),
  ],
);
