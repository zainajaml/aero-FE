CREATE TABLE "account_admins" (
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_admins_account_id_user_id_pk" PRIMARY KEY("account_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "account_admins" ADD CONSTRAINT "account_admins_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_admins" ADD CONSTRAINT "account_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_account_admins_user" ON "account_admins" USING btree ("user_id");