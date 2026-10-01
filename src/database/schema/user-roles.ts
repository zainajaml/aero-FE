import { pgTable, unique, uuid } from "drizzle-orm/pg-core";
import { appRole, createdAt } from "./_shared.js";
import { users } from "./users.js";

export const userRoles = pgTable(
  "user_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: appRole("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("user_roles_user_id_role_key").on(t.userId, t.role)],
);
