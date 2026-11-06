import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { kbChunks, kbSourceReviews, kbSources } from "@/server/db/schema";
import { Bm25Index, type CorpusDoc } from "@/server/modules/ai/bm25";
import { tokenize } from "@/server/modules/ai/text";
import { articleNumber, normForSearch } from "@/server/engine/knowledge/pure";
import { cite } from "@/server/references/citation";
import { OFFICIAL_HOSTS, CITABLE_OUTCOMES } from "@/server/references/types";
import { REGISTRY, getEntry, statusAt } from "@/server/references/registry";
import { decide, SCHOOL_QUESTION, sufficiency, DEFAULT_REVIEW_ROLE, type Decision, type Hit, type RefKind, type ReviewRole, type SourceReview, type Sufficiency } from "./policy";
import { loadVersionStore } from "./store";
import { auditedReviewIds } from "./review";

/**
 * The single retrieval route to the knowledge base (kb_* tables). engine-core's processing pipeline goes through here;
 * the citation policy (policy.ts) is applied to every passage, so a passage cannot reach a generated text as a basis
 * without the decision that it may be cited. (The public assistant on main still has its own index of catalog
 * descriptions — modules/ai — outside this route: see the report.)
 *
 * Search: BM25 over the passages' normalized copy, exact lookup when the question names an article («المادة 16»,
 * «م16/ف3», «المادة السادسة عشرة»), and reranking by the question's word pairs. Relevance: the share of the question's
 * content words found in the passage body — words that only name the source do not count. Filters: service (required;
 * "*" means every service, explicitly), reference codes, kinds, the date, historical questions.
 */
export type RetrieveQuery = {
  question: string;
  /** Service code, or "*" to search across every service explicitly. */
  service: string;
  asOf: string;
  historical?: boolean;
  refCodes?: string[];
  kinds?: RefKind[];
  needBinding?: boolean;
  limit?: number;
};
export type Retrieved = { hit: Hit; decision: Decision };
export type RetrieveResult = { results: Retrieved[]; citable: Retrieved[]; sufficiency: Sufficiency };

type Row = Omit<Hit, "score" | "coverage"> & { sourceId: string; norm: string; tokens: Set<string>; seq: string[]; titleTokens: Set<string>; startOn: string | null; ingestedAt: string };
type Cache = { sig: string; index: Bm25Index; rows: Map<string, Row>; df: Map<string, number> };
const g = globalThis as unknown as { __waqfakKnowledge?: Cache };

/** Changes whenever a source or passage is added or superseded (or, were it ever allowed, edited). */
async function signature(tx: Tx): Promise<string> {
  const res = await tx.execute(sql`select (select count(*) || ':' || coalesce(sum(hashtext(id::text || coalesce(superseded_at::text, '') || services::text || text_quality || ref_kind || coalesce(repealed_on::text, '') || meta::text)), 0) from kb_sources) || '|' || (select count(*) from kb_chunks) as sig`);
  return (res as unknown as { rows: { sig: string }[] }).rows[0]!.sig;
}

async function index(tx: Tx): Promise<Cache> {
  const sig = await signature(tx);
  if (g.__waqfakKnowledge?.sig === sig) return g.__waqfakKnowledge;
  const rows = await tx.select({ c: kbChunks, s: kbSources }).from(kbChunks).innerJoin(kbSources, eq(kbSources.id, kbChunks.sourceId));
  const map = new Map<string, Row>();
  const docs: CorpusDoc[] = rows.map(({ c, s }) => {
    const meta = (s.meta ?? {}) as { reviewRole?: ReviewRole; blockedPages?: string[]; blockedLocators?: string[] };
    map.set(c.id, {
      chunkId: c.id, sourceId: s.id, refCode: s.refCode, refKind: s.refKind as RefKind, registryId: s.registryId, version: s.version, title: s.title, locator: c.locator,
      articleNo: c.articleNo, paragraphNo: c.paragraphNo, pageFile: c.pageFile, pagePrinted: c.pagePrinted, text: c.text, textOrigin: c.textOrigin, quality: s.textQuality,
      services: s.services, publishedOn: s.publishedOn, effectiveOn: s.effectiveOn, repealedOn: s.repealedOn, superseded: s.supersededAt !== null,
      blocked: (!!c.pagePrinted && !!meta.blockedPages?.includes(c.pagePrinted)) || !!meta.blockedLocators?.includes(c.locator),
      reviewRole: meta.reviewRole ?? DEFAULT_REVIEW_ROLE[s.refKind as RefKind] ?? "legal",
      norm: c.norm, tokens: new Set(tokenize(c.text)), seq: tokenize(c.text), titleTokens: new Set(tokenize(`${s.title} ${s.issuer ?? ""}`)),
      // a version's own legal start: its effective date, else its publication date; never the date it was loaded
      startOn: s.effectiveOn ?? s.publishedOn ?? null, ingestedAt: s.ingestedAt.toISOString(),
    });
    return { id: c.id, kind: "requirement", title: `${s.title} ${c.locator}`, body: c.norm, href: "", label: s.refCode };
  });
  const df = new Map<string, number>();
  for (const r of map.values()) for (const t of r.tokens) df.set(t, (df.get(t) ?? 0) + 1);
  g.__waqfakKnowledge = { sig, index: new Bm25Index(docs), rows: map, df };
  return g.__waqfakKnowledge;
}

