import {
  boolean, date, index, integer, jsonb, pgSchema, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, tracking } from "./_common";
import { authorityKind, bindingLevel, obligationStatus, publishStatus, severity, verificationStatus } from "./enums";
import { waqfs } from "./waqf";

/** Regulatory sources (systems, regulations, guides). Editable from admin. */
export const regulatoryReferences = pgTable("regulatory_references", {
  id: id(),
  code: text().notNull(), // e.g. NAZARA-REG
  sourceName: text().notNull(),
  issuer: text(),
  decisionRef: text(),
  bindingLevel: bindingLevel().notNull(),
  sourceUrl: text(),
  verificationStatus: verificationStatus().default("pending_verification").notNull(),
  lastVerifiedOn: date(),
  supersededBy: text(),
  notes: text(),
  ...tracking(),
}, (t) => [uniqueIndex("regref_code_uq").on(t.code)]);

/**
 * A requirement extracted from a regulatory source (or from a business decision).
 * This is the "Compliance Item" register and the backbone of the traceability matrix:
 * Source → Requirement → Feature/Rule → Status.
 */
export const regulatoryRequirements = pgTable("regulatory_requirements", {
  id: id(),
  code: text().notNull(), // REQ-0001
  referenceId: uuid().references(() => regulatoryReferences.id),
  article: text(),
  title: text().notNull(),
  description: text(),
  implementedAs: jsonb().$type<{ kind: "obligation" | "rule" | "flag" | "permission" | "validation" | "field" | "workflow" | "disclosure" | "report" | "feature"; ref: string }[]>().default([]).notNull(),
  featureArea: text(), // e.g. compliance, assessment, documents
  status: text().default("implemented").notNull(), // implemented | pending_verification | planned | excluded
  verificationStatus: verificationStatus().default("verified").notNull(),
  exclusionReason: text(),
  notes: text(),
  ...tracking(),
}, (t) => [uniqueIndex("regreq_code_uq").on(t.code)]);

/** Configurable obligation definition: Regulation → Rule → Task → Notification → Evidence → Status. */
export const obligations = pgTable("obligations", {
  id: id(),
  code: text().notNull(),
  titleAr: text().notNull(),
  description: text(),
  requirementId: uuid().references(() => regulatoryRequirements.id),
  referenceText: text().notNull(),
  authority: authorityKind().notNull(),
  obligationType: text().notNull(), // registration | update | notification | financial | disclosure | retention | governance | response | distribution | other
  triggerEvent: text().notNull(),
  offsetValue: integer(),
  offsetUnit: text().notNull(), // business_days | days | months | years | immediate | before_expiry_business_days | annual_on_fiscal_end | none
  recurrence: text().default("none").notNull(), // none | annual
  appliesTo: jsonb().$type<{
    sizeClasses?: string[]; legalTypes?: string[]; requiresFlags?: string[]; excludesFlags?: string[];
  }>().default({}).notNull(),
  severity: severity().default("medium").notNull(),
  requiredAction: text().notNull(),
  evidenceRequired: text(),
  penaltyCode: text(),
  defaultAssigneeRole: text().default("nazir").notNull(),
  reminderOffsetsDays: jsonb().$type<number[]>().default([30, 7, 1]).notNull(),
  status: publishStatus().default("published").notNull(),
  verificationStatus: verificationStatus().default("verified").notNull(),
  version: integer().default(1).notNull(),
  notes: text(),
  ...tracking(),
}, (t) => [uniqueIndex("obl_code_uq").on(t.code)]);

export const obligationInstances = pgTable("obligation_instances", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  obligationId: uuid().notNull().references(() => obligations.id),
  triggerEventId: uuid(),
  triggerDate: date(),
  periodKey: text(), // dedupe key e.g. FY2026
  dueOn: date(),
  dueImmediately: boolean().default(false).notNull(),
  status: obligationStatus().default("upcoming").notNull(),
  assigneeUserId: uuid(),
  evidenceDocumentId: uuid(),
  completedAt: timestamp({ withTimezone: true }),
  completedBy: uuid(),
  waivedReason: text(),
  lastReminderAt: timestamp({ withTimezone: true }),
  remindersSent: jsonb().$type<number[]>().default([]).notNull(),
  ...tracking(),
}, (t) => [
  index("oi_waqf_idx").on(t.waqfId),
  index("oi_due_idx").on(t.dueOn),
  uniqueIndex("oi_dedupe_uq").on(t.waqfId, t.obligationId, t.periodKey),
]);

