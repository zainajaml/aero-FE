CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"comment_id" uuid,
	"context" text DEFAULT 'description' NOT NULL,
	"storage_path" text NOT NULL,
	"name" text NOT NULL,
	"mime" text,
	"size" bigint,
	"uploaded_by" uuid,
	"jira_attachment_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_context_check" CHECK ("attachments"."context" IN ('description', 'comment'))
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_attachments_ticket" ON "attachments" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "idx_attachments_comment_id" ON "attachments" USING btree ("comment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_jira_ref_unique" ON "attachments" USING btree ("ticket_id","jira_attachment_id") WHERE "attachments"."jira_attachment_id" IS NOT NULL;