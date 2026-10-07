import {
  boolean, date, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { archival, createdAt, id, tracking } from "./_common";
import {
  approvalKind, approvalStatus, authorityKind, conditionCategory, idType, nazirMode, shariaReview,
  waqfakRole, waqfCreationMode, waqfLegalType, waqfSizeClass, waqfStatus,
} from "./enums";

// ───────────────────────── People & organizations ─────────────────────────

/** A person known to the platform. Separate from users: a deceased founder or a minor beneficiary has no account. */
export const persons = pgTable("persons", {
  id: id(),
  fullName: text().notNull(),
  idType: idType(),
  nationalIdEnc: text(),
  nationalIdHash: text(),
  nationality: text(),
  birthDate: date(),
  birthPlace: text(),
  isAlive: boolean().default(true).notNull(),
  deathDate: date(),
  residenceCountry: text(),
  addressEnc: text(),
  phone: text(),
  email: text(),
  userId: uuid(),
  isMinor: boolean().default(false).notNull(),
  guardianPersonId: uuid(),
  ...tracking(),
}, (t) => [index("persons_user_idx").on(t.userId), index("persons_nid_idx").on(t.nationalIdHash)]);

export const organizations = pgTable("organizations", {
  id: id(),
  name: text().notNull(),
  legalForm: text(),
  crNumber: text(),
  unifiedNumber: text(),
  nationalAddress: text(),
  isNonprofit: boolean().default(false).notNull(),
  kind: text().default("client").notNull(), // client | partner | provider | waqfak
  licenseNo: text(),
  ...tracking(),
});

export const organizationMembers = pgTable("organization_members", {
  organizationId: uuid().notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid().notNull(),
  role: text().notNull(), // authorized_signatory | member | director | owner
  authorityDocumentId: uuid(),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.organizationId, t.userId] })]);

export const kycRecords = pgTable("kyc_records", {
  id: id(),
  subjectType: text().notNull(), // person | organization | user
  subjectId: uuid().notNull(),
  status: text().default("pending").notNull(), // pending | verified | rejected | expired
  riskLevel: text().default("standard").notNull(), // low | standard | high
  isPep: boolean().default(false).notNull(),
  sourceOfFunds: text(),
  reviewedBy: uuid(),
  reviewedAt: timestamp({ withTimezone: true }),
  nextReviewAt: date(),
  notes: text(),
  ...tracking(),
}, (t) => [index("kyc_subject_idx").on(t.subjectType, t.subjectId)]);

// ───────────────────────── Waqf core ─────────────────────────

export const waqfs = pgTable("waqfs", {
  id: id(),
  internalNumber: text().notNull(), // WQF-000123
  name: text().notNull(),
  nationalUnifiedNumber: text(), // الرقم الوطني الموحد 700
  registrationCertNo: text(),
  registrationExpiresOn: date(),
  deedNo: text(),
  deedIssuer: text(),
  deedDateHijri: text(),
  deedDate: date(),
  documentedOn: date(),
  registeredOn: date(),
  creationMode: waqfCreationMode().default("inter_vivos").notNull(),
  legalType: waqfLegalType(),
  computedType: waqfLegalType(),
  computedTypeReason: text(),
  sizeClass: waqfSizeClass(),
  sizeClassLocked: boolean().default(false).notNull(),
  directBenefit: boolean().default(false).notNull(),
  assetsEstimatedValue: numeric({ precision: 18, scale: 2 }),
  fieldOfWork: text(),
  geographicScope: text(),
  domicile: text(),
  fiscalYearEnd: text().default("12-31").notNull(), // MM-DD
  status: waqfStatus().default("draft").notNull(),
  nazirMode: nazirMode(),
  waqfakRole: waqfakRole().default("none").notNull(),
  founderAlive: boolean(),
  hasForeignParty: boolean().default(false).notNull(),
  hasBeneficiariesAbroad: boolean().default(false).notNull(),
  collectsDonations: boolean().default(false).notNull(),
  hasActiveLitigation: boolean().default(false).notNull(),
  stage: integer().default(1).notNull(), // 1..5 waqf journey stage
  organizationId: uuid(),
  isDemo: boolean().default(false).notNull(),
  ...tracking(),
  ...archival(),
}, (t) => [uniqueIndex("waqfs_internal_uq").on(t.internalNumber), index("waqfs_nun_idx").on(t.nationalUnifiedNumber)]);

