import type { Metadata } from "next";
import { CalendarCheck, Landmark, Scale } from "lucide-react";
import { Container, PageIntro } from "@/components/site/bits";
import { CallToAction, Chip, ReferenceCard } from "@/components/site/blocks";
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
        icon={Landmark}
        crumbs={[{ label: "الأنظمة واللوائح" }]}
        title="الأنظمة واللوائح"
        lede="ملخص لكل نظام أو لائحة أو دليل نستند إليه في خدماتنا: ما ينظّمه، ومن يخاطب، وأهم مواده، مع الإحالة إلى النص الرسمي المعتمد لدى مصدره."
      />
      <Container className="py-10 md:py-12">
        <ol className="grid gap-4 md:grid-cols-2">
          {regs.map((r) => (
            <li key={r.id} className="flex [&>div]:flex-1">
              <ReferenceCard
                headingLevel={2}
                href={`/library/${r.slug}`}
                icon={Scale}
                title={r.titleAr}
                summary={r.summary}
                meta={
                  <>
                    {r.topic ? <Chip>{TOPIC_LABEL[r.topic] ?? r.topic}</Chip> : null}
                    {r.lastVerifiedAt ? (
                      <span className="inline-flex items-center gap-1">
                        <CalendarCheck aria-hidden className="size-3.5" />
                        آخر تحقق: {fmtDate(r.lastVerifiedAt)}
                      </span>
                    ) : null}
                  </>
                }
              />
            </li>
          ))}
        </ol>
      </Container>
      <CallToAction
        title="تريد معرفة ما يلزم وقفك منها؟"
        lede="يربط التقييم الوقفي كل ملاحظة بمادتها من هذه الأنظمة، ويرتّب ما يلزمك في خطة عمل."
        primary={{ href: "/assessment", label: "قيّم وقفك مجانًا" }}
        secondary={{ href: "/services/C08", label: "اطلب رأيًا مهنيًا" }}
      />
    </>
  );
}
