"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage, Input, SubmitButton, Textarea } from "@/components/ui/form";
import { cn, initialState } from "@/lib/utils";
import { submitComplaint } from "@/server/modules/complaints/actions";

const KINDS = [
  { value: "info_request", label: "طلب اطلاع", hint: "اطلب الاطلاع على معلومة تخص استحقاقك أو أعمال الوقف (مثل القوائم المالية أو أساس احتساب نصيبك)." },
  { value: "inquiry", label: "استفسار", hint: "سؤال عن الصرف أو المواعيد أو الإجراءات." },
  { value: "complaint", label: "شكوى", hint: "اعتراض على تأخير أو خطأ أو تصرف تراه مخالفًا لشرط الواقف." },
] as const;

/** Reusable form for beneficiary inquiries, complaints and information requests (لائحة تنظيم أعمال النظارة م10). */
export function ComplaintForm({ waqfId, defaultKind = "info_request" }: { waqfId: string; defaultKind?: "inquiry" | "complaint" | "info_request" }) {
  const [state, run] = useActionState(submitComplaint, initialState);
  const [kind, setKind] = useState<string>(defaultKind);
  const fe = state.fieldErrors ?? {};
  const active = KINDS.find((k) => k.value === kind);
  return (
    <form action={run} className="space-y-4">
      <input type="hidden" name="waqfId" value={waqfId} />
      <fieldset>
        <legend className="mb-2 text-[15px] font-medium">نوع الطلب</legend>
        <div className="grid grid-cols-3 gap-2">
          {KINDS.map((k) => (
            <label key={k.value} className={cn("flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-2 text-center text-[14px] font-medium", kind === k.value ? "border-ink bg-ink-soft text-ink" : "border-line-strong bg-surface")}>
              <input type="radio" name="kind" value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} className="sr-only" />
              {k.label}
            </label>
          ))}
        </div>
        {active ? <p className="mt-2 text-[13px] text-muted">{active.hint}</p> : null}
        {fe.kind ? <p className="text-[13px] text-critical">{fe.kind}</p> : null}
      </fieldset>
      <Field label="الموضوع" name="subject" error={fe.subject} required>
        <Input name="subject" maxLength={200} required />
      </Field>
      <Field label="التفاصيل" name="body" error={fe.body} required hint="لا تكتب أرقام حسابات أو هويات؛ سيتواصل معك الناظر عبر المنصة.">
        <Textarea name="body" maxLength={5000} required />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="جارٍ الإرسال…">أرسل الطلب</SubmitButton>
    </form>
  );
}
