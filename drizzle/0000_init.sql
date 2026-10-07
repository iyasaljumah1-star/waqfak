CREATE SCHEMA "restricted";
--> statement-breakpoint
CREATE TYPE "public"."answer_type" AS ENUM('yes_no', 'yes_partial_no', 'maturity', 'band', 'date', 'select', 'multiselect', 'number', 'text');--> statement-breakpoint
CREATE TYPE "public"."approval_kind" AS ENUM('substitution', 'mortgage', 'condition_deviation', 'interpretation', 'nazir_fee', 'donations', 'merger', 'long_lease', 'other');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('draft', 'submitted', 'granted', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."assessment_status" AS ENUM('draft', 'completed', 'computed', 'under_review', 'published', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."asset_category" AS ENUM('real_estate', 'movable', 'usufruct', 'intellectual_property', 'cash', 'shares', 'fund_units', 'portfolio', 'sukuk');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('income', 'vacant', 'development', 'idle', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."asset_subject" AS ENUM('corpus', 'value');--> statement-breakpoint
CREATE TYPE "public"."authority_kind" AS ENUM('competent_authority', 'gaa', 'court', 'cma', 'fiu', 'notary', 'internal');--> statement-breakpoint
CREATE TYPE "public"."binding_level" AS ENUM('binding', 'guidance', 'draft', 'reference');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('in_app', 'email', 'sms', 'push', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."condition_category" AS ENUM('asset', 'revenue', 'masraf', 'nazara', 'founder_self', 'governance_finance');--> statement-breakpoint
CREATE TYPE "public"."doc_approval" AS ENUM('none', 'draft', 'in_review', 'approved', 'locked');--> statement-breakpoint
CREATE TYPE "public"."doc_confidentiality" AS ENUM('internal', 'confidential', 'secret');--> statement-breakpoint
CREATE TYPE "public"."doc_status" AS ENUM('quarantine', 'active', 'rejected', 'archived');--> statement-breakpoint
CREATE TYPE "public"."evidence_level" AS ENUM('declared', 'document', 'verified');--> statement-breakpoint
CREATE TYPE "public"."id_type" AS ENUM('national_id', 'iqama', 'passport', 'gcc_id', 'cr', 'other');--> statement-breakpoint
CREATE TYPE "public"."meeting_status" AS ENUM('scheduled', 'held', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('invited', 'active', 'suspended', 'ended');--> statement-breakpoint
CREATE TYPE "public"."mfa_type" AS ENUM('totp', 'passkey');--> statement-breakpoint
CREATE TYPE "public"."minutes_status" AS ENUM('draft', 'circulated', 'approved', 'locked');--> statement-breakpoint
CREATE TYPE "public"."nazir_mode" AS ENUM('founder', 'individual', 'board', 'legal_entity', 'gaa', 'vacant');--> statement-breakpoint
CREATE TYPE "public"."notif_severity" AS ENUM('critical', 'important', 'info');--> statement-breakpoint
CREATE TYPE "public"."obligation_status" AS ENUM('upcoming', 'due_soon', 'overdue', 'done', 'waived');--> statement-breakpoint
CREATE TYPE "public"."otp_purpose" AS ENUM('signup', 'login', 'recover', 'change_phone', 'delete_account', 'sign_contract', 'step_up');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('queued', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."pricing_model" AS ENUM('free', 'fixed', 'subscription', 'hourly', 'percentage', 'quote');--> statement-breakpoint
CREATE TYPE "public"."publish_status" AS ENUM('draft', 'in_review', 'published', 'retired');--> statement-breakpoint
CREATE TYPE "public"."rec_status" AS ENUM('open', 'accepted', 'dismissed', 'converted', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('draft', 'submitted', 'triage', 'awaiting_client', 'quote', 'awaiting_contract', 'in_progress', 'quality_review', 'awaiting_client_approval', 'completed', 'closed', 'on_hold', 'cancelled', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."resolution_status" AS ENUM('draft', 'approved', 'rejected', 'deferred', 'executed', 'reviewed');--> statement-breakpoint
CREATE TYPE "public"."role_scope" AS ENUM('global', 'waqf');--> statement-breakpoint
CREATE TYPE "public"."scan_status" AS ENUM('pending', 'clean', 'infected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('critical', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."sharia_review" AS ENUM('not_reviewed', 'approved', 'needs_amendment', 'possibly_void');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('todo', 'in_progress', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('pending', 'active', 'locked', 'deletion_requested', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('verified', 'pending_verification');--> statement-breakpoint
CREATE TYPE "public"."vote_value" AS ENUM('for', 'against', 'abstain', 'recused');--> statement-breakpoint
CREATE TYPE "public"."waqf_creation_mode" AS ENUM('inter_vivos', 'bequest');--> statement-breakpoint
CREATE TYPE "public"."waqf_legal_type" AS ENUM('public', 'private', 'joint');--> statement-breakpoint
CREATE TYPE "public"."waqf_size_class" AS ENUM('large', 'medium', 'small', 'direct_benefit');--> statement-breakpoint
CREATE TYPE "public"."waqf_status" AS ENUM('idea', 'draft', 'documenting', 'documented', 'registered', 'active', 'suspended', 'ended');--> statement-breakpoint
CREATE TYPE "public"."waqfak_role" AS ENUM('none', 'advisor', 'delegated_manager', 'nazir', 'board_member', 'bookkeeper');--> statement-breakpoint
CREATE TABLE "break_glass_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"waqf_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"agent_user_id" uuid NOT NULL,
	"principal_user_id" uuid,
	"principal_name" text,
	"power_of_attorney_no" text,
	"document_id" uuid,
	"scope" jsonb NOT NULL,
	"includes_donations" boolean DEFAULT false NOT NULL,
	"includes_asset_disposal" boolean DEFAULT false NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text,
	"fingerprint_hash" text NOT NULL,
	"trusted" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"role_key" text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"revoked_at" timestamp with time zone,
	"scope" jsonb,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mfa_factors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "mfa_type" NOT NULL,
	"secret_enc" text NOT NULL,
	"label" text,
	"verified_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target" text NOT NULL,
	"purpose" "otp_purpose" NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip" text,
	"context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name_ar" text NOT NULL,
	"domain" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name_ar" text NOT NULL,
	"scope" "role_scope" NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"mfa_verified" boolean DEFAULT false NOT NULL,
	"ip" text,
	"user_agent" text,
	"device_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"password_hash" text,
	"full_name" text,
	"id_type" "id_type",
	"national_id_enc" text,
	"national_id_hash" text,
	"birth_date" date,
	"locale" text DEFAULT 'ar' NOT NULL,
	"numeral_style" text DEFAULT 'latn' NOT NULL,
	"calendar_pref" text DEFAULT 'both' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"is_staff" boolean DEFAULT false NOT NULL,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"phone_verified_at" timestamp with time zone,
	"email_verified_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"deletion_requested_at" timestamp with time zone,
	"resides_in_ksa" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "waqf_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_key" text NOT NULL,
	"is_independent" boolean DEFAULT false NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"invited_by" uuid,
	"scope" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"kind" "approval_kind" NOT NULL,
	"authority" "authority_kind" NOT NULL,
	"status" "approval_status" DEFAULT 'draft' NOT NULL,
	"subject" text NOT NULL,
	"ref_no" text,
	"submitted_on" date,
	"decided_on" date,
	"asset_id" uuid,
	"document_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "bodies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"charter" text,
	"parent_body_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "body_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"body_id" uuid NOT NULL,
	"waqf_id" uuid NOT NULL,
	"user_id" uuid,
	"person_name" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"is_independent" boolean DEFAULT false NOT NULL,
	"has_vote" boolean DEFAULT true NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "condition_interpretations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"condition_id" uuid NOT NULL,
	"waqf_id" uuid NOT NULL,
	"text" text NOT NULL,
	"source" text NOT NULL,
	"signed_by" text,
	"document_id" uuid,
	"decided_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "conditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"category" "condition_category" NOT NULL,
	"clause_ref" text,
	"literal_text" text NOT NULL,
	"interpretation" text,
	"interpretation_source" text,
	"sharia_review" "sharia_review" DEFAULT 'not_reviewed' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "deed_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deed_id" uuid NOT NULL,
	"waqf_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"body" text,
	"structured" jsonb,
	"document_id" uuid,
	"change_note" text,
	"approval_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "founders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"person_id" uuid,
	"organization_id" uuid,
	"display_name" text NOT NULL,
	"is_alive" boolean DEFAULT true NOT NULL,
	"nationality" text,
	"powers" jsonb,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "kyc_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"risk_level" text DEFAULT 'standard' NOT NULL,
	"is_pep" boolean DEFAULT false NOT NULL,
	"source_of_funds" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"next_review_at" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"authority_document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"legal_form" text,
	"cr_number" text,
	"unified_number" text,
	"national_address" text,
	"is_nonprofit" boolean DEFAULT false NOT NULL,
	"kind" text DEFAULT 'client' NOT NULL,
	"license_no" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"id_type" "id_type",
	"national_id_enc" text,
	"national_id_hash" text,
	"nationality" text,
	"birth_date" date,
	"birth_place" text,
	"is_alive" boolean DEFAULT true NOT NULL,
	"death_date" date,
	"residence_country" text,
	"address_enc" text,
	"phone" text,
	"email" text,
	"user_id" uuid,
	"is_minor" boolean DEFAULT false NOT NULL,
	"guardian_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "revenue_allocations" (
	"waqf_id" uuid PRIMARY KEY NOT NULL,
	"maintenance_pct" numeric(5, 2),
	"development_pct" numeric(5, 2),
	"reinvest_pct" numeric(5, 2),
	"reserve_pct" numeric(5, 2),
	"nazir_fee_pct" numeric(5, 2),
	"nazir_fee_fixed" numeric(18, 2),
	"admin_pct" numeric(5, 2),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "successions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"rule_text" text NOT NULL,
	"successor_name" text,
	"successor_person_id" uuid,
	"position" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "trustee_appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trustee_id" uuid NOT NULL,
	"waqf_id" uuid NOT NULL,
	"decision_no" text,
	"decision_date" date,
	"authority" "authority_kind",
	"powers" text,
	"fees" text,
	"responsibilities" text,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "trustees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"person_id" uuid,
	"organization_id" uuid,
	"display_name" text NOT NULL,
	"user_id" uuid,
	"is_independent" boolean DEFAULT false NOT NULL,
	"is_chair" boolean DEFAULT false NOT NULL,
	"specialty" text,
	"license_no" text,
	"license_expires_on" date,
	"resides_in_ksa" boolean,
	"nationality" text,
	"starts_on" date,
	"ends_on" date,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "waqf_classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"legal_type" "waqf_legal_type",
	"computed_type" "waqf_legal_type",
	"reason" text,
	"effective_from" date NOT NULL,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waqf_deeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"deed_no" text,
	"issuer" text,
	"issued_on_hijri" text,
	"issued_on" date,
	"document_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "waqf_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"beneficiary_name" text NOT NULL,
	"kind" text NOT NULL,
	"duration" text NOT NULL,
	"until_date" date,
	"quantity" text,
	"afterwards" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "waqf_governance_profiles" (
	"waqf_id" uuid PRIMARY KEY NOT NULL,
	"quorum_rule" text DEFAULT 'majority' NOT NULL,
	"majority_rule" text DEFAULT 'simple' NOT NULL,
	"meetings_per_year" integer DEFAULT 4 NOT NULL,
	"independent_ratio_target" numeric(4, 2),
	"require_independent_for_quorum" boolean DEFAULT false NOT NULL,
	"reserved_decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"executive_spend_limit" numeric(18, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "waqf_keys" (
	"waqf_id" uuid PRIMARY KEY NOT NULL,
	"wrapped_key" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waqf_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"request_type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"cert_no" text,
	"submitted_on" date,
	"issued_on" date,
	"expires_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "waqf_timeline_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"type" text NOT NULL,
	"occurred_on" date NOT NULL,
	"title" text NOT NULL,
	"details" text,
	"document_id" uuid,
	"stage" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "waqfs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"internal_number" text NOT NULL,
	"name" text NOT NULL,
	"national_unified_number" text,
	"registration_cert_no" text,
	"registration_expires_on" date,
	"deed_no" text,
	"deed_issuer" text,
	"deed_date_hijri" text,
	"deed_date" date,
	"documented_on" date,
	"registered_on" date,
	"creation_mode" "waqf_creation_mode" DEFAULT 'inter_vivos' NOT NULL,
	"legal_type" "waqf_legal_type",
	"computed_type" "waqf_legal_type",
	"computed_type_reason" text,
	"size_class" "waqf_size_class",
	"size_class_locked" boolean DEFAULT false NOT NULL,
	"direct_benefit" boolean DEFAULT false NOT NULL,
	"assets_estimated_value" numeric(18, 2),
	"field_of_work" text,
	"geographic_scope" text,
	"domicile" text,
	"fiscal_year_end" text DEFAULT '12-31' NOT NULL,
	"status" "waqf_status" DEFAULT 'draft' NOT NULL,
	"nazir_mode" "nazir_mode",
	"waqfak_role" "waqfak_role" DEFAULT 'none' NOT NULL,
	"founder_alive" boolean,
	"has_foreign_party" boolean DEFAULT false NOT NULL,
	"has_beneficiaries_abroad" boolean DEFAULT false NOT NULL,
	"collects_donations" boolean DEFAULT false NOT NULL,
	"has_active_litigation" boolean DEFAULT false NOT NULL,
	"stage" integer DEFAULT 1 NOT NULL,
	"organization_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archive_reason" text
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"category" "asset_category" NOT NULL,
	"subject" "asset_subject" DEFAULT 'corpus' NOT NULL,
	"title" text NOT NULL,
	"ownership_doc_no" text,
	"ownership_document_id" uuid,
	"in_waqf_name" boolean,
	"share_pct" numeric(5, 2),
	"book_value" numeric(18, 2),
	"market_value" numeric(18, 2),
	"last_valuation_on" date,
	"valuer" text,
	"status" "asset_status" DEFAULT 'income' NOT NULL,
	"annual_income" numeric(18, 2),
	"acquired_on" date,
	"notes" text,
	"condition_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archive_reason" text
);
--> statement-breakpoint
CREATE TABLE "beneficial_owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"subject_type" text DEFAULT 'person' NOT NULL,
	"role" text NOT NULL,
	"full_name" text NOT NULL,
	"nationality" text,
	"birth_date" date,
	"birth_place" text,
	"address_enc" text,
	"contact" text,
	"id_type" text,
	"id_number_enc" text,
	"id_number_hash" text,
	"acquired_on" date,
	"bank_details_enc" text,
	"relation_to_waqf" text,
	"entitlement_desc" text,
	"legal_form" text,
	"national_address" text,
	"directors" jsonb,
	"powers" text,
	"resides_in_ksa" boolean,
	"verified_on" date,
	"verification_source" text,
	"risk_level" text DEFAULT 'standard' NOT NULL,
	"next_verification_due" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archive_reason" text
);
--> statement-breakpoint
CREATE TABLE "beneficiaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"class_id" uuid,
	"person_id" uuid,
	"organization_id" uuid,
	"display_name" text NOT NULL,
	"user_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"entitlement_share" numeric(9, 6),
	"resides_abroad" boolean DEFAULT false NOT NULL,
	"generation" integer,
	"parent_beneficiary_id" uuid,
	"last_verified_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone,
	"archive_reason" text
);
--> statement-breakpoint
CREATE TABLE "beneficiary_classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"specified_by" text DEFAULT 'description' NOT NULL,
	"tier" integer DEFAULT 1 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"relation" text DEFAULT 'and' NOT NULL,
	"share_pct" numeric(5, 2),
	"criteria" jsonb,
	"division_rule" text,
	"substitution_rule" text,
	"end_tier" text,
	"alternate_masraf" text,
	"is_final_destination" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "distribution_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"distribution_id" uuid NOT NULL,
	"waqf_id" uuid NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"reference_no" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_on" date,
	"proof_document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "distributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"period" text NOT NULL,
	"total_amount" numeric(18, 2) NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"due_by" date,
	"paid_on" date,
	"bank_account_id" uuid,
	"condition_id" uuid,
	"resolution_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "encumbrances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"waqf_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"details" text,
	"since" date,
	"resolved_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"period" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"basis" text,
	"expected_pay_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "investment_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"target_return_pct" numeric(6, 3),
	"risk_tolerance" text,
	"allocation" jsonb,
	"prohibited" text,
	"leverage_policy" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_by_resolution_id" uuid,
	"review_due" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "investments" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"waqf_id" uuid NOT NULL,
	"instrument_type" text NOT NULL,
	"issuer_name" text,
	"quantity" numeric(18, 4),
	"cost_basis" numeric(18, 2),
	"bonus_shares_treatment" text,
	"manager_name" text,
	"manager_cma_license" text,
	"custody_account" text,
	"management_agreement_doc_id" uuid,
	"fee_pct" numeric(6, 3),
	"benchmark" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"waqf_id" uuid NOT NULL,
	"tenant_name" text NOT NULL,
	"ejar_contract_no" text,
	"starts_on" date,
	"ends_on" date,
	"annual_rent" numeric(18, 2),
	"collected_to_date" numeric(18, 2),
	"arrears" numeric(18, 2),
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "maintenance_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"waqf_id" uuid NOT NULL,
	"item" text NOT NULL,
	"frequency" text,
	"next_due_on" date,
	"estimated_cost" numeric(18, 2),
	"status" text DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"account_no" text,
	"custodian" text,
	"manager_name" text,
	"manager_cma_license" text,
	"strategy" text,
	"risk_level" text,
	"waqf_deed_on" date,
	"registered_with_gaa_on" date,
	"account_opened_on" date,
	"recorded_with_gaa_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"waqf_id" uuid NOT NULL,
	"deed_no" text,
	"city" text,
	"district" text,
	"lat" double precision,
	"lng" double precision,
	"usage" text,
	"area_sqm" numeric(14, 2),
	"units_count" integer,
	"occupied_units" integer,
	"technical_condition" text,
	"annual_maintenance_cost" numeric(18, 2),
	"maintenance_reserve" numeric(18, 2),
	"estimated_rent" numeric(18, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "valuations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"waqf_id" uuid NOT NULL,
	"valuer" text NOT NULL,
	"valuer_license" text,
	"method" text,
	"value" numeric(18, 2) NOT NULL,
	"valued_on" date NOT NULL,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "agenda_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"waqf_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"presenter_name" text,
	"kind" text DEFAULT 'discussion' NOT NULL,
	"condition_id" uuid,
	"document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "attendance" (
	"meeting_id" uuid NOT NULL,
	"body_membership_id" uuid NOT NULL,
	"waqf_id" uuid NOT NULL,
	"status" text DEFAULT 'invited' NOT NULL,
	"mode" text,
	"recorded_at" timestamp with time zone,
	CONSTRAINT "attendance_meeting_id_body_membership_id_pk" PRIMARY KEY("meeting_id","body_membership_id")
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"bank_name" text NOT NULL,
	"iban_enc" text NOT NULL,
	"iban_last4" text NOT NULL,
	"in_waqf_name" boolean NOT NULL,
	"purpose" text DEFAULT 'general' NOT NULL,
	"opened_on" date,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"fiscal_year" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"total_revenue" numeric(18, 2),
	"total_expense" numeric(18, 2),
	"lines" jsonb,
	"approved_by_resolution_id" uuid,
	"approved_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "conflict_declarations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"meeting_id" uuid,
	"agenda_item_id" uuid,
	"kind" text NOT NULL,
	"relation_degree" integer,
	"description" text,
	"action" text DEFAULT 'recuse' NOT NULL,
	"is_annual" boolean DEFAULT false NOT NULL,
	"year" integer,
	"disclosed_to_gaa_on" date,
	"declared_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"fiscal_year" integer NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"auditor_name" text,
	"auditor_license" text,
	"auditor_independent" boolean,
	"opinion" text,
	"total_revenue" numeric(18, 2),
	"total_expense" numeric(18, 2),
	"document_id" uuid,
	"submitted_to_gaa_on" date,
	"shared_with_beneficiaries" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"account_code" text NOT NULL,
	"description" text NOT NULL,
	"debit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"reference_no" text,
	"document_id" uuid,
	"condition_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"body_id" uuid,
	"kind" text DEFAULT 'regular' NOT NULL,
	"title" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"location" text,
	"link" text,
	"status" "meeting_status" DEFAULT 'scheduled' NOT NULL,
	"invitations_sent_at" timestamp with time zone,
	"quorum_required" integer,
	"quorum_met" boolean,
	"held_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "minute_signatures" (
	"minute_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"waqf_id" uuid NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"method" text DEFAULT 'otp_consent' NOT NULL,
	"content_hash" text NOT NULL,
	CONSTRAINT "minute_signatures_minute_id_user_id_pk" PRIMARY KEY("minute_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "minutes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"waqf_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"body" text NOT NULL,
	"status" "minutes_status" DEFAULT 'draft' NOT NULL,
	"prepared_by" uuid,
	"circulated_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "performance_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_name" text NOT NULL,
	"year" integer NOT NULL,
	"score" numeric(5, 2),
	"notes" text,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"policy_type" text NOT NULL,
	"title" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_by_resolution_id" uuid,
	"approved_on" date,
	"review_due" date,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "resolutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"meeting_id" uuid,
	"agenda_item_id" uuid,
	"number" text NOT NULL,
	"text" text NOT NULL,
	"category" text NOT NULL,
	"requires_external_approval" boolean DEFAULT false NOT NULL,
	"approval_id" uuid,
	"condition_id" uuid,
	"expected_impact" text,
	"risks" text,
	"status" "resolution_status" DEFAULT 'draft' NOT NULL,
	"votes_for" integer DEFAULT 0 NOT NULL,
	"votes_against" integer DEFAULT 0 NOT NULL,
	"votes_abstain" integer DEFAULT 0 NOT NULL,
	"votes_recused" integer DEFAULT 0 NOT NULL,
	"decided_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"resolution_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"waqf_id" uuid NOT NULL,
	"value" "vote_value" NOT NULL,
	"reason" text,
	"cast_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "votes_resolution_id_user_id_pk" PRIMARY KEY("resolution_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "complaints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"number" text NOT NULL,
	"raised_by_user_id" uuid NOT NULL,
	"beneficiary_id" uuid,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"sla_due_at" timestamp with time zone NOT NULL,
	"response" text,
	"responded_at" timestamp with time zone,
	"responded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "compliance_change_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"change" jsonb NOT NULL,
	"actor_user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"day" date PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "obligation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"waqf_id" uuid NOT NULL,
	"action" text NOT NULL,
	"note" text,
	"actor_user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "obligation_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"obligation_id" uuid NOT NULL,
	"trigger_event_id" uuid,
	"trigger_date" date,
	"period_key" text,
	"due_on" date,
	"due_immediately" boolean DEFAULT false NOT NULL,
	"status" "obligation_status" DEFAULT 'upcoming' NOT NULL,
	"assignee_user_id" uuid,
	"evidence_document_id" uuid,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"waived_reason" text,
	"last_reminder_at" timestamp with time zone,
	"reminders_sent" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"title_ar" text NOT NULL,
	"description" text,
	"requirement_id" uuid,
	"reference_text" text NOT NULL,
	"authority" "authority_kind" NOT NULL,
	"obligation_type" text NOT NULL,
	"trigger_event" text NOT NULL,
	"offset_value" integer,
	"offset_unit" text NOT NULL,
	"recurrence" text DEFAULT 'none' NOT NULL,
	"applies_to" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"severity" "severity" DEFAULT 'medium' NOT NULL,
	"required_action" text NOT NULL,
	"evidence_required" text,
	"penalty_code" text,
	"default_assignee_role" text DEFAULT 'nazir' NOT NULL,
	"reminder_offsets_days" jsonb DEFAULT '[30,7,1]'::jsonb NOT NULL,
	"status" "publish_status" DEFAULT 'published' NOT NULL,
	"verification_status" "verification_status" DEFAULT 'verified' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "penalty_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"category" text NOT NULL,
	"title_ar" text NOT NULL,
	"large_text" text,
	"medium_text" text,
	"small_text" text,
	"dismissal_risk" text DEFAULT 'no' NOT NULL,
	"max_fine" integer,
	"verification_status" "verification_status" DEFAULT 'pending_verification' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "regulatory_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"source_name" text NOT NULL,
	"issuer" text,
	"decision_ref" text,
	"binding_level" "binding_level" NOT NULL,
	"source_url" text,
	"verification_status" "verification_status" DEFAULT 'pending_verification' NOT NULL,
	"last_verified_on" date,
	"superseded_by" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "regulatory_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"reference_id" uuid,
	"article" text,
	"title" text NOT NULL,
	"description" text,
	"implemented_as" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"feature_area" text,
	"status" text DEFAULT 'implemented' NOT NULL,
	"verification_status" "verification_status" DEFAULT 'verified' NOT NULL,
	"exclusion_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "risk_register" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"impact" integer NOT NULL,
	"likelihood" integer NOT NULL,
	"treatment" text,
	"owner_user_id" uuid,
	"review_on" date,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "restricted"."screening_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"details_enc" text,
	"reviewed_by" uuid,
	"decision" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restricted"."suspicion_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"summary_enc" text NOT NULL,
	"status" text DEFAULT 'internal_review' NOT NULL,
	"reported_to_fiu_on" date,
	"fiu_reference_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "violations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid NOT NULL,
	"penalty_code" text NOT NULL,
	"occurrence" integer DEFAULT 1 NOT NULL,
	"noticed_on" date NOT NULL,
	"authority_ref" text,
	"sanction" text,
	"status" text DEFAULT 'open' NOT NULL,
	"corrective_deadline" date,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "action_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"waqf_id" uuid,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"summary" jsonb,
	"suggested_package_code" text
);
--> statement-breakpoint
CREATE TABLE "assessment_answers" (
	"assessment_id" uuid NOT NULL,
	"question_code" text NOT NULL,
	"waqf_id" uuid,
	"value" jsonb,
	"score" numeric(3, 1),
	"is_unknown" boolean DEFAULT false NOT NULL,
	"is_na" boolean DEFAULT false NOT NULL,
	"evidence_level" "evidence_level" DEFAULT 'declared' NOT NULL,
	"evidence_document_id" uuid,
	"verified_by" uuid,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_answers_assessment_id_question_code_pk" PRIMARY KEY("assessment_id","question_code")
);
--> statement-breakpoint
CREATE TABLE "assessment_axes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_version_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"description" text,
	"weight_small" numeric(5, 2) NOT NULL,
	"weight_medium" numeric(5, 2) NOT NULL,
	"weight_large" numeric(5, 2) NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessment_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_version_id" uuid NOT NULL,
	"code" text NOT NULL,
	"axis_code" text NOT NULL,
	"text_ar" text NOT NULL,
	"help_ar" text,
	"answer_type" "answer_type" NOT NULL,
	"options" jsonb,
	"weight" integer DEFAULT 1 NOT NULL,
	"reference_text" text,
	"critical_flag_code" text,
	"critical_when" jsonb,
	"show_if" jsonb,
	"fact_key" text,
	"depth" text DEFAULT 'basic' NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessment_results" (
	"assessment_id" uuid PRIMARY KEY NOT NULL,
	"waqf_id" uuid,
	"overall_score" numeric(5, 2) NOT NULL,
	"maturity_score" numeric(5, 2) NOT NULL,
	"maturity_level" text NOT NULL,
	"status" text NOT NULL,
	"confidence" text NOT NULL,
	"evidence_ratio" numeric(5, 2),
	"knowledge_gaps" integer DEFAULT 0 NOT NULL,
	"size_class" "waqf_size_class",
	"computed_type" text,
	"weights_used" jsonb,
	"strengths" jsonb,
	"weaknesses" jsonb,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid,
	"user_id" uuid,
	"anon_token_hash" text,
	"kind" text DEFAULT 'basic' NOT NULL,
	"status" "assessment_status" DEFAULT 'draft' NOT NULL,
	"bank_version_id" uuid NOT NULL,
	"rule_set_version" integer,
	"respondent_role" text,
	"waqf_label" text,
	"current_axis" text DEFAULT 'P' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_notes" text,
	"superseded_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "axis_scores" (
	"assessment_id" uuid NOT NULL,
	"axis_code" text NOT NULL,
	"waqf_id" uuid,
	"score" numeric(5, 2),
	"capped" boolean DEFAULT false NOT NULL,
	"applicable_count" integer NOT NULL,
	"answered_count" integer NOT NULL,
	CONSTRAINT "axis_scores_assessment_id_axis_code_pk" PRIMARY KEY("assessment_id","axis_code")
);
--> statement-breakpoint
CREATE TABLE "critical_flag_defs" (
	"code" text PRIMARY KEY NOT NULL,
	"title_ar" text NOT NULL,
	"reference_text" text NOT NULL,
	"penalty_text" text,
	"penalty_code" text,
	"axis_code" text,
	"action_ar" text,
	"severity" "severity" DEFAULT 'critical' NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "critical_flags" (
	"assessment_id" uuid NOT NULL,
	"flag_code" text NOT NULL,
	"waqf_id" uuid,
	"question_code" text,
	"evidence" text,
	CONSTRAINT "critical_flags_assessment_id_flag_code_pk" PRIMARY KEY("assessment_id","flag_code")
);
--> statement-breakpoint
CREATE TABLE "document_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version_id" uuid,
	"waqf_id" uuid,
	"user_id" uuid,
	"action" text NOT NULL,
	"ip" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_links" (
	"document_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"waqf_id" uuid,
	CONSTRAINT "document_links_document_id_entity_type_entity_id_pk" PRIMARY KEY("document_id","entity_type","entity_id")
);
--> statement-breakpoint
CREATE TABLE "document_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"waqf_id" uuid,
	"token_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_uses" integer DEFAULT 5 NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"waqf_id" uuid,
	"version" integer NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"mime_type" text NOT NULL,
	"original_name" text NOT NULL,
	"encrypted" boolean DEFAULT true NOT NULL,
	"iv" text,
	"auth_tag" text,
	"scan_status" "scan_status" DEFAULT 'pending' NOT NULL,
	"scan_detail" text,
	"uploaded_by" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_note" text
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid,
	"owner_user_id" uuid NOT NULL,
	"request_id" uuid,
	"doc_type" text NOT NULL,
	"title" text NOT NULL,
	"number" text,
	"issuer" text,
	"issued_on" date,
	"issued_on_hijri" text,
	"expires_on" date,
	"confidentiality" "doc_confidentiality" DEFAULT 'internal' NOT NULL,
	"status" "doc_status" DEFAULT 'quarantine' NOT NULL,
	"approval_status" "doc_approval" DEFAULT 'none' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"retention_until" date,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"search_text" text,
	"ai_suggested_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "extracted_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"waqf_id" uuid,
	"field" text NOT NULL,
	"value" text,
	"page" integer,
	"confidence" numeric(4, 3),
	"status" text DEFAULT 'extracted' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"source" text DEFAULT 'ai' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"assessment_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	"source" text NOT NULL,
	CONSTRAINT "facts_assessment_id_key_pk" PRIMARY KEY("assessment_id","key")
);
--> statement-breakpoint
CREATE TABLE "needs" (
	"code" text PRIMARY KEY NOT NULL,
	"group_code" text NOT NULL,
	"title_ar" text NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "question_bank_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"status" "publish_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "recommendation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "publish_status" DEFAULT 'draft' NOT NULL,
	"title_ar" text NOT NULL,
	"condition" jsonb NOT NULL,
	"need_code" text NOT NULL,
	"severity" "severity" NOT NULL,
	"urgency_days" integer DEFAULT 90 NOT NULL,
	"leverage" numeric(3, 2) DEFAULT '1' NOT NULL,
	"reason_ar" text NOT NULL,
	"why_it_matters_ar" text,
	"reference" text,
	"service_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suppress_if" jsonb,
	"self_service_hint_ar" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"times_fired" integer DEFAULT 0 NOT NULL,
	"times_converted" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"waqf_id" uuid,
	"rule_id" uuid NOT NULL,
	"rule_code" text NOT NULL,
	"rule_version" integer NOT NULL,
	"need_code" text NOT NULL,
	"severity" "severity" NOT NULL,
	"priority" numeric(6, 2) NOT NULL,
	"wave" integer NOT NULL,
	"title_ar" text NOT NULL,
	"reason_ar" text NOT NULL,
	"why_it_matters_ar" text,
	"reference" text,
	"service_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"self_service_hint_ar" text,
	"status" "rec_status" DEFAULT 'open' NOT NULL,
	"suppressed_note" text,
	"dismiss_reason" text,
	"service_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"waqf_id" uuid,
	"kind" text NOT NULL,
	"input" text NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"output" text NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"refused" boolean DEFAULT false NOT NULL,
	"refusal_reason" text,
	"feedback" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_label" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"waqf_id" uuid,
	"ip" text,
	"user_agent" text,
	"before" jsonb,
	"after" jsonb,
	"prev_hash" text,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"version" text NOT NULL,
	"granted" boolean NOT NULL,
	"ip" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"topic" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"handled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"slug" text NOT NULL,
	"title_ar" text NOT NULL,
	"summary" text,
	"body_md" text NOT NULL,
	"audience" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"topic" text,
	"status" "publish_status" DEFAULT 'draft' NOT NULL,
	"reviewer_specialty" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"last_verified_at" date,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"reading_minutes" integer,
	"requires_login" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "content_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"specialty" text NOT NULL,
	"decision" text NOT NULL,
	"notes" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"method" text DEFAULT 'otp_consent' NOT NULL,
	"otp_challenge_id" uuid,
	"ip" text,
	"user_agent" text,
	"content_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"name_ar" text NOT NULL,
	"body" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"kind" text NOT NULL,
	"template_code" text NOT NULL,
	"template_version" integer NOT NULL,
	"request_id" uuid,
	"waqf_id" uuid,
	"party_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"content_hash" text NOT NULL,
	"amount" numeric(18, 2),
	"status" text DEFAULT 'sent' NOT NULL,
	"signed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid,
	"request_id" uuid,
	"subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "data_subject_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"details" text,
	"result_document_id" uuid,
	"retained_data_note" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "deliverables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"waqf_id" uuid,
	"title" text NOT NULL,
	"document_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"signed_by" text,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"revision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "discounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"value" numeric(18, 2) NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"applies_to" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "faqs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"audience" text DEFAULT 'all' NOT NULL,
	"topic" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"status" "publish_status" DEFAULT 'published' NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"description" text NOT NULL,
	"reason" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "glossary_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"term" text NOT NULL,
	"definition" text NOT NULL,
	"synonyms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"related" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text,
	"status" "publish_status" DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"user_id" uuid NOT NULL,
	"waqf_id" uuid,
	"billed_to_name" text NOT NULL,
	"request_id" uuid,
	"subscription_id" uuid,
	"contract_id" uuid,
	"subtotal" numeric(18, 2) NOT NULL,
	"discount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat_rate" numeric(5, 2) DEFAULT '15' NOT NULL,
	"vat" numeric(18, 2) NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"issued_on" date NOT NULL,
	"due_on" date,
	"paid_on" date,
	"einvoice_uuid" text,
	"einvoice_status" text DEFAULT 'pending_integration' NOT NULL,
	"lines" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"waqf_id" uuid,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT true NOT NULL,
	"sms" boolean DEFAULT false NOT NULL,
	CONSTRAINT "notification_preferences_user_id_type_pk" PRIMARY KEY("user_id","type")
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"key" text PRIMARY KEY NOT NULL,
	"title_ar" text NOT NULL,
	"body_ar" text NOT NULL,
	"severity" "notif_severity" DEFAULT 'info' NOT NULL,
	"channels" jsonb DEFAULT '["in_app"]'::jsonb NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"waqf_id" uuid,
	"type" text NOT NULL,
	"severity" "notif_severity" DEFAULT 'info' NOT NULL,
	"title_ar" text NOT NULL,
	"body_ar" text,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"channel" "channel" NOT NULL,
	"to_address" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"status" "outbox_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider" text,
	"provider_ref" text,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_items" (
	"package_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"note" text,
	CONSTRAINT "package_items_package_id_service_id_pk" PRIMARY KEY("package_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"description" text,
	"audience" text,
	"target_size_classes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"monthly_price" numeric(18, 2),
	"annual_price" numeric(18, 2),
	"terms_ar" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_closed" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"method" text,
	"amount" numeric(18, 2) NOT NULL,
	"status" text DEFAULT 'initiated' NOT NULL,
	"paid_at" timestamp with time zone,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "price_change_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"actor_user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid,
	"request_id" uuid,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"start_on" date,
	"end_on" date,
	"owner_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "report_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"waqf_id" uuid,
	"token_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"views" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"waqf_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"assessment_id" uuid,
	"verification_code" text NOT NULL,
	"document_id" uuid,
	"snapshot" jsonb,
	"generated_by" uuid,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "request_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"waqf_id" uuid,
	"from_status" text,
	"to_status" text,
	"note" text,
	"actor_user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"waqf_id" uuid,
	"author_id" uuid NOT NULL,
	"visibility" text DEFAULT 'client' NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"waqf_id" uuid,
	"stage_key" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sla_due_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"completed_by" uuid
);
--> statement-breakpoint
CREATE TABLE "sequences" (
	"key" text PRIMARY KEY NOT NULL,
	"value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"size_class" text,
	"price" numeric(18, 2) NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "service_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"service_id" uuid NOT NULL,
	"waqf_id" uuid,
	"requester_user_id" uuid NOT NULL,
	"status" "request_status" DEFAULT 'draft' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_ref" uuid,
	"details" text,
	"intake" jsonb,
	"assigned_to_user_id" uuid,
	"department_key" text,
	"current_stage_key" text,
	"sla_due_at" timestamp with time zone,
	"quote_amount" numeric(18, 2),
	"agreed_price" numeric(18, 2),
	"conflict_check" text DEFAULT 'pending' NOT NULL,
	"conflict_note" text,
	"hold_reason" text,
	"hold_party" text,
	"hold_follow_up_on" date,
	"cancel_reason" text,
	"reject_reason" text,
	"rating" integer,
	"rating_comment" text,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"category_id" uuid NOT NULL,
	"name_ar" text NOT NULL,
	"summary" text NOT NULL,
	"description" text,
	"requirements" text,
	"required_documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outputs" text,
	"pricing_model" "pricing_model" NOT NULL,
	"base_price" numeric(18, 2),
	"currency" text DEFAULT 'SAR' NOT NULL,
	"sla_days" integer,
	"department_key" text,
	"default_specialist_role" text,
	"regulatory_restrictions" text,
	"conflict_rule" text DEFAULT 'none' NOT NULL,
	"requires_license_key" text,
	"workflow_template_code" text DEFAULT 'standard' NOT NULL,
	"audiences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stage" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"description" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid,
	"user_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"billing_cycle" text DEFAULT 'annual' NOT NULL,
	"price" numeric(18, 2) NOT NULL,
	"status" text DEFAULT 'pending_payment' NOT NULL,
	"starts_on" date,
	"renews_on" date,
	"cancelled_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "task_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"waqf_id" uuid,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waqf_id" uuid,
	"request_id" uuid,
	"project_id" uuid,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"source_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"assignee_user_id" uuid,
	"due_on" date,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" "task_status" DEFAULT 'todo' NOT NULL,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"visibility" text DEFAULT 'shared' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "workflow_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"stages" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "break_glass_access" ADD CONSTRAINT "break_glass_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_agent_user_id_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_factors" ADD CONSTRAINT "mfa_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waqf_memberships" ADD CONSTRAINT "waqf_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bodies" ADD CONSTRAINT "bodies_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "body_memberships" ADD CONSTRAINT "body_memberships_body_id_bodies_id_fk" FOREIGN KEY ("body_id") REFERENCES "public"."bodies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condition_interpretations" ADD CONSTRAINT "condition_interpretations_condition_id_conditions_id_fk" FOREIGN KEY ("condition_id") REFERENCES "public"."conditions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conditions" ADD CONSTRAINT "conditions_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deed_versions" ADD CONSTRAINT "deed_versions_deed_id_waqf_deeds_id_fk" FOREIGN KEY ("deed_id") REFERENCES "public"."waqf_deeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founders" ADD CONSTRAINT "founders_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_allocations" ADD CONSTRAINT "revenue_allocations_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "successions" ADD CONSTRAINT "successions_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trustee_appointments" ADD CONSTRAINT "trustee_appointments_trustee_id_trustees_id_fk" FOREIGN KEY ("trustee_id") REFERENCES "public"."trustees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trustees" ADD CONSTRAINT "trustees_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waqf_classifications" ADD CONSTRAINT "waqf_classifications_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waqf_deeds" ADD CONSTRAINT "waqf_deeds_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waqf_exceptions" ADD CONSTRAINT "waqf_exceptions_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waqf_governance_profiles" ADD CONSTRAINT "waqf_governance_profiles_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waqf_registrations" ADD CONSTRAINT "waqf_registrations_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waqf_timeline_events" ADD CONSTRAINT "waqf_timeline_events_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beneficial_owners" ADD CONSTRAINT "beneficial_owners_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_class_id_beneficiary_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."beneficiary_classes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beneficiary_classes" ADD CONSTRAINT "beneficiary_classes_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_lines" ADD CONSTRAINT "distribution_lines_distribution_id_distributions_id_fk" FOREIGN KEY ("distribution_id") REFERENCES "public"."distributions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distribution_lines" ADD CONSTRAINT "distribution_lines_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distributions" ADD CONSTRAINT "distributions_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encumbrances" ADD CONSTRAINT "encumbrances_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_policies" ADD CONSTRAINT "investment_policies_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investments" ADD CONSTRAINT "investments_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leases" ADD CONSTRAINT "leases_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuations" ADD CONSTRAINT "valuations_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_items" ADD CONSTRAINT "agenda_items_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_declarations" ADD CONSTRAINT "conflict_declarations_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_statements" ADD CONSTRAINT "financial_statements_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minute_signatures" ADD CONSTRAINT "minute_signatures_minute_id_minutes_id_fk" FOREIGN KEY ("minute_id") REFERENCES "public"."minutes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minutes" ADD CONSTRAINT "minutes_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolutions" ADD CONSTRAINT "resolutions_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_resolution_id_resolutions_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "public"."resolutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligation_events" ADD CONSTRAINT "obligation_events_instance_id_obligation_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."obligation_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligation_instances" ADD CONSTRAINT "obligation_instances_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligation_instances" ADD CONSTRAINT "obligation_instances_obligation_id_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."obligations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_requirement_id_regulatory_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."regulatory_requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regulatory_requirements" ADD CONSTRAINT "regulatory_requirements_reference_id_regulatory_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."regulatory_references"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_register" ADD CONSTRAINT "risk_register_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "violations" ADD CONSTRAINT "violations_waqf_id_waqfs_id_fk" FOREIGN KEY ("waqf_id") REFERENCES "public"."waqfs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_plans" ADD CONSTRAINT "action_plans_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_answers" ADD CONSTRAINT "assessment_answers_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_axes" ADD CONSTRAINT "assessment_axes_bank_version_id_question_bank_versions_id_fk" FOREIGN KEY ("bank_version_id") REFERENCES "public"."question_bank_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_questions" ADD CONSTRAINT "assessment_questions_bank_version_id_question_bank_versions_id_fk" FOREIGN KEY ("bank_version_id") REFERENCES "public"."question_bank_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "axis_scores" ADD CONSTRAINT "axis_scores_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "critical_flags" ADD CONSTRAINT "critical_flags_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_fields" ADD CONSTRAINT "extracted_fields_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reviews" ADD CONSTRAINT "content_reviews_content_id_content_items_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_items" ADD CONSTRAINT "package_items_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_items" ADD CONSTRAINT "package_items_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_events" ADD CONSTRAINT "request_events_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_notes" ADD CONSTRAINT "request_notes_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_stages" ADD CONSTRAINT "request_stages_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_category_id_service_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."service_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deleg_waqf_idx" ON "delegations" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "deleg_agent_idx" ON "delegations" USING btree ("agent_user_id");--> statement-breakpoint
CREATE INDEX "devices_user_idx" ON "devices" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inv_token_uq" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "inv_waqf_idx" ON "invitations" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "otp_target_idx" ON "otp_challenges" USING btree ("target","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_key_uq" ON "permissions" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_key_uq" ON "roles" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_uq" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_nid_hash_idx" ON "users" USING btree ("national_id_hash");--> statement-breakpoint
CREATE INDEX "wm_waqf_idx" ON "waqf_memberships" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "wm_user_idx" ON "waqf_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wm_unique_active" ON "waqf_memberships" USING btree ("waqf_id","user_id","role_key");--> statement-breakpoint
CREATE INDEX "approvals_waqf_idx" ON "approvals" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "bodies_waqf_idx" ON "bodies" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "bm_body_idx" ON "body_memberships" USING btree ("body_id");--> statement-breakpoint
CREATE INDEX "bm_waqf_idx" ON "body_memberships" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "cond_waqf_idx" ON "conditions" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "founders_waqf_idx" ON "founders" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "kyc_subject_idx" ON "kyc_records" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "persons_user_idx" ON "persons" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "persons_nid_idx" ON "persons" USING btree ("national_id_hash");--> statement-breakpoint
CREATE INDEX "ta_waqf_idx" ON "trustee_appointments" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "trustees_waqf_idx" ON "trustees" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "wc_waqf_idx" ON "waqf_classifications" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "deeds_waqf_idx" ON "waqf_deeds" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "wr_waqf_idx" ON "waqf_registrations" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "wte_waqf_idx" ON "waqf_timeline_events" USING btree ("waqf_id");--> statement-breakpoint
CREATE UNIQUE INDEX "waqfs_internal_uq" ON "waqfs" USING btree ("internal_number");--> statement-breakpoint
CREATE INDEX "waqfs_nun_idx" ON "waqfs" USING btree ("national_unified_number");--> statement-breakpoint
CREATE INDEX "assets_waqf_idx" ON "assets" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "bo_waqf_idx" ON "beneficial_owners" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "ben_waqf_idx" ON "beneficiaries" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "ben_user_idx" ON "beneficiaries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bc_waqf_idx" ON "beneficiary_classes" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "dl_dist_idx" ON "distribution_lines" USING btree ("distribution_id");--> statement-breakpoint
CREATE INDEX "dl_ben_idx" ON "distribution_lines" USING btree ("beneficiary_id");--> statement-breakpoint
CREATE INDEX "dist_waqf_idx" ON "distributions" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "ent_ben_idx" ON "entitlements" USING btree ("beneficiary_id");--> statement-breakpoint
CREATE INDEX "leases_asset_idx" ON "leases" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "ba_waqf_idx" ON "bank_accounts" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "coi_waqf_idx" ON "conflict_declarations" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "coi_item_idx" ON "conflict_declarations" USING btree ("agenda_item_id");--> statement-breakpoint
CREATE INDEX "le_waqf_date_idx" ON "ledger_entries" USING btree ("waqf_id","entry_date");--> statement-breakpoint
CREATE INDEX "meet_waqf_idx" ON "meetings" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "pol_waqf_idx" ON "policies" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "res_waqf_idx" ON "resolutions" USING btree ("waqf_id");--> statement-breakpoint
CREATE UNIQUE INDEX "res_number_uq" ON "resolutions" USING btree ("waqf_id","number");--> statement-breakpoint
CREATE INDEX "comp_waqf_idx" ON "complaints" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "oi_waqf_idx" ON "obligation_instances" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "oi_due_idx" ON "obligation_instances" USING btree ("due_on");--> statement-breakpoint
CREATE UNIQUE INDEX "oi_dedupe_uq" ON "obligation_instances" USING btree ("waqf_id","obligation_id","period_key");--> statement-breakpoint
CREATE UNIQUE INDEX "obl_code_uq" ON "obligations" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "pen_code_uq" ON "penalty_schedule" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "regref_code_uq" ON "regulatory_references" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "regreq_code_uq" ON "regulatory_requirements" USING btree ("code");--> statement-breakpoint
CREATE INDEX "risk_waqf_idx" ON "risk_register" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "viol_waqf_idx" ON "violations" USING btree ("waqf_id");--> statement-breakpoint
CREATE UNIQUE INDEX "axes_ver_code_uq" ON "assessment_axes" USING btree ("bank_version_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "aq_ver_code_uq" ON "assessment_questions" USING btree ("bank_version_id","code");--> statement-breakpoint
CREATE INDEX "ass_waqf_idx" ON "assessments" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "ass_user_idx" ON "assessments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ass_anon_idx" ON "assessments" USING btree ("anon_token_hash");--> statement-breakpoint
CREATE INDEX "dal_doc_idx" ON "document_access_log" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "dl_entity_idx" ON "document_links" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ds_token_uq" ON "document_shares" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "dv_doc_ver_uq" ON "document_versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE INDEX "docs_waqf_idx" ON "documents" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "docs_req_idx" ON "documents" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "docs_exp_idx" ON "documents" USING btree ("expires_on");--> statement-breakpoint
CREATE UNIQUE INDEX "qbv_version_uq" ON "question_bank_versions" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "rr_code_ver_uq" ON "recommendation_rules" USING btree ("code","version");--> statement-breakpoint
CREATE INDEX "rec_ass_idx" ON "recommendations" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "rec_waqf_idx" ON "recommendations" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "ai_waqf_idx" ON "ai_interactions" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "audit_waqf_idx" ON "audit_logs" USING btree ("waqf_id","at");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_logs" USING btree ("actor_user_id","at");--> statement-breakpoint
CREATE INDEX "consents_user_idx" ON "consents" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_slug_uq" ON "content_items" USING btree ("kind","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "ct_code_ver_uq" ON "contract_templates" USING btree ("code","version");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_number_uq" ON "contracts" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "disc_code_uq" ON "discounts" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "gloss_slug_uq" ON "glossary_terms" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "inv_number_uq" ON "invoices" USING btree ("number");--> statement-breakpoint
CREATE INDEX "inv_user_idx" ON "invoices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notif_user_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pkg_code_uq" ON "packages" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_number_uq" ON "reports" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_vcode_uq" ON "reports" USING btree ("verification_code");--> statement-breakpoint
CREATE INDEX "rs_req_idx" ON "request_stages" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sc_code_uq" ON "service_categories" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "sr_number_uq" ON "service_requests" USING btree ("number");--> statement-breakpoint
CREATE INDEX "sr_waqf_idx" ON "service_requests" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "sr_assignee_idx" ON "service_requests" USING btree ("assigned_to_user_id");--> statement-breakpoint
CREATE INDEX "sr_requester_idx" ON "service_requests" USING btree ("requester_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "svc_code_uq" ON "services" USING btree ("code");--> statement-breakpoint
CREATE INDEX "tasks_waqf_idx" ON "tasks" USING btree ("waqf_id");--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("assignee_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wt_code_uq" ON "workflow_templates" USING btree ("code");