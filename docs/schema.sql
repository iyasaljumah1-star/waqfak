--
-- PostgreSQL database dump
--

\restrict 2NSqCXDLKFSNHFlO9CboTJvrHMvHiF9NIlNaOE3zbPauG7ZhFd00Xf6Zt0Qo3EY

-- Dumped from database version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: drizzle; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA drizzle;


--
-- Name: restricted; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA restricted;


--
-- Name: answer_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.answer_type AS ENUM (
    'yes_no',
    'yes_partial_no',
    'maturity',
    'band',
    'date',
    'select',
    'multiselect',
    'number',
    'text'
);


--
-- Name: approval_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.approval_kind AS ENUM (
    'substitution',
    'mortgage',
    'condition_deviation',
    'interpretation',
    'nazir_fee',
    'donations',
    'merger',
    'long_lease',
    'other'
);


--
-- Name: approval_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.approval_status AS ENUM (
    'draft',
    'submitted',
    'granted',
    'rejected',
    'withdrawn'
);


--
-- Name: assessment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.assessment_status AS ENUM (
    'draft',
    'completed',
    'computed',
    'under_review',
    'published',
    'superseded'
);


--
-- Name: asset_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.asset_category AS ENUM (
    'real_estate',
    'movable',
    'usufruct',
    'intellectual_property',
    'cash',
    'shares',
    'fund_units',
    'portfolio',
    'sukuk'
);


--
-- Name: asset_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.asset_status AS ENUM (
    'income',
    'vacant',
    'development',
    'idle',
    'disputed'
);


--
-- Name: asset_subject; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.asset_subject AS ENUM (
    'corpus',
    'value'
);


--
-- Name: authority_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.authority_kind AS ENUM (
    'competent_authority',
    'gaa',
    'court',
    'cma',
    'fiu',
    'notary',
    'internal'
);


--
-- Name: binding_level; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.binding_level AS ENUM (
    'binding',
    'guidance',
    'draft',
    'reference'
);


--
-- Name: channel; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.channel AS ENUM (
    'in_app',
    'email',
    'sms',
    'push',
    'whatsapp'
);


--
-- Name: condition_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.condition_category AS ENUM (
    'asset',
    'revenue',
    'masraf',
    'nazara',
    'founder_self',
    'governance_finance'
);


--
-- Name: doc_approval; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.doc_approval AS ENUM (
    'none',
    'draft',
    'in_review',
    'approved',
    'locked'
);


--
-- Name: doc_confidentiality; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.doc_confidentiality AS ENUM (
    'internal',
    'confidential',
    'secret'
);


--
-- Name: doc_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.doc_status AS ENUM (
    'quarantine',
    'active',
    'rejected',
    'archived'
);


--
-- Name: evidence_level; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.evidence_level AS ENUM (
    'declared',
    'document',
    'verified'
);


--
-- Name: id_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.id_type AS ENUM (
    'national_id',
    'iqama',
    'passport',
    'gcc_id',
    'cr',
    'other'
);


--
-- Name: meeting_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.meeting_status AS ENUM (
    'scheduled',
    'held',
    'cancelled'
);


--
-- Name: membership_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.membership_status AS ENUM (
    'invited',
    'active',
    'suspended',
    'ended'
);


--
-- Name: mfa_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.mfa_type AS ENUM (
    'totp',
    'passkey'
);


--
-- Name: minutes_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.minutes_status AS ENUM (
    'draft',
    'circulated',
    'approved',
    'locked'
);


--
-- Name: nazir_mode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.nazir_mode AS ENUM (
    'founder',
    'individual',
    'board',
    'legal_entity',
    'gaa',
    'vacant'
);


--
-- Name: notif_severity; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.notif_severity AS ENUM (
    'critical',
    'important',
    'info'
);


--
-- Name: obligation_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.obligation_status AS ENUM (
    'upcoming',
    'due_soon',
    'overdue',
    'done',
    'waived'
);


--
-- Name: otp_purpose; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.otp_purpose AS ENUM (
    'signup',
    'login',
    'recover',
    'change_phone',
    'delete_account',
    'sign_contract',
    'step_up'
);


--
-- Name: outbox_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.outbox_status AS ENUM (
    'queued',
    'sent',
    'failed'
);


--
-- Name: pricing_model; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.pricing_model AS ENUM (
    'free',
    'fixed',
    'subscription',
    'hourly',
    'percentage',
    'quote'
);


--
-- Name: publish_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.publish_status AS ENUM (
    'draft',
    'in_review',
    'published',
    'retired'
);


--
-- Name: rec_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.rec_status AS ENUM (
    'open',
    'accepted',
    'dismissed',
    'converted',
    'suppressed'
);


--
-- Name: request_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.request_status AS ENUM (
    'draft',
    'submitted',
    'triage',
    'awaiting_client',
    'quote',
    'awaiting_contract',
    'in_progress',
    'quality_review',
    'awaiting_client_approval',
    'completed',
    'closed',
    'on_hold',
    'cancelled',
    'rejected'
);


--
-- Name: resolution_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.resolution_status AS ENUM (
    'draft',
    'approved',
    'rejected',
    'deferred',
    'executed',
    'reviewed'
);


--
-- Name: role_scope; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.role_scope AS ENUM (
    'global',
    'waqf'
);


--
-- Name: scan_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.scan_status AS ENUM (
    'pending',
    'clean',
    'infected',
    'failed'
);


--
-- Name: severity; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.severity AS ENUM (
    'critical',
    'high',
    'medium',
    'low'
);


--
-- Name: sharia_review; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.sharia_review AS ENUM (
    'not_reviewed',
    'approved',
    'needs_amendment',
    'possibly_void'
);


--
-- Name: task_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.task_status AS ENUM (
    'todo',
    'in_progress',
    'done',
    'cancelled'
);


--
-- Name: user_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_status AS ENUM (
    'pending',
    'active',
    'locked',
    'deletion_requested',
    'deleted'
);


--
-- Name: verification_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.verification_status AS ENUM (
    'verified',
    'pending_verification'
);


--
-- Name: vote_value; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.vote_value AS ENUM (
    'for',
    'against',
    'abstain',
    'recused'
);


--
-- Name: waqf_creation_mode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.waqf_creation_mode AS ENUM (
    'inter_vivos',
    'bequest'
);


--
-- Name: waqf_legal_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.waqf_legal_type AS ENUM (
    'public',
    'private',
    'joint'
);


--
-- Name: waqf_size_class; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.waqf_size_class AS ENUM (
    'large',
    'medium',
    'small',
    'direct_benefit'
);


--
-- Name: waqf_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.waqf_status AS ENUM (
    'idea',
    'draft',
    'documenting',
    'documented',
    'registered',
    'active',
    'suspended',
    'ended'
);


--
-- Name: waqfak_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.waqfak_role AS ENUM (
    'none',
    'advisor',
    'delegated_manager',
    'nazir',
    'board_member',
    'bookkeeper'
);


