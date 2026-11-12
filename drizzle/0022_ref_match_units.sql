CREATE TABLE "ref_match_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"unit_key" text NOT NULL,
	"article" integer NOT NULL,
	"outcome" text NOT NULL,
	"text_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ref_match_reviews" ADD COLUMN "unit_id" uuid;--> statement-breakpoint
ALTER TABLE "ref_match_units" ADD CONSTRAINT "ref_match_units_run_id_ref_match_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ref_match_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ref_match_units_uq" ON "ref_match_units" USING btree ("run_id","unit_key");--> statement-breakpoint
ALTER TABLE "ref_match_reviews" ADD CONSTRAINT "ref_match_reviews_unit_id_ref_match_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."ref_match_units"("id") ON DELETE no action ON UPDATE no action;