# Database schema — وقفك

PostgreSQL 16 · 146 tables · generated 2026-10-11 from the live catalog (scripts/export-schema.ts).
Definitions live in `src/server/db/schema/*.ts` (Drizzle) → migrations in `drizzle/` → security (roles, grants, RLS, triggers) in `src/server/db/sql/security.sql`.

Roles: `waqfak_owner` (migrations), `waqfak_app` (runtime, subject to RLS), `waqfak_mlro` (only role that reaches the `restricted` schema).
Isolation: every table with a `waqf_id` column carries the `waqf_isolation` policy → `app_can_access_waqf(waqf_id)`.

## Tables

[public.action_plans](#publicaction_plans) · [public.agenda_items](#publicagenda_items) · [public.ai_interactions](#publicai_interactions) · [public.approvals](#publicapprovals) · [public.assessment_answers](#publicassessment_answers) · [public.assessment_axes](#publicassessment_axes) · [public.assessment_questions](#publicassessment_questions) · [public.assessment_results](#publicassessment_results) · [public.assessments](#publicassessments) · [public.assets](#publicassets) · [public.attendance](#publicattendance) · [public.audit_logs](#publicaudit_logs) · [public.axis_scores](#publicaxis_scores) · [public.bank_accounts](#publicbank_accounts) · [public.beneficial_owners](#publicbeneficial_owners) · [public.beneficiaries](#publicbeneficiaries) · [public.beneficiary_classes](#publicbeneficiary_classes) · [public.bodies](#publicbodies) · [public.body_memberships](#publicbody_memberships) · [public.break_glass_access](#publicbreak_glass_access) · [public.budgets](#publicbudgets) · [public.complaints](#publiccomplaints) · [public.compliance_change_log](#publiccompliance_change_log) · [public.condition_interpretations](#publiccondition_interpretations) · [public.conditions](#publicconditions) · [public.conflict_declarations](#publicconflict_declarations) · [public.consents](#publicconsents) · [public.contact_messages](#publiccontact_messages) · [public.content_items](#publiccontent_items) · [public.content_reviews](#publiccontent_reviews) · [public.contract_signatures](#publiccontract_signatures) · [public.contract_templates](#publiccontract_templates) · [public.contracts](#publiccontracts) · [public.conversations](#publicconversations) · [public.critical_flag_defs](#publiccritical_flag_defs) · [public.critical_flags](#publiccritical_flags) · [public.data_subject_requests](#publicdata_subject_requests) · [public.deed_versions](#publicdeed_versions) · [public.delegations](#publicdelegations) · [public.deliverables](#publicdeliverables) · [public.devices](#publicdevices) · [public.discounts](#publicdiscounts) · [public.distribution_lines](#publicdistribution_lines) · [public.distributions](#publicdistributions) · [public.document_access_log](#publicdocument_access_log) · [public.document_links](#publicdocument_links) · [public.document_shares](#publicdocument_shares) · [public.document_versions](#publicdocument_versions) · [public.documents](#publicdocuments) · [public.encumbrances](#publicencumbrances) · [public.entitlements](#publicentitlements) · [public.extracted_fields](#publicextracted_fields) · [public.facts](#publicfacts) · [public.faqs](#publicfaqs) · [public.feature_flags](#publicfeature_flags) · [public.financial_statements](#publicfinancial_statements) · [public.founders](#publicfounders) · [public.glossary_terms](#publicglossary_terms) · [public.holidays](#publicholidays) · [public.investment_policies](#publicinvestment_policies) · [public.investments](#publicinvestments) · [public.invitations](#publicinvitations) · [public.invoices](#publicinvoices) · [public.job_runs](#publicjob_runs) · [public.kyc_records](#publickyc_records) · [public.leases](#publicleases) · [public.ledger_entries](#publicledger_entries) · [public.maintenance_plans](#publicmaintenance_plans) · [public.meetings](#publicmeetings) · [public.messages](#publicmessages) · [public.mfa_factors](#publicmfa_factors) · [public.minute_signatures](#publicminute_signatures) · [public.minutes](#publicminutes) · [public.nazara_engagements](#publicnazara_engagements) · [public.nazara_events](#publicnazara_events) · [public.nazara_team](#publicnazara_team) · [public.needs](#publicneeds) · [public.notification_preferences](#publicnotification_preferences) · [public.notification_templates](#publicnotification_templates) · [public.notifications](#publicnotifications) · [public.obligation_events](#publicobligation_events) · [public.obligation_instances](#publicobligation_instances) · [public.obligations](#publicobligations) · [public.organization_members](#publicorganization_members) · [public.organizations](#publicorganizations) · [public.otp_challenges](#publicotp_challenges) · [public.outbox_messages](#publicoutbox_messages) · [public.package_items](#publicpackage_items) · [public.packages](#publicpackages) · [public.payments](#publicpayments) · [public.penalty_schedule](#publicpenalty_schedule) · [public.performance_reviews](#publicperformance_reviews) · [public.permissions](#publicpermissions) · [public.persons](#publicpersons) · [public.policies](#publicpolicies) · [public.portfolios](#publicportfolios) · [public.price_change_log](#publicprice_change_log) · [public.projects](#publicprojects) · [public.properties](#publicproperties) · [public.question_bank_versions](#publicquestion_bank_versions) · [public.rate_limits](#publicrate_limits) · [public.recommendation_rules](#publicrecommendation_rules) · [public.recommendations](#publicrecommendations) · [public.recovery_codes](#publicrecovery_codes) · [public.regulatory_references](#publicregulatory_references) · [public.regulatory_requirements](#publicregulatory_requirements) · [public.report_shares](#publicreport_shares) · [public.reports](#publicreports) · [public.request_events](#publicrequest_events) · [public.request_notes](#publicrequest_notes) · [public.request_stages](#publicrequest_stages) · [public.resolutions](#publicresolutions) · [public.revenue_allocations](#publicrevenue_allocations) · [public.risk_register](#publicrisk_register) · [public.role_permissions](#publicrole_permissions) · [public.roles](#publicroles) · [public.sequences](#publicsequences) · [public.service_categories](#publicservice_categories) · [public.service_prices](#publicservice_prices) · [public.service_requests](#publicservice_requests) · [public.services](#publicservices) · [public.sessions](#publicsessions) · [public.settings](#publicsettings) · [public.subscriptions](#publicsubscriptions) · [public.successions](#publicsuccessions) · [public.task_comments](#publictask_comments) · [public.tasks](#publictasks) · [public.trustee_appointments](#publictrustee_appointments) · [public.trustees](#publictrustees) · [public.user_roles](#publicuser_roles) · [public.users](#publicusers) · [public.valuations](#publicvaluations) · [public.violations](#publicviolations) · [public.votes](#publicvotes) · [public.waqf_classifications](#publicwaqf_classifications) · [public.waqf_deeds](#publicwaqf_deeds) · [public.waqf_exceptions](#publicwaqf_exceptions) · [public.waqf_governance_profiles](#publicwaqf_governance_profiles) · [public.waqf_keys](#publicwaqf_keys) · [public.waqf_memberships](#publicwaqf_memberships) · [public.waqf_registrations](#publicwaqf_registrations) · [public.waqf_timeline_events](#publicwaqf_timeline_events) · [public.waqfs](#publicwaqfs) · [public.workflow_templates](#publicworkflow_templates) · [restricted.screening_results](#restrictedscreening_results) · [restricted.suspicion_reports](#restrictedsuspicion_reports)

### public.action_plans

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| assessment_id | uuid |  | → assessments |
| waqf_id | uuid | yes |  |
| generated_at | timestamp with time zone |  | `now()` |
| summary | jsonb | yes |  |
| suggested_package_code | text | yes |  |

### public.agenda_items

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| meeting_id | uuid |  | → meetings |
| waqf_id | uuid |  |  |
| position | integer |  | `0` |
| title | text |  |  |
| presenter_name | text | yes |  |
| kind | text |  | `'discussion'::text` |
| condition_id | uuid | yes |  |
| document_ids | jsonb |  | `'[]'::jsonb` |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.ai_interactions

RLS: enabled — nullwaqf_owner (ALL), waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| user_id | uuid | yes |  |
| waqf_id | uuid | yes |  |
| kind | text |  |  |
| input | text |  |  |
| sources | jsonb |  | `'[]'::jsonb` |
| output | text |  |  |
| provider | text |  |  |
| model | text | yes |  |
| refused | boolean |  | `false` |
| refusal_reason | text | yes |  |
| feedback | text | yes |  |
| created_at | timestamp with time zone |  | `now()` |

### public.approvals

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| kind | approval_kind |  |  |
| authority | authority_kind |  |  |
| status | approval_status |  | `'draft'::approval_status` |
| subject | text |  |  |
| ref_no | text | yes |  |
| submitted_on | date | yes |  |
| decided_on | date | yes |  |
| asset_id | uuid | yes |  |
| document_id | uuid | yes |  |
| notes | text | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.assessment_answers

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| assessment_id | uuid |  | → assessments |
| question_code | text |  |  |
| waqf_id | uuid | yes |  |
| value | jsonb | yes |  |
| score | numeric | yes |  |
| is_unknown | boolean |  | `false` |
| is_na | boolean |  | `false` |
| evidence_level | evidence_level |  | `'declared'::evidence_level` |
| evidence_document_id | uuid | yes |  |
| verified_by | uuid | yes |  |
| answered_at | timestamp with time zone |  | `now()` |

### public.assessment_axes

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| bank_version_id | uuid |  | → question_bank_versions |
| code | text |  |  |
| name_ar | text |  |  |
| description | text | yes |  |
| weight_small | numeric |  |  |
| weight_medium | numeric |  |  |
| weight_large | numeric |  |  |
| position | integer |  |  |

### public.assessment_questions

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| bank_version_id | uuid |  | → question_bank_versions |
| code | text |  |  |
| axis_code | text |  |  |
| text_ar | text |  |  |
| help_ar | text | yes |  |
| answer_type | answer_type |  |  |
| options | jsonb | yes |  |
| weight | integer |  | `1` |
| reference_text | text | yes |  |
| critical_flag_code | text | yes |  |
| critical_when | jsonb | yes |  |
| show_if | jsonb | yes |  |
| fact_key | text | yes |  |
| depth | text |  | `'basic'::text` |
| position | integer |  |  |

### public.assessment_results

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| assessment_id | uuid |  | → assessments |
| waqf_id | uuid | yes |  |
| overall_score | numeric |  |  |
| maturity_score | numeric |  |  |
| maturity_level | text |  |  |
| status | text |  |  |
| confidence | text |  |  |
| evidence_ratio | numeric | yes |  |
| knowledge_gaps | integer |  | `0` |
| size_class | waqf_size_class | yes |  |
| computed_type | text | yes |  |
| weights_used | jsonb | yes |  |
| strengths | jsonb | yes |  |
| weaknesses | jsonb | yes |  |
| computed_at | timestamp with time zone |  | `now()` |

### public.assessments

RLS: enabled — nullwaqf_owner (ALL), waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid | yes |  |
| user_id | uuid | yes |  |
| anon_token_hash | text | yes |  |
| kind | text |  | `'basic'::text` |
| status | assessment_status |  | `'draft'::assessment_status` |
| bank_version_id | uuid |  |  |
| rule_set_version | integer | yes |  |
| respondent_role | text | yes |  |
| waqf_label | text | yes |  |
| current_axis | text |  | `'P'::text` |
| started_at | timestamp with time zone |  | `now()` |
| completed_at | timestamp with time zone | yes |  |
| reviewed_by | uuid | yes |  |
| reviewed_at | timestamp with time zone | yes |  |
| review_notes | text | yes |  |
| superseded_by | uuid | yes |  |
| updated_at | timestamp with time zone |  | `now()` |

### public.assets

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| category | asset_category |  |  |
| subject | asset_subject |  | `'corpus'::asset_subject` |
| title | text |  |  |
| ownership_doc_no | text | yes |  |
| ownership_document_id | uuid | yes |  |
| in_waqf_name | boolean | yes |  |
| share_pct | numeric | yes |  |
| book_value | numeric | yes |  |
| market_value | numeric | yes |  |
| last_valuation_on | date | yes |  |
| valuer | text | yes |  |
| status | asset_status |  | `'income'::asset_status` |
| annual_income | numeric | yes |  |
| acquired_on | date | yes |  |
| notes | text | yes |  |
| condition_id | uuid | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |
| archived_at | timestamp with time zone | yes |  |
| archive_reason | text | yes |  |

### public.attendance

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| meeting_id | uuid |  | → meetings |
| body_membership_id | uuid |  |  |
| waqf_id | uuid |  |  |
| status | text |  | `'invited'::text` |
| mode | text | yes |  |
| recorded_at | timestamp with time zone | yes |  |

### public.audit_logs

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | bigint |  | `nextval('audit_logs_id_seq'::regclass)` |
| at | timestamp with time zone |  | `now()` |
| actor_user_id | uuid | yes |  |
| actor_label | text | yes |  |
| action | text |  |  |
| entity_type | text |  |  |
| entity_id | text | yes |  |
| waqf_id | uuid | yes |  |
| ip | text | yes |  |
| user_agent | text | yes |  |
| before | jsonb | yes |  |
| after | jsonb | yes |  |
| prev_hash | text | yes |  |
| hash | text |  |  |

### public.axis_scores

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| assessment_id | uuid |  | → assessments |
| axis_code | text |  |  |
| waqf_id | uuid | yes |  |
| score | numeric | yes |  |
| capped | boolean |  | `false` |
| applicable_count | integer |  |  |
| answered_count | integer |  |  |

### public.bank_accounts

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| bank_name | text |  |  |
| iban_enc | text |  |  |
| iban_last4 | text |  |  |
| in_waqf_name | boolean |  |  |
| purpose | text |  | `'general'::text` |
| opened_on | date | yes |  |
| status | text |  | `'active'::text` |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.beneficial_owners

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| subject_type | text |  | `'person'::text` |
| role | text |  |  |
| full_name | text |  |  |
| nationality | text | yes |  |
| birth_date | date | yes |  |
| birth_place | text | yes |  |
| address_enc | text | yes |  |
| contact | text | yes |  |
| id_type | text | yes |  |
| id_number_enc | text | yes |  |
| id_number_hash | text | yes |  |
| acquired_on | date | yes |  |
| bank_details_enc | text | yes |  |
| relation_to_waqf | text | yes |  |
| entitlement_desc | text | yes |  |
| legal_form | text | yes |  |
| national_address | text | yes |  |
| directors | jsonb | yes |  |
| powers | text | yes |  |
| resides_in_ksa | boolean | yes |  |
| verified_on | date | yes |  |
| verification_source | text | yes |  |
| risk_level | text |  | `'standard'::text` |
| next_verification_due | date | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |
| archived_at | timestamp with time zone | yes |  |
| archive_reason | text | yes |  |

### public.beneficiaries

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| class_id | uuid | yes | → beneficiary_classes |
| person_id | uuid | yes |  |
| organization_id | uuid | yes |  |
| display_name | text |  |  |
| user_id | uuid | yes |  |
| status | text |  | `'active'::text` |
| entitlement_share | numeric | yes |  |
| resides_abroad | boolean |  | `false` |
| generation | integer | yes |  |
| parent_beneficiary_id | uuid | yes |  |
| last_verified_on | date | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |
| archived_at | timestamp with time zone | yes |  |
| archive_reason | text | yes |  |

### public.beneficiary_classes

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| name | text |  |  |
| kind | text |  |  |
| specified_by | text |  | `'description'::text` |
| tier | integer |  | `1` |
| position | integer |  | `0` |
| relation | text |  | `'and'::text` |
| share_pct | numeric | yes |  |
| criteria | jsonb | yes |  |
| division_rule | text | yes |  |
| substitution_rule | text | yes |  |
| end_tier | text | yes |  |
| alternate_masraf | text | yes |  |
| is_final_destination | boolean |  | `false` |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.bodies

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| kind | text |  |  |
| name | text |  |  |
| charter | text | yes |  |
| parent_body_id | uuid | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.body_memberships

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| body_id | uuid |  | → bodies |
| waqf_id | uuid |  |  |
| user_id | uuid | yes |  |
| person_name | text |  |  |
| role | text |  | `'member'::text` |
| is_independent | boolean |  | `false` |
| has_vote | boolean |  | `true` |
| starts_on | date | yes |  |
| ends_on | date | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.break_glass_access

RLS: enabled — bga_own_insert (INSERT), bga_own_select (SELECT), waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| user_id | uuid |  | → users |
| waqf_id | uuid |  |  |
| reason | text |  |  |
| status | text |  | `'requested'::text` |
| approved_by | uuid | yes |  |
| approved_at | timestamp with time zone | yes |  |
| expires_at | timestamp with time zone | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |

### public.budgets

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| fiscal_year | integer |  |  |
| status | text |  | `'draft'::text` |
| total_revenue | numeric | yes |  |
| total_expense | numeric | yes |  |
| lines | jsonb | yes |  |
| approved_by_resolution_id | uuid | yes |  |
| approved_on | date | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.complaints

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| number | text |  |  |
| raised_by_user_id | uuid |  |  |
| beneficiary_id | uuid | yes |  |
| kind | text |  |  |
| subject | text |  |  |
| body | text |  |  |
| status | text |  | `'open'::text` |
| sla_due_at | timestamp with time zone |  |  |
| response | text | yes |  |
| responded_at | timestamp with time zone | yes |  |
| responded_by | uuid | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.compliance_change_log

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| entity_type | text |  |  |
| entity_id | uuid |  |  |
| change | jsonb |  |  |
| actor_user_id | uuid | yes |  |
| at | timestamp with time zone |  | `now()` |
| is_active | boolean |  | `true` |

### public.condition_interpretations

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| condition_id | uuid |  | → conditions |
| waqf_id | uuid |  |  |
| text | text |  |  |
| source | text |  |  |
| signed_by | text | yes |  |
| document_id | uuid | yes |  |
| decided_on | date | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.conditions

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| category | condition_category |  |  |
| clause_ref | text | yes |  |
| literal_text | text |  |  |
| interpretation | text | yes |  |
| interpretation_source | text | yes |  |
| sharia_review | sharia_review |  | `'not_reviewed'::sharia_review` |
| position | integer |  | `0` |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.conflict_declarations

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| user_id | uuid |  |  |
| meeting_id | uuid | yes |  |
| agenda_item_id | uuid | yes |  |
| kind | text |  |  |
| relation_degree | integer | yes |  |
| description | text | yes |  |
| action | text |  | `'recuse'::text` |
| is_annual | boolean |  | `false` |
| year | integer | yes |  |
| disclosed_to_gaa_on | date | yes |  |
| declared_at | timestamp with time zone |  | `now()` |

### public.consents

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| user_id | uuid |  |  |
| kind | text |  |  |
| version | text |  |  |
| granted | boolean |  |  |
| ip | text | yes |  |
| at | timestamp with time zone |  | `now()` |

### public.contact_messages

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| name | text |  |  |
| phone | text | yes |  |
| email | text | yes |  |
| topic | text |  |  |
| body | text |  |  |
| status | text |  | `'new'::text` |
| handled_by | uuid | yes |  |
| created_at | timestamp with time zone |  | `now()` |

### public.content_items

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| kind | text |  |  |
| slug | text |  |  |
| title_ar | text |  |  |
| summary | text | yes |  |
| body_md | text |  |  |
| audience | jsonb |  | `'[]'::jsonb` |
| topic | text | yes |  |
| status | publish_status |  | `'draft'::publish_status` |
| reviewer_specialty | text | yes |  |
| reviewed_by | uuid | yes |  |
| reviewed_at | timestamp with time zone | yes |  |
| published_at | timestamp with time zone | yes |  |
| last_verified_at | date | yes |  |
| source_refs | jsonb |  | `'[]'::jsonb` |
| seo_title | text | yes |  |
| seo_description | text | yes |  |
| reading_minutes | integer | yes |  |
| requires_login | boolean |  | `false` |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.content_reviews

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| content_id | uuid |  | → content_items |
| reviewer_id | uuid |  |  |
| specialty | text |  |  |
| decision | text |  |  |
| notes | text | yes |  |
| at | timestamp with time zone |  | `now()` |

### public.contract_signatures

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| contract_id | uuid |  | → contracts |
| user_id | uuid |  |  |
| signed_at | timestamp with time zone |  | `now()` |
| method | text |  | `'otp_consent'::text` |
| otp_challenge_id | uuid | yes |  |
| ip | text | yes |  |
| user_agent | text | yes |  |
| content_hash | text |  |  |

### public.contract_templates

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| code | text |  |  |
| kind | text |  |  |
| name_ar | text |  |  |
| body | text |  |  |
| version | integer |  | `1` |
| is_active | boolean |  | `true` |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.contracts

RLS: enabled — nullwaqf_owner (ALL), waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| number | text |  |  |
| kind | text |  |  |
| template_code | text |  |  |
| template_version | integer |  |  |
| request_id | uuid | yes |  |
| waqf_id | uuid | yes |  |
| party_user_id | uuid |  |  |
| body | text |  |  |
| content_hash | text |  |  |
| amount | numeric | yes |  |
| status | text |  | `'sent'::text` |
| signed_at | timestamp with time zone | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.conversations

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid | yes |  |
| request_id | uuid | yes |  |
| subject | text |  |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.critical_flag_defs

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| code | text |  |  |
| title_ar | text |  |  |
| reference_text | text |  |  |
| penalty_text | text | yes |  |
| penalty_code | text | yes |  |
| axis_code | text | yes |  |
| action_ar | text | yes |  |
| severity | severity |  | `'critical'::severity` |
| active | boolean |  | `true` |

### public.critical_flags

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| assessment_id | uuid |  | → assessments |
| flag_code | text |  |  |
| waqf_id | uuid | yes |  |
| question_code | text | yes |  |
| evidence | text | yes |  |

### public.data_subject_requests

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| user_id | uuid |  |  |
| kind | text |  |  |
| status | text |  | `'received'::text` |
| details | text | yes |  |
| result_document_id | uuid | yes |  |
| retained_data_note | text | yes |  |
| requested_at | timestamp with time zone |  | `now()` |
| due_at | timestamp with time zone | yes |  |
| completed_at | timestamp with time zone | yes |  |

### public.deed_versions

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| deed_id | uuid |  | → waqf_deeds |
| waqf_id | uuid |  |  |
| version | integer |  |  |
| body | text | yes |  |
| structured | jsonb | yes |  |
| document_id | uuid | yes |  |
| change_note | text | yes |  |
| approval_id | uuid | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.delegations

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  |  |
| agent_user_id | uuid |  | → users |
| principal_user_id | uuid | yes |  |
| principal_name | text | yes |  |
| power_of_attorney_no | text | yes |  |
| document_id | uuid | yes |  |
| scope | jsonb |  |  |
| includes_donations | boolean |  | `false` |
| includes_asset_disposal | boolean |  | `false` |
| valid_from | date |  |  |
| valid_to | date |  |  |
| status | text |  | `'pending_review'::text` |
| verified_by | uuid | yes |  |
| verified_at | timestamp with time zone | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.deliverables

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| request_id | uuid |  | → service_requests |
| waqf_id | uuid | yes |  |
| title | text |  |  |
| document_id | uuid | yes |  |
| version | integer |  | `1` |
| status | text |  | `'draft'::text` |
| signed_by | text | yes |  |
| submitted_at | timestamp with time zone | yes |  |
| approved_at | timestamp with time zone | yes |  |
| approved_by | uuid | yes |  |
| revision_note | text | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.devices

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| user_id | uuid |  | → users |
| label | text | yes |  |
| fingerprint_hash | text |  |  |
| trusted | boolean |  | `false` |
| first_seen_at | timestamp with time zone |  | `now()` |
| last_seen_at | timestamp with time zone |  | `now()` |

### public.discounts

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| code | text |  |  |
| kind | text |  |  |
| value | numeric |  |  |
| valid_from | date | yes |  |
| valid_to | date | yes |  |
| applies_to | jsonb |  | `'{}'::jsonb` |
| max_uses | integer | yes |  |
| uses | integer |  | `0` |
| is_active | boolean |  | `true` |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.distribution_lines

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| distribution_id | uuid |  | → distributions |
| waqf_id | uuid |  |  |
| beneficiary_id | uuid |  | → beneficiaries |
| amount | numeric |  |  |
| reference_no | text |  |  |
| status | text |  | `'pending'::text` |
| paid_on | date | yes |  |
| proof_document_id | uuid | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.distributions

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| period | text |  |  |
| total_amount | numeric |  |  |
| status | text |  | `'planned'::text` |
| due_by | date | yes |  |
| paid_on | date | yes |  |
| bank_account_id | uuid | yes |  |
| condition_id | uuid | yes |  |
| resolution_id | uuid | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.document_access_log

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| document_id | uuid |  |  |
| version_id | uuid | yes |  |
| waqf_id | uuid | yes |  |
| user_id | uuid | yes |  |
| action | text |  |  |
| ip | text | yes |  |
| at | timestamp with time zone |  | `now()` |

### public.document_links

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| document_id | uuid |  | → documents |
| entity_type | text |  |  |
| entity_id | uuid |  |  |
| waqf_id | uuid | yes |  |

### public.document_shares

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| document_id | uuid |  | → documents |
| waqf_id | uuid | yes |  |
| token_hash | text |  |  |
| created_by | uuid |  |  |
| expires_at | timestamp with time zone |  |  |
| max_uses | integer |  | `5` |
| uses | integer |  | `0` |
| revoked_at | timestamp with time zone | yes |  |
| created_at | timestamp with time zone |  | `now()` |

### public.document_versions

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| document_id | uuid |  | → documents |
| waqf_id | uuid | yes |  |
| version | integer |  |  |
| storage_key | text |  |  |
| sha256 | text |  |  |
| size_bytes | bigint |  |  |
| mime_type | text |  |  |
| original_name | text |  |  |
| encrypted | boolean |  | `true` |
| iv | text | yes |  |
| auth_tag | text | yes |  |
| scan_status | scan_status |  | `'pending'::scan_status` |
| scan_detail | text | yes |  |
| uploaded_by | uuid |  |  |
| uploaded_at | timestamp with time zone |  | `now()` |
| change_note | text | yes |  |

### public.documents

RLS: enabled — nullwaqf_owner (ALL), waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid | yes |  |
| owner_user_id | uuid |  |  |
| request_id | uuid | yes |  |
| doc_type | text |  |  |
| title | text |  |  |
| number | text | yes |  |
| issuer | text | yes |  |
| issued_on | date | yes |  |
| issued_on_hijri | text | yes |  |
| expires_on | date | yes |  |
| confidentiality | doc_confidentiality |  | `'internal'::doc_confidentiality` |
| status | doc_status |  | `'quarantine'::doc_status` |
| approval_status | doc_approval |  | `'none'::doc_approval` |
| current_version | integer |  | `1` |
| retention_until | date | yes |  |
| tags | jsonb |  | `'[]'::jsonb` |
| search_text | text | yes |  |
| ai_suggested_type | text | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |
| archived_at | timestamp with time zone | yes |  |

### public.encumbrances

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| asset_id | uuid |  | → assets |
| waqf_id | uuid |  |  |
| kind | text |  |  |
| details | text | yes |  |
| since | date | yes |  |
| resolved_on | date | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.entitlements

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  |  |
| beneficiary_id | uuid |  | → beneficiaries |
| period | text |  |  |
| amount | numeric |  |  |
| basis | text | yes |  |
| expected_pay_on | date | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.extracted_fields

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| document_id | uuid |  | → documents |
| waqf_id | uuid | yes |  |
| field | text |  |  |
| value | text | yes |  |
| page | integer | yes |  |
| confidence | numeric | yes |  |
| status | text |  | `'extracted'::text` |
| reviewed_by | uuid | yes |  |
| reviewed_at | timestamp with time zone | yes |  |
| source | text |  | `'ai'::text` |
| created_at | timestamp with time zone |  | `now()` |

### public.facts

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| assessment_id | uuid |  | → assessments |
| key | text |  |  |
| value | jsonb | yes |  |
| source | text |  |  |

### public.faqs

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| question | text |  |  |
| answer | text |  |  |
| audience | text |  | `'all'::text` |
| topic | text |  |  |
| position | integer |  | `0` |
| status | publish_status |  | `'published'::publish_status` |
| source | text | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.feature_flags

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| key | text |  |  |
| enabled | boolean |  | `false` |
| description | text |  |  |
| reason | text | yes |  |
| updated_by | uuid | yes |  |
| updated_at | timestamp with time zone |  | `now()` |

### public.financial_statements

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| fiscal_year | integer |  |  |
| kind | text |  |  |
| status | text |  | `'draft'::text` |
| auditor_name | text | yes |  |
| auditor_license | text | yes |  |
| auditor_independent | boolean | yes |  |
| opinion | text | yes |  |
| total_revenue | numeric | yes |  |
| total_expense | numeric | yes |  |
| document_id | uuid | yes |  |
| submitted_to_gaa_on | date | yes |  |
| shared_with_beneficiaries | boolean |  | `false` |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.founders

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| person_id | uuid | yes |  |
| organization_id | uuid | yes |  |
| display_name | text |  |  |
| is_alive | boolean |  | `true` |
| nationality | text | yes |  |
| powers | jsonb | yes |  |
| user_id | uuid | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.glossary_terms

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| slug | text |  |  |
| term | text |  |  |
| definition | text |  |  |
| synonyms | jsonb |  | `'[]'::jsonb` |
| related | jsonb |  | `'[]'::jsonb` |
| source | text | yes |  |
| status | publish_status |  | `'published'::publish_status` |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.holidays

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| day | date |  |  |
| name | text |  |  |

### public.investment_policies

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| version | integer |  | `1` |
| target_return_pct | numeric | yes |  |
| risk_tolerance | text | yes |  |
| allocation | jsonb | yes |  |
| prohibited | text | yes |  |
| leverage_policy | text | yes |  |
| status | text |  | `'draft'::text` |
| approved_by_resolution_id | uuid | yes |  |
| review_due | date | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.investments

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| asset_id | uuid |  | → assets |
| waqf_id | uuid |  |  |
| instrument_type | text |  |  |
| issuer_name | text | yes |  |
| quantity | numeric | yes |  |
| cost_basis | numeric | yes |  |
| bonus_shares_treatment | text | yes |  |
| manager_name | text | yes |  |
| manager_cma_license | text | yes |  |
| custody_account | text | yes |  |
| management_agreement_doc_id | uuid | yes |  |
| fee_pct | numeric | yes |  |
| benchmark | text | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.invitations

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  |  |
| phone | text |  |  |
| role_key | text |  |  |
| token_hash | text |  |  |
| invited_by | uuid |  |  |
| expires_at | timestamp with time zone |  |  |
| accepted_at | timestamp with time zone | yes |  |
| accepted_by | uuid | yes |  |
| revoked_at | timestamp with time zone | yes |  |
| scope | jsonb | yes |  |
| note | text | yes |  |
| created_at | timestamp with time zone |  | `now()` |

### public.invoices

RLS: enabled — nullwaqf_owner (ALL), waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| number | text |  |  |
| user_id | uuid |  |  |
| waqf_id | uuid | yes |  |
| billed_to_name | text |  |  |
| request_id | uuid | yes |  |
| subscription_id | uuid | yes |  |
| contract_id | uuid | yes |  |
| subtotal | numeric |  |  |
| discount | numeric |  | `'0'::numeric` |
| vat_rate | numeric |  | `'15'::numeric` |
| vat | numeric |  |  |
| total | numeric |  |  |
| currency | text |  | `'SAR'::text` |
| status | text |  | `'issued'::text` |
| issued_on | date |  |  |
| due_on | date | yes |  |
| paid_on | date | yes |  |
| einvoice_uuid | text | yes |  |
| einvoice_status | text |  | `'pending_integration'::text` |
| lines | jsonb |  |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.job_runs

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| job | text |  |  |
| started_at | timestamp with time zone |  | `now()` |
| finished_at | timestamp with time zone | yes |  |
| status | text |  | `'running'::text` |
| detail | jsonb | yes |  |

### public.kyc_records

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| subject_type | text |  |  |
| subject_id | uuid |  |  |
| status | text |  | `'pending'::text` |
| risk_level | text |  | `'standard'::text` |
| is_pep | boolean |  | `false` |
| source_of_funds | text | yes |  |
| reviewed_by | uuid | yes |  |
| reviewed_at | timestamp with time zone | yes |  |
| next_review_at | date | yes |  |
| notes | text | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.leases

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| asset_id | uuid |  | → assets |
| waqf_id | uuid |  |  |
| tenant_name | text |  |  |
| ejar_contract_no | text | yes |  |
| starts_on | date | yes |  |
| ends_on | date | yes |  |
| annual_rent | numeric | yes |  |
| collected_to_date | numeric | yes |  |
| arrears | numeric | yes |  |
| status | text |  | `'active'::text` |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.ledger_entries

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| entry_date | date |  |  |
| account_code | text |  |  |
| description | text |  |  |
| debit | numeric |  | `'0'::numeric` |
| credit | numeric |  | `'0'::numeric` |
| reference_no | text | yes |  |
| document_id | uuid | yes |  |
| condition_id | uuid | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.maintenance_plans

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| asset_id | uuid |  | → assets |
| waqf_id | uuid |  |  |
| item | text |  |  |
| frequency | text | yes |  |
| next_due_on | date | yes |  |
| estimated_cost | numeric | yes |  |
| status | text |  | `'planned'::text` |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.meetings

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| body_id | uuid | yes |  |
| kind | text |  | `'regular'::text` |
| title | text |  |  |
| scheduled_at | timestamp with time zone |  |  |
| location | text | yes |  |
| link | text | yes |  |
| status | meeting_status |  | `'scheduled'::meeting_status` |
| invitations_sent_at | timestamp with time zone | yes |  |
| quorum_required | integer | yes |  |
| quorum_met | boolean | yes |  |
| held_at | timestamp with time zone | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.messages

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| conversation_id | uuid |  | → conversations |
| waqf_id | uuid | yes |  |
| author_id | uuid |  |  |
| body | text |  |  |
| created_at | timestamp with time zone |  | `now()` |

### public.mfa_factors

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| user_id | uuid |  | → users |
| type | mfa_type |  |  |
| secret_enc | text |  |  |
| label | text | yes |  |
| verified_at | timestamp with time zone | yes |  |
| last_used_at | timestamp with time zone | yes |  |
| created_at | timestamp with time zone |  | `now()` |

### public.minute_signatures

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| minute_id | uuid |  | → minutes |
| user_id | uuid |  |  |
| waqf_id | uuid |  |  |
| signed_at | timestamp with time zone |  | `now()` |
| method | text |  | `'otp_consent'::text` |
| content_hash | text |  |  |

### public.minutes

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| meeting_id | uuid |  | → meetings |
| waqf_id | uuid |  |  |
| version | integer |  | `1` |
| body | text |  |  |
| status | minutes_status |  | `'draft'::minutes_status` |
| prepared_by | uuid | yes |  |
| circulated_at | timestamp with time zone | yes |  |
| approved_at | timestamp with time zone | yes |  |
| locked_at | timestamp with time zone | yes |  |
| content_hash | text | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.nazara_engagements

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| number | text |  |  |
| waqf_id | uuid |  | → waqfs |
| request_id | uuid | yes |  |
| status | text |  | `'intake'::text` |
| is_practice | boolean |  | `false` |
| lead_user_id | uuid | yes |  |
| checklist | jsonb |  | `'[]'::jsonb` |
| intake_notes | text | yes |  |
| decision | text | yes |  |
| decision_reason | text | yes |  |
| decided_by | uuid | yes |  |
| decided_at | timestamp with time zone | yes |  |
| appointment_decision_no | text | yes |  |
| appointment_decision_date | date | yes |  |
| appointment_authority | authority_kind | yes |  |
| appointment_document_id | uuid | yes |  |
| powers | text | yes |  |
| fee_terms | text | yes |  |
| responsibilities | text | yes |  |
| trustee_id | uuid | yes |  |
| started_on | date | yes |  |
| activated_by | uuid | yes |  |
| end_reason | text | yes |  |
| end_note | text | yes |  |
| ended_on | date | yes |  |
| successor_name | text | yes |  |
| handover | jsonb |  | `'[]'::jsonb` |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.nazara_events

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| engagement_id | uuid |  | → nazara_engagements |
| waqf_id | uuid |  |  |
| action | text |  |  |
| from_status | text | yes |  |
| to_status | text | yes |  |
| note | text | yes |  |
| actor_user_id | uuid | yes |  |
| at | timestamp with time zone |  | `now()` |

### public.nazara_team

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| engagement_id | uuid |  | → nazara_engagements |
| waqf_id | uuid |  |  |
| user_id | uuid |  |  |
| team_role | text |  |  |
| membership_id | uuid | yes |  |
| added_by | uuid | yes |  |
| added_at | timestamp with time zone |  | `now()` |
| removed_at | timestamp with time zone | yes |  |
| removed_by | uuid | yes |  |

### public.needs

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| code | text |  |  |
| group_code | text |  |  |
| title_ar | text |  |  |
| description | text | yes |  |

### public.notification_preferences

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| user_id | uuid |  |  |
| type | text |  |  |
| in_app | boolean |  | `true` |
| email | boolean |  | `true` |
| sms | boolean |  | `false` |

### public.notification_templates

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| key | text |  |  |
| title_ar | text |  |  |
| body_ar | text |  |  |
| severity | notif_severity |  | `'info'::notif_severity` |
| channels | jsonb |  | `'["in_app"]'::jsonb` |
| locked | boolean |  | `false` |
| updated_at | timestamp with time zone |  | `now()` |

### public.notifications

RLS: enabled — notif_owner_del (DELETE), notif_owner_sel (SELECT), notif_owner_upd (UPDATE), waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| user_id | uuid |  |  |
| waqf_id | uuid | yes |  |
| type | text |  |  |
| severity | notif_severity |  | `'info'::notif_severity` |
| title_ar | text |  |  |
| body_ar | text | yes |  |
| link | text | yes |  |
| read_at | timestamp with time zone | yes |  |
| created_at | timestamp with time zone |  | `now()` |

### public.obligation_events

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| instance_id | uuid |  | → obligation_instances |
| waqf_id | uuid |  |  |
| action | text |  |  |
| note | text | yes |  |
| actor_user_id | uuid | yes |  |
| at | timestamp with time zone |  | `now()` |

### public.obligation_instances

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| obligation_id | uuid |  | → obligations |
| trigger_event_id | uuid | yes |  |
| trigger_date | date | yes |  |
| period_key | text | yes |  |
| due_on | date | yes |  |
| due_immediately | boolean |  | `false` |
| status | obligation_status |  | `'upcoming'::obligation_status` |
| assignee_user_id | uuid | yes |  |
| evidence_document_id | uuid | yes |  |
| completed_at | timestamp with time zone | yes |  |
| completed_by | uuid | yes |  |
| waived_reason | text | yes |  |
| last_reminder_at | timestamp with time zone | yes |  |
| reminders_sent | jsonb |  | `'[]'::jsonb` |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.obligations

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| code | text |  |  |
| title_ar | text |  |  |
| description | text | yes |  |
| requirement_id | uuid | yes | → regulatory_requirements |
| reference_text | text |  |  |
| authority | authority_kind |  |  |
| obligation_type | text |  |  |
| trigger_event | text |  |  |
| offset_value | integer | yes |  |
| offset_unit | text |  |  |
| recurrence | text |  | `'none'::text` |
| applies_to | jsonb |  | `'{}'::jsonb` |
| severity | severity |  | `'medium'::severity` |
| required_action | text |  |  |
| evidence_required | text | yes |  |
| penalty_code | text | yes |  |
| default_assignee_role | text |  | `'nazir'::text` |
| reminder_offsets_days | jsonb |  | `'[30, 7, 1]'::jsonb` |
| status | publish_status |  | `'published'::publish_status` |
| verification_status | verification_status |  | `'verified'::verification_status` |
| version | integer |  | `1` |
| notes | text | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.organization_members

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| organization_id | uuid |  | → organizations |
| user_id | uuid |  |  |
| role | text |  |  |
| authority_document_id | uuid | yes |  |
| created_at | timestamp with time zone |  | `now()` |

### public.organizations

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| name | text |  |  |
| legal_form | text | yes |  |
| cr_number | text | yes |  |
| unified_number | text | yes |  |
| national_address | text | yes |  |
| is_nonprofit | boolean |  | `false` |
| kind | text |  | `'client'::text` |
| license_no | text | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.otp_challenges

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| target | text |  |  |
| purpose | otp_purpose |  |  |
| code_hash | text |  |  |
| attempts | integer |  | `0` |
| max_attempts | integer |  | `5` |
| expires_at | timestamp with time zone |  |  |
| consumed_at | timestamp with time zone | yes |  |
| ip | text | yes |  |
| context | jsonb | yes |  |
| created_at | timestamp with time zone |  | `now()` |

### public.outbox_messages

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | bigint |  | `nextval('outbox_messages_id_seq'::regcla` |
| channel | channel |  |  |
| to_address | text |  |  |
| subject | text | yes |  |
| body | text |  |  |
| status | outbox_status |  | `'queued'::outbox_status` |
| attempts | integer |  | `0` |
| provider | text | yes |  |
| provider_ref | text | yes |  |
| error | text | yes |  |
| sent_at | timestamp with time zone | yes |  |
| created_at | timestamp with time zone |  | `now()` |

### public.package_items

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| package_id | uuid |  | → packages |
| service_id | uuid |  | → services |
| note | text | yes |  |

### public.packages

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| code | text |  |  |
| name_ar | text |  |  |
| description | text | yes |  |
| audience | text | yes |  |
| target_size_classes | jsonb |  | `'[]'::jsonb` |
| monthly_price | numeric | yes |  |
| annual_price | numeric | yes |  |
| terms_ar | text | yes |  |
| is_active | boolean |  | `true` |
| is_closed | boolean |  | `false` |
| position | integer |  | `0` |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.payments

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| invoice_id | uuid |  | → invoices |
| user_id | uuid |  |  |
| provider | text |  |  |
| provider_ref | text | yes |  |
| method | text | yes |  |
| amount | numeric |  |  |
| status | text |  | `'initiated'::text` |
| paid_at | timestamp with time zone | yes |  |
| raw | jsonb | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.penalty_schedule

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| code | text |  |  |
| category | text |  |  |
| title_ar | text |  |  |
| large_text | text | yes |  |
| medium_text | text | yes |  |
| small_text | text | yes |  |
| dismissal_risk | text |  | `'no'::text` |
| max_fine | integer | yes |  |
| verification_status | verification_status |  | `'pending_verification'::verification_sta` |
| notes | text | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.performance_reviews

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| subject_type | text |  |  |
| subject_name | text |  |  |
| year | integer |  |  |
| score | numeric | yes |  |
| notes | text | yes |  |
| document_id | uuid | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.permissions

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| key | text |  |  |
| name_ar | text |  |  |
| domain | text |  |  |

### public.persons

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| full_name | text |  |  |
| id_type | id_type | yes |  |
| national_id_enc | text | yes |  |
| national_id_hash | text | yes |  |
| nationality | text | yes |  |
| birth_date | date | yes |  |
| birth_place | text | yes |  |
| is_alive | boolean |  | `true` |
| death_date | date | yes |  |
| residence_country | text | yes |  |
| address_enc | text | yes |  |
| phone | text | yes |  |
| email | text | yes |  |
| user_id | uuid | yes |  |
| is_minor | boolean |  | `false` |
| guardian_person_id | uuid | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.policies

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| policy_type | text |  |  |
| title | text |  |  |
| version | integer |  | `1` |
| status | text |  | `'draft'::text` |
| approved_by_resolution_id | uuid | yes |  |
| approved_on | date | yes |  |
| review_due | date | yes |  |
| document_id | uuid | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.portfolios

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| account_no | text | yes |  |
| custodian | text | yes |  |
| manager_name | text | yes |  |
| manager_cma_license | text | yes |  |
| strategy | text | yes |  |
| risk_level | text | yes |  |
| waqf_deed_on | date | yes |  |
| registered_with_gaa_on | date | yes |  |
| account_opened_on | date | yes |  |
| recorded_with_gaa_on | date | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.price_change_log

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| entity_type | text |  |  |
| entity_id | uuid |  |  |
| field | text |  |  |
| old_value | text | yes |  |
| new_value | text | yes |  |
| actor_user_id | uuid | yes |  |
| at | timestamp with time zone |  | `now()` |

### public.projects

RLS: enabled — nullwaqf_owner (ALL), waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid | yes |  |
| request_id | uuid | yes |  |
| name | text |  |  |
| status | text |  | `'active'::text` |
| start_on | date | yes |  |
| end_on | date | yes |  |
| owner_user_id | uuid | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.properties

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| asset_id | uuid |  | → assets |
| waqf_id | uuid |  |  |
| deed_no | text | yes |  |
| city | text | yes |  |
| district | text | yes |  |
| lat | double precision | yes |  |
| lng | double precision | yes |  |
| usage | text | yes |  |
| area_sqm | numeric | yes |  |
| units_count | integer | yes |  |
| occupied_units | integer | yes |  |
| technical_condition | text | yes |  |
| annual_maintenance_cost | numeric | yes |  |
| maintenance_reserve | numeric | yes |  |
| estimated_rent | numeric | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.question_bank_versions

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| version | integer |  |  |
| status | publish_status |  | `'draft'::publish_status` |
| notes | text | yes |  |
| published_at | timestamp with time zone | yes |  |
| published_by | uuid | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.rate_limits

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| key | text |  |  |
| window_start | timestamp with time zone |  |  |
| count | integer |  | `0` |

### public.recommendation_rules

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| code | text |  |  |
| version | integer |  | `1` |
| status | publish_status |  | `'draft'::publish_status` |
| title_ar | text |  |  |
| condition | jsonb |  |  |
| need_code | text |  |  |
| severity | severity |  |  |
| urgency_days | integer |  | `90` |
| leverage | numeric |  | `'1'::numeric` |
| reason_ar | text |  |  |
| why_it_matters_ar | text | yes |  |
| reference | text | yes |  |
| service_codes | jsonb |  | `'[]'::jsonb` |
| suppress_if | jsonb | yes |  |
| self_service_hint_ar | text | yes |  |
| reviewed_by | uuid | yes |  |
| reviewed_at | timestamp with time zone | yes |  |
| published_at | timestamp with time zone | yes |  |
| times_fired | integer |  | `0` |
| times_converted | integer |  | `0` |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.recommendations

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| assessment_id | uuid |  | → assessments |
| waqf_id | uuid | yes |  |
| rule_id | uuid |  |  |
| rule_code | text |  |  |
| rule_version | integer |  |  |
| need_code | text |  |  |
| severity | severity |  |  |
| priority | numeric |  |  |
| wave | integer |  |  |
| title_ar | text |  |  |
| reason_ar | text |  |  |
| why_it_matters_ar | text | yes |  |
| reference | text | yes |  |
| service_codes | jsonb |  | `'[]'::jsonb` |
| self_service_hint_ar | text | yes |  |
| status | rec_status |  | `'open'::rec_status` |
| suppressed_note | text | yes |  |
| dismiss_reason | text | yes |  |
| service_request_id | uuid | yes |  |
| created_at | timestamp with time zone |  | `now()` |

### public.recovery_codes

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| user_id | uuid |  | → users |
| code_hash | text |  |  |
| used_at | timestamp with time zone | yes |  |
| created_at | timestamp with time zone |  | `now()` |

### public.regulatory_references

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| code | text |  |  |
| source_name | text |  |  |
| issuer | text | yes |  |
| decision_ref | text | yes |  |
| binding_level | binding_level |  |  |
| source_url | text | yes |  |
| verification_status | verification_status |  | `'pending_verification'::verification_sta` |
| last_verified_on | date | yes |  |
| superseded_by | text | yes |  |
| notes | text | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.regulatory_requirements

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| code | text |  |  |
| reference_id | uuid | yes | → regulatory_references |
| article | text | yes |  |
| title | text |  |  |
| description | text | yes |  |
| implemented_as | jsonb |  | `'[]'::jsonb` |
| feature_area | text | yes |  |
| status | text |  | `'implemented'::text` |
| verification_status | verification_status |  | `'verified'::verification_status` |
| exclusion_reason | text | yes |  |
| notes | text | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.report_shares

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| report_id | uuid |  | → reports |
| waqf_id | uuid | yes |  |
| token_hash | text |  |  |
| created_by | uuid |  |  |
| expires_at | timestamp with time zone |  |  |
| revoked_at | timestamp with time zone | yes |  |
| views | integer |  | `0` |
| created_at | timestamp with time zone |  | `now()` |

### public.reports

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| number | text |  |  |
| waqf_id | uuid | yes |  |
| kind | text |  |  |
| title | text |  |  |
| assessment_id | uuid | yes |  |
| verification_code | text |  |  |
| document_id | uuid | yes |  |
| snapshot | jsonb | yes |  |
| generated_by | uuid | yes |  |
| generated_at | timestamp with time zone |  | `now()` |
| revoked_at | timestamp with time zone | yes |  |
| status | text |  | `'final'::text` |
| approved_by | uuid | yes |  |
| approved_at | timestamp with time zone | yes |  |

### public.request_events

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| request_id | uuid |  | → service_requests |
| waqf_id | uuid | yes |  |
| from_status | text | yes |  |
| to_status | text | yes |  |
| note | text | yes |  |
| actor_user_id | uuid | yes |  |
| at | timestamp with time zone |  | `now()` |

### public.request_notes

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| request_id | uuid |  | → service_requests |
| waqf_id | uuid | yes |  |
| author_id | uuid |  |  |
| visibility | text |  | `'client'::text` |
| body | text |  |  |
| created_at | timestamp with time zone |  | `now()` |

### public.request_stages

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| request_id | uuid |  | → service_requests |
| waqf_id | uuid | yes |  |
| stage_key | text |  |  |
| name | text |  |  |
| position | integer |  |  |
| status | text |  | `'pending'::text` |
| sla_due_at | timestamp with time zone | yes |  |
| started_at | timestamp with time zone | yes |  |
| completed_at | timestamp with time zone | yes |  |
| completed_by | uuid | yes |  |

### public.resolutions

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| meeting_id | uuid | yes |  |
| agenda_item_id | uuid | yes |  |
| number | text |  |  |
| text | text |  |  |
| category | text |  |  |
| requires_external_approval | boolean |  | `false` |
| approval_id | uuid | yes |  |
| condition_id | uuid | yes |  |
| expected_impact | text | yes |  |
| risks | text | yes |  |
| status | resolution_status |  | `'draft'::resolution_status` |
| votes_for | integer |  | `0` |
| votes_against | integer |  | `0` |
| votes_abstain | integer |  | `0` |
| votes_recused | integer |  | `0` |
| decided_at | timestamp with time zone | yes |  |
| executed_at | timestamp with time zone | yes |  |
| review_note | text | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.revenue_allocations

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| waqf_id | uuid |  | → waqfs |
| maintenance_pct | numeric | yes |  |
| development_pct | numeric | yes |  |
| reinvest_pct | numeric | yes |  |
| reserve_pct | numeric | yes |  |
| nazir_fee_pct | numeric | yes |  |
| nazir_fee_fixed | numeric | yes |  |
| admin_pct | numeric | yes |  |
| notes | text | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.risk_register

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| title | text |  |  |
| category | text |  |  |
| impact | integer |  |  |
| likelihood | integer |  |  |
| treatment | text | yes |  |
| owner_user_id | uuid | yes |  |
| review_on | date | yes |  |
| status | text |  | `'open'::text` |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.role_permissions

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| role_id | uuid |  | → roles |
| permission_id | uuid |  | → permissions |

### public.roles

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| key | text |  |  |
| name_ar | text |  |  |
| scope | role_scope |  |  |
| description | text | yes |  |
| is_system | boolean |  | `true` |
| created_at | timestamp with time zone |  | `now()` |

### public.sequences

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| key | text |  |  |
| value | integer |  | `0` |

### public.service_categories

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| code | text |  |  |
| name_ar | text |  |  |
| description | text | yes |  |
| position | integer |  | `0` |

### public.service_prices

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| service_id | uuid |  | → services |
| size_class | text | yes |  |
| price | numeric |  |  |
| valid_from | date | yes |  |
| valid_to | date | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.service_requests

RLS: enabled — nullwaqf_owner (ALL), waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| number | text |  |  |
| service_id | uuid |  | → services |
| waqf_id | uuid | yes |  |
| requester_user_id | uuid |  |  |
| status | request_status |  | `'draft'::request_status` |
| priority | text |  | `'normal'::text` |
| source | text |  | `'manual'::text` |
| source_ref | uuid | yes |  |
| details | text | yes |  |
| intake | jsonb | yes |  |
| assigned_to_user_id | uuid | yes |  |
| department_key | text | yes |  |
| current_stage_key | text | yes |  |
| sla_due_at | timestamp with time zone | yes |  |
| quote_amount | numeric | yes |  |
| agreed_price | numeric | yes |  |
| conflict_check | text |  | `'pending'::text` |
| conflict_note | text | yes |  |
| hold_reason | text | yes |  |
| hold_party | text | yes |  |
| hold_follow_up_on | date | yes |  |
| cancel_reason | text | yes |  |
| reject_reason | text | yes |  |
| rating | integer | yes |  |
| rating_comment | text | yes |  |
| submitted_at | timestamp with time zone | yes |  |
| completed_at | timestamp with time zone | yes |  |
| closed_at | timestamp with time zone | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.services

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| code | text |  |  |
| category_id | uuid |  | → service_categories |
| name_ar | text |  |  |
| summary | text |  |  |
| description | text | yes |  |
| requirements | text | yes |  |
| required_documents | jsonb |  | `'[]'::jsonb` |
| outputs | text | yes |  |
| pricing_model | pricing_model |  |  |
| base_price | numeric | yes |  |
| currency | text |  | `'SAR'::text` |
| sla_days | integer | yes |  |
| department_key | text | yes |  |
| default_specialist_role | text | yes |  |
| regulatory_restrictions | text | yes |  |
| conflict_rule | text |  | `'none'::text` |
| requires_license_key | text | yes |  |
| workflow_template_code | text |  | `'standard'::text` |
| audiences | jsonb |  | `'[]'::jsonb` |
| stage | integer | yes |  |
| is_active | boolean |  | `true` |
| is_published | boolean |  | `true` |
| position | integer |  | `0` |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.sessions

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| user_id | uuid |  | → users |
| token_hash | text |  |  |
| mfa_verified | boolean |  | `false` |
| ip | text | yes |  |
| user_agent | text | yes |  |
| device_id | uuid | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| last_seen_at | timestamp with time zone |  | `now()` |
| idle_expires_at | timestamp with time zone |  |  |
| absolute_expires_at | timestamp with time zone |  |  |
| revoked_at | timestamp with time zone | yes |  |
| revoke_reason | text | yes |  |

### public.settings

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| key | text |  |  |
| value | jsonb |  |  |
| description | text | yes |  |
| updated_by | uuid | yes |  |
| updated_at | timestamp with time zone |  | `now()` |

### public.subscriptions

RLS: enabled — nullwaqf_owner (ALL), waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid | yes |  |
| user_id | uuid |  |  |
| package_id | uuid |  | → packages |
| billing_cycle | text |  | `'annual'::text` |
| price | numeric |  |  |
| status | text |  | `'pending_payment'::text` |
| starts_on | date | yes |  |
| renews_on | date | yes |  |
| cancelled_on | date | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.successions

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| rule_text | text |  |  |
| successor_name | text | yes |  |
| successor_person_id | uuid | yes |  |
| position | integer |  | `1` |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.task_comments

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| task_id | uuid |  | → tasks |
| waqf_id | uuid | yes |  |
| author_id | uuid |  |  |
| body | text |  |  |
| created_at | timestamp with time zone |  | `now()` |

### public.tasks

RLS: enabled — nullwaqf_owner (ALL), waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid | yes |  |
| request_id | uuid | yes |  |
| project_id | uuid | yes |  |
| source_type | text |  | `'manual'::text` |
| source_id | uuid | yes |  |
| title | text |  |  |
| description | text | yes |  |
| assignee_user_id | uuid | yes |  |
| due_on | date | yes |  |
| priority | text |  | `'normal'::text` |
| status | task_status |  | `'todo'::task_status` |
| checklist | jsonb |  | `'[]'::jsonb` |
| progress | integer |  | `0` |
| visibility | text |  | `'shared'::text` |
| completed_at | timestamp with time zone | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.trustee_appointments

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| trustee_id | uuid |  | → trustees |
| waqf_id | uuid |  |  |
| decision_no | text | yes |  |
| decision_date | date | yes |  |
| authority | authority_kind | yes |  |
| powers | text | yes |  |
| fees | text | yes |  |
| responsibilities | text | yes |  |
| document_id | uuid | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.trustees

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| kind | text |  |  |
| person_id | uuid | yes |  |
| organization_id | uuid | yes |  |
| display_name | text |  |  |
| user_id | uuid | yes |  |
| is_independent | boolean |  | `false` |
| is_chair | boolean |  | `false` |
| specialty | text | yes |  |
| license_no | text | yes |  |
| license_expires_on | date | yes |  |
| resides_in_ksa | boolean | yes |  |
| nationality | text | yes |  |
| starts_on | date | yes |  |
| ends_on | date | yes |  |
| status | text |  | `'active'::text` |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.user_roles

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| user_id | uuid |  | → users |
| role_id | uuid |  | → roles |
| granted_by | uuid | yes |  |
| granted_at | timestamp with time zone |  | `now()` |

### public.users

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| phone | text |  |  |
| email | text | yes |  |
| password_hash | text | yes |  |
| full_name | text | yes |  |
| id_type | id_type | yes |  |
| national_id_enc | text | yes |  |
| national_id_hash | text | yes |  |
| birth_date | date | yes |  |
| locale | text |  | `'ar'::text` |
| numeral_style | text |  | `'latn'::text` |
| calendar_pref | text |  | `'both'::text` |
| status | user_status |  | `'active'::user_status` |
| is_staff | boolean |  | `false` |
| mfa_enabled | boolean |  | `false` |
| phone_verified_at | timestamp with time zone | yes |  |
| email_verified_at | timestamp with time zone | yes |  |
| failed_login_count | integer |  | `0` |
| locked_until | timestamp with time zone | yes |  |
| last_login_at | timestamp with time zone | yes |  |
| deletion_requested_at | timestamp with time zone | yes |  |
| resides_in_ksa | boolean | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.valuations

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| asset_id | uuid |  | → assets |
| waqf_id | uuid |  |  |
| valuer | text |  |  |
| valuer_license | text | yes |  |
| method | text | yes |  |
| value | numeric |  |  |
| valued_on | date |  |  |
| document_id | uuid | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.violations

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| penalty_code | text |  |  |
| occurrence | integer |  | `1` |
| noticed_on | date |  |  |
| authority_ref | text | yes |  |
| sanction | text | yes |  |
| status | text |  | `'open'::text` |
| corrective_deadline | date | yes |  |
| document_id | uuid | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.votes

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| resolution_id | uuid |  | → resolutions |
| user_id | uuid |  |  |
| waqf_id | uuid |  |  |
| value | vote_value |  |  |
| reason | text | yes |  |
| cast_at | timestamp with time zone |  | `now()` |

### public.waqf_classifications

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| legal_type | waqf_legal_type | yes |  |
| computed_type | waqf_legal_type | yes |  |
| reason | text | yes |  |
| effective_from | date |  |  |
| decided_by | uuid | yes |  |
| created_at | timestamp with time zone |  | `now()` |

### public.waqf_deeds

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| deed_no | text | yes |  |
| issuer | text | yes |  |
| issued_on_hijri | text | yes |  |
| issued_on | date | yes |  |
| document_id | uuid | yes |  |
| status | text |  | `'draft'::text` |
| current_version | integer |  | `1` |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.waqf_exceptions

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| beneficiary_name | text |  |  |
| kind | text |  |  |
| duration | text |  |  |
| until_date | date | yes |  |
| quantity | text | yes |  |
| afterwards | text | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.waqf_governance_profiles

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| waqf_id | uuid |  | → waqfs |
| quorum_rule | text |  | `'majority'::text` |
| majority_rule | text |  | `'simple'::text` |
| meetings_per_year | integer |  | `4` |
| independent_ratio_target | numeric | yes |  |
| require_independent_for_quorum | boolean |  | `false` |
| reserved_decisions | jsonb |  | `'[]'::jsonb` |
| executive_spend_limit | numeric | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.waqf_keys

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| waqf_id | uuid |  |  |
| wrapped_key | text |  |  |
| key_version | integer |  | `1` |
| created_at | timestamp with time zone |  | `now()` |

### public.waqf_memberships

RLS: enabled — wm_delete (DELETE), wm_insert (INSERT), wm_select (SELECT), wm_update (UPDATE)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  |  |
| user_id | uuid |  | → users |
| role_key | text |  |  |
| is_independent | boolean |  | `false` |
| status | membership_status |  | `'active'::membership_status` |
| starts_at | timestamp with time zone |  | `now()` |
| ends_at | timestamp with time zone | yes |  |
| invited_by | uuid | yes |  |
| scope | jsonb | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.waqf_registrations

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| request_type | text |  |  |
| status | text |  | `'draft'::text` |
| cert_no | text | yes |  |
| submitted_on | date | yes |  |
| issued_on | date | yes |  |
| expires_on | date | yes |  |
| notes | text | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### public.waqf_timeline_events

RLS: enabled — waqf_isolation (ALL)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  | → waqfs |
| type | text |  |  |
| occurred_on | date |  |  |
| title | text |  |  |
| details | text | yes |  |
| document_id | uuid | yes |  |
| stage | integer | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |

### public.waqfs

RLS: enabled — waqf_delete (DELETE), waqf_insert (INSERT), waqf_select (SELECT), waqf_update (UPDATE)

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| internal_number | text |  |  |
| name | text |  |  |
| national_unified_number | text | yes |  |
| registration_cert_no | text | yes |  |
| registration_expires_on | date | yes |  |
| deed_no | text | yes |  |
| deed_issuer | text | yes |  |
| deed_date_hijri | text | yes |  |
| deed_date | date | yes |  |
| documented_on | date | yes |  |
| registered_on | date | yes |  |
| creation_mode | waqf_creation_mode |  | `'inter_vivos'::waqf_creation_mode` |
| legal_type | waqf_legal_type | yes |  |
| computed_type | waqf_legal_type | yes |  |
| computed_type_reason | text | yes |  |
| size_class | waqf_size_class | yes |  |
| size_class_locked | boolean |  | `false` |
| direct_benefit | boolean |  | `false` |
| assets_estimated_value | numeric | yes |  |
| field_of_work | text | yes |  |
| geographic_scope | text | yes |  |
| domicile | text | yes |  |
| fiscal_year_end | text |  | `'12-31'::text` |
| status | waqf_status |  | `'draft'::waqf_status` |
| nazir_mode | nazir_mode | yes |  |
| waqfak_role | waqfak_role |  | `'none'::waqfak_role` |
| founder_alive | boolean | yes |  |
| has_foreign_party | boolean |  | `false` |
| has_beneficiaries_abroad | boolean |  | `false` |
| collects_donations | boolean |  | `false` |
| has_active_litigation | boolean |  | `false` |
| stage | integer |  | `1` |
| organization_id | uuid | yes |  |
| is_demo | boolean |  | `false` |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |
| archived_at | timestamp with time zone | yes |  |
| archive_reason | text | yes |  |

### public.workflow_templates

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| code | text |  |  |
| name_ar | text |  |  |
| stages | jsonb |  |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
| created_by | uuid | yes |  |
| updated_by | uuid | yes |  |

### restricted.screening_results

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| subject_type | text |  |  |
| subject_id | uuid |  |  |
| provider | text |  |  |
| status | text |  |  |
| details_enc | text | yes |  |
| reviewed_by | uuid | yes |  |
| decision | text | yes |  |
| created_at | timestamp with time zone |  | `now()` |

### restricted.suspicion_reports

RLS: off

| Column | Type | Null | Default / FK |
|---|---|---|---|
| id | uuid |  | `gen_random_uuid()` |
| waqf_id | uuid |  |  |
| created_by | uuid |  |  |
| summary_enc | text |  |  |
| status | text |  | `'internal_review'::text` |
| reported_to_fiu_on | date | yes |  |
| fiu_reference_enc | text | yes |  |
| created_at | timestamp with time zone |  | `now()` |
| updated_at | timestamp with time zone |  | `now()` |
