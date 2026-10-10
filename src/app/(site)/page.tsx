import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, BookOpenCheck, FileLock2, Landmark, Scale } from "lucide-react";
import { buttonClass } from "@/components/ui";
import { ContentRowLink, Container, JsonLd, SITE_URL } from "@/components/site/bits";
import { JOURNEY } from "@/components/site/labels";
import { getCatalog, getCompany, getLibrary } from "@/server/modules/public/queries";

export const metadata: Metadata = {
  title: { absolute: "وقفك — خدمات الأوقاف من الفكرة إلى الاستدامة" },
  description:
    "وقفك شركة سعودية متخصصة في الأوقاف: تصميم الوقف وصياغة وثيقته وتسجيله، ومساندة الناظر في الحوكمة والمالية والامتثال والاستثمار. ابدأ بتقييم وقفك مجانًا.",
  alternates: { canonical: "/" },
};

const PATHS = [
  { href: "/for/waqif", who: "أنا واقف", clause: "أريد أن أحبس مالًا، أو أوصي بوقف، على وجهٍ أحتسبه." },
  { href: "/for/nazir", who: "أنا ناظر", clause: "أُدير وقفًا قائمًا، وأريد أن أعرف ما يلزمني ومتى." },
  { href: "/for/beneficiary", who: "أنا مستفيد", clause: "لي حق في غلة وقف، وأريد أن أفهمه وأطمئن إليه." },
  { href: "/for/entities", who: "نحن جهة", clause: "جمعية أو مؤسسة أو شركة وقفية تبني أوقافها أو تديرها." },
];

const serviceCount = (n: number) => (n === 1 ? "خدمة واحدة" : n === 2 ? "خدمتان" : n <= 10 ? `${n} خدمات` : `${n} خدمة`);

