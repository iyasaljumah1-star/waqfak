import { check, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity";
import { createdAt, id } from "./_common";

/**
 * Fiqh research (owner's order of 2026-11-07, §3 and §7): the dossiers the knowledge engine prepares — the matter, the
 * facts, the statements extracted with their sources, the comparison and the preliminary weighing — and the reviews a
 * qualified human reviewer records on them. A dossier is a research recommendation, never a ruling: only a review by
 * a holder of «knowledge.review.sharia» (or of the field the dossier names) approves, modifies or rejects it. Both
 * tables are append-only (security.sql); a correction is a new dossier or a new review.
 */
export const fiqhDossiers = pgTable("fiqh_dossiers", {
  id: id(),
  /** The question or matter as asked (synthetic in tests; masked of personal data before it is stored). */
  question: text().notNull(),
  facts: jsonb().default(sql`'[]'::jsonb`).notNull(),
  /** The whole dossier as produced (FiqhDossier, knowledge/fiqh/types.ts). */
  dossier: jsonb().notNull(),
  /** sha256 of the canonical dossier: a review names the very dossier it reviewed. */
  sha256: text().notNull(),
  /** research | summary | extraction | comparison | preliminary | draft — never «final» (that is a review's outcome). */
  stage: text().notNull(),
  /** The field whose reviewer decides (sharia for fiqh; legal, accounting… when the matter is theirs). */
  reviewRole: text().default("sharia").notNull(),
  serviceCode: text(),
  requestId: uuid(),
  outputId: uuid(),
  engineVersion: text().notNull(),
  createdBy: uuid().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [
  index("fqd_request_idx").on(t.requestId),
  check("fqd_stage_ck", sql`${t.stage} in ('research', 'summary', 'extraction', 'comparison', 'preliminary', 'draft')`),
  check("fqd_role_ck", sql`${t.reviewRole} in ('sharia', 'accounting', 'legal', 'data', 'investment')`),
]);

export const fiqhReviews = pgTable("fiqh_reviews", {
  id: id(),
  dossierId: uuid().notNull().references(() => fiqhDossiers.id),
  /** The dossier's sha256 at the time of the review (a review of another content does not carry over). */
  dossierSha256: text().notNull(),
  reviewerUserId: uuid().notNull().references(() => users.id),
  reviewerRole: text().notNull(),
  /** approved | modified (the reviewer's own weighing replaces the engine's) | rejected | more_research */
  decision: text().notNull(),
  note: text().notNull(),
  /** When modified: the position the reviewer adopts and why ({ position, reasons, statementIds }). */
  replacement: jsonb(),
  /** Set by the database from the request's session token (see kb_source_reviews.session_id). */
  sessionId: uuid(),
  at: createdAt(),
}, (t) => [
  index("fqr_dossier_idx").on(t.dossierId, t.at),
  check("fqr_decision_ck", sql`${t.decision} in ('approved', 'modified', 'rejected', 'more_research')`),
  check("fqr_role_ck", sql`${t.reviewerRole} in ('sharia', 'accounting', 'legal', 'data', 'investment')`),
  check("fqr_note_ck", sql`length(trim(${t.note})) >= 10`),
  check("fqr_replacement_ck", sql`(${t.decision} = 'modified') = (${t.replacement} is not null)`),
]);
