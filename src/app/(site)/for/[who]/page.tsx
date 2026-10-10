import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass } from "@/components/ui";
import { ChevronDown, CircleHelp } from "lucide-react";
import { Container, PageIntro } from "@/components/site/bits";
import { ArticleCard, CallToAction, RelatedContent, ServiceCard, ServiceGrid } from "@/components/site/blocks";
import { AUDIENCE_ICON } from "@/components/site/icons";
import { AUDIENCES, type AudienceSlug } from "@/components/site/labels";
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
      <PageIntro icon={AUDIENCE_ICON[who]} crumbs={[{ label: "لمن نخدم" }, { label: aud.label }]} title={c.title} lede={c.lede}>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={c.cta.href} className={buttonClass("primary", "lg")}>{c.cta.label}</Link>
          {c.tools.map((t) => (
            <Link key={t.href} href={t.href} className={buttonClass("secondary", "lg")}>{t.label}</Link>
          ))}
        </div>
      </PageIntro>

      <section aria-labelledby="svc" className="py-12 md:py-16">
        <Container>
          <RelatedContent
            id="svc"
            title="خدمات تناسبك"
            more={svc.length > 9 ? { href: `/services?audience=${c.serviceFilter}`, label: `كل الخدمات المناسبة (${svc.length})` } : undefined}
          >
            <ServiceGrid wide>
              {svc.slice(0, 9).map((s) => (
                <ServiceCard key={s.id} s={s} />
              ))}
            </ServiceGrid>
          </RelatedContent>
        </Container>
      </section>

      {qs.length || reads.length ? (
        <section className="border-t border-line bg-stone py-12 md:py-16">
          <Container className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {qs.length ? (
              <RelatedContent id="faq" title="أسئلة شائعة" more={{ href: `/faq?audience=${aud.faqKeys[0]}`, label: "كل الأسئلة" }}>
                <ul className="card divide-y divide-line rounded-md border border-line bg-surface">
                  {qs.map((f) => (
                    <li key={f.id}>
                      <details className="group px-4 py-3.5">
                        <summary className="flex cursor-pointer list-none items-start gap-3 font-medium leading-7 marker:hidden hover:text-ink">
                          <CircleHelp aria-hidden className="mt-1 size-4 shrink-0 text-ink" />
                          <span className="min-w-0 flex-1">{f.question}</span>
                          <ChevronDown aria-hidden className="mt-1 size-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
                        </summary>
                        <p className="mt-2 ps-7 text-[15px] leading-7 text-muted">{f.answer}</p>
                      </details>
                    </li>
                  ))}
                </ul>
              </RelatedContent>
            ) : null}
            {reads.length ? (
              <RelatedContent id="read" title="اقرأ أولًا" more={{ href: `/library?audience=${aud.contentKeys[0]}`, label: "المزيد في المكتبة" }}>
                <div className="grid gap-3 sm:grid-cols-2">
                  {reads.map((i) => (
                    <ArticleCard key={i.id} item={i} compact />
                  ))}
                </div>
              </RelatedContent>
            ) : null}
          </Container>
        </section>
      ) : null}

      <CallToAction
        title="نبدأ معك من حيث يقف وقفك"
        lede="ابدأ بالخطوة المقترحة لك، أو قيّم وقفك مجانًا لتعرف ما يلزمه الآن."
        primary={c.cta}
        secondary={c.cta.href === "/assessment" ? { href: "/contact", label: "تواصل معنا" } : { href: "/assessment", label: "قيّم وقفك مجانًا" }}
      />
    </>
  );
}
