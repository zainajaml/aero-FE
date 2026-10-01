import { sql } from "drizzle-orm";
import { bigint, check, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./_shared.js";
import { comments } from "./comments.js";
import { tickets } from "./tickets.js";
import { users } from "./users.js";

export const ATTACHMENT_CONTEXTS = ["description", "comment"] as const;

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    commentId: uuid("comment_id").references(() => comments.id, { onDelete: "cascade" }),
    context: text("context").notNull().default("description"),
    storagePath: text("storage_path").notNull(),
    name: text("name").notNull(),
    mime: text("mime"),
    size: bigint("size", { mode: "number" }),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    jiraAttachmentId: text("jira_attachment_id"),
    createdAt: createdAt(),
  },
  (t) => [
    check("attachments_context_check", sql`${t.context} IN ('description', 'comment')`),
    index("idx_attachments_ticket").on(t.ticketId),
    index("idx_attachments_comment_id").on(t.commentId),
    uniqueIndex("attachments_jira_ref_unique")
      .on(t.ticketId, t.jiraAttachmentId)
      .where(sql`${t.jiraAttachmentId} IS NOT NULL`),
  ],
);
