import {
  bigserial, boolean, date, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, tracking } from "./_common";
import { channel, notifSeverity, outboxStatus, pricingModel, publishStatus, requestStatus, taskStatus } from "./enums";

// ───────────────────────── Service catalog (fully admin-configurable) ─────────────────────────

export const serviceCategories = pgTable("service_categories", {
  id: id(),
  code: text().notNull(),
  nameAr: text().notNull(),
  description: text(),
  position: integer().default(0).notNull(),
}, (t) => [uniqueIndex("sc_code_uq").on(t.code)]);

export type WorkflowStage = { key: string; name: string; slaDays: number; role: string; clientApproval?: boolean };

export const workflowTemplates = pgTable("workflow_templates", {
  id: id(),
  code: text().notNull(),
  nameAr: text().notNull(),
  stages: jsonb().$type<WorkflowStage[]>().notNull(),
  ...tracking(),
}, (t) => [uniqueIndex("wt_code_uq").on(t.code)]);

export const services = pgTable("services", {
  id: id(),
  code: text().notNull(),
  categoryId: uuid().notNull().references(() => serviceCategories.id),
  nameAr: text().notNull(),
  summary: text().notNull(),
  description: text(),
  requirements: text(),
  requiredDocuments: jsonb().$type<{ docType: string; label: string; required: boolean }[]>().default([]).notNull(),
  outputs: text(),
  pricingModel: pricingModel().notNull(),
  basePrice: numeric({ precision: 18, scale: 2 }),
  currency: text().default("SAR").notNull(),
  slaDays: integer(),
  departmentKey: text(), // sharia | legal | finance | investment | governance | operations
  defaultSpecialistRole: text(),
  regulatoryRestrictions: text(),
  conflictRule: text().default("none").notNull(), // none | blocked_if_waqfak_nazir | blocked_if_waqfak_controls_finance | inside_nazara_only
  requiresLicenseKey: text(), // e.g. gaa_nazara_license
  workflowTemplateCode: text().default("standard").notNull(),
  audiences: jsonb().$type<string[]>().default([]).notNull(), // waqif | nazir | board | beneficiary | entity
  stage: integer(), // waqf journey stage 1..5
  isActive: boolean().default(true).notNull(),
  isPublished: boolean().default(true).notNull(),
  position: integer().default(0).notNull(),
  ...tracking(),
}, (t) => [uniqueIndex("svc_code_uq").on(t.code)]);

export const servicePrices = pgTable("service_prices", {
  id: id(),
  serviceId: uuid().notNull().references(() => services.id, { onDelete: "cascade" }),
  sizeClass: text(), // null = all
  price: numeric({ precision: 18, scale: 2 }).notNull(),
  validFrom: date(),
  validTo: date(),
  ...tracking(),
});

export const packages = pgTable("packages", {
  id: id(),
  code: text().notNull(),
  nameAr: text().notNull(),
  description: text(),
  audience: text(),
  targetSizeClasses: jsonb().$type<string[]>().default([]).notNull(),
  monthlyPrice: numeric({ precision: 18, scale: 2 }),
  annualPrice: numeric({ precision: 18, scale: 2 }),
  termsAr: text(),
  isActive: boolean().default(true).notNull(),
  isClosed: boolean().default(false).notNull(), // e.g. "nazir" package bound by nazara conflict rules
  position: integer().default(0).notNull(),
  ...tracking(),
}, (t) => [uniqueIndex("pkg_code_uq").on(t.code)]);

export const packageItems = pgTable("package_items", {
  packageId: uuid().notNull().references(() => packages.id, { onDelete: "cascade" }),
  serviceId: uuid().notNull().references(() => services.id, { onDelete: "cascade" }),
  note: text(),
}, (t) => [primaryKey({ columns: [t.packageId, t.serviceId] })]);

export const discounts = pgTable("discounts", {
  id: id(),
  code: text().notNull(),
  kind: text().notNull(), // percent | fixed
  value: numeric({ precision: 18, scale: 2 }).notNull(),
  validFrom: date(),
  validTo: date(),
  appliesTo: jsonb().$type<{ services?: string[]; packages?: string[] }>().default({}).notNull(),
  maxUses: integer(),
  uses: integer().default(0).notNull(),
  isActive: boolean().default(true).notNull(),
  ...tracking(),
}, (t) => [uniqueIndex("disc_code_uq").on(t.code)]);

// ───────────────────────── Requests & work ─────────────────────────

