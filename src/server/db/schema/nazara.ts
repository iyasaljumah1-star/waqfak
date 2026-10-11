import { sql } from "drizzle-orm";
import { boolean, date, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tracking } from "./_common";
import { authorityKind } from "./enums";
import { waqfs } from "./waqf";

/**
 * Corporate nazara: «وقفك» as the legal-entity nazir of a waqf (service N01).
 * One engagement per period of nazara over a waqf. The waqf's operational file (assets, finance, beneficiaries,
 * governance, compliance, documents, tasks) stays in the existing waqf tables; the engagement records how the
 * nazara started, who on the team runs it, what was received and handed over, and how it ended.
 * Sources: لائحة تنظيم أعمال النظارة م4–م7، م10، م11/4، م27؛ الدليل المختصر لمهمات ومسؤوليات ناظر الوقف.
 */
export type NazaraChecklistItem = {
  key: string;
  label: string;
  required: boolean;
  source: string;
  status: "missing" | "received" | "not_applicable";
  documentId?: string | null;
  note?: string | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
};

export type NazaraHandoverItem = {
  key: string;
  label: string;
  /** Count or summary computed from the waqf records when the handover list was prepared. */
  detail: string;
  status: "pending" | "delivered";
  note?: string | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
};

export const nazaraEngagements = pgTable("nazara_engagements", {
  id: id(),
  number: text().notNull(), // NZR-000001
  waqfId: uuid().notNull().references(() => waqfs.id, { onDelete: "cascade" }),
  requestId: uuid(), // the N01 service request that opened it, if any
  // intake | under_review | pending_completion | accepted | rejected | active | suspended | ending | ended
  status: text().default("intake").notNull(),
  /** Exercised on a demo/test waqf for testing, without a licence. Never set for a real waqf. */
  isPractice: boolean().default(false).notNull(),
  leadUserId: uuid(),
  checklist: jsonb().$type<NazaraChecklistItem[]>().default([]).notNull(),
  intakeNotes: text(),
  // acceptance decision (internal)
  decision: text(), // accepted | rejected | completion_requested
  decisionReason: text(),
  decidedBy: uuid(),
  decidedAt: timestamp({ withTimezone: true }),
  // appointment as nazir (م4/6: the naming decision states powers, fees and responsibilities)
  appointmentDecisionNo: text(),
  appointmentDecisionDate: date(),
  appointmentAuthority: authorityKind(),
  appointmentDocumentId: uuid(),
  powers: text(),
  feeTerms: text(),
  responsibilities: text(),
  trusteeId: uuid(),
  startedOn: date(),
  activatedBy: uuid(),
  // ending (م7) and handover (م27/3)
  endReason: text(), // resignation | dismissal | lost_condition | deed_term | other
  endNote: text(),
  endedOn: date(),
  successorName: text(),
  handover: jsonb().$type<NazaraHandoverItem[]>().default([]).notNull(),
  ...tracking(),
}, (t) => [
  uniqueIndex("nazara_eng_number_uq").on(t.number),
  index("nazara_eng_waqf_idx").on(t.waqfId),
  // at most one open engagement per waqf
  uniqueIndex("nazara_eng_open_uq").on(t.waqfId).where(sql`status not in ('rejected', 'ended')`),
]);

/** Status history of an engagement, shown on its page (the audit log keeps the full before/after). */
export const nazaraEvents = pgTable("nazara_events", {
  id: id(),
  engagementId: uuid().notNull().references(() => nazaraEngagements.id, { onDelete: "cascade" }),
  waqfId: uuid().notNull(),
  action: text().notNull(),
  fromStatus: text(),
  toStatus: text(),
  note: text(),
  actorUserId: uuid(),
  at: createdAt(),
}, (t) => [index("nazara_ev_eng_idx").on(t.engagementId)]);

/**
 * Staff who run the nazara of a waqf. Each active member holds a waqf membership created with the team entry
 * (lead → role «nazir», member → «executive»), which is what grants and isolates their access to that waqf only.
 */
export const nazaraTeam = pgTable("nazara_team", {
  id: id(),
  engagementId: uuid().notNull().references(() => nazaraEngagements.id, { onDelete: "cascade" }),
  waqfId: uuid().notNull(),
  userId: uuid().notNull(),
  teamRole: text().notNull(), // lead | member
  membershipId: uuid(),
  addedBy: uuid(),
  addedAt: createdAt(),
  removedAt: timestamp({ withTimezone: true }),
  removedBy: uuid(),
}, (t) => [index("nazara_team_eng_idx").on(t.engagementId), index("nazara_team_user_idx").on(t.userId)]);
