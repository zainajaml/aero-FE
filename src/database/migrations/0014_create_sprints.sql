CREATE TABLE "sprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"goal" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"status" text DEFAULT 'planned' NOT NULL,
	"position" double precision DEFAULT 0 NOT NULL,
	"jira_sprint_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sprints_status_check" CHECK ("sprints"."status" IN ('planned', 'active', 'completed'))
);
--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sprints_project" ON "sprints" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sprints_jira_ref_unique" ON "sprints" USING btree ("project_id","jira_sprint_id") WHERE "sprints"."jira_sprint_id" IS NOT NULL;