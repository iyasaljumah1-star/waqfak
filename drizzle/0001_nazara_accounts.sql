CREATE TABLE "nazara_engagements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"waqf_id" uuid NOT NULL,
	"request_id" uuid,
	"status" text DEFAULT 'intake' NOT NULL,
	"is_practice" boolean DEFAULT false NOT NULL,
	"lead_user_id" uuid,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"intake_notes" text,
	"decision" text,
	"decision_reason" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"appointment_decision_no" text,
	"appointment_decision_date" date,
	"appointment_authority" "authority_kind",
	"appointment_document_id" uuid,
	"powers" text,
	"fee_terms" text,
	"responsibilities" text,
	"trustee_id" uuid,
	"started_on" date,
	"activated_by" uuid,
	"end_reason" text,
	"end_note" text,
	"ended_on" date,
	"successor_name" text,
	"handover" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "nazara_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"waqf_id" uuid NOT NULL,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"note" text,
	"actor_user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nazara_team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"waqf_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"team_role" text NOT NULL,
	"membership_id" uuid,
	"added_by" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid
);
--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "status" text DEFAULT 'final' NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nazara_engagements" ADD CONSTRAINT "nazara_engagements_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nazara_events" ADD CONSTRAINT "nazara_events_engagement_id_nazara_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."nazara_engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nazara_team" ADD CONSTRAINT "nazara_team_engagement_id_nazara_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."nazara_engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nazara_eng_number_uq" ON "nazara_engagements" USING btree ("number");--> statement-breakpoint
CREATE INDEX "nazara_eng_waqf_idx" ON "nazara_engagements" USING btree ("waqf_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nazara_eng_open_uq" ON "nazara_engagements" USING btree ("waqf_id") WHERE status not in ('rejected', 'ended');--> statement-breakpoint
CREATE INDEX "nazara_ev_eng_idx" ON "nazara_events" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "nazara_team_eng_idx" ON "nazara_team" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "nazara_team_user_idx" ON "nazara_team" USING btree ("user_id");