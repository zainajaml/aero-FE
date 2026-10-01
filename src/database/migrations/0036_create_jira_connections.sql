CREATE TABLE "jira_connections" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"cloud_id" text NOT NULL,
	"site_url" text,
	"site_name" text,
	"account_email" text,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp with time zone NOT NULL,
	"scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jira_connections" ADD CONSTRAINT "jira_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;