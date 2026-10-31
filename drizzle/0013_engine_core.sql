CREATE TABLE "kb_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"locator" text NOT NULL,
	"article_no" integer,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"norm" text NOT NULL,
	"sha256" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref_code" text NOT NULL,
	"version" text NOT NULL,
	"title" text NOT NULL,
	"issuer" text,
	"binding_level" text,
	"verification_status" text DEFAULT 'pending_verification' NOT NULL,
	"effective_on" date,
	"origin" text NOT NULL,
	"sha256" text NOT NULL,
	"text_quality" text NOT NULL,
	"quality_note" text,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "processing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"waqf_id" uuid,
	"kind" text DEFAULT 'process' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"reason" text NOT NULL,
	"instruction" text,
	"requested_by" uuid,
	"last_error" text,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processing_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"waqf_id" uuid,
	"attempt" integer NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"engine_version" text NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" jsonb,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_hash" text,
	"instruction" text,
	"output_id" uuid,
	"output_version" integer,
	"outcome" jsonb,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "processing_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"waqf_id" uuid,
	"seq" integer NOT NULL,
	"step" text NOT NULL,
	"status" text NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "request_events" ADD COLUMN "internal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "processing_mode" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_source_id_kb_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."kb_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kbc_source_idx" ON "kb_chunks" USING btree ("source_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "kbs_ref_version_uq" ON "kb_sources" USING btree ("ref_code","version");--> statement-breakpoint
CREATE UNIQUE INDEX "pj_one_active_uq" ON "processing_jobs" USING btree ("request_id") WHERE status in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "pj_pick_idx" ON "processing_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "pr_request_idx" ON "processing_runs" USING btree ("request_id","started_at");--> statement-breakpoint
CREATE INDEX "ps_run_idx" ON "processing_steps" USING btree ("run_id","seq");