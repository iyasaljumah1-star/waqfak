import {
  bigint, boolean, date, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, tracking } from "./_common";
import {
  answerType, assessmentStatus, docApproval, docConfidentiality, docStatus, evidenceLevel, publishStatus,
  recStatus, scanStatus, severity, waqfSizeClass,
} from "./enums";

// ───────────────────────── Documents ─────────────────────────

export const documents = pgTable("documents", {
  id: id(),
  waqfId: uuid(), // null = personal / request-only document
  ownerUserId: uuid().notNull(),
  requestId: uuid(),
  docType: text().notNull(), // waqf_deed | nazara_deed | registration_certificate | ownership_deed | lease | contract | power_of_attorney | resolution | minutes | financial_statement | bank_statement | valuation | policy | regulation | official_letter | judgment | permission | id_document | deliverable | other
  title: text().notNull(),
  number: text(),
  issuer: text(),
  issuedOn: date(),
  issuedOnHijri: text(),
  expiresOn: date(),
  confidentiality: docConfidentiality().default("internal").notNull(),
  status: docStatus().default("quarantine").notNull(),
  approvalStatus: docApproval().default("none").notNull(),
  currentVersion: integer().default(1).notNull(),
  retentionUntil: date(),
  tags: jsonb().$type<string[]>().default([]).notNull(),
  searchText: text(), // extracted text for non-secret docs
  aiSuggestedType: text(),
  ...tracking(),
  archivedAt: timestamp({ withTimezone: true }),
}, (t) => [index("docs_waqf_idx").on(t.waqfId), index("docs_req_idx").on(t.requestId), index("docs_exp_idx").on(t.expiresOn)]);

export const documentVersions = pgTable("document_versions", {
  id: id(),
  documentId: uuid().notNull().references(() => documents.id, { onDelete: "cascade" }),
  waqfId: uuid(),
  version: integer().notNull(),
  storageKey: text().notNull(),
  sha256: text().notNull(),
  sizeBytes: bigint({ mode: "number" }).notNull(),
  mimeType: text().notNull(),
  originalName: text().notNull(),
  encrypted: boolean().default(true).notNull(),
  iv: text(),
  authTag: text(),
  scanStatus: scanStatus().default("pending").notNull(),
  scanDetail: text(),
  uploadedBy: uuid().notNull(),
  uploadedAt: createdAt(),
  changeNote: text(),
}, (t) => [uniqueIndex("dv_doc_ver_uq").on(t.documentId, t.version)]);

export const documentLinks = pgTable("document_links", {
  documentId: uuid().notNull().references(() => documents.id, { onDelete: "cascade" }),
  entityType: text().notNull(),
  entityId: uuid().notNull(),
  waqfId: uuid(),
}, (t) => [primaryKey({ columns: [t.documentId, t.entityType, t.entityId] }), index("dl_entity_idx").on(t.entityType, t.entityId)]);

export const documentAccessLog = pgTable("document_access_log", {
  id: id(),
  documentId: uuid().notNull(),
  versionId: uuid(),
  waqfId: uuid(),
  userId: uuid(),
  action: text().notNull(), // upload | view | download | share | update | archive | approve | denied
  ip: text(),
  at: createdAt(),
}, (t) => [index("dal_doc_idx").on(t.documentId)]);

export const documentShares = pgTable("document_shares", {
  id: id(),
  documentId: uuid().notNull().references(() => documents.id, { onDelete: "cascade" }),
  waqfId: uuid(),
  tokenHash: text().notNull(),
  createdBy: uuid().notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  maxUses: integer().default(5).notNull(),
  uses: integer().default(0).notNull(),
  revokedAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("ds_token_uq").on(t.tokenHash)]);

export const extractedFields = pgTable("extracted_fields", {
  id: id(),
  documentId: uuid().notNull().references(() => documents.id, { onDelete: "cascade" }),
  waqfId: uuid(),
  field: text().notNull(),
  value: text(),
  page: integer(),
  confidence: numeric({ precision: 4, scale: 3 }),
  status: text().default("extracted").notNull(), // extracted | approved | rejected | applied
  reviewedBy: uuid(),
  reviewedAt: timestamp({ withTimezone: true }),
  source: text().default("ai").notNull(),
  createdAt: createdAt(),
});

// ───────────────────────── Assessment engine ─────────────────────────