/**
 * Reviews of these sources whose author still may give them: an active, unlocked user who holds, now,
 * «knowledge.review.<field>». A review loses its effect when the permission is withdrawn (independent review N3).
 */
async function authorisedReviews(tx: Tx, sourceIds: string[]) {
  if (!sourceIds.length) return [];
  const rows = await tx.select().from(kbSourceReviews).where(inArray(kbSourceReviews.sourceId, sourceIds));
  if (!rows.length) return rows;
  const ok = (await tx.execute(sql`select distinct u.id::text || ':' || substr(p.key, 18) as k from users u
    join user_roles ur on ur.user_id = u.id join role_permissions rp on rp.role_id = ur.role_id join permissions p on p.id = rp.permission_id
    where p.key like 'knowledge.review.%' and u.status = 'active' and (u.locked_until is null or u.locked_until < now())`)) as unknown as { rows: { k: string }[] };
  const allowed = new Set(ok.rows.map((r) => r.k));
  // and only a review with its entry in the audit trail (recorded through knowledge/review.ts)
  const audited = await auditedReviewIds(tx, "kb_source_review", rows.map((r) => r.id));
  return rows.filter((r) => allowed.has(`${r.reviewerUserId}:${r.reviewerRole}`) && audited.has(r.id));
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

/** Words naming the school describe the kind of source wanted (the school rule handles them), not the answer. */
const SCHOOL_WORDS = new Set(tokenize("المذهب الحنابلة الحنبلي مذهب الإمام أحمد"));

/** Window (in content words) within which the question's words must stand together to count (review N2/P1e). */
export const COVERAGE_WINDOW = 40;

/**
 * Relevance of a passage to a question: the idf-weighted share of the question's content words that the passage holds
 * TOGETHER, within one window of COVERAGE_WINDOW content words. Words that only name the source, and words naming the
 * school, are left out. Common waqf words («وقف», «ناظر», «حكم») weigh little; a rare word found far from the others
 * (a country named in a list, the matter asked about in another chapter) does not make the passage cover the question.
 */
export function coverageOf(question: string, r: { tokens: Set<string>; seq?: string[]; titleTokens: Set<string> }, df?: Map<string, number>, n = 1, window = COVERAGE_WINDOW): number {
  const words = [...new Set(tokenize(question))].filter((w) => !r.titleTokens.has(w) && !SCHOOL_WORDS.has(w));
  if (!words.length) return 0;
  const idf = (w: string) => Math.log(1 + n / Math.max(1, df?.get(w) ?? 0.5));
  const weight = new Map(words.map((w) => [w, idf(w)]));
  const total = [...weight.values()].reduce((a, b) => a + b, 0);
  const seq = r.seq ?? [...r.tokens];
  // best window: slide over the passage, counting each question word once. Two shares must both reach the bar, so
  // neither a single rare word (a country named in a list) nor the common waqf words alone make a passage relevant:
  // the idf-weighted share of the question's words, and the plain share of them (P1e)
  let best = 0;
  const count = new Map<string, number>();
  let got = 0;
  let gotN = 0;
  for (let i = 0; i < seq.length; i++) {
    const w = seq[i];
    if (weight.has(w)) {
      if (!count.get(w)) { got += weight.get(w)!; gotN++; }
      count.set(w, (count.get(w) ?? 0) + 1);
    }
    const out = i - window;
    if (out >= 0 && weight.has(seq[out])) {
      const c = count.get(seq[out])! - 1;
      count.set(seq[out], c);
      if (!c) { got -= weight.get(seq[out])!; gotN--; }
    }
    const share = Math.min(total ? got / total : 0, gotN / words.length);
    if (share > best) best = share;
  }
  return best;
}

/**
 * For a historical question: each version of a (non-registry) source is in force from its own legal start (effective
 * date, else publication date) until the next version's start. A version with no known start cannot be placed on the
 * calendar, so it is «unknown» — the date it was loaded into the knowledge base says nothing about the law (review B10).
 */
function validityOn(c: Cache, picked: Row[], asOf: string): Map<string, Pick<Hit, "validFrom" | "validTo" | "validity">> {
  const out = new Map<string, Pick<Hit, "validFrom" | "validTo" | "validity">>();
  const codes = new Set(picked.map((r) => r.refCode));
  const versions = new Map<string, Map<string, string | null>>(); // refCode -> version -> start
  for (const r of c.rows.values()) if (codes.has(r.refCode)) {
    const m = versions.get(r.refCode) ?? new Map<string, string | null>();
    m.set(r.version, r.startOn);
    versions.set(r.refCode, m);
  }
  for (const r of picked) {
    const all = [...(versions.get(r.refCode) ?? new Map()).entries()];
    const from = r.startOn;
    if (!from) {
      out.set(r.chunkId, { validFrom: null, validTo: null, validity: "unknown" });
      continue;
    }
    // the next start among the other versions; an undated sibling makes the end unknowable
    if (all.some(([v, st]) => v !== r.version && !st)) {
      out.set(r.chunkId, { validFrom: from, validTo: null, validity: "unknown" });
      continue;
    }
    const next = all.map(([, st]) => st as string).filter((st) => st > from).sort()[0] ?? null;
    const validity = from > asOf ? "later" : next && next <= asOf ? "earlier" : "in_force";
    out.set(r.chunkId, { validFrom: from, validTo: next, validity });
  }
  return out;
}

const normCmp = (s: string) => normForSearch(s).replace(/\s+/g, " ").trim();
const refusalOf = (d: Decision) => (d.citable ? null : d.refusal);

export async function retrieve(tx: Tx, q: RetrieveQuery): Promise<RetrieveResult> {
  const c = await index(tx);
  const limit = q.limit ?? 6;
  const keep = (r: Row) => (!q.refCodes?.length || q.refCodes.includes(r.refCode)) && (!q.kinds?.length || q.kinds.includes(r.refKind)) && (q.historical || !r.superseded);
  const picked: { row: Row; score: number; coverage: number }[] = [];
  const seen = new Set<string>();
  const named = namedArticle(q.question);
  let missingArticle: string | null = null;
  // a question naming an article (and paragraph) is answered from that unit only
  let namedUnits: Set<string> | null = null;
  if (named) {
    const hinted = new Set(c.index.search(q.question, { limit: 30 }).map((h) => c.rows.get(h.doc.id)?.refCode).filter(Boolean));
    const scope = [...c.rows.values()].filter((r) => keep(r) && (q.refCodes?.length || hinted.has(r.refCode)) && r.articleNo !== null);
    const found = scope.filter((r) => r.articleNo === named.article && (named.paragraph === null || r.paragraphNo === named.paragraph));
    for (const r of found) {
      picked.push({ row: r, score: 1000, coverage: 1 });
      seen.add(r.chunkId);
    }
    if (found.length) namedUnits = new Set(found.map((r) => r.chunkId));
    // an article named but absent from the references in scope is never answered from other articles
    // (also when no reference in scope has numbered articles at all: the article cannot be found, so nothing answers it)
    if (!found.length) missingArticle = `المادة ${named.article}${named.paragraph !== null ? ` الفقرة ${named.paragraph}` : ""}`;
  }
  // reranking by the question's word pairs: BM25 scores words one by one
  const qn = normForSearch(q.question).split(/\s+/).filter((w) => w.length > 1);
  const pairs = qn.slice(1).map((w, i) => `${qn[i]} ${w}`);
  for (const h of c.index.search(q.question, { limit: 120 })) {
    const r = c.rows.get(h.doc.id);
    if (!r || seen.has(r.chunkId) || !keep(r)) continue;
    const bonus = pairs.filter((x) => r.norm.includes(x)).length;
    picked.push({ row: r, score: h.score * (1 + 0.35 * bonus), coverage: coverageOf(q.question, r, c.df, c.rows.size) });
    seen.add(r.chunkId);
    if (picked.length >= limit * 8) break;
  }
  picked.sort((a, b) => b.score - a.score);
  const registryIds = [...new Set(picked.map((p) => p.row.registryId).filter((x): x is string => !!x))];
  const store = await loadVersionStore(tx, registryIds);
  const sourceIds = [...new Set(picked.filter((p) => !p.row.registryId).map((p) => p.row.sourceId))];
  const reviews = await authorisedReviews(tx, sourceIds);
  const school = SCHOOL_QUESTION.test(q.question);
  // C07 is a Hanbali opinion: whatever the wording, its basis must include a classical Hanbali book (review B8)
  const needSchool = school || q.service === "C07";
  const validity = q.historical ? validityOn(c, picked.map((p) => p.row), q.asOf) : null;
  const results: Retrieved[] = picked.map(({ row, score, coverage }) => {
    const { sourceId, norm: _n, tokens: _t, seq: _s, titleTokens: _tt, startOn: _so, ingestedAt: _ia, ...base } = row;
    void _n; void _t; void _s; void _tt; void _so; void _ia;
    const hit: Hit = { ...base, coverage, score, provenance: "passage" };
    if (validity) Object.assign(hit, validity.get(row.chunkId));
    let registry = null;
    let registryTextMatches = false;
    if (row.registryId && row.articleNo !== null) {
      registry = cite(REGISTRY, store, { refId: row.registryId, article: row.articleNo, paragraph: row.paragraphNo ?? undefined, asOf: q.asOf, historical: q.historical });
      if (registry.ok) {
        // the passage must hold the very text the guard authorised; what is passed on is the guard's text
        registryTextMatches = normCmp(row.text).includes(normCmp(registry.display.text));
        if (registryTextMatches) {
          // name, locator, version, heading and text all from the guard: nothing of the knowledge base's own copy (its
          // heading line, title or locator) reaches the model or the citation (review N1/P5c)
          const d = registry.display;
          hit.text = `المادة ${row.articleNo}${d.heading ? `: ${d.heading}` : ""}\n${d.text}`;
          hit.title = d.refName;
          hit.locator = d.locator;
          hit.validFrom = d.effectiveFrom;
          hit.provenance = "guard";
        }
      }
    } else if (row.registryId) {
      // a registry instrument's passage without an article cannot be checked by the guard: never passed on as its text
      hit.provenance = "passage";
    }
    const rv: SourceReview[] = reviews.filter((x) => x.sourceId === sourceId).map((x) => ({ decision: x.decision as "accepted" | "rejected", at: x.at.toISOString(), role: x.reviewerRole as ReviewRole, chunkId: x.chunkId }));
    return { hit, decision: decide(hit, { service: q.service, asOf: q.asOf, historical: q.historical, schoolQuestion: school }, { registry, registryTextMatches, reviews: rv }) };
  });
  const rank = (r: Retrieved) => ({ null: 0, not_applicable: 3, not_relevant: 2 } as Record<string, number>)[String(refusalOf(r.decision))] ?? 1;
  const ordered = [...results].sort((a, b) => rank(a) - rank(b) || b.hit.score - a.hit.score).slice(0, limit);
  const basis = namedUnits ? ordered.filter((r) => namedUnits!.has(r.hit.chunkId)) : ordered;
  const citable = missingArticle ? [] : basis.filter((r) => r.decision.citable);
  return { results: ordered, citable, sufficiency: sufficiency(basis, { binding: !!q.needBinding, school: needSchool, missingArticle }) };
}

/**
 * Which of these references can serve as a basis now. A registry instrument: in force on the date, its version stored
 * from an official host, and an accepted comparison with at least one article whose outcome allows citation. Any other
 * source: readable text and an accepted source review by a reviewer of the required field. Replaces engine-core's
 * reliance on the admin flag regulatory_references.verification_status, set without any comparison of the text.
 */
export async function readyRefCodes(tx: Tx, refCodes: string[], asOf: string): Promise<Set<string>> {
  const ready = new Set<string>();
  if (!refCodes.length) return ready;
  const sources = await tx.select().from(kbSources).where(inArray(kbSources.refCode, refCodes));
  const current = sources.filter((s) => s.supersededAt === null && (!s.repealedOn || s.repealedOn > asOf));
  const regIds = [...new Set(current.map((s) => s.registryId).filter((x): x is string => !!x))];
  const store = await loadVersionStore(tx, regIds);
  const reviews = await authorisedReviews(tx, current.map((s) => s.id));
  for (const s of current) {
    if (s.registryId) {
      const entry = getEntry(s.registryId);
      const st = entry ? statusAt(entry, asOf) : "unknown";
      if (st !== "in_force" && st !== "in_force_amended") continue;
      const v = store.versionAt(s.registryId, asOf);
      if (!v) continue;
      let host = "";
      try {
        host = new URL(v.source.url).host;
      } catch {
        /* not official */
      }
      if (!(OFFICIAL_HOSTS as readonly string[]).includes(host)) continue;
      const ok = store.matchRuns(v.id).some((r) => store.reviews(r.id).some((x) => x.decision === "accepted") && Object.values(r.perArticle).some((o) => CITABLE_OUTCOMES.has(o)));
      if (ok) ready.add(s.refCode);
      continue;
    }
    if (s.textQuality !== "good") continue;
    const role = ((s.meta ?? {}) as { reviewRole?: ReviewRole }).reviewRole ?? DEFAULT_REVIEW_ROLE[s.refKind as RefKind];
    const latest = reviews.filter((r) => r.sourceId === s.id && r.chunkId === null && r.reviewerRole === role).sort((a, b) => b.at.getTime() - a.at.getTime())[0];
    if (latest?.decision === "accepted") ready.add(s.refCode);
  }
  return ready;
}
