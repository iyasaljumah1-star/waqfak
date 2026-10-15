CREATE TABLE "data_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"waqf_id" uuid,
	"output_id" uuid,
	"conflict_key" text NOT NULL,
	"severity" text NOT NULL,
	"label" text NOT NULL,
	"sides" jsonb NOT NULL,
	"action" text NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"detected_by" uuid,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolution" text,
	"item_id" uuid
);
--> statement-breakpoint
CREATE TABLE "output_official_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"output_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"waqf_id" uuid,
	"version" integer NOT NULL,
	"authority" text NOT NULL,
	"reference_no" text NOT NULL,
	"issued_on" date NOT NULL,
	"document_id" uuid NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "output_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"output_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"waqf_id" uuid,
	"version" integer NOT NULL,
	"kind" text NOT NULL,
	"target_key" text NOT NULL,
	"status" text NOT NULL,
	"note" text NOT NULL,
	"location" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "regulatory_references" ADD COLUMN "document_id" uuid;--> statement-breakpoint
ALTER TABLE "output_versions" ADD COLUMN "data_hash" text;--> statement-breakpoint
ALTER TABLE "data_conflicts" ADD CONSTRAINT "data_conflicts_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_official_records" ADD CONSTRAINT "output_official_records_output_id_outputs_id_fk" FOREIGN KEY ("output_id") REFERENCES "public"."outputs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_reviews" ADD CONSTRAINT "output_reviews_output_id_outputs_id_fk" FOREIGN KEY ("output_id") REFERENCES "public"."outputs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_conflicts_req_idx" ON "data_conflicts" USING btree ("request_id","status");--> statement-breakpoint
CREATE INDEX "output_reviews_out_idx" ON "output_reviews" USING btree ("output_id","kind");