export const obligationEvents = pgTable("obligation_events", {
  id: id(),
  instanceId: uuid().notNull().references(() => obligationInstances.id, { onDelete: "cascade" }),
  waqfId: uuid().notNull(),
  action: text().notNull(), // created | reminder | assigned | evidence | completed | reopened | waived
  note: text(),
  actorUserId: uuid(),
  at: createdAt(),
});

/** Penalty schedule (جدول المخالفات). Amounts held as text ranges until verified cell-by-cell. */
export const penaltySchedule = pgTable("penalty_schedule", {
  id: id(),
  code: text().notNull(), // 1-1 .. 7-3
  category: text().notNull(),
  titleAr: text().notNull(),
  largeText: text(),
  mediumText: text(),
  smallText: text(),
  dismissalRisk: text().default("no").notNull(), // immediate | after_notice | escalation | no
  maxFine: integer(),
  verificationStatus: verificationStatus().default("pending_verification").notNull(),
  notes: text(),
  ...tracking(),
}, (t) => [uniqueIndex("pen_code_uq").on(t.code)]);

export const violations = pgTable("violations", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  penaltyCode: text().notNull(),
  occurrence: integer().default(1).notNull(),
  noticedOn: date().notNull(),
  authorityRef: text(),
  sanction: text(),
  status: text().default("open").notNull(), // open | corrective_plan | appealed | closed
  correctiveDeadline: date(),
  documentId: uuid(),
  ...tracking(),
}, (t) => [index("viol_waqf_idx").on(t.waqfId)]);

export const riskRegister = pgTable("risk_register", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  title: text().notNull(),
  category: text().notNull(), // legal | market | liquidity | operational | governance | reputational | asset
  impact: integer().notNull(), // 1..3
  likelihood: integer().notNull(), // 1..3
  treatment: text(),
  ownerUserId: uuid(),
  reviewOn: date(),
  status: text().default("open").notNull(),
  ...tracking(),
}, (t) => [index("risk_waqf_idx").on(t.waqfId)]);

export const complaints = pgTable("complaints", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  number: text().notNull(),
  raisedByUserId: uuid().notNull(),
  beneficiaryId: uuid(),
  kind: text().notNull(), // inquiry | complaint | info_request
  subject: text().notNull(),
  body: text().notNull(),
  status: text().default("open").notNull(), // open | in_progress | answered | closed
  slaDueAt: timestamp({ withTimezone: true }).notNull(),
  response: text(),
  respondedAt: timestamp({ withTimezone: true }),
  respondedBy: uuid(),
  ...tracking(),
}, (t) => [index("comp_waqf_idx").on(t.waqfId)]);

export const holidays = pgTable("holidays", {
  day: date().primaryKey(),
  name: text().notNull(),
});

/** Restricted schema: only the MLRO role reaches it (enforced by grants + app). */
export const restricted = pgSchema("restricted");

export const suspicionReports = restricted.table("suspicion_reports", {
  id: id(),
  waqfId: uuid().notNull(),
  createdBy: uuid().notNull(),
  summaryEnc: text().notNull(),
  status: text().default("internal_review").notNull(), // internal_review | reported | closed_no_action
  reportedToFiuOn: date(),
  fiuReferenceEnc: text(),
  createdAt: createdAt(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const screeningResults = restricted.table("screening_results", {
  id: id(),
  subjectType: text().notNull(),
  subjectId: uuid().notNull(),
  provider: text().notNull(),
  status: text().notNull(), // clear | potential_match | confirmed_match | error
  detailsEnc: text(),
  reviewedBy: uuid(),
  decision: text(),
  createdAt: createdAt(),
});

export const complianceSettingsAudit = pgTable("compliance_change_log", {
  id: id(),
  entityType: text().notNull(), // obligation | rule | penalty | reference | requirement
  entityId: uuid().notNull(),
  change: jsonb().$type<Record<string, unknown>>().notNull(),
  actorUserId: uuid(),
  at: createdAt(),
  isActive: boolean().default(true).notNull(),
});