export const serviceRequests = pgTable("service_requests", {
  id: id(),
  number: text().notNull(),
  serviceId: uuid().notNull().references(() => services.id),
  waqfId: uuid(),
  requesterUserId: uuid().notNull(),
  status: requestStatus().default("draft").notNull(),
  priority: text().default("normal").notNull(), // urgent | high | normal | low
  source: text().default("manual").notNull(), // manual | recommendation | compliance | staff | public_form
  sourceRef: uuid(),
  details: text(),
  intake: jsonb().$type<Record<string, unknown>>(),
  assignedToUserId: uuid(),
  departmentKey: text(),
  currentStageKey: text(),
  slaDueAt: timestamp({ withTimezone: true }),
  quoteAmount: numeric({ precision: 18, scale: 2 }),
  agreedPrice: numeric({ precision: 18, scale: 2 }),
  conflictCheck: text().default("pending").notNull(), // pending | passed | blocked | override_approved
  conflictNote: text(),
  holdReason: text(),
  holdParty: text(),
  holdFollowUpOn: date(),
  cancelReason: text(),
  rejectReason: text(),
  rating: integer(),
  ratingComment: text(),
  submittedAt: timestamp({ withTimezone: true }),
  completedAt: timestamp({ withTimezone: true }),
  closedAt: timestamp({ withTimezone: true }),
  ...tracking(),
}, (t) => [
  uniqueIndex("sr_number_uq").on(t.number),
  index("sr_waqf_idx").on(t.waqfId),
  index("sr_assignee_idx").on(t.assignedToUserId),
  index("sr_requester_idx").on(t.requesterUserId),
]);

export const requestStages = pgTable("request_stages", {
  id: id(),
  requestId: uuid().notNull().references(() => serviceRequests.id, { onDelete: "cascade" }),
  waqfId: uuid(),
  stageKey: text().notNull(),
  name: text().notNull(),
  position: integer().notNull(),
  status: text().default("pending").notNull(), // pending | active | done | skipped
  slaDueAt: timestamp({ withTimezone: true }),
  startedAt: timestamp({ withTimezone: true }),
  completedAt: timestamp({ withTimezone: true }),
  completedBy: uuid(),
}, (t) => [index("rs_req_idx").on(t.requestId)]);

export const requestEvents = pgTable("request_events", {
  id: id(),
  requestId: uuid().notNull().references(() => serviceRequests.id, { onDelete: "cascade" }),
  waqfId: uuid(),
  fromStatus: text(),
  toStatus: text(),
  note: text(),
  actorUserId: uuid(),
  at: createdAt(),
});

export const requestNotes = pgTable("request_notes", {
  id: id(),
  requestId: uuid().notNull().references(() => serviceRequests.id, { onDelete: "cascade" }),
  waqfId: uuid(),
  authorId: uuid().notNull(),
  visibility: text().default("client").notNull(), // client | internal
  body: text().notNull(),
  createdAt: createdAt(),
});

export const deliverables = pgTable("deliverables", {
  id: id(),
  requestId: uuid().notNull().references(() => serviceRequests.id, { onDelete: "cascade" }),
  waqfId: uuid(),
  title: text().notNull(),
  documentId: uuid(),
  version: integer().default(1).notNull(),
  status: text().default("draft").notNull(), // draft | submitted | approved | revision_requested
  signedBy: text(), // for sharia/legal opinions: name and capacity
  submittedAt: timestamp({ withTimezone: true }),
  approvedAt: timestamp({ withTimezone: true }),
  approvedBy: uuid(),
  revisionNote: text(),
  ...tracking(),
});

export const projects = pgTable("projects", {
  id: id(),
  waqfId: uuid(),
  requestId: uuid(),
  name: text().notNull(),
  status: text().default("active").notNull(),
  startOn: date(),
  endOn: date(),
  ownerUserId: uuid(),
  ...tracking(),
});

export const tasks = pgTable("tasks", {
  id: id(),
  waqfId: uuid(),
  requestId: uuid(),
  projectId: uuid(),
  sourceType: text().default("manual").notNull(), // manual | request | resolution | compliance | assessment
  sourceId: uuid(),
  title: text().notNull(),
  description: text(),
  assigneeUserId: uuid(),
  dueOn: date(),
  priority: text().default("normal").notNull(),
  status: taskStatus().default("todo").notNull(),
  checklist: jsonb().$type<{ text: string; done: boolean }[]>().default([]).notNull(),
  progress: integer().default(0).notNull(),
  visibility: text().default("shared").notNull(), // shared | internal
  completedAt: timestamp({ withTimezone: true }),
  ...tracking(),
}, (t) => [index("tasks_waqf_idx").on(t.waqfId), index("tasks_assignee_idx").on(t.assigneeUserId)]);

