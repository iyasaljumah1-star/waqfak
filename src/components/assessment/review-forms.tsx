"use client";

import { useActionState } from "react";
import { BadgeCheck, Plus, RefreshCw, RotateCcw, Save, X } from "lucide-react";
import {
  addManualRecommendation, dismissRecommendation, markReviewed, recomputeAssessment, restoreRecommendation, saveEvidence, saveReviewNotes,
} from "@/server/modules/assessment/actions";
import { Field, FormMessage, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { initialState } from "@/lib/utils";

export const EVIDENCE_LABEL: Record<string, string> = { declared: "إقرار العميل", document: "مستند مرفق", verified: "تحقق المراجع" };

/** Reviewer summary + one note per axis (shown to the client on the result and in the PDF). */
export function ReviewNotesForm({ id, summary, axes }: { id: string; summary: string; axes: { code: string; nameAr: string; score: number | null; note: string }[] }) {
  const [state, action] = useActionState(saveReviewNotes, initialState);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <Field label="الملخص للعميل" name="summary" hint="يظهر أعلى النتيجة وفي التقرير تحت «ملاحظات المختص». اكتب ما يجب أن يفعله أولًا ولماذا.">
        <Textarea name="summary" rows={5} defaultValue={summary} maxLength={4000} error={state.fieldErrors?.summary} />
      </Field>
      <details className="rounded-md border border-line px-3 py-2">
        <summary className="cursor-pointer text-[15px] font-medium">ملاحظات على المحاور ({axes.filter((a) => a.note).length})</summary>
        <div className="mt-3 space-y-3">
          {axes.map((a) => (
            <div key={a.code} className="space-y-1">
              <label htmlFor={`axis_${a.code}`} className="flex flex-wrap items-baseline gap-2 text-[14px] font-medium">
                {a.nameAr}
                <span className="tabular text-[12.5px] font-normal text-muted">{a.score === null ? "لا ينطبق" : Math.round(a.score)}</span>
              </label>
              <textarea id={`axis_${a.code}`} name={`axis_${a.code}`} rows={2} defaultValue={a.note} maxLength={2000}
                className="block w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-[15px] focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/20" />
            </div>
          ))}
        </div>
      </details>
      <FormMessage state={state} />
      <SubmitButton variant="secondary" pendingText="نحفظ…"><Save aria-hidden className="size-4" />احفظ الملاحظات</SubmitButton>
    </form>
  );
}

/** Evidence level per answer; saving recomputes the result. Wraps the answers table rendered by the server. */
export function EvidenceForm({ id, children }: { id: string; children: React.ReactNode }) {
  const [state, action] = useActionState(saveEvidence, initialState);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="secondary" pendingText="نحدّث ونعيد الحساب…"><Save aria-hidden className="size-4" />احفظ الإثبات وأعد الحساب</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function EvidenceSelect({ code, value, label }: { code: string; value: string; label: string }) {
  return (
    <select name={`ev_${code}`} defaultValue={value} aria-label={`درجة إثبات: ${label}`}
      className="h-9 rounded-md border border-line-strong bg-surface px-2 text-[13.5px]">
      {Object.entries(EVIDENCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  );
}

export function DismissRecForm({ id, rec }: { id: string; rec: string }) {
  const [state, action] = useActionState(dismissRecommendation, initialState);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="rec" value={rec} />
      <div className="min-w-0 flex-1">
        <label htmlFor={`dr-${rec}`} className="sr-only">سبب الاستبعاد</label>
        <input id={`dr-${rec}`} name="reason" required minLength={5} maxLength={500} placeholder="سبب الاستبعاد (يراه العميل)"
          className="h-9 w-full rounded-md border border-line-strong bg-surface px-2 text-[14px]" />
      </div>
      <SubmitButton variant="ghost" size="sm" pendingText="…"><X aria-hidden className="size-3.5" />استبعد</SubmitButton>
      {state.error ? <p role="alert" className="w-full text-[13px] text-critical">{state.error}</p> : null}
    </form>
  );
}

export function RestoreRecForm({ id, rec }: { id: string; rec: string }) {
  const [state, action] = useActionState(restoreRecommendation, initialState);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="rec" value={rec} />
      <SubmitButton variant="ghost" size="sm" pendingText="…"><RotateCcw aria-hidden className="size-3.5" />أعدها</SubmitButton>
      {state.error ? <span role="alert" className="ms-2 text-[13px] text-critical">{state.error}</span> : null}
    </form>
  );
}

export function ManualRecForm({ id, services }: { id: string; services: { code: string; nameAr: string }[] }) {
  const [state, action] = useActionState(addManualRecommendation, initialState);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <Field label="العنوان" name="title" required error={fe.title}><Input name="title" required maxLength={200} /></Field>
      <Field label="السبب" name="reason" required error={fe.reason}><Textarea name="reason" rows={3} required maxLength={1500} /></Field>
      <Field label="المرجع النظامي" name="reference" hint="مثال: لائحة تنظيم أعمال النظارة، م15/1"><Input name="reference" maxLength={300} /></Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="الموجة" name="wave" required>
          <Select name="wave" defaultValue="2" options={[{ value: "1", label: "الآن (30 يومًا)" }, { value: "2", label: "خلال 90 يومًا" }, { value: "3", label: "خلال سنة" }]} />
        </Field>
        <Field label="الأولوية" name="severity" required>
          <Select name="severity" defaultValue="high" options={[{ value: "critical", label: "حرجة" }, { value: "high", label: "عالية" }, { value: "medium", label: "متوسطة" }, { value: "low", label: "منخفضة" }]} />
        </Field>
        <Field label="الخدمة المرتبطة" name="service">
          <Select name="service" defaultValue="" options={[{ value: "", label: "بلا خدمة" }, ...services.map((s) => ({ value: s.code, label: `${s.code} — ${s.nameAr}` }))]} />
        </Field>
      </div>
      <FormMessage state={state} />
      <SubmitButton variant="secondary" pendingText="نضيف…"><Plus aria-hidden className="size-4" />أضف التوصية</SubmitButton>
    </form>
  );
}

export function RecomputeForm({ id }: { id: string }) {
  const [state, action] = useActionState(recomputeAssessment, initialState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost" size="sm" pendingText="نعيد الحساب…"><RefreshCw aria-hidden className="size-3.5" />أعد الحساب</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function ApproveForm({ id, reviewed }: { id: string; reviewed: boolean }) {
  const [state, action] = useActionState(markReviewed, initialState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="seal" pendingText="نعتمد…">
        <BadgeCheck aria-hidden className="size-4" />
        {reviewed ? "أعد الاعتماد بعد التعديل" : "اعتمد المراجعة وأبلغ العميل"}
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
