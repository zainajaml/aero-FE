CREATE TABLE "epics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"jira_issue_key" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "epics" ADD CONSTRAINT "epics_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epics" ADD CONSTRAINT "epics_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "epics_project_name_unique" ON "epics" USING btree ("project_id",lower("name"));--> statement-breakpoint
CREATE INDEX "idx_epics_project" ON "epics" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "epics_jira_ref_unique" ON "epics" USING btree ("project_id","jira_issue_key") WHERE "epics"."jira_issue_key" IS NOT NULL;