import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageIntro } from "@/components/site/bits";
import { TOOLS } from "@/components/site/tools/registry";

export const metadata: Metadata = {
  title: "الأدوات",
  description: "أدوات استرشادية مجانية للواقف والناظر: تصنيف نوع الوقف، وحجمه ومتطلباته، ومواعيد التسجيل، وثلث الوصية، وجاهزية الناظر.",
  alternates: { canonical: "/tools" },
};

export default function ToolsIndex() {
  return (
    <>
      <PageIntro
        crumbs={[{ label: "الأدوات" }]}
        title="الأدوات"
        lede="حسابات سريعة تعمل في متصفحك ولا تحفظ شيئًا مما تدخله. نتائجها استرشادية، ولكل منها مرجعها النظامي."
      />
      <Container className="py-10">
        <ul className="divide-y divide-line border-y border-line">
          {TOOLS.map((t) => (
            <li key={t.slug}>
              <Link href={`/tools/${t.slug}`} className="group grid gap-1 py-5 md:grid-cols-[280px_minmax(0,1fr)] md:gap-8">
                <span className="font-naskh text-[1.3rem] font-bold text-ink group-hover:underline group-hover:underline-offset-8">{t.title}</span>
                <span className="text-[15.5px] leading-7 text-muted">{t.short}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-[15px] text-muted">
          تريد صورة كاملة عن وقفك بدل أداة واحدة؟ <Link href="/assessment" className="font-medium text-ink underline underline-offset-4">ابدأ التقييم الوقفي المجاني</Link>.
        </p>
      </Container>
    </>
  );
}
