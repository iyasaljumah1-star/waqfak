import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { kbChunks, kbSourceReviews, kbSources } from "@/server/db/schema";
import { Bm25Index, type CorpusDoc } from "@/server/modules/ai/bm25";
import { articleNumber, normForSearch } from "@/server/engine/knowledge/pure";
import { cite } from "@/server/references/citation";
import { REGISTRY } from "@/server/references/registry";
import { decide, sufficiency, type Decision, type Hit, type RefKind, type SourceReview, type Sufficiency } from "./policy";
import { loadVersionStore } from "./store";

/**
 * The single retrieval route of the platform's knowledge engine. Every caller that needs a basis — engine-core's
 * processing pipeline included — goes through here; the citation policy (policy.ts) is applied to every passage, so a
 * passage can never reach a generated text as a basis without the decision that it may be cited.
 *
 * Search: BM25 over the verbatim passages' normalized copy (the assistant's Arabic tokenizer), plus exact lookup when
 * the question names an article («المادة 16», «م16/ف3», «المادة السادسة عشرة»). Filters: service, reference codes,
 * kinds. Each hit carries its source, version, kind, locator and the decision. Superseded versions are returned only
 * for a historical question (and are then flagged), never as the current text.
 */
export type RetrieveQuery = {
  question: string;
  service: string | null;
  asOf: string; // ISO date the answer must hold on
  historical?: boolean;
  refCodes?: string[];
  kinds?: RefKind[];
  needBinding?: boolean;
  limit?: number;
};
export type Retrieved = { hit: Hit; decision: Decision };
export type RetrieveResult = { results: Retrieved[]; citable: Retrieved[]; sufficiency: Sufficiency };

type Row = Omit<Hit, "score"> & { sourceId: string; norm: string };
type Cache = { sig: string; index: Bm25Index; rows: Map<string, Row> };
const g = globalThis as unknown as { __waqfakKnowledge?: Cache };

async function signature(tx: Tx) {
  const [r] = await tx.select({ n: sql<number>`count(*)::int`, last: sql<string>`coalesce(max(${kbSources.ingestedAt})::text, '') || coalesce(max(${kbSources.supersededAt})::text, '')` }).from(kbSources);
  return `${r!.n}:${r!.last}`;
}

async function index(tx: Tx): Promise<Cache> {
  const sig = await signature(tx);
  if (g.__waqfakKnowledge?.sig === sig) return g.__waqfakKnowledge;
  const rows = await tx.select({ c: kbChunks, s: kbSources }).from(kbChunks).innerJoin(kbSources, eq(kbSources.id, kbChunks.sourceId));
  const map = new Map<string, Row>();
  const docs: CorpusDoc[] = rows.map(({ c, s }) => {
    map.set(c.id, {
      chunkId: c.id, sourceId: s.id, refCode: s.refCode, refKind: s.refKind as RefKind, registryId: s.registryId, version: s.version, title: s.title, locator: c.locator,
      articleNo: c.articleNo, paragraphNo: c.paragraphNo, pageFile: c.pageFile, pagePrinted: c.pagePrinted, text: c.text, norm: c.norm, quality: s.textQuality,
      services: s.services, publishedOn: s.publishedOn, effectiveOn: s.effectiveOn, repealedOn: s.repealedOn, superseded: s.supersededAt !== null,
    });
    return { id: c.id, kind: "requirement", title: `${s.title} ${c.locator}`, body: c.norm, href: "", label: s.refCode };
  });
  g.__waqfakKnowledge = { sig, index: new Bm25Index(docs), rows: map };
  return g.__waqfakKnowledge;
}

