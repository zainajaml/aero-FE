import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./_shared.js";
import { users } from "./users.js";

export const jiraOauthStates = pgTable(
  "jira_oauth_states",
  {
    state: text("state").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    redirectTo: text("redirect_to"),
    createdAt: createdAt(),
  },
  (t) => [index("jira_oauth_states_created_at_idx").on(t.createdAt)],
);
