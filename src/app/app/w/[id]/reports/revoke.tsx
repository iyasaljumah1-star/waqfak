"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/form";
import { initialState } from "@/lib/utils";
import { revokeReport } from "@/server/modules/compliance/actions";

export function RevokeReportButton({ waqfId, reportId }: { waqfId: string; reportId: string }) {
  const [state, action] = useActionState(revokeReport, initialState);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("إلغاء الحزمة يمنع تنزيلها لاحقًا. هل تريد المتابعة؟")) e.preventDefault();
      }}
    >
      <input type="hidden" name="waqfId" value={waqfId} />
      <input type="hidden" name="reportId" value={reportId} />
      <SubmitButton variant="ghost" size="sm" pendingText="…">ألغِ</SubmitButton>
      {state.error ? <p role="alert" className="text-[13px] text-critical">{state.error}</p> : null}
    </form>
  );
}
