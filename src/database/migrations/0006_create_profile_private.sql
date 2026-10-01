CREATE TABLE "profile_private" (
	"id" uuid PRIMARY KEY NOT NULL,
	"mobile" text,
	"employee_number" text,
	"employment_status" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_private_employment_status_check" CHECK ("profile_private"."employment_status" IS NULL OR "profile_private"."employment_status" IN ('full_time', 'part_time', 'contract', 'project'))
);
--> statement-breakpoint
ALTER TABLE "profile_private" ADD CONSTRAINT "profile_private_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;