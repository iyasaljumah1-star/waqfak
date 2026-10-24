"use client";

import { RawActionForm, Submit } from "@/components/waqf/action-form";
import { Textarea } from "@/components/ui/form";
import { reviewFileChange } from "@/server/modules/waqf-core/file-review-actions";

/** The reviewer's decision on one change to a waqf file. */
export function FileReviewForm({ taskId, waqfId }: { taskId: string; waqfId: string }) {
  return (
    <RawActionForm action={reviewFileChange} hidden={{ taskId, waqfId }} testId={`review-form-${taskId}`}
      extraButtons={(pending) => (
        <>
          <Submit pending={pending} name="decision" value="approve" size="sm">اعتمد التعديل</Submit>
          <Submit pending={pending} name="decision" value="return" variant="secondary" size="sm">يحتاج تصحيحًا</Submit>
        </>
      )}>
      <label className="block text-[13px] text-muted" htmlFor={`note-${taskId}`}>ملاحظة المراجعة (لازمة عند طلب التصحيح)</label>
      <Textarea id={`note-${taskId}`} name="note" rows={2} maxLength={1000} />
    </RawActionForm>
  );
}
