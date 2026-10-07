// Filled by the content workstream. Shape is enforced by the types below.
// Sources live in src/content/*; this module only assembles and validates them.
import { ARTICLES_A } from "../../../content/articles-a";
import { ARTICLES_B } from "../../../content/articles-b";
import { ARTICLES_C } from "../../../content/articles-c";
import { ARTICLES_D } from "../../../content/articles-d";
import { REGULATIONS } from "../../../content/regulations";
import { PAGES } from "../../../content/pages";
import { FAQS as FAQ_ITEMS } from "../../../content/faqs";
import { GLOSSARY as GLOSSARY_ITEMS } from "../../../content/glossary";

export type Article = {
  kind: "article" | "guide" | "regulation" | "study" | "template" | "page";
  slug: string; titleAr: string; summary: string; bodyMd: string; audience: string[]; topic: string;
  reviewerSpecialty: "sharia" | "legal" | "finance" | "governance"; sourceRefs: { label: string; url?: string }[];
  readingMinutes: number; seoTitle?: string; seoDescription?: string; requiresLogin?: boolean;
};
export type Faq = { question: string; answer: string; audience: string; topic: string; source?: string };
export type Term = { slug: string; term: string; definition: string; synonyms: string[]; related: string[]; source?: string };

export const ARTICLES: Article[] = [...ARTICLES_A, ...ARTICLES_B, ...ARTICLES_C, ...ARTICLES_D, ...REGULATIONS, ...PAGES];
export const FAQS: Faq[] = FAQ_ITEMS;
export const GLOSSARY: Term[] = GLOSSARY_ITEMS;

/** Fails fast (at seed time) on duplicate slugs, dangling glossary links or empty sources. */
function validateContent() {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const a of ARTICLES) {
    if (seen.has(a.slug)) errors.push(`duplicate article slug: ${a.slug}`);
    seen.add(a.slug);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(a.slug)) errors.push(`bad article slug: ${a.slug}`);
    if (!a.sourceRefs.length) errors.push(`article without sources: ${a.slug}`);
  }
  const terms = new Set<string>();
  for (const t of GLOSSARY) {
    if (terms.has(t.slug)) errors.push(`duplicate term slug: ${t.slug}`);
    terms.add(t.slug);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(t.slug)) errors.push(`bad term slug: ${t.slug}`);
  }
  for (const t of GLOSSARY) for (const r of t.related) if (!terms.has(r)) errors.push(`term ${t.slug} → missing related ${r}`);
  const faqQ = new Set<string>();
  for (const f of FAQS) {
    if (faqQ.has(f.question)) errors.push(`duplicate faq: ${f.question}`);
    faqQ.add(f.question);
  }
  if (errors.length) throw new Error(`Content validation failed:\n${errors.join("\n")}`);
}
validateContent();
