import { sql } from "drizzle-orm";
import { type AnyPgColumn, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./_shared.js";
import { tickets } from "./tickets.js";
import { users } from "./users.js";

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => comments.id, { onDelete: "cascade" }),
    // RESTRICT: comment history survives user removal; users with activity are archived instead.
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    jiraCommentId: text("jira_comment_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("comments_parent_id_idx").on(t.parentId),
    index("idx_comments_ticket_created").on(t.ticketId, t.createdAt),
    uniqueIndex("comments_jira_ref_unique")
      .on(t.ticketId, t.jiraCommentId)
      .where(sql`${t.jiraCommentId} IS NOT NULL`),
  ],
);