export const taskComments = pgTable("task_comments", {
  id: id(),
  taskId: uuid().notNull().references(() => tasks.id, { onDelete: "cascade" }),
  waqfId: uuid(),
  authorId: uuid().notNull(),
  body: text().notNull(),
  createdAt: createdAt(),
});

// ───────────────────────── Contracts, billing ─────────────────────────

export const contractTemplates = pgTable("contract_templates", {
  id: id(),
  code: text().notNull(),
  kind: text().notNull(), // service | nazara | managed | subscription | delegation | nda
  nameAr: text().notNull(),
  body: text().notNull(),
  version: integer().default(1).notNull(),
  isActive: boolean().default(true).notNull(),
  ...tracking(),
}, (t) => [uniqueIndex("ct_code_ver_uq").on(t.code, t.version)]);

export const contracts = pgTable("contracts", {
  id: id(),
  number: text().notNull(),
  kind: text().notNull(),
  templateCode: text().notNull(),
  templateVersion: integer().notNull(),
  requestId: uuid(),
  waqfId: uuid(),
  partyUserId: uuid().notNull(),
  body: text().notNull(),
  contentHash: text().notNull(),
  amount: numeric({ precision: 18, scale: 2 }),
  status: text().default("sent").notNull(), // draft | sent | signed | void
  signedAt: timestamp({ withTimezone: true }),
  ...tracking(),
}, (t) => [uniqueIndex("contracts_number_uq").on(t.number)]);

export const contractSignatures = pgTable("contract_signatures", {
  id: id(),
  contractId: uuid().notNull().references(() => contracts.id, { onDelete: "cascade" }),
  userId: uuid().notNull(),
  signedAt: createdAt(),
  method: text().default("otp_consent").notNull(),
  otpChallengeId: uuid(),
  ip: text(),
  userAgent: text(),
  contentHash: text().notNull(),
});

export const subscriptions = pgTable("subscriptions", {
  id: id(),
  waqfId: uuid(),
  userId: uuid().notNull(),
  packageId: uuid().notNull().references(() => packages.id),
  billingCycle: text().default("annual").notNull(),
  price: numeric({ precision: 18, scale: 2 }).notNull(),
  status: text().default("pending_payment").notNull(), // pending_payment | active | past_due | cancelled
  startsOn: date(),
  renewsOn: date(),
  cancelledOn: date(),
  ...tracking(),
});

export const invoices = pgTable("invoices", {
  id: id(),
  number: text().notNull(),
  userId: uuid().notNull(),
  waqfId: uuid(), // billed to waqf when fees are paid from waqf funds
  billedToName: text().notNull(),
  requestId: uuid(),
  subscriptionId: uuid(),
  contractId: uuid(),
  subtotal: numeric({ precision: 18, scale: 2 }).notNull(),
  discount: numeric({ precision: 18, scale: 2 }).default("0").notNull(),
  vatRate: numeric({ precision: 5, scale: 2 }).default("15").notNull(),
  vat: numeric({ precision: 18, scale: 2 }).notNull(),
  total: numeric({ precision: 18, scale: 2 }).notNull(),
  currency: text().default("SAR").notNull(),
  status: text().default("issued").notNull(), // issued | paid | void | overdue
  issuedOn: date().notNull(),
  dueOn: date(),
  paidOn: date(),
  einvoiceUuid: text(),
  einvoiceStatus: text().default("pending_integration").notNull(),
  lines: jsonb().$type<{ description: string; qty: number; unit: number; total: number }[]>().notNull(),
  ...tracking(),
}, (t) => [uniqueIndex("inv_number_uq").on(t.number), index("inv_user_idx").on(t.userId)]);

export const payments = pgTable("payments", {
  id: id(),
  invoiceId: uuid().notNull().references(() => invoices.id),
  userId: uuid().notNull(),
  provider: text().notNull(), // sandbox | moyasar | hyperpay | bank_transfer ...
  providerRef: text(),
  method: text(), // mada | card | applepay | transfer
  amount: numeric({ precision: 18, scale: 2 }).notNull(),
  status: text().default("initiated").notNull(), // initiated | paid | failed | refunded
  paidAt: timestamp({ withTimezone: true }),
  raw: jsonb().$type<Record<string, unknown>>(),
  ...tracking(),
});

