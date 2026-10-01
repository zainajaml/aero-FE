CREATE TABLE "jira_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"project_id" uuid,
	"cloud_id" text NOT NULL,
	"jira_project_id" text NOT NULL,
	"jira_project_key" text NOT NULL,
	"jira_project_name" text NOT NULL,
	"project_type" text DEFAULT 'kanban' NOT NULL,
	"phase" text DEFAULT 'setup' NOT NULL,
	"page_token" text,
	"processed_issues" integer DEFAULT 0 NOT NULL,
	"total_issues" integer DEFAULT 0 NOT NULL,
	"imported_comments" integer DEFAULT 0 NOT NULL,
	"imported_worklogs" integer DEFAULT 0 NOT NULL,
	"imported_attachments" integer DEFAULT 0 NOT NULL,
	"sprint_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"new_users" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"jira_users" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jira_imports" ADD CONSTRAINT "jira_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jira_imports" ADD CONSTRAINT "jira_imports_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jira_imports" ADD CONSTRAINT "jira_imports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jira_imports_user_idx" ON "jira_imports" USING btree ("user_id","created_at" DESC NULLS LAST);