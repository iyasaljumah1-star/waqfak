import type { Metadata } from "next";
import Link from "next/link";
import { BookMarked, Footprints, Sigma } from "lucide-react";
import { TOOL_ICON } from "@/components/site/icons";
import { notFound } from "next/navigation";
import { buttonClass } from "@/components/ui";
import { Container, IndicativeNote, PageIntro } from "@/components/site/bits";
import { TOOLS } from "@/components/site/tools/registry";
import { NazirReadinessTool, RegistrationDeadlineTool, WaqfSizeTool, WaqfTypeTool, WillThirdTool } from "@/components/site/tools/tools";
import { getHolidays } from "@/server/modules/public/queries";

type P = { params: Promise<{ tool: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { tool } = await params;
  const t = TOOLS.find((x) => x.slug === tool);
  if (!t) return { title: "أداة غير موجودة" };
  return { title: t.title, description: t.short, alternates: { canonical: `/tools/${t.slug}` } };
}

const todayRiyadh = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());

export default async function ToolPage({ params }: P) {
  const { tool } = await params;
  const t = TOOLS.find((x) => x.slug === tool);
  if (!t) notFound();

  let body: React.ReactNode;
  switch (t.slug) {
    case "waqf-type":
      body = <WaqfTypeTool />;
      break;
    case "waqf-size":
      body = <WaqfSizeTool />;
      break;
    case "registration-deadline": {
      const holidays = await getHolidays("2015-01-01", "2036-12-31");
      body = <RegistrationDeadlineTool holidays={holidays} today={todayRiyadh()} />;
      break;
    }
    case "will-third":
      body = <WillThirdTool />;
      break;
    case "nazir-readiness":
      body = <NazirReadinessTool />;
      break;
  }

  return (
    <>
      <PageIntro icon={TOOL_ICON[t.slug]} crumbs={[{ href: "/tools", label: "الأدوات" }, { label: t.title }]} title={t.title} lede={t.lede} />
      <Container className="py-8 md:py-10">
        <IndicativeNote>
          تحسب الأداة نتيجة تقديرية بحسب ما تدخله، دون حفظ بياناتك أو إرسالها. ولتأكيد النتيجة في حالتك، يقدّم مستشارونا رأيًا مهنيًا موقّعًا.
        </IndicativeNote>
        <div className="mt-8">{body}</div>

        <div className="mt-12 grid gap-4 md:grid-cols-2">
          <section aria-labelledby="method" className="card rounded-lg border border-line bg-stone p-5 md:p-6">
            <h2 id="method" className="flex items-center gap-2 font-naskh text-[1.3rem] font-bold text-ink">
              <Sigma aria-hidden className="size-5" />
              كيف نحسب
            </h2>
            <p className="mt-2 text-[15.5px] leading-8">{t.method}</p>
            <h3 className="mt-5 border-t border-line-strong/60 pt-4 text-[14px] font-bold text-text">المراجع</h3>
            <ul className="mt-2 space-y-1.5 text-[14.5px] leading-7 text-muted">
              {t.sources.map((s) => (
                <li key={s} className="flex gap-2">
                  <BookMarked aria-hidden className="mt-1.5 size-3.5 shrink-0 text-seal" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="next" className="card rounded-lg border border-ink/25 bg-ink-soft p-5 md:p-6 dark:bg-[#10241c]">
            <h2 id="next" className="flex items-center gap-2 font-naskh text-[1.3rem] font-bold text-ink">
              <Footprints aria-hidden className="size-5" />
              الخطوة التالية
            </h2>
            <p className="mt-2 text-[15.5px] leading-8">ليتولى فريقنا المتخصص هذه المسألة في وقفك، فالخدمة المناسبة: {t.service.label}.</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href={`/services/${t.service.code}`} className={buttonClass("primary", "md")}>{t.service.label}</Link>
              <Link href="/tools" className={buttonClass("secondary", "md")}>أدوات أخرى</Link>
            </div>
          </section>
        </div>
      </Container>
    </>
  );
}
