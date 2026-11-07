CREATE TABLE "fiqh_dossiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text NOT NULL,
	"facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dossier" jsonb NOT NULL,
	"sha256" text NOT NULL,
	"stage" text NOT NULL,
	"review_role" text DEFAULT 'sharia' NOT NULL,
	"service_code" text,
	"request_id" uuid,
	"output_id" uuid,
	"engine_version" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fqd_stage_ck" CHECK ("fiqh_dossiers"."stage" in ('research', 'summary', 'extraction', 'comparison', 'preliminary', 'draft')),
	CONSTRAINT "fqd_role_ck" CHECK ("fiqh_dossiers"."review_role" in ('sharia', 'accounting', 'legal', 'data', 'investment'))
);
--> statement-breakpoint
CREATE TABLE "fiqh_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dossier_id" uuid NOT NULL,
	"dossier_sha256" text NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"reviewer_role" text NOT NULL,
	"decision" text NOT NULL,
	"note" text NOT NULL,
	"replacement" jsonb,
	"session_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fqr_decision_ck" CHECK ("fiqh_reviews"."decision" in ('approved', 'modified', 'rejected', 'more_research')),
	CONSTRAINT "fqr_role_ck" CHECK ("fiqh_reviews"."reviewer_role" in ('sharia', 'accounting', 'legal', 'data', 'investment')),
	CONSTRAINT "fqr_note_ck" CHECK (length(trim("fiqh_reviews"."note")) >= 10),
	CONSTRAINT "fqr_replacement_ck" CHECK (("fiqh_reviews"."decision" = 'modified') = ("fiqh_reviews"."replacement" is not null))
);
--> statement-breakpoint
ALTER TABLE "kb_source_reviews" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "ref_match_reviews" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "fiqh_dossiers" ADD CONSTRAINT "fiqh_dossiers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiqh_reviews" ADD CONSTRAINT "fiqh_reviews_dossier_id_fiqh_dossiers_id_fk" FOREIGN KEY ("dossier_id") REFERENCES "public"."fiqh_dossiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiqh_reviews" ADD CONSTRAINT "fiqh_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fqd_request_idx" ON "fiqh_dossiers" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "fqr_dossier_idx" ON "fiqh_reviews" USING btree ("dossier_id","at");