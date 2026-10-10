import type { Metadata } from "next";
import Link from "next/link";
import { Clock, FileQuestion, Mail, ShieldCheck } from "lucide-react";
import { Container, PageIntro } from "@/components/site/bits";
import { ContactForm } from "@/components/site/contact-form";
import { getCompany } from "@/server/modules/public/queries";

export const metadata: Metadata = {
  title: "تواصل معنا",
  description: "راسل فريق وقفك بسؤالك عن خدمة أو باقة أو وقف بعينه، ونرد عليك خلال يومي عمل.",
  alternates: { canonical: "/contact" },
};

export default async function ContactPage({ searchParams }: { searchParams: Promise<{ topic?: string; service?: string; package?: string }> }) {
  const sp = await searchParams;
  const { profile } = await getCompany();
  const refCode = (sp.service ?? sp.package ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || undefined;

  return (
    <>
      <PageIntro icon={Mail} crumbs={[{ label: "تواصل معنا" }]} title="تواصل معنا" lede="اكتب لنا ما تحتاجه، ونرد عليك خلال يومي عمل. وإن كان سؤالك عن وقف بعينه، فاذكر ما يكفي لفهم حالته دون بيانات حساسة." />
      <Container className="grid gap-12 py-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-label="نموذج التواصل" className="card min-w-0 rounded-lg border border-line bg-surface p-5 shadow-card md:p-7">
          {refCode ? (
            <p className="mb-5 rounded-md bg-ink-soft px-3 py-2 text-[14.5px] text-ink">
              رسالتك بخصوص: <span className="font-semibold" dir="ltr">{refCode}</span>
            </p>
          ) : null}
          <ContactForm defaultTopic={sp.topic} refCode={refCode} />
        </section>
        <aside className="card h-fit space-y-6 rounded-lg bg-stone p-5 text-[15px] leading-7 md:p-6">
          <Point icon={Clock} title="متى نرد">خلال يومي عمل (الأحد إلى الخميس).</Point>
          <Point icon={FileQuestion} title="قبل أن تكتب">
            قد تجد إجابتك في <Link href="/faq" className="text-ink underline underline-offset-4">الأسئلة الشائعة</Link>. وإن أردت معرفة وضع وقفك فابدأ{" "}
            <Link href="/assessment" className="text-ink underline underline-offset-4">بالتقييم المجاني</Link>.
          </Point>
          <Point icon={ShieldCheck} title="بياناتك">نستخدم ما تكتبه للرد عليك فقط، وفق <Link href="/legal/privacy" className="text-ink underline underline-offset-4">سياسة الخصوصية</Link>.</Point>
          {profile.email || profile.phone ? (
            <div className="border-t border-line-strong/60 pt-5">
              <p className="font-semibold">قنوات أخرى</p>
              {profile.email ? <p><a href={`mailto:${profile.email}`} className="text-ink underline underline-offset-4">{profile.email}</a></p> : null}
              {profile.phone ? <p dir="ltr" className="text-end"><a href={`tel:${profile.phone}`} className="text-ink underline underline-offset-4">{profile.phone}</a></p> : null}
            </div>
          ) : null}
        </aside>
      </Container>
    </>
  );
}

function Point({ icon: Icon, title, children }: { icon: typeof Clock; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-surface text-ink ring-1 ring-line">
        <Icon className="size-[18px]" strokeWidth={1.75} />
      </span>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="text-muted">{children}</p>
      </div>
    </div>
  );
}
