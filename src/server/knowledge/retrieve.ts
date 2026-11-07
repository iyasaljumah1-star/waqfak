import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { kbChunks, kbSources } from "@/server/db/schema";
import { Bm25Index, type CorpusDoc } from "@/server/modules/ai/bm25";
import { tokenize } from "@/server/modules/ai/text";
import { articleNumber, normForSearch } from "@/server/engine/knowledge/pure";
import { cite } from "@/server/references/citation";
import { OFFICIAL_HOSTS, CITABLE_OUTCOMES } from "@/server/references/types";
import { REGISTRY, getEntry, statusAt } from "@/server/references/registry";
import { decide, draftSufficiency, draftUse, passageStatus, SCHOOL_QUESTION, sufficiency, DEFAULT_REVIEW_ROLE, MIN_COVERAGE, type Decision, type DraftUse, type Hit, type RefKind, type ReviewRole, type SourceReview, type Sufficiency } from "./policy";
import { loadVersionStore } from "./store";
import { authorisedReviews } from "./review";

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
/** decision: may it be cited in a FINAL document; draft: may it serve an internal draft, and with which flags. */
export type Retrieved = { hit: Hit; decision: Decision; draft: DraftUse };
export type RetrieveResult = {
  results: Retrieved[];
  /** Citable in a final document (human-reviewed, B13). */
  citable: Retrieved[];
  sufficiency: Sufficiency;
  /** Usable in an internal draft (reviewed or not, flagged). */
  usable: Retrieved[];
  draftSufficiency: Sufficiency;
};

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

/** Arabic-Indic digits as ASCII, for reading numbers (the text itself is never changed). */
export const asciiDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));

/**
 * Article (and paragraph) named in a question, if any. A number is an article number only when it stands alone (review
 * Q3): «م 2025» is a year; «500 م2», «500  م²», «30 م³», «المساحة م2 500», «بالـ م2: 500» are areas and volumes — a bare
 * «م2» or «م3» (no «/ف») is read as a unit, never as an article; «المادة 2» and «م2/ف1» are articles. Arabic-Indic
 * digits are read as digits («م١٦/ف٣» is م16/ف3).
 */
