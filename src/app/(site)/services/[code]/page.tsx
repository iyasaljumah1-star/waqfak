import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, FileText, Info, Users } from "lucide-react";
import { Alert, Badge, buttonClass } from "@/components/ui";
import { Container, Crumbs, JsonLd, SITE_URL } from "@/components/site/bits";
import { availabilityCopy, CONFLICT_LABEL, DEPARTMENT_LABEL, JOURNEY, PRICING_LABEL, priceText, SERVICE_AUDIENCE_LABEL } from "@/components/site/labels";
import { ServiceRow } from "@/components/site/service-row";
import { daysAr } from "@/lib/utils";
import { getService } from "@/server/modules/public/queries";

type P = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const r = await getService((await params).code);
  if (!r) return { title: "خدمة غير موجودة" };
  return {
    title: r.service.nameAr,
    description: r.service.summary,
    alternates: { canonical: `/services/${r.service.code}` },
    openGraph: { title: r.service.nameAr, description: r.service.summary },
  };
}

export default async function ServicePage({ params }: P) {
  const r = await getService((await params).code);
  if (!r) notFound();
  const { service: s, category, related, inPackages } = r;
  const stage = JOURNEY.find((j) => j.stage === s.stage);
  const conflict = CONFLICT_LABEL[s.conflictRule] ?? null;
  const price = priceText(s.pricingModel, s.basePrice);
  const off = availabilityCopy(s);

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Service",
          name: s.nameAr,
          description: s.summary,
          serviceType: category.nameAr,
          provider: { "@type": "Organization", name: "وقفك", url: SITE_URL },
          areaServed: "SA",
          url: `${SITE_URL}/services/${s.code}`,
        }}
      />
      <div className="border-b border-line bg-stone">
        <Container className="py-8 md:py-12">
          <Crumbs items={[{ href: "/services", label: "الخدمات" }, { href: `/services#cat-${category.code}`, label: category.nameAr }, { label: s.nameAr }]} />
          <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-[14px] text-muted">
                <span className="tabular font-medium" dir="ltr">{s.code}</span>
                {stage ? <span>مرحلة {stage.name}</span> : null}
                {off ? <Badge tone="warn">{off.label}</Badge> : null}
              </p>
              <h1 className="mt-2 font-naskh text-[1.9rem] font-bold leading-[1.5] text-ink md:text-[2.4rem]">{s.nameAr}</h1>
              <p className="mt-3 max-w-2xl text-[17px] leading-8 text-muted">{s.summary}</p>
            </div>

            <aside aria-label="طلب الخدمة" className="rounded-lg border border-line bg-surface p-5 shadow-card">
              <p className="text-[14px] text-muted">التسعير</p>
              <p className="mt-0.5 text-xl font-semibold text-text">{price}</p>
              <p className="text-[13.5px] text-muted">
                {s.pricingModel === "free"
                  ? "دون مقابل."
                  : s.basePrice
                    ? `${PRICING_LABEL[s.pricingModel]}، وتضاف ضريبة القيمة المضافة.`
                    : `طريقة التسعير: ${PRICING_LABEL[s.pricingModel]}. نرسل إليك العرض بعد الاطلاع على حالتك.`}
              </p>
              {s.availability.available ? (
                <>
                  <Link href={`/app/requests/new?service=${encodeURIComponent(s.code)}`} className={buttonClass("primary", "lg", "mt-5 w-full")}>
                    اطلب الخدمة
                  </Link>
                  <p className="mt-2 text-[13px] leading-6 text-muted">يُقدَّم الطلب من حسابك على المنصة، فندرسه ونرسل إليك العرض والعقد قبل أي التزام.</p>
                </>
              ) : (
                <>
                  <Link href={`/contact?topic=service&service=${s.code}`} className={buttonClass("secondary", "lg", "mt-5 w-full")}>
                    {off?.gated ? "سجّل اهتمامك بالخدمة" : "تواصل معنا بشأن الخدمة"}
                  </Link>
                  <p className="mt-2 text-[13px] leading-6 text-muted">{off?.reason}</p>
                </>
              )}
              <div className="mt-4 border-t border-line pt-4">
                <Link href="/assessment" className="text-[14px] font-medium text-ink underline underline-offset-4">لست متأكدًا من حاجتك؟ ابدأ بتقييم وقفك مجانًا</Link>
              </div>
            </aside>
          </div>
        </Container>
      </div>

      <Container className="grid gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-10">
          {s.description ? (
            <section aria-labelledby="desc">
              <h2 id="desc" className="font-naskh text-[1.4rem] font-bold text-ink">عن الخدمة</h2>
              <p className="mt-2 max-w-3xl whitespace-pre-line text-[16px] leading-8">{s.description}</p>
            </section>
          ) : null}

          <section aria-labelledby="outputs">
            <h2 id="outputs" className="font-naskh text-[1.4rem] font-bold text-ink">ما تحصل عليه</h2>
            <p className="mt-2 flex items-start gap-2 text-[16px] leading-8">
              <FileText aria-hidden className="mt-1.5 size-5 shrink-0 text-muted" />
              {s.outputs ?? "يُحدَّد في عرض الخدمة."}
            </p>
          </section>

          {s.requirements || s.requiredDocuments.length ? (
            <section aria-labelledby="needs">
              <h2 id="needs" className="font-naskh text-[1.4rem] font-bold text-ink">ما نحتاجه منك</h2>
              {s.requirements ? <p className="mt-2 whitespace-pre-line text-[16px] leading-8">{s.requirements}</p> : null}
              {s.requiredDocuments.length ? (
                <ul className="mt-3 divide-y divide-line border-y border-line">
                  {s.requiredDocuments.map((d) => (
                    <li key={d.docType} className="flex items-center justify-between gap-3 py-2.5 text-[15.5px]">
                      <span>{d.label}</span>
                      <span className="text-[13px] text-muted">{d.required ? "مطلوب" : "إن وُجد"}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {s.regulatoryRestrictions || conflict ? (
            <section aria-labelledby="limits">
              <h2 id="limits" className="font-naskh text-[1.4rem] font-bold text-ink">ضوابط الخدمة</h2>
              <div className="mt-3 space-y-3">
                {s.regulatoryRestrictions ? <Alert tone="info">{s.regulatoryRestrictions}</Alert> : null}
                {conflict ? <Alert tone="neutral">{conflict}</Alert> : null}
              </div>
            </section>
          ) : null}

          {related.length ? (
            <section aria-labelledby="related">
              <h2 id="related" className="font-naskh text-[1.4rem] font-bold text-ink">خدمات أخرى في {category.nameAr}</h2>
              <ul className="mt-3 border-t border-line">
                {related.map((x) => (
                  <ServiceRow key={x.id} s={x} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <aside aria-label="تفاصيل الخدمة">
          <dl className="space-y-4 rounded-lg bg-surface-2 p-5 text-[15px]">
            {s.slaDays ? (
              <Row icon={Clock} label="المدة المتوقعة">نحو {daysAr(s.slaDays)} من اكتمال المستندات</Row>
            ) : null}
            {s.audiences.length ? (
              <Row icon={Users} label="تناسب">{s.audiences.map((a) => SERVICE_AUDIENCE_LABEL[a] ?? a).join("، ")}</Row>
            ) : null}
            {s.departmentKey ? <Row icon={Info} label="الفريق المنفّذ">{DEPARTMENT_LABEL[s.departmentKey] ?? s.departmentKey}</Row> : null}
            {inPackages.length ? (
              <Row icon={FileText} label="ضمن باقة">
                {inPackages.map((p, i) => (
                  <span key={p.code}>
                    {i ? "، " : null}
                    <Link href={`/packages#pkg-${p.code}`} className="text-ink underline underline-offset-4">{p.nameAr}</Link>
                  </span>
                ))}
              </Row>
            ) : null}
          </dl>
        </aside>
      </Container>
    </>
  );
}

function Row({ icon: Icon, label, children }: { icon: typeof Clock; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <Icon aria-hidden className="mt-1 size-4 shrink-0 text-muted" />
      <div>
        <dt className="text-[13px] text-muted">{label}</dt>
        <dd>{children}</dd>
      </div>
    </div>
  );
}
