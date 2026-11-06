import { date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createdAt, id } from "./_common";

/**
 * Processing engine (owner's order of 2026-11-01, phase 2): the queue of processing jobs, the record of every run and
 * of every step in it, and the knowledge base (the actual texts of the references, with source, version and quality).
 * Team-side records only: the client never reads them (row-level policies in security.sql).
 */

// ───────────────────────── Queue ─────────────────────────

/** One unit of background work on a request. At most one queued/running job per request (partial unique index). */
export const processingJobs = pgTable("processing_jobs", {
  id: id(),
  requestId: uuid().notNull(),
  waqfId: uuid(),
  kind: text().default("process").notNull(), // process | verify
  status: text().default("queued").notNull(), // queued | running | succeeded | failed | dead | cancelled
  attempts: integer().default(0).notNull(),
  maxAttempts: integer().default(5).notNull(),
  runAfter: timestamp({ withTimezone: true }).defaultNow().notNull(),
  lockedAt: timestamp({ withTimezone: true }),
  lockedBy: text(),
  /** The reason the job was queued (submission, client completion, regeneration…), shown in the processing record. */
  reason: text().notNull(),
  /** Written guidance of the system administrator for a regeneration (recorded with the run that uses it). */
  instruction: text(),
  requestedBy: uuid(),
  /** Last failure, without personal data (the engine never logs answers or document text). */
  lastError: text(),
  finishedAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("pj_one_active_uq").on(t.requestId).where(sql`status in ('queued', 'running')`),
  index("pj_pick_idx").on(t.status, t.runAfter),
]);

/** One attempt of a job: what the engine did, with which versions, and what came out. Append-only for the app. */
export const processingRuns = pgTable("processing_runs", {
  id: id(),
  jobId: uuid().notNull(),
  requestId: uuid().notNull(),
  waqfId: uuid(),
  attempt: integer().notNull(),
  status: text().default("running").notNull(), // running | ready | needs_client | waiting | blocked | failed
  engineVersion: text().notNull(),
  /** Rule packs applied, with their versions: [{ id, version }]. */
  rules: jsonb().$type<{ id: string; version: string }[]>().default([]).notNull(),
  /** Language model used, if any: { provider, model, promptVersion, calls } — or null when no model was called. */
  model: jsonb().$type<{ provider: string; model: string; promptVersion: string; calls: number } | null>(),
  /** Knowledge-base sources consulted: [{ code, version }]. */
  sources: jsonb().$type<{ code: string; version: string }[]>().default([]).notNull(),
  inputHash: text(),
  instruction: text(),
  outputId: uuid(),
  outputVersion: integer(),
  /** The run's outcome for the reviewer: summary, blockers, warnings, verification result. */
  outcome: jsonb().$type<Record<string, unknown>>(),
  error: text(),
  startedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp({ withTimezone: true }),
}, (t) => [index("pr_request_idx").on(t.requestId, t.startedAt)]);

/** The steps of a run, in order, each with a short auditable rationale (never the model's internal reasoning). */
export const processingSteps = pgTable("processing_steps", {
  id: id(),
  runId: uuid().notNull(),
  requestId: uuid().notNull(),
  waqfId: uuid(),
  seq: integer().notNull(),
  step: text().notNull(), // intake | documents | gaps | workflow | rules | knowledge | analysis | document | verify | handoff
  status: text().notNull(), // ok | warn | skipped | blocked | failed
  /** Facts extracted, rules applied, sources cited, short rationale — no personal data beyond what the request holds. */
  summary: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
  error: text(),
  startedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp({ withTimezone: true }),
}, (t) => [index("ps_run_idx").on(t.runId, t.seq)]);

// ───────────────────────── Knowledge base ─────────────────────────

/**
 * One version of a reference text. `textQuality`: «good» — usable verbatim; «degraded» — the extracted text has known
 * extraction defects (letters reordered by the PDF), searchable but not quoted as the text of the law; «unreadable» —
 * no usable text (scanned images): the source is recorded as missing.
 */