export const waqfClassifications = pgTable("waqf_classifications", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  legalType: waqfLegalType(),
  computedType: waqfLegalType(),
  reason: text(),
  effectiveFrom: date().notNull(),
  decidedBy: uuid(),
  createdAt: createdAt(),
}, (t) => [index("wc_waqf_idx").on(t.waqfId)]);

export const waqfRegistrations = pgTable("waqf_registrations", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  requestType: text().notNull(), // issue | renew | amend
  status: text().default("draft").notNull(), // draft | submitted | under_review | issued | rejected
  certNo: text(),
  submittedOn: date(),
  issuedOn: date(),
  expiresOn: date(),
  notes: text(),
  ...tracking(),
}, (t) => [index("wr_waqf_idx").on(t.waqfId)]);

export const waqfTimelineEvents = pgTable("waqf_timeline_events", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  type: text().notNull(),
  occurredOn: date().notNull(),
  title: text().notNull(),
  details: text(),
  documentId: uuid(),
  stage: integer(),
  createdAt: createdAt(),
  createdBy: uuid(),
}, (t) => [index("wte_waqf_idx").on(t.waqfId)]);

export const waqfGovernanceProfiles = pgTable("waqf_governance_profiles", {
  waqfId: uuid().primaryKey().references(() => waqfs.id, { onDelete: "cascade" }),
  quorumRule: text().default("majority").notNull(), // majority | two_thirds | all
  majorityRule: text().default("simple").notNull(), // simple | absolute | two_thirds
  meetingsPerYear: integer().default(4).notNull(),
  independentRatioTarget: numeric({ precision: 4, scale: 2 }),
  requireIndependentForQuorum: boolean().default(false).notNull(),
  reservedDecisions: jsonb().$type<string[]>().default([]).notNull(),
  executiveSpendLimit: numeric({ precision: 18, scale: 2 }),
  ...tracking(),
});

export const waqfKeys = pgTable("waqf_keys", {
  waqfId: uuid().primaryKey(),
  wrappedKey: text().notNull(),
  keyVersion: integer().default(1).notNull(),
  createdAt: createdAt(),
});

// ───────────────────────── Parties ─────────────────────────

export const founders = pgTable("founders", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  personId: uuid(),
  organizationId: uuid(),
  displayName: text().notNull(),
  isAlive: boolean().default(true).notNull(),
  nationality: text(),
  powers: jsonb().$type<{ canInterpret?: boolean; canAmendNazara?: boolean; canDismissNazir?: boolean; canAddAssets?: boolean }>(),
  userId: uuid(),
  ...tracking(),
}, (t) => [index("founders_waqf_idx").on(t.waqfId)]);

export const trustees = pgTable("trustees", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  kind: text().notNull(), // individual | board_member | legal_entity | founder | gaa
  personId: uuid(),
  organizationId: uuid(),
  displayName: text().notNull(),
  userId: uuid(),
  isIndependent: boolean().default(false).notNull(),
  isChair: boolean().default(false).notNull(),
  specialty: text(),
  licenseNo: text(),
  licenseExpiresOn: date(),
  residesInKsa: boolean(),
  nationality: text(),
  startsOn: date(),
  endsOn: date(),
  status: text().default("active").notNull(), // active | ended | suspended
  ...tracking(),
}, (t) => [index("trustees_waqf_idx").on(t.waqfId)]);

export const trusteeAppointments = pgTable("trustee_appointments", {
  id: id(),
  trusteeId: uuid().notNull().references(() => trustees.id, { onDelete: "cascade" }),
  waqfId: uuid().notNull(),
  decisionNo: text(),
  decisionDate: date(),
  authority: authorityKind(),
  powers: text(),
  fees: text(),
  responsibilities: text(),
  documentId: uuid(),
  ...tracking(),
}, (t) => [index("ta_waqf_idx").on(t.waqfId)]);

export const successions = pgTable("successions", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  ruleText: text().notNull(),
  successorName: text(),
  successorPersonId: uuid(),
  position: integer().default(1).notNull(),
  ...tracking(),
});

