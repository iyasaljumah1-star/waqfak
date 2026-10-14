CREATE TABLE "request_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"waqf_id" uuid,
	"kind" text NOT NULL,
	"target" text,
	"reason" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"impact" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "self_approved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "sent_by" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "send_result" jsonb;--> statement-breakpoint
ALTER TABLE "request_revisions" ADD CONSTRAINT "request_revisions_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_revisions_req_idx" ON "request_revisions" USING btree ("request_id");