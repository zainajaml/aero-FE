CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"full_name" text,
	"first_name" text,
	"last_name" text,
	"avatar_url" text,
	"email" text,
	"job_title" text,
	"timezone" text DEFAULT 'PKT' NOT NULL,
	"is_provisional" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_timezone_check" CHECK ("profiles"."timezone" IN ('PKT', 'IST', 'AEST'))
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profiles_archived_at_idx" ON "profiles" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "profiles_email_lower_idx" ON "profiles" USING btree (lower("email"));