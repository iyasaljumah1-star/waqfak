import "server-only";
import { and, asc, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { contentItems, contentReviews, faqs, glossaryTerms, users } from "@/server/db/schema";

export async function listContent(tx: Tx, f: { kind?: string; status?: string; q?: string }) {
  const conds: SQL[] = [];
  if (f.kind) conds.push(eq(contentItems.kind, f.kind));
  if (f.status) conds.push(eq(contentItems.status, f.status as never));
  if (f.q) conds.push(or(ilike(contentItems.titleAr, `%${f.q}%`), ilike(contentItems.slug, `%${f.q}%`))!);
  return tx
    .select({
      id: contentItems.id, kind: contentItems.kind, slug: contentItems.slug, titleAr: contentItems.titleAr, status: contentItems.status,
      reviewerSpecialty: contentItems.reviewerSpecialty, reviewedAt: contentItems.reviewedAt, lastVerifiedAt: contentItems.lastVerifiedAt,
      updatedAt: contentItems.updatedAt, topic: contentItems.topic,
    })
    .from(contentItems)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(contentItems.updatedAt))
    .limit(300);
}

export async function loadContent(tx: Tx, id: string) {
  const [c] = await tx.select().from(contentItems).where(eq(contentItems.id, id)).limit(1);
  if (!c) return null;
  const reviews = await tx
    .select({ r: contentReviews, reviewer: users.fullName })
    .from(contentReviews)
    .leftJoin(users, eq(users.id, contentReviews.reviewerId))
    .where(eq(contentReviews.contentId, id))
    .orderBy(desc(contentReviews.at));
  return { c, reviews };
}

export async function listFaqs(tx: Tx) {
  return tx.select().from(faqs).orderBy(asc(faqs.topic), asc(faqs.position));
}
export async function loadFaq(tx: Tx, id: string) {
  const [f] = await tx.select().from(faqs).where(eq(faqs.id, id)).limit(1);
  return f ?? null;
}
export async function listTerms(tx: Tx) {
  return tx.select().from(glossaryTerms).orderBy(asc(glossaryTerms.term));
}
export async function loadTerm(tx: Tx, id: string) {
  const [t] = await tx.select().from(glossaryTerms).where(eq(glossaryTerms.id, id)).limit(1);
  return t ?? null;
}
