"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { Field, FormMessage, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { buttonClass } from "@/components/ui";
import { DocumentUploader } from "@/components/documents/uploader";
import { initialState } from "@/lib/utils";
import {
  addManualObligation, completeInstance, generateReport, recordViolation, reopenInstance, updateViolationStatus, waiveInstance,
} from "@/server/modules/compliance/actions";

type Doc = { id: string; title: string; number: string | null };

/** Complete with evidence: pick a waqf document (linked ones first) or upload one linked to this obligation. */
export function CompleteForm({ waqfId, instanceId, docs, linkedIds, evidenceHint, canUpload }: { waqfId: string; instanceId: string; docs: Doc[]; linkedIds: string[]; evidenceHint: string | null; canUpload: boolean }) {
  const [state, action] = useActionState(completeInstance, initialState);
  const ordered = [...docs.filter((d) => linkedIds.includes(d.id)), ...docs.filter((d) => !linkedIds.includes(d.id))];
  const [docId, setDocId] = useState(ordered[0]?.id ?? "");
  const fid = (n: string) => `${n}-${instanceId.slice(0, 8)}`;
  return (
    <div className="space-y-4">
      {canUpload ? (
        <div>
          <p className="mb-2 text-[13px] text-muted">ارفع الدليل هنا فيُربط بهذا الالتزام تلقائيًا ويظهر في القائمة بعد اجتياز الفحص.</p>
          <DocumentUploader waqfId={waqfId} link={{ entityType: "obligation_instance", entityId: instanceId }} compact defaultTitle={evidenceHint ?? undefined} />
        </div>
      ) : null}
      <form action={action} className="space-y-3">
        <input type="hidden" name="waqfId" value={waqfId} />
        <input type="hidden" name="instanceId" value={instanceId} />
        <Field label="وثيقة الدليل" name={fid("documentId")} hint={evidenceHint ? `المطلوب: ${evidenceHint}` : undefined} error={state.fieldErrors?.documentId} required>
          <Select
            name="documentId"
            id={fid("documentId")}
            value={docId}
            onChange={(e) => setDocId(e.target.value)}
            placeholder={ordered.length ? "اختر وثيقة" : "لا توجد وثائق سارية بعد — ارفع الدليل أولًا"}
            options={ordered.map((d) => ({ value: d.id, label: `${linkedIds.includes(d.id) ? "● " : ""}${d.title}${d.number ? ` (${d.number})` : ""}` }))}
          />
        </Field>
        <Field label="ملاحظة (اختياري)" name={fid("note")}>
          <Input name="note" id={fid("note")} maxLength={500} />
        </Field>
        <FormMessage state={state} />
        <SubmitButton pendingText="جارٍ التسجيل…" disabled={!docId}>سجّل الإنجاز</SubmitButton>
      </form>
    </div>
  );
}

export function WaiveForm({ waqfId, instanceId }: { waqfId: string; instanceId: string }) {
  const [state, action] = useActionState(waiveInstance, initialState);
  const id = `reason-${instanceId.slice(0, 8)}`;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="waqfId" value={waqfId} />
      <input type="hidden" name="instanceId" value={instanceId} />
      <Field label="سبب الإعفاء" name={id} hint="يُحفظ السبب في سجل العمليات ويظهر لكل من يطّلع على الامتثال." error={state.fieldErrors?.reason} required>
        <Textarea name="reason" id={id} minLength={10} maxLength={500} required className="min-h-20" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant="secondary" pendingText="جارٍ الحفظ…">سجّل الإعفاء</SubmitButton>
    </form>
  );
}