export const questionBankVersions = pgTable("question_bank_versions", {
  id: id(),
  version: integer().notNull(),
  status: publishStatus().default("draft").notNull(),
  notes: text(),
  publishedAt: timestamp({ withTimezone: true }),
  publishedBy: uuid(),
  ...tracking(),
}, (t) => [uniqueIndex("qbv_version_uq").on(t.version)]);

export const assessmentAxes = pgTable("assessment_axes", {
  id: id(),
  bankVersionId: uuid().notNull().references(() => questionBankVersions.id, { onDelete: "cascade" }),
  code: text().notNull(),
  nameAr: text().notNull(),
  description: text(),
  weightSmall: numeric({ precision: 5, scale: 2 }).notNull(),
  weightMedium: numeric({ precision: 5, scale: 2 }).notNull(),
  weightLarge: numeric({ precision: 5, scale: 2 }).notNull(),
  position: integer().notNull(),
}, (t) => [uniqueIndex("axes_ver_code_uq").on(t.bankVersionId, t.code)]);

export type QuestionOption = { value: string; label: string; score?: number | null; unknown?: boolean; na?: boolean };

export const assessmentQuestions = pgTable("assessment_questions", {
  id: id(),
  bankVersionId: uuid().notNull().references(() => questionBankVersions.id, { onDelete: "cascade" }),
  code: text().notNull(),
  axisCode: text().notNull(), // P (profile) | A1..A11
  textAr: text().notNull(),
  helpAr: text(),
  answerType: answerType().notNull(),
  options: jsonb().$type<QuestionOption[]>(),
  weight: integer().default(1).notNull(),
  referenceText: text(),
  criticalFlagCode: text(),
  criticalWhen: jsonb().$type<unknown>(), // JSON-logic on {answer}
  showIf: jsonb().$type<unknown>(), // JSON-logic on facts
  factKey: text(),
  depth: text().default("basic").notNull(), // basic | deep
  position: integer().notNull(),
}, (t) => [uniqueIndex("aq_ver_code_uq").on(t.bankVersionId, t.code)]);

export const criticalFlagDefs = pgTable("critical_flag_defs", {
  code: text().primaryKey(),
  titleAr: text().notNull(),
  referenceText: text().notNull(),
  penaltyText: text(),
  penaltyCode: text(),
  axisCode: text(),
  actionAr: text(),
  severity: severity().default("critical").notNull(),
  active: boolean().default(true).notNull(),
});

export const assessments = pgTable("assessments", {
  id: id(),
  waqfId: uuid(),
  userId: uuid(),
  anonTokenHash: text(),
  kind: text().default("basic").notNull(), // basic | deep
  status: assessmentStatus().default("draft").notNull(),
  bankVersionId: uuid().notNull(),
  ruleSetVersion: integer(),
  respondentRole: text(),
  waqfLabel: text(),
  currentAxis: text().default("P").notNull(),
  startedAt: createdAt(),
  completedAt: timestamp({ withTimezone: true }),
  reviewedBy: uuid(),
  reviewedAt: timestamp({ withTimezone: true }),
  reviewNotes: text(),
  supersededBy: uuid(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => [index("ass_waqf_idx").on(t.waqfId), index("ass_user_idx").on(t.userId), index("ass_anon_idx").on(t.anonTokenHash)]);

export const assessmentAnswers = pgTable("assessment_answers", {
  assessmentId: uuid().notNull().references(() => assessments.id, { onDelete: "cascade" }),
  questionCode: text().notNull(),
  waqfId: uuid(),
  value: jsonb().$type<unknown>(),
  score: numeric({ precision: 3, scale: 1 }),
  isUnknown: boolean().default(false).notNull(),
  isNa: boolean().default(false).notNull(),
  evidenceLevel: evidenceLevel().default("declared").notNull(),
  evidenceDocumentId: uuid(),
  verifiedBy: uuid(),
  answeredAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.assessmentId, t.questionCode] })]);

export const assessmentResults = pgTable("assessment_results", {
  assessmentId: uuid().primaryKey().references(() => assessments.id, { onDelete: "cascade" }),
  waqfId: uuid(),
  overallScore: numeric({ precision: 5, scale: 2 }).notNull(),
  maturityScore: numeric({ precision: 5, scale: 2 }).notNull(),
  maturityLevel: text().notNull(),
  status: text().notNull(), // critical | needs_intervention | stable | advanced
  confidence: text().notNull(), // low | medium | high
  evidenceRatio: numeric({ precision: 5, scale: 2 }),
  knowledgeGaps: integer().default(0).notNull(),
  sizeClass: waqfSizeClass(),
  computedType: text(),
  weightsUsed: jsonb().$type<Record<string, number>>(),
  strengths: jsonb().$type<{ code: string; text: string; axis: string }[]>(),
  weaknesses: jsonb().$type<{ code: string; text: string; axis: string; reference?: string }[]>(),
  computedAt: createdAt(),
});

