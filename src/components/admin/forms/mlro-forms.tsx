"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { createSuspicionReport, decideScreening, recordScreening, updateSuspicionReport } from "@/server/modules/admin/mlro/actions";

export function NewReportForm({ indicators }: { indicators: Record<string, string> }) {
  const [s, action] = useActionState(createSuspicionReport, {});
  const fe = s.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={s} />
      <Field label="الرقم الداخلي للوقف" name="waqfNumber" error={fe.waqfNumber} required>
        <Input name="waqfNumber" dir="ltr" placeholder="WQF-000000" error={fe.waqfNumber} />
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-[15px] font-medium">المؤشرات</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {Object.entries(indicators).map(([k, v]) => (
            <label key={k} className="flex items-start gap-2 text-[14px]">
              <input type="checkbox" name="indicators" value={k} className="mt-1 size-4 accent-[var(--ink)]" />
              {v}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="الوقائع ووجه الاشتباه" name="summary" error={fe.summary} hint="يُشفَّر ولا يطلع عليه إلا مسؤول الامتثال. لا تُبلّغ صاحب الشأن (حظر التنبيه)." required>
        <Textarea name="summary" className="min-h-32" error={fe.summary} />
      </Field>
      <SubmitButton>افتح البلاغ</SubmitButton>
    </form>
  );
}

export function ReportActions({ id, status }: { id: string; status: string }) {
  const [s, action] = useActionState(updateSuspicionReport, {});
  const ops = [
    { v: "note", label: "إضافة ملاحظة", ok: true },
    { v: "report_fiu", label: "تسجيل الإبلاغ للإدارة العامة للتحريات المالية", ok: status === "internal_review" },
    { v: "close", label: "إغلاق دون إبلاغ", ok: status === "internal_review" },
    { v: "reopen", label: "إعادة الفتح", ok: status === "closed_no_action" },
  ].filter((o) => o.ok);
  const [op, setOp] = useState(ops[0].v);
  const fe = s.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3" noValidate key={status}>
      <input type="hidden" name="id" value={id} />
      <FormMessage state={s} />
      <Field label="الإجراء" name="op">
        <Select name="op" value={op} onChange={(e) => setOp(e.target.value)} options={ops.map((o) => ({ value: o.v, label: o.label }))} />
      </Field>
      {op === "report_fiu" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="تاريخ الإبلاغ" name="fiuDate" error={fe.fiuDate} required>
            <Input name="fiuDate" type="date" dir="ltr" error={fe.fiuDate} />
          </Field>
          <Field label="الرقم المرجعي للبلاغ" name="fiuReference" error={fe.fiuReference} hint="يُشفَّر." required>
            <Input name="fiuReference" dir="ltr" error={fe.fiuReference} />
          </Field>
        </div>
      ) : null}
      <Field label={op === "close" ? "مسوغ الإغلاق" : op === "reopen" ? "سبب إعادة الفتح" : op === "report_fiu" ? "ملاحظة (اختيارية)" : "الملاحظة"} name="text" error={fe.text}>
        <Textarea name="text" className="min-h-20" error={fe.text} />
      </Field>
      <SubmitButton variant={op === "report_fiu" ? "danger" : "primary"}>نفّذ</SubmitButton>
    </form>
  );
}

export function ScreeningForm() {
  const [s, action] = useActionState(recordScreening, {});
  const fe = s.fieldErrors ?? {};
  const [type, setType] = useState("waqf");
  return (
    <form action={action} className="space-y-3" noValidate>
      <FormMessage state={s} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="المفحوص" name="subjectType">
          <Select name="subjectType" value={type} onChange={(e) => setType(e.target.value)} options={[{ value: "waqf", label: "وقف" }, { value: "user", label: "شخص (صاحب حساب)" }]} />
        </Field>
        <Field label={type === "waqf" ? "الرقم الداخلي للوقف" : "رقم الجوال"} name="subjectRef" error={fe.subjectRef} required>
          <Input name="subjectRef" dir="ltr" error={fe.subjectRef} />
        </Field>
        <Field label="مصدر الفحص" name="provider" error={fe.provider} hint="مثل: قوائم العقوبات المحلية، قائمة مجلس الأمن." required>
          <Input name="provider" defaultValue="فحص يدوي لقوائم العقوبات" error={fe.provider} />
        </Field>
        <Field label="النتيجة" name="status">
          <Select name="status" options={[{ value: "clear", label: "لا تطابق" }, { value: "potential_match", label: "تطابق محتمل" }, { value: "confirmed_match", label: "تطابق مؤكد" }, { value: "error", label: "تعذر الفحص" }]} />
        </Field>
      </div>
      <Field label="ملاحظات" name="notes">
        <Textarea name="notes" className="min-h-16" />
      </Field>
      <SubmitButton variant="secondary">سجّل النتيجة</SubmitButton>
    </form>
  );
}

export function ScreeningDecision({ id }: { id: string }) {
  const [s, action] = useActionState(decideScreening, {});
  return (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2" noValidate>
      <input type="hidden" name="id" value={id} />
      <label htmlFor={`dec-${id}`} className="sr-only">القرار</label>
      <Select name="decision" id={`dec-${id}`} className="h-9 w-48" options={[{ value: "false_positive", label: "تطابق كاذب" }, { value: "escalated", label: "صُعّد لبلاغ" }, { value: "cleared", label: "لا إجراء" }]} />
      <label htmlFor={`note-${id}`} className="sr-only">ملاحظة</label>
      <Input name="note" id={`note-${id}`} className="h-9 w-56" placeholder="ملاحظة" />
      <SubmitButton size="sm" variant="secondary">سجّل القرار</SubmitButton>
      <FormMessage state={s} />
    </form>
  );
}
