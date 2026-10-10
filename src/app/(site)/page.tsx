import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, BookOpenCheck, ClipboardList, FileCheck2, FileLock2, Landmark, Save, Scale, Sparkles } from "lucide-react";
import { buttonClass } from "@/components/ui";
import { Container, JsonLd, SITE_URL } from "@/components/site/bits";
import { ArticleCard, CallToAction, CategoryCard, Chip, FeatureCard, ReferenceCard, Section, SectionHeader } from "@/components/site/blocks";
import { AUDIENCE_ICON, categoryIcon } from "@/components/site/icons";
import { JOURNEY, TOPIC_LABEL } from "@/components/site/labels";
import { getCatalog, getLibrary } from "@/server/modules/public/queries";

export const metadata: Metadata = {
  title: { absolute: "وقفك — خدمات الأوقاف من الفكرة إلى الاستدامة" },
  description:
    "وقفك شركة سعودية متخصصة في الأوقاف: تصميم الوقف وصياغة وثيقته وتجهيز متطلبات توثيقه وتسجيله، ومساندة الناظر في الحوكمة والمالية والامتثال والاستثمار. ابدأ بتقييم وقفك مجانًا.",
  alternates: { canonical: "/" },
};

const PATHS = [
  { key: "waqif", href: "/for/waqif", who: "أنا واقف", clause: "أريد أن أقف مالًا أو أوصي بوقف، في وجه برٍّ أحتسبه." },
  { key: "nazir", href: "/for/nazir", who: "أنا ناظر", clause: "أدير وقفًا قائمًا، وأريد أن أعرف ما يلزمني ومتى." },
  { key: "beneficiary", href: "/for/beneficiary", who: "أنا مستفيد", clause: "لي حق في غلة وقف، وأريد أن أفهمه وأطمئن إليه." },
  { key: "entities", href: "/for/entities", who: "نحن جهة", clause: "جمعية أو مؤسسة أو شركة وقفية تبني أوقافها أو تديرها." },
];

const serviceCount = (n: number) => (n === 1 ? "خدمة واحدة" : n === 2 ? "خدمتان" : n <= 10 ? `${n} خدمات` : `${n} خدمة`);

