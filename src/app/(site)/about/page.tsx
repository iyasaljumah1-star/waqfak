import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass } from "@/components/ui";
import { ContentDocument } from "@/components/site/document";
import { getCompany, getPage } from "@/server/modules/public/queries";

export async function generateMetadata(): Promise<Metadata> {
  const item = await getPage("about-waqfak");
  return { title: item?.titleAr ?? "عن وقفك", description: item?.seoDescription ?? item?.summary ?? undefined, alternates: { canonical: "/about" } };
}

export default async function AboutPage() {
  const [item, { profile, licenses }] = await Promise.all([getPage("about-waqfak"), getCompany()]);
  if (!item) notFound();
  return (
    <ContentDocument
      item={item}
      showKind={false}
      crumbs={[{ label: "عن وقفك" }]}
      after={
        <>
          <section aria-labelledby="facts" className="mt-10 max-w-[68ch]">
            <h2 id="facts" className="font-naskh text-[1.4rem] font-bold text-ink">بيانات الشركة والتراخيص</h2>
            <dl className="card mt-4 divide-y divide-line rounded-md border border-line bg-surface px-4 text-[15px] md:px-5">
              <Fact label="الاسم">{profile.nameAr ?? "شركة وقفك"}</Fact>
              <Fact label="الشكل النظامي">{profile.legalForm ?? "شركة ذات مسؤولية محدودة"} (تحت التأسيس)</Fact>
              <Fact label="السجل التجاري">{profile.crNumber || "—"}</Fact>
              {licenses.map((l) => (
                <Fact key={l.key} label={l.nameAr}>
                  {l.key === "gaa_nazara_license" && !l.active ? "تُتاح خدمات النظارة بعد اعتماده" : l.number || "—"}
                </Fact>
              ))}
            </dl>
          </section>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/contact" className={buttonClass("primary", "md")}>تواصل معنا</Link>
            <Link href="/services" className={buttonClass("secondary", "md")}>تصفّح الخدمات</Link>
          </div>
        </>
      }
    />
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-4 py-3">
      <dt className="font-medium text-muted">{label}</dt>
      <dd className="tabular">{children}</dd>
    </div>
  );
}
