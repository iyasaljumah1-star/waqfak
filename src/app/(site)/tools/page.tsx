import type { Metadata } from "next";
import { Wrench } from "lucide-react";
import { Container, PageIntro } from "@/components/site/bits";
import { CallToAction, CategoryCard } from "@/components/site/blocks";
import { TOOL_ICON } from "@/components/site/icons";
import { TOOLS } from "@/components/site/tools/registry";

export const metadata: Metadata = {
  title: "الأدوات",
  description: "أدوات مجانية للواقف والناظر: تصنيف نوع الوقف، وحجمه ومتطلباته، ومواعيد التسجيل، وثلث الوصية، وجاهزية الناظر.",
  alternates: { canonical: "/tools" },
};

export default function ToolsIndex() {
  return (
    <>
      <PageIntro
        icon={Wrench}
        crumbs={[{ label: "الأدوات" }]}
        title="الأدوات"
        lede="حسابات سريعة تعمل في متصفحك دون حفظ ما تدخله، تمنحك نتيجة تقديرية بمرجعها النظامي، وتساعدك على تحديد خطوتك التالية."
      />
      <Container className="py-10 md:py-12">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((t) => (
            <li key={t.slug} className="flex [&>div]:flex-1">
              <CategoryCard href={`/tools/${t.slug}`} icon={TOOL_ICON[t.slug] ?? Wrench} title={t.title} description={t.short} more="استخدم الأداة" headingLevel={2} />
            </li>
          ))}
        </ul>
      </Container>
      <CallToAction
        title="تريد صورة شاملة عن وقفك؟"
        lede="يجمع التقييم الوقفي المجاني ما تقيسه هذه الأدوات وأكثر، في أحد عشر محورًا وخطة عمل مرتبة."
        primary={{ href: "/assessment", label: "ابدأ التقييم الوقفي المجاني" }}
      />
    </>
  );
}
