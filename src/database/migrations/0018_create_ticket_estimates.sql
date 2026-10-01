CREATE TABLE "ticket_estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"minutes" integer DEFAULT 0 NOT NULL,
	"note" text,
	"estimated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket_estimates" ADD CONSTRAINT "ticket_estimates_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ticket_estimates_ticket" ON "ticket_estimates" USING btree ("ticket_id");