export function ReopenForm({ waqfId, instanceId }: { waqfId: string; instanceId: string }) {
  const [state, action] = useActionState(reopenInstance, initialState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="waqfId" value={waqfId} />
      <input type="hidden" name="instanceId" value={instanceId} />
      <SubmitButton variant="ghost" size="sm" pendingText="جارٍ الفتح…">أعد فتح الالتزام</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function ManualForm({ waqfId }: { waqfId: string }) {
  const [state, action] = useActionState(addManualObligation, initialState);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="waqfId" value={waqfId} />
      <Field label="الالتزام" name="title" hint="مثال: تزويد الهيئة بكشف الأصول المطلوب بخطابها" error={state.fieldErrors?.title} required className="md:col-span-2">
        <Input name="title" maxLength={160} required />
      </Field>
      <Field label="الموعد النهائي" name="dueOn" error={state.fieldErrors?.dueOn} required>
        <Input name="dueOn" type="date" required dir="ltr" className="text-start" />
      </Field>
      <Field label="المرجع (اختياري)" name="reference" hint="رقم الخطاب أو المادة" error={state.fieldErrors?.reference}>
        <Input name="reference" maxLength={200} />
      </Field>
      <Field label="الوصف (اختياري)" name="details" error={state.fieldErrors?.details} className="md:col-span-2">
        <Textarea name="details" maxLength={1000} className="min-h-20" />
      </Field>
      <div className="space-y-3 md:col-span-2">
        <FormMessage state={state} />
        <SubmitButton pendingText="جارٍ الإضافة…">أضف الالتزام</SubmitButton>
      </div>
    </form>
  );
}

type PenaltyOpt = { code: string; titleAr: string; category: string; dismissalRisk: string };

export function ViolationForm({ waqfId, penalties, docs, today }: { waqfId: string; penalties: PenaltyOpt[]; docs: Doc[]; today: string }) {
  const [state, action] = useActionState(recordViolation, initialState);
  const groups = [...new Set(penalties.map((p) => p.category))];
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="waqfId" value={waqfId} />
      <Field label="بند المخالفة (جدول المخالفات)" name="penaltyCode" error={state.fieldErrors?.penaltyCode} required className="md:col-span-2">
        <select id="penaltyCode" name="penaltyCode" required defaultValue="" className="block h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-[15px] focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/20">
          <option value="" disabled>اختر البند الوارد في الإشعار</option>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {penalties.filter((p) => p.category === g).map((p) => (
                <option key={p.code} value={p.code}>{p.code} — {p.titleAr}{p.dismissalRisk !== "no" ? " (قد تصل إلى العزل)" : ""}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
      <Field label="تاريخ الإشعار" name="noticedOn" error={state.fieldErrors?.noticedOn} required>
        <Input name="noticedOn" type="date" max={today} required dir="ltr" className="text-start" />
      </Field>
      <Field label="رقم قرار الهيئة" name="authorityRef" error={state.fieldErrors?.authorityRef} required>
        <Input name="authorityRef" maxLength={80} required dir="auto" />
      </Field>
      <Field label="الجزاء الوارد في القرار" name="sanction" hint="مثال: إنذار، أو غرامة بمبلغ كذا" error={state.fieldErrors?.sanction}>
        <Input name="sanction" maxLength={300} />
      </Field>
      <Field label="مهلة التصحيح (إن وردت)" name="correctiveDeadline" error={state.fieldErrors?.correctiveDeadline}>
        <Input name="correctiveDeadline" type="date" dir="ltr" className="text-start" />
      </Field>
      <Field label="وثيقة الإشعار (اختياري)" name="documentId" hint="ارفع الإشعار من صفحة الوثائق أولًا ليظهر هنا." className="md:col-span-2">
        <Select name="documentId" placeholder="بدون وثيقة" options={docs.map((d) => ({ value: d.id, label: d.title }))} />
      </Field>
      <div className="space-y-3 md:col-span-2">
        <FormMessage state={state} />
        <SubmitButton pendingText="جارٍ التسجيل…">سجّل المخالفة</SubmitButton>
      </div>
    </form>
  );
}

const V_STATUS = [
  { value: "open", label: "مفتوحة" },
  { value: "corrective_plan", label: "خطة تصحيح" },
  { value: "appealed", label: "تظلّم مقدَّم" },
  { value: "closed", label: "مغلقة" },
];

export function ViolationStatusForm({ waqfId, violationId, status }: { waqfId: string; violationId: string; status: string }) {
  const [state, action] = useActionState(updateViolationStatus, initialState);
  const id = `vs-${violationId.slice(0, 8)}`;
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="waqfId" value={waqfId} />
      <input type="hidden" name="violationId" value={violationId} />
      <label htmlFor={id} className="sr-only">حالة المخالفة</label>
      <Select name="status" id={id} defaultValue={status} options={V_STATUS} className="h-9 w-40 text-sm" />
      <SubmitButton variant="secondary" size="sm" pendingText="…">حدّث</SubmitButton>
      {state.error ? <p role="alert" className="w-full text-[13px] text-critical">{state.error}</p> : null}
    </form>
  );
}

export function GenerateReportForm({ waqfId, pkg, fyOptions, label }: { waqfId: string; pkg: "annual" | "bo" | "obligations_csv"; fyOptions?: { value: string; label: string }[]; label: string }) {
  const [state, action] = useActionState(generateReport, initialState);
  const href = typeof state.data?.href === "string" ? state.data.href : null;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="waqfId" value={waqfId} />
      <input type="hidden" name="pkg" value={pkg} />
      {fyOptions?.length ? (
        <Field label="السنة المالية" name={`fy-${pkg}`}>
          <Select name="fy" id={`fy-${pkg}`} options={fyOptions} defaultValue={fyOptions[0].value} className="sm:max-w-xs" />
        </Field>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton pendingText="جارٍ التجهيز…">{label}</SubmitButton>
        {href ? (
          <Link href={href} prefetch={false} className={buttonClass("secondary")} download>
            <Download aria-hidden className="size-4" /> نزّل الحزمة
          </Link>
        ) : null}
      </div>
      <FormMessage state={state} />
    </form>
  );
}
