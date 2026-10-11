"use client";

import { useState } from "react";
import { Field, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { ActionForm } from "@/components/admin/action-form";
import { updateAccount } from "@/server/modules/admin/users/actions";

/**
 * Edit form for a user's identifying data (admin). When the editor may not see personal data, the phone field starts
 * empty: typing a number replaces the current one, leaving it empty keeps it.
 */
export function AccountEditForm({
  userId, fullName, email, hasEmail, phoneLocal, residesInKsa, canSeePii,
}: {
  /** `email` and `phoneLocal` are passed only to editors who may see personal data (empty otherwise). */
  userId: string; fullName: string; email: string; hasEmail: boolean; phoneLocal: string; residesInKsa: boolean | null; canSeePii: boolean;
}) {
  // Controlled fields: React resets a form after its action runs, which would drop the editor's input on a validation error.
  const [v, setV] = useState({
    fullName, phone: canSeePii ? phoneLocal : "", email: canSeePii ? email : "",
    residesInKsa: residesInKsa === true ? "yes" : residesInKsa === false ? "no" : "", reason: "",
  });
  const bind = (k: keyof typeof v) => ({ value: v[k], onChange: (e: { target: { value: string } }) => setV((o) => ({ ...o, [k]: e.target.value })) });
  return (
    <ActionForm action={updateAccount} hidden={{ userId }}>
      {(s) => (
        <>
          <Field label="الاسم الكامل" name="fullName" required error={s.fieldErrors?.fullName}>
            <Input id="fullName" name="fullName" {...bind("fullName")} autoComplete="off" required error={s.fieldErrors?.fullName} />
          </Field>
          <Field
            label="رقم الجوال"
            name="phone"
            error={s.fieldErrors?.phone}
            hint={canSeePii ? "تغيير الرقم ينهي جلسات الحساب، ويُؤكَّد الرقم الجديد برمز عند أول دخول." : "لا تملك صلاحية عرض الرقم الحالي. اكتب رقمًا جديدًا لاستبداله، أو اترك الحقل فارغًا للإبقاء عليه."}
          >
            <Input id="phone" name="phone" dir="ltr" inputMode="tel" {...bind("phone")} placeholder="05XXXXXXXX" className="tabular" error={s.fieldErrors?.phone} />
          </Field>
          <Field label="البريد الإلكتروني" name="email" error={s.fieldErrors?.email} hint={canSeePii ? "اتركه فارغًا إن لم يكن للحساب بريد." : "اكتب بريدًا جديدًا لاستبداله، أو اترك الحقل فارغًا للإبقاء على الحالي."}>
            <Input id="email" name="email" type="email" dir="ltr" {...bind("email")} placeholder={!canSeePii && hasEmail ? "مسجّل (محجوب)" : "name@example.com"} error={s.fieldErrors?.email} />
          </Field>
          {!canSeePii && hasEmail ? <input type="hidden" name="keepEmail" value="1" /> : null}
          <Field label="الإقامة" name="residesInKsa">
            <Select
              id="residesInKsa"
              name="residesInKsa"
              {...bind("residesInKsa")}
              options={[{ value: "yes", label: "مقيم في المملكة" }, { value: "no", label: "مقيم خارج المملكة" }]}
              placeholder="غير محدد"
            />
          </Field>
          <Field label="سبب التعديل" name="reason" error={s.fieldErrors?.reason} hint="مطلوب عند تغيير الجوال أو البريد، ويُحفظ في سجل العمليات.">
            <Textarea id="reason" name="reason" rows={2} maxLength={500} {...bind("reason")} error={s.fieldErrors?.reason} />
          </Field>
          <SubmitButton pendingText="جارٍ الحفظ…">احفظ التعديلات</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
