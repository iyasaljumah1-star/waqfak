import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageIntro } from "@/components/site/bits";
import { TOPIC_LABEL } from "@/components/site/labels";
import { fmtDate } from "@/lib/utils";
import { getLibrary } from "@/server/modules/public/queries";

export const metadata: Metadata = {
  title: "الأنظمة واللوائح",
  description: "ملخصات للأنظمة واللوائح والأدلة المنظمة للأوقاف في المملكة: نظام الهيئة العامة للأوقاف، لائحة تنظيم أعمال النظارة، جدول المخالفات، معايير المستفيد الحقيقي، ولوائح الاستثمار.",
  alternates: { canonical: "/regulations" },
};

export default async function RegulationsPage() {
  const regs = (await getLibrary()).filter((i) => i.kind === "regulation");
  return (
    <>
      <PageIntro
        crumbs={[{ label: "الأنظمة واللوائح" }]}
        title="الأنظمة واللوائح"
        lede="ملخص لكل نظام أو لائحة أو دليل نبني عليه عملنا: ما الذي ينظّمه، ومن يخاطب، وأهم مواده. الملخص للفهم، والمرجع الملزم هو النص الرسمي لدى مصدره."
      />
      <Container className="py-10">
        <ol className="divide-y divide-line border-y border-line">
          {regs.map((r) => (
            <li key={r.id} className="group relative grid gap-1 py-5 md:grid-cols-[minmax(0,1fr)_200px] md:gap-8">
              <div>
                <h2 className="font-naskh text-[1.3rem] font-bold leading-[1.6] text-text group-hover:text-ink">
                  <Link href={`/library/${r.slug}`} className="after:absolute after:inset-0">{r.titleAr}</Link>
                </h2>
                {r.summary ? <p className="mt-1 max-w-3xl text-[15px] leading-7 text-muted">{r.summary}</p> : null}
              </div>
              <dl className="text-[13.5px] text-muted md:text-end">
                {r.topic ? (
                  <div>
                    <dt className="sr-only">الموضوع</dt>
                    <dd>{TOPIC_LABEL[r.topic] ?? r.topic}</dd>
                  </div>
                ) : null}
                {r.lastVerifiedAt ? (
                  <div>
                    <dt className="inline">آخر تحقق: </dt>
                    <dd className="inline">{fmtDate(r.lastVerifiedAt)}</dd>
                  </div>
                ) : null}
              </dl>
            </li>
          ))}
        </ol>
      </Container>
    </>
  );
}