export const kbSources = pgTable("kb_sources", {
  id: id(),
  /** Registry code of the reference (regulatory_references.code). */
  refCode: text().notNull(),
  version: text().notNull(),
  title: text().notNull(),
  issuer: text(),
  bindingLevel: text(), // binding | guidance | internal
  verificationStatus: text().default("pending_verification").notNull(), // verified | pending_verification
  effectiveOn: date(),
  /** Where the text came from (project file name, official URL) and its fingerprint. */
  origin: text().notNull(),
  sha256: text().notNull(),
  textQuality: text().notNull(), // good | degraded | unreadable
  qualityNote: text(),
  chunkCount: integer().default(0).notNull(),
  ingestedAt: createdAt(),
  supersededAt: timestamp({ withTimezone: true }),
  /**
   * Unified knowledge engine (2026-11-06). What the source is — never inferred from its being attached to the project:
   * statute | regulation | official_instruction | official_guide | professional_standard | classical_fiqh |
   * contemporary_book | academic_study | statistical_source | dataset | unclassified.
   */
  refKind: text().default("unclassified").notNull(),
  /** Id in the reference registry (the references module, registry.ts) when the source is a registered instrument. */
  registryId: text(),
  /** Snapshot id in data/references/manifest.json when the text is an official snapshot. */
  registrySnapshot: text(),
  edition: text(),
  publishedOn: date(),
  /** Date from which the text no longer applies (repealed or replaced); null while it applies. */
  repealedOn: date(),
  /** Services this source may be used for (empty: none until linked). */
  services: text().array().default(sql`'{}'::text[]`).notNull(),
  meta: jsonb().default(sql`'{}'::jsonb`).notNull(),
}, (t) => [
  // a corrected text of the same version is a new row (the earlier one is superseded, never deleted)
  uniqueIndex("kbs_ref_version_sha_uq").on(t.refCode, t.version, t.sha256),
  index("kbs_ref_idx").on(t.refCode),
]);

/**
 * Human review of a non-registry source (book, study, guide): the only way such a source becomes citable. Append-only
 * (trigger in security.sql). Registry instruments are reviewed in ref_match_reviews instead.
 */
export const kbSourceReviews = pgTable("kb_source_reviews", {
  id: id(),
  sourceId: uuid().notNull().references(() => kbSources.id),
  reviewerUserId: uuid().notNull(),
  decision: text().notNull(), // accepted | rejected
  /** What was checked: «النص مطابق لصفحات الطبعة المذكورة»، «النسبة إلى الجهة صحيحة». */
  note: text().notNull(),
  at: createdAt(),
}, (t) => [index("kbsr_source_idx").on(t.sourceId, t.at)]);

/** A passage of a source (an article, a question, a principle or a page), kept verbatim with its locator. */
export const kbChunks = pgTable("kb_chunks", {
  id: id(),
  sourceId: uuid().notNull().references(() => kbSources.id, { onDelete: "cascade" }),
  seq: integer().notNull(),
  /** Where the passage is in the source: «المادة الخامسة», «س16», «المبدأ الأول», «ص 12». */
  locator: text().notNull(),
  /** Article number when the passage is an article (for checking a cited «المادة N»). */
  articleNo: integer(),
  kind: text().notNull(), // statute | guidance | interpretation
  text: text().notNull(),
  /** Normalized text used for search only (never shown or quoted). */
  norm: text().notNull(),
  sha256: text().notNull(),
  /** Paragraph within the article (statutes), and the page in the file / as printed (books, guides, studies). */
  paragraphNo: integer(),
  pageFile: integer(),
  pagePrinted: text(),
  /** How the passage text was obtained: official_text | text_layer | ocr | verified_quote. */
  textOrigin: text().default("text_layer").notNull(),
}, (t) => [index("kbc_source_idx").on(t.sourceId, t.seq)]);
