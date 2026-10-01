CREATE TABLE "email_send_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"retry_after_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_send_state_singleton" CHECK ("email_send_state"."id" = 1)
);
