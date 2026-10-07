import {
  boolean, date, doublePrecision, index, integer, jsonb, numeric, pgTable, text, uuid,
} from "drizzle-orm/pg-core";
import { archival, id, tracking } from "./_common";
import { assetCategory, assetStatus, assetSubject } from "./enums";
import { waqfs } from "./waqf";

// ───────────────────────── Beneficiaries (المصارف والمستحقون) ─────────────────────────

/** A masraf / beneficiary class: tiers, order (ثم) vs sharing (و), shares, substitution and final destination. */
export const beneficiaryClasses = pgTable("beneficiary_classes", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  name: text().notNull(),
  kind: text().notNull(), // public | private
  specifiedBy: text().default("description").notNull(), // name | description
  tier: integer().default(1).notNull(),
  position: integer().default(0).notNull(),
  relation: text().default("and").notNull(), // then (ترتيب) | and (تشريك)
  sharePct: numeric({ precision: 5, scale: 2 }),
  criteria: jsonb().$type<{ gender?: string; includesDaughtersChildren?: boolean; need?: boolean; student?: boolean; other?: string }>(),
  divisionRule: text(), // equal | male_double
  substitutionRule: text(), // tier_blocking | branch_replaces
  endTier: text(),
  alternateMasraf: text(),
  isFinalDestination: boolean().default(false).notNull(),
  ...tracking(),
}, (t) => [index("bc_waqf_idx").on(t.waqfId)]);

export const beneficiaries = pgTable("beneficiaries", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  classId: uuid().references(() => beneficiaryClasses.id, { onDelete: "set null" }),
  personId: uuid(),
  organizationId: uuid(),
  displayName: text().notNull(),
  userId: uuid(),
  status: text().default("active").notNull(), // active | suspended | ended
  entitlementShare: numeric({ precision: 9, scale: 6 }),
  residesAbroad: boolean().default(false).notNull(),
  generation: integer(),
  parentBeneficiaryId: uuid(),
  lastVerifiedOn: date(),
  ...tracking(),
  ...archival(),
}, (t) => [index("ben_waqf_idx").on(t.waqfId), index("ben_user_idx").on(t.userId)]);

export const entitlements = pgTable("entitlements", {
  id: id(),
  waqfId: uuid().notNull(),
  beneficiaryId: uuid().notNull().references(() => beneficiaries.id, { onDelete: "cascade" }),
  period: text().notNull(), // e.g. 2026
  amount: numeric({ precision: 18, scale: 2 }).notNull(),
  basis: text(),
  expectedPayOn: date(),
  ...tracking(),
}, (t) => [index("ent_ben_idx").on(t.beneficiaryId)]);

/** Beneficial owners per GAA "معايير المستفيد الحقيقي" (Art. 5 fields). Sensitive fields encrypted. */
export const beneficialOwners = pgTable("beneficial_owners", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  subjectType: text().default("person").notNull(), // person | organization
  role: text().notNull(), // controlling_founder | nazir | controller | beneficiary | service_provider | director
  fullName: text().notNull(),
  nationality: text(),
  birthDate: date(),
  birthPlace: text(),
  addressEnc: text(),
  contact: text(),
  idType: text(),
  idNumberEnc: text(),
  idNumberHash: text(),
  acquiredOn: date(),
  bankDetailsEnc: text(),
  relationToWaqf: text(),
  entitlementDesc: text(),
  // organization-only fields (Art. 5/2)
  legalForm: text(),
  nationalAddress: text(),
  directors: jsonb().$type<{ name: string; birthDate?: string; birthPlace?: string; nationality?: string }[]>(),
  powers: text(),
  residesInKsa: boolean(),
  verifiedOn: date(),
  verificationSource: text(), // deed | registration_certificate | other
  riskLevel: text().default("standard").notNull(),
  nextVerificationDue: date(),
  ...tracking(),
  ...archival(),
}, (t) => [index("bo_waqf_idx").on(t.waqfId)]);

export const distributions = pgTable("distributions", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  period: text().notNull(),
  totalAmount: numeric({ precision: 18, scale: 2 }).notNull(),
  status: text().default("planned").notNull(), // planned | approved | paid | partially_paid
  dueBy: date(),
  paidOn: date(),
  bankAccountId: uuid(),
  conditionId: uuid(),
  resolutionId: uuid(),
  ...tracking(),
}, (t) => [index("dist_waqf_idx").on(t.waqfId)]);

export const distributionLines = pgTable("distribution_lines", {
  id: id(),
  distributionId: uuid().notNull().references(() => distributions.id, { onDelete: "cascade" }),
  waqfId: uuid().notNull(),
  beneficiaryId: uuid().notNull().references(() => beneficiaries.id),
  amount: numeric({ precision: 18, scale: 2 }).notNull(),
  referenceNo: text().notNull(),
  status: text().default("pending").notNull(), // pending | paid | failed
  paidOn: date(),
  proofDocumentId: uuid(),
  ...tracking(),
}, (t) => [index("dl_dist_idx").on(t.distributionId), index("dl_ben_idx").on(t.beneficiaryId)]);

// ───────────────────────── Assets & investments ─────────────────────────

