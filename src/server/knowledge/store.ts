import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { auditedReviewIds } from "./review";
import { refMatchReviews, refMatchRuns, refMatchUnits, refSources, refUnits, refVersionConfirmations, refVersions } from "@/server/db/schema/references";
import { InMemoryVersionStore, type VersionStore } from "@/server/references/versions";
import type { MatchOutcome, RetrievalVia } from "@/server/references/types";

/**
 * Read-only view of the reference registry's stored versions, comparisons and human reviews (ref_* tables) as the
 * VersionStore the citation guard (references/citation.ts) works on. Loaded per call inside the caller's transaction,
 * so the guard always decides on what the database holds now — never on a cache that a review has outdated.
 */
export async function loadVersionStore(tx: Tx, registryIds: string[]): Promise<VersionStore> {
  const store = new InMemoryVersionStore();
  if (!registryIds.length) return store;
  const versions = await tx
    .select({ v: refVersions, code: refSources.code })
    .from(refVersions)
    .innerJoin(refSources, eq(refSources.id, refVersions.sourceId))
    .where(inArray(refSources.code, registryIds));
  if (!versions.length) return store;
  const ids = versions.map((x) => x.v.id);
  const [units, confirmations, runs] = await Promise.all([
    tx.select().from(refUnits).where(inArray(refUnits.versionId, ids)),
    tx.select({ versionId: refVersionConfirmations.versionId }).from(refVersionConfirmations).where(inArray(refVersionConfirmations.versionId, ids)),
    tx.select().from(refMatchRuns).where(inArray(refMatchRuns.versionId, ids)),
  ]);
  const all = runs.length ? await tx.select().from(refMatchReviews).where(inArray(refMatchReviews.runId, runs.map((r) => r.id))) : [];
  // stage 11, D: each review is of one unit (an article of the run); a review that names no unit, or a unit of
  // another run, authorises nothing and is not loaded as a review of anything
  const unitRows = runs.length ? await tx.select().from(refMatchUnits).where(inArray(refMatchUnits.runId, runs.map((r) => r.id))) : [];
  const unitById = new Map(unitRows.map((u) => [u.id, u]));
  // a comparison review counts only from an active, unlocked user holding «knowledge.review.legal» (independent
  // review N3); the phase-1 tables accept any reviewer id, so the authority is checked here, where the guard reads
  const reviewerIds = [...new Set(all.map((r) => r.reviewerUserId))];
  const allowed = reviewerIds.length
    ? new Set(
        ((await tx.execute(sql`select u.id::text as id from users u where u.id = any(${sql.raw(`array[${reviewerIds.map((x) => `'${x.replace(/[^0-9a-f-]/gi, "")}'::uuid`).join(",")}]`)})
          and u.status = 'active' and (u.locked_until is null or u.locked_until < now())
          and exists (select 1 from user_roles ur join role_permissions rp on rp.role_id = ur.role_id join permissions p on p.id = rp.permission_id
                      where ur.user_id = u.id and p.key = 'knowledge.review.legal')`)) as unknown as { rows: { id: string }[] }).rows.map((r) => r.id),
      )
    : new Set<string>();
  // an acceptance counts only with its audit entry (recorded through knowledge/review.ts)
  // the text an acceptance attests is the compared version's text (its sha256): checked against the version now stored
  // stage 11, D: the text a unit's acceptance attests is that article's stored text (the unit's fingerprint, recomputed
  // by the database now: an article whose stored text no longer matches its unit is not attested by it)
  const shaNow = new Map<string, string | null>(
    unitRows.length
      ? ((await tx.execute(sql`select u.id::text as id, ref_article_sha(r.version_id, u.article) as h from ref_match_units u join ref_match_runs r on r.id = u.run_id
          where u.run_id = any(${sql.raw(`array[${runs.map((r) => `'${r.id.replace(/[^0-9a-f-]/gi, "")}'::uuid`).join(",")}]`)})`)) as unknown as { rows: { id: string; h: string | null }[] }).rows.map((r) => [r.id, r.h])
      : [],
  );
  const unitReviews = all.filter((r) => r.unitId && unitById.get(r.unitId)?.runId === r.runId);
  const audited = await auditedReviewIds(tx, "ref_match_review", unitReviews.map((r) => {
    const u = unitById.get(r.unitId!)!;
    return { id: r.id, reviewerUserId: r.reviewerUserId, decision: r.decision, target: u.id, role: "legal", sessionId: r.sessionId, expectedTextSha256: shaNow.get(u.id) === u.textSha256 ? u.textSha256 : "changed" };
  }));
  // a rejection counts only when it is genuine — sealed, audited, session-bound (R8-10, order of 2026-11-09 «تاسعاً»/4):
  // an unsealed row, even one naming a current holder of the legal field, may be an impersonation and withdraws nothing
  // (it stays in the table for the reviewer to see); a genuine rejection keeps counting after its author leaves the
  // field. An acceptance needs both its seal and its author's current authority. None is dated in the future (the
  // database refuses it)
  const reviews = unitReviews.filter((r) => (r.decision !== "accepted" ? audited.has(r.id) : allowed.has(r.reviewerUserId) && audited.has(r.id)));
  const confirmed = new Set(confirmations.map((c) => c.versionId));
  for (const { v, code } of versions) {
    store.addVersion({
      id: v.id,
      refId: code,
      label: v.label,
      effectiveFrom: v.effectiveFrom ?? null,
      source: { url: v.sourceUrl, retrievedAt: v.retrievedAt.toISOString(), via: v.via as RetrievalVia, sha256: v.sha256, directConfirmed: confirmed.has(v.id) },
      text: v.text,
      units: units
        .filter((u) => u.versionId === v.id)
        .map((u) => ({ locator: u.locator, article: u.article, paragraph: u.paragraph, item: u.item, heading: u.heading, text: u.text })),
      createdAt: v.createdAt.toISOString(),
    });
  }
  for (const r of runs) {
    store.addMatchRun({ id: r.id, versionId: r.versionId, candidateLabel: r.candidateLabel, candidateSha256: r.candidateSha256, outcome: r.outcome as MatchOutcome, perArticle: r.perArticle as Record<string, MatchOutcome>, ranAt: r.ranAt.toISOString() });
  }
  for (const rv of reviews) store.addReview({ runId: rv.runId, unit: unitById.get(rv.unitId!)!.unitKey, reviewer: rv.reviewerUserId, at: rv.reviewedAt.toISOString(), decision: rv.decision as "accepted" | "rejected", note: rv.note });
  return store;
}
