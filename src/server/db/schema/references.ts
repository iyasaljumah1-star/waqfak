import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id } from "./_common";

/**
 * Reference registry (phase 1 of the reference engine). Separate from `regulatory_references` (the admin list used
 * today): nothing in the running application reads these tables yet.
 *
 * Every table except `ref_sources` is append-only: PostgreSQL triggers refuse UPDATE and DELETE (see security.sql),
 * so a text once stored stays answerable for the dates it applied to.
 */

/** One row per instrument. `facts` holds each stated fact with the evidence it was read from (or the reason it is unknown). */
export const refSources = pgTable("ref_sources", {
  id: id(),
  code: text().notNull(), // NZR, PRD, GAA-LAW …
  officialName: text().notNull(),
  kind: text().notNull(), // statute | regulation | decision | guide | professional_standard | fiqh
  binding: text().notNull(), // binding | guidance | professional | fiqh
  statusRecorded: text().notNull(), // in_force | in_force_amended | not_yet_in_force | repealed | historical | draft | unknown
  facts: jsonb().notNull(),
  /** Working hypothesis only (never an approved service link). */
  candidateServices: jsonb().notNull(),
  lastVerifiedAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("ref_sources_code_uq").on(t.code)]);

/** A stored text of an instrument as retrieved from its source. Never edited; a new text is a new row. */
export const refVersions = pgTable("ref_versions", {
  id: id(),
  sourceId: uuid().notNull().references(() => refSources.id),
  label: text().notNull(),
  /** Date from which this text applies; null = not placed on the time line (never returned for a date). */
  effectiveFrom: date(),
  sourceUrl: text().notNull(),
  retrievedAt: timestamp({ withTimezone: true }).notNull(),
  via: text().notNull(), // direct_http | relay_scrape | manual_upload
  sha256: text().notNull(),
  text: text().notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("ref_versions_content_uq").on(t.sourceId, t.sha256, t.effectiveFrom), index("ref_versions_source_idx").on(t.sourceId, t.effectiveFrom)]);

/** Re-fetch by the platform's own fetcher found the same text on the official host (append-only). */
export const refVersionConfirmations = pgTable("ref_version_confirmations", {
  id: id(),
  versionId: uuid().notNull().references(() => refVersions.id),
  url: text().notNull(),
  sha256: text().notNull(),
  confirmedAt: timestamp({ withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/** Articles, paragraphs and items of a version, with stable locators («م8/ف2/ب»). */
export const refUnits = pgTable("ref_units", {
  id: id(),
  versionId: uuid().notNull().references(() => refVersions.id),
  locator: text().notNull(),
  article: integer().notNull(),
  paragraph: integer(),
  item: text(),
  heading: text(),
  text: text().notNull(),
}, (t) => [uniqueIndex("ref_units_locator_uq").on(t.versionId, t.locator)]);

/** One comparison of a stored official version with a knowledge-base copy. */
export const refMatchRuns = pgTable("ref_match_runs", {
  id: id(),
  versionId: uuid().notNull().references(() => refVersions.id),
  candidateLabel: text().notNull(),
  candidateSha256: text().notNull(),
  outcome: text().notNull(), // identical | editorial_only | substantive_difference | extraction_defective | unverifiable | repealed_or_superseded
  perArticle: jsonb().notNull(),
  details: jsonb().notNull(),
  ranAt: timestamp({ withTimezone: true }).notNull(),
});

/**
 * The units of a comparison (stage 11, batch D): one per article the run compared, with the run's outcome for it and
 * the sha256 of that article's stored text (computed by the database from ref_units at insert). A review is of ONE
 * unit: accepting article 8 of a run accepts nothing else in it, and never the source as a whole. Append-only.
 */
export const refMatchUnits = pgTable("ref_match_units", {
  id: id(),
  runId: uuid().notNull().references(() => refMatchRuns.id),
  /** «م8» — the key of the run's per-article outcome. */
  unitKey: text().notNull(),
  article: integer().notNull(),
  outcome: text().notNull(),
  textSha256: text().notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("ref_match_units_uq").on(t.runId, t.unitKey)]);

/**
 * A person's review of one unit of a comparison run (stage 11: unit_id required for every new review). Only an accepted
 * review of the unit lets that article be cited. Earlier reviews of a whole run (unit_id null) authorise nothing.
 */
export const refMatchReviews = pgTable("ref_match_reviews", {
  id: id(),
  runId: uuid().notNull().references(() => refMatchRuns.id),
  unitId: uuid().references(() => refMatchUnits.id),
  reviewerUserId: uuid().notNull(),
  decision: text().notNull(), // accepted | rejected
  note: text().notNull(),
  reviewedAt: timestamp({ withTimezone: true }).notNull(),
  /** The authenticated session an acceptance was recorded in (set by the database; see kb_source_reviews.session_id). */
  sessionId: uuid(),
});

/** Every retrieval attempt, successful or not, with the failure kind. */
export const refFetchAttempts = pgTable("ref_fetch_attempts", {
  id: id(),
  sourceCode: text().notNull(),
  url: text().notNull(),
  attemptedAt: timestamp({ withTimezone: true }).notNull(),
  ok: boolean().notNull(),
  via: text().notNull(),
  failureKind: text(), // link | access_blocked | file | extraction | no_official_publication
  failureDetail: text(),
}, (t) => [index("ref_fetch_attempts_code_idx").on(t.sourceCode, t.attemptedAt)]);
