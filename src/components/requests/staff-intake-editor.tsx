"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { Field, FormMessage, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { FieldInput } from "@/components/requests/intake-wizard";
import { initialState, type ActionState } from "@/lib/utils";
import type { AnswerValue, Field as FormField } from "@/server/modules/requests/intake/engine";

type Act = (s: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * The team corrects or completes one answer of the client's form, with the reason and source. The value goes through
 * the field's own validation on the server; the previous value is kept in the request's revisions.
 */
export function StaffIntakeEditor({ action, requestId, fields }: { action: Act; requestId: string; fields: { step: string; field: FormField; value: AnswerValue | undefined }[] }) {
  const [s, a, pending] = useActionState(action, initialState);
  const [key, setKey] = useState("");
  const cur = fields.find((x) => x.field.key === key);
  const [value, setValue] = useState<AnswerValue | undefined>(undefined);
  const pick = (k: string) => { setKey(k); setValue(fields.find((x) => x.field.key === k)?.value); };
  const form = useRef<HTMLFormElement>(null);
  // Submitted without React's automatic form reset: when the server asks to confirm dropped answers, the chosen value
  // and the reason stay as typed, so confirming does not mean entering them again. A saved correction clears the form.
  useEffect(() => { if (s.ok) { form.current?.reset(); setKey(""); setValue(undefined); } }, [s]);
  return (
    <form ref={form} onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => a(fd)); }} className="space-y-3" data-testid="staff-intake-editor">
      <input type="hidden" name="id" value={requestId} />
      <input type="hidden" name="field" value={key} />
      {Array.isArray(value) ? value.map((v) => <input key={v} type="hidden" name="values" value={v} />) : <input type="hidden" name="value" value={value === undefined || value === null ? "" : String(value)} />}
      <Field label="الحقل المراد تصحيحه أو استكماله" name="edit-field">
        <Select name="edit-field" id="edit-field" value={key} onChange={(e) => pick(e.target.value)} placeholder="اختر الحقل" options={fields.map((x) => ({ value: x.field.key, label: `${x.step}: ${x.field.label}` }))} />
      </Field>
      {cur ? <div className="rounded-md bg-surface-2 p-3"><FieldInput f={{ ...cur.field, prefill: undefined }} value={value} onChange={setValue} required={!!cur.field.required} /></div> : null}
      <Field label="سبب التصحيح ومصدره" name="edit-reason" hint="مثال: أكده العميل هاتفيًا، أو من صك الملكية المرفق. يُحفظ مع القيمة السابقة.">
        <Textarea name="reason" id="edit-reason" required minLength={10} className="min-h-16" />
      </Field>
      {s.data?.needConfirm ? (
        <label className="flex items-start gap-2 rounded-md bg-warn-soft px-3 py-2 text-[14px]" data-testid="confirm-drop">
          <input type="checkbox" name="confirmDrop" className="mt-1 size-4 accent-[var(--ink)]" />
          أؤكد التصحيح، مع حفظ الإجابات غير المنطبقة في سجل التعديلات
        </label>
      ) : null}
      <FormMessage state={s} />
      <SubmitButton size="sm" disabled={!key || pending}>{pending ? "جارٍ الحفظ…" : "احفظ التصحيح"}</SubmitButton>
    </form>
  );
}
