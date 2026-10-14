CREATE TABLE "service_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"waqf_id" uuid,
	"term_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"kind" text DEFAULT 'periodic' NOT NULL,
	"label" text NOT NULL,
	"period_start" date,
	"period_end" date,
	"due_on" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assignee_user_id" uuid,
	"output_key" text,
	"meeting_id" uuid,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"sent_by" uuid,
	"delivered_on" date,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"close_note" text,
	"skipped_reason" text,
	"due_changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "service_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"waqf_id" uuid,
	"service_code" text NOT NULL,
	"contract_id" uuid,
	"quote_id" uuid,
	"cadence" text NOT NULL,
	"start_on" date NOT NULL,
	"end_on" date NOT NULL,
	"due_offset_days" integer DEFAULT 10 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"suspended_at" timestamp with time zone,
	"suspend_reason" text,
	"terminated_on" date,
	"termination_reason" text,
	"termination_ref" text,
	"terminated_by" uuid,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "deliverables" ADD COLUMN "cycle_id" uuid;--> statement-breakpoint
ALTER TABLE "deliverables" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_cycles" ADD CONSTRAINT "service_cycles_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_cycles" ADD CONSTRAINT "service_cycles_term_id_service_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."service_terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_terms" ADD CONSTRAINT "service_terms_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "service_cycles_req_seq_uq" ON "service_cycles" USING btree ("request_id","seq");--> statement-breakpoint
CREATE INDEX "service_cycles_due_idx" ON "service_cycles" USING btree ("due_on");--> statement-breakpoint
CREATE UNIQUE INDEX "service_terms_req_uq" ON "service_terms" USING btree ("request_id");