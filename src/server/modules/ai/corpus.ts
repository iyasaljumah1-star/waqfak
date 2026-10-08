import "server-only";
import { eq, ne, sql } from "drizzle-orm";
import { withSystem } from "@/server/db";
import { contentItems, faqs, glossaryTerms, regulatoryReferences, regulatoryRequirements } from "@/server/db/schema";
import { Bm25Index, type CorpusDoc } from "./bm25";

/**
 * Knowledge-base index for the local engine: published content items, FAQs, glossary terms and regulatory
 * requirements. These are public catalog tables (no waqf data), read under the system context as CONVENTIONS allow.
 * The index is cached in memory and rebuilt when a cheap signature (row counts + last update) changes.
 */

const KIND_LABEL: Record<string, string> = { guide: "دليل", article: "مقال", regulation: "مرجع نظامي", study: "دراسة", template: "نموذج", page: "صفحة" };

export function contentHref(kind: string, slug: string): string {
  if (kind === "page") {
    if (slug.startsWith("legal-")) return `/legal/${slug.slice(6)}`;
    if (slug === "about-waqfak") return "/about";
  }
  return `/library/${slug}`;
}

type Cache = { signature: string; index: Bm25Index; checkedAt: number; builtAt: number };
const g = globalThis as unknown as { __waqfakAiIndex?: Cache; __waqfakAiBuilding?: Promise<Cache> };
const CHECK_EVERY_MS = 30_000;

async function signature(): Promise<string> {
  const rows = await withSystem((tx) =>
    tx.execute(sql`
      select
        (select count(*) || ':' || coalesce(max(updated_at)::text, '') from content_items where status = 'published') as c,
        (select count(*) || ':' || coalesce(max(updated_at)::text, '') from faqs where status = 'published') as f,
        (select count(*) || ':' || coalesce(max(updated_at)::text, '') from glossary_terms where status = 'published') as g,
        (select count(*) || ':' || coalesce(max(updated_at)::text, '') from regulatory_requirements) as r`),
  );
  const r = (rows as unknown as { rows: Record<string, string>[] }).rows?.[0] ?? (rows as unknown as Record<string, string>[])[0];
  return [r.c, r.f, r.g, r.r].join("|");
}

export async function loadCorpus(): Promise<CorpusDoc[]> {
  return withSystem(async (tx) => {
    const [content, faqRows, terms, reqs] = await Promise.all([
      tx.select({ id: contentItems.id, kind: contentItems.kind, slug: contentItems.slug, title: contentItems.titleAr, summary: contentItems.summary, body: contentItems.bodyMd, topic: contentItems.topic })
        .from(contentItems).where(eq(contentItems.status, "published")),
      tx.select({ id: faqs.id, q: faqs.question, a: faqs.answer, topic: faqs.topic, source: faqs.source }).from(faqs).where(eq(faqs.status, "published")),
      tx.select({ id: glossaryTerms.id, slug: glossaryTerms.slug, term: glossaryTerms.term, def: glossaryTerms.definition, syn: glossaryTerms.synonyms, source: glossaryTerms.source })
        .from(glossaryTerms).where(eq(glossaryTerms.status, "published")),
      tx.select({ id: regulatoryRequirements.id, code: regulatoryRequirements.code, title: regulatoryRequirements.title, description: regulatoryRequirements.description, article: regulatoryRequirements.article, source: regulatoryReferences.sourceName })
        .from(regulatoryRequirements).leftJoin(regulatoryReferences, eq(regulatoryReferences.id, regulatoryRequirements.referenceId)).where(ne(regulatoryRequirements.status, "excluded")),
    ]);
    const docs: CorpusDoc[] = [];
    for (const c of content) {
      docs.push({ id: `c:${c.id}`, kind: "content", title: c.title, keywords: `${c.summary ?? ""} ${c.topic ?? ""}`, body: `${c.summary ?? ""}\n\n${c.body}`, href: contentHref(c.kind, c.slug), label: KIND_LABEL[c.kind] ?? "مقال" });
    }
    for (const f of faqRows) docs.push({ id: `f:${f.id}`, kind: "faq", title: f.q, keywords: f.topic, body: f.a, href: "/faq", label: "سؤال شائع" });
    for (const t of terms) docs.push({ id: `g:${t.id}`, kind: "glossary", title: t.term, keywords: t.syn.join(" "), body: t.def, href: `/glossary#${t.slug}`, label: "مصطلح" });
    for (const r of reqs) {
      docs.push({
        id: `r:${r.id}`, kind: "requirement", title: r.title, keywords: r.code,
        body: [r.title, r.description, r.article ? `المادة: ${r.article}` : null, r.source ? `المصدر: ${r.source}` : null].filter(Boolean).join(". "),
        href: `/regulations#${r.code.toLowerCase()}`, label: r.code,
      });
    }
    return docs;
  });
}

/** Returns the cached index, rebuilding it when the knowledge base changed (checked at most every 30 s). */
export async function getIndex(): Promise<Bm25Index> {
  const now = Date.now();
  const c = g.__waqfakAiIndex;
  if (c && now - c.checkedAt < CHECK_EVERY_MS) return c.index;
  const sig = await signature();
  if (c && c.signature === sig) {
    c.checkedAt = now;
    return c.index;
  }
  if (!g.__waqfakAiBuilding) {
    g.__waqfakAiBuilding = (async () => {
      const index = new Bm25Index(await loadCorpus());
      const built: Cache = { signature: sig, index, checkedAt: Date.now(), builtAt: Date.now() };
      g.__waqfakAiIndex = built;
      return built;
    })().finally(() => {
      g.__waqfakAiBuilding = undefined;
    });
  }
  return (await g.__waqfakAiBuilding).index;
}

/** Forces a rebuild on the next query (e.g. after an admin publishes content). */
export function invalidateIndex() {
  g.__waqfakAiIndex = undefined;
}
