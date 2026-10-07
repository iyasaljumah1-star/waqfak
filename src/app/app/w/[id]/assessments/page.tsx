import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { Gauge, Plus } from "lucide-react";
import { requireAuth, requireWaqf, waqfCan } from "@/server/authz/context";
import { assessmentAxes, assessmentResults, axisScores } from "@/server/db/schema";
import { read } from "@/server/modules/_shared";
import { listWaqfAssessments } from "@/server/modules/assessment/queries";
import { AssessmentTable } from "@/components/assessment/list";
import { RadarFigure, Sparkline } from "@/components/assessment/radar-figure";
import { Badge, ButtonLink, EmptyState, Panel } from "@/components/ui";
import { cn, fmtDate } from "@/lib/utils";
import { STATUS_VIEW } from "@/server/modules/assessment/facts";

export const metadata: Metadata = { title: "التقييمات" };

export default async function WaqfAssessments({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ a?: string; b?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const auth = await requireAuth({ next: `/app/w/${id}/assessments` });
  const access = await requireWaqf(auth, id, "assessment.view");
  const canRun = waqfCan(access, "assessment.run");

  const data = await read(auth, async (tx) => {
    const rows = await listWaqfAssessments(tx, id);
    const done = rows.filter((r) => r.status !== "draft" && r.overallScore !== null).sort((x, y) => +(x.completedAt ?? x.startedAt) - +(y.completedAt ?? y.startedAt));
    const ids = done.map((d) => d.id);
    const scores = ids.length ? await tx.select().from(axisScores).where(inArray(axisScores.assessmentId, ids)) : [];
    const results = ids.length ? await tx.select({ id: assessmentResults.assessmentId, maturity: assessmentResults.maturityScore }).from(assessmentResults).where(inArray(assessmentResults.assessmentId, ids)) : [];
    const latest = done[done.length - 1];
    const axes = latest
      ? await tx.select({ code: assessmentAxes.code, nameAr: assessmentAxes.nameAr, bank: assessmentAxes.bankVersionId }).from(assessmentAxes).innerJoin(assessmentResults, eq(assessmentResults.assessmentId, latest.id)).where(and(eq(assessmentAxes.bankVersionId, (await bankOf(tx, latest.id)) ?? "")))
      : [];
    return { rows, done, scores, results, axes };
  });

  const { rows, done, scores, results, axes } = data;
  const pick = (x?: string) => done.find((d) => d.id === x);
  const B = pick(sp.b) ?? done[done.length - 1];
  const A = pick(sp.a) ?? done.filter((d) => d.id !== B?.id).at(-1);
  const axisMap = (aid?: string) => Object.fromEntries(scores.filter((s) => s.assessmentId === aid).map((s) => [s.axisCode, s.score === null ? null : Number(s.score)]));
  const sa = axisMap(A?.id);
  const sb = axisMap(B?.id);
  const maturity = (aid: string) => Number(results.find((r) => r.id === aid)?.maturity ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-naskh text-2xl font-bold text-ink">التقييمات</h2>
          <p className="text-muted">سجل تقييمات الوقف واتجاه درجاته، ومقارنة أي تقييمين محورًا بمحور.</p>
        </div>
        {canRun ? <ButtonLink href={`/assessment?waqf=${id}`}><Plus aria-hidden className="size-4" />تقييم جديد</ButtonLink> : null}
      </div>

      {done.length ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <TrendCard label="الدرجة الكلية" values={done.map((d) => d.overallScore ?? 0)} />
          <TrendCard label="مؤشر النضج" values={done.map((d) => maturity(d.id))} />
          <div className="rounded-lg border border-line bg-surface p-4">
            <p className="text-sm text-muted">آخر تقييم</p>
            <p className="mt-1 font-semibold">{fmtDate(done.at(-1)!.completedAt)}</p>
            {done.at(-1)!.resultStatus ? <Badge tone={STATUS_VIEW[done.at(-1)!.resultStatus!]?.tone ?? "neutral"} className="mt-1">{STATUS_VIEW[done.at(-1)!.resultStatus!]?.label}</Badge> : null}
          </div>
        </div>
      ) : null}

      {A && B && axes.length ? (
        <Panel title="مقارنة تقييمين" description="اختر التقييمين من القائمتين ثم اعرض المقارنة.">
          <form className="mb-5 flex flex-wrap items-end gap-3" method="get">
            <Choice name="a" label="الأقدم" value={A.id} options={done} />
            <Choice name="b" label="الأحدث" value={B.id} options={done} />
            <button type="submit" className="h-11 rounded-md border border-line-strong bg-surface px-4 text-[15px] font-medium hover:bg-surface-2">قارن</button>
          </form>
          <div className="grid items-start gap-6 xl:grid-cols-2">
            <RadarFigure
              axes={axes.map((x) => ({ code: x.code, name: x.nameAr, score: sb[x.code] ?? null }))}
              series={[{ label: A.number, scores: sa, color: "var(--seal)", dashed: true }]}
              caption={`الخط المتصل: ${B.number} (${fmtDate(B.completedAt)}). المتقطع: ${A.number} (${fmtDate(A.completedAt)}).`}
            />
            <table className="w-full border-collapse text-[14.5px]">
              <caption className="sr-only">مقارنة درجات المحاور</caption>
              <thead>
                <tr className="border-b border-line text-[13px] text-muted">
                  <th scope="col" className="py-2 text-start font-medium">المحور</th>
                  <th scope="col" className="py-2 text-end font-medium">{A.number}</th>
                  <th scope="col" className="py-2 text-end font-medium">{B.number}</th>
                  <th scope="col" className="py-2 text-end font-medium">التغير</th>
                </tr>
              </thead>
              <tbody>
                {axes.map((x) => {
                  const va = sa[x.code];
                  const vb = sb[x.code];
                  const d = va != null && vb != null ? Math.round(vb - va) : null;
                  return (
                    <tr key={x.code} className="border-b border-line last:border-0">
                      <th scope="row" className="py-2 text-start font-normal">{x.nameAr}</th>
                      <td className="tabular py-2 text-end">{va == null ? "—" : Math.round(va)}</td>
                      <td className="tabular py-2 text-end font-semibold">{vb == null ? "—" : Math.round(vb)}</td>
                      <td className={cn("tabular py-2 text-end", d === null ? "text-muted" : d > 0 ? "text-ok" : d < 0 ? "text-critical" : "text-muted")}>
                        {d === null ? "—" : d > 0 ? `▲ ${d}` : d < 0 ? `▼ ${Math.abs(d)}` : "0"}
                        <span className="sr-only">{d === null ? "" : d > 0 ? " تحسن" : d < 0 ? " تراجع" : " دون تغير"}</span>
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-line font-semibold">
                  <th scope="row" className="py-2 text-start">الدرجة الكلية</th>
                  <td className="tabular py-2 text-end">{Math.round(A.overallScore ?? 0)}</td>
                  <td className="tabular py-2 text-end">{Math.round(B.overallScore ?? 0)}</td>
                  <td className="tabular py-2 text-end">{Math.round((B.overallScore ?? 0) - (A.overallScore ?? 0))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>
      ) : done.length === 1 ? (
        <p className="rounded-lg bg-info-soft px-4 py-3 text-[15px] text-info">تظهر المقارنة واتجاه الدرجات بعد التقييم الثاني. ننصح بإعادة التقييم كل ستة أشهر.</p>
      ) : null}

      <Panel title="سجل التقييمات" tight>
        <div className="px-3 md:px-2">
          <AssessmentTable
            rows={rows}
            showWaqf={false}
            empty={
              <EmptyState icon={Gauge} title="لا تقييمات لهذا الوقف بعد" action={canRun ? <ButtonLink href={`/assessment?waqf=${id}`}>ابدأ أول تقييم</ButtonLink> : undefined}>
                التقييم يكشف المخالفات الجوهرية ويرتب ما يلزم الوقف في خطة عمل.
              </EmptyState>
            }
          />
        </div>
      </Panel>
      <p className="text-[13px] text-muted">
        تبدأ التقييمات من <Link href="/assessment" className="underline underline-offset-4">صفحة التقييم الوقفي</Link>، ويُحفظ كل تقييم مع إصدار بنك الأسئلة وقواعد التوصيات.
      </p>
    </div>
  );
}

async function bankOf(tx: Parameters<Parameters<typeof read>[1]>[0], assessmentId: string) {
  const { assessments } = await import("@/server/db/schema");
  const [r] = await tx.select({ b: assessments.bankVersionId }).from(assessments).where(eq(assessments.id, assessmentId)).limit(1);
  return r?.b ?? null;
}

function TrendCard({ label, values }: { label: string; values: number[] }) {
  const last = values.at(-1) ?? 0;
  const prev = values.length > 1 ? values.at(-2)! : null;
  const d = prev === null ? null : Math.round(last - prev);
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <div className="mt-1 flex items-end justify-between gap-3">
        <p className="tabular text-2xl font-semibold">
          {Math.round(last)}
          {d !== null ? <span className={cn("ms-2 text-sm font-medium", d > 0 ? "text-ok" : d < 0 ? "text-critical" : "text-muted")}>{d > 0 ? `+${d}` : d}</span> : null}
        </p>
        <Sparkline values={values} label={`${label} عبر ${values.length} تقييمات: ${values.map((v) => Math.round(v)).join("، ")}`} />
      </div>
    </div>
  );
}

function Choice({ name, label, value, options }: { name: string; label: string; value: string; options: { id: string; number: string; completedAt: Date | null; overallScore: number | null }[] }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={`cmp-${name}`} className="block text-[14px] font-medium">{label}</label>
      <select id={`cmp-${name}`} name={name} defaultValue={value} className="h-11 rounded-md border border-line-strong bg-surface px-3 text-[15px]">
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.number} — {fmtDate(o.completedAt)} — {Math.round(o.overallScore ?? 0)}</option>
        ))}
      </select>
    </div>
  );
}
