"use client";

import { startTransition, useActionState, useState } from "react";
import { CheckCircle2, ClipboardList, FilePlus2, MessageSquare, Pencil, RotateCcw, Send, StickyNote } from "lucide-react";
import { Field, FormMessage, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { FieldInput } from "@/components/requests/intake-wizard";
import { NoteFormWithAttachment } from "@/components/requests/commerce";
import { cn, initialState, type ActionState } from "@/lib/utils";
import type { AnswerValue, Answers, Field as FormField } from "@/server/modules/requests/intake/engine";

type Act = (s: ActionState, fd: FormData) => Promise<ActionState>;
type Mode = "edit" | "complete" | "approve" | "reopen" | "internal" | "client" | "evidence" | "task";

export type FieldActionSet = {
  staffEditIntake: Act;
  raiseItem: Act;
  setFieldState: Act;
  postStaffNote: Act;
  createFieldTask: Act;
};

/**
 * Actions the team takes on one field (or waqf-file block) of a request, beside its value: edit (with reason; the
 * original value is kept), request completion from the client, approve, reopen for review, internal note, note to the
 * client, attach evidence, create a task. Editing never approves; approving covers this field only.
 */
export function FieldActions({ requestId, waqfId, fieldKey, label, field, value, answers, actions, approved, docs, staff, suggestedTask }: {
  requestId: string;
  waqfId: string | null;
  fieldKey: string;
  label: string;
  /** The form field (null for a waqf-file block, which is edited in the waqf file, not in the request). */
  field: FormField | null;
  value: AnswerValue | undefined;
  answers: Answers;
  actions: FieldActionSet;
  approved: boolean;
  docs: { id: string; title: string }[];
  staff: { value: string; label: string }[];
  suggestedTask?: string;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const btn = (m: Mode, text: string, Icon: typeof Pencil, hide = false) => hide ? null : (
    <button type="button" onClick={() => setMode(mode === m ? null : m)} aria-expanded={mode === m}
      className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[13px]", mode === m ? "border-ink bg-ink text-white" : "border-line text-ink hover:bg-surface-2")}
      data-testid={`fa-${fieldKey}-${m}`}>
      <Icon aria-hidden className="size-3.5" />{text}
    </button>
  );
  return (
    <div className="space-y-2" data-testid={`field-actions-${fieldKey}`}>
      <div className="flex flex-wrap gap-1.5">
        {btn("edit", "تعديل", Pencil, !field)}
        {btn("complete", "طلب استكمال", Send)}
        {btn("approve", "اعتماد", CheckCircle2, approved)}
        {btn("reopen", "إعادة المراجعة", RotateCcw)}
        {btn("internal", "ملاحظة داخلية", StickyNote)}
        {btn("client", "ملاحظة للعميل", MessageSquare)}
        {btn("evidence", "إرفاق دليل", FilePlus2)}
        {btn("task", "مهمة", ClipboardList)}
      </div>
      {mode ? (
        <div className="rounded-md border border-line bg-surface-2/60 p-3">
          {mode === "edit" && field ? <EditForm action={actions.staffEditIntake} requestId={requestId} field={field} value={value} answers={answers} /> : null}
          {mode === "complete" ? <CompleteForm action={actions.raiseItem} requestId={requestId} fieldKey={fieldKey} label={label} /> : null}
          {mode === "approve" ? <StateForm action={actions.setFieldState} requestId={requestId} fieldKey={fieldKey} decision="approve" /> : null}
          {mode === "reopen" ? <StateForm action={actions.setFieldState} requestId={requestId} fieldKey={fieldKey} decision="reopen" /> : null}
          {mode === "internal" ? <NoteFormWithAttachment action={actions.postStaffNote} id={requestId} requestId={requestId} waqfId={waqfId} docs={docs} fixedVisibility="internal" fieldKey={fieldKey} label={`ملاحظة داخلية على «${label}» (لا يراها العميل)`} /> : null}
          {mode === "client" ? <NoteFormWithAttachment action={actions.postStaffNote} id={requestId} requestId={requestId} waqfId={waqfId} docs={docs} fixedVisibility="client" fieldKey={fieldKey} label={`ملاحظة للعميل على «${label}» (تظهر في حسابه)`} /> : null}
          {mode === "evidence" ? <NoteFormWithAttachment action={actions.postStaffNote} id={requestId} requestId={requestId} waqfId={waqfId} docs={docs} fixedVisibility="internal" fieldKey={fieldKey} label="ما الذي يثبته المستند؟" attachmentLabel="المستند الداعم" /> : null}
          {mode === "task" ? <TaskForm action={actions.createFieldTask} requestId={requestId} fieldKey={fieldKey} label={label} staff={staff} suggested={suggestedTask} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function EditForm({ action, requestId, field, value: initial, answers }: { action: Act; requestId: string; field: FormField; value: AnswerValue | undefined; answers: Answers }) {
  const [s, a, pending] = useActionState(action, initialState);
  const [value, setValue] = useState<AnswerValue | undefined>(initial);
  const [reason, setReason] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => a(fd)); }} className="space-y-3" data-testid={`edit-${field.key}`}>
      <input type="hidden" name="id" value={requestId} />
      <input type="hidden" name="field" value={field.key} />
      {Array.isArray(value) ? value.map((v) => <input key={v} type="hidden" name="values" value={v} />) : <input type="hidden" name="value" value={value === undefined || value === null ? "" : String(value)} />}
      <FieldInput f={{ ...field, prefill: undefined }} value={value} onChange={setValue} required={!!field.required} answers={answers} />
      <Field label="سبب التعديل ومصدره" name={`reason-${field.key}`} hint="يُحفظ مع القيمة الأصلية وهوية المعدّل وتاريخه. التعديل لا يعني الاعتماد: يعود الحقل للمراجعة.">
        <Textarea name="reason" id={`reason-${field.key}`} required minLength={10} className="min-h-16" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {s.data?.needConfirm ? (
        <label className="flex items-start gap-2 rounded-md bg-warn-soft px-3 py-2 text-[14px]">
          <input type="checkbox" name="confirmDrop" className="mt-1 size-4 accent-[var(--ink)]" />
          أؤكد التعديل، مع حفظ الإجابات غير المنطبقة في سجل التعديلات
        </label>
      ) : null}
      <FormMessage state={s} />
      <SubmitButton size="sm" disabled={pending}>{pending ? "جارٍ الحفظ…" : "احفظ التعديل"}</SubmitButton>
    </form>
  );
}

function CompleteForm({ action, requestId, fieldKey, label }: { action: Act; requestId: string; fieldKey: string; label: string }) {
  const [s, a] = useActionState(action, initialState);
  if (s.ok) return <FormMessage state={s} />;
  return (
    <form action={a} className="space-y-3" data-testid={`complete-${fieldKey}`}>
      <input type="hidden" name="id" value={requestId} />
      <input type="hidden" name="kind" value="data" />
      <input type="hidden" name="fieldKey" value={fieldKey} />
      <Field label="ما المطلوب من العميل؟" name={`ctitle-${fieldKey}`} required>
        <Input name="title" id={`ctitle-${fieldKey}`} defaultValue={`استكمال: ${label}`} required minLength={4} maxLength={200} />
      </Field>
      <Field label="التوضيح (يظهر للعميل)" name={`cbody-${fieldKey}`}>
        <Textarea name="body" id={`cbody-${fieldKey}`} className="min-h-16" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="الموعد المطلوب (اختياري)" name={`cdue-${fieldKey}`}><Input name="dueOn" id={`cdue-${fieldKey}`} type="date" dir="ltr" /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-[14px]"><input type="checkbox" name="required" defaultChecked className="size-4 accent-[var(--ink)]" /> مطلوب لإكمال الطلب</label>
      </div>
      <FormMessage state={s} />
      <SubmitButton size="sm" pendingText="جارٍ الإرسال…">أرسل طلب الاستكمال</SubmitButton>
    </form>
  );
}

function StateForm({ action, requestId, fieldKey, decision }: { action: Act; requestId: string; fieldKey: string; decision: "approve" | "reopen" }) {
  const [s, a] = useActionState(action, initialState);
  if (s.ok) return <FormMessage state={s} />;
  return (
    <form action={a} className="space-y-3" data-testid={`${decision}-${fieldKey}`}>
      <input type="hidden" name="id" value={requestId} />
      <input type="hidden" name="field" value={fieldKey} />
      <input type="hidden" name="decision" value={decision} />
      <Field label={decision === "approve" ? "ملاحظة الاعتماد (اختياري)" : "سبب إعادة المراجعة"} name={`snote-${fieldKey}-${decision}`} required={decision === "reopen"}>
        <Textarea name="note" id={`snote-${fieldKey}-${decision}`} className="min-h-16" required={decision === "reopen"} minLength={decision === "reopen" ? 5 : 0} />
      </Field>
      {decision === "approve" ? <p className="text-[13px] text-muted">يُعتمد هذا الحقل وحده بقيمته الحالية؛ لا يمتد الاعتماد إلى غيره ولا إلى الطلب، ويسقط إن تغيّرت القيمة.</p> : null}
      <FormMessage state={s} />
      <SubmitButton size="sm" variant={decision === "approve" ? "primary" : "secondary"}>{decision === "approve" ? "اعتمد الحقل" : "أعده للمراجعة"}</SubmitButton>
    </form>
  );
}

function TaskForm({ action, requestId, fieldKey, label, staff, suggested }: { action: Act; requestId: string; fieldKey: string; label: string; staff: { value: string; label: string }[]; suggested?: string }) {
  const [s, a] = useActionState(action, initialState);
  if (s.ok) return <FormMessage state={s} />;
  return (
    <form action={a} className="space-y-3" data-testid={`task-${fieldKey}`}>
      <input type="hidden" name="id" value={requestId} />
      <input type="hidden" name="field" value={fieldKey} />
      <Field label="المهمة" name={`ttitle-${fieldKey}`} required error={s.fieldErrors?.title}>
        <Input name="title" id={`ttitle-${fieldKey}`} defaultValue={suggested ?? `معالجة «${label}»`} required minLength={5} maxLength={300} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        {staff.length ? <Field label="المسؤول" name={`tassignee-${fieldKey}`}><Select name="assigneeUserId" id={`tassignee-${fieldKey}`} options={staff} placeholder="المسند إليه الطلب" /></Field> : null}
        <Field label="تاريخ الاستحقاق" name={`tdue-${fieldKey}`}><Input name="dueOn" id={`tdue-${fieldKey}`} type="date" dir="ltr" /></Field>
      </div>
      <FormMessage state={s} />
      <SubmitButton size="sm" pendingText="جارٍ الإنشاء…">أنشئ المهمة</SubmitButton>
    </form>
  );
}

/** Filter and search over the field cards of the request (client-side, over what the server rendered). */
export function FieldFilter({ counts }: { counts: Record<string, number> }) {
  const [f, setF] = useState("all");
  const [q, setQ] = useState("");
  const chips: [string, string][] = [["all", "الكل"], ["gap", "ناقص"], ["conflict", "تعارض"], ["needs_review", "يحتاج مراجعة"], ["pending", "لم يُراجع"], ["approved", "معتمد"], ["system", "من ملف الوقف"]];
  return (
    <div className="space-y-2" data-testid="field-filter">
      <style>{`${f === "all" ? "" : `[data-fieldws] [data-row]:not([data-f~="${f}"]){display:none}`} ${q ? `[data-fieldws] [data-row]:not([data-q*="${q.replace(/["\\]/g, "")}"]){display:none}` : ""}`}</style>
      <div className="flex flex-wrap gap-1.5">
        {chips.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setF(k)} aria-pressed={f === k}
            className={cn("rounded-full border px-2.5 py-1 text-[13px]", f === k ? "border-ink bg-ink text-white" : "border-line hover:bg-surface-2")}>
            {l}{k !== "all" && counts[k] !== undefined ? ` (${counts[k]})` : ""}
          </button>
        ))}
      </div>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value.trim())} placeholder="ابحث في حقول الطلب…" aria-label="ابحث في حقول الطلب"
        className="h-10 w-full max-w-md rounded-md border border-line-strong bg-surface px-3 text-[15px]" />
    </div>
  );
}
