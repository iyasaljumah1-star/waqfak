import type { Metadata } from "next";
import Link from "next/link";
import { Lock } from "lucide-react";
import { Badge, ButtonLink, PageHeader } from "@/components/ui";
import { fmtSAR } from "@/lib/utils";
import { requireAuth } from "@/server/authz/context";
import { loadCatalog, PRICE_UNKNOWN, PRICING_LABEL, type CatalogService } from "@/server/modules/requests/catalog";

export const metadata: Metadata = { title: "الخدمات والباقات" };

function PriceText({ s }: { s: CatalogService }) {
  if (s.pricingModel === "free") return <span className="font-medium text-ok">مجانية</span>;
  if (s.price === null) return <span className="text-muted">{PRICE_UNKNOWN}</span>;
  return <span className="tabular font-medium">{fmtSAR(s.price)}<span className="text-muted"> قبل الضريبة</span></span>;
}

export default async function ServicesPage({ searchParams }: { searchParams: Promise<{ waqf?: string }> }) {
  await requireAuth({ next: "/app/services" });
  const { waqf } = await searchParams;
  const { categories, packages } = await loadCatalog();
  const q = waqf ? `&waqf=${encodeURIComponent(waqf)}` : "";

  return (
    <div className="space-y-8">
      <PageHeader
        title="الخدمات والباقات"
        description="اختر الخدمة، ثم أرسل طلبك. يدرس الفريق الطلب ويرسل لك عرض السعر والعقد قبل البدء، وتتابع كل مرحلة من صفحة الطلب."
        actions={<ButtonLink href="/app/requests" variant="secondary" size="sm">طلباتي</ButtonLink>}
      />

      <nav aria-label="فئات الخدمات" className="no-print -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {categories.map((c) => (
          <a key={c.id} href={`#cat-${c.code}`} className="shrink-0 rounded-full border border-line bg-surface px-3 py-1 text-sm hover:border-ink hover:text-ink">{c.nameAr}</a>
        ))}
        {packages.length ? <a href="#packages" className="shrink-0 rounded-full border border-line bg-surface px-3 py-1 text-sm hover:border-ink hover:text-ink">الباقات</a> : null}
      </nav>

      {categories.map((c) => (
        <section key={c.id} id={`cat-${c.code}`} aria-labelledby={`h-${c.code}`} className="scroll-mt-20">
          <div className="mb-3">
            <h2 id={`h-${c.code}`} className="font-naskh text-xl font-bold text-ink">{c.nameAr}</h2>
            {c.description ? <p className="text-sm text-muted">{c.description}</p> : null}
          </div>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {c.services.map((s) => {
              const off = !s.availability.available;
              return (
                <li key={s.id} className="flex flex-col gap-2 px-4 py-4 md:flex-row md:items-center md:gap-6 md:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="tabular text-[13px] text-muted" dir="ltr">{s.code}</span>
                      <Link href={`/app/services/${s.code}`} className={off ? "font-semibold text-muted hover:underline" : "font-semibold text-ink hover:underline"}>{s.nameAr}</Link>
                      {off ? <Badge tone="neutral"><Lock aria-hidden className="size-3" />غير متاحة حاليًا</Badge> : null}
                    </p>
                    <p className="mt-0.5 text-[15px] text-muted">{s.summary}</p>
                    {!s.availability.available ? <p className="mt-1 text-[13px] text-fine">{s.availability.reason}</p> : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 md:w-80 md:justify-end">
                    <div className="text-[13px] md:text-end">
                      <PriceText s={s} />
                      <p className="text-muted">{PRICING_LABEL[s.pricingModel]}{s.slaDays ? ` · ${s.slaDays} يومًا تقريبًا` : ""}</p>
                    </div>
                    {off ? (
                      <ButtonLink href={`/app/services/${s.code}`} variant="ghost" size="sm">التفاصيل</ButtonLink>
                    ) : (
                      <ButtonLink href={`/app/requests/new?service=${s.code}${q}`} variant="secondary" size="sm" aria-label={`اطلب ${s.nameAr}`}>اطلب</ButtonLink>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {packages.length ? (
        <section id="packages" aria-labelledby="h-packages" className="scroll-mt-20">
          <div className="mb-3">
            <h2 id="h-packages" className="font-naskh text-xl font-bold text-ink">الباقات</h2>
            <p className="text-sm text-muted">اشتراك سنوي يجمع خدمات تناسب حجم الوقف. الأسعار تُحدد بعد دراسة الوقف ما لم تظهر هنا.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {packages.map((p) => (
              <article key={p.id} className="rounded-lg border border-line bg-surface p-4 md:p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-lg font-semibold">{p.nameAr}</h3>
                  {p.audience ? <span className="text-[13px] text-muted">{p.audience}</span> : null}
                </div>
                {p.description ? <p className="mt-1 text-[15px] text-muted">{p.description}</p> : null}
                <p className="mt-2 text-[15px]">
                  {p.annualPrice ? <span className="tabular font-medium">{fmtSAR(p.annualPrice)} سنويًا</span> : p.monthlyPrice ? <span className="tabular font-medium">{fmtSAR(p.monthlyPrice)} شهريًا</span> : <span className="text-muted">{PRICE_UNKNOWN}</span>}
                </p>
                {p.isClosed ? <p className="mt-1 text-[13px] text-fine">باقة مغلقة: لا تُضاف إليها خدمات منفصلة، وتخضع لقواعد استقلال النظارة.</p> : null}
                {p.services.length ? (
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {p.services.map((s) => (
                      <li key={s.id}><Link href={`/app/services/${s.code}`} className="inline-block rounded-full bg-surface-2 px-2.5 py-0.5 text-[13px] ring-1 ring-line hover:text-ink">{s.nameAr}</Link></li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
