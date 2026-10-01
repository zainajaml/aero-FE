CREATE TABLE "support_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"ticket_number" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_issues_status_check" CHECK ("support_issues"."status" IN ('open', 'closed'))
);
--> statement-breakpoint
ALTER TABLE "support_issues" ADD CONSTRAINT "support_issues_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "support_issues_ticket_number_key" ON "support_issues" USING btree ("ticket_number");--> statement-breakpoint
CREATE INDEX "idx_support_issues_user" ON "support_issues" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_support_issues_status" ON "support_issues" USING btree ("status");