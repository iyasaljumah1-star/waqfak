import type { Metadata } from "next";
import Link from "next/link";
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
      <PageIntro crumbs={[{ href: "/tools", label: "الأدوات" }, { label: t.title }]} title={t.title} lede={t.lede} />
      <Container className="py-8 md:py-10">
        <IndicativeNote>
          أداة استرشادية: تحسب بناءً على ما تدخله، ولا تحفظ بياناتك ولا ترسلها. نتيجتها ليست فتوى ولا رأيًا قانونيًا ملزمًا؛ للتأكد في حالتك اطلب استشارة موقّعة.
        </IndicativeNote>
        <div className="mt-8">{body}</div>

        <div className="mt-12 grid gap-10 border-t border-line pt-8 md:grid-cols-2">
          <section aria-labelledby="method">
            <h2 id="method" className="font-naskh text-[1.3rem] font-bold text-ink">كيف نحسب</h2>
            <p className="mt-2 text-[15.5px] leading-8">{t.method}</p>
            <h3 className="mt-5 text-[14px] font-medium text-muted">المراجع</h3>
            <ul className="mt-1 list-disc space-y-1 ps-5 text-[14.5px] leading-7 text-muted">
              {t.sources.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="next" className="md:border-s md:border-line md:ps-10">
            <h2 id="next" className="font-naskh text-[1.3rem] font-bold text-ink">الخطوة التالية</h2>
            <p className="mt-2 text-[15.5px] leading-8">إن أردت أن يتولى مختص هذه المسألة في وقفك، فالخدمة الأقرب: {t.service.label}.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href={`/services/${t.service.code}`} className={buttonClass("primary", "md")}>{t.service.label}</Link>
              <Link href="/tools" className={buttonClass("secondary", "md")}>أدوات أخرى</Link>
            </div>
          </section>
        </div>
      </Container>
    </>
  );
}
