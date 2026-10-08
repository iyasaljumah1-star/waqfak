import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock, Plus } from "lucide-react";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { listFlagDefs, loadBankVersion } from "@/server/modules/admin/editors/bank.queries";
import { deleteAxis, deleteBankDraft, publishBankVersion, saveAxis, saveBankNotes } from "@/server/modules/admin/editors/bank.actions";
import { ANSWER_TYPES, bankPublishProblems, PUBLISH_STATUS_AR, PUBLISH_STATUS_TONE, weightSums } from "@/server/modules/admin/editors/pure";
import { Alert, Badge, ButtonLink, PageHeader, Panel, Stat } from "@/components/ui";
import { Input, Textarea } from "@/components/ui/form";
import { ActionButton, EditorForm, EField } from "@/components/admin-editors/editor-form";
import { EditorPage, FieldGrid, Flash } from "@/components/admin-editors/shell";

export const metadata: Metadata = { title: "نسخة بنك الأسئلة" };

type AxisRow = { id?: string; code: string; nameAr: string; description: string | null; weightSmall: string; weightMedium: string; weightLarge: string; position: number };

function AxisFields({ a }: { a?: AxisRow }) {
  return (
    <div className="space-y-3">
      {a?.id ? <input type="hidden" name="axisId" value={a.id} /> : null}
      <FieldGrid cols={3}>
        <EField label="الرمز" name="code" required><Input name="code" dir="ltr" defaultValue={a?.code ?? ""} placeholder="A12" /></EField>
        <EField label="الاسم" name="nameAr" required className="lg:col-span-2"><Input name="nameAr" defaultValue={a?.nameAr ?? ""} /></EField>
      </FieldGrid>
      <EField label="الوصف" name="description"><Input name="description" defaultValue={a?.description ?? ""} /></EField>
      <FieldGrid cols={3}>
        <EField label="وزن الوقف الصغير" name="weightSmall" required><Input name="weightSmall" type="number" step="0.01" min={0} max={100} defaultValue={a?.weightSmall ?? ""} /></EField>
        <EField label="وزن الوقف المتوسط" name="weightMedium" required><Input name="weightMedium" type="number" step="0.01" min={0} max={100} defaultValue={a?.weightMedium ?? ""} /></EField>
        <EField label="وزن الوقف الكبير" name="weightLarge" required><Input name="weightLarge" type="number" step="0.01" min={0} max={100} defaultValue={a?.weightLarge ?? ""} /></EField>
      </FieldGrid>
      <EField label="الترتيب" name="position"><Input name="position" type="number" min={0} defaultValue={a?.position ?? ""} className="max-w-32" /></EField>
    </div>
  );
}

