import type { Metadata } from "next";
import { Container, JsonLd, PageIntro } from "@/components/site/bits";
import { FaqBrowser } from "@/components/site/faq-browser";
import { TOPIC_LABEL, TOPIC_ORDER } from "@/components/site/labels";
import { getFaqs } from "@/server/modules/public/queries";

export const metadata: Metadata = {
  title: "الأسئلة الشائعة",
  description: "إجابات مختصرة عن أسئلة الواقفين والنظار والمستفيدين: إنشاء الوقف وتسجيله، والوصية بالوقف، والنظارة، والحوكمة، والمالية، والمخالفات، مع مرجع كل إجابة.",
  alternates: { canonical: "/faq" },
};

export default async function FaqPage({ searchParams }: { searchParams: Promise<{ audience?: string }> }) {
  const sp = await searchParams;
  const faqs = await getFaqs();
  const present = new Set(faqs.map((f) => f.topic));
  const topics = [...TOPIC_ORDER, ...[...present].filter((t) => !TOPIC_ORDER.includes(t))]
    .filter((t) => present.has(t))
    .map((t) => ({ key: t, label: TOPIC_LABEL[t] ?? t }));

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })),
        }}
      />
      <PageIntro
        crumbs={[{ label: "الأسئلة الشائعة" }]}
        title="الأسئلة الشائعة"
        lede="إجابات مختصرة عن أكثر ما يسأل عنه الواقفون والنظار والمستفيدون، مع مرجع كل إجابة. ولسؤال يخص وقفك تحديدًا، يقدّم مستشارونا استشارة متخصصة."
      />
      <Container className="py-10">
        <FaqBrowser
          items={faqs.map((f) => ({ id: f.id, question: f.question, answer: f.answer, audience: f.audience, topic: f.topic, source: f.source }))}
          topics={topics}
          initialAudience={sp.audience}
        />
      </Container>
    </>
  );
}