/** Article (and paragraph) named in a question, if any. */
export function namedArticle(q: string): { article: number; paragraph: number | null } | null {
  const m = q.match(/(?:^|\s)م\s?(\d{1,3})(?:\s?\/\s?ف\s?(\d{1,2}))?/) ?? q.match(/المادة\s*\(?\s*(\d{1,3})\s*\)?(?:[^\d]{0,12}الفقرة\s*\(?\s*(\d{1,2}))?/);
  if (m) return { article: Number(m[1]), paragraph: m[2] ? Number(m[2]) : null };
  const w = q.match(/المادة\s+((?:ال[ء-ي]+)(?:\s+و?ال[ء-ي]+){0,3}(?:\s+بعد\s+ال[ء-ي]+)?)/);
  if (w) {
    const n = articleNumber(`المادة ${w[1]}`);
    const p = q.match(/الفقرة\s*\(?\s*(\d{1,2})\s*\)?/);
    if (n) return { article: n, paragraph: p ? Number(p[1]) : null };
  }
  return null;
}

export async function retrieve(tx: Tx, q: RetrieveQuery): Promise<RetrieveResult> {
  const c = await index(tx);
  const limit = q.limit ?? 6;
  const keep = (r: Row) => (!q.refCodes?.length || q.refCodes.includes(r.refCode)) && (!q.kinds?.length || q.kinds.includes(r.refKind)) && (q.historical || !r.superseded);
  const picked: { row: Row; score: number }[] = [];
  const seen = new Set<string>();
  const named = namedArticle(q.question);
  if (named) {
    // without a reference code, the article is looked up only in the references the question's words point to
    const hinted = new Set(c.index.search(q.question, { limit: 30 }).map((h) => c.rows.get(h.doc.id)?.refCode).filter(Boolean));
    for (const r of c.rows.values()) {
      if (!keep(r) || r.articleNo !== named.article) continue;
      if (named.paragraph !== null && r.paragraphNo !== named.paragraph) continue;
      if (!q.refCodes?.length && !hinted.has(r.refCode)) continue;
      picked.push({ row: r, score: 1000 });
      seen.add(r.chunkId);
    }
  }
  for (const h of c.index.search(q.question, { limit: 80 })) {
    const r = c.rows.get(h.doc.id);
    if (!r || seen.has(r.chunkId) || !keep(r)) continue;
    picked.push({ row: r, score: h.score });
    seen.add(r.chunkId);
    if (picked.length >= limit * 6) break;
  }
  // reranking: BM25 scores words one by one; a passage that contains the question's word pairs («بين السعوديين»,
  // «الربع الأول») is closer to what is asked than one that only repeats its frequent words
  const qn = normForSearch(q.question).split(/\s+/).filter((w) => w.length > 1);
  const pairs = qn.slice(1).map((w, i) => `${qn[i]} ${w}`);
  for (const p of picked) {
    if (p.score >= 1000) continue;
    const hits = pairs.filter((x) => p.row.norm.includes(x)).length;
    p.score = p.score * (1 + 0.35 * hits);
  }
  picked.sort((a, b) => b.score - a.score);
  // every candidate is decided before the list is cut, so passages that cannot apply never crowd out ones that can
  const top = picked;
  // evidence for the decisions, read now inside the caller's transaction
  const registryIds = [...new Set(top.map((p) => p.row.registryId).filter((x): x is string => !!x))];
  const store = await loadVersionStore(tx, registryIds);
  const sourceIds = [...new Set(top.filter((p) => !p.row.registryId).map((p) => p.row.sourceId))];
  const reviews = sourceIds.length ? await tx.select().from(kbSourceReviews).where(inArray(kbSourceReviews.sourceId, sourceIds)) : [];
  const results: Retrieved[] = top.map(({ row, score }) => {
    const { sourceId, norm: _norm, ...hit } = row;
    void _norm;
    const registry = row.registryId && row.articleNo !== null ? cite(REGISTRY, store, { refId: row.registryId, article: row.articleNo, paragraph: row.paragraphNo ?? undefined, asOf: q.asOf, historical: q.historical }) : null;
    const rv: SourceReview[] = reviews.filter((x) => x.sourceId === sourceId).map((x) => ({ decision: x.decision as "accepted" | "rejected", at: x.at.toISOString() }));
    return { hit: { ...hit, score }, decision: decide({ ...hit, score }, { service: q.service, asOf: q.asOf, historical: q.historical }, { registry, reviews: rv }) };
  });
  const applicable = results.filter((r) => r.decision.citable || (r.decision as { refusal: string }).refusal !== "not_applicable");
  const rank = (r: Retrieved) => (r.decision.citable ? 0 : (r.decision as { refusal: string }).refusal === "not_applicable" ? 2 : 1);
  const ordered = [...results].sort((a, b) => rank(a) - rank(b) || b.hit.score - a.hit.score).slice(0, limit);
  const citable = ordered.filter((r) => r.decision.citable);
  return { results: ordered, citable, sufficiency: sufficiency(applicable.length ? applicable : results, { binding: !!q.needBinding }) };
}

/**
 * Which of these references can serve as a basis now: the current text exists and is citable under the policy — an
 * accepted comparison review for a registry instrument in force on the date, an accepted source review (and readable
 * text) for any other source. Replaces engine-core's reliance on the admin flag regulatory_references.verification_status,
 * which a person could set without any comparison of the text.
 */
export async function readyRefCodes(tx: Tx, refCodes: string[], asOf: string): Promise<Set<string>> {
  const ready = new Set<string>();
  if (!refCodes.length) return ready;
  const sources = await tx.select().from(kbSources).where(inArray(kbSources.refCode, refCodes));
  const current = sources.filter((s) => s.supersededAt === null && (!s.repealedOn || s.repealedOn > asOf));
  const regIds = [...new Set(current.map((s) => s.registryId).filter((x): x is string => !!x))];
  const store = await loadVersionStore(tx, regIds);
  const reviews = await tx.select().from(kbSourceReviews).where(inArray(kbSourceReviews.sourceId, current.map((s) => s.id).concat(["00000000-0000-0000-0000-000000000000"])));
  for (const s of current) {
    if (s.registryId) {
      const v = store.versionAt(s.registryId, asOf);
      const accepted = v ? store.matchRuns(v.id).some((r) => store.reviews(r.id).some((x) => x.decision === "accepted")) : false;
      if (accepted) ready.add(s.refCode);
      continue;
    }
    if (s.textQuality !== "good") continue;
    const latest = reviews.filter((r) => r.sourceId === s.id).sort((a, b) => b.at.getTime() - a.at.getTime())[0];
    if (latest?.decision === "accepted") ready.add(s.refCode);
  }
  return ready;
}