// ───────────────────────── Communications & content ─────────────────────────

export const notifications = pgTable("notifications", {
  id: id(),
  userId: uuid().notNull(),
  waqfId: uuid(),
  type: text().notNull(),
  severity: notifSeverity().default("info").notNull(),
  titleAr: text().notNull(),
  bodyAr: text(),
  link: text(),
  readAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("notif_user_idx").on(t.userId, t.readAt)]);

export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid().notNull(),
  type: text().notNull(),
  inApp: boolean().default(true).notNull(),
  email: boolean().default(true).notNull(),
  sms: boolean().default(false).notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.type] })]);

export const notificationTemplates = pgTable("notification_templates", {
  key: text().primaryKey(),
  titleAr: text().notNull(),
  bodyAr: text().notNull(),
  severity: notifSeverity().default("info").notNull(),
  channels: jsonb().$type<string[]>().default(["in_app"]).notNull(),
  locked: boolean().default(false).notNull(), // critical/security cannot be turned off
  updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const outboxMessages = pgTable("outbox_messages", {
  id: bigserial({ mode: "number" }).primaryKey(),
  channel: channel().notNull(),
  toAddress: text().notNull(),
  subject: text(),
  body: text().notNull(),
  status: outboxStatus().default("queued").notNull(),
  attempts: integer().default(0).notNull(),
  provider: text(),
  providerRef: text(),
  error: text(),
  sentAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
});

export const conversations = pgTable("conversations", {
  id: id(),
  waqfId: uuid(),
  requestId: uuid(),
  subject: text().notNull(),
  ...tracking(),
});

export const messages = pgTable("messages", {
  id: id(),
  conversationId: uuid().notNull().references(() => conversations.id, { onDelete: "cascade" }),
  waqfId: uuid(),
  authorId: uuid().notNull(),
  body: text().notNull(),
  createdAt: createdAt(),
});

export const contentItems = pgTable("content_items", {
  id: id(),
  kind: text().notNull(), // article | guide | regulation | study | template | page
  slug: text().notNull(),
  titleAr: text().notNull(),
  summary: text(),
  bodyMd: text().notNull(),
  audience: jsonb().$type<string[]>().default([]).notNull(),
  topic: text(),
  status: publishStatus().default("draft").notNull(),
  reviewerSpecialty: text(), // sharia | legal | finance
  reviewedBy: uuid(),
  reviewedAt: timestamp({ withTimezone: true }),
  publishedAt: timestamp({ withTimezone: true }),
  lastVerifiedAt: date(),
  sourceRefs: jsonb().$type<{ label: string; url?: string }[]>().default([]).notNull(),
  seoTitle: text(),
  seoDescription: text(),
  readingMinutes: integer(),
  requiresLogin: boolean().default(false).notNull(),
  ...tracking(),
}, (t) => [uniqueIndex("content_slug_uq").on(t.kind, t.slug)]);

export const contentReviews = pgTable("content_reviews", {
  id: id(),
  contentId: uuid().notNull().references(() => contentItems.id, { onDelete: "cascade" }),
  reviewerId: uuid().notNull(),
  specialty: text().notNull(),
  decision: text().notNull(), // approved | changes_requested
  notes: text(),
  at: createdAt(),
});

export const glossaryTerms = pgTable("glossary_terms", {
  id: id(),
  slug: text().notNull(),
  term: text().notNull(),
  definition: text().notNull(),
  synonyms: jsonb().$type<string[]>().default([]).notNull(),
  related: jsonb().$type<string[]>().default([]).notNull(),
  source: text(),
  status: publishStatus().default("published").notNull(),
  ...tracking(),
}, (t) => [uniqueIndex("gloss_slug_uq").on(t.slug)]);

export const faqs = pgTable("faqs", {
  id: id(),
  question: text().notNull(),
  answer: text().notNull(),
  audience: text().default("all").notNull(),
  topic: text().notNull(),
  position: integer().default(0).notNull(),
  status: publishStatus().default("published").notNull(),
  source: text(),
  ...tracking(),
});

export const contactMessages = pgTable("contact_messages", {
  id: id(),
  name: text().notNull(),
  phone: text(),
  email: text(),
  topic: text().notNull(),
  body: text().notNull(),
  status: text().default("new").notNull(),
  handledBy: uuid(),
  createdAt: createdAt(),
});

// ───────────────────────── System ─────────────────────────

export const auditLogs = pgTable("audit_logs", {
  id: bigserial({ mode: "number" }).primaryKey(),
  at: createdAt(),
  actorUserId: uuid(),
  actorLabel: text(),
  action: text().notNull(),
  entityType: text().notNull(),
  entityId: text(),
  waqfId: uuid(),
  ip: text(),
  userAgent: text(),
  before: jsonb().$type<unknown>(),
  after: jsonb().$type<unknown>(),
  prevHash: text(),
  hash: text().notNull(),
}, (t) => [index("audit_waqf_idx").on(t.waqfId, t.at), index("audit_actor_idx").on(t.actorUserId, t.at)]);

export const aiInteractions = pgTable("ai_interactions", {
  id: id(),
  userId: uuid(),
  waqfId: uuid(),
  kind: text().notNull(), // ask | summarize | extract | classify | explain_assessment
  input: text().notNull(),
  sources: jsonb().$type<{ documentId?: string; title: string; snippet: string; page?: number }[]>().default([]).notNull(),
  output: text().notNull(),
  provider: text().notNull(),
  model: text(),
  refused: boolean().default(false).notNull(),
  refusalReason: text(),
  feedback: text(),
  createdAt: createdAt(),
}, (t) => [index("ai_waqf_idx").on(t.waqfId)]);

export const dataSubjectRequests = pgTable("data_subject_requests", {
  id: id(),
  userId: uuid().notNull(),
  kind: text().notNull(), // access | export | correct | delete
  status: text().default("received").notNull(), // received | in_progress | completed | rejected
  details: text(),
  resultDocumentId: uuid(),
  retainedDataNote: text(),
  requestedAt: createdAt(),
  dueAt: timestamp({ withTimezone: true }),
  completedAt: timestamp({ withTimezone: true }),
});

export const consents = pgTable("consents", {
  id: id(),
  userId: uuid().notNull(),
  kind: text().notNull(), // terms | privacy | marketing | analytics | ai_processing
  version: text().notNull(),
  granted: boolean().notNull(),
  ip: text(),
  at: createdAt(),
}, (t) => [index("consents_user_idx").on(t.userId)]);

export const settings = pgTable("settings", {
  key: text().primaryKey(),
  value: jsonb().$type<unknown>().notNull(),
  description: text(),
  updatedBy: uuid(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const featureFlags = pgTable("feature_flags", {
  key: text().primaryKey(),
  enabled: boolean().default(false).notNull(),
  description: text().notNull(),
  reason: text(),
  updatedBy: uuid(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const reports = pgTable("reports", {
  id: id(),
  number: text().notNull(),
  waqfId: uuid(),
  kind: text().notNull(), // assessment | annual | compliance | financial | minutes | distribution | gaa_package
  title: text().notNull(),
  assessmentId: uuid(),
  verificationCode: text().notNull(),
  documentId: uuid(),
  snapshot: jsonb().$type<unknown>(),
  generatedBy: uuid(),
  generatedAt: createdAt(),
  revokedAt: timestamp({ withTimezone: true }),
}, (t) => [uniqueIndex("reports_number_uq").on(t.number), uniqueIndex("reports_vcode_uq").on(t.verificationCode)]);

export const reportShares = pgTable("report_shares", {
  id: id(),
  reportId: uuid().notNull().references(() => reports.id, { onDelete: "cascade" }),
  waqfId: uuid(),
  tokenHash: text().notNull(),
  createdBy: uuid().notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  revokedAt: timestamp({ withTimezone: true }),
  views: integer().default(0).notNull(),
  createdAt: createdAt(),
});

export const sequences = pgTable("sequences", {
  key: text().primaryKey(), // e.g. WQ-2026, WQF, INV-2026
  value: integer().default(0).notNull(),
});

export const jobRuns = pgTable("job_runs", {
  id: id(),
  job: text().notNull(),
  startedAt: createdAt(),
  finishedAt: timestamp({ withTimezone: true }),
  status: text().default("running").notNull(),
  detail: jsonb().$type<Record<string, unknown>>(),
});

export const priceQuoteHistory = pgTable("price_change_log", {
  id: id(),
  entityType: text().notNull(),
  entityId: uuid().notNull(),
  field: text().notNull(),
  oldValue: text(),
  newValue: text(),
  actorUserId: uuid(),
  at: createdAt(),
});