export const assets = pgTable("assets", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  category: assetCategory().notNull(),
  subject: assetSubject().default("corpus").notNull(),
  title: text().notNull(),
  ownershipDocNo: text(),
  ownershipDocumentId: uuid(),
  inWaqfName: boolean(),
  sharePct: numeric({ precision: 5, scale: 2 }), // مشاع
  bookValue: numeric({ precision: 18, scale: 2 }),
  marketValue: numeric({ precision: 18, scale: 2 }),
  lastValuationOn: date(),
  valuer: text(),
  status: assetStatus().default("income").notNull(),
  annualIncome: numeric({ precision: 18, scale: 2 }),
  acquiredOn: date(),
  notes: text(),
  conditionId: uuid(),
  ...tracking(),
  ...archival(),
}, (t) => [index("assets_waqf_idx").on(t.waqfId)]);

export const properties = pgTable("properties", {
  assetId: uuid().primaryKey().references(() => assets.id, { onDelete: "cascade" }),
  waqfId: uuid().notNull(),
  deedNo: text(),
  city: text(),
  district: text(),
  lat: doublePrecision(),
  lng: doublePrecision(),
  usage: text(), // residential | commercial | agricultural | mosque | mixed | land
  areaSqm: numeric({ precision: 14, scale: 2 }),
  unitsCount: integer(),
  occupiedUnits: integer(),
  technicalCondition: text(), // good | fair | poor
  annualMaintenanceCost: numeric({ precision: 18, scale: 2 }),
  maintenanceReserve: numeric({ precision: 18, scale: 2 }),
  estimatedRent: numeric({ precision: 18, scale: 2 }),
  ...tracking(),
});

export const leases = pgTable("leases", {
  id: id(),
  assetId: uuid().notNull().references(() => assets.id, { onDelete: "cascade" }),
  waqfId: uuid().notNull(),
  tenantName: text().notNull(),
  ejarContractNo: text(),
  startsOn: date(),
  endsOn: date(),
  annualRent: numeric({ precision: 18, scale: 2 }),
  collectedToDate: numeric({ precision: 18, scale: 2 }),
  arrears: numeric({ precision: 18, scale: 2 }),
  status: text().default("active").notNull(),
  ...tracking(),
}, (t) => [index("leases_asset_idx").on(t.assetId)]);

export const valuations = pgTable("valuations", {
  id: id(),
  assetId: uuid().notNull().references(() => assets.id, { onDelete: "cascade" }),
  waqfId: uuid().notNull(),
  valuer: text().notNull(),
  valuerLicense: text(),
  method: text(),
  value: numeric({ precision: 18, scale: 2 }).notNull(),
  valuedOn: date().notNull(),
  documentId: uuid(),
  ...tracking(),
});

export const maintenancePlans = pgTable("maintenance_plans", {
  id: id(),
  assetId: uuid().notNull().references(() => assets.id, { onDelete: "cascade" }),
  waqfId: uuid().notNull(),
  item: text().notNull(),
  frequency: text(), // monthly | quarterly | annual | once
  nextDueOn: date(),
  estimatedCost: numeric({ precision: 18, scale: 2 }),
  status: text().default("planned").notNull(),
  ...tracking(),
});

export const investments = pgTable("investments", {
  assetId: uuid().primaryKey().references(() => assets.id, { onDelete: "cascade" }),
  waqfId: uuid().notNull(),
  instrumentType: text().notNull(), // shares | fund_units | portfolio | sukuk | direct | deposit
  issuerName: text(),
  quantity: numeric({ precision: 18, scale: 4 }),
  costBasis: numeric({ precision: 18, scale: 2 }),
  bonusSharesTreatment: text(), // corpus | yield
  managerName: text(),
  managerCmaLicense: text(),
  custodyAccount: text(),
  managementAgreementDocId: uuid(),
  feePct: numeric({ precision: 6, scale: 3 }),
  benchmark: text(),
  ...tracking(),
});

export const portfolios = pgTable("portfolios", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  accountNo: text(),
  custodian: text(),
  managerName: text(),
  managerCmaLicense: text(),
  strategy: text(),
  riskLevel: text(),
  waqfDeedOn: date(),
  registeredWithGaaOn: date(),
  accountOpenedOn: date(),
  recordedWithGaaOn: date(),
  ...tracking(),
});

export const investmentPolicies = pgTable("investment_policies", {
  id: id(),
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  version: integer().default(1).notNull(),
  targetReturnPct: numeric({ precision: 6, scale: 3 }),
  riskTolerance: text(),
  allocation: jsonb().$type<{ category: string; minPct: number; targetPct: number; maxPct: number }[]>(),
  prohibited: text(),
  leveragePolicy: text(),
  status: text().default("draft").notNull(),
  approvedByResolutionId: uuid(),
  reviewDue: date(),
  ...tracking(),
});

export const encumbrances = pgTable("encumbrances", {
  id: id(),
  assetId: uuid().notNull().references(() => assets.id, { onDelete: "cascade" }),
  waqfId: uuid().notNull(),
  kind: text().notNull(), // mortgage | seizure | dispute | encroachment | lien
  details: text(),
  since: date(),
  resolvedOn: date(),
  ...tracking(),
});
