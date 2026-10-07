import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ArrowLeft, Clock, FileCheck2, Scale, ShieldCheck } from "lucide-react";
import { withContext } from "@/server/db";
import { assessments } from "@/server/db/schema";
import { getAuth } from "@/server/authz/context";
import { safeEqual, sha256 } from "@/server/lib/crypto";
import { ANON_DB, isUuid } from "@/server/modules/assessment/access";
import { assessmentNumber, bankCounts, myWaqfsWith } from "@/server/modules/assessment/queries";
import { StartForm } from "@/components/assessment/start-form";
import { fmtDateTime } from "@/lib/utils";

export const metadata: Metadata = {
  title: "التقييم الوقفي",
  description: "اعرف وضع وقفك في 11 محورًا: الشرعي والنظامي والنظارة والحوكمة والمالية وغيرها، مع توصيات مرتبة وخطة عمل. تشخيص استرشادي مجاني.",
};

export default async function AssessmentStart({ searchParams }: { searchParams: Promise<{ kind?: string; waqf?: string }> }) {
  const sp = await searchParams;
  const a = await getAuth();
  const auth = a && !(a.user.mfaEnabled && !a.session.mfaVerified) ? a : null;
  const jar = await cookies();
  const anonIds = jar
    .getAll()
    .filter((c) => c.name.startsWith("wqf_asmt_"))
    .map((c) => ({ id: c.name.slice(9), token: c.value }))
    .filter((c) => isUuid(c.id));

  const { counts, drafts } = await withContext(auth?.db ?? ANON_DB, async (tx) => {
    const counts = await bankCounts(tx);
    let rows: (typeof assessments.$inferSelect)[] = [];
    if (auth) rows = await tx.select().from(assessments).where(and(eq(assessments.userId, auth.user.id), eq(assessments.status, "draft"))).orderBy(desc(assessments.updatedAt)).limit(3);
    if (anonIds.length) {
      const anon = await tx.select().from(assessments).where(and(inArray(assessments.id, anonIds.map((x) => x.id)), eq(assessments.status, "draft")));
      rows = rows.concat(anon.filter((r) => r.anonTokenHash && anonIds.some((x) => x.id === r.id && safeEqual(sha256(x.token), r.anonTokenHash!))));
    }
    return { counts, drafts: rows };
  });
  const waqfs = auth ? await myWaqfsWith(auth, "assessment.run") : [];

  return (
    <div className="bg-stone">
      <div className="mx-auto max-w-5xl px-4 py-10 md:py-14">
        <div className="grid gap-10 lg:grid-cols-[1fr_minmax(0,440px)]">
          <section>
            <p className="text-sm font-medium text-seal">التقييم الوقفي</p>
            <h1 className="mt-2 font-naskh text-[2rem] font-bold leading-[1.45] text-ink md:text-[2.5rem]">اعرف أين يقف وقفك، وما الذي يلزمه الآن</h1>
            <p className="mt-4 max-w-2xl text-[17px] leading-8 text-muted">
              تجيب عن أسئلة واضحة في أحد عشر محورًا، من سلامة الشرط والتسجيل إلى المالية والحوكمة والمستفيدين. نحسب لك درجة لكل محور، ونكشف المخالفات الجوهرية، ونرتّب ما يلزم في خطة من ثلاث موجات مع مرجعها النظامي.
            </p>
            <ul className="mt-8 space-y-5">
              <Point icon={Scale} title="تشخيص، لا فتوى ولا رأي قانوني ملزم">
                النتيجة استرشادية مبنية على إجاباتك، وتذكر لكل ملاحظة مرجعها من اللوائح والأدلة الرسمية. للرأي الملزم اطلب مختصًا.
              </Point>
              <Point icon={Clock} title="ربع ساعة للتقييم السريع">
                تُحفظ كل إجابة تلقائيًا، فتستطيع التوقف والعودة لاحقًا من الجهاز نفسه أو من حسابك.
              </Point>
              <Point icon={ShieldCheck} title="بياناتك لك وحدك">
                لا نطلب اسمًا ولا هوية لبدء التقييم. لا يرى نتيجتك أحد إلا من تشاركه رابطها، ويمكنك إلغاء الرابط متى شئت.
              </Point>
              <Point icon={FileCheck2} title="نتيجة تعمل عليها">
                درجة كلية ومؤشر نضج، ومخطط للمحاور، وتوصيات مرتبطة بالخدمة المناسبة، وتقرير PDF.
              </Point>
            </ul>
          </section>

          <section aria-labelledby="start-title" className="h-fit rounded-xl border border-line bg-surface p-5 shadow-card md:p-6">
            <h2 id="start-title" className="mb-5 text-xl font-semibold text-ink">ابدأ تقييمك</h2>
            {drafts.length ? (
              <div className="mb-6 rounded-lg bg-info-soft p-3">
                <p className="text-[14.5px] font-medium text-info">لديك تقييم لم يكتمل</p>
                <ul className="mt-2 space-y-1">
                  {drafts.map((d) => (
                    <li key={d.id}>
                      <Link href={`/assessment/${d.id}`} className="inline-flex items-center gap-1 text-[15px] font-medium text-ink underline underline-offset-4">
                        أكمل {d.waqfLabel ? `«${d.waqfLabel}»` : assessmentNumber(d.id)}
                        <ArrowLeft aria-hidden className="size-4" />
                      </Link>
                      <span className="ms-2 text-[13px] text-muted">آخر حفظ {fmtDateTime(d.updatedAt)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <StartForm
              signedIn={!!auth}
              waqfs={waqfs}
              quickCount={counts.quick}
              deepCount={counts.deep}
              defaultKind={sp.kind === "deep" ? "deep" : "basic"}
              defaultWaqf={sp.waqf}
            />
            {!auth ? (
              <p className="mt-5 border-t border-line pt-4 text-[14px] text-muted">
                لديك حساب؟ <Link href="/login?next=/assessment" className="font-medium text-ink underline underline-offset-4">سجّل الدخول</Link> لربط التقييم بملف وقفك وحفظه في سجله.
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

function Point({ icon: Icon, title, children }: { icon: typeof Scale; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="mt-1 grid size-10 shrink-0 place-items-center rounded-full bg-surface text-ink ring-1 ring-line">
        <Icon aria-hidden className="size-5" />
      </span>
      <div>
        <p className="font-semibold text-text">{title}</p>
        <p className="mt-0.5 text-[15px] leading-7 text-muted">{children}</p>
      </div>
    </li>
  );
}
