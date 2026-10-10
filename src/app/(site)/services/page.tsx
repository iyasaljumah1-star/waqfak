import type { Metadata } from "next";
import Link from "next/link";
import { LayoutGrid, SearchX, SlidersHorizontal } from "lucide-react";
import { EmptyState } from "@/components/ui";
import { Container, FilterChip, PageIntro } from "@/components/site/bits";
import { CallToAction, IconTile, ServiceCard, ServiceGrid } from "@/components/site/blocks";
import { categoryIcon } from "@/components/site/icons";
import { JOURNEY, SERVICE_AUDIENCE_LABEL } from "@/components/site/labels";
import { getCatalog } from "@/server/modules/public/queries";

export const metadata: Metadata = {
  title: "الخدمات",
  description: "كل خدمات وقفك في الأوقاف: التأسيس والوصايا والنظارة والحوكمة والمالية والاستثمار والامتثال، مع نطاق كل خدمة ومخرجاتها وطريقة تسعيرها.",
  alternates: { canonical: "/services" },
};

const AUD = ["waqif", "nazir", "board", "beneficiary", "entity"];
const serviceCount = (n: number) => (n === 1 ? "خدمة واحدة" : n === 2 ? "خدمتان" : n >= 3 && n <= 10 ? `${n} خدمات` : `${n} خدمة`);

export default async function ServicesPage({ searchParams }: { searchParams: Promise<{ audience?: string; stage?: string }> }) {
  const sp = await searchParams;
  const audience = AUD.includes(sp.audience ?? "") ? sp.audience! : "";
  const stage = Number(sp.stage) >= 1 && Number(sp.stage) <= 5 ? Number(sp.stage) : 0;
  const { categories } = await getCatalog();
  const filtered = categories
    .map((c) => ({ ...c, services: c.services.filter((s) => (!audience || s.audiences.includes(audience)) && (!stage || s.stage === stage)) }))
    .filter((c) => c.services.length);
  const total = filtered.reduce((n, c) => n + c.services.length, 0);
  const href = (a: string, s: number) => {
    const q = new URLSearchParams();
    if (a) q.set("audience", a);
    if (s) q.set("stage", String(s));
    const qs = q.toString();
    return `/services${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageIntro
        icon={LayoutGrid}
        crumbs={[{ label: "الخدمات" }]}
        title="الخدمات"
        lede="لكل خدمة نطاق ومخرجات ومدة واضحة، وضوابطها النظامية مبيّنة في صفحتها. وما يتطلب تسعيره دراسة حالتك نرسل إليك عرضه بعد الاطلاع عليها."
      />
      <Container className="py-8 md:py-10">
        <div className="card rounded-lg border border-line bg-surface p-4 shadow-card md:p-5" role="group" aria-label="تصفية الخدمات">
          <p className="mb-3 flex items-center gap-2 text-[15px] font-bold text-text">
            <SlidersHorizontal aria-hidden className="size-4 text-ink" />
            اعرض الخدمات بحسب
          </p>
          <div className="grid gap-3 md:grid-cols-[88px_minmax(0,1fr)] md:items-center">
            <span className="text-[14px] font-medium text-muted">لمن؟</span>
            <div className="flex flex-wrap gap-2">
              <FilterChip href={href("", stage)} active={!audience}>الجميع</FilterChip>
              {AUD.map((a) => (
                <FilterChip key={a} href={href(a, stage)} active={audience === a}>{SERVICE_AUDIENCE_LABEL[a]}</FilterChip>
              ))}
            </div>
            <span className="border-t border-line pt-3 text-[14px] font-medium text-muted md:border-0 md:pt-0">المرحلة</span>
            <div className="flex flex-wrap gap-2">
              <FilterChip href={href(audience, 0)} active={!stage}>كل المراحل</FilterChip>
              {JOURNEY.map((j) => (
                <FilterChip key={j.stage} href={href(audience, j.stage)} active={stage === j.stage}>
                  <span aria-hidden className="tabular me-1 text-[12px] opacity-70">{j.stage}</span>
                  {j.name}
                </FilterChip>
              ))}
            </div>
          </div>
        </div>
        <p className="mt-5 text-[14.5px] text-muted" role="status">
          <span className="font-semibold text-text">{serviceCount(total)}</span>
          {audience || stage ? (total === 2 ? " تطابقان اختيارك" : " تطابق اختيارك") : ""}.
          {audience || stage ? <> <Link href="/services" className="font-medium text-ink underline underline-offset-4">أزل التصفية</Link></> : null}
        </p>

        {filtered.length ? (
          <div className="mt-6 grid gap-x-10 lg:grid-cols-[230px_minmax(0,1fr)]">
            <nav aria-label="أبواب الخدمات" className="hidden lg:block">
              <ul className="sticky top-24 space-y-1 rounded-lg bg-stone p-2">
                {filtered.map((c) => {
                  const Icon = categoryIcon(c.code);
                  return (
                    <li key={c.id}>
                      <a href={`#cat-${c.code}`} className="flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-[14.5px] text-text/85 hover:bg-surface hover:text-ink">
                        <Icon aria-hidden strokeWidth={1.75} className="size-4 shrink-0 text-ink" />
                        <span className="min-w-0 flex-1">{c.nameAr}</span>
                        <span className="tabular text-[12.5px] text-muted">{c.services.length}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </nav>
            <div className="min-w-0 space-y-14">
              {filtered.map((c) => (
                <section key={c.id} id={`cat-${c.code}`} aria-labelledby={`h-${c.code}`} className="scroll-mt-24">
                  <div className="flex items-start gap-4 border-b border-line pb-4">
                    <IconTile icon={categoryIcon(c.code)} size="lg" />
                    <div className="min-w-0">
                      <h2 id={`h-${c.code}`} className="font-naskh text-[1.45rem] font-bold leading-[1.5] text-ink">{c.nameAr}</h2>
                      {c.description ? <p className="mt-0.5 text-[15px] text-muted">{c.description}</p> : null}
                    </div>
                    <span className="tabular ms-auto shrink-0 rounded-full bg-stone px-3 py-1 text-[13px] font-medium text-muted">{serviceCount(c.services.length)}</span>
                  </div>
                  <ServiceGrid className="mt-5">
                    {c.services.map((s) => (
                      <ServiceCard key={s.id} s={s} />
                    ))}
                  </ServiceGrid>
                </section>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-6">
            <EmptyState icon={SearchX} title="لا توجد خدمة تطابق هذا الاختيار">
              جرّب فئة أو مرحلة أخرى، أو <Link href="/services" className="text-ink underline">اعرض كل الخدمات</Link>، أو <Link href="/contact" className="text-ink underline">صف لنا حاجتك</Link>.
            </EmptyState>
          </div>
        )}
      </Container>
      <CallToAction
        title="لم تحدد الخدمة المناسبة بعد؟"
        lede="ابدأ بتقييم وقفك مجانًا، ونقترح عليك الخدمات المرتبطة بكل ملاحظة في النتيجة."
        primary={{ href: "/assessment", label: "قيّم وقفك مجانًا" }}
        secondary={{ href: "/contact", label: "صف لنا حاجتك" }}
      />
    </>
  );
}