export default async function Home() {
  const [{ categories, services }, library, { licenses }] = await Promise.all([getCatalog(), getLibrary(), getCompany()]);
  const latest = library.filter((i) => i.kind !== "regulation").slice(0, 4);
  const regs = library.filter((i) => i.kind === "regulation").slice(0, 6);
  const byStage = (s: number) => services.filter((x) => x.stage === s).length;
  const nazara = licenses.find((l) => l.key === "gaa_nazara_license");

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
                وقفك شركة متخصصة في الأوقاف. نصمم الوقف ونصوغ وثيقته ونجهّز تسجيله، ثم نساند ناظره في الحوكمة والمالية والامتثال والاستثمار، ونذكر المرجع النظامي لكل خطوة.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/assessment" className={buttonClass("seal", "lg")}>قيّم وقفك مجانًا</Link>
                <Link href="/services" className={buttonClass("secondary", "lg", "border-transparent bg-white text-ink hover:bg-white/90")}>تصفّح الخدمات</Link>
              </div>
              <p className="mt-4 text-[14px] text-white/70">التقييم مجاني، ولا يطلب اسمًا ولا هوية، ويستغرق ربع ساعة تقريبًا.</p>
            </div>

            <div className="rounded-[24px] bg-surface p-6 text-text shadow-card sm:p-8">
              <h2 className="text-[1.3rem] font-bold text-ink">من أنت في هذا الوقف؟</h2>
              <p className="mt-1 text-[14px] text-muted">اختر ما يصفك، ندلّك على ما يخصّك.</p>
              <ul className="mt-4 grid gap-2">
                {PATHS.map((p) => (
                  <li key={p.href}>
                    <Link href={p.href} className="group flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3.5 text-[15.5px] leading-7 transition-colors hover:bg-ink-soft focus-visible:outline-offset-2">
                      <span className="min-w-0 flex-1">
                        <span className="font-bold text-ink">{p.who}: </span>
                        {p.clause}
                      </span>
                      <ArrowLeft aria-hidden className="size-4 shrink-0 text-muted transition-transform group-hover:-translate-x-1 group-hover:text-ink" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Container>
      </section>

      {/* ───────── Journey ───────── */}
      <section aria-labelledby="journey-title" className="py-14 md:py-20">
        <Container>
          <div className="max-w-2xl">
            <h2 id="journey-title" className="font-naskh text-[1.75rem] font-bold leading-[1.5] text-ink md:text-[2.1rem]">رحلة الوقف، من الفكرة إلى الاستدامة</h2>
            <p className="mt-2 text-[16.5px] leading-8 text-muted">لكل مرحلة التزاماتها ومواعيدها. اعرف أين يقف وقفك، وابدأ من خدمات مرحلته.</p>
          </div>
          <ol className="mt-10 grid gap-0 lg:grid-cols-5">
            {JOURNEY.map((j, i) => {
              const n = byStage(j.stage);
              return (
                <li key={j.stage} className="relative flex gap-4 pb-8 lg:block lg:pb-0 lg:pe-6">
                  {/* connecting rule: vertical on phones, horizontal on desktop */}
                  {i < JOURNEY.length - 1 ? (
                    <span aria-hidden className="absolute start-[15px] top-8 h-full w-px bg-line-strong lg:start-8 lg:top-[15px] lg:h-px lg:w-full" />
                  ) : null}
                  <span className="relative grid size-8 shrink-0 place-items-center rounded-full border border-ink bg-surface text-[14px] font-semibold text-ink tabular">
                    {j.stage}
                  </span>
                  <div className="min-w-0 lg:mt-5">
                    <h3 className="font-naskh text-[1.3rem] font-bold text-ink">{j.name}</h3>
                    <p className="mt-1 text-[15px] leading-7 text-muted">{j.line}</p>
                    {n ? (
                      <Link href={`/services?stage=${j.stage}`} className="mt-2 inline-flex items-center gap-1 text-[14.5px] font-medium text-ink underline-offset-4 hover:underline">
                        خدمات المرحلة ({serviceCount(n)})
                      </Link>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </Container>
      </section>

      {/* ───────── Service index ───────── */}
      <section aria-labelledby="cats-title" className="border-t border-line bg-surface-2 py-14 md:py-20">
        <Container>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <h2 id="cats-title" className="font-naskh text-[1.75rem] font-bold leading-[1.5] text-ink md:text-[2.1rem]">فهرس الخدمات</h2>
              <p className="mt-2 text-[16.5px] leading-8 text-muted">
                {serviceCount(services.length)} في {categories.length} أبواب. لكل خدمة نطاق ومخرجات معلنة، وما يقيّدها نظامًا مكتوب في صفحتها.
              </p>
            </div>
            <Link href="/services" className={buttonClass("secondary", "md")}>كل الخدمات</Link>
          </div>
          <ul className="mt-8 grid gap-x-12 md:grid-cols-2">
            {categories.map((c) => (
              <li key={c.id} className="border-b border-line">
                <Link href={`/services#cat-${c.code}`} className="group block py-5">
                  <span className="flex items-baseline gap-3">
                    <span className="font-naskh text-[1.25rem] font-bold text-text group-hover:text-ink">{c.nameAr}</span>
                    <span aria-hidden className="mb-1.5 flex-1 border-b border-dotted border-line-strong" />
                    <span className="shrink-0 text-[14px] text-muted tabular">{serviceCount(c.services.length)}</span>
                  </span>
                  {c.description ? <span className="mt-1 block text-[15px] leading-7 text-muted">{c.description}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* ───────── Assessment ───────── */}
      <section aria-labelledby="asmt-title" className="bg-ink text-white dark:bg-[#0f1520]">
        <Container className="grid gap-10 py-14 md:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
          <div>
            <h2 id="asmt-title" className="font-naskh text-[1.75rem] font-bold leading-[1.55] md:text-[2.2rem]">قبل أن تطلب أي خدمة، اعرف أين يقف وقفك</h2>
            <p className="mt-4 max-w-xl text-[16.5px] leading-8 text-white/80">
              أسئلة واضحة في أحد عشر محورًا، من سلامة الشرط والتسجيل إلى المالية والحوكمة والمستفيدين. تحصل على درجة لكل محور، وتنبيه بالمخالفات الجوهرية، وخطة عمل مرتبة مع مرجع كل ملاحظة.
            </p>
            <Link href="/assessment" className="mt-8 inline-flex h-12 items-center justify-center rounded-md bg-white px-6 font-medium text-ink hover:bg-white/90">
              ابدأ التقييم المجاني
            </Link>
          </div>
          <dl className="grid gap-px overflow-hidden rounded-lg bg-white/15 sm:grid-cols-2">
            {[
              ["مجاني ودون هوية", "لا نطلب اسمًا ولا رقم هوية لبدء التقييم."],
              ["يُحفظ تلقائيًا", "توقف متى شئت، وأكمل لاحقًا من الجهاز نفسه أو من حسابك."],
              ["بمرجع نظامي", "كل ملاحظة تشير إلى المادة أو الدليل الذي بُنيت عليه."],
              ["نتيجة تعمل بها", "توصيات مرتبطة بالخدمة المناسبة، وتقرير PDF تحتفظ به."],
            ].map(([t, d]) => (
              <div key={t} className="bg-ink p-5 dark:bg-[#0f1520]">
                <dt className="font-semibold">{t}</dt>
                <dd className="mt-1 text-[15px] leading-7 text-white/75">{d}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </section>

      {/* ───────── Trust ───────── */}
      <section aria-labelledby="trust-title" className="py-14 md:py-20">
        <Container className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <h2 id="trust-title" className="font-naskh text-[1.75rem] font-bold leading-[1.5] text-ink md:text-[2.1rem]">على ماذا نبني عملنا</h2>
            <p className="mt-2 text-[16.5px] leading-8 text-muted">ما نكتبه ونقدمه مرجعه الأنظمة واللوائح والأدلة الصادرة عن الجهات المختصة. هذه أبرزها، ولكل منها ملخص في المكتبة.</p>
            <ul className="mt-6 divide-y divide-line border-y border-line">
              {regs.map((r) => (
                <li key={r.id}>
                  <Link href={`/library/${r.slug}`} className="flex items-start gap-3 py-3.5 text-[15.5px] leading-7 hover:text-ink">
                    <Scale aria-hidden className="mt-1 size-4 shrink-0 text-muted" />
                    <span>{r.titleAr}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <Link href="/regulations" className="mt-4 inline-block text-[15px] font-medium text-ink underline underline-offset-4">كل الأنظمة واللوائح</Link>
          </div>
          <ul className="space-y-7 lg:pt-2">
            <Commit icon={BookOpenCheck} title="نذكر المرجع، ونفرّق بين الإلزامي والاسترشادي">
              كل التزام نعرضه مقرون بمادته. وما كان من مبادئ استرشادية نقوله كذلك، ولا نقدمه على أنه إلزام.
            </Commit>
            <Commit icon={Landmark} title="نعرف حدودنا">
              لسنا جهة رسمية ولا جهة توثيق، ولا نصدر فتاوى، ولا نجمع التبرعات ولا ندير الأموال استثماريًا.{" "}
              {nazara && !nazara.active ? "وخدمة تولي النظارة لن نقدمها قبل صدور ترخيص الهيئة العامة للأوقاف لنا." : null}
            </Commit>
            <Commit icon={FileLock2} title="بيانات وقفك لك">
              نشفّر البيانات الحساسة ونحفظها داخل المملكة، ولا يرى ملف وقفك إلا من تمنحه صلاحية. <Link href="/legal/privacy" className="font-medium text-ink underline underline-offset-4">سياسة الخصوصية</Link>
            </Commit>
          </ul>
        </Container>
      </section>

      {/* ───────── Library ───────── */}
      <section aria-labelledby="lib-title" className="border-t border-line pb-16 pt-14 md:pb-20">
        <Container>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 id="lib-title" className="font-naskh text-[1.75rem] font-bold leading-[1.5] text-ink md:text-[2.1rem]">من المكتبة</h2>
            <Link href="/library" className={buttonClass("secondary", "md")}>تصفّح المكتبة</Link>
          </div>
          <div className="mt-4 grid divide-y divide-line md:grid-cols-2 md:gap-x-12 md:divide-y-0">
            {latest.map((i) => (
              <div key={i.id} className="md:border-b md:border-line">
                <ContentRowLink item={i} />
              </div>
            ))}
          </div>
        </Container>
      </section>
    </>
  );
}

function Commit({ icon: Icon, title, children }: { icon: typeof Scale; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="mt-1 grid size-10 shrink-0 place-items-center rounded-full bg-ink-soft text-ink">
        <Icon aria-hidden className="size-5" />
      </span>
      <div>
        <h3 className="text-[17px] font-semibold">{title}</h3>
        <p className="mt-1 text-[15.5px] leading-7 text-muted">{children}</p>
      </div>
    </li>
  );
}
