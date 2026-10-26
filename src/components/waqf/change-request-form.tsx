"use client";

import { RawActionForm, Submit } from "@/components/waqf/action-form";
import { Select, Textarea } from "@/components/ui/form";
import { requestFileChange } from "@/server/modules/waqf-core/change-request-actions";

const SECTIONS = ["الهوية والتسجيل", "الوثيقة والشروط", "المصارف والمستحقون", "الأطراف والنظارة", "الأصول الموقوفة", "أخرى"];

/** The founder of a documented waqf asks the team for a change to its file (the file itself is not edited). */
export function ChangeRequestForm({ waqfId }: { waqfId: string }) {
  return (
    <RawActionForm action={requestFileChange} hidden={{ waqfId }} testId="change-request-form" extraButtons={(pending) => <Submit pending={pending}>أرسل طلب التعديل</Submit>}>
      <label className="block text-[14px] font-medium" htmlFor="cr-section">القسم المطلوب تعديله</label>
      <Select id="cr-section" name="section" options={SECTIONS.map((s) => ({ value: s, label: s }))} placeholder="اختر…" />
      <label className="block text-[14px] font-medium" htmlFor="cr-details">البيانات المطلوب تغييرها</label>
      <Textarea id="cr-details" name="details" rows={3} maxLength={2000} placeholder="القيمة الحالية، والقيمة المطلوبة. مثال: نسبة المصرف الأول 60٪ والصحيح 50٪ كما في الصك." />
      <label className="block text-[14px] font-medium" htmlFor="cr-reason">مبرر التعديل وسنده</label>
      <Textarea id="cr-reason" name="reason" rows={2} maxLength={1000} placeholder="مثال: خطأ في الإدخال، والصك المرفق في الوثائق يذكر 50٪." />
    </RawActionForm>
  );
}
