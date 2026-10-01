CREATE TABLE "ticket_epics" (
	"ticket_id" uuid NOT NULL,
	"epic_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_epics_ticket_id_epic_id_pk" PRIMARY KEY("ticket_id","epic_id")
);
--> statement-breakpoint
ALTER TABLE "ticket_epics" ADD CONSTRAINT "ticket_epics_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_epics" ADD CONSTRAINT "ticket_epics_epic_id_epics_id_fk" FOREIGN KEY ("epic_id") REFERENCES "public"."epics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ticket_epics_epic" ON "ticket_epics" USING btree ("epic_id");