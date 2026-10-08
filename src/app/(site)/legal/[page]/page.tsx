import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContentDocument } from "@/components/site/document";
import { LEGAL_PAGES } from "@/components/site/labels";
import { getPage } from "@/server/modules/public/queries";


type P = { params: Promise<{ page: string }> };

async function load(page: string) {
  if (!LEGAL_PAGES.some((p) => p.key === page)) return null;
  return getPage(`legal-${page}`);
}

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { page } = await params;
  const item = await load(page);
  if (!item) return { title: "صفحة غير موجودة" };
  return { title: item.seoTitle?.replace(/\s*\|\s*وقفك\s*$/, "") ?? item.titleAr, description: item.seoDescription ?? item.summary ?? undefined, alternates: { canonical: `/legal/${page}` } };
}

export default async function LegalPage({ params }: P) {
  const { page } = await params;
  const item = await load(page);
  if (!item) notFound();
  return (
    <ContentDocument
      item={item}
      showKind={false}
      crumbs={[{ label: "السياسات" }, { label: item.titleAr }]}
      after={
        <nav aria-label="السياسات الأخرى" className="mt-10 max-w-[68ch] border-t border-line pt-6">
          <p className="text-[14px] font-medium text-muted">سياسات أخرى</p>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {LEGAL_PAGES.filter((p) => p.key !== page).map((p) => (
              <li key={p.key}>
                <Link href={`/legal/${p.key}`} className="text-[15px] text-ink underline underline-offset-4">{p.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      }
    />
  );
}
