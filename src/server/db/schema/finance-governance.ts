import {
  boolean, date, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, tracking } from "./_common";
import { meetingStatus, minutesStatus, resolutionStatus, voteValue } from "./enums";
import { waqfs } from "./waqf";

// ───────────────────────── Waqf finance (never mixed with Waqfak's own billing) ─────────────────────────

export const bankAccounts = pgTable("bank_accounts", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  bankName: text().notNull(),
  ibanEnc: text().notNull(),
  ibanLast4: text().notNull(),
  inWaqfName: boolean().notNull(),
  purpose: text().default("general").notNull(), // general | donations | investment | distribution
  openedOn: date(),
  status: text().default("active").notNull(),
  ...tracking(),
}, (t) => [index("ba_waqf_idx").on(t.waqfId)]);

export const budgets = pgTable("budgets", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  fiscalYear: integer().notNull(),
  status: text().default("draft").notNull(), // draft | approved
  totalRevenue: numeric({ precision: 18, scale: 2 }),
  totalExpense: numeric({ precision: 18, scale: 2 }),
  lines: jsonb().$type<{ code: string; label: string; amount: number; kind: "revenue" | "expense" }[]>(),
  approvedByResolutionId: uuid(),
  approvedOn: date(),
  ...tracking(),
});

export const ledgerEntries = pgTable("ledger_entries", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  entryDate: date().notNull(),
  accountCode: text().notNull(),
  description: text().notNull(),
  debit: numeric({ precision: 18, scale: 2 }).default("0").notNull(),
  credit: numeric({ precision: 18, scale: 2 }).default("0").notNull(),
  referenceNo: text(),
  documentId: uuid(),
  conditionId: uuid(),
  ...tracking(),
}, (t) => [index("le_waqf_date_idx").on(t.waqfId, t.entryDate)]);

export const financialStatements = pgTable("financial_statements", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  fiscalYear: integer().notNull(),
  kind: text().notNull(), // audited | simple_statement
  status: text().default("draft").notNull(), // draft | final | submitted
  auditorName: text(),
  auditorLicense: text(),
  auditorIndependent: boolean(),
  opinion: text(),
  totalRevenue: numeric({ precision: 18, scale: 2 }),
  totalExpense: numeric({ precision: 18, scale: 2 }),
  documentId: uuid(),
  submittedToGaaOn: date(),
  sharedWithBeneficiaries: boolean().default(false).notNull(),
  ...tracking(),
});

// ───────────────────────── Governance ─────────────────────────

export const meetings = pgTable("meetings", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  bodyId: uuid(),
  kind: text().default("regular").notNull(), // regular | extraordinary | circulation
  title: text().notNull(),
  scheduledAt: timestamp({ withTimezone: true }).notNull(),
  location: text(),
  link: text(),
  status: meetingStatus().default("scheduled").notNull(),
  invitationsSentAt: timestamp({ withTimezone: true }),
  quorumRequired: integer(),
  quorumMet: boolean(),
  heldAt: timestamp({ withTimezone: true }),
  ...tracking(),
}, (t) => [index("meet_waqf_idx").on(t.waqfId)]);

export const agendaItems = pgTable("agenda_items", {
  id: id(),
  meetingId: uuid().notNull().references(() => meetings.id, { onDelete: "cascade" }),
  waqfId: uuid().notNull(),
  position: integer().default(0).notNull(),
  title: text().notNull(),
  presenterName: text(),
  kind: text().default("discussion").notNull(), // info | discussion | decision
  conditionId: uuid(),
  documentIds: jsonb().$type<string[]>().default([]).notNull(),
  ...tracking(),
});

export const attendance = pgTable("attendance", {
  meetingId: uuid().notNull().references(() => meetings.id, { onDelete: "cascade" }),
  bodyMembershipId: uuid().notNull(),
  waqfId: uuid().notNull(),
  status: text().default("invited").notNull(), // invited | present | apologized | absent | proxy
  mode: text(), // in_person | remote
  recordedAt: timestamp({ withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.meetingId, t.bodyMembershipId] })]);

