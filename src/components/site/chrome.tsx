import Link from "next/link";
import { Seal } from "@/components/brand";
import { getAuth } from "@/server/authz/context";
import { getCompany } from "@/server/modules/public/queries";
import { SiteNav } from "./nav";

export async function SiteHeader() {
  const auth = await getAuth().catch(() => null);
  const account = auth ? { href: auth.isStaff ? "/admin" : "/app", label: "حسابي" } : null;
  return (
    <header data-site="" className="sticky top-0 z-30 border-b border-line bg-surface no-print">
      <SiteNav account={account} />
    </header>
  );
}

const FOOTER = [
  {
    title: "الخدمات",
    links: [
      { href: "/services", label: "كل الخدمات" },
      { href: "/packages", label: "الباقات" },
      { href: "/assessment", label: "التقييم الوقفي المجاني" },
      { href: "/tools", label: "الأدوات" },
    ],
  },
  {
    title: "المعرفة",
    links: [
      { href: "/library", label: "المكتبة" },
      { href: "/regulations", label: "الأنظمة واللوائح" },
      { href: "/faq", label: "الأسئلة الشائعة" },
      { href: "/glossary", label: "قاموس المصطلحات" },
    ],
  },
  {
    title: "وقفك",
    links: [
      { href: "/about", label: "عن وقفك" },
      { href: "/contact", label: "تواصل معنا" },
      { href: "/legal/accessibility", label: "إمكانية الوصول" },
    ],
  },
  {
    title: "السياسات",
    links: [
      { href: "/legal/terms", label: "الشروط والأحكام" },
      { href: "/legal/privacy", label: "سياسة الخصوصية" },
      { href: "/legal/cookies", label: "ملفات تعريف الارتباط" },
      { href: "/legal/ai", label: "استخدام الذكاء الاصطناعي" },
      { href: "/legal/disclaimer", label: "إخلاء المسؤولية" },
    ],
  },
];

export async function SiteFooter() {
  const { profile, licenses } = await getCompany();
  const lic = licenses.filter((l) => l.key !== "gaa_nazara_license");
  const year = new Date().getFullYear();
  return (
    <footer data-site="" className="mt-auto bg-ink text-white dark:bg-[#0f1520] no-print">
      <div className="mx-auto max-w-6xl px-4 pb-8 pt-12 md:px-6">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_2fr]">
          <div>
            <Link href="/" className="inline-flex items-center gap-2 text-white" aria-label="وقفك — الصفحة الرئيسية">
              <Seal className="size-9" />
              <span className="font-naskh text-[26px] font-bold leading-none">وقفك</span>
            </Link>
            <p className="mt-4 max-w-sm text-[15px] leading-7 text-white/75">
              خدمات متخصصة في الأوقاف: من تصميم الوقف ووثيقته وتسجيله، إلى نظارته وحوكمته وماليته واستثماره.
            </p>
            <dl className="mt-6 space-y-1.5 text-[14px] text-white/75">
              <div className="flex gap-2">
                <dt className="text-white/55">الكيان:</dt>
                <dd>{profile.nameAr ?? "شركة وقفك"} — {profile.legalForm ?? "شركة ذات مسؤولية محدودة"} (تحت التأسيس)</dd>
              </div>
              {lic.map((l) => (
                <div key={l.key} className="flex gap-2">
                  <dt className="text-white/55">{l.nameAr}:</dt>
                  <dd className="tabular">{l.number || "—"}</dd>
                </div>
              ))}
              <div className="flex gap-2">
                <dt className="text-white/55">التواصل:</dt>
                <dd>
                  {profile.email ? <a className="underline underline-offset-4" href={`mailto:${profile.email}`}>{profile.email}</a> : null}
                  {profile.email && profile.phone ? "، " : null}
                  {profile.phone ? <a className="tabular underline underline-offset-4" dir="ltr" href={`tel:${profile.phone}`}>{profile.phone}</a> : null}
                  {!profile.email && !profile.phone ? <Link className="underline underline-offset-4" href="/contact">نموذج التواصل</Link> : null}
                </dd>
              </div>
            </dl>
          </div>
          <nav aria-label="روابط التذييل" className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {FOOTER.map((g) => (
              <div key={g.title}>
                <h2 className="text-[14px] font-semibold text-white/60">{g.title}</h2>
                <ul className="mt-3 space-y-2">
                  {g.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className="text-[15px] text-white/90 hover:text-white hover:underline hover:underline-offset-4">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="mt-10 border-t border-white/15 pt-6 text-[13.5px] leading-7 text-white/65">
          <p>
            ما في هذا الموقع من مقالات وأدلة وأدوات وتقييمات محتوى إرشادي عام، وليس فتوى شرعية ولا رأيًا قانونيًا ملزمًا في حالتك.
            وقفك ليست جهة رسمية: لسنا الهيئة العامة للأوقاف ولا جهة توثيق. للرأي الملزم اطلب استشارة موقّعة من مختص.{" "}
            <Link href="/legal/disclaimer" className="text-white underline underline-offset-4">إخلاء المسؤولية</Link>
          </p>
          <p className="mt-3">© {year} {profile.nameAr ?? "شركة وقفك"}. بياناتك مشفّرة ومحفوظة داخل المملكة.</p>
        </div>
      </div>
    </footer>
  );
}
