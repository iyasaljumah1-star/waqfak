import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass } from "@/components/ui";
import { ContentRowLink, Container, PageIntro } from "@/components/site/bits";
import { AUDIENCES, type AudienceSlug } from "@/components/site/labels";
import { ServiceRow } from "@/components/site/service-row";
import { getCatalog, getFaqs, getLibrary } from "@/server/modules/public/queries";

const COPY: Record<AudienceSlug, { title: string; lede: string; tools: { href: string; label: string }[]; serviceFilter: string; cta: { href: string; label: string } }> = {
  waqif: {
    title: "للواقف: وقفٌ يبقى كما أردته",
    lede: "قبل أن توثّق وقفك، حدّد الأصل والمصرف والنوع، واكتب شرطًا واضحًا يُنفَّذ بعدك دون خلاف. نصوغ معك الوثيقة أو الوصية، ونجهّز متطلبات توثيقها وتسجيلها، ونرافقك في إجراءاتها.",
    tools: [
      { href: "/tools/waqf-type", label: "اعرف نوع وقفك" },
      { href: "/tools/will-third", label: "احسب ثلث الوصية" },
    ],
    serviceFilter: "waqif",
    cta: { href: "/services/T01", label: "ابدأ بجلسة تصميم الوقف" },
  },
  nazir: {
    title: "للناظر ومجلس النظارة: اعرف ما يلزمك ومتى",
    lede: "الناظر مسؤول نظامًا عن التسجيل والصرف والسجلات والإفصاح والموازنة والمستفيد الحقيقي، وعن الالتزام بمواعيدها. نساندك بالأدوات والمراجعة والخبرة المتخصصة، ويبقى القرار لك.",
    tools: [
      { href: "/tools/nazir-readiness", label: "قائمة جاهزية الناظر" },
      { href: "/tools/registration-deadline", label: "احسب موعد التسجيل" },
      { href: "/tools/waqf-size", label: "حجم الوقف ومتطلباته" },
    ],
    serviceFilter: "nazir",
    cta: { href: "/assessment", label: "قيّم وقفك مجانًا" },
  },
  beneficiary: {
    title: "للمستفيد: اعرف حقك في غلة الوقف",
    lede: "من حقك أن تطّلع على ما يخصك، وأن تسأل الناظر وترفع إليه شكواك، ثم إلى الجهة المختصة. نوضح لك حقوقك وطرق المطالبة بها، ونقدم لك استشارة شرعية وقانونية موقّعة.",
    tools: [{ href: "/tools/waqf-type", label: "اعرف نوع الوقف" }],
    serviceFilter: "beneficiary",
    cta: { href: "/services/C08", label: "اطلب استشارة قانونية" },
  },
  entities: {
    title: "للجهات: أوقاف مؤسسية بحوكمة واضحة",
    lede: "للجمعيات والمؤسسات والشركات الوقفية: نساندكم في إنشاء الأوقاف عن طريق جمع التبرعات وفق ضوابطها، وفي الصناديق والمحافظ الوقفية، والحوكمة، والمستفيد الحقيقي، والتقارير.",
    tools: [{ href: "/tools/waqf-size", label: "حجم الوقف ومتطلباته" }],
    serviceFilter: "entity",
    cta: { href: "/contact?topic=entity", label: "تحدث مع فريقنا" },
  },
};

type P = { params: Promise<{ who: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const who = (await params).who as AudienceSlug;
  const c = COPY[who];
  if (!c) return {};
  return { title: c.title, description: c.lede, alternates: { canonical: `/for/${who}` } };
}

export default async function AudiencePage({ params }: P) {
  const who = (await params).who as AudienceSlug;
  const aud = AUDIENCES.find((a) => a.slug === who);
  const c = COPY[who];
  if (!aud || !c) notFound();

  const [{ services }, faqs, library] = await Promise.all([getCatalog(), getFaqs(), getLibrary()]);
  const svc = services.filter((s) => (aud.serviceKeys as readonly string[]).some((k) => s.audiences.includes(k)));
  const qs = faqs.filter((f) => (aud.faqKeys as readonly string[]).includes(f.audience)).slice(0, 6);
  const reads = library.filter((i) => (aud.contentKeys as readonly string[]).some((k) => i.audience.includes(k))).slice(0, 6);

  return (
    <>
      <PageIntro crumbs={[{ label: "لمن نخدم" }, { label: aud.label }]} title={c.title} lede={c.lede}>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={c.cta.href} className={buttonClass("primary", "lg")}>{c.cta.label}</Link>
          {c.tools.map((t) => (
            <Link key={t.href} href={t.href} className={buttonClass("secondary", "lg")}>{t.label}</Link>
          ))}
        </div>
      </PageIntro>

      <Container className="grid gap-12 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <section aria-labelledby="svc" className="min-w-0">
          <h2 id="svc" className="font-naskh text-[1.5rem] font-bold text-ink">خدمات تناسبك</h2>
          <ul className="mt-3 border-t border-line">
            {svc.slice(0, 10).map((s) => (
              <ServiceRow key={s.id} s={s} />
            ))}
          </ul>
          {svc.length > 10 ? (
            <Link href={`/services?audience=${c.serviceFilter}`} className="mt-4 inline-block font-medium text-ink underline underline-offset-4">
              كل الخدمات المناسبة ({svc.length})
            </Link>
          ) : null}
        </section>

        <div className="space-y-12">
          {qs.length ? (
            <section aria-labelledby="faq">
              <h2 id="faq" className="font-naskh text-[1.5rem] font-bold text-ink">أسئلة شائعة</h2>
              <ul className="mt-3 divide-y divide-line border-y border-line">
                {qs.map((f) => (
                  <li key={f.id}>
                    <details className="group py-3">
                      <summary className="cursor-pointer list-none font-medium leading-7 marker:hidden hover:text-ink">{f.question}</summary>
                      <p className="mt-2 text-[15px] leading-7 text-muted">{f.answer}</p>
                    </details>
                  </li>
                ))}
              </ul>
              <Link href={`/faq?audience=${aud.faqKeys[0]}`} className="mt-3 inline-block text-[15px] font-medium text-ink underline underline-offset-4">كل الأسئلة</Link>
            </section>
          ) : null}
          {reads.length ? (
            <section aria-labelledby="read">
              <h2 id="read" className="font-naskh text-[1.5rem] font-bold text-ink">اقرأ أولًا</h2>
              <div className="divide-y divide-line">
                {reads.map((i) => (
                  <ContentRowLink key={i.id} item={i} />
                ))}
              </div>
              <Link href={`/library?audience=${aud.contentKeys[0]}`} className="mt-2 inline-block text-[15px] font-medium text-ink underline underline-offset-4">المزيد في المكتبة</Link>
            </section>
          ) : null}
        </div>
      </Container>
    </>
  );
}