--
-- Name: app_audit_last_hash(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_audit_last_hash() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1
$$;


--
-- Name: app_can_access_waqf(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_can_access_waqf(w uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    w IS NULL
    OR app_has_global_access()
    OR EXISTS (
      SELECT 1 FROM waqf_memberships m
      WHERE m.waqf_id = w AND m.user_id = app_current_user() AND m.status = 'active'
        AND (m.ends_at IS NULL OR m.ends_at > now())
    )
    OR EXISTS (
      SELECT 1 FROM service_requests r
      WHERE r.waqf_id = w AND r.assigned_to_user_id = app_current_user()
        AND r.status NOT IN ('closed', 'cancelled', 'rejected')
    )
    OR EXISTS (
      SELECT 1 FROM delegations d
      WHERE d.waqf_id = w AND d.agent_user_id = app_current_user() AND d.status = 'active'
        AND current_date BETWEEN d.valid_from AND d.valid_to
    )
    OR EXISTS (
      SELECT 1 FROM break_glass_access b
      WHERE b.waqf_id = w AND b.user_id = app_current_user() AND b.status = 'approved' AND b.expires_at > now()
    )
$$;


--
-- Name: app_current_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_current_user() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;


--
-- Name: app_has_global_access(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_has_global_access() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT coalesce(current_setting('app.global_access', true), 'off') = 'on'
$$;


--
-- Name: app_waqf_has_members(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_waqf_has_members(w uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM waqf_memberships WHERE waqf_id = w)
$$;


--
-- Name: forbid_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.forbid_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'append-only table: % is not allowed on %', TG_OP, TG_TABLE_NAME;
END $$;


--
-- Name: protect_locked_minutes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_locked_minutes() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.status = 'locked' THEN
    RAISE EXCEPTION 'minutes are locked; create a new version instead';
  END IF;
  RETURN NEW;
END $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: __drizzle_migrations; Type: TABLE; Schema: drizzle; Owner: -
--

CREATE TABLE drizzle.__drizzle_migrations (
    id integer NOT NULL,
    hash text NOT NULL,
    created_at bigint
);


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE; Schema: drizzle; Owner: -
--

CREATE SEQUENCE drizzle.__drizzle_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: drizzle; Owner: -
--

ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNED BY drizzle.__drizzle_migrations.id;


--
-- Name: action_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.action_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    assessment_id uuid NOT NULL,
    waqf_id uuid,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    summary jsonb,
    suggested_package_code text
);


--
-- Name: agenda_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agenda_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    meeting_id uuid NOT NULL,
    waqf_id uuid NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    title text NOT NULL,
    presenter_name text,
    kind text DEFAULT 'discussion'::text NOT NULL,
    condition_id uuid,
    document_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: ai_interactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_interactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    waqf_id uuid,
    kind text NOT NULL,
    input text NOT NULL,
    sources jsonb DEFAULT '[]'::jsonb NOT NULL,
    output text NOT NULL,
    provider text NOT NULL,
    model text,
    refused boolean DEFAULT false NOT NULL,
    refusal_reason text,
    feedback text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    kind public.approval_kind NOT NULL,
    authority public.authority_kind NOT NULL,
    status public.approval_status DEFAULT 'draft'::public.approval_status NOT NULL,
    subject text NOT NULL,
    ref_no text,
    submitted_on date,
    decided_on date,
    asset_id uuid,
    document_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: assessment_answers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessment_answers (
    assessment_id uuid NOT NULL,
    question_code text NOT NULL,
    waqf_id uuid,
    value jsonb,
    score numeric(3,1),
    is_unknown boolean DEFAULT false NOT NULL,
    is_na boolean DEFAULT false NOT NULL,
    evidence_level public.evidence_level DEFAULT 'declared'::public.evidence_level NOT NULL,
    evidence_document_id uuid,
    verified_by uuid,
    answered_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: assessment_axes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessment_axes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bank_version_id uuid NOT NULL,
    code text NOT NULL,
    name_ar text NOT NULL,
    description text,
    weight_small numeric(5,2) NOT NULL,
    weight_medium numeric(5,2) NOT NULL,
    weight_large numeric(5,2) NOT NULL,
    "position" integer NOT NULL
);


--
-- Name: assessment_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessment_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bank_version_id uuid NOT NULL,
    code text NOT NULL,
    axis_code text NOT NULL,
    text_ar text NOT NULL,
    help_ar text,
    answer_type public.answer_type NOT NULL,
    options jsonb,
    weight integer DEFAULT 1 NOT NULL,
    reference_text text,
    critical_flag_code text,
    critical_when jsonb,
    show_if jsonb,
    fact_key text,
    depth text DEFAULT 'basic'::text NOT NULL,
    "position" integer NOT NULL
);


--
-- Name: assessment_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessment_results (
    assessment_id uuid NOT NULL,
    waqf_id uuid,
    overall_score numeric(5,2) NOT NULL,
    maturity_score numeric(5,2) NOT NULL,
    maturity_level text NOT NULL,
    status text NOT NULL,
    confidence text NOT NULL,
    evidence_ratio numeric(5,2),
    knowledge_gaps integer DEFAULT 0 NOT NULL,
    size_class public.waqf_size_class,
    computed_type text,
    weights_used jsonb,
    strengths jsonb,
    weaknesses jsonb,
    computed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: assessments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid,
    user_id uuid,
    anon_token_hash text,
    kind text DEFAULT 'basic'::text NOT NULL,
    status public.assessment_status DEFAULT 'draft'::public.assessment_status NOT NULL,
    bank_version_id uuid NOT NULL,
    rule_set_version integer,
    respondent_role text,
    waqf_label text,
    current_axis text DEFAULT 'P'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    review_notes text,
    superseded_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    category public.asset_category NOT NULL,
    subject public.asset_subject DEFAULT 'corpus'::public.asset_subject NOT NULL,
    title text NOT NULL,
    ownership_doc_no text,
    ownership_document_id uuid,
    in_waqf_name boolean,
    share_pct numeric(5,2),
    book_value numeric(18,2),
    market_value numeric(18,2),
    last_valuation_on date,
    valuer text,
    status public.asset_status DEFAULT 'income'::public.asset_status NOT NULL,
    annual_income numeric(18,2),
    acquired_on date,
    notes text,
    condition_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid,
    archived_at timestamp with time zone,
    archive_reason text
);


--
-- Name: attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance (
    meeting_id uuid NOT NULL,
    body_membership_id uuid NOT NULL,
    waqf_id uuid NOT NULL,
    status text DEFAULT 'invited'::text NOT NULL,
    mode text,
    recorded_at timestamp with time zone
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id bigint NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    actor_user_id uuid,
    actor_label text,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    waqf_id uuid,
    ip text,
    user_agent text,
    before jsonb,
    after jsonb,
    prev_hash text,
    hash text NOT NULL
);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;


--
-- Name: axis_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.axis_scores (
    assessment_id uuid NOT NULL,
    axis_code text NOT NULL,
    waqf_id uuid,
    score numeric(5,2),
    capped boolean DEFAULT false NOT NULL,
    applicable_count integer NOT NULL,
    answered_count integer NOT NULL
);


--
-- Name: bank_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    bank_name text NOT NULL,
    iban_enc text NOT NULL,
    iban_last4 text NOT NULL,
    in_waqf_name boolean NOT NULL,
    purpose text DEFAULT 'general'::text NOT NULL,
    opened_on date,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: beneficial_owners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beneficial_owners (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    subject_type text DEFAULT 'person'::text NOT NULL,
    role text NOT NULL,
    full_name text NOT NULL,
    nationality text,
    birth_date date,
    birth_place text,
    address_enc text,
    contact text,
    id_type text,
    id_number_enc text,
    id_number_hash text,
    acquired_on date,
    bank_details_enc text,
    relation_to_waqf text,
    entitlement_desc text,
    legal_form text,
    national_address text,
    directors jsonb,
    powers text,
    resides_in_ksa boolean,
    verified_on date,
    verification_source text,
    risk_level text DEFAULT 'standard'::text NOT NULL,
    next_verification_due date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid,
    archived_at timestamp with time zone,
    archive_reason text
);


--
-- Name: beneficiaries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beneficiaries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    class_id uuid,
    person_id uuid,
    organization_id uuid,
    display_name text NOT NULL,
    user_id uuid,
    status text DEFAULT 'active'::text NOT NULL,
    entitlement_share numeric(9,6),
    resides_abroad boolean DEFAULT false NOT NULL,
    generation integer,
    parent_beneficiary_id uuid,
    last_verified_on date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid,
    archived_at timestamp with time zone,
    archive_reason text
);


--
-- Name: beneficiary_classes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beneficiary_classes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    specified_by text DEFAULT 'description'::text NOT NULL,
    tier integer DEFAULT 1 NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    relation text DEFAULT 'and'::text NOT NULL,
    share_pct numeric(5,2),
    criteria jsonb,
    division_rule text,
    substitution_rule text,
    end_tier text,
    alternate_masraf text,
    is_final_destination boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: bodies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bodies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    kind text NOT NULL,
    name text NOT NULL,
    charter text,
    parent_body_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: body_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.body_memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    body_id uuid NOT NULL,
    waqf_id uuid NOT NULL,
    user_id uuid,
    person_name text NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    is_independent boolean DEFAULT false NOT NULL,
    has_vote boolean DEFAULT true NOT NULL,
    starts_on date,
    ends_on date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: break_glass_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.break_glass_access (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    waqf_id uuid NOT NULL,
    reason text NOT NULL,
    status text DEFAULT 'requested'::text NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: budgets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budgets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    fiscal_year integer NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    total_revenue numeric(18,2),
    total_expense numeric(18,2),
    lines jsonb,
    approved_by_resolution_id uuid,
    approved_on date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: complaints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.complaints (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    number text NOT NULL,
    raised_by_user_id uuid NOT NULL,
    beneficiary_id uuid,
    kind text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    sla_due_at timestamp with time zone NOT NULL,
    response text,
    responded_at timestamp with time zone,
    responded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: compliance_change_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_change_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    change jsonb NOT NULL,
    actor_user_id uuid,
    at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: condition_interpretations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.condition_interpretations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    condition_id uuid NOT NULL,
    waqf_id uuid NOT NULL,
    text text NOT NULL,
    source text NOT NULL,
    signed_by text,
    document_id uuid,
    decided_on date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: conditions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conditions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    category public.condition_category NOT NULL,
    clause_ref text,
    literal_text text NOT NULL,
    interpretation text,
    interpretation_source text,
    sharia_review public.sharia_review DEFAULT 'not_reviewed'::public.sharia_review NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: conflict_declarations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conflict_declarations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    user_id uuid NOT NULL,
    meeting_id uuid,
    agenda_item_id uuid,
    kind text NOT NULL,
    relation_degree integer,
    description text,
    action text DEFAULT 'recuse'::text NOT NULL,
    is_annual boolean DEFAULT false NOT NULL,
    year integer,
    disclosed_to_gaa_on date,
    declared_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: consents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    version text NOT NULL,
    granted boolean NOT NULL,
    ip text,
    at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: contact_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    phone text,
    email text,
    topic text NOT NULL,
    body text NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    handled_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: content_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    slug text NOT NULL,
    title_ar text NOT NULL,
    summary text,
    body_md text NOT NULL,
    audience jsonb DEFAULT '[]'::jsonb NOT NULL,
    topic text,
    status public.publish_status DEFAULT 'draft'::public.publish_status NOT NULL,
    reviewer_specialty text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    published_at timestamp with time zone,
    last_verified_at date,
    source_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
    seo_title text,
    seo_description text,
    reading_minutes integer,
    requires_login boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: content_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    content_id uuid NOT NULL,
    reviewer_id uuid NOT NULL,
    specialty text NOT NULL,
    decision text NOT NULL,
    notes text,
    at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: contract_signatures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_signatures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contract_id uuid NOT NULL,
    user_id uuid NOT NULL,
    signed_at timestamp with time zone DEFAULT now() NOT NULL,
    method text DEFAULT 'otp_consent'::text NOT NULL,
    otp_challenge_id uuid,
    ip text,
    user_agent text,
    content_hash text NOT NULL
);


--
-- Name: contract_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    kind text NOT NULL,
    name_ar text NOT NULL,
    body text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contracts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    number text NOT NULL,
    kind text NOT NULL,
    template_code text NOT NULL,
    template_version integer NOT NULL,
    request_id uuid,
    waqf_id uuid,
    party_user_id uuid NOT NULL,
    body text NOT NULL,
    content_hash text NOT NULL,
    amount numeric(18,2),
    status text DEFAULT 'sent'::text NOT NULL,
    signed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid,
    request_id uuid,
    subject text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: critical_flag_defs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.critical_flag_defs (
    code text NOT NULL,
    title_ar text NOT NULL,
    reference_text text NOT NULL,
    penalty_text text,
    penalty_code text,
    axis_code text,
    action_ar text,
    severity public.severity DEFAULT 'critical'::public.severity NOT NULL,
    active boolean DEFAULT true NOT NULL
);


--
-- Name: critical_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.critical_flags (
    assessment_id uuid NOT NULL,
    flag_code text NOT NULL,
    waqf_id uuid,
    question_code text,
    evidence text
);


--
-- Name: data_subject_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_subject_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    status text DEFAULT 'received'::text NOT NULL,
    details text,
    result_document_id uuid,
    retained_data_note text,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    due_at timestamp with time zone,
    completed_at timestamp with time zone
);


--
-- Name: deed_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deed_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deed_id uuid NOT NULL,
    waqf_id uuid NOT NULL,
    version integer NOT NULL,
    body text,
    structured jsonb,
    document_id uuid,
    change_note text,
    approval_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: delegations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delegations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    agent_user_id uuid NOT NULL,
    principal_user_id uuid,
    principal_name text,
    power_of_attorney_no text,
    document_id uuid,
    scope jsonb NOT NULL,
    includes_donations boolean DEFAULT false NOT NULL,
    includes_asset_disposal boolean DEFAULT false NOT NULL,
    valid_from date NOT NULL,
    valid_to date NOT NULL,
    status text DEFAULT 'pending_review'::text NOT NULL,
    verified_by uuid,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: deliverables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deliverables (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    waqf_id uuid,
    title text NOT NULL,
    document_id uuid,
    version integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    signed_by text,
    submitted_at timestamp with time zone,
    approved_at timestamp with time zone,
    approved_by uuid,
    revision_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    label text,
    fingerprint_hash text NOT NULL,
    trusted boolean DEFAULT false NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: discounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    kind text NOT NULL,
    value numeric(18,2) NOT NULL,
    valid_from date,
    valid_to date,
    applies_to jsonb DEFAULT '{}'::jsonb NOT NULL,
    max_uses integer,
    uses integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: distribution_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.distribution_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    distribution_id uuid NOT NULL,
    waqf_id uuid NOT NULL,
    beneficiary_id uuid NOT NULL,
    amount numeric(18,2) NOT NULL,
    reference_no text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    paid_on date,
    proof_document_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: distributions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.distributions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    period text NOT NULL,
    total_amount numeric(18,2) NOT NULL,
    status text DEFAULT 'planned'::text NOT NULL,
    due_by date,
    paid_on date,
    bank_account_id uuid,
    condition_id uuid,
    resolution_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: document_access_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_access_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    version_id uuid,
    waqf_id uuid,
    user_id uuid,
    action text NOT NULL,
    ip text,
    at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: document_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_links (
    document_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    waqf_id uuid
);


--
-- Name: document_shares; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_shares (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    waqf_id uuid,
    token_hash text NOT NULL,
    created_by uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    max_uses integer DEFAULT 5 NOT NULL,
    uses integer DEFAULT 0 NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: document_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    waqf_id uuid,
    version integer NOT NULL,
    storage_key text NOT NULL,
    sha256 text NOT NULL,
    size_bytes bigint NOT NULL,
    mime_type text NOT NULL,
    original_name text NOT NULL,
    encrypted boolean DEFAULT true NOT NULL,
    iv text,
    auth_tag text,
    scan_status public.scan_status DEFAULT 'pending'::public.scan_status NOT NULL,
    scan_detail text,
    uploaded_by uuid NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    change_note text
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid,
    owner_user_id uuid NOT NULL,
    request_id uuid,
    doc_type text NOT NULL,
    title text NOT NULL,
    number text,
    issuer text,
    issued_on date,
    issued_on_hijri text,
    expires_on date,
    confidentiality public.doc_confidentiality DEFAULT 'internal'::public.doc_confidentiality NOT NULL,
    status public.doc_status DEFAULT 'quarantine'::public.doc_status NOT NULL,
    approval_status public.doc_approval DEFAULT 'none'::public.doc_approval NOT NULL,
    current_version integer DEFAULT 1 NOT NULL,
    retention_until date,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    search_text text,
    ai_suggested_type text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid,
    archived_at timestamp with time zone
);


--
-- Name: encumbrances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.encumbrances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid NOT NULL,
    waqf_id uuid NOT NULL,
    kind text NOT NULL,
    details text,
    since date,
    resolved_on date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: entitlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entitlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    beneficiary_id uuid NOT NULL,
    period text NOT NULL,
    amount numeric(18,2) NOT NULL,
    basis text,
    expected_pay_on date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: extracted_fields; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.extracted_fields (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    waqf_id uuid,
    field text NOT NULL,
    value text,
    page integer,
    confidence numeric(4,3),
    status text DEFAULT 'extracted'::text NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    source text DEFAULT 'ai'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: facts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.facts (
    assessment_id uuid NOT NULL,
    key text NOT NULL,
    value jsonb,
    source text NOT NULL
);


--
-- Name: faqs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.faqs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    question text NOT NULL,
    answer text NOT NULL,
    audience text DEFAULT 'all'::text NOT NULL,
    topic text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    status public.publish_status DEFAULT 'published'::public.publish_status NOT NULL,
    source text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: feature_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feature_flags (
    key text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    description text NOT NULL,
    reason text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: financial_statements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financial_statements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    fiscal_year integer NOT NULL,
    kind text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    auditor_name text,
    auditor_license text,
    auditor_independent boolean,
    opinion text,
    total_revenue numeric(18,2),
    total_expense numeric(18,2),
    document_id uuid,
    submitted_to_gaa_on date,
    shared_with_beneficiaries boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: founders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.founders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    person_id uuid,
    organization_id uuid,
    display_name text NOT NULL,
    is_alive boolean DEFAULT true NOT NULL,
    nationality text,
    powers jsonb,
    user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: glossary_terms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.glossary_terms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    term text NOT NULL,
    definition text NOT NULL,
    synonyms jsonb DEFAULT '[]'::jsonb NOT NULL,
    related jsonb DEFAULT '[]'::jsonb NOT NULL,
    source text,
    status public.publish_status DEFAULT 'published'::public.publish_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: holidays; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.holidays (
    day date NOT NULL,
    name text NOT NULL
);


--
-- Name: investment_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.investment_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    target_return_pct numeric(6,3),
    risk_tolerance text,
    allocation jsonb,
    prohibited text,
    leverage_policy text,
    status text DEFAULT 'draft'::text NOT NULL,
    approved_by_resolution_id uuid,
    review_due date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: investments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.investments (
    asset_id uuid NOT NULL,
    waqf_id uuid NOT NULL,
    instrument_type text NOT NULL,
    issuer_name text,
    quantity numeric(18,4),
    cost_basis numeric(18,2),
    bonus_shares_treatment text,
    manager_name text,
    manager_cma_license text,
    custody_account text,
    management_agreement_doc_id uuid,
    fee_pct numeric(6,3),
    benchmark text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    phone text NOT NULL,
    role_key text NOT NULL,
    token_hash text NOT NULL,
    invited_by uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    accepted_by uuid,
    revoked_at timestamp with time zone,
    scope jsonb,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    number text NOT NULL,
    user_id uuid NOT NULL,
    waqf_id uuid,
    billed_to_name text NOT NULL,
    request_id uuid,
    subscription_id uuid,
    contract_id uuid,
    subtotal numeric(18,2) NOT NULL,
    discount numeric(18,2) DEFAULT '0'::numeric NOT NULL,
    vat_rate numeric(5,2) DEFAULT '15'::numeric NOT NULL,
    vat numeric(18,2) NOT NULL,
    total numeric(18,2) NOT NULL,
    currency text DEFAULT 'SAR'::text NOT NULL,
    status text DEFAULT 'issued'::text NOT NULL,
    issued_on date NOT NULL,
    due_on date,
    paid_on date,
    einvoice_uuid text,
    einvoice_status text DEFAULT 'pending_integration'::text NOT NULL,
    lines jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: job_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    status text DEFAULT 'running'::text NOT NULL,
    detail jsonb
);


--
-- Name: kyc_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kyc_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_type text NOT NULL,
    subject_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    risk_level text DEFAULT 'standard'::text NOT NULL,
    is_pep boolean DEFAULT false NOT NULL,
    source_of_funds text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    next_review_at date,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: leases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid NOT NULL,
    waqf_id uuid NOT NULL,
    tenant_name text NOT NULL,
    ejar_contract_no text,
    starts_on date,
    ends_on date,
    annual_rent numeric(18,2),
    collected_to_date numeric(18,2),
    arrears numeric(18,2),
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: ledger_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ledger_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    entry_date date NOT NULL,
    account_code text NOT NULL,
    description text NOT NULL,
    debit numeric(18,2) DEFAULT '0'::numeric NOT NULL,
    credit numeric(18,2) DEFAULT '0'::numeric NOT NULL,
    reference_no text,
    document_id uuid,
    condition_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: maintenance_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.maintenance_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid NOT NULL,
    waqf_id uuid NOT NULL,
    item text NOT NULL,
    frequency text,
    next_due_on date,
    estimated_cost numeric(18,2),
    status text DEFAULT 'planned'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: meetings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meetings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    body_id uuid,
    kind text DEFAULT 'regular'::text NOT NULL,
    title text NOT NULL,
    scheduled_at timestamp with time zone NOT NULL,
    location text,
    link text,
    status public.meeting_status DEFAULT 'scheduled'::public.meeting_status NOT NULL,
    invitations_sent_at timestamp with time zone,
    quorum_required integer,
    quorum_met boolean,
    held_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    waqf_id uuid,
    author_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mfa_factors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mfa_factors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    type public.mfa_type NOT NULL,
    secret_enc text NOT NULL,
    label text,
    verified_at timestamp with time zone,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: minute_signatures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.minute_signatures (
    minute_id uuid NOT NULL,
    user_id uuid NOT NULL,
    waqf_id uuid NOT NULL,
    signed_at timestamp with time zone DEFAULT now() NOT NULL,
    method text DEFAULT 'otp_consent'::text NOT NULL,
    content_hash text NOT NULL
);


--
-- Name: minutes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.minutes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    meeting_id uuid NOT NULL,
    waqf_id uuid NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    body text NOT NULL,
    status public.minutes_status DEFAULT 'draft'::public.minutes_status NOT NULL,
    prepared_by uuid,
    circulated_at timestamp with time zone,
    approved_at timestamp with time zone,
    locked_at timestamp with time zone,
    content_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: needs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.needs (
    code text NOT NULL,
    group_code text NOT NULL,
    title_ar text NOT NULL,
    description text
);


--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_preferences (
    user_id uuid NOT NULL,
    type text NOT NULL,
    in_app boolean DEFAULT true NOT NULL,
    email boolean DEFAULT true NOT NULL,
    sms boolean DEFAULT false NOT NULL
);


--
-- Name: notification_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_templates (
    key text NOT NULL,
    title_ar text NOT NULL,
    body_ar text NOT NULL,
    severity public.notif_severity DEFAULT 'info'::public.notif_severity NOT NULL,
    channels jsonb DEFAULT '["in_app"]'::jsonb NOT NULL,
    locked boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    waqf_id uuid,
    type text NOT NULL,
    severity public.notif_severity DEFAULT 'info'::public.notif_severity NOT NULL,
    title_ar text NOT NULL,
    body_ar text,
    link text,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: obligation_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.obligation_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    instance_id uuid NOT NULL,
    waqf_id uuid NOT NULL,
    action text NOT NULL,
    note text,
    actor_user_id uuid,
    at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: obligation_instances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.obligation_instances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    obligation_id uuid NOT NULL,
    trigger_event_id uuid,
    trigger_date date,
    period_key text,
    due_on date,
    due_immediately boolean DEFAULT false NOT NULL,
    status public.obligation_status DEFAULT 'upcoming'::public.obligation_status NOT NULL,
    assignee_user_id uuid,
    evidence_document_id uuid,
    completed_at timestamp with time zone,
    completed_by uuid,
    waived_reason text,
    last_reminder_at timestamp with time zone,
    reminders_sent jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: obligations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.obligations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    title_ar text NOT NULL,
    description text,
    requirement_id uuid,
    reference_text text NOT NULL,
    authority public.authority_kind NOT NULL,
    obligation_type text NOT NULL,
    trigger_event text NOT NULL,
    offset_value integer,
    offset_unit text NOT NULL,
    recurrence text DEFAULT 'none'::text NOT NULL,
    applies_to jsonb DEFAULT '{}'::jsonb NOT NULL,
    severity public.severity DEFAULT 'medium'::public.severity NOT NULL,
    required_action text NOT NULL,
    evidence_required text,
    penalty_code text,
    default_assignee_role text DEFAULT 'nazir'::text NOT NULL,
    reminder_offsets_days jsonb DEFAULT '[30, 7, 1]'::jsonb NOT NULL,
    status public.publish_status DEFAULT 'published'::public.publish_status NOT NULL,
    verification_status public.verification_status DEFAULT 'verified'::public.verification_status NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: organization_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_members (
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    authority_document_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    legal_form text,
    cr_number text,
    unified_number text,
    national_address text,
    is_nonprofit boolean DEFAULT false NOT NULL,
    kind text DEFAULT 'client'::text NOT NULL,
    license_no text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: otp_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.otp_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    target text NOT NULL,
    purpose public.otp_purpose NOT NULL,
    code_hash text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    ip text,
    context jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: outbox_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbox_messages (
    id bigint NOT NULL,
    channel public.channel NOT NULL,
    to_address text NOT NULL,
    subject text,
    body text NOT NULL,
    status public.outbox_status DEFAULT 'queued'::public.outbox_status NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    provider text,
    provider_ref text,
    error text,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: outbox_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.outbox_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: outbox_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.outbox_messages_id_seq OWNED BY public.outbox_messages.id;


--
-- Name: package_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.package_items (
    package_id uuid NOT NULL,
    service_id uuid NOT NULL,
    note text
);


--
-- Name: packages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.packages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name_ar text NOT NULL,
    description text,
    audience text,
    target_size_classes jsonb DEFAULT '[]'::jsonb NOT NULL,
    monthly_price numeric(18,2),
    annual_price numeric(18,2),
    terms_ar text,
    is_active boolean DEFAULT true NOT NULL,
    is_closed boolean DEFAULT false NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid NOT NULL,
    user_id uuid NOT NULL,
    provider text NOT NULL,
    provider_ref text,
    method text,
    amount numeric(18,2) NOT NULL,
    status text DEFAULT 'initiated'::text NOT NULL,
    paid_at timestamp with time zone,
    raw jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: penalty_schedule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.penalty_schedule (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    category text NOT NULL,
    title_ar text NOT NULL,
    large_text text,
    medium_text text,
    small_text text,
    dismissal_risk text DEFAULT 'no'::text NOT NULL,
    max_fine integer,
    verification_status public.verification_status DEFAULT 'pending_verification'::public.verification_status NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: performance_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.performance_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    subject_type text NOT NULL,
    subject_name text NOT NULL,
    year integer NOT NULL,
    score numeric(5,2),
    notes text,
    document_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    name_ar text NOT NULL,
    domain text NOT NULL
);


--
-- Name: persons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.persons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    full_name text NOT NULL,
    id_type public.id_type,
    national_id_enc text,
    national_id_hash text,
    nationality text,
    birth_date date,
    birth_place text,
    is_alive boolean DEFAULT true NOT NULL,
    death_date date,
    residence_country text,
    address_enc text,
    phone text,
    email text,
    user_id uuid,
    is_minor boolean DEFAULT false NOT NULL,
    guardian_person_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    policy_type text NOT NULL,
    title text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    approved_by_resolution_id uuid,
    approved_on date,
    review_due date,
    document_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: portfolios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portfolios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    account_no text,
    custodian text,
    manager_name text,
    manager_cma_license text,
    strategy text,
    risk_level text,
    waqf_deed_on date,
    registered_with_gaa_on date,
    account_opened_on date,
    recorded_with_gaa_on date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: price_change_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_change_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    field text NOT NULL,
    old_value text,
    new_value text,
    actor_user_id uuid,
    at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid,
    request_id uuid,
    name text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    start_on date,
    end_on date,
    owner_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: properties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.properties (
    asset_id uuid NOT NULL,
    waqf_id uuid NOT NULL,
    deed_no text,
    city text,
    district text,
    lat double precision,
    lng double precision,
    usage text,
    area_sqm numeric(14,2),
    units_count integer,
    occupied_units integer,
    technical_condition text,
    annual_maintenance_cost numeric(18,2),
    maintenance_reserve numeric(18,2),
    estimated_rent numeric(18,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: question_bank_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.question_bank_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version integer NOT NULL,
    status public.publish_status DEFAULT 'draft'::public.publish_status NOT NULL,
    notes text,
    published_at timestamp with time zone,
    published_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: rate_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limits (
    key text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    count integer DEFAULT 0 NOT NULL
);


--
-- Name: recommendation_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recommendation_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    status public.publish_status DEFAULT 'draft'::public.publish_status NOT NULL,
    title_ar text NOT NULL,
    condition jsonb NOT NULL,
    need_code text NOT NULL,
    severity public.severity NOT NULL,
    urgency_days integer DEFAULT 90 NOT NULL,
    leverage numeric(3,2) DEFAULT '1'::numeric NOT NULL,
    reason_ar text NOT NULL,
    why_it_matters_ar text,
    reference text,
    service_codes jsonb DEFAULT '[]'::jsonb NOT NULL,
    suppress_if jsonb,
    self_service_hint_ar text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    published_at timestamp with time zone,
    times_fired integer DEFAULT 0 NOT NULL,
    times_converted integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: recommendations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recommendations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    assessment_id uuid NOT NULL,
    waqf_id uuid,
    rule_id uuid NOT NULL,
    rule_code text NOT NULL,
    rule_version integer NOT NULL,
    need_code text NOT NULL,
    severity public.severity NOT NULL,
    priority numeric(6,2) NOT NULL,
    wave integer NOT NULL,
    title_ar text NOT NULL,
    reason_ar text NOT NULL,
    why_it_matters_ar text,
    reference text,
    service_codes jsonb DEFAULT '[]'::jsonb NOT NULL,
    self_service_hint_ar text,
    status public.rec_status DEFAULT 'open'::public.rec_status NOT NULL,
    suppressed_note text,
    dismiss_reason text,
    service_request_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: recovery_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recovery_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    code_hash text NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: regulatory_references; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.regulatory_references (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    source_name text NOT NULL,
    issuer text,
    decision_ref text,
    binding_level public.binding_level NOT NULL,
    source_url text,
    verification_status public.verification_status DEFAULT 'pending_verification'::public.verification_status NOT NULL,
    last_verified_on date,
    superseded_by text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: regulatory_requirements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.regulatory_requirements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    reference_id uuid,
    article text,
    title text NOT NULL,
    description text,
    implemented_as jsonb DEFAULT '[]'::jsonb NOT NULL,
    feature_area text,
    status text DEFAULT 'implemented'::text NOT NULL,
    verification_status public.verification_status DEFAULT 'verified'::public.verification_status NOT NULL,
    exclusion_reason text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: report_shares; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_shares (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_id uuid NOT NULL,
    waqf_id uuid,
    token_hash text NOT NULL,
    created_by uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    views integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    number text NOT NULL,
    waqf_id uuid,
    kind text NOT NULL,
    title text NOT NULL,
    assessment_id uuid,
    verification_code text NOT NULL,
    document_id uuid,
    snapshot jsonb,
    generated_by uuid,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone
);


--
-- Name: request_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.request_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    waqf_id uuid,
    from_status text,
    to_status text,
    note text,
    actor_user_id uuid,
    at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: request_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.request_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    waqf_id uuid,
    author_id uuid NOT NULL,
    visibility text DEFAULT 'client'::text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: request_stages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.request_stages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    waqf_id uuid,
    stage_key text NOT NULL,
    name text NOT NULL,
    "position" integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    sla_due_at timestamp with time zone,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    completed_by uuid
);


--
-- Name: resolutions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resolutions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    meeting_id uuid,
    agenda_item_id uuid,
    number text NOT NULL,
    text text NOT NULL,
    category text NOT NULL,
    requires_external_approval boolean DEFAULT false NOT NULL,
    approval_id uuid,
    condition_id uuid,
    expected_impact text,
    risks text,
    status public.resolution_status DEFAULT 'draft'::public.resolution_status NOT NULL,
    votes_for integer DEFAULT 0 NOT NULL,
    votes_against integer DEFAULT 0 NOT NULL,
    votes_abstain integer DEFAULT 0 NOT NULL,
    votes_recused integer DEFAULT 0 NOT NULL,
    decided_at timestamp with time zone,
    executed_at timestamp with time zone,
    review_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: revenue_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.revenue_allocations (
    waqf_id uuid NOT NULL,
    maintenance_pct numeric(5,2),
    development_pct numeric(5,2),
    reinvest_pct numeric(5,2),
    reserve_pct numeric(5,2),
    nazir_fee_pct numeric(5,2),
    nazir_fee_fixed numeric(18,2),
    admin_pct numeric(5,2),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: risk_register; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.risk_register (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    title text NOT NULL,
    category text NOT NULL,
    impact integer NOT NULL,
    likelihood integer NOT NULL,
    treatment text,
    owner_user_id uuid,
    review_on date,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    name_ar text NOT NULL,
    scope public.role_scope NOT NULL,
    description text,
    is_system boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sequences (
    key text NOT NULL,
    value integer DEFAULT 0 NOT NULL
);


--
-- Name: service_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name_ar text NOT NULL,
    description text,
    "position" integer DEFAULT 0 NOT NULL
);


--
-- Name: service_prices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_prices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_id uuid NOT NULL,
    size_class text,
    price numeric(18,2) NOT NULL,
    valid_from date,
    valid_to date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: service_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    number text NOT NULL,
    service_id uuid NOT NULL,
    waqf_id uuid,
    requester_user_id uuid NOT NULL,
    status public.request_status DEFAULT 'draft'::public.request_status NOT NULL,
    priority text DEFAULT 'normal'::text NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    source_ref uuid,
    details text,
    intake jsonb,
    assigned_to_user_id uuid,
    department_key text,
    current_stage_key text,
    sla_due_at timestamp with time zone,
    quote_amount numeric(18,2),
    agreed_price numeric(18,2),
    conflict_check text DEFAULT 'pending'::text NOT NULL,
    conflict_note text,
    hold_reason text,
    hold_party text,
    hold_follow_up_on date,
    cancel_reason text,
    reject_reason text,
    rating integer,
    rating_comment text,
    submitted_at timestamp with time zone,
    completed_at timestamp with time zone,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    category_id uuid NOT NULL,
    name_ar text NOT NULL,
    summary text NOT NULL,
    description text,
    requirements text,
    required_documents jsonb DEFAULT '[]'::jsonb NOT NULL,
    outputs text,
    pricing_model public.pricing_model NOT NULL,
    base_price numeric(18,2),
    currency text DEFAULT 'SAR'::text NOT NULL,
    sla_days integer,
    department_key text,
    default_specialist_role text,
    regulatory_restrictions text,
    conflict_rule text DEFAULT 'none'::text NOT NULL,
    requires_license_key text,
    workflow_template_code text DEFAULT 'standard'::text NOT NULL,
    audiences jsonb DEFAULT '[]'::jsonb NOT NULL,
    stage integer,
    is_active boolean DEFAULT true NOT NULL,
    is_published boolean DEFAULT true NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    mfa_verified boolean DEFAULT false NOT NULL,
    ip text,
    user_agent text,
    device_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    idle_expires_at timestamp with time zone NOT NULL,
    absolute_expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    revoke_reason text
);


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    key text NOT NULL,
    value jsonb NOT NULL,
    description text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid,
    user_id uuid NOT NULL,
    package_id uuid NOT NULL,
    billing_cycle text DEFAULT 'annual'::text NOT NULL,
    price numeric(18,2) NOT NULL,
    status text DEFAULT 'pending_payment'::text NOT NULL,
    starts_on date,
    renews_on date,
    cancelled_on date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: successions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.successions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    rule_text text NOT NULL,
    successor_name text,
    successor_person_id uuid,
    "position" integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: task_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    waqf_id uuid,
    author_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid,
    request_id uuid,
    project_id uuid,
    source_type text DEFAULT 'manual'::text NOT NULL,
    source_id uuid,
    title text NOT NULL,
    description text,
    assignee_user_id uuid,
    due_on date,
    priority text DEFAULT 'normal'::text NOT NULL,
    status public.task_status DEFAULT 'todo'::public.task_status NOT NULL,
    checklist jsonb DEFAULT '[]'::jsonb NOT NULL,
    progress integer DEFAULT 0 NOT NULL,
    visibility text DEFAULT 'shared'::text NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: trustee_appointments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trustee_appointments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trustee_id uuid NOT NULL,
    waqf_id uuid NOT NULL,
    decision_no text,
    decision_date date,
    authority public.authority_kind,
    powers text,
    fees text,
    responsibilities text,
    document_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: trustees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trustees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    kind text NOT NULL,
    person_id uuid,
    organization_id uuid,
    display_name text NOT NULL,
    user_id uuid,
    is_independent boolean DEFAULT false NOT NULL,
    is_chair boolean DEFAULT false NOT NULL,
    specialty text,
    license_no text,
    license_expires_on date,
    resides_in_ksa boolean,
    nationality text,
    starts_on date,
    ends_on date,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    user_id uuid NOT NULL,
    role_id uuid NOT NULL,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone text NOT NULL,
    email text,
    password_hash text,
    full_name text,
    id_type public.id_type,
    national_id_enc text,
    national_id_hash text,
    birth_date date,
    locale text DEFAULT 'ar'::text NOT NULL,
    numeral_style text DEFAULT 'latn'::text NOT NULL,
    calendar_pref text DEFAULT 'both'::text NOT NULL,
    status public.user_status DEFAULT 'active'::public.user_status NOT NULL,
    is_staff boolean DEFAULT false NOT NULL,
    mfa_enabled boolean DEFAULT false NOT NULL,
    phone_verified_at timestamp with time zone,
    email_verified_at timestamp with time zone,
    failed_login_count integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    last_login_at timestamp with time zone,
    deletion_requested_at timestamp with time zone,
    resides_in_ksa boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: valuations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.valuations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid NOT NULL,
    waqf_id uuid NOT NULL,
    valuer text NOT NULL,
    valuer_license text,
    method text,
    value numeric(18,2) NOT NULL,
    valued_on date NOT NULL,
    document_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: violations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.violations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    penalty_code text NOT NULL,
    occurrence integer DEFAULT 1 NOT NULL,
    noticed_on date NOT NULL,
    authority_ref text,
    sanction text,
    status text DEFAULT 'open'::text NOT NULL,
    corrective_deadline date,
    document_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: votes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.votes (
    resolution_id uuid NOT NULL,
    user_id uuid NOT NULL,
    waqf_id uuid NOT NULL,
    value public.vote_value NOT NULL,
    reason text,
    cast_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: waqf_classifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waqf_classifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    legal_type public.waqf_legal_type,
    computed_type public.waqf_legal_type,
    reason text,
    effective_from date NOT NULL,
    decided_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: waqf_deeds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waqf_deeds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    deed_no text,
    issuer text,
    issued_on_hijri text,
    issued_on date,
    document_id uuid,
    status text DEFAULT 'draft'::text NOT NULL,
    current_version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: waqf_exceptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waqf_exceptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    beneficiary_name text NOT NULL,
    kind text NOT NULL,
    duration text NOT NULL,
    until_date date,
    quantity text,
    afterwards text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: waqf_governance_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waqf_governance_profiles (
    waqf_id uuid NOT NULL,
    quorum_rule text DEFAULT 'majority'::text NOT NULL,
    majority_rule text DEFAULT 'simple'::text NOT NULL,
    meetings_per_year integer DEFAULT 4 NOT NULL,
    independent_ratio_target numeric(4,2),
    require_independent_for_quorum boolean DEFAULT false NOT NULL,
    reserved_decisions jsonb DEFAULT '[]'::jsonb NOT NULL,
    executive_spend_limit numeric(18,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: waqf_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waqf_keys (
    waqf_id uuid NOT NULL,
    wrapped_key text NOT NULL,
    key_version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: waqf_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waqf_memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role_key text NOT NULL,
    is_independent boolean DEFAULT false NOT NULL,
    status public.membership_status DEFAULT 'active'::public.membership_status NOT NULL,
    starts_at timestamp with time zone DEFAULT now() NOT NULL,
    ends_at timestamp with time zone,
    invited_by uuid,
    scope jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: waqf_registrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waqf_registrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    request_type text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    cert_no text,
    submitted_on date,
    issued_on date,
    expires_on date,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: waqf_timeline_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waqf_timeline_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    type text NOT NULL,
    occurred_on date NOT NULL,
    title text NOT NULL,
    details text,
    document_id uuid,
    stage integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);


--
-- Name: waqfs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waqfs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    internal_number text NOT NULL,
    name text NOT NULL,
    national_unified_number text,
    registration_cert_no text,
    registration_expires_on date,
    deed_no text,
    deed_issuer text,
    deed_date_hijri text,
    deed_date date,
    documented_on date,
    registered_on date,
    creation_mode public.waqf_creation_mode DEFAULT 'inter_vivos'::public.waqf_creation_mode NOT NULL,
    legal_type public.waqf_legal_type,
    computed_type public.waqf_legal_type,
    computed_type_reason text,
    size_class public.waqf_size_class,
    size_class_locked boolean DEFAULT false NOT NULL,
    direct_benefit boolean DEFAULT false NOT NULL,
    assets_estimated_value numeric(18,2),
    field_of_work text,
    geographic_scope text,
    domicile text,
    fiscal_year_end text DEFAULT '12-31'::text NOT NULL,
    status public.waqf_status DEFAULT 'draft'::public.waqf_status NOT NULL,
    nazir_mode public.nazir_mode,
    waqfak_role public.waqfak_role DEFAULT 'none'::public.waqfak_role NOT NULL,
    founder_alive boolean,
    has_foreign_party boolean DEFAULT false NOT NULL,
    has_beneficiaries_abroad boolean DEFAULT false NOT NULL,
    collects_donations boolean DEFAULT false NOT NULL,
    has_active_litigation boolean DEFAULT false NOT NULL,
    stage integer DEFAULT 1 NOT NULL,
    organization_id uuid,
    is_demo boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid,
    archived_at timestamp with time zone,
    archive_reason text
);


--
-- Name: workflow_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name_ar text NOT NULL,
    stages jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid
);


--
-- Name: screening_results; Type: TABLE; Schema: restricted; Owner: -
--

CREATE TABLE restricted.screening_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_type text NOT NULL,
    subject_id uuid NOT NULL,
    provider text NOT NULL,
    status text NOT NULL,
    details_enc text,
    reviewed_by uuid,
    decision text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: suspicion_reports; Type: TABLE; Schema: restricted; Owner: -
--

CREATE TABLE restricted.suspicion_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    waqf_id uuid NOT NULL,
    created_by uuid NOT NULL,
    summary_enc text NOT NULL,
    status text DEFAULT 'internal_review'::text NOT NULL,
    reported_to_fiu_on date,
    fiu_reference_enc text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: __drizzle_migrations id; Type: DEFAULT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations ALTER COLUMN id SET DEFAULT nextval('drizzle.__drizzle_migrations_id_seq'::regclass);


--
-- Name: audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);


--
-- Name: outbox_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox_messages ALTER COLUMN id SET DEFAULT nextval('public.outbox_messages_id_seq'::regclass);


--
-- Name: __drizzle_migrations __drizzle_migrations_pkey; Type: CONSTRAINT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations
    ADD CONSTRAINT __drizzle_migrations_pkey PRIMARY KEY (id);


--
-- Name: action_plans action_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_plans
    ADD CONSTRAINT action_plans_pkey PRIMARY KEY (id);


--
-- Name: agenda_items agenda_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agenda_items
    ADD CONSTRAINT agenda_items_pkey PRIMARY KEY (id);


--
-- Name: ai_interactions ai_interactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_interactions
    ADD CONSTRAINT ai_interactions_pkey PRIMARY KEY (id);


--
-- Name: approvals approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approvals
    ADD CONSTRAINT approvals_pkey PRIMARY KEY (id);


--
-- Name: assessment_answers assessment_answers_assessment_id_question_code_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_answers
    ADD CONSTRAINT assessment_answers_assessment_id_question_code_pk PRIMARY KEY (assessment_id, question_code);


--
-- Name: assessment_axes assessment_axes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_axes
    ADD CONSTRAINT assessment_axes_pkey PRIMARY KEY (id);


--
-- Name: assessment_questions assessment_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_questions
    ADD CONSTRAINT assessment_questions_pkey PRIMARY KEY (id);


--
-- Name: assessment_results assessment_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_results
    ADD CONSTRAINT assessment_results_pkey PRIMARY KEY (assessment_id);


--
-- Name: assessments assessments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessments
    ADD CONSTRAINT assessments_pkey PRIMARY KEY (id);


--
-- Name: assets assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_pkey PRIMARY KEY (id);


--
-- Name: attendance attendance_meeting_id_body_membership_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_meeting_id_body_membership_id_pk PRIMARY KEY (meeting_id, body_membership_id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: axis_scores axis_scores_assessment_id_axis_code_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.axis_scores
    ADD CONSTRAINT axis_scores_assessment_id_axis_code_pk PRIMARY KEY (assessment_id, axis_code);


--
-- Name: bank_accounts bank_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_accounts
    ADD CONSTRAINT bank_accounts_pkey PRIMARY KEY (id);


--
-- Name: beneficial_owners beneficial_owners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beneficial_owners
    ADD CONSTRAINT beneficial_owners_pkey PRIMARY KEY (id);


--
-- Name: beneficiaries beneficiaries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beneficiaries
    ADD CONSTRAINT beneficiaries_pkey PRIMARY KEY (id);


--
-- Name: beneficiary_classes beneficiary_classes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beneficiary_classes
    ADD CONSTRAINT beneficiary_classes_pkey PRIMARY KEY (id);


--
-- Name: bodies bodies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bodies
    ADD CONSTRAINT bodies_pkey PRIMARY KEY (id);


--
-- Name: body_memberships body_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.body_memberships
    ADD CONSTRAINT body_memberships_pkey PRIMARY KEY (id);


--
-- Name: break_glass_access break_glass_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.break_glass_access
    ADD CONSTRAINT break_glass_access_pkey PRIMARY KEY (id);


--
-- Name: budgets budgets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budgets
    ADD CONSTRAINT budgets_pkey PRIMARY KEY (id);


--
-- Name: complaints complaints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_pkey PRIMARY KEY (id);


--
-- Name: compliance_change_log compliance_change_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_change_log
    ADD CONSTRAINT compliance_change_log_pkey PRIMARY KEY (id);


--
-- Name: condition_interpretations condition_interpretations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.condition_interpretations
    ADD CONSTRAINT condition_interpretations_pkey PRIMARY KEY (id);


--
-- Name: conditions conditions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conditions
    ADD CONSTRAINT conditions_pkey PRIMARY KEY (id);


--
-- Name: conflict_declarations conflict_declarations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conflict_declarations
    ADD CONSTRAINT conflict_declarations_pkey PRIMARY KEY (id);


--
-- Name: consents consents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consents
    ADD CONSTRAINT consents_pkey PRIMARY KEY (id);


--
-- Name: contact_messages contact_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_messages
    ADD CONSTRAINT contact_messages_pkey PRIMARY KEY (id);


--
-- Name: content_items content_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_items
    ADD CONSTRAINT content_items_pkey PRIMARY KEY (id);


--
-- Name: content_reviews content_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_reviews
    ADD CONSTRAINT content_reviews_pkey PRIMARY KEY (id);


--
-- Name: contract_signatures contract_signatures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_signatures
    ADD CONSTRAINT contract_signatures_pkey PRIMARY KEY (id);


--
-- Name: contract_templates contract_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_templates
    ADD CONSTRAINT contract_templates_pkey PRIMARY KEY (id);


--
-- Name: contracts contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: critical_flag_defs critical_flag_defs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.critical_flag_defs
    ADD CONSTRAINT critical_flag_defs_pkey PRIMARY KEY (code);


--
-- Name: critical_flags critical_flags_assessment_id_flag_code_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.critical_flags
    ADD CONSTRAINT critical_flags_assessment_id_flag_code_pk PRIMARY KEY (assessment_id, flag_code);


--
-- Name: data_subject_requests data_subject_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_subject_requests
    ADD CONSTRAINT data_subject_requests_pkey PRIMARY KEY (id);


--
-- Name: deed_versions deed_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deed_versions
    ADD CONSTRAINT deed_versions_pkey PRIMARY KEY (id);


--
-- Name: delegations delegations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delegations
    ADD CONSTRAINT delegations_pkey PRIMARY KEY (id);


--
-- Name: deliverables deliverables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliverables
    ADD CONSTRAINT deliverables_pkey PRIMARY KEY (id);


--
-- Name: devices devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (id);


--
-- Name: discounts discounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discounts
    ADD CONSTRAINT discounts_pkey PRIMARY KEY (id);


--
-- Name: distribution_lines distribution_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.distribution_lines
    ADD CONSTRAINT distribution_lines_pkey PRIMARY KEY (id);


--
-- Name: distributions distributions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.distributions
    ADD CONSTRAINT distributions_pkey PRIMARY KEY (id);


--
-- Name: document_access_log document_access_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_access_log
    ADD CONSTRAINT document_access_log_pkey PRIMARY KEY (id);


--
-- Name: document_links document_links_document_id_entity_type_entity_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_links
    ADD CONSTRAINT document_links_document_id_entity_type_entity_id_pk PRIMARY KEY (document_id, entity_type, entity_id);


--
-- Name: document_shares document_shares_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_shares
    ADD CONSTRAINT document_shares_pkey PRIMARY KEY (id);


--
-- Name: document_versions document_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_versions
    ADD CONSTRAINT document_versions_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: encumbrances encumbrances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encumbrances
    ADD CONSTRAINT encumbrances_pkey PRIMARY KEY (id);


--
-- Name: entitlements entitlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entitlements
    ADD CONSTRAINT entitlements_pkey PRIMARY KEY (id);


--
-- Name: extracted_fields extracted_fields_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.extracted_fields
    ADD CONSTRAINT extracted_fields_pkey PRIMARY KEY (id);


--
-- Name: facts facts_assessment_id_key_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facts
    ADD CONSTRAINT facts_assessment_id_key_pk PRIMARY KEY (assessment_id, key);


--
-- Name: faqs faqs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faqs
    ADD CONSTRAINT faqs_pkey PRIMARY KEY (id);


--
-- Name: feature_flags feature_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_flags
    ADD CONSTRAINT feature_flags_pkey PRIMARY KEY (key);


--
-- Name: financial_statements financial_statements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_statements
    ADD CONSTRAINT financial_statements_pkey PRIMARY KEY (id);


--
-- Name: founders founders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.founders
    ADD CONSTRAINT founders_pkey PRIMARY KEY (id);


--
-- Name: glossary_terms glossary_terms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.glossary_terms
    ADD CONSTRAINT glossary_terms_pkey PRIMARY KEY (id);


--
-- Name: holidays holidays_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holidays
    ADD CONSTRAINT holidays_pkey PRIMARY KEY (day);


--
-- Name: investment_policies investment_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investment_policies
    ADD CONSTRAINT investment_policies_pkey PRIMARY KEY (id);


--
-- Name: investments investments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investments
    ADD CONSTRAINT investments_pkey PRIMARY KEY (asset_id);


--
-- Name: invitations invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: job_runs job_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_runs
    ADD CONSTRAINT job_runs_pkey PRIMARY KEY (id);


--
-- Name: kyc_records kyc_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kyc_records
    ADD CONSTRAINT kyc_records_pkey PRIMARY KEY (id);


--
-- Name: leases leases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leases
    ADD CONSTRAINT leases_pkey PRIMARY KEY (id);


--
-- Name: ledger_entries ledger_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_pkey PRIMARY KEY (id);


--
-- Name: maintenance_plans maintenance_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_plans
    ADD CONSTRAINT maintenance_plans_pkey PRIMARY KEY (id);


--
-- Name: meetings meetings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: mfa_factors mfa_factors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mfa_factors
    ADD CONSTRAINT mfa_factors_pkey PRIMARY KEY (id);


--
-- Name: minute_signatures minute_signatures_minute_id_user_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minute_signatures
    ADD CONSTRAINT minute_signatures_minute_id_user_id_pk PRIMARY KEY (minute_id, user_id);


--
-- Name: minutes minutes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minutes
    ADD CONSTRAINT minutes_pkey PRIMARY KEY (id);


--
-- Name: needs needs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.needs
    ADD CONSTRAINT needs_pkey PRIMARY KEY (code);


--
-- Name: notification_preferences notification_preferences_user_id_type_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_id_type_pk PRIMARY KEY (user_id, type);


--
-- Name: notification_templates notification_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_templates
    ADD CONSTRAINT notification_templates_pkey PRIMARY KEY (key);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: obligation_events obligation_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obligation_events
    ADD CONSTRAINT obligation_events_pkey PRIMARY KEY (id);


--
-- Name: obligation_instances obligation_instances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obligation_instances
    ADD CONSTRAINT obligation_instances_pkey PRIMARY KEY (id);


--
-- Name: obligations obligations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obligations
    ADD CONSTRAINT obligations_pkey PRIMARY KEY (id);


--
-- Name: organization_members organization_members_organization_id_user_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_organization_id_user_id_pk PRIMARY KEY (organization_id, user_id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: otp_challenges otp_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_challenges
    ADD CONSTRAINT otp_challenges_pkey PRIMARY KEY (id);


--
-- Name: outbox_messages outbox_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox_messages
    ADD CONSTRAINT outbox_messages_pkey PRIMARY KEY (id);


--
-- Name: package_items package_items_package_id_service_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_items
    ADD CONSTRAINT package_items_package_id_service_id_pk PRIMARY KEY (package_id, service_id);


--
-- Name: packages packages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packages
    ADD CONSTRAINT packages_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: penalty_schedule penalty_schedule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.penalty_schedule
    ADD CONSTRAINT penalty_schedule_pkey PRIMARY KEY (id);


--
-- Name: performance_reviews performance_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.performance_reviews
    ADD CONSTRAINT performance_reviews_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: persons persons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persons
    ADD CONSTRAINT persons_pkey PRIMARY KEY (id);


--
-- Name: policies policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policies
    ADD CONSTRAINT policies_pkey PRIMARY KEY (id);


--
-- Name: portfolios portfolios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolios
    ADD CONSTRAINT portfolios_pkey PRIMARY KEY (id);


--
-- Name: price_change_log price_change_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_change_log
    ADD CONSTRAINT price_change_log_pkey PRIMARY KEY (id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: properties properties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_pkey PRIMARY KEY (asset_id);


--
-- Name: question_bank_versions question_bank_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_bank_versions
    ADD CONSTRAINT question_bank_versions_pkey PRIMARY KEY (id);


--
-- Name: rate_limits rate_limits_key_window_start_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limits
    ADD CONSTRAINT rate_limits_key_window_start_pk PRIMARY KEY (key, window_start);


--
-- Name: recommendation_rules recommendation_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_rules
    ADD CONSTRAINT recommendation_rules_pkey PRIMARY KEY (id);


--
-- Name: recommendations recommendations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendations
    ADD CONSTRAINT recommendations_pkey PRIMARY KEY (id);


--
-- Name: recovery_codes recovery_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recovery_codes
    ADD CONSTRAINT recovery_codes_pkey PRIMARY KEY (id);


--
-- Name: regulatory_references regulatory_references_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regulatory_references
    ADD CONSTRAINT regulatory_references_pkey PRIMARY KEY (id);


--
-- Name: regulatory_requirements regulatory_requirements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regulatory_requirements
    ADD CONSTRAINT regulatory_requirements_pkey PRIMARY KEY (id);


--
-- Name: report_shares report_shares_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_shares
    ADD CONSTRAINT report_shares_pkey PRIMARY KEY (id);


--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);


--
-- Name: request_events request_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_events
    ADD CONSTRAINT request_events_pkey PRIMARY KEY (id);


--
-- Name: request_notes request_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_notes
    ADD CONSTRAINT request_notes_pkey PRIMARY KEY (id);


--
-- Name: request_stages request_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_stages
    ADD CONSTRAINT request_stages_pkey PRIMARY KEY (id);


--
-- Name: resolutions resolutions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resolutions
    ADD CONSTRAINT resolutions_pkey PRIMARY KEY (id);


--
-- Name: revenue_allocations revenue_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_allocations
    ADD CONSTRAINT revenue_allocations_pkey PRIMARY KEY (waqf_id);


--
-- Name: risk_register risk_register_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_register
    ADD CONSTRAINT risk_register_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_role_id_permission_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_permission_id_pk PRIMARY KEY (role_id, permission_id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: sequences sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequences
    ADD CONSTRAINT sequences_pkey PRIMARY KEY (key);


--
-- Name: service_categories service_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT service_categories_pkey PRIMARY KEY (id);


--
-- Name: service_prices service_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_prices
    ADD CONSTRAINT service_prices_pkey PRIMARY KEY (id);


--
-- Name: service_requests service_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_requests
    ADD CONSTRAINT service_requests_pkey PRIMARY KEY (id);


--
-- Name: services services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (key);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: successions successions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.successions
    ADD CONSTRAINT successions_pkey PRIMARY KEY (id);


--
-- Name: task_comments task_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: trustee_appointments trustee_appointments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trustee_appointments
    ADD CONSTRAINT trustee_appointments_pkey PRIMARY KEY (id);


--
-- Name: trustees trustees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trustees
    ADD CONSTRAINT trustees_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_id_pk PRIMARY KEY (user_id, role_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: valuations valuations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.valuations
    ADD CONSTRAINT valuations_pkey PRIMARY KEY (id);


--
-- Name: violations violations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.violations
    ADD CONSTRAINT violations_pkey PRIMARY KEY (id);


--
-- Name: votes votes_resolution_id_user_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.votes
    ADD CONSTRAINT votes_resolution_id_user_id_pk PRIMARY KEY (resolution_id, user_id);


--
-- Name: waqf_classifications waqf_classifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waqf_classifications
    ADD CONSTRAINT waqf_classifications_pkey PRIMARY KEY (id);


--
-- Name: waqf_deeds waqf_deeds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waqf_deeds
    ADD CONSTRAINT waqf_deeds_pkey PRIMARY KEY (id);


--
-- Name: waqf_exceptions waqf_exceptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waqf_exceptions
    ADD CONSTRAINT waqf_exceptions_pkey PRIMARY KEY (id);


--
-- Name: waqf_governance_profiles waqf_governance_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waqf_governance_profiles
    ADD CONSTRAINT waqf_governance_profiles_pkey PRIMARY KEY (waqf_id);


--
-- Name: waqf_keys waqf_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waqf_keys
    ADD CONSTRAINT waqf_keys_pkey PRIMARY KEY (waqf_id);


--
-- Name: waqf_memberships waqf_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waqf_memberships
    ADD CONSTRAINT waqf_memberships_pkey PRIMARY KEY (id);


--
-- Name: waqf_registrations waqf_registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waqf_registrations
    ADD CONSTRAINT waqf_registrations_pkey PRIMARY KEY (id);


--
-- Name: waqf_timeline_events waqf_timeline_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waqf_timeline_events
    ADD CONSTRAINT waqf_timeline_events_pkey PRIMARY KEY (id);


--
-- Name: waqfs waqfs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waqfs
    ADD CONSTRAINT waqfs_pkey PRIMARY KEY (id);


--
-- Name: workflow_templates workflow_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_templates
    ADD CONSTRAINT workflow_templates_pkey PRIMARY KEY (id);


--
-- Name: screening_results screening_results_pkey; Type: CONSTRAINT; Schema: restricted; Owner: -
--

ALTER TABLE ONLY restricted.screening_results
    ADD CONSTRAINT screening_results_pkey PRIMARY KEY (id);


--
-- Name: suspicion_reports suspicion_reports_pkey; Type: CONSTRAINT; Schema: restricted; Owner: -
--

ALTER TABLE ONLY restricted.suspicion_reports
    ADD CONSTRAINT suspicion_reports_pkey PRIMARY KEY (id);


--
-- Name: ai_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_waqf_idx ON public.ai_interactions USING btree (waqf_id);


--
-- Name: approvals_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approvals_waqf_idx ON public.approvals USING btree (waqf_id);


--
-- Name: aq_ver_code_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX aq_ver_code_uq ON public.assessment_questions USING btree (bank_version_id, code);


--
-- Name: ass_anon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ass_anon_idx ON public.assessments USING btree (anon_token_hash);


--
-- Name: ass_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ass_user_idx ON public.assessments USING btree (user_id);


--
-- Name: ass_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ass_waqf_idx ON public.assessments USING btree (waqf_id);


--
-- Name: assets_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assets_waqf_idx ON public.assets USING btree (waqf_id);


--
-- Name: audit_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_actor_idx ON public.audit_logs USING btree (actor_user_id, at);


--
-- Name: audit_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_waqf_idx ON public.audit_logs USING btree (waqf_id, at);


--
-- Name: axes_ver_code_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX axes_ver_code_uq ON public.assessment_axes USING btree (bank_version_id, code);


--
-- Name: ba_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ba_waqf_idx ON public.bank_accounts USING btree (waqf_id);


--
-- Name: bc_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bc_waqf_idx ON public.beneficiary_classes USING btree (waqf_id);


--
-- Name: ben_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ben_user_idx ON public.beneficiaries USING btree (user_id);


--
-- Name: ben_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ben_waqf_idx ON public.beneficiaries USING btree (waqf_id);


--
-- Name: bm_body_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bm_body_idx ON public.body_memberships USING btree (body_id);


--
-- Name: bm_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bm_waqf_idx ON public.body_memberships USING btree (waqf_id);


--
-- Name: bo_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bo_waqf_idx ON public.beneficial_owners USING btree (waqf_id);


--
-- Name: bodies_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bodies_waqf_idx ON public.bodies USING btree (waqf_id);


--
-- Name: coi_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX coi_item_idx ON public.conflict_declarations USING btree (agenda_item_id);


--
-- Name: coi_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX coi_waqf_idx ON public.conflict_declarations USING btree (waqf_id);


--
-- Name: comp_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comp_waqf_idx ON public.complaints USING btree (waqf_id);


--
-- Name: cond_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cond_waqf_idx ON public.conditions USING btree (waqf_id);


--
-- Name: consents_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consents_user_idx ON public.consents USING btree (user_id);


--
-- Name: content_slug_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX content_slug_uq ON public.content_items USING btree (kind, slug);


--
-- Name: contracts_number_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX contracts_number_uq ON public.contracts USING btree (number);


--
-- Name: ct_code_ver_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ct_code_ver_uq ON public.contract_templates USING btree (code, version);


--
-- Name: dal_doc_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dal_doc_idx ON public.document_access_log USING btree (document_id);


--
-- Name: deeds_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX deeds_waqf_idx ON public.waqf_deeds USING btree (waqf_id);


--
-- Name: deleg_agent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX deleg_agent_idx ON public.delegations USING btree (agent_user_id);


--
-- Name: deleg_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX deleg_waqf_idx ON public.delegations USING btree (waqf_id);


--
-- Name: devices_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX devices_user_idx ON public.devices USING btree (user_id);


--
-- Name: disc_code_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX disc_code_uq ON public.discounts USING btree (code);


--
-- Name: dist_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dist_waqf_idx ON public.distributions USING btree (waqf_id);


--
-- Name: dl_ben_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dl_ben_idx ON public.distribution_lines USING btree (beneficiary_id);


--
-- Name: dl_dist_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dl_dist_idx ON public.distribution_lines USING btree (distribution_id);


--
-- Name: dl_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dl_entity_idx ON public.document_links USING btree (entity_type, entity_id);


--
-- Name: docs_exp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX docs_exp_idx ON public.documents USING btree (expires_on);


--
-- Name: docs_req_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX docs_req_idx ON public.documents USING btree (request_id);


--
-- Name: docs_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX docs_waqf_idx ON public.documents USING btree (waqf_id);


--
-- Name: ds_token_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ds_token_uq ON public.document_shares USING btree (token_hash);


--
-- Name: dv_doc_ver_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX dv_doc_ver_uq ON public.document_versions USING btree (document_id, version);


--
-- Name: ent_ben_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ent_ben_idx ON public.entitlements USING btree (beneficiary_id);


--
-- Name: founders_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX founders_waqf_idx ON public.founders USING btree (waqf_id);


--
-- Name: gloss_slug_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX gloss_slug_uq ON public.glossary_terms USING btree (slug);


--
-- Name: inv_number_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inv_number_uq ON public.invoices USING btree (number);


--
-- Name: inv_token_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inv_token_uq ON public.invitations USING btree (token_hash);


--
-- Name: inv_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inv_user_idx ON public.invoices USING btree (user_id);


--
-- Name: inv_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inv_waqf_idx ON public.invitations USING btree (waqf_id);


--
-- Name: kyc_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kyc_subject_idx ON public.kyc_records USING btree (subject_type, subject_id);


--
-- Name: le_waqf_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX le_waqf_date_idx ON public.ledger_entries USING btree (waqf_id, entry_date);


--
-- Name: leases_asset_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX leases_asset_idx ON public.leases USING btree (asset_id);


--
-- Name: meet_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX meet_waqf_idx ON public.meetings USING btree (waqf_id);


--
-- Name: notif_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notif_user_idx ON public.notifications USING btree (user_id, read_at);


--
-- Name: obl_code_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX obl_code_uq ON public.obligations USING btree (code);


--
-- Name: oi_dedupe_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX oi_dedupe_uq ON public.obligation_instances USING btree (waqf_id, obligation_id, period_key);


--
-- Name: oi_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX oi_due_idx ON public.obligation_instances USING btree (due_on);


--
-- Name: oi_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX oi_waqf_idx ON public.obligation_instances USING btree (waqf_id);


--
-- Name: otp_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX otp_target_idx ON public.otp_challenges USING btree (target, purpose);


--
-- Name: pen_code_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pen_code_uq ON public.penalty_schedule USING btree (code);


--
-- Name: permissions_key_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX permissions_key_uq ON public.permissions USING btree (key);


--
-- Name: persons_nid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX persons_nid_idx ON public.persons USING btree (national_id_hash);


--
-- Name: persons_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX persons_user_idx ON public.persons USING btree (user_id);


--
-- Name: pkg_code_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pkg_code_uq ON public.packages USING btree (code);


--
-- Name: pol_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pol_waqf_idx ON public.policies USING btree (waqf_id);


--
-- Name: qbv_version_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX qbv_version_uq ON public.question_bank_versions USING btree (version);


--
-- Name: rec_ass_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rec_ass_idx ON public.recommendations USING btree (assessment_id);


--
-- Name: rec_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rec_waqf_idx ON public.recommendations USING btree (waqf_id);


--
-- Name: regref_code_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX regref_code_uq ON public.regulatory_references USING btree (code);


--
-- Name: regreq_code_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX regreq_code_uq ON public.regulatory_requirements USING btree (code);


--
-- Name: reports_number_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reports_number_uq ON public.reports USING btree (number);


--
-- Name: reports_vcode_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reports_vcode_uq ON public.reports USING btree (verification_code);


--
-- Name: res_number_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX res_number_uq ON public.resolutions USING btree (waqf_id, number);


--
-- Name: res_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX res_waqf_idx ON public.resolutions USING btree (waqf_id);


--
-- Name: risk_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX risk_waqf_idx ON public.risk_register USING btree (waqf_id);


--
-- Name: roles_key_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX roles_key_uq ON public.roles USING btree (key);


--
-- Name: rr_code_ver_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX rr_code_ver_uq ON public.recommendation_rules USING btree (code, version);


--
-- Name: rs_req_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rs_req_idx ON public.request_stages USING btree (request_id);


--
-- Name: sc_code_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sc_code_uq ON public.service_categories USING btree (code);


--
-- Name: sessions_token_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sessions_token_uq ON public.sessions USING btree (token_hash);


--
-- Name: sessions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_user_idx ON public.sessions USING btree (user_id);


--
-- Name: sr_assignee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sr_assignee_idx ON public.service_requests USING btree (assigned_to_user_id);


--
-- Name: sr_number_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sr_number_uq ON public.service_requests USING btree (number);


--
-- Name: sr_requester_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sr_requester_idx ON public.service_requests USING btree (requester_user_id);


--
-- Name: sr_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sr_waqf_idx ON public.service_requests USING btree (waqf_id);


--
-- Name: svc_code_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX svc_code_uq ON public.services USING btree (code);


--
-- Name: ta_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ta_waqf_idx ON public.trustee_appointments USING btree (waqf_id);


--
-- Name: tasks_assignee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_assignee_idx ON public.tasks USING btree (assignee_user_id);


--
-- Name: tasks_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_waqf_idx ON public.tasks USING btree (waqf_id);


--
-- Name: trustees_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trustees_waqf_idx ON public.trustees USING btree (waqf_id);


--
-- Name: users_email_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_email_uq ON public.users USING btree (email);


--
-- Name: users_nid_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_nid_hash_idx ON public.users USING btree (national_id_hash);


--
-- Name: users_phone_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_phone_uq ON public.users USING btree (phone);


--
-- Name: viol_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX viol_waqf_idx ON public.violations USING btree (waqf_id);


--
-- Name: waqfs_internal_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX waqfs_internal_uq ON public.waqfs USING btree (internal_number);


--
-- Name: waqfs_nun_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX waqfs_nun_idx ON public.waqfs USING btree (national_unified_number);


--
-- Name: wc_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wc_waqf_idx ON public.waqf_classifications USING btree (waqf_id);


--
-- Name: wm_unique_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX wm_unique_active ON public.waqf_memberships USING btree (waqf_id, user_id, role_key);


--
-- Name: wm_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wm_user_idx ON public.waqf_memberships USING btree (user_id);


--
-- Name: wm_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wm_waqf_idx ON public.waqf_memberships USING btree (waqf_id);


--
-- Name: wr_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wr_waqf_idx ON public.waqf_registrations USING btree (waqf_id);


--
-- Name: wt_code_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX wt_code_uq ON public.workflow_templates USING btree (code);


--
-- Name: wte_waqf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wte_waqf_idx ON public.waqf_timeline_events USING btree (waqf_id);


--
-- Name: audit_logs audit_logs_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_logs_append_only BEFORE DELETE OR UPDATE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation();


--
-- Name: minutes minutes_lock; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER minutes_lock BEFORE DELETE OR UPDATE ON public.minutes FOR EACH ROW EXECUTE FUNCTION public.protect_locked_minutes();


--
-- Name: action_plans action_plans_assessment_id_assessments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_plans
    ADD CONSTRAINT action_plans_assessment_id_assessments_id_fk FOREIGN KEY (assessment_id) REFERENCES public.assessments(id) ON DELETE CASCADE;


--
-- Name: agenda_items agenda_items_meeting_id_meetings_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agenda_items
    ADD CONSTRAINT agenda_items_meeting_id_meetings_id_fk FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE CASCADE;


--
-- Name: approvals approvals_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approvals
    ADD CONSTRAINT approvals_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: assessment_answers assessment_answers_assessment_id_assessments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_answers
    ADD CONSTRAINT assessment_answers_assessment_id_assessments_id_fk FOREIGN KEY (assessment_id) REFERENCES public.assessments(id) ON DELETE CASCADE;


--
-- Name: assessment_axes assessment_axes_bank_version_id_question_bank_versions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_axes
    ADD CONSTRAINT assessment_axes_bank_version_id_question_bank_versions_id_fk FOREIGN KEY (bank_version_id) REFERENCES public.question_bank_versions(id) ON DELETE CASCADE;


--
-- Name: assessment_questions assessment_questions_bank_version_id_question_bank_versions_id_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_questions
    ADD CONSTRAINT assessment_questions_bank_version_id_question_bank_versions_id_ FOREIGN KEY (bank_version_id) REFERENCES public.question_bank_versions(id) ON DELETE CASCADE;


--
-- Name: assessment_results assessment_results_assessment_id_assessments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_results
    ADD CONSTRAINT assessment_results_assessment_id_assessments_id_fk FOREIGN KEY (assessment_id) REFERENCES public.assessments(id) ON DELETE CASCADE;


--
-- Name: assets assets_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: attendance attendance_meeting_id_meetings_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_meeting_id_meetings_id_fk FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE CASCADE;


--
-- Name: axis_scores axis_scores_assessment_id_assessments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.axis_scores
    ADD CONSTRAINT axis_scores_assessment_id_assessments_id_fk FOREIGN KEY (assessment_id) REFERENCES public.assessments(id) ON DELETE CASCADE;


--
-- Name: bank_accounts bank_accounts_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_accounts
    ADD CONSTRAINT bank_accounts_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: beneficial_owners beneficial_owners_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beneficial_owners
    ADD CONSTRAINT beneficial_owners_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: beneficiaries beneficiaries_class_id_beneficiary_classes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beneficiaries
    ADD CONSTRAINT beneficiaries_class_id_beneficiary_classes_id_fk FOREIGN KEY (class_id) REFERENCES public.beneficiary_classes(id) ON DELETE SET NULL;


--
-- Name: beneficiaries beneficiaries_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beneficiaries
    ADD CONSTRAINT beneficiaries_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: beneficiary_classes beneficiary_classes_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beneficiary_classes
    ADD CONSTRAINT beneficiary_classes_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: bodies bodies_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bodies
    ADD CONSTRAINT bodies_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: body_memberships body_memberships_body_id_bodies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.body_memberships
    ADD CONSTRAINT body_memberships_body_id_bodies_id_fk FOREIGN KEY (body_id) REFERENCES public.bodies(id) ON DELETE CASCADE;


--
-- Name: break_glass_access break_glass_access_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.break_glass_access
    ADD CONSTRAINT break_glass_access_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: budgets budgets_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budgets
    ADD CONSTRAINT budgets_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: complaints complaints_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: condition_interpretations condition_interpretations_condition_id_conditions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.condition_interpretations
    ADD CONSTRAINT condition_interpretations_condition_id_conditions_id_fk FOREIGN KEY (condition_id) REFERENCES public.conditions(id) ON DELETE CASCADE;


--
-- Name: conditions conditions_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conditions
    ADD CONSTRAINT conditions_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: conflict_declarations conflict_declarations_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conflict_declarations
    ADD CONSTRAINT conflict_declarations_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: content_reviews content_reviews_content_id_content_items_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_reviews
    ADD CONSTRAINT content_reviews_content_id_content_items_id_fk FOREIGN KEY (content_id) REFERENCES public.content_items(id) ON DELETE CASCADE;


--
-- Name: contract_signatures contract_signatures_contract_id_contracts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_signatures
    ADD CONSTRAINT contract_signatures_contract_id_contracts_id_fk FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: critical_flags critical_flags_assessment_id_assessments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.critical_flags
    ADD CONSTRAINT critical_flags_assessment_id_assessments_id_fk FOREIGN KEY (assessment_id) REFERENCES public.assessments(id) ON DELETE CASCADE;


--
-- Name: deed_versions deed_versions_deed_id_waqf_deeds_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deed_versions
    ADD CONSTRAINT deed_versions_deed_id_waqf_deeds_id_fk FOREIGN KEY (deed_id) REFERENCES public.waqf_deeds(id) ON DELETE CASCADE;


--
-- Name: delegations delegations_agent_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delegations
    ADD CONSTRAINT delegations_agent_user_id_users_id_fk FOREIGN KEY (agent_user_id) REFERENCES public.users(id);


--
-- Name: deliverables deliverables_request_id_service_requests_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliverables
    ADD CONSTRAINT deliverables_request_id_service_requests_id_fk FOREIGN KEY (request_id) REFERENCES public.service_requests(id) ON DELETE CASCADE;


--
-- Name: devices devices_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: distribution_lines distribution_lines_beneficiary_id_beneficiaries_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.distribution_lines
    ADD CONSTRAINT distribution_lines_beneficiary_id_beneficiaries_id_fk FOREIGN KEY (beneficiary_id) REFERENCES public.beneficiaries(id);


--
-- Name: distribution_lines distribution_lines_distribution_id_distributions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.distribution_lines
    ADD CONSTRAINT distribution_lines_distribution_id_distributions_id_fk FOREIGN KEY (distribution_id) REFERENCES public.distributions(id) ON DELETE CASCADE;


--
-- Name: distributions distributions_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.distributions
    ADD CONSTRAINT distributions_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: document_links document_links_document_id_documents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_links
    ADD CONSTRAINT document_links_document_id_documents_id_fk FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: document_shares document_shares_document_id_documents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_shares
    ADD CONSTRAINT document_shares_document_id_documents_id_fk FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: document_versions document_versions_document_id_documents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_versions
    ADD CONSTRAINT document_versions_document_id_documents_id_fk FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: encumbrances encumbrances_asset_id_assets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encumbrances
    ADD CONSTRAINT encumbrances_asset_id_assets_id_fk FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE CASCADE;


--
-- Name: entitlements entitlements_beneficiary_id_beneficiaries_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entitlements
    ADD CONSTRAINT entitlements_beneficiary_id_beneficiaries_id_fk FOREIGN KEY (beneficiary_id) REFERENCES public.beneficiaries(id) ON DELETE CASCADE;


--
-- Name: extracted_fields extracted_fields_document_id_documents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.extracted_fields
    ADD CONSTRAINT extracted_fields_document_id_documents_id_fk FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: facts facts_assessment_id_assessments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facts
    ADD CONSTRAINT facts_assessment_id_assessments_id_fk FOREIGN KEY (assessment_id) REFERENCES public.assessments(id) ON DELETE CASCADE;


--
-- Name: financial_statements financial_statements_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_statements
    ADD CONSTRAINT financial_statements_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: founders founders_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.founders
    ADD CONSTRAINT founders_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: investment_policies investment_policies_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investment_policies
    ADD CONSTRAINT investment_policies_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: investments investments_asset_id_assets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investments
    ADD CONSTRAINT investments_asset_id_assets_id_fk FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE CASCADE;


--
-- Name: leases leases_asset_id_assets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leases
    ADD CONSTRAINT leases_asset_id_assets_id_fk FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE CASCADE;


--
-- Name: ledger_entries ledger_entries_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: maintenance_plans maintenance_plans_asset_id_assets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_plans
    ADD CONSTRAINT maintenance_plans_asset_id_assets_id_fk FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE CASCADE;


--
-- Name: meetings meetings_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: messages messages_conversation_id_conversations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: mfa_factors mfa_factors_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mfa_factors
    ADD CONSTRAINT mfa_factors_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: minute_signatures minute_signatures_minute_id_minutes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minute_signatures
    ADD CONSTRAINT minute_signatures_minute_id_minutes_id_fk FOREIGN KEY (minute_id) REFERENCES public.minutes(id) ON DELETE CASCADE;


--
-- Name: minutes minutes_meeting_id_meetings_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minutes
    ADD CONSTRAINT minutes_meeting_id_meetings_id_fk FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE CASCADE;


--
-- Name: obligation_events obligation_events_instance_id_obligation_instances_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obligation_events
    ADD CONSTRAINT obligation_events_instance_id_obligation_instances_id_fk FOREIGN KEY (instance_id) REFERENCES public.obligation_instances(id) ON DELETE CASCADE;


--
-- Name: obligation_instances obligation_instances_obligation_id_obligations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obligation_instances
    ADD CONSTRAINT obligation_instances_obligation_id_obligations_id_fk FOREIGN KEY (obligation_id) REFERENCES public.obligations(id);


--
-- Name: obligation_instances obligation_instances_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obligation_instances
    ADD CONSTRAINT obligation_instances_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: obligations obligations_requirement_id_regulatory_requirements_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obligations
    ADD CONSTRAINT obligations_requirement_id_regulatory_requirements_id_fk FOREIGN KEY (requirement_id) REFERENCES public.regulatory_requirements(id);


--
-- Name: organization_members organization_members_organization_id_organizations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: package_items package_items_package_id_packages_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_items
    ADD CONSTRAINT package_items_package_id_packages_id_fk FOREIGN KEY (package_id) REFERENCES public.packages(id) ON DELETE CASCADE;


--
-- Name: package_items package_items_service_id_services_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_items
    ADD CONSTRAINT package_items_service_id_services_id_fk FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;


--
-- Name: payments payments_invoice_id_invoices_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_invoice_id_invoices_id_fk FOREIGN KEY (invoice_id) REFERENCES public.invoices(id);


--
-- Name: performance_reviews performance_reviews_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.performance_reviews
    ADD CONSTRAINT performance_reviews_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: policies policies_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policies
    ADD CONSTRAINT policies_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: portfolios portfolios_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portfolios
    ADD CONSTRAINT portfolios_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: properties properties_asset_id_assets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_asset_id_assets_id_fk FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE CASCADE;


--
-- Name: recommendations recommendations_assessment_id_assessments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendations
    ADD CONSTRAINT recommendations_assessment_id_assessments_id_fk FOREIGN KEY (assessment_id) REFERENCES public.assessments(id) ON DELETE CASCADE;


--
-- Name: recovery_codes recovery_codes_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recovery_codes
    ADD CONSTRAINT recovery_codes_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: regulatory_requirements regulatory_requirements_reference_id_regulatory_references_id_f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regulatory_requirements
    ADD CONSTRAINT regulatory_requirements_reference_id_regulatory_references_id_f FOREIGN KEY (reference_id) REFERENCES public.regulatory_references(id);


--
-- Name: report_shares report_shares_report_id_reports_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_shares
    ADD CONSTRAINT report_shares_report_id_reports_id_fk FOREIGN KEY (report_id) REFERENCES public.reports(id) ON DELETE CASCADE;


--
-- Name: request_events request_events_request_id_service_requests_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_events
    ADD CONSTRAINT request_events_request_id_service_requests_id_fk FOREIGN KEY (request_id) REFERENCES public.service_requests(id) ON DELETE CASCADE;


--
-- Name: request_notes request_notes_request_id_service_requests_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_notes
    ADD CONSTRAINT request_notes_request_id_service_requests_id_fk FOREIGN KEY (request_id) REFERENCES public.service_requests(id) ON DELETE CASCADE;


--
-- Name: request_stages request_stages_request_id_service_requests_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_stages
    ADD CONSTRAINT request_stages_request_id_service_requests_id_fk FOREIGN KEY (request_id) REFERENCES public.service_requests(id) ON DELETE CASCADE;


--
-- Name: resolutions resolutions_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resolutions
    ADD CONSTRAINT resolutions_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: revenue_allocations revenue_allocations_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_allocations
    ADD CONSTRAINT revenue_allocations_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: risk_register risk_register_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_register
    ADD CONSTRAINT risk_register_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_permission_id_permissions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_permissions_id_fk FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_id_roles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_roles_id_fk FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: service_prices service_prices_service_id_services_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_prices
    ADD CONSTRAINT service_prices_service_id_services_id_fk FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;


--
-- Name: service_requests service_requests_service_id_services_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_requests
    ADD CONSTRAINT service_requests_service_id_services_id_fk FOREIGN KEY (service_id) REFERENCES public.services(id);


--
-- Name: services services_category_id_service_categories_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_category_id_service_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.service_categories(id);


--
-- Name: sessions sessions_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_package_id_packages_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_package_id_packages_id_fk FOREIGN KEY (package_id) REFERENCES public.packages(id);


--
-- Name: successions successions_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.successions
    ADD CONSTRAINT successions_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: task_comments task_comments_task_id_tasks_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_task_id_tasks_id_fk FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: trustee_appointments trustee_appointments_trustee_id_trustees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trustee_appointments
    ADD CONSTRAINT trustee_appointments_trustee_id_trustees_id_fk FOREIGN KEY (trustee_id) REFERENCES public.trustees(id) ON DELETE CASCADE;


--
-- Name: trustees trustees_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trustees
    ADD CONSTRAINT trustees_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_role_id_roles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_role_id_roles_id_fk FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: valuations valuations_asset_id_assets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.valuations
    ADD CONSTRAINT valuations_asset_id_assets_id_fk FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE CASCADE;


--
-- Name: violations violations_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.violations
    ADD CONSTRAINT violations_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: votes votes_resolution_id_resolutions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.votes
    ADD CONSTRAINT votes_resolution_id_resolutions_id_fk FOREIGN KEY (resolution_id) REFERENCES public.resolutions(id) ON DELETE CASCADE;


--
-- Name: waqf_classifications waqf_classifications_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waqf_classifications
    ADD CONSTRAINT waqf_classifications_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: waqf_deeds waqf_deeds_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waqf_deeds
    ADD CONSTRAINT waqf_deeds_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: waqf_exceptions waqf_exceptions_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waqf_exceptions
    ADD CONSTRAINT waqf_exceptions_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: waqf_governance_profiles waqf_governance_profiles_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waqf_governance_profiles
    ADD CONSTRAINT waqf_governance_profiles_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: waqf_memberships waqf_memberships_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waqf_memberships
    ADD CONSTRAINT waqf_memberships_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: waqf_registrations waqf_registrations_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waqf_registrations
    ADD CONSTRAINT waqf_registrations_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: waqf_timeline_events waqf_timeline_events_waqf_id_waqfs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waqf_timeline_events
    ADD CONSTRAINT waqf_timeline_events_waqf_id_waqfs_id_fk FOREIGN KEY (waqf_id) REFERENCES public.waqfs(id) ON DELETE CASCADE;


--
-- Name: action_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.action_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: agenda_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agenda_items ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_interactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_interactions ENABLE ROW LEVEL SECURITY;

--
-- Name: approvals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;

--
-- Name: assessment_answers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.assessment_answers ENABLE ROW LEVEL SECURITY;

--
-- Name: assessment_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.assessment_results ENABLE ROW LEVEL SECURITY;

--
-- Name: assessments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;

--
-- Name: assets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: axis_scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.axis_scores ENABLE ROW LEVEL SECURITY;

--
-- Name: bank_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: beneficial_owners; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.beneficial_owners ENABLE ROW LEVEL SECURITY;

--
-- Name: beneficiaries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.beneficiaries ENABLE ROW LEVEL SECURITY;

--
-- Name: beneficiary_classes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.beneficiary_classes ENABLE ROW LEVEL SECURITY;

--
-- Name: break_glass_access bga_own_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bga_own_insert ON public.break_glass_access FOR INSERT TO waqfak_app WITH CHECK (((user_id = public.app_current_user()) AND (status = 'requested'::text)));


--
-- Name: break_glass_access bga_own_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bga_own_select ON public.break_glass_access FOR SELECT TO waqfak_app USING ((user_id = public.app_current_user()));


--
-- Name: bodies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bodies ENABLE ROW LEVEL SECURITY;

--
-- Name: body_memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.body_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: break_glass_access; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.break_glass_access ENABLE ROW LEVEL SECURITY;

--
-- Name: budgets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

--
-- Name: complaints; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;

--
-- Name: condition_interpretations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.condition_interpretations ENABLE ROW LEVEL SECURITY;

--
-- Name: conditions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conditions ENABLE ROW LEVEL SECURITY;

--
-- Name: conflict_declarations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conflict_declarations ENABLE ROW LEVEL SECURITY;

--
-- Name: contracts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

--
-- Name: conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: critical_flags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.critical_flags ENABLE ROW LEVEL SECURITY;

--
-- Name: deed_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deed_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: delegations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.delegations ENABLE ROW LEVEL SECURITY;

--
-- Name: deliverables; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deliverables ENABLE ROW LEVEL SECURITY;

--
-- Name: distribution_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.distribution_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: distributions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.distributions ENABLE ROW LEVEL SECURITY;

--
-- Name: document_access_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_access_log ENABLE ROW LEVEL SECURITY;

--
-- Name: document_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_links ENABLE ROW LEVEL SECURITY;

--
-- Name: document_shares; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_shares ENABLE ROW LEVEL SECURITY;

--
-- Name: document_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

--
-- Name: encumbrances; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.encumbrances ENABLE ROW LEVEL SECURITY;

--
-- Name: entitlements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;

--
-- Name: extracted_fields; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.extracted_fields ENABLE ROW LEVEL SECURITY;

--
-- Name: financial_statements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.financial_statements ENABLE ROW LEVEL SECURITY;

--
-- Name: founders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.founders ENABLE ROW LEVEL SECURITY;

--
-- Name: investment_policies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.investment_policies ENABLE ROW LEVEL SECURITY;

--
-- Name: investments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.investments ENABLE ROW LEVEL SECURITY;

--
-- Name: invitations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

--
-- Name: invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: leases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.leases ENABLE ROW LEVEL SECURITY;

--
-- Name: ledger_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: maintenance_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.maintenance_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: meetings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;

--
-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: minute_signatures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.minute_signatures ENABLE ROW LEVEL SECURITY;

--
-- Name: minutes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.minutes ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications notif_owner_del; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notif_owner_del ON public.notifications AS RESTRICTIVE FOR DELETE TO waqfak_app USING (((public.app_current_user() IS NULL) OR (user_id = public.app_current_user())));


--
-- Name: notifications notif_owner_sel; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notif_owner_sel ON public.notifications AS RESTRICTIVE FOR SELECT TO waqfak_app USING (((public.app_current_user() IS NULL) OR (user_id = public.app_current_user())));


--
-- Name: notifications notif_owner_upd; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notif_owner_upd ON public.notifications AS RESTRICTIVE FOR UPDATE TO waqfak_app USING (((public.app_current_user() IS NULL) OR (user_id = public.app_current_user())));


--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: obligation_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.obligation_events ENABLE ROW LEVEL SECURITY;

--
-- Name: obligation_instances; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.obligation_instances ENABLE ROW LEVEL SECURITY;

--
-- Name: performance_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.performance_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: policies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.policies ENABLE ROW LEVEL SECURITY;

--
-- Name: portfolios; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.portfolios ENABLE ROW LEVEL SECURITY;

--
-- Name: projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

--
-- Name: properties; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

--
-- Name: recommendations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;

--
-- Name: report_shares; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.report_shares ENABLE ROW LEVEL SECURITY;

--
-- Name: reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

--
-- Name: request_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.request_events ENABLE ROW LEVEL SECURITY;

--
-- Name: request_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.request_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: request_stages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.request_stages ENABLE ROW LEVEL SECURITY;

--
-- Name: resolutions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.resolutions ENABLE ROW LEVEL SECURITY;

--
-- Name: revenue_allocations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.revenue_allocations ENABLE ROW LEVEL SECURITY;

--
-- Name: risk_register; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.risk_register ENABLE ROW LEVEL SECURITY;

--
-- Name: service_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: successions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.successions ENABLE ROW LEVEL SECURITY;

--
-- Name: task_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: trustee_appointments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trustee_appointments ENABLE ROW LEVEL SECURITY;

--
-- Name: trustees; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trustees ENABLE ROW LEVEL SECURITY;

--
-- Name: valuations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.valuations ENABLE ROW LEVEL SECURITY;

--
-- Name: violations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.violations ENABLE ROW LEVEL SECURITY;

--
-- Name: votes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;

--
-- Name: waqf_classifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waqf_classifications ENABLE ROW LEVEL SECURITY;

--
-- Name: waqf_deeds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waqf_deeds ENABLE ROW LEVEL SECURITY;

--
-- Name: waqfs waqf_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_delete ON public.waqfs FOR DELETE TO waqfak_app USING (public.app_has_global_access());


--
-- Name: waqf_exceptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waqf_exceptions ENABLE ROW LEVEL SECURITY;

--
-- Name: waqf_governance_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waqf_governance_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: waqfs waqf_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_insert ON public.waqfs FOR INSERT TO waqfak_app WITH CHECK (((public.app_current_user() IS NOT NULL) OR public.app_has_global_access()));


--
-- Name: action_plans waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.action_plans TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: agenda_items waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.agenda_items TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: ai_interactions waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.ai_interactions TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: approvals waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.approvals TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: assessment_answers waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.assessment_answers TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: assessment_results waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.assessment_results TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: assessments waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.assessments TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: assets waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.assets TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: attendance waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.attendance TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: audit_logs waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.audit_logs TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: axis_scores waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.axis_scores TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: bank_accounts waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.bank_accounts TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: beneficial_owners waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.beneficial_owners TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: beneficiaries waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.beneficiaries TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: beneficiary_classes waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.beneficiary_classes TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: bodies waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.bodies TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: body_memberships waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.body_memberships TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: break_glass_access waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.break_glass_access TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: budgets waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.budgets TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: complaints waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.complaints TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: condition_interpretations waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.condition_interpretations TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: conditions waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.conditions TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: conflict_declarations waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.conflict_declarations TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: contracts waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.contracts TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: conversations waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.conversations TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: critical_flags waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.critical_flags TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: deed_versions waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.deed_versions TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: delegations waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.delegations TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: deliverables waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.deliverables TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: distribution_lines waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.distribution_lines TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: distributions waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.distributions TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: document_access_log waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.document_access_log TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: document_links waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.document_links TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: document_shares waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.document_shares TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: document_versions waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.document_versions TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: documents waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.documents TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: encumbrances waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.encumbrances TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: entitlements waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.entitlements TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: extracted_fields waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.extracted_fields TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: financial_statements waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.financial_statements TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: founders waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.founders TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: investment_policies waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.investment_policies TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: investments waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.investments TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: invitations waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.invitations TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: invoices waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.invoices TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: leases waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.leases TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: ledger_entries waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.ledger_entries TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: maintenance_plans waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.maintenance_plans TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: meetings waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.meetings TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: messages waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.messages TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: minute_signatures waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.minute_signatures TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: minutes waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.minutes TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: notifications waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.notifications TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: obligation_events waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.obligation_events TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: obligation_instances waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.obligation_instances TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: performance_reviews waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.performance_reviews TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: policies waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.policies TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: portfolios waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.portfolios TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: projects waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.projects TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: properties waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.properties TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: recommendations waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.recommendations TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: report_shares waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.report_shares TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: reports waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.reports TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: request_events waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.request_events TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: request_notes waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.request_notes TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: request_stages waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.request_stages TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: resolutions waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.resolutions TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: revenue_allocations waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.revenue_allocations TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: risk_register waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.risk_register TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: service_requests waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.service_requests TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: subscriptions waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.subscriptions TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: successions waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.successions TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: task_comments waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.task_comments TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: tasks waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.tasks TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: trustee_appointments waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.trustee_appointments TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: trustees waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.trustees TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: valuations waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.valuations TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: violations waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.violations TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: votes waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.votes TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: waqf_classifications waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.waqf_classifications TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: waqf_deeds waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.waqf_deeds TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: waqf_exceptions waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.waqf_exceptions TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: waqf_governance_profiles waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.waqf_governance_profiles TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: waqf_keys waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.waqf_keys TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK ((public.app_can_access_waqf(waqf_id) OR (NOT public.app_waqf_has_members(waqf_id))));


--
-- Name: waqf_registrations waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.waqf_registrations TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: waqf_timeline_events waqf_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_isolation ON public.waqf_timeline_events TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: waqf_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waqf_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: waqf_memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waqf_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: waqf_registrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waqf_registrations ENABLE ROW LEVEL SECURITY;

--
-- Name: waqfs waqf_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_select ON public.waqfs FOR SELECT TO waqfak_app USING ((public.app_can_access_waqf(id) OR ((NOT public.app_waqf_has_members(id)) AND (created_by = public.app_current_user()))));


--
-- Name: waqf_timeline_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waqf_timeline_events ENABLE ROW LEVEL SECURITY;

--
-- Name: waqfs waqf_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY waqf_update ON public.waqfs FOR UPDATE TO waqfak_app USING (public.app_can_access_waqf(id)) WITH CHECK (public.app_can_access_waqf(id));


--
-- Name: waqfs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waqfs ENABLE ROW LEVEL SECURITY;

--
-- Name: waqf_memberships wm_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wm_delete ON public.waqf_memberships FOR DELETE TO waqfak_app USING (public.app_has_global_access());


--
-- Name: waqf_memberships wm_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wm_insert ON public.waqf_memberships FOR INSERT TO waqfak_app WITH CHECK ((public.app_can_access_waqf(waqf_id) OR (NOT public.app_waqf_has_members(waqf_id))));


--
-- Name: waqf_memberships wm_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wm_select ON public.waqf_memberships FOR SELECT TO waqfak_app USING (((user_id = public.app_current_user()) OR public.app_can_access_waqf(waqf_id)));


--
-- Name: waqf_memberships wm_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wm_update ON public.waqf_memberships FOR UPDATE TO waqfak_app USING (public.app_can_access_waqf(waqf_id)) WITH CHECK (public.app_can_access_waqf(waqf_id));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO waqfak_app;


--
-- Name: SCHEMA restricted; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA restricted TO waqfak_mlro;


--
-- Name: FUNCTION app_audit_last_hash(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.app_audit_last_hash() FROM PUBLIC;
GRANT ALL ON FUNCTION public.app_audit_last_hash() TO waqfak_app;


--
-- Name: FUNCTION app_can_access_waqf(w uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.app_can_access_waqf(w uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.app_can_access_waqf(w uuid) TO waqfak_app;


--
-- Name: FUNCTION app_current_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.app_current_user() TO waqfak_app;


--
-- Name: FUNCTION app_has_global_access(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.app_has_global_access() TO waqfak_app;


--
-- Name: FUNCTION app_waqf_has_members(w uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.app_waqf_has_members(w uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.app_waqf_has_members(w uuid) TO waqfak_app;


--
-- Name: TABLE action_plans; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.action_plans TO waqfak_app;


--
-- Name: TABLE agenda_items; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agenda_items TO waqfak_app;


--
-- Name: TABLE ai_interactions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ai_interactions TO waqfak_app;


--
-- Name: TABLE approvals; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.approvals TO waqfak_app;


--
-- Name: TABLE assessment_answers; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.assessment_answers TO waqfak_app;


--
-- Name: TABLE assessment_axes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.assessment_axes TO waqfak_app;


--
-- Name: TABLE assessment_questions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.assessment_questions TO waqfak_app;


--
-- Name: TABLE assessment_results; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.assessment_results TO waqfak_app;


--
-- Name: TABLE assessments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.assessments TO waqfak_app;


--
-- Name: TABLE assets; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.assets TO waqfak_app;


--
-- Name: TABLE attendance; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.attendance TO waqfak_app;


--
-- Name: TABLE audit_logs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.audit_logs TO waqfak_app;


--
-- Name: SEQUENCE audit_logs_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.audit_logs_id_seq TO waqfak_app;


--
-- Name: TABLE axis_scores; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.axis_scores TO waqfak_app;


--
-- Name: TABLE bank_accounts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.bank_accounts TO waqfak_app;


--
-- Name: TABLE beneficial_owners; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.beneficial_owners TO waqfak_app;


--
-- Name: TABLE beneficiaries; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.beneficiaries TO waqfak_app;


--
-- Name: TABLE beneficiary_classes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.beneficiary_classes TO waqfak_app;


--
-- Name: TABLE bodies; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.bodies TO waqfak_app;


--
-- Name: TABLE body_memberships; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.body_memberships TO waqfak_app;


--
-- Name: TABLE break_glass_access; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.break_glass_access TO waqfak_app;


--
-- Name: TABLE budgets; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.budgets TO waqfak_app;


--
-- Name: TABLE complaints; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.complaints TO waqfak_app;


--
-- Name: TABLE compliance_change_log; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.compliance_change_log TO waqfak_app;


--
-- Name: TABLE condition_interpretations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.condition_interpretations TO waqfak_app;


--
-- Name: TABLE conditions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.conditions TO waqfak_app;


--
-- Name: TABLE conflict_declarations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.conflict_declarations TO waqfak_app;


--
-- Name: TABLE consents; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.consents TO waqfak_app;


--
-- Name: TABLE contact_messages; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.contact_messages TO waqfak_app;


--
-- Name: TABLE content_items; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.content_items TO waqfak_app;


--
-- Name: TABLE content_reviews; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.content_reviews TO waqfak_app;


--
-- Name: TABLE contract_signatures; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.contract_signatures TO waqfak_app;


--
-- Name: TABLE contract_templates; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.contract_templates TO waqfak_app;


--
-- Name: TABLE contracts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.contracts TO waqfak_app;


--
-- Name: TABLE conversations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.conversations TO waqfak_app;


--
-- Name: TABLE critical_flag_defs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.critical_flag_defs TO waqfak_app;


--
-- Name: TABLE critical_flags; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.critical_flags TO waqfak_app;


--
-- Name: TABLE data_subject_requests; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.data_subject_requests TO waqfak_app;


--
-- Name: TABLE deed_versions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.deed_versions TO waqfak_app;


--
-- Name: TABLE delegations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.delegations TO waqfak_app;


--
-- Name: TABLE deliverables; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.deliverables TO waqfak_app;


--
-- Name: TABLE devices; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.devices TO waqfak_app;


--
-- Name: TABLE discounts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.discounts TO waqfak_app;


--
-- Name: TABLE distribution_lines; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.distribution_lines TO waqfak_app;


--
-- Name: TABLE distributions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.distributions TO waqfak_app;


--
-- Name: TABLE document_access_log; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.document_access_log TO waqfak_app;


--
-- Name: TABLE document_links; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.document_links TO waqfak_app;


--
-- Name: TABLE document_shares; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.document_shares TO waqfak_app;


--
-- Name: TABLE document_versions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.document_versions TO waqfak_app;


--
-- Name: TABLE documents; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.documents TO waqfak_app;


--
-- Name: TABLE encumbrances; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.encumbrances TO waqfak_app;


--
-- Name: TABLE entitlements; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.entitlements TO waqfak_app;


--
-- Name: TABLE extracted_fields; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.extracted_fields TO waqfak_app;


--
-- Name: TABLE facts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.facts TO waqfak_app;


--
-- Name: TABLE faqs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.faqs TO waqfak_app;


--
-- Name: TABLE feature_flags; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.feature_flags TO waqfak_app;


--
-- Name: TABLE financial_statements; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.financial_statements TO waqfak_app;


--
-- Name: TABLE founders; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.founders TO waqfak_app;


--
-- Name: TABLE glossary_terms; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.glossary_terms TO waqfak_app;


--
-- Name: TABLE holidays; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.holidays TO waqfak_app;


--
-- Name: TABLE investment_policies; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.investment_policies TO waqfak_app;


--
-- Name: TABLE investments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.investments TO waqfak_app;


--
-- Name: TABLE invitations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.invitations TO waqfak_app;


--
-- Name: TABLE invoices; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.invoices TO waqfak_app;


--
-- Name: TABLE job_runs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.job_runs TO waqfak_app;


--
-- Name: TABLE kyc_records; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.kyc_records TO waqfak_app;


--
-- Name: TABLE leases; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.leases TO waqfak_app;


--
-- Name: TABLE ledger_entries; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ledger_entries TO waqfak_app;


--
-- Name: TABLE maintenance_plans; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.maintenance_plans TO waqfak_app;


--
-- Name: TABLE meetings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.meetings TO waqfak_app;


--
-- Name: TABLE messages; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.messages TO waqfak_app;


--
-- Name: TABLE mfa_factors; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.mfa_factors TO waqfak_app;


--
-- Name: TABLE minute_signatures; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.minute_signatures TO waqfak_app;


--
-- Name: TABLE minutes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.minutes TO waqfak_app;


--
-- Name: TABLE needs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.needs TO waqfak_app;


--
-- Name: TABLE notification_preferences; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notification_preferences TO waqfak_app;


--
-- Name: TABLE notification_templates; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notification_templates TO waqfak_app;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notifications TO waqfak_app;


--
-- Name: TABLE obligation_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.obligation_events TO waqfak_app;


--
-- Name: TABLE obligation_instances; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.obligation_instances TO waqfak_app;


--
-- Name: TABLE obligations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.obligations TO waqfak_app;


--
-- Name: TABLE organization_members; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.organization_members TO waqfak_app;


--
-- Name: TABLE organizations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.organizations TO waqfak_app;


--
-- Name: TABLE otp_challenges; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.otp_challenges TO waqfak_app;


--
-- Name: TABLE outbox_messages; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.outbox_messages TO waqfak_app;


--
-- Name: SEQUENCE outbox_messages_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.outbox_messages_id_seq TO waqfak_app;


--
-- Name: TABLE package_items; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.package_items TO waqfak_app;


--
-- Name: TABLE packages; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.packages TO waqfak_app;


--
-- Name: TABLE payments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.payments TO waqfak_app;


--
-- Name: TABLE penalty_schedule; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.penalty_schedule TO waqfak_app;


--
-- Name: TABLE performance_reviews; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.performance_reviews TO waqfak_app;


--
-- Name: TABLE permissions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.permissions TO waqfak_app;


--
-- Name: TABLE persons; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.persons TO waqfak_app;


--
-- Name: TABLE policies; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.policies TO waqfak_app;


--
-- Name: TABLE portfolios; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.portfolios TO waqfak_app;


--
-- Name: TABLE price_change_log; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.price_change_log TO waqfak_app;


--
-- Name: TABLE projects; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.projects TO waqfak_app;


--
-- Name: TABLE properties; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.properties TO waqfak_app;


--
-- Name: TABLE question_bank_versions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.question_bank_versions TO waqfak_app;


--
-- Name: TABLE rate_limits; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.rate_limits TO waqfak_app;


--
-- Name: TABLE recommendation_rules; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.recommendation_rules TO waqfak_app;


--
-- Name: TABLE recommendations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.recommendations TO waqfak_app;


--
-- Name: TABLE recovery_codes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.recovery_codes TO waqfak_app;


--
-- Name: TABLE regulatory_references; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.regulatory_references TO waqfak_app;


--
-- Name: TABLE regulatory_requirements; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.regulatory_requirements TO waqfak_app;


--
-- Name: TABLE report_shares; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.report_shares TO waqfak_app;


--
-- Name: TABLE reports; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.reports TO waqfak_app;


--
-- Name: TABLE request_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.request_events TO waqfak_app;


--
-- Name: TABLE request_notes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.request_notes TO waqfak_app;


--
-- Name: TABLE request_stages; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.request_stages TO waqfak_app;


--
-- Name: TABLE resolutions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.resolutions TO waqfak_app;


--
-- Name: TABLE revenue_allocations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.revenue_allocations TO waqfak_app;


--
-- Name: TABLE risk_register; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.risk_register TO waqfak_app;


--
-- Name: TABLE role_permissions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.role_permissions TO waqfak_app;


--
-- Name: TABLE roles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.roles TO waqfak_app;


--
-- Name: TABLE sequences; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sequences TO waqfak_app;


--
-- Name: TABLE service_categories; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.service_categories TO waqfak_app;


--
-- Name: TABLE service_prices; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.service_prices TO waqfak_app;


--
-- Name: TABLE service_requests; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.service_requests TO waqfak_app;


--
-- Name: TABLE services; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.services TO waqfak_app;


--
-- Name: TABLE sessions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sessions TO waqfak_app;


--
-- Name: TABLE settings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.settings TO waqfak_app;


--
-- Name: TABLE subscriptions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.subscriptions TO waqfak_app;


--
-- Name: TABLE successions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.successions TO waqfak_app;


--
-- Name: TABLE task_comments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.task_comments TO waqfak_app;


--
-- Name: TABLE tasks; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tasks TO waqfak_app;


--
-- Name: TABLE trustee_appointments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.trustee_appointments TO waqfak_app;


--
-- Name: TABLE trustees; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.trustees TO waqfak_app;


--
-- Name: TABLE user_roles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_roles TO waqfak_app;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.users TO waqfak_app;


--
-- Name: TABLE valuations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.valuations TO waqfak_app;


--
-- Name: TABLE violations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.violations TO waqfak_app;


--
-- Name: TABLE votes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.votes TO waqfak_app;


--
-- Name: TABLE waqf_classifications; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.waqf_classifications TO waqfak_app;


--
-- Name: TABLE waqf_deeds; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.waqf_deeds TO waqfak_app;


--
-- Name: TABLE waqf_exceptions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.waqf_exceptions TO waqfak_app;


--
-- Name: TABLE waqf_governance_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.waqf_governance_profiles TO waqfak_app;


--
-- Name: TABLE waqf_keys; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.waqf_keys TO waqfak_app;


--
-- Name: TABLE waqf_memberships; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.waqf_memberships TO waqfak_app;


--
-- Name: TABLE waqf_registrations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.waqf_registrations TO waqfak_app;


--
-- Name: TABLE waqf_timeline_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.waqf_timeline_events TO waqfak_app;


--
-- Name: TABLE waqfs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.waqfs TO waqfak_app;


--
-- Name: TABLE workflow_templates; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workflow_templates TO waqfak_app;


--
-- Name: TABLE screening_results; Type: ACL; Schema: restricted; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE restricted.screening_results TO waqfak_mlro;


--
-- Name: TABLE suspicion_reports; Type: ACL; Schema: restricted; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE restricted.suspicion_reports TO waqfak_mlro;


--
-- PostgreSQL database dump complete
--

\unrestrict 2NSqCXDLKFSNHFlO9CboTJvrHMvHiF9NIlNaOE3zbPauG7ZhFd00Xf6Zt0Qo3EY