export const conflictDeclarations = pgTable("conflict_declarations", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  userId: uuid().notNull(),
  meetingId: uuid(),
  agendaItemId: uuid(),
  kind: text().notNull(), // none | actual | potential  (annual declarations may be "none")
  relationDegree: integer(),
  description: text(),
  action: text().default("recuse").notNull(), // recuse | leave | none
  isAnnual: boolean().default(false).notNull(),
  year: integer(),
  disclosedToGaaOn: date(),
  declaredAt: createdAt(),
}, (t) => [index("coi_waqf_idx").on(t.waqfId), index("coi_item_idx").on(t.agendaItemId)]);

export const resolutions = pgTable("resolutions", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  meetingId: uuid(),
  agendaItemId: uuid(),
  number: text().notNull(),
  text: text().notNull(),
  category: text().notNull(), // investment | distribution | appointment | policy | asset_disposal | budget | other
  requiresExternalApproval: boolean().default(false).notNull(),
  approvalId: uuid(),
  conditionId: uuid(),
  expectedImpact: text(),
  risks: text(),
  status: resolutionStatus().default("draft").notNull(),
  votesFor: integer().default(0).notNull(),
  votesAgainst: integer().default(0).notNull(),
  votesAbstain: integer().default(0).notNull(),
  votesRecused: integer().default(0).notNull(),
  decidedAt: timestamp({ withTimezone: true }),
  executedAt: timestamp({ withTimezone: true }),
  reviewNote: text(),
  ...tracking(),
}, (t) => [index("res_waqf_idx").on(t.waqfId), uniqueIndex("res_number_uq").on(t.waqfId, t.number)]);

export const votes = pgTable("votes", {
  resolutionId: uuid().notNull().references(() => resolutions.id, { onDelete: "cascade" }),
  userId: uuid().notNull(),
  waqfId: uuid().notNull(),
  value: voteValue().notNull(),
  reason: text(),
  castAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.resolutionId, t.userId] })]);

export const minutes = pgTable("minutes", {
  id: id(),
  meetingId: uuid().notNull().references(() => meetings.id, { onDelete: "cascade" }),
  waqfId: uuid().notNull(),
  version: integer().default(1).notNull(),
  body: text().notNull(),
  status: minutesStatus().default("draft").notNull(),
  preparedBy: uuid(),
  circulatedAt: timestamp({ withTimezone: true }),
  approvedAt: timestamp({ withTimezone: true }),
  lockedAt: timestamp({ withTimezone: true }),
  contentHash: text(),
  ...tracking(),
});

export const minuteSignatures = pgTable("minute_signatures", {
  minuteId: uuid().notNull().references(() => minutes.id, { onDelete: "cascade" }),
  userId: uuid().notNull(),
  waqfId: uuid().notNull(),
  signedAt: createdAt(),
  method: text().default("otp_consent").notNull(),
  contentHash: text().notNull(),
}, (t) => [primaryKey({ columns: [t.minuteId, t.userId] })]);

export const policies = pgTable("policies", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  policyType: text().notNull(), // one of the 12 required policies
  title: text().notNull(),
  version: integer().default(1).notNull(),
  status: text().default("draft").notNull(), // draft | approved | superseded
  approvedByResolutionId: uuid(),
  approvedOn: date(),
  reviewDue: date(),
  documentId: uuid(),
  ...tracking(),
}, (t) => [index("pol_waqf_idx").on(t.waqfId)]);

export const performanceReviews = pgTable("performance_reviews", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  subjectType: text().notNull(), // nazir | board | member
  subjectName: text().notNull(),
  year: integer().notNull(),
  score: numeric({ precision: 5, scale: 2 }),
  notes: text(),
  documentId: uuid(),
  ...tracking(),
});
