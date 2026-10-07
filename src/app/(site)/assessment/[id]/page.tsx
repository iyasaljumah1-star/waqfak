import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { withContext } from "@/server/db";
import { waqfs } from "@/server/db/schema";
import { resolveAssessment } from "@/server/modules/assessment/access";
import { assessmentNumber, loadAnswers, loadBank } from "@/server/modules/assessment/queries";
import { prefillFromWaqf } from "@/server/modules/assessment/facts";
import { AssessmentRunner } from "@/components/assessment/runner";
import { Badge } from "@/components/ui";

export const metadata: Metadata = { title: "التقييم الوقفي", robots: { index: false } };

export default async function TakeAssessment({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await resolveAssessment(id);
  if (!v) notFound();
  if (v.row.status !== "draft") redirect(v.auth ? `/app/assessments/${id}` : `/assessment/${id}/result`);
  if (!v.canEdit) redirect(v.auth ? `/app/assessments/${id}` : "/assessment");

  const { bank, answers, waqfName, prefilledCodes } = await withContext(v.db, async (tx) => {
    const bank = await loadBank(tx, v.row.bankVersionId);
    const answers = await loadAnswers(tx, id);
    let waqfName: string | null = null;
    let prefilledCodes: string[] = [];
    if (v.row.waqfId) {
      const [w] = await tx.select().from(waqfs).where(eq(waqfs.id, v.row.waqfId)).limit(1);
      waqfName = w?.name ?? null;
      if (w) {
        const pre = prefillFromWaqf(w);
        prefilledCodes = Object.keys(pre).filter((k) => JSON.stringify(pre[k]) === JSON.stringify(answers[k]?.value));
      }
    }
    return { bank, answers, waqfName, prefilledCodes };
  });

  return (
    <div className="bg-stone">
      <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
        <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <Link href="/assessment" className="hover:text-ink hover:underline">التقييم الوقفي</Link>
          <span aria-hidden>/</span>
          <span className="font-medium text-text">{waqfName ?? v.row.waqfLabel ?? "وقف غير مسجّل هنا"}</span>
          <Badge tone={v.row.kind === "deep" ? "seal" : "ink"} icon={false}>{v.row.kind === "deep" ? "تقييم معمّق" : "تقييم سريع"}</Badge>
          <span className="tabular ms-auto text-[13px]">{assessmentNumber(id)}</span>
        </div>
        <h1 className="sr-only">التقييم الوقفي</h1>
        <AssessmentRunner
          id={id}
          depth={v.row.kind === "deep" ? "deep" : "basic"}
          axes={bank.axes.map((a) => ({ code: a.code, nameAr: a.nameAr, description: a.description }))}
          questions={bank.questions}
          initialAnswers={Object.fromEntries(Object.entries(answers).map(([k, a]) => [k, a.value]))}
          initialStep={v.row.currentAxis}
          prefilledCodes={prefilledCodes}
        />
        {!v.auth ? (
          <p className="mt-6 text-center text-[13.5px] text-muted">
            إجاباتك محفوظة في هذا المتصفح. للمتابعة من جهاز آخر <Link href={`/login?next=/assessment/${id}`} className="text-ink underline underline-offset-4">سجّل الدخول</Link> واحفظ التقييم في حسابك بعد النتيجة.
          </p>
        ) : null}
      </div>
    </div>
  );
}
