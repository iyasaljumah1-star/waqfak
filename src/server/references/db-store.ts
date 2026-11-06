import "server-only";
import { and, desc, eq, isNotNull, lte } from "drizzle-orm";
import type { Tx } from "../db";
import { refFetchAttempts, refMatchReviews, refMatchRuns, refSources, refUnits, refVersions } from "../db/schema/references";
import type { RegistryEntry } from "./registry";
import type { FetchAttempt } from "./types";
import type { MatchReview, MatchRun, RefVersion } from "./versions";

/**
 * Persistence of the reference registry. Runs inside the caller's transaction (system context: the tables are closed to
 * user contexts by row-level security). History tables are insert-only; the database refuses updates and deletes.
 */

export async function registerSource(tx: Tx, e: RegistryEntry): Promise<string> {
  const facts = { issuer: e.issuer, instrument: e.instrument, publication: e.publication, effective: e.effective, status: e.status, amendedBy: e.amendedBy, repealedBy: e.repealedBy, repeals: e.repeals, officialSources: e.officialSources, openQuestions: e.openQuestions };
  const row = {
    code: e.id,
    officialName: e.officialName,
    kind: e.kind,
    binding: e.binding,
    statusRecorded: e.status.value ?? "unknown",
    facts,
    candidateServices: e.candidateServices,
    lastVerifiedAt: e.lastVerifiedAt ? new Date(e.lastVerifiedAt) : null,
  };
  const [r] = await tx
    .insert(refSources)
    .values(row)
    .onConflictDoUpdate({ target: refSources.code, set: { ...row, updatedAt: new Date() } })
    .returning({ id: refSources.id });
  return r!.id;
}

/** Stores a version and its units. The same text for the same date is stored once; returns the stored row id. */
export async function appendVersion(tx: Tx, sourceId: string, v: RefVersion): Promise<string> {
  const inserted = await tx
    .insert(refVersions)
    .values({ sourceId, label: v.label, effectiveFrom: v.effectiveFrom, sourceUrl: v.source.url, retrievedAt: new Date(v.source.retrievedAt), via: v.source.via, sha256: v.source.sha256, text: v.text })
    .onConflictDoNothing()
    .returning({ id: refVersions.id });
  if (inserted[0]) {
    if (v.units.length) {
      await tx.insert(refUnits).values(v.units.map((u) => ({ versionId: inserted[0]!.id, locator: u.locator, article: u.article, paragraph: u.paragraph, item: u.item, heading: u.heading, text: u.text })));
    }
    return inserted[0].id;
  }
  const cond = v.effectiveFrom === null ? and(eq(refVersions.sourceId, sourceId), eq(refVersions.sha256, v.source.sha256)) : and(eq(refVersions.sourceId, sourceId), eq(refVersions.sha256, v.source.sha256), eq(refVersions.effectiveFrom, v.effectiveFrom));
  const [existing] = await tx.select({ id: refVersions.id }).from(refVersions).where(cond).limit(1);
  return existing!.id;
}

/** The stored version applying on a date (latest effective_from on or before it). */
export async function versionAt(tx: Tx, sourceCode: string, isoDate: string) {
  const [row] = await tx
    .select({ id: refVersions.id, label: refVersions.label, effectiveFrom: refVersions.effectiveFrom, sha256: refVersions.sha256, sourceUrl: refVersions.sourceUrl })
    .from(refVersions)
    .innerJoin(refSources, eq(refSources.id, refVersions.sourceId))
    .where(and(eq(refSources.code, sourceCode), isNotNull(refVersions.effectiveFrom), lte(refVersions.effectiveFrom, isoDate)))
    .orderBy(desc(refVersions.effectiveFrom), desc(refVersions.createdAt))
    .limit(1);
  return row ?? null;
}

export async function appendMatchRun(tx: Tx, versionDbId: string, r: MatchRun, details: unknown): Promise<string> {
  const [row] = await tx
    .insert(refMatchRuns)
    .values({ versionId: versionDbId, candidateLabel: r.candidateLabel, candidateSha256: r.candidateSha256, outcome: r.outcome, perArticle: r.perArticle, details: details as object, ranAt: new Date(r.ranAt) })
    .returning({ id: refMatchRuns.id });
  return row!.id;
}

export async function appendReview(tx: Tx, runDbId: string, r: Omit<MatchReview, "runId"> & { reviewerUserId: string }): Promise<void> {
  await tx.insert(refMatchReviews).values({ runId: runDbId, reviewerUserId: r.reviewerUserId, decision: r.decision, note: r.note, reviewedAt: new Date(r.at) });
}

export async function appendFetchAttempt(tx: Tx, a: FetchAttempt): Promise<void> {
  await tx.insert(refFetchAttempts).values({ sourceCode: a.refId, url: a.url, attemptedAt: new Date(a.at), ok: a.ok, via: a.via, failureKind: a.failure?.kind ?? null, failureDetail: a.failure?.detail ?? null });
}
