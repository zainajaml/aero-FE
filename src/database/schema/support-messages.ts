import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./_shared.js";
import { supportIssues } from "./support-issues.js";
import { users } from "./users.js";

export const supportMessages = pgTable(
  "support_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => supportIssues.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    imagePath: text("image_path"),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("idx_support_messages_issue").on(t.issueId, t.createdAt)],
);
