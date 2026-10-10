import type { Metadata } from "next";
import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui";
import { Container, FilterChip, PageIntro } from "@/components/site/bits";
import { JOURNEY, SERVICE_AUDIENCE_LABEL } from "@/components/site/labels";
import { ServiceRow } from "@/components/site/service-row";
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
        crumbs={[{ label: "الخدمات" }]}
        title="الخدمات"
        lede="لكل خدمة نطاق ومخرجات ومدة واضحة، وضوابطها النظامية مبيّنة في صفحتها. وما يتطلب تسعيره دراسة حالتك نرسل إليك عرضه بعد الاطلاع عليها."
      />
      <Container className="py-8 md:py-10">
        <div className="space-y-4" role="group" aria-label="تصفية الخدمات">
          <div className="flex flex-wrap items-center gap-2">
            <span className="me-1 w-full text-[14px] font-medium text-muted sm:w-auto">لمن:</span>
            <FilterChip href={href("", stage)} active={!audience}>الجميع</FilterChip>
            {AUD.map((a) => (
              <FilterChip key={a} href={href(a, stage)} active={audience === a}>{SERVICE_AUDIENCE_LABEL[a]}</FilterChip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="me-1 w-full text-[14px] font-medium text-muted sm:w-auto">المرحلة:</span>
            <FilterChip href={href(audience, 0)} active={!stage}>كل المراحل</FilterChip>
            {JOURNEY.map((j) => (
              <FilterChip key={j.stage} href={href(audience, j.stage)} active={stage === j.stage}>{j.name}</FilterChip>
            ))}
          </div>
        </div>
        <p className="mt-6 text-[14px] text-muted" role="status">
          {serviceCount(total)}{audience || stage ? (total === 2 ? " تطابقان اختيارك" : " تطابق اختيارك") : ""}.
          {audience || stage ? <> <Link href="/services" className="font-medium text-ink underline underline-offset-4">أزل التصفية</Link></> : null}
        </p>

        {filtered.length ? (
          <div className="mt-4 grid gap-x-12 lg:grid-cols-[220px_minmax(0,1fr)]">
            <nav aria-label="أبواب الخدمات" className="hidden lg:block">
              <ul className="sticky top-24 space-y-1 border-s border-line">
                {filtered.map((c) => (
                  <li key={c.id}>
                    <a href={`#cat-${c.code}`} className="-ms-px block border-s-2 border-transparent py-1.5 ps-4 text-[15px] text-muted hover:border-ink hover:text-ink">
                      {c.nameAr}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="min-w-0 space-y-12">
              {filtered.map((c) => (
                <section key={c.id} id={`cat-${c.code}`} aria-labelledby={`h-${c.code}`} className="scroll-mt-24">
                  <h2 id={`h-${c.code}`} className="font-naskh text-[1.5rem] font-bold text-ink">{c.nameAr}</h2>
                  {c.description ? <p className="mt-1 text-[15px] text-muted">{c.description}</p> : null}
                  <ul className="mt-3 border-t border-line">
                    {c.services.map((s) => (
                      <ServiceRow key={s.id} s={s} />
                    ))}
                  </ul>
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
    </>
  );
}
