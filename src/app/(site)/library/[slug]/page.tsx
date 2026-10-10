import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd, SITE_URL } from "@/components/site/bits";
import { ArticleCard, RelatedContent } from "@/components/site/blocks";
import { ContentDocument } from "@/components/site/document";
import { getContent, getLibrary } from "@/server/modules/public/queries";

type P = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const item = await getContent(decodeURIComponent((await params).slug));
  if (!item) return { title: "مادة غير موجودة" };
  const title = item.seoTitle?.replace(/\s*\|\s*وقفك\s*$/, "") ?? item.titleAr;
  const description = item.seoDescription ?? item.summary ?? undefined;
  return {
    title,
    description,
    alternates: { canonical: `/library/${item.slug}` },
    openGraph: { type: "article", title, description, publishedTime: item.publishedAt?.toISOString(), modifiedTime: item.updatedAt.toISOString() },
  };
}

export default async function LibraryItem({ params }: P) {
  const item = await getContent(decodeURIComponent((await params).slug));
  if (!item) notFound();
  const related = (await getLibrary()).filter((i) => i.id !== item.id && i.topic === item.topic).slice(0, 3);
  const isReg = item.kind === "regulation";

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Article",
          headline: item.titleAr,
          description: item.summary ?? undefined,
          inLanguage: "ar",
          datePublished: item.publishedAt?.toISOString(),
          dateModified: item.updatedAt.toISOString(),
          mainEntityOfPage: `${SITE_URL}/library/${item.slug}`,
          author: { "@type": "Organization", name: "وقفك" },
          publisher: { "@type": "Organization", name: "وقفك", url: SITE_URL },
          citation: item.sourceRefs.map((r) => r.label),
        }}
      />
      <ContentDocument
        item={item}
        crumbs={isReg ? [{ href: "/regulations", label: "الأنظمة واللوائح" }, { label: item.titleAr }] : [{ href: "/library", label: "المكتبة" }, { label: item.titleAr }]}
        after={
          related.length ? (
            <RelatedContent id="related" title="في الموضوع نفسه" className="mt-14" more={item.topic ? { href: `/library?topic=${item.topic}`, label: "المزيد في الموضوع" } : undefined}>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {related.map((r) => (
                  <ArticleCard key={r.id} item={r} compact />
                ))}
              </div>
            </RelatedContent>
          ) : null
        }
      />
    </>
  );
}
