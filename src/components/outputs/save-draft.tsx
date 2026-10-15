"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { initialState, type ActionState } from "@/lib/utils";

type Act = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** Saves the previewed draft as version 1 and opens it (the saved draft replaces the live preview). */
export function SaveDraftForm({ action, requestId, outputKey }: { action: Act; requestId: string; outputKey: string }) {
  const [s, a] = useActionState(action, initialState);
  const router = useRouter();
  const id = typeof s.data?.outputId === "string" ? s.data.outputId : null;
  useEffect(() => {
    if (s.ok && id) router.push(`/admin/requests/${requestId}/outputs/${id}`);
  }, [s, id, requestId, router]);
  return (
    <form action={a} className="space-y-2">
      <input type="hidden" name="id" value={requestId} />
      <input type="hidden" name="outputKey" value={outputKey} />
      <FormMessage state={s} />
      <SubmitButton size="sm" pendingText="جارٍ الحفظ…">احفظها مسودة (النسخة 1)</SubmitButton>
    </form>
  );
}
