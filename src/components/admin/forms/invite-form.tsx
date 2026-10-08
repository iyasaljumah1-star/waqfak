"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Field, FormMessage, Input, Select, SubmitButton } from "@/components/ui/form";
import { inviteStaff } from "@/server/modules/admin/users/actions";

export function InviteStaffForm({ roles }: { roles: { key: string; nameAr: string }[] }) {
  const [s, action] = useActionState(inviteStaff, {});
  const fe = s.fieldErrors ?? {};
  const existing = typeof s.data?.existingId === "string" ? s.data.existingId : null;
  return (
    <form action={action} className="max-w-xl space-y-4" noValidate>
      <FormMessage state={s} />
      {existing ? (
        <p className="text-[15px]">
          <Link href={`/admin/users/${existing}`} className="text-ink underline">افتح صفحة الحساب القائم</Link>
        </p>
      ) : null}
      <Field label="الاسم الكامل" name="fullName" error={fe.fullName} required>
        <Input name="fullName" autoComplete="off" error={fe.fullName} required />
      </Field>
      <Field label="رقم الجوال" name="phone" error={fe.phone} hint="يدخل به أول مرة برمز لمرة واحدة." required>
        <Input name="phone" type="tel" dir="ltr" inputMode="tel" placeholder="05XXXXXXXX" error={fe.phone} required />
      </Field>
      <Field label="البريد الإلكتروني للعمل" name="email" error={fe.email} hint="اختياري. يتيح لاحقًا الدخول بالبريد وكلمة المرور.">
        <Input name="email" type="email" dir="ltr" error={fe.email} />
      </Field>
      <Field label="الدور" name="roleKey" error={fe.roleKey} hint="يمكن إضافة أدوار أخرى من صفحة المستخدم بعد الإنشاء." required>
        <Select name="roleKey" options={roles.map((r) => ({ value: r.key, label: r.nameAr }))} placeholder="اختر الدور" error={fe.roleKey} required />
      </Field>
      <SubmitButton pendingText="جارٍ الإرسال…">أنشئ الحساب وأرسل الدعوة</SubmitButton>
    </form>
  );
}
