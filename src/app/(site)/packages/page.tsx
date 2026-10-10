import type { Metadata } from "next";
import Link from "next/link";
import { Check, Lock } from "lucide-react";
import { buttonClass } from "@/components/ui";
import { Container, PageIntro } from "@/components/site/bits";
import { SIZE_LABEL } from "@/lib/utils";
import { getPackages } from "@/server/modules/public/queries";

export const metadata: Metadata = {
  title: "الباقات",
  description: "باقات وقفك بحسب حجم الوقف: مجانية وامتثال وحوكمة ومؤسسي، وما تشمله كل باقة من خدمات.",
  alternates: { canonical: "/packages" },
};

const nf = new Intl.NumberFormat("ar-SA-u-nu-latn", { maximumFractionDigits: 0 });

function pkgPrice(p: { code: string; monthlyPrice: string | null; annualPrice: string | null }) {
  if (p.code === "free") return { main: "مجانًا", sub: "دون مدة محددة ودون بطاقة دفع" };
  if (p.annualPrice) return { main: `${nf.format(Number(p.annualPrice))} ر.س سنويًا`, sub: p.monthlyPrice ? `أو ${nf.format(Number(p.monthlyPrice))} ر.س شهريًا` : "تضاف ضريبة القيمة المضافة" };
  if (p.monthlyPrice) return { main: `${nf.format(Number(p.monthlyPrice))} ر.س شهريًا`, sub: "تضاف ضريبة القيمة المضافة" };
  return { main: "عرض سعر بعد الدراسة", sub: "بحسب حجم الوقف وأصوله" };
}

export default async function PackagesPage() {
  const pkgs = await getPackages();
  const open = pkgs.filter((p) => !p.isClosed);
  const closed = pkgs.filter((p) => p.isClosed);

  return (
    <>
      <PageIntro
        crumbs={[{ label: "الباقات" }]}
        title="الباقات"
        lede="تجمع كل باقة ما يحتاجه الوقف بحسب حجمه على مدار السنة. ابدأ بالباقة المجانية، وانتقل إلى ما يناسبك كلما نما وقفك أو زادت التزاماته."
      />
      <Container className="py-10">
        <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-2 xl:grid-cols-4">
          {open.map((p) => {
            const price = pkgPrice(p);
            return (
              <section key={p.id} id={`pkg-${p.code}`} aria-labelledby={`pkg-h-${p.code}`} className="flex scroll-mt-24 flex-col bg-surface p-6">
                <h2 id={`pkg-h-${p.code}`} className="font-naskh text-[1.5rem] font-bold text-ink">{p.nameAr}</h2>
                <p className="text-[14px] text-muted">
                  {p.audience}
                  {p.targetSizeClasses.length ? ` (${p.targetSizeClasses.map((s) => SIZE_LABEL[s] ?? s).join(" أو ")})` : ""}
                </p>
                <p className="mt-4 text-lg font-semibold">{price.main}</p>
                <p className="text-[13px] text-muted">{price.sub}</p>
                {p.description ? <p className="mt-4 text-[15px] leading-7">{p.description}</p> : null}
                <h3 className="mt-5 text-[14px] font-medium text-muted">تشمل</h3>
                <ul className="mt-2 flex-1 space-y-1.5">
                  {p.services.map(({ service: s, note }) => (
                    <li key={s.id} className="flex gap-2 text-[14.5px] leading-6">
                      <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-olive" />
                      <span>
                        <Link href={`/services/${s.code}`} className="hover:text-ink hover:underline">{s.nameAr}</Link>
                        {note ? <span className="text-muted"> — {note}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
                <Link
                  href={p.code === "free" ? "/signup" : `/contact?topic=package&package=${p.code}`}
                  className={buttonClass(p.code === "free" ? "primary" : "secondary", "md", "mt-6 w-full")}
                >
                  {p.code === "free" ? "أنشئ حسابًا مجانيًا" : `اطلب عرض باقة ${p.nameAr}`}
                </Link>
              </section>
            );
          })}
        </div>

        {closed.map((p) => (
          <section key={p.id} id={`pkg-${p.code}`} aria-labelledby={`pkg-h-${p.code}`} className="mt-8 flex scroll-mt-24 flex-col gap-4 rounded-lg border border-dashed border-line-strong p-6 md:flex-row md:items-center">
            <Lock aria-hidden className="size-6 shrink-0 text-muted" />
            <div className="flex-1">
              <h2 id={`pkg-h-${p.code}`} className="font-naskh text-[1.3rem] font-bold text-ink">باقة {p.nameAr}</h2>
              <p className="mt-1 text-[15px] leading-7 text-muted">{p.description}</p>
              <p className="mt-1 text-[14px] text-muted">
                تُتاح هذه الباقة بعد اعتماد ترخيص الهيئة العامة للأوقاف للناظر الاعتباري، وتُقدَّم وفق ضوابط النظارة والاستقلالية.{" "}
                <Link href={`/contact?topic=package&package=${p.code}`} className="font-medium text-ink underline underline-offset-4">سجّل اهتمامك</Link>
              </p>
            </div>
          </section>
        ))}

        <p className="mt-8 max-w-3xl text-[14px] leading-7 text-muted">
          تضاف ضريبة القيمة المضافة إلى الأسعار المعلنة. ويمكنك طلب أي خدمة غير مشمولة في باقتك منفردةً من <Link href="/services" className="text-ink underline underline-offset-4">صفحة الخدمات</Link>.
          وتصدر فاتورة ما يُدفع من مال الوقف باسم الوقف.
        </p>
      </Container>
    </>
  );
}