export const bodies = pgTable("bodies", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  kind: text().notNull(), // board | committee | general_assembly
  name: text().notNull(),
  charter: text(),
  parentBodyId: uuid(),
  ...tracking(),
}, (t) => [index("bodies_waqf_idx").on(t.waqfId)]);

export const bodyMemberships = pgTable("body_memberships", {
  id: id(),
  bodyId: uuid().notNull().references(() => bodies.id, { onDelete: "cascade" }),
  waqfId: uuid().notNull(),
  userId: uuid(),
  personName: text().notNull(),
  role: text().default("member").notNull(), // chair | vice_chair | member | secretary | observer
  isIndependent: boolean().default(false).notNull(),
  hasVote: boolean().default(true).notNull(),
  startsOn: date(),
  endsOn: date(),
  ...tracking(),
}, (t) => [index("bm_body_idx").on(t.bodyId), index("bm_waqf_idx").on(t.waqfId)]);

// ───────────────────────── Deed & conditions ─────────────────────────

export const waqfDeeds = pgTable("waqf_deeds", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  deedNo: text(),
  issuer: text(),
  issuedOnHijri: text(),
  issuedOn: date(),
  documentId: uuid(),
  status: text().default("draft").notNull(), // draft | documented | amended
  currentVersion: integer().default(1).notNull(),
  ...tracking(),
}, (t) => [index("deeds_waqf_idx").on(t.waqfId)]);

export const deedVersions = pgTable("deed_versions", {
  id: id(),
  deedId: uuid().notNull().references(() => waqfDeeds.id, { onDelete: "cascade" }),
  waqfId: uuid().notNull(),
  version: integer().notNull(),
  body: text(),
  structured: jsonb().$type<Record<string, unknown>>(),
  documentId: uuid(),
  changeNote: text(),
  approvalId: uuid(),
  ...tracking(),
});

export const conditions = pgTable("conditions", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  category: conditionCategory().notNull(),
  clauseRef: text(),
  literalText: text().notNull(),
  interpretation: text(),
  interpretationSource: text(), // founder | court | advisor
  shariaReview: shariaReview().default("not_reviewed").notNull(),
  position: integer().default(0).notNull(),
  ...tracking(),
}, (t) => [index("cond_waqf_idx").on(t.waqfId)]);

export const conditionInterpretations = pgTable("condition_interpretations", {
  id: id(),
  conditionId: uuid().notNull().references(() => conditions.id, { onDelete: "cascade" }),
  waqfId: uuid().notNull(),
  text: text().notNull(),
  source: text().notNull(),
  signedBy: text(),
  documentId: uuid(),
  decidedOn: date(),
  ...tracking(),
});

export const waqfExceptions = pgTable("waqf_exceptions", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  beneficiaryName: text().notNull(),
  kind: text().notNull(), // usufruct | yield | quantity
  duration: text().notNull(), // life | until_date
  untilDate: date(),
  quantity: text(),
  afterwards: text(),
  ...tracking(),
});

export const revenueAllocations = pgTable("revenue_allocations", {
  waqfId: uuid().primaryKey().references(() => waqfs.id, { onDelete: "cascade" }),
  maintenancePct: numeric({ precision: 5, scale: 2 }),
  developmentPct: numeric({ precision: 5, scale: 2 }),
  reinvestPct: numeric({ precision: 5, scale: 2 }),
  reservePct: numeric({ precision: 5, scale: 2 }),
  nazirFeePct: numeric({ precision: 5, scale: 2 }),
  nazirFeeFixed: numeric({ precision: 18, scale: 2 }),
  adminPct: numeric({ precision: 5, scale: 2 }),
  notes: text(),
  ...tracking(),
});

/** Permissions from the competent authority / GAA / court (استبدال، رهن، تفسير...). */
export const approvals = pgTable("approvals", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  kind: approvalKind().notNull(),
  authority: authorityKind().notNull(),
  status: approvalStatus().default("draft").notNull(),
  subject: text().notNull(),
  refNo: text(),
  submittedOn: date(),
  decidedOn: date(),
  assetId: uuid(),
  documentId: uuid(),
  notes: text(),
  ...tracking(),
}, (t) => [index("approvals_waqf_idx").on(t.waqfId)]);
