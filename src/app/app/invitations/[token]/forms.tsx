"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { initialState } from "@/lib/utils";
import { acceptInvitation, declineInvitation } from "@/server/modules/waqf-core/actions";

export function InvitationActions({ token }: { token: string }) {
  const [a, accept] = useActionState(acceptInvitation, initialState);
  const [d, decline] = useActionState(declineInvitation, initialState);
  return (
    <div className="space-y-3">
      <FormMessage state={a.error ? a : d} />
      <div className="flex flex-wrap gap-2">
        <form action={accept}>
          <input type="hidden" name="token" value={token} />
          <SubmitButton pendingText="جارٍ القبول…">أقبل الدعوة</SubmitButton>
        </form>
        <form action={decline}>
          <input type="hidden" name="token" value={token} />
          <SubmitButton variant="secondary" pendingText="…">أعتذر</SubmitButton>
        </form>
      </div>
    </div>
  );
}
