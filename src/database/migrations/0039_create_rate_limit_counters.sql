CREATE TABLE "rate_limit_counters" (
	"namespace" text NOT NULL,
	"identifier_hash" text NOT NULL,
	"window_seconds" integer NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_limit_counters_namespace_identifier_hash_window_seconds_window_start_pk" PRIMARY KEY("namespace","identifier_hash","window_seconds","window_start")
);
--> statement-breakpoint
CREATE INDEX "rate_limit_counters_expires_at_idx" ON "rate_limit_counters" USING btree ("expires_at");