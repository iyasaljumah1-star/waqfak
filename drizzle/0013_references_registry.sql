CREATE TABLE "ref_fetch_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_code" text NOT NULL,
	"url" text NOT NULL,
	"attempted_at" timestamp with time zone NOT NULL,
	"ok" boolean NOT NULL,
	"via" text NOT NULL,
	"failure_kind" text,
	"failure_detail" text
);
--> statement-breakpoint
CREATE TABLE "ref_match_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"note" text NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref_match_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"candidate_label" text NOT NULL,
	"candidate_sha256" text NOT NULL,
	"outcome" text NOT NULL,
	"per_article" jsonb NOT NULL,
	"details" jsonb NOT NULL,
	"ran_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"official_name" text NOT NULL,
	"kind" text NOT NULL,
	"binding" text NOT NULL,
	"status_recorded" text NOT NULL,
	"facts" jsonb NOT NULL,
	"candidate_services" jsonb NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"locator" text NOT NULL,
	"article" integer NOT NULL,
	"paragraph" integer,
	"item" text,
	"heading" text,
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref_version_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"url" text NOT NULL,
	"sha256" text NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"label" text NOT NULL,
	"effective_from" date,
	"source_url" text NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"via" text NOT NULL,
	"sha256" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ref_match_reviews" ADD CONSTRAINT "ref_match_reviews_run_id_ref_match_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ref_match_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_match_runs" ADD CONSTRAINT "ref_match_runs_version_id_ref_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."ref_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_units" ADD CONSTRAINT "ref_units_version_id_ref_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."ref_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_version_confirmations" ADD CONSTRAINT "ref_version_confirmations_version_id_ref_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."ref_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref_versions" ADD CONSTRAINT "ref_versions_source_id_ref_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."ref_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ref_fetch_attempts_code_idx" ON "ref_fetch_attempts" USING btree ("source_code","attempted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ref_sources_code_uq" ON "ref_sources" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "ref_units_locator_uq" ON "ref_units" USING btree ("version_id","locator");--> statement-breakpoint
CREATE UNIQUE INDEX "ref_versions_content_uq" ON "ref_versions" USING btree ("source_id","sha256","effective_from");--> statement-breakpoint
CREATE INDEX "ref_versions_source_idx" ON "ref_versions" USING btree ("source_id","effective_from");