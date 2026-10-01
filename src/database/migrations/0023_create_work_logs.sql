CREATE TABLE "work_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"minutes" integer NOT NULL,
	"note" text,
	"resource_type" text,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"jira_worklog_id" text,
	CONSTRAINT "work_logs_minutes_check" CHECK ("work_logs"."minutes" > 0)
);
--> statement-breakpoint
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_work_logs_ticket" ON "work_logs" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "idx_work_logs_user" ON "work_logs" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_logs_jira_ref_unique" ON "work_logs" USING btree ("ticket_id","jira_worklog_id") WHERE "work_logs"."jira_worklog_id" IS NOT NULL;