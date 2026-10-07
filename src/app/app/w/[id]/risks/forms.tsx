"use client";

import { useActionState } from "react";
import { Field, FormMessage, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { initialState } from "@/lib/utils";
import { saveRisk } from "@/server/modules/compliance/actions";

type Opt = { value: string; label: string };
type Risk = { id: string; title: string; category: string; impact: number; likelihood: number; treatment: string | null; ownerUserId: string | null; reviewOn: string | null; status: string };

const LEVELS: Opt[] = [
  { value: "1", label: "1 — منخفض" },
  { value: "2", label: "2 — متوسط" },
  { value: "3", label: "3 — مرتفع" },
];

export function RiskForm({ waqfId, categories, statuses, owners, risk }: { waqfId: string; categories: Opt[]; statuses: Opt[]; owners: Opt[]; risk?: Risk }) {
  const [state, action] = useActionState(saveRisk, initialState);
  const p = (n: string) => (risk ? `${n}-${risk.id.slice(0, 8)}` : `${n}-new`);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="waqfId" value={waqfId} />
      {risk ? <input type="hidden" name="riskId" value={risk.id} /> : null}
      <Field label="الخطر" name={p("title")} hint="مثال: تركّز إيرادات الوقف في مستأجر واحد" error={state.fieldErrors?.title} required className="md:col-span-2">
        <Input name="title" id={p("title")} defaultValue={risk?.title} maxLength={200} required />
      </Field>
      <Field label="الفئة" name={p("category")} error={state.fieldErrors?.category} required>
        <Select name="category" id={p("category")} defaultValue={risk?.category ?? ""} placeholder="اختر الفئة" options={categories} required />
      </Field>
      <Field label="المالك" name={p("owner")} hint="العضو المسؤول عن متابعة الخطر" error={state.fieldErrors?.ownerUserId}>
        <Select name="ownerUserId" id={p("owner")} defaultValue={risk?.ownerUserId ?? ""} placeholder="بدون مالك" options={owners} />
      </Field>
      <Field label="الأثر" name={p("impact")} error={state.fieldErrors?.impact} required>
        <Select name="impact" id={p("impact")} defaultValue={String(risk?.impact ?? 2)} options={LEVELS} />
      </Field>
      <Field label="الاحتمال" name={p("likelihood")} error={state.fieldErrors?.likelihood} required>
        <Select name="likelihood" id={p("likelihood")} defaultValue={String(risk?.likelihood ?? 2)} options={LEVELS} />
      </Field>
      <Field label="خطة المعالجة" name={p("treatment")} error={state.fieldErrors?.treatment} className="md:col-span-2">
        <Textarea name="treatment" id={p("treatment")} defaultValue={risk?.treatment ?? ""} maxLength={1000} className="min-h-20" />
      </Field>
      <Field label="تاريخ المراجعة القادمة" name={p("reviewOn")} error={state.fieldErrors?.reviewOn}>
        <Input name="reviewOn" id={p("reviewOn")} type="date" defaultValue={risk?.reviewOn ?? ""} dir="ltr" className="text-start" />
      </Field>
      <Field label="الحالة" name={p("status")} error={state.fieldErrors?.status}>
        <Select name="status" id={p("status")} defaultValue={risk?.status ?? "open"} options={statuses} />
      </Field>
      <div className="space-y-3 md:col-span-2">
        <FormMessage state={state} />
        <SubmitButton pendingText="جارٍ الحفظ…">{risk ? "احفظ التعديل" : "أضف الخطر"}</SubmitButton>
      </div>
    </form>
  );
}
