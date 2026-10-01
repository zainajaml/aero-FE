CREATE TABLE "email_send_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_name" text NOT NULL,
	"recipient_email" text NOT NULL,
	"status" text NOT NULL,
	"subject" text,
	"html" text,
	"message" text,
	"message_id" text,
	"error_message" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_send_log_status_check" CHECK ("email_send_log"."status" IN ('pending', 'sent', 'failed', 'suppressed', 'bounced', 'complained'))
);
--> statement-breakpoint
CREATE INDEX "idx_email_send_log_recipient_created" ON "email_send_log" USING btree (lower("recipient_email"),"created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_email_send_log_message_id" ON "email_send_log" USING btree ("message_id");