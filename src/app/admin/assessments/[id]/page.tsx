import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { BookMarked, ExternalLink, FileDown } from "lucide-react";
import { requireStaff } from "@/server/authz/context";
import { assessmentAnswers, services, users } from "@/server/db/schema";
import { read } from "@/server/modules/_shared";
import { resolveAssessment } from "@/server/modules/assessment/access";
import { loadBank, loadResultBundle } from "@/server/modules/assessment/queries";
import { answerLabel, CONFIDENCE_LABEL, STATUS_VIEW, WAVE_LABEL } from "@/server/modules/assessment/facts";
import { visibleQuestions, type Answer } from "@/server/engines/assessment";
import { ScoreBar } from "@/components/assessment/radar-figure";
import {
  ApproveForm, DismissRecForm, EvidenceForm, EvidenceSelect, ManualRecForm, RecomputeForm, RestoreRecForm, ReviewNotesForm,
} from "@/components/assessment/review-forms";
import { Alert, Badge, DefinitionList, PageHeader, Panel, type Tone } from "@/components/ui";
import { fmtDateTime, SIZE_LABEL, TYPE_LABEL } from "@/lib/utils";

export const metadata: Metadata = { title: "مراجعة تقييم معمّق" };

const SEV: Record<string, { label: string; tone: Tone }> = {
  critical: { label: "حرجة", tone: "critical" }, high: { label: "عالية", tone: "fine" }, medium: { label: "متوسطة", tone: "warn" }, low: { label: "منخفضة", tone: "neutral" },
};

