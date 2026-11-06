import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { kbChunks, kbSources } from "@/server/db/schema";
import { Bm25Index, type CorpusDoc } from "@/server/modules/ai/bm25";

/**
 * Retrieval over the knowledge base (BM25 with the assistant's Arabic tokenizer). Only current versions are searched;
 * every hit carries its source code, version, locator, text quality and verification status, so what the engine
 * cites can be traced back and judged.
 */
export type KbHit = {
  chunkId: string; refCode: string; version: string; title: string; locator: string; articleNo: number | null;
  text: string; quality: string; verification: string; binding: string | null; score: number;
};

type Cache = { sig: string; index: Bm25Index; meta: Map<string, Omit<KbHit, "score">> };
const g = globalThis as unknown as { __waqfakKb?: Cache };

async function signature(tx: Tx) {
  const [r] = await tx.select({ n: sql<number>`count(*)::int`, last: sql<string>`coalesce(max(${kbSources.ingestedAt})::text, '')` }).from(kbSources).where(isNull(kbSources.supersededAt));
  return `${r.n}:${r.last}`;
}

async function index(tx: Tx): Promise<Cache> {
  const sig = await signature(tx);
  if (g.__waqfakKb?.sig === sig) return g.__waqfakKb;
  const rows = await tx.select({ c: kbChunks, s: kbSources }).from(kbChunks).innerJoin(kbSources, eq(kbSources.id, kbChunks.sourceId)).where(isNull(kbSources.supersededAt));
  const meta = new Map<string, Omit<KbHit, "score">>();
  const docs: CorpusDoc[] = rows.map(({ c, s }) => {
    meta.set(c.id, { chunkId: c.id, refCode: s.refCode, version: s.version, title: s.title, locator: c.locator, articleNo: c.articleNo, text: c.text, quality: s.textQuality, verification: s.verificationStatus, binding: s.bindingLevel });
    return { id: c.id, kind: "requirement", title: c.locator, body: c.norm, href: "", label: s.refCode };
  });
  g.__waqfakKb = { sig, index: new Bm25Index(docs), meta };
  return g.__waqfakKb;
}

/**
 * RETIRED (owner's order 2026-11-06, §2.7; independent review B11): a search of the knowledge base that bypasses the
 * citation policy. The only route is knowledge/retrieve.ts. Kept for the record; it refuses to run. No caller remains
 * (tests/knowledge-policy.test.ts proves it).
 */
export const RETIRED = "engine/knowledge/search is retired: use knowledge/retrieve (retrieve, readyRefCodes)";

export async function searchKb(tx: Tx, query: string, opts: { refCodes?: string[]; limit?: number } = {}): Promise<KbHit[]> {
  if (RETIRED) throw new Error(RETIRED);
  const c = await index(tx);
  const hits = c.index.search(query, { limit: 60 });
  const out: KbHit[] = [];
  for (const h of hits) {
    const m = c.meta.get(h.doc.id);
    if (!m) continue;
    if (opts.refCodes?.length && !opts.refCodes.includes(m.refCode)) continue;
    out.push({ ...m, score: h.score });
    if (out.length >= (opts.limit ?? 6)) break;
  }
  return out;
}

/** The current version of each reference (for the processing record and the coverage report). */
export async function currentSources(tx: Tx, refCodes?: string[]) {
  if (RETIRED) throw new Error(RETIRED);
  return tx.select().from(kbSources).where(and(isNull(kbSources.supersededAt), refCodes?.length ? inArray(kbSources.refCode, refCodes) : undefined));
}

/** A passage by id (for verifying a citation after generation). */
export async function chunkById(tx: Tx, id: string) {
  if (RETIRED) throw new Error(RETIRED);
  const [r] = await tx.select({ c: kbChunks, s: kbSources }).from(kbChunks).innerJoin(kbSources, eq(kbSources.id, kbChunks.sourceId)).where(eq(kbChunks.id, id)).limit(1);
  return r ?? null;
}
