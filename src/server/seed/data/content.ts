// Filled by the content workstream. Shape is enforced by the types below.
export type Article = {
  kind: "article" | "guide" | "regulation" | "study" | "template" | "page";
  slug: string; titleAr: string; summary: string; bodyMd: string; audience: string[]; topic: string;
  reviewerSpecialty: "sharia" | "legal" | "finance" | "governance"; sourceRefs: { label: string; url?: string }[];
  readingMinutes: number; seoTitle?: string; seoDescription?: string; requiresLogin?: boolean;
};
export type Faq = { question: string; answer: string; audience: string; topic: string; source?: string };
export type Term = { slug: string; term: string; definition: string; synonyms: string[]; related: string[]; source?: string };

export const ARTICLES: Article[] = [];
export const FAQS: Faq[] = [];
export const GLOSSARY: Term[] = [];
