/**
 * In-memory BM25 index with title boosting, a root-form fallback, small synonym expansion and extractive
 * passage selection (pure; unit-tested).
 */
import { rootOf, sentences, stripMarkdown, synonymsOf, tokenize } from "./text";

export type CorpusKind = "content" | "faq" | "glossary" | "requirement";

export type CorpusDoc = {
  id: string;
  kind: CorpusKind;
  title: string;
  /** Extra searchable text weighted like the title (synonyms, summary, codes). */
  keywords?: string;
  body: string;
  href: string;
  /** Short label shown on the citation chip (e.g. "دليل", "سؤال شائع", "REQ-001"). */
  label: string;
};

type Indexed = { doc: CorpusDoc; tf: Map<string, number>; title: Set<string>; len: number; plain: string };

export type SearchHit = { doc: CorpusDoc; score: number; coverage: number; passage: string };

const K1 = 1.4;
const B = 0.75;
const TITLE_BOOST = 3;
const ROOT_WEIGHT = 0.4;
const SYN_WEIGHT = 0.5;
const KIND_BOOST: Record<CorpusKind, number> = { faq: 1.15, content: 1, glossary: 1.05, requirement: 0.9 };
const R = (s: string) => `~${rootOf(s)}`;

/** One query word with its alternative match keys and their weights. */
type Group = { keys: { term: string; w: number }[]; idf: number };

export class Bm25Index {
  private docs: Indexed[] = [];
  private df = new Map<string, number>();
  private avgLen = 1;

  constructor(corpus: CorpusDoc[]) {
    let total = 0;
    for (const doc of corpus) {
      const plain = stripMarkdown(doc.body);
      const tf = new Map<string, number>();
      const add = (t: string, w: number) => tf.set(t, (tf.get(t) ?? 0) + w);
      const titleToks = tokenize(`${doc.title} ${doc.keywords ?? ""}`);
      for (const t of titleToks) {
        add(t, TITLE_BOOST);
        add(R(t), TITLE_BOOST);
      }
      // the title-coverage bonus uses the real title only (keywords/summary are boosted but do not count here)
      const title = new Set<string>();
      for (const t of tokenize(doc.title)) title.add(t).add(R(t));
      let len = titleToks.length * TITLE_BOOST;
      for (const t of tokenize(plain)) {
        add(t, 1);
        add(R(t), 1);
        len++;
      }
      total += len;
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ doc, tf, title, len: Math.max(len, 1), plain });
    }
    this.avgLen = this.docs.length ? total / this.docs.length : 1;
  }

  get size() {
    return this.docs.length;
  }

  idf(term: string): number {
    const n = this.docs.length;
    const df = this.df.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  private groups(query: string): Group[] {
    const stems = [...new Set(tokenize(query))];
    return stems.map((s) => {
      const known = this.df.has(s);
      // When the exact stem never occurs (e.g. a verb form such as «أسجل»), its root form stands in at full weight.
      const keys = [{ term: s, w: 1 }, { term: R(s), w: known ? ROOT_WEIGHT : 1 }, ...synonymsOf(s).map((x) => ({ term: x, w: SYN_WEIGHT }))];
      const idf = known || !this.df.has(R(s)) ? this.idf(s) : this.idf(R(s));
      return { keys, idf };
    });
  }

  /**
   * Ranks documents for a query. `coverage` is the idf-weighted share of query words the document matches
   * (exactly, by root or by synonym; 0..1): callers use it to refuse weak matches instead of answering from an
   * irrelevant source. Documents whose title covers the query get a bonus.
   */
  search(query: string, opts: { limit?: number; kinds?: CorpusKind[] } = {}): SearchHit[] {
    const groups = this.groups(query);
    if (!groups.length || !this.docs.length) return [];
    const idfSum = groups.reduce((a, g) => a + g.idf, 0) || 1;
    const hits: SearchHit[] = [];
    for (const d of this.docs) {
      if (opts.kinds && !opts.kinds.includes(d.doc.kind)) continue;
      let score = 0;
      let covered = 0;
      let inTitle = 0;
      for (const g of groups) {
        let best = 0;
        let matchW = 0;
        let titleW = 0;
        for (const k of g.keys) {
          const f = d.tf.get(k.term);
          if (!f) continue;
          const s = k.w * this.idf(k.term) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / this.avgLen)));
          if (s > best) best = s;
          matchW = Math.max(matchW, k.w);
          if (d.title.has(k.term)) titleW = Math.max(titleW, k.w);
        }
        score += best;
        covered += g.idf * matchW;
        inTitle += g.idf * titleW;
      }
      if (score <= 0) continue;
      const coverage = covered / idfSum;
      const titleCov = inTitle / idfSum;
      hits.push({ doc: d.doc, score: score * KIND_BOOST[d.doc.kind] * (0.5 + coverage) * (1 + 1.5 * titleCov), coverage, passage: "" });
    }
    hits.sort((a, b) => b.score - a.score);
    const top = hits.slice(0, opts.limit ?? 5);
    const weights = new Map<string, number>();
    for (const g of groups) {
      for (const k of g.keys) {
        const key = k.term.replace(/^~/, "");
        weights.set(key, Math.max(weights.get(key) ?? 0, g.idf * k.w));
      }
    }
    for (const h of top) h.passage = bestPassage(this.docs.find((x) => x.doc === h.doc)!.plain, weights);
    return top;
  }
}

/** Picks the most relevant 1–2 consecutive sentences (≤ ~420 chars) for an extractive quote. */
export function bestPassage(plain: string, weights: Map<string, number>, maxLen = 420): string {
  const sents = sentences(plain);
  if (!sents.length) return clip(plain, maxLen);
  const scoreOf = (s: string) => {
    let sc = 0;
    const seen = new Set<string>();
    for (const t of tokenize(s)) {
      for (const key of [t, rootOf(t)]) {
        const w = weights.get(key);
        if (w && !seen.has(key)) {
          seen.add(key);
          sc += w;
        }
      }
    }
    return sc;
  };
  let best = 0;
  let bestScore = -1;
  sents.forEach((s, i) => {
    const sc = scoreOf(s);
    if (sc > bestScore) {
      bestScore = sc;
      best = i;
    }
  });
  let out = sents[best];
  const next = sents[best + 1];
  if (next && out.length + next.length + 1 <= maxLen && (out.length < 160 || scoreOf(next) > 0)) out = `${out} ${next}`;
  return clip(out, maxLen);
}

export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return `${cut.slice(0, sp > max * 0.6 ? sp : max)}…`;
}