export function namedArticle(question: string): { article: number; paragraph: number | null } | null {
  const q = asciiDigits(question);
  const m = q.match(/(?:^|[\s(،,])(?<!\d[\s:ـ]*)م\s?(\d{1,3})(?![\d²³])(?:\s?\/\s?ف\s?(\d{1,2})(?!\d))?/);
  if (m) {
    const unitLike = !m[2] && (m[1] === "2" || m[1] === "3");
    const numberAfter = !m[2] && /^[\s:ـ]*\d/.test(q.slice((m.index ?? 0) + m[0].length));
    if (!unitLike && !numberAfter) return { article: Number(m[1]), paragraph: m[2] ? Number(m[2]) : null };
  }
  const a = q.match(/المادة\s*\(?\s*(\d{1,3})(?!\d)\s*\)?(?:[^\d]{0,12}الفقرة\s*\(?\s*(\d{1,2})(?!\d))?/);
  if (a) return { article: Number(a[1]), paragraph: a[2] ? Number(a[2]) : null };
  const w = q.match(/المادة\s+((?:ال[ء-ي]+)(?:\s+و?ال[ء-ي]+){0,3}(?:\s+بعد\s+ال[ء-ي]+)?)/);
  if (w) {
    const n = articleNumber(`المادة ${w[1]}`);
    const p = q.match(/الفقرة\s*\(?\s*(\d{1,2})\s*\)?/);
    if (n) return { article: n, paragraph: p ? Number(p[1]) : null };
  }
  return null;
}

/**
 * Words of the same matter written differently (owner's order 2026-11-07, §2.4: a correct passage in other words). A
 * short, closed list of waqf terms — not a thesaurus; a match through it is still only a lexical one.
 */
const SYNONYM_GROUPS = [
  "استبدال إبدال مناقلة مناقلته المناقلة بيع بيعه",
  "أجرة أجر أجره عوض مكافأة",
  "ناظر الناظر متولي المتولي",
  "تعطل تعطلت تتعطل يتعطل تعطلها تعطيل خرب خراب",
  "دراهم الدراهم نقود النقود نقدي النقدي دنانير",
  "استدانة الاستدانة يستدين يستدان اقتراض الاقتراض يقترض",
  "شرط شروط",
];
const CANON = new Map<string, string>();
for (const g of SYNONYM_GROUPS) {
  const forms = [...new Set(g.split(" ").flatMap((w) => tokenize(w)))];
  for (const f of forms) CANON.set(f, forms[0]!);
}
/** A token's matching form: its synonym group, with a leading «و» (and) dropped when the rest is a known word. */
function canon(t: string, df?: Map<string, number>): string {
  let x = t;
  // a joined particle — «و» (and), «ب» (with), «ل» (for), «ك» (as) — dropped when the rest is a known word
  if (x.length > 3 && /^[وبلك]/.test(x) && !CANON.has(x) && (CANON.has(x.slice(1)) || (df?.has(x.slice(1)) && !df?.has(x)))) x = x.slice(1);
  return CANON.get(x) ?? x;
}

/** The first content word after «حكم / يجوز / يصح / يجب / يلزم / تجوز» in the question, in its matching form. */
function headOf(question: string, df?: Map<string, number>): string | null {
  const m = question.match(/(?:حكم|يجوز|تجوز|يصح|تصح|يجب|يلزم)\s+(?:لل?[ء-ي]+\s+(?:أن|ان)\s+)?([ء-ي]{3,})/);
  if (!m) return null;
  const t = tokenize(m[1]!)[0];
  return t ? canon(t, df) : null;
}

/**
 * What must agree between a question and a passage beyond shared words (§2.4): a year named in the question (2019 is not
 * 2025), and a «غير X» qualifier (non-Saudis are not Saudis). Returns what the passage lacks.
 */
export function qualifiersMissing(question: string, text: string): string[] {
  const q = asciiDigits(question);
  const t = normForSearch(asciiDigits(text));
  const out: string[] = [];
  for (const y of new Set(q.match(/(?<!\d)(1[34]\d\d|20\d\d|19\d\d)(?!\d)/g) ?? [])) if (!t.includes(y)) out.push(`السنة ${y}`);
  for (const m of normForSearch(q).matchAll(/غير\s+(ال)?([ء-ي]{3,})/g)) {
    const w = m[2]!.replace(/(ين|ون|ات|ه|ة)$/, "");
    // «غري» is how some files' text layer renders «غير» (reversed ligature: «يف» for «في»), not another word
    // «من غير إذن» is «بلا إذن» / «بدون إذن» / «دون إذن» (independent review, round 7)
    if (!new RegExp(`(?:غير|غري|بلا|بدون|دون)\\s+(ال)?${w}`).test(t)) out.push(`«غير ${m[2]}»`);
  }
  // another school named in the question («عند الشافعية»): a Hanbali text does not answer it
  for (const [re, name] of [[/الشافعي/, "الشافعية"], [/المالكي/, "المالكية"], [/الحنفي|الاحناف/, "الحنفية"], [/الظاهري/, "الظاهرية"]] as const)
    if (re.test(normForSearch(q)) && !re.test(t)) out.push(`مذهب ${name}`);
  // a population named in the question that the passage does not name (non-Saudis, women, residents…)
  for (const w of ["الوافدين", "المقيمين", "الاناث", "النساء", "الذكور", "الرجال", "الاطفال", "الشباب", "كبار السن"])
    if (normForSearch(q).includes(w) && !t.includes(w)) out.push(`«${w}»`);
  return out;
}

/** Words naming the school describe the kind of source wanted (the school rule handles them), not the answer. */
const SCHOOL_WORDS = new Set(tokenize("المذهب الحنابلة الحنبلي مذهب الإمام أحمد"));

/** Window (in content words) within which the question's words must stand together to count (review N2/P1e). */
export const COVERAGE_WINDOW = 40;
/** Beyond this many content words a question is a request's text: the bar is measured against its heaviest words. */
export const LONG_QUESTION = 12;

/**
 * Relevance of a passage to a question, in [0, 1] (MIN_COVERAGE = 0.5 to count). Measured within one window of
 * COVERAGE_WINDOW content words of the passage, so that the words must stand together:
 *  - the idf-weighted share of the question's words (common waqf words — «وقف», «ناظر», «حكم» — weigh little), and
 *  - the plain count: both words of a two-word question, two of three, three of four, half of a longer one
 *    (a single rare word is not enough);
 * the lower of the two counts. A question of one content word defines no matter (0). A short question holding a word
 * that no reference contains at all («ألمانيا», «المريخ») asks what the knowledge base does not hold (0). A long
 * question (a request's text) is measured against its LONG_QUESTION heaviest words, so its length does not starve it.
 * Words that only name the source, and words naming the school, are left out.
 */
export function coverageOf(question: string, r: { tokens: Set<string>; seq?: string[]; titleTokens: Set<string> }, df?: Map<string, number>, n = 1, window = COVERAGE_WINDOW): number {
  const raw = [...new Set(tokenize(question))].filter((w) => !r.titleTokens.has(w) && !SCHOOL_WORDS.has(w));
  // a very short question with a word no reference contains («معدل البطالة في ألمانيا»): the knowledge base does not
  // hold what it asks (N2-b). Longer questions keep the ordinary measure (the stemmer is crude; a verb form may be absent)
  if (df && raw.length >= 2 && raw.length <= 3 && raw.some((w) => w.length >= 3 && !df.has(w) && !df.has(canon(w, df)) && !CANON.has(w))) return 0;
  // words matched through their synonym group (a correct passage in other words: §2.4)
  const words = [...new Set(raw.map((w) => canon(w, df)))];
  if (words.length < 2) return 0;
  const long = words.length > LONG_QUESTION;
  // a word's weight is the rarity of the word the question used (a synonym widens the match, not the weight: asking
  // «استبدال» is not made a common word by «بيع» being one)
  const askedDf = (w: string) => Math.min(...raw.filter((r) => canon(r, df) === w).map((r) => df?.get(r) ?? df?.get(canon(r, df)) ?? 0));
  const groupDf = askedDf;
  const idf = (w: string) => Math.log(1 + n / Math.max(1, (df ? askedDf(w) : 0) || 0.5));
  const weight = new Map(words.map((w) => [w, idf(w)]));
  const heaviest = [...weight.values()].sort((a, b) => b - a);
  const total = (long ? heaviest.slice(0, LONG_QUESTION) : heaviest).reduce((a, b) => a + b, 0);
  const countTotal = long ? LONG_QUESTION : words.length;
  const seq = (r.seq ?? [...r.tokens]).map((t) => canon(t, df));
  // the matter's anchor (§2.4): in a question of 4 to LONG_QUESTION words, at least one of its two rarest words must
  // stand in the window — the common words of waqf talk («حكم», «وقف», «بيع») do not make a passage answer «…بسيارة
  // كهربائية» by themselves
  const anchors = df && words.length >= 4 && !long ? new Set([...words].sort((a, b) => groupDf(a) - groupDf(b)).slice(0, 2)) : null;
  // the matter's head: in «ما حكم X…» / «هل يجوز X…» the first word of X is what is asked about — a passage on another
  // act («وقف السيارات» for «استبدال الوقف بسيارة») does not answer it, whatever else it shares
  const head = !long ? headOf(question, df) : null;
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
    // plain count: both words of a two-word question, two of three, three of four, else half of them
    const need = countTotal <= 2 ? countTotal : countTotal <= 4 ? countTotal - 1 : Math.ceil(countTotal * MIN_COVERAGE);
    const plain = gotN >= need ? 1 : (gotN / need) * (MIN_COVERAGE - 0.01);
    const anchored = (!anchors || [...anchors].some((w) => (count.get(w) ?? 0) > 0)) && (!head || (count.get(head) ?? 0) > 0);
    const share = anchored ? Math.min(1, total ? got / total : 0, plain) : Math.min(MIN_COVERAGE - 0.01, total ? got / total : 0, plain);
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
    // two versions starting the same day: which one was in force cannot be told (review H3)
    if (all.some(([v, st]) => v !== r.version && st === from)) {
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
    let registryDraftText = false;
    if (row.registryId && row.articleNo !== null) {
      registry = cite(REGISTRY, store, { refId: row.registryId, article: row.articleNo, paragraph: row.paragraphNo ?? undefined, asOf: q.asOf, historical: q.historical });
      const entry = getEntry(row.registryId);
      // H2: a registered text's validity runs from its version's start to the next stored version's start, or to the
      // instrument's repeal; with neither on record its end is unknown — shown as such, never guessed
      const endOf = (from: string | null) => {
        if (!from) return null;
        const next = store.versions(row.registryId!).map((v) => v.effectiveFrom).filter((x): x is string => !!x && x > from).sort()[0] ?? null;
        const repeal = (entry?.repealedBy ?? []).map((r) => r.from).filter((x): x is string => !!x && x > from).sort()[0] ?? null;
        return [next, repeal].filter((x): x is string => !!x).sort()[0] ?? null;
      };
      const useOfficial = (d: { heading: string | null; text: string; refName: string; locator: string; versionLabel: string; effectiveFrom: string | null }, provenance: "guard" | "stored_official") => {
        // name, locator, version, heading and text all from the official text: nothing of the knowledge base's own copy
        // (its heading line, title or locator) reaches the model or the citation (review N1/P5c)
        hit.text = `المادة ${row.articleNo}${d.heading ? `: ${d.heading}` : ""}\n${d.text}`;
        hit.title = d.refName;
        hit.locator = d.locator;
        hit.version = d.versionLabel;
        // relevance measured on the text that is passed on, not on the knowledge base's copy (review R6)
        const toks = tokenize(hit.text);
        if (!namedUnits?.has(row.chunkId)) hit.coverage = coverageOf(q.question, { tokens: new Set(toks), seq: toks, titleTokens: row.titleTokens }, c.df, c.rows.size);
        hit.validFrom = d.effectiveFrom;
        hit.validTo = endOf(d.effectiveFrom);
        hit.provenance = provenance;
      };
      if (registry.ok) {
        // the passage must hold the very text the guard authorised; what is passed on is the guard's text
        registryTextMatches = normCmp(row.text).includes(normCmp(registry.display.text));
        if (registryTextMatches) useOfficial(registry.display, "guard");
      } else {
        // a draft may use the stored official version's text before its comparison is accepted — never the knowledge
        // base's own copy (owner's order 2026-11-07, §5; rule 10 still governs a final citation)
        const v = store.versionAt(row.registryId, q.asOf);
        const loc = `م${row.articleNo}${row.paragraphNo !== null ? `/ف${row.paragraphNo}` : ""}`;
        const unit = v?.units.find((u) => u.locator === loc);
        if (v && unit && normCmp(row.text).includes(normCmp(unit.text))) {
          registryDraftText = true;
          useOfficial({ heading: unit.heading, text: unit.text, refName: entry?.officialName ?? row.title, locator: loc, versionLabel: v.label, effectiveFrom: v.effectiveFrom }, "stored_official");
        }
      }
    } else if (row.registryId) {
      // a registry instrument's passage without an article cannot be checked by the guard: never passed on as its text
      hit.provenance = "passage";
    }
    // beyond shared words: a year or a «غير X» qualifier of the question the passage lacks makes it not relevant (§2.4)
    const lacking = qualifiersMissing(q.question, hit.text);
    if (lacking.length && !namedUnits?.has(row.chunkId)) {
      hit.coverage = Math.min(hit.coverage, MIN_COVERAGE - 0.2);
      hit.lacking = lacking;
    }
    const rv: SourceReview[] = reviews.filter((x) => x.sourceId === sourceId).map((x) => ({ decision: x.decision as "accepted" | "rejected", at: x.at.toISOString(), role: x.reviewerRole as ReviewRole, chunkId: x.chunkId }));
    const dctx = { service: q.service, asOf: q.asOf, historical: q.historical, schoolQuestion: school };
    const evidence = { registry, registryTextMatches, reviews: rv, registryDraftText };
    return { hit, decision: decide(hit, dctx, evidence), draft: draftUse(hit, dctx, evidence) };
  });
  const rank = (r: Retrieved) => ({ null: 0, not_applicable: 3, not_relevant: 2 } as Record<string, number>)[String(refusalOf(r.decision))] ?? (r.draft.usable ? 1 : 1.5);
  const ordered = [...results].sort((a, b) => rank(a) - rank(b) || b.hit.score - a.hit.score).slice(0, limit);
  const basis = namedUnits ? ordered.filter((r) => namedUnits!.has(r.hit.chunkId)) : ordered;
  const citable = missingArticle ? [] : basis.filter((r) => r.decision.citable);
  const usable = missingArticle ? [] : basis.filter((r) => r.draft.usable);
  return {
    results: ordered, citable, sufficiency: sufficiency(basis, { binding: !!q.needBinding, school: needSchool, missingArticle }),
    usable, draftSufficiency: draftSufficiency(basis, { binding: !!q.needBinding, missingArticle }),
  };
}

/**
 * (Reporting; no longer gates a draft — see availableRefCodes.) Which of these references have something citable now:
 * B13 — for a registry instrument, one accepted article; for any other source, one approved passage. Either is a
 * partial standing: every other article or passage keeps its own.
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
      const latest = (id: string) => store.reviews(id).sort((a, b) => b.at.localeCompare(a.at))[0];
      const ok = store.matchRuns(v.id).some((r) => latest(r.id)?.decision === "accepted" && Object.values(r.perArticle).some((o) => CITABLE_OUTCOMES.has(o)));
      if (ok) ready.add(s.refCode);
      continue;
    }
    if (s.textQuality !== "good") continue;
    // B13: a source is «ready» in part only — some passage of it approved by its field; that approves no other passage
    const role = ((s.meta ?? {}) as { reviewRole?: ReviewRole }).reviewRole ?? DEFAULT_REVIEW_ROLE[s.refKind as RefKind];
    const mine = reviews.filter((r) => r.sourceId === s.id && r.reviewerRole === role).map((r) => ({ decision: r.decision as "accepted" | "rejected", at: r.at.toISOString(), role, chunkId: r.chunkId }));
    const passages = [...new Set(mine.filter((r) => r.chunkId).map((r) => r.chunkId!))];
    if (passages.some((chunkId) => passageStatus({ chunkId, reviewRole: role }, mine) === "approved")) ready.add(s.refCode);
  }
  return ready;
}

/**
 * Which of these references are present and usable for an internal draft now (owner's order 2026-11-07, §5): a registry
 * instrument in force on the date with a stored version from an official host; any other source current, with readable
 * passages. Reviewed or not — the review of what is used is required at the final approval, passage by passage.
 */
export async function availableRefCodes(tx: Tx, refCodes: string[], asOf: string): Promise<Set<string>> {
  const out = new Set<string>();
  if (!refCodes.length) return out;
  const sources = await tx.select().from(kbSources).where(inArray(kbSources.refCode, refCodes));
  const current = sources.filter((s) => s.supersededAt === null && (!s.repealedOn || s.repealedOn > asOf) && s.chunkCount > 0);
  const store = await loadVersionStore(tx, [...new Set(current.map((s) => s.registryId).filter((x): x is string => !!x))]);
  for (const s of current) {
    if (s.registryId) {
      const entry = getEntry(s.registryId);
      const st = entry ? statusAt(entry, asOf) : "unknown";
      const v = store.versionAt(s.registryId, asOf);
      let host = "";
      try { host = v ? new URL(v.source.url).host : ""; } catch { host = ""; }
      if ((st === "in_force" || st === "in_force_amended") && v && (OFFICIAL_HOSTS as readonly string[]).includes(host)) out.add(s.refCode);
      continue;
    }
    if (s.textQuality !== "unreadable") out.add(s.refCode);
  }
  return out;
}

/**
 * For the final gate: which of these passages of registry instruments the citation guard authorises now (their article
 * compared, the comparison accepted by an authorised, session-bound reviewer). B13: article by article.
 */
export async function registryCitable(tx: Tx, chunkIds: string[], asOf: string): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  if (!chunkIds.length) return out;
  const rows = await tx.select({ id: kbChunks.id, articleNo: kbChunks.articleNo, paragraphNo: kbChunks.paragraphNo, registryId: kbSources.registryId }).from(kbChunks).innerJoin(kbSources, eq(kbSources.id, kbChunks.sourceId)).where(inArray(kbChunks.id, chunkIds));
  const store = await loadVersionStore(tx, [...new Set(rows.map((r) => r.registryId).filter((x): x is string => !!x))]);
  for (const r of rows) {
    if (!r.registryId) continue;
    out.set(r.id, r.articleNo !== null && cite(REGISTRY, store, { refId: r.registryId, article: r.articleNo, paragraph: r.paragraphNo ?? undefined, asOf }).ok);
  }
  return out;
}
