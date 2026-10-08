"use client";

import { useActionState } from "react";
import { Checkbox, Field, FormMessage, SubmitButton, Textarea } from "@/components/ui/form";
import { initialState } from "@/lib/utils";
import { respondComplaint, setComplaintStatus } from "@/server/modules/complaints/actions";

export function RespondForm({ waqfId, complaintId, number, existing }: { waqfId: string; complaintId: string; number: string; existing?: string | null }) {
  const [state, run] = useActionState(respondComplaint, initialState);
  const id = `response-${complaintId.slice(0, 8)}`;
  return (
    <form action={run} className="space-y-3">
      <input type="hidden" name="waqfId" value={waqfId} />
      <input type="hidden" name="complaintId" value={complaintId} />
      <Field label={`الرد على ${number}`} name={id} error={state.fieldErrors?.response} hint="يظهر الرد لمقدّم الطلب كما تكتبه. اذكر الإجراء المتخذ والمرجع إن وُجد.">
        <Textarea id={id} name="response" defaultValue={existing ?? ""} maxLength={5000} className="min-h-24" />
      </Field>
      <Checkbox name="close" label="أغلق الطلب بعد الرد" />
      <FormMessage state={state} />
      <SubmitButton pendingText="جارٍ الإرسال…">أرسل الرد</SubmitButton>
    </form>
  );
}

export function StatusButton({ waqfId, complaintId, status, label }: { waqfId: string; complaintId: string; status: "in_progress" | "closed" | "open"; label: string }) {
  const [state, run] = useActionState(setComplaintStatus, initialState);
  return (
    <form action={run} className="space-y-2">
      <input type="hidden" name="waqfId" value={waqfId} />
      <input type="hidden" name="complaintId" value={complaintId} />
      <input type="hidden" name="status" value={status} />
      <SubmitButton variant="secondary" size="sm" pendingText="…">{label}</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
