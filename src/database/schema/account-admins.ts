import { index, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./_shared.js";
import { accounts } from "./accounts.js";
import { users } from "./users.js";

export const accountAdmins = pgTable(
  "account_admins",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.userId] }),
    index("idx_account_admins_user").on(t.userId),
  ],
);
