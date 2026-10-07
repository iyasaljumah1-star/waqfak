import { pgEnum } from "drizzle-orm/pg-core";

export const userStatus = pgEnum("user_status", ["pending", "active", "locked", "deletion_requested", "deleted"]);
export const idType = pgEnum("id_type", ["national_id", "iqama", "passport", "gcc_id", "cr", "other"]);
export const roleScope = pgEnum("role_scope", ["global", "waqf"]);
export const membershipStatus = pgEnum("membership_status", ["invited", "active", "suspended", "ended"]);
export const otpPurpose = pgEnum("otp_purpose", ["signup", "login", "recover", "change_phone", "delete_account", "sign_contract", "step_up"]);
export const mfaType = pgEnum("mfa_type", ["totp", "passkey"]);

export const waqfLegalType = pgEnum("waqf_legal_type", ["public", "private", "joint"]);
export const waqfCreationMode = pgEnum("waqf_creation_mode", ["inter_vivos", "bequest"]);
export const waqfSizeClass = pgEnum("waqf_size_class", ["large", "medium", "small", "direct_benefit"]);
export const waqfStatus = pgEnum("waqf_status", ["idea", "draft", "documenting", "documented", "registered", "active", "suspended", "ended"]);
export const nazirMode = pgEnum("nazir_mode", ["founder", "individual", "board", "legal_entity", "gaa", "vacant"]);
export const waqfakRole = pgEnum("waqfak_role", ["none", "advisor", "delegated_manager", "nazir", "board_member", "bookkeeper"]);

export const conditionCategory = pgEnum("condition_category", ["asset", "revenue", "masraf", "nazara", "founder_self", "governance_finance"]);
export const shariaReview = pgEnum("sharia_review", ["not_reviewed", "approved", "needs_amendment", "possibly_void"]);
export const approvalKind = pgEnum("approval_kind", ["substitution", "mortgage", "condition_deviation", "interpretation", "nazir_fee", "donations", "merger", "long_lease", "other"]);
export const authorityKind = pgEnum("authority_kind", ["competent_authority", "gaa", "court", "cma", "fiu", "notary", "internal"]);
export const approvalStatus = pgEnum("approval_status", ["draft", "submitted", "granted", "rejected", "withdrawn"]);

export const assetCategory = pgEnum("asset_category", ["real_estate", "movable", "usufruct", "intellectual_property", "cash", "shares", "fund_units", "portfolio", "sukuk"]);
export const assetSubject = pgEnum("asset_subject", ["corpus", "value"]);
export const assetStatus = pgEnum("asset_status", ["income", "vacant", "development", "idle", "disputed"]);

export const docConfidentiality = pgEnum("doc_confidentiality", ["internal", "confidential", "secret"]);
export const docStatus = pgEnum("doc_status", ["quarantine", "active", "rejected", "archived"]);
export const docApproval = pgEnum("doc_approval", ["none", "draft", "in_review", "approved", "locked"]);
export const scanStatus = pgEnum("scan_status", ["pending", "clean", "infected", "failed"]);

export const severity = pgEnum("severity", ["critical", "high", "medium", "low"]);
export const obligationStatus = pgEnum("obligation_status", ["upcoming", "due_soon", "overdue", "done", "waived"]);
export const verificationStatus = pgEnum("verification_status", ["verified", "pending_verification"]);
export const bindingLevel = pgEnum("binding_level", ["binding", "guidance", "draft", "reference"]);

export const requestStatus = pgEnum("request_status", [
  "draft", "submitted", "triage", "awaiting_client", "quote", "awaiting_contract",
  "in_progress", "quality_review", "awaiting_client_approval", "completed", "closed",
  "on_hold", "cancelled", "rejected",
]);
export const pricingModel = pgEnum("pricing_model", ["free", "fixed", "subscription", "hourly", "percentage", "quote"]);
export const taskStatus = pgEnum("task_status", ["todo", "in_progress", "done", "cancelled"]);

export const assessmentStatus = pgEnum("assessment_status", ["draft", "completed", "computed", "under_review", "published", "superseded"]);
export const answerType = pgEnum("answer_type", ["yes_no", "yes_partial_no", "maturity", "band", "date", "select", "multiselect", "number", "text"]);
export const evidenceLevel = pgEnum("evidence_level", ["declared", "document", "verified"]);
export const recStatus = pgEnum("rec_status", ["open", "accepted", "dismissed", "converted", "suppressed"]);
export const publishStatus = pgEnum("publish_status", ["draft", "in_review", "published", "retired"]);

export const meetingStatus = pgEnum("meeting_status", ["scheduled", "held", "cancelled"]);
export const voteValue = pgEnum("vote_value", ["for", "against", "abstain", "recused"]);
export const resolutionStatus = pgEnum("resolution_status", ["draft", "approved", "rejected", "deferred", "executed", "reviewed"]);
export const minutesStatus = pgEnum("minutes_status", ["draft", "circulated", "approved", "locked"]);

export const notifSeverity = pgEnum("notif_severity", ["critical", "important", "info"]);
export const channel = pgEnum("channel", ["in_app", "email", "sms", "push", "whatsapp"]);
export const outboxStatus = pgEnum("outbox_status", ["queued", "sent", "failed"]);
