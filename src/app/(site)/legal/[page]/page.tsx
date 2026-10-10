import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
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
        <nav aria-label="السياسات الأخرى" className="mt-12 max-w-[68ch]">
          <p className="font-naskh text-[1.25rem] font-bold text-ink">سياسات أخرى</p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {LEGAL_PAGES.filter((p) => p.key !== page).map((p) => (
              <li key={p.key}>
                <Link href={`/legal/${p.key}`} className="card group flex items-center gap-3 rounded-md border border-line bg-surface px-4 py-3 text-[15px] font-medium transition-colors hover:border-ink/40 hover:text-ink">
                  <FileText aria-hidden className="size-4 shrink-0 text-ink" />
                  <span className="min-w-0 flex-1">{p.label}</span>
                  <ArrowLeft aria-hidden className="size-4 shrink-0 text-muted transition-transform group-hover:-translate-x-0.5 group-hover:text-ink" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      }
    />
  );
}