export const axisScores = pgTable("axis_scores", {
  assessmentId: uuid().notNull().references(() => assessments.id, { onDelete: "cascade" }),
  axisCode: text().notNull(),
  waqfId: uuid(),
  score: numeric({ precision: 5, scale: 2 }),
  capped: boolean().default(false).notNull(),
  applicableCount: integer().notNull(),
  answeredCount: integer().notNull(),
}, (t) => [primaryKey({ columns: [t.assessmentId, t.axisCode] })]);

export const criticalFlags = pgTable("critical_flags", {
  assessmentId: uuid().notNull().references(() => assessments.id, { onDelete: "cascade" }),
  flagCode: text().notNull(),
  waqfId: uuid(),
  questionCode: text(),
  evidence: text(),
}, (t) => [primaryKey({ columns: [t.assessmentId, t.flagCode] })]);

export const facts = pgTable("facts", {
  assessmentId: uuid().notNull().references(() => assessments.id, { onDelete: "cascade" }),
  key: text().notNull(),
  value: jsonb().$type<unknown>(),
  source: text().notNull(), // answer | waqf_profile | derived
}, (t) => [primaryKey({ columns: [t.assessmentId, t.key] })]);

// ───────────────────────── Recommendation engine ─────────────────────────

export const needs = pgTable("needs", {
  code: text().primaryKey(),
  groupCode: text().notNull(),
  titleAr: text().notNull(),
  description: text(),
});

export const recommendationRules = pgTable("recommendation_rules", {
  id: id(),
  code: text().notNull(),
  version: integer().default(1).notNull(),
  status: publishStatus().default("draft").notNull(),
  titleAr: text().notNull(),
  condition: jsonb().$type<unknown>().notNull(), // JSON-logic over facts
  needCode: text().notNull(),
  severity: severity().notNull(),
  urgencyDays: integer().default(90).notNull(),
  leverage: numeric({ precision: 3, scale: 2 }).default("1").notNull(),
  reasonAr: text().notNull(),
  whyItMattersAr: text(),
  reference: text(),
  serviceCodes: jsonb().$type<string[]>().default([]).notNull(),
  suppressIf: jsonb().$type<unknown>(),
  selfServiceHintAr: text(),
  reviewedBy: uuid(),
  reviewedAt: timestamp({ withTimezone: true }),
  publishedAt: timestamp({ withTimezone: true }),
  timesFired: integer().default(0).notNull(),
  timesConverted: integer().default(0).notNull(),
  ...tracking(),
}, (t) => [uniqueIndex("rr_code_ver_uq").on(t.code, t.version)]);

export const recommendations = pgTable("recommendations", {
  id: id(),
  assessmentId: uuid().notNull().references(() => assessments.id, { onDelete: "cascade" }),
  waqfId: uuid(),
  ruleId: uuid().notNull(),
  ruleCode: text().notNull(),
  ruleVersion: integer().notNull(),
  needCode: text().notNull(),
  severity: severity().notNull(),
  priority: numeric({ precision: 6, scale: 2 }).notNull(),
  wave: integer().notNull(), // 1: 30 days, 2: 90 days, 3: 12 months
  titleAr: text().notNull(),
  reasonAr: text().notNull(),
  whyItMattersAr: text(),
  reference: text(),
  serviceCodes: jsonb().$type<string[]>().default([]).notNull(),
  selfServiceHintAr: text(),
  status: recStatus().default("open").notNull(),
  suppressedNote: text(),
  dismissReason: text(),
  serviceRequestId: uuid(),
  createdAt: createdAt(),
}, (t) => [index("rec_ass_idx").on(t.assessmentId), index("rec_waqf_idx").on(t.waqfId)]);

export const actionPlans = pgTable("action_plans", {
  id: id(),
  assessmentId: uuid().notNull().references(() => assessments.id, { onDelete: "cascade" }),
  waqfId: uuid(),
  generatedAt: createdAt(),
  summary: jsonb().$type<{ wave: number; count: number }[]>(),
  suggestedPackageCode: text(),
});