export default async function BankVersion({ params, searchParams }: { params: Promise<{ versionId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { versionId } = await params;
  const sp = await searchParams;
  const auth = await requireStaff("admin.rules");
  if (!/^[0-9a-f-]{36}$/.test(versionId)) notFound();
  const data = await read(auth, async (tx) => ({ b: await loadBankVersion(tx, versionId), flags: await listFlagDefs(tx) }));
  if (!data.b) notFound();
  const { v, axes, questions, assessments } = data.b;
  const editable = v.status === "draft";
  const w = weightSums(axes);
  const problems = editable ? bankPublishProblems(axes, questions, data.flags.map((f) => f.code)) : [];
  const groups = [{ code: "P", nameAr: "الملف التعريفي (يحدد المنطبق والأوزان)" }, ...axes];
  const typeLabel = (t: string) => ANSWER_TYPES.find((x) => x.value === t)?.label ?? t;
  const sumTone = (n: number) => (Math.abs(n - 100) < 0.01 ? "ok" : "critical") as "ok" | "critical";

  return (
    <EditorPage>
      <PageHeader
        title={`بنك الأسئلة — الإصدار ${v.version}`}
        description={<span className="flex flex-wrap items-center gap-2"><Badge tone={PUBLISH_STATUS_TONE[v.status]}>{PUBLISH_STATUS_AR[v.status]}</Badge><span>{questions.length} سؤالًا · {axes.length} محورًا · {assessments} تقييمًا</span></span>}
        crumbs={[{ href: "/admin/question-bank", label: "بنك الأسئلة" }, { label: `الإصدار ${v.version}` }]}
        actions={editable ? <ButtonLink href={`/admin/question-bank/${v.id}/questions/new`}><Plus aria-hidden className="size-4" /> سؤال جديد</ButtonLink> : null}
      />
      <Flash sp={sp} />
      {!editable ? (
        <Alert tone="info" title={<span className="inline-flex items-center gap-1.5"><Lock aria-hidden className="size-4" /> نسخة {PUBLISH_STATUS_AR[v.status]} — للقراءة فقط</span>}>
          النسخ المنشورة لا تُعدّل حفاظًا على قابلية تفسير التقييمات التي أُجريت عليها. للتعديل أنشئ نسخة جديدة من صفحة بنك الأسئلة.
        </Alert>
      ) : null}

      <section aria-label="مجاميع الأوزان" className="grid gap-3 sm:grid-cols-3">
        <Stat label="مجموع أوزان الوقف الصغير" value={w.small} tone={sumTone(w.small)} sub="يجب أن يساوي 100" />
        <Stat label="مجموع أوزان الوقف المتوسط" value={w.medium} tone={sumTone(w.medium)} sub="يجب أن يساوي 100" />
        <Stat label="مجموع أوزان الوقف الكبير" value={w.large} tone={sumTone(w.large)} sub="يجب أن يساوي 100" />
      </section>

      {editable ? (
        <Panel title="النشر" description="النشر يجعل هذه النسخة المعتمدة لكل تقييم جديد، ويُحيل النسخة المنشورة السابقة إلى التقاعد.">
          {problems.length ? (
            <Alert tone="warn" title={`لا يمكن النشر بعد (${problems.length})`}>
              <ul className="list-disc ps-5">{problems.slice(0, 10).map((p, i) => <li key={i}>{p}</li>)}</ul>
            </Alert>
          ) : <Alert tone="ok" title="النسخة جاهزة للنشر: الأوزان والقواعد والخيارات سليمة." />}
          <div className="mt-4 flex flex-wrap items-start gap-3">
            <ActionButton action={publishBankVersion} fields={{ versionId: v.id }} label="انشر هذه النسخة" variant="primary" size="md" confirmText={`نشر الإصدار ${v.version}؟ سيصبح المعتمد لكل تقييم جديد ولا يمكن تعديله بعد ذلك.`} />
            <ActionButton action={deleteBankDraft} fields={{ versionId: v.id }} label="احذف المسودة" variant="ghost" size="md" confirmText="حذف هذه المسودة بكل محاورها وأسئلتها؟" />
          </div>
          <div className="mt-4 border-t border-line pt-4">
            <EditorForm action={saveBankNotes} submitLabel="احفظ الملاحظات" idPrefix="notes">
              <input type="hidden" name="versionId" value={v.id} />
              <EField label="ملاحظات الإصدار" name="notes" hint="ماذا تغيّر في هذه النسخة ولماذا."><Textarea name="notes" className="min-h-20" defaultValue={v.notes ?? ""} /></EField>
            </EditorForm>
          </div>
        </Panel>
      ) : v.notes ? <Panel title="ملاحظات الإصدار"><p>{v.notes}</p></Panel> : null}

      <Panel title="المحاور والأوزان" description="الوزن نسبة مئوية من النتيجة الكلية لكل فئة حجم.">
        <ul className="divide-y divide-line">
          {axes.map((a) => (
            <li key={a.id} className="py-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span dir="ltr" className="tabular w-10 font-semibold">{a.code}</span>
                <span className="min-w-0 flex-1 font-medium">{a.nameAr}</span>
                <span className="tabular text-[14px] text-muted">صغير {Number(a.weightSmall)} · متوسط {Number(a.weightMedium)} · كبير {Number(a.weightLarge)}</span>
              </div>
              {editable ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[14px] text-ink">تعديل المحور</summary>
                  <div className="mt-2 space-y-3 rounded-md border border-line p-3">
                    <EditorForm action={saveAxis} submitLabel="احفظ المحور" idPrefix={`ax-${a.code}`}>
                      <input type="hidden" name="versionId" value={v.id} />
                      <AxisFields a={a} />
                    </EditorForm>
                    <ActionButton action={deleteAxis} fields={{ versionId: v.id, axisId: a.id }} label="احذف المحور" variant="ghost" confirmText={`حذف المحور ${a.code}؟`} />
                  </div>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
        {editable ? (
          <details className="mt-3 rounded-md border border-dashed border-line-strong p-3">
            <summary className="cursor-pointer font-medium text-ink">أضف محورًا</summary>
            <div className="mt-3">
              <EditorForm action={saveAxis} submitLabel="أضف المحور">
                <input type="hidden" name="versionId" value={v.id} />
                <AxisFields />
              </EditorForm>
            </div>
          </details>
        ) : null}
      </Panel>

      <Panel title="الأسئلة" tight>
        <div className="divide-y divide-line">
          {groups.map((g) => {
            const qs = questions.filter((q) => q.axisCode === g.code);
            if (!qs.length) return null;
            return (
              <section key={g.code} aria-labelledby={`ax-${g.code}`} className="px-4 py-3 md:px-5">
                <h3 id={`ax-${g.code}`} className="mb-2 font-semibold"><span dir="ltr">{g.code}</span> — {g.nameAr} <span className="text-[13px] font-normal text-muted">({qs.length})</span></h3>
                <ul className="space-y-1.5">
                  {qs.map((q) => (
                    <li key={q.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[14px]">
                      <Link href={`/admin/question-bank/${v.id}/questions/${q.id}`} className="tabular shrink-0 font-medium text-ink hover:underline" dir="ltr">{q.code}</Link>
                      <span className="min-w-0 flex-1">{q.textAr}</span>
                      <span className="flex shrink-0 flex-wrap gap-1">
                        <Badge icon={false}>{typeLabel(q.answerType)}</Badge>
                        {q.depth === "deep" ? <Badge tone="ink" icon={false}>معمّق</Badge> : null}
                        {q.showIf ? <Badge tone="info" icon={false}>مشروط</Badge> : null}
                        {q.criticalFlagCode ? <Badge tone="critical" icon={false}>{q.criticalFlagCode}</Badge> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </Panel>
    </EditorPage>
  );
}
