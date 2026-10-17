CREATE TABLE "request_field_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"waqf_id" uuid,
	"field_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_value" jsonb,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"note" text,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "request_notes" ADD COLUMN "field_key" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "field_key" text;--> statement-breakpoint
ALTER TABLE "output_versions" ADD COLUMN "data_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "request_field_states" ADD CONSTRAINT "request_field_states_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "request_field_states_uq" ON "request_field_states" USING btree ("request_id","field_key");