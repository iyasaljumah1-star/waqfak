ALTER TABLE "body_memberships" ADD COLUMN "capacity" text;--> statement-breakpoint
ALTER TABLE "body_memberships" ADD COLUMN "is_executive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "body_memberships" ADD COLUMN "can_sign" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "body_memberships" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "body_memberships" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "body_memberships" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "body_memberships" ADD COLUMN "appointment_ref" text;--> statement-breakpoint
ALTER TABLE "body_memberships" ADD COLUMN "appointment_document_id" uuid;--> statement-breakpoint
ALTER TABLE "waqf_governance_profiles" ADD COLUMN "competencies" text;--> statement-breakpoint
ALTER TABLE "waqf_governance_profiles" ADD COLUMN "chair_powers" text;--> statement-breakpoint
ALTER TABLE "waqf_governance_profiles" ADD COLUMN "delegation_limits" text;--> statement-breakpoint
ALTER TABLE "waqf_governance_profiles" ADD COLUMN "task_allocation" text;--> statement-breakpoint
ALTER TABLE "waqf_governance_profiles" ADD COLUMN "signing_rules" text;--> statement-breakpoint
ALTER TABLE "waqf_governance_profiles" ADD COLUMN "coi_procedure" text;--> statement-breakpoint
ALTER TABLE "waqf_governance_profiles" ADD COLUMN "records_rule" text;--> statement-breakpoint
ALTER TABLE "waqf_governance_profiles" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "details" jsonb DEFAULT '{}'::jsonb NOT NULL;