"use client";

import { useActionState } from "react";
import { Field, FormMessage, Input, Select, SubmitButton } from "@/components/ui/form";
import { initialState } from "@/lib/utils";
import { updateProfile } from "@/server/modules/account/actions";

export function ProfileForm({ fullName, email, calendarPref, numeralStyle }: { fullName: string; email: string; calendarPref: string; numeralStyle: string }) {
  const [s, a] = useActionState(updateProfile, initialState);
  const fe = s.fieldErrors ?? {};
  return (
    <form action={a} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="الاسم الكامل" name="fullName" required error={fe.fullName} className="sm:col-span-2">
          <Input name="fullName" autoComplete="name" required defaultValue={fullName} error={fe.fullName} />
        </Field>
        <Field label="البريد الإلكتروني" name="email" hint="لاستلام التقارير والتنبيهات، وللدخول بكلمة المرور إن عيّنتها." error={fe.email} className="sm:col-span-2">
          <Input name="email" type="email" autoComplete="email" dir="ltr" className="text-start" defaultValue={email} error={fe.email} />
        </Field>
        <Field label="التقويم المفضل" name="calendarPref" hint="المواعيد النظامية تظهر بالتقويمين دائمًا." error={fe.calendarPref}>
          <Select name="calendarPref" defaultValue={calendarPref} options={[{ value: "both", label: "الهجري والميلادي معًا" }, { value: "hijri", label: "الهجري" }, { value: "gregorian", label: "الميلادي" }]} />
        </Field>
        <Field label="شكل الأرقام" name="numeralStyle" error={fe.numeralStyle}>
          <Select name="numeralStyle" defaultValue={numeralStyle} options={[{ value: "latn", label: "0123456789" }, { value: "arab", label: "٠١٢٣٤٥٦٧٨٩" }]} />
        </Field>
      </div>
      <FormMessage state={s} />
      <SubmitButton>احفظ</SubmitButton>
    </form>
  );
}