export default async function ReviewAssessment({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireStaff("staff.assessment_review");
  const v = await resolveAssessment(id);
  if (!v || !v.isReviewer) notFound();

  const data = await read(auth, async (tx) => {
    const bundle = await loadResultBundle(tx, v.row);
    if (!bundle) return null;
    const bank = await loadBank(tx, v.row.bankVersionId);
    const ans = await tx.select().from(assessmentAnswers).where(eq(assessmentAnswers.assessmentId, id));
    const svc = await tx.select({ code: services.code, nameAr: services.nameAr }).from(services).where(eq(services.isActive, true)).orderBy(asc(services.code));
    const [client] = v.row.userId ? await tx.select({ name: users.fullName }).from(users).where(eq(users.id, v.row.userId)).limit(1) : [];
    return { bundle, bank, ans, svc, clientName: client?.name ?? null };
  });
  if (!data) notFound();
  const { bundle: b, bank, ans, svc, clientName } = data;

  const answers: Record<string, Answer> = Object.fromEntries(ans.map((a) => [a.questionCode, { value: a.value, evidenceLevel: a.evidenceLevel }]));
  const evidence = new Map(ans.map((a) => [a.questionCode, a.evidenceLevel]));
  const visible = visibleQuestions(bank.questions, answers, {}, "deep");
  const flagged = new Set(b.flags.map((f) => f.questionCode).filter(Boolean));
  const st = STATUS_VIEW[b.result.status] ?? STATUS_VIEW.stable;
  const reviewed = !!v.row.reviewedAt;
  const axisGroups = [{ code: "P", nameAr: "ملف الوقف" }, ...bank.axes].map((ax) => ({ ...ax, qs: visible.filter((q) => q.axisCode === ax.code) })).filter((g) => g.qs.length);

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ href: "/admin/assessments", label: "التقييمات المعمّقة" }, { label: b.number }]}
        title={`مراجعة ${b.number}`}
        description={b.waqf?.name ?? v.row.waqfLabel ?? "تقييم غير مرتبط بوقف"}
        actions={
          <a href={`/api/reports/assessment/${id}`} className="inline-flex h-10 items-center gap-2 rounded-md border border-line-strong bg-surface px-3 text-[15px] hover:bg-surface-2">
            <FileDown aria-hidden className="size-4" />التقرير PDF
          </a>
        }
      />

      {reviewed ? (
        <Alert tone="ok" title="اعتُمدت المراجعة">اعتُمدت في {fmtDateTime(v.row.reviewedAt)}{b.reviewerName ? ` بواسطة ${b.reviewerName}` : ""}. أي تعديل الآن يظهر للعميل مباشرة؛ أعد الاعتماد لإشعاره.</Alert>
      ) : (
        <Alert tone="info" title="بانتظار مراجعتك">العميل يرى النتيجة الآلية مع تنبيه «بانتظار مراجعة مختص». بعد الاعتماد تظهر ملاحظاتك وعلامة «روجع من مختص» ويصله إشعار.</Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Panel title="الملخص الآلي" actions={<RecomputeForm id={id} />}>
            <DefinitionList
              cols={3}
              items={[
                { label: "الدرجة الكلية", value: <span className="tabular font-semibold">{Math.round(b.result.overallScore)}</span> },
                { label: "الحالة", value: <Badge tone={st.tone}>{st.label}</Badge> },
                { label: "النضج", value: `${Math.round(b.result.maturityScore)} — ${b.result.maturityLevel}` },
                { label: "الثقة", value: `${CONFIDENCE_LABEL[b.result.confidence]}${b.completeness !== null ? ` (اكتمال ${Math.round(b.completeness * 100)}%)` : ""}` },
                { label: "الحجم / النوع", value: `${b.result.sizeClass ? SIZE_LABEL[b.result.sizeClass] : "—"} / ${b.result.computedType ? TYPE_LABEL[b.result.computedType] : "—"}` },
                { label: "العميل", value: clientName ?? "—" },
              ]}
            />
            <table className="mt-5 w-full border-collapse text-[14px]">
              <caption className="sr-only">درجات المحاور</caption>
              <tbody>
                {b.axes.map((a) => (
                  <tr key={a.code} className="border-b border-line last:border-0">
                    <th scope="row" className="py-2 pe-2 text-start font-normal">{a.nameAr}{a.capped ? <span className="block text-[12px] text-critical">مسقوف بعلامة حرجة</span> : null}</th>
                    <td className="w-[45%] py-2"><ScoreBar score={a.score} capped={a.capped} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          {b.flags.length ? (
            <Panel title={`العلامات الحرجة (${b.flags.length})`}>
              <ul className="space-y-2">
                {b.flags.map((f) => (
                  <li key={f.code} className="rounded-md border-s-4 border-critical bg-critical-soft px-3 py-2 text-[14.5px]">
                    <p className="font-semibold text-critical">{f.titleAr}</p>
                    <p className="text-[13px] text-text/80">{f.referenceText}{f.questionCode ? ` — من السؤال ${f.questionCode}` : " — مستنتجة من التواريخ أو ملف الوقف"}</p>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel title="الإجابات ودرجة الإثبات" description="عدّل درجة الإثبات بعد الاطلاع على المستندات. ترفع «مستند مرفق» و«تحقق المراجع» ثقة النتيجة. لا تُعدَّل إجابات العميل نفسها.">
            <EvidenceForm id={id}>
              <div className="space-y-5">
                {axisGroups.map((g) => (
                  <details key={g.code} open={g.qs.some((q) => flagged.has(q.code))} className="rounded-md border border-line">
                    <summary className="cursor-pointer px-3 py-2 text-[15px] font-medium">{g.nameAr} <span className="tabular text-[13px] text-muted">({g.qs.length})</span></summary>
                    <ul className="divide-y divide-line border-t border-line">
                      {g.qs.map((q) => {
                        const a = answers[q.code];
                        return (
                          <li key={q.code} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start">
                            <div className="min-w-0 flex-1 text-[14px] leading-7">
                              <p><span className="tabular me-2 text-[12px] text-muted" dir="ltr">{q.code}</span>{q.textAr}{q.depth === "deep" ? <Badge tone="seal" icon={false} className="ms-2">معمّق</Badge> : null}</p>
                              <p className={flagged.has(q.code) ? "font-semibold text-critical" : "font-medium text-ink"}>{answerLabel(q, a?.value)}</p>
                              {q.referenceText ? <p className="text-[12.5px] text-muted"><BookMarked aria-hidden className="me-1 inline size-3" />{q.referenceText}</p> : null}
                            </div>
                            {a && q.axisCode !== "P" ? <EvidenceSelect code={q.code} value={evidence.get(q.code) ?? "declared"} label={q.code} /> : null}
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                ))}
              </div>
            </EvidenceForm>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="ملاحظات المراجع">
            <ReviewNotesForm
              id={id}
              summary={b.review?.summary ?? ""}
              axes={b.axes.map((a) => ({ code: a.code, nameAr: a.nameAr, score: a.score, note: b.review?.axes?.[a.code] ?? "" }))}
            />
          </Panel>

          <Panel title={`التوصيات (${b.recs.length})`} description="استبعد ما لا ينطبق مع ذكر السبب، أو أضف توصية يدوية.">
            <ul className="space-y-3">
              {b.recs.map((r) => {
                const off = r.status === "dismissed" || r.status === "suppressed";
                return (
                  <li key={r.id} className={off ? "rounded-md border border-line bg-surface-2 p-3 opacity-80" : "rounded-md border border-line p-3"}>
                    <div className="flex flex-wrap items-start gap-2">
                      <p className="min-w-0 flex-1 text-[14.5px] font-semibold">{r.needTitle}</p>
                      <Badge tone={SEV[r.severity]?.tone ?? "neutral"} icon={false}>{SEV[r.severity]?.label}</Badge>
                      <Badge tone="ink" icon={false}>{WAVE_LABEL[r.wave]}</Badge>
                      {r.manual ? <Badge tone="seal" icon={false}>يدوية</Badge> : null}
                    </div>
                    <p className="mt-1 text-[13.5px] leading-6 text-muted">{r.reasonAr}</p>
                    {r.services.length ? <p className="mt-1 text-[13px]">{r.services.map((s) => `${s.code} ${s.nameAr}`).join("، ")}</p> : null}
                    <div className="mt-2">
                      {r.status === "dismissed" ? (
                        <div className="flex flex-wrap items-center gap-2 text-[13px]"><span className="text-muted">مستبعدة: {r.dismissReason}</span><RestoreRecForm id={id} rec={r.id} /></div>
                      ) : r.status === "suppressed" ? (
                        <p className="text-[13px] text-muted">معلّقة آليًا: {r.suppressedNote}</p>
                      ) : r.status === "converted" ? (
                        <Badge tone="ok">طلب العميل الخدمة</Badge>
                      ) : (
                        <DismissRecForm id={id} rec={r.id} />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <details className="mt-4 rounded-md border border-line px-3 py-2">
              <summary className="cursor-pointer text-[15px] font-medium">أضف توصية يدوية</summary>
              <div className="mt-3"><ManualRecForm id={id} services={svc} /></div>
            </details>
          </Panel>

          <Panel title="الاعتماد">
            <p className="mb-3 text-[14.5px] leading-7 text-muted">احفظ الملاحظات أولًا. الاعتماد يجعل الحالة «روجع من مختص» ويُشعر العميل.</p>
            <ApproveForm id={id} reviewed={reviewed} />
            {v.row.waqfId ? (
              <Link href={`/admin/waqfs/${v.row.waqfId}`} className="mt-4 inline-flex items-center gap-1 text-[14px] text-ink underline underline-offset-4">
                ملف الوقف <ExternalLink aria-hidden className="size-3.5" />
              </Link>
            ) : null}
          </Panel>
        </div>
      </div>
    </div>
  );
}