export default async function Home() {
  const [{ categories, services }, library] = await Promise.all([getCatalog(), getLibrary()]);
  const latest = library.filter((i) => i.kind !== "regulation").slice(0, 4);
  const regs = library.filter((i) => i.kind === "regulation").slice(0, 6);
  const byStage = (s: number) => services.filter((x) => x.stage === s).length;

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "وقفك",
          alternateName: "Waqfak",
          url: SITE_URL,
          description: "شركة سعودية متخصصة في خدمات الأوقاف: التأسيس والوصايا ومساندة النظارة والحوكمة والمالية والاستثمار والامتثال.",
          areaServed: "SA",
          knowsLanguage: "ar",
        }}
      />

      {/* ───────── Hero: the grove ───────── */}
      <section aria-labelledby="hero-title" className="bg-stone pb-4 pt-4 md:pt-6">
        <Container>
          <div className="grid gap-8 rounded-[28px] bg-ink px-6 py-10 text-white sm:px-10 md:rounded-[36px] md:py-14 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,460px)] lg:items-center lg:gap-14 lg:px-14 lg:py-16 dark:bg-[#0d3a2e]">
            <div>
              <span className="inline-flex rounded-full bg-white/12 px-3.5 py-1.5 text-[14px] font-medium text-white/90">لكل وقف رحلة من خمس مراحل</span>
              <h1 id="hero-title" className="mt-5 font-display text-[2.3rem] font-bold leading-[1.45] sm:text-[2.8rem] lg:text-[3.4rem] lg:leading-[1.4]">
                غرسٌ يبقى أصله،
                <br />
                وتتجدّد ثمرته.
              </h1>
              <p className="mt-5 max-w-xl text-[17px] leading-8 text-white/80 md:text-lg md:leading-9">
                وقفك شركة متخصصة في الأوقاف. نصمم وقفك ونصوغ وثيقته ونجهّز متطلبات توثيقه وتسجيله، ثم نساند ناظره في الحوكمة والمالية والامتثال والاستثمار، بخدمات تستند إلى الأنظمة واللوائح المنظِّمة للأوقاف.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/assessment" className={buttonClass("seal", "lg")}>قيّم وقفك مجانًا</Link>
                <Link href="/services" className={buttonClass("secondary", "lg", "border-transparent bg-white text-ink hover:bg-white/90")}>تصفّح الخدمات</Link>
              </div>
              <p className="mt-4 text-[14px] text-white/70">تقييم مجاني في نحو ربع ساعة، تبدأه دون اسم أو رقم هوية.</p>
            </div>

            <div className="rounded-[24px] bg-surface p-6 text-text shadow-card sm:p-8">
              <h2 className="text-[1.3rem] font-bold text-ink">من أنت في هذا الوقف؟</h2>
              <p className="mt-1 text-[14px] text-muted">اختر ما يصفك، ونرشدك إلى ما يخصك.</p>
              <ul className="mt-4 grid gap-2">
                {PATHS.map((p) => {
                  const Icon = AUDIENCE_ICON[p.key];
                  return (
                  <li key={p.href}>
                    <Link href={p.href} className="group flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3.5 text-[15.5px] leading-7 transition-colors hover:bg-ink-soft focus-visible:outline-offset-2">
                      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-surface text-ink ring-1 ring-line">
                        <Icon strokeWidth={1.75} className="size-[18px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="font-bold text-ink">{p.who}: </span>
                        {p.clause}
                      </span>
                      <ArrowLeft aria-hidden className="size-4 shrink-0 text-muted transition-transform group-hover:-translate-x-1 group-hover:text-ink" />
                    </Link>
                  </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </Container>
      </section>

      {/* ───────── Journey: five stages, a true sequence ───────── */}
      <Section labelledBy="journey-title">
        <SectionHeader id="journey-title" title="رحلة الوقف، من الفكرة إلى الاستدامة" lede="لكل مرحلة التزاماتها ومواعيدها. حدّد مرحلة وقفك، وابدأ بالخدمات التي تناسبها." />
        <ol className="relative mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-5 lg:gap-3">
          {/* the thread that ties the stages (desktop) */}
          <span aria-hidden className="absolute inset-x-8 top-[38px] hidden h-px bg-line-strong lg:block" />
          {JOURNEY.map((j) => {
            const n = byStage(j.stage);
            return (
              <li key={j.stage} className="card relative flex gap-4 rounded-md border border-line bg-surface p-5 md:flex-col md:gap-0">
                <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-ink text-[15px] font-bold text-white tabular ring-4 ring-surface dark:text-[#0f141c]">
                  {j.stage}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <h3 className="font-naskh text-[1.2rem] font-bold text-ink md:mt-4">{j.name}</h3>
                  <p className="mt-1 flex-1 text-[14.5px] leading-7 text-muted">{j.line}</p>
                  {n ? (
                    <Link href={`/services?stage=${j.stage}`} className="mt-3 inline-flex items-center gap-1 text-[14px] font-medium text-ink underline-offset-4 hover:underline md:mt-4">
                      خدمات المرحلة ({serviceCount(n)})
                      <ArrowLeft aria-hidden className="size-4 shrink-0" />
                    </Link>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </Section>

      {/* ───────── Service categories ───────── */}
      <Section tone="stone" labelledBy="cats-title">
        <SectionHeader
          id="cats-title"
          title="فهرس الخدمات"
          lede={`${serviceCount(services.length)} في ${categories.length} أبواب، لكل خدمة نطاق ومخرجات واضحة، وضوابطها النظامية مبيّنة في صفحتها.`}
          action={<Link href="/services" className={buttonClass("secondary", "md")}>كل الخدمات</Link>}
        />
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((c) => (
            <li key={c.id} className="flex">
              <div className="flex-1 [&>div]:h-full">
                <CategoryCard href={`/services#cat-${c.code}`} icon={categoryIcon(c.code)} title={c.nameAr} description={c.description} meta={serviceCount(c.services.length)} more="خدمات الباب" />
              </div>
            </li>
          ))}
          <li className="flex">
            <Link href="/packages" className="group flex flex-1 flex-col justify-between rounded-md border border-dashed border-ink/30 bg-surface/60 p-5 transition-colors hover:border-ink/60 hover:bg-surface md:p-6">
              <span>
                <span className="block font-naskh text-[1.2rem] font-bold text-ink">الباقات السنوية</span>
                <span className="mt-1.5 block text-[15px] leading-7 text-muted">خدمات مجمّعة بحسب حجم الوقف على مدار السنة، تبدأ بباقة مجانية.</span>
              </span>
              <span className="mt-4 inline-flex items-center gap-1 text-[14px] font-medium text-ink">
                قارن الباقات
                <ArrowLeft aria-hidden className="size-4 transition-transform group-hover:-translate-x-0.5" />
              </span>
            </Link>
          </li>
        </ul>
      </Section>

      {/* ───────── Free assessment ───────── */}
      <section aria-labelledby="asmt-title" className="bg-ink text-white dark:bg-[#0d3a2e]">
        <Container className="grid gap-10 py-14 md:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-center">
          <div>
            <Chip tone="onInk" icon={Sparkles}>مجاني</Chip>
            <h2 id="asmt-title" className="mt-4 font-naskh text-[1.75rem] font-bold leading-[1.55] md:text-[2.2rem]">قبل أن تطلب أي خدمة، اعرف أين يقف وقفك</h2>
            <p className="mt-4 max-w-xl text-[16.5px] leading-8 text-white/80">
              أسئلة واضحة في أحد عشر محورًا، من سلامة الشرط والتسجيل إلى المالية والحوكمة والمستفيدين. تحصل على درجة لكل محور، وتنبيه إلى المخالفات الجوهرية، وخطة عمل مرتبة مع مرجع كل ملاحظة.
            </p>
            <Link href="/assessment" className={buttonClass("seal", "lg", "mt-8")}>ابدأ التقييم المجاني</Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FeatureCard onInk icon={ClipboardList} title="مجاني وسهل البدء">تبدأ التقييم دون اسم أو رقم هوية.</FeatureCard>
            <FeatureCard onInk icon={Save} title="يُحفظ تلقائيًا">توقّف متى شئت، وأكمل لاحقًا من الجهاز نفسه أو من حسابك.</FeatureCard>
            <FeatureCard onInk icon={Scale} title="بمرجع نظامي">كل ملاحظة تحيل إلى المادة أو الدليل الذي بُنيت عليه.</FeatureCard>
            <FeatureCard onInk icon={FileCheck2} title="نتيجة قابلة للتنفيذ">توصيات مرتبطة بالخدمة المناسبة، وتقرير PDF تحتفظ به.</FeatureCard>
          </div>
        </Container>
      </section>

      {/* ───────── Regulatory reference + commitments ───────── */}
      <Section labelledBy="trust-title">
        <SectionHeader
          id="trust-title"
          title="مرجعيتنا في العمل"
          lede="نقدم خدماتنا وحلولنا بالاستناد إلى الأنظمة واللوائح والضوابط والأدلة ذات الصلة بالأوقاف، مع مراعاة طبيعة كل وقف واحتياجاته. هذه أبرزها، ولكل منها ملخص في المكتبة."
          action={<Link href="/regulations" className={buttonClass("secondary", "md")}>كل الأنظمة واللوائح</Link>}
        />
        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <ul className="grid content-start gap-3 sm:grid-cols-2">
            {regs.map((r) => (
              <li key={r.id} className="flex [&>div]:flex-1">
                <ReferenceCard href={`/library/${r.slug}`} icon={Scale} title={r.titleAr} meta={r.topic && TOPIC_LABEL[r.topic] ? <span>{TOPIC_LABEL[r.topic]}</span> : null} />
              </li>
            ))}
          </ul>
          <div className="rounded-lg bg-stone p-6 md:p-7">
            <h3 className="font-naskh text-[1.25rem] font-bold text-ink">ما يميّز عملنا</h3>
            <div className="mt-5 space-y-6">
              <FeatureCard plain icon={BookOpenCheck} title="خدمات تستند إلى المرجعية النظامية">
                كل توصية نقدمها مقرونة بمرجعها من النظام أو اللائحة أو الدليل، فتعرف أساسها ومدى إلزامها لوقفك.
              </FeatureCard>
              <FeatureCard plain icon={Landmark} title="حلول متكاملة في كل مراحل الوقف">
                من تصميم الوقف وصياغة وثيقته وتجهيز متطلبات توثيقه وتسجيله، إلى مساندة ناظره في الحوكمة والمالية والامتثال والاستثمار، ونرافقك في الإجراءات لدى الجهات المختصة.
              </FeatureCard>
              <FeatureCard plain icon={Scale} title="رأي مهني موقّع">
                تصدر استشاراتنا الشرعية والقانونية رأيًا مهنيًا موقّعًا باسم المستشار وصفته، مبنيًا على وقائع وقفك ووثائقه.
              </FeatureCard>
              <FeatureCard plain icon={FileLock2} title="بيانات وقفك لك">
                نشفّر البيانات الحساسة ونحفظها داخل المملكة، ولا يطّلع على ملف وقفك إلا من تمنحه الصلاحية. <Link href="/legal/privacy" className="font-medium text-ink underline underline-offset-4">سياسة الخصوصية</Link>
              </FeatureCard>
            </div>
          </div>
        </div>
      </Section>

      {/* ───────── Library ───────── */}
      <Section tone="stone" labelledBy="lib-title">
        <SectionHeader
          id="lib-title"
          title="من المكتبة"
          lede="مقالات وأدلة مختصرة بلغة واضحة، مع مرجع كل معلومة."
          action={<Link href="/library" className={buttonClass("secondary", "md")}>تصفّح المكتبة</Link>}
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {latest.map((i) => (
            <ArticleCard key={i.id} item={i} />
          ))}
        </div>
      </Section>

      <CallToAction
        title="ابدأ بخطوة واضحة لوقفك"
        lede="قيّم وقفك مجانًا لتعرف ما يلزمه الآن، أو صف لنا حاجتك ويتواصل معك فريقنا خلال يومي عمل."
        primary={{ href: "/assessment", label: "قيّم وقفك مجانًا" }}
        secondary={{ href: "/contact", label: "تحدّث مع فريقنا" }}
      />
    </>
  );
}
