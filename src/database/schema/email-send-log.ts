import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./_shared.js";

export const EMAIL_STATUSES = [
  "pending",
  "sent",
  "failed",
  "suppressed",
  "bounced",
  "complained",
] as const;

export const emailSendLog = pgTable(
  "email_send_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateName: text("template_name").notNull(),
    recipientEmail: text("recipient_email").notNull(),
    status: text("status").notNull(),
    subject: text("subject"),
    // Rendered body kept so a failed send can be retried exactly as it was composed.
    html: text("html"),
    message: text("message"),
    messageId: text("message_id"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "email_send_log_status_check",
      sql`${t.status} IN ('pending', 'sent', 'failed', 'suppressed', 'bounced', 'complained')`,
    ),
    index("idx_email_send_log_recipient_created").on(
      sql`lower(${t.recipientEmail})`,
      t.createdAt.desc(),
    ),
    index("idx_email_send_log_message_id").on(t.messageId),
  ],
);
