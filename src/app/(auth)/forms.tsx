"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { Checkbox, Field, FormMessage, Input, SubmitButton } from "@/components/ui/form";
import { initialState } from "@/lib/utils";
import { loginPassword, loginStart, recoverStart, resendCode, signupStart, verifyCode, verifyMfa } from "@/server/modules/auth.actions";

export function LoginForms({ next }: { next?: string }) {
  const [tab, setTab] = useState<"phone" | "email">("phone");
  const [s1, a1] = useActionState(loginStart, initialState);
  const [s2, a2] = useActionState(loginPassword, initialState);
  return (
    <div className="space-y-6">
      <div role="tablist" aria-label="طريقة الدخول" className="grid grid-cols-2 rounded-md bg-surface-2 p-1 ring-1 ring-line">
        {(["phone", "email"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)}
            className={`h-10 rounded text-[15px] font-medium transition-colors ${tab === t ? "bg-surface text-ink shadow-card" : "text-muted"}`}>
            {t === "phone" ? "رقم الجوال" : "البريد وكلمة المرور"}
          </button>
        ))}
      </div>
      {tab === "phone" ? (
        <form action={a1} className="space-y-4">
          <input type="hidden" name="next" value={next ?? ""} />
          <Field label="رقم الجوال" name="phone" error={s1.fieldErrors?.phone} hint="سنرسل إليك رمز تحقق من 6 أرقام.">
            <Input name="phone" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" placeholder="05XXXXXXXX" required error={s1.fieldErrors?.phone} className="text-start" />
          </Field>
          <FormMessage state={s1} />
          <SubmitButton className="w-full" pendingText="جارٍ الإرسال…">أرسل رمز الدخول</SubmitButton>
        </form>
      ) : (
        <form action={a2} className="space-y-4">
          <input type="hidden" name="next" value={next ?? ""} />
          <Field label="البريد الإلكتروني" name="email">
            <Input name="email" type="email" autoComplete="email" dir="ltr" required className="text-start" />
          </Field>
          <Field label="كلمة المرور" name="password">
            <Input name="password" type="password" autoComplete="current-password" dir="ltr" required className="text-start" />
          </Field>
          <FormMessage state={s2} />
          <SubmitButton className="w-full" pendingText="جارٍ التحقق…">ادخل</SubmitButton>
          <p className="text-[13px] text-muted">بعد كلمة المرور نطلب عاملًا ثانيًا: تطبيق المصادقة أو رمزًا إلى جوالك.</p>
        </form>
      )}
      <div className="flex flex-wrap justify-between gap-2 text-[15px]">
        <Link href="/signup" className="text-ink underline-offset-4 hover:underline">إنشاء حساب جديد</Link>
        <Link href="/recover" className="text-muted underline-offset-4 hover:underline">لا أستطيع الدخول</Link>
      </div>
    </div>
  );
}

export function SignupForm({ next }: { next?: string }) {
  const [s, a] = useActionState(signupStart, initialState);
  return (
    <form action={a} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="الاسم الكامل" name="fullName" required error={s.fieldErrors?.fullName}>
        <Input name="fullName" autoComplete="name" required error={s.fieldErrors?.fullName} />
      </Field>
      <Field label="رقم الجوال" name="phone" required error={s.fieldErrors?.phone}>
        <Input name="phone" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" placeholder="05XXXXXXXX" required error={s.fieldErrors?.phone} className="text-start" />
      </Field>
      <Field label="البريد الإلكتروني" name="email" hint="اختياري، لاستلام التقارير والتنبيهات." error={s.fieldErrors?.email}>
        <Input name="email" type="email" autoComplete="email" dir="ltr" error={s.fieldErrors?.email} className="text-start" />
      </Field>
      <div className="space-y-2 rounded-md bg-surface-2 p-3">
        <Checkbox name="terms" required label={<>قرأت <Link className="text-ink underline" href="/legal/terms" target="_blank">الشروط والأحكام</Link> و<Link className="text-ink underline" href="/legal/privacy" target="_blank">سياسة الخصوصية</Link> وأوافق عليهما.</>} />
        {s.fieldErrors?.terms ? <p className="text-[13px] text-critical">{s.fieldErrors.terms}</p> : null}
        <Checkbox name="marketing" label="أرغب في استلام المقالات والتحديثات النظامية بالبريد (اختياري)." />
      </div>
      <FormMessage state={s} />
      {s.data?.login ? <Link href="/login" className="block text-ink underline">انتقل إلى صفحة الدخول</Link> : null}
      <SubmitButton className="w-full" pendingText="جارٍ الإرسال…">أنشئ الحساب</SubmitButton>
      <p className="text-center text-[15px] text-muted">لديك حساب؟ <Link href="/login" className="text-ink underline-offset-4 hover:underline">سجّل الدخول</Link></p>
    </form>
  );
}

export function VerifyForm({ maskedTarget, demoCode }: { maskedTarget: string; demoCode?: string }) {
  const [s, a] = useActionState(verifyCode, initialState);
  const [resend, setResend] = useState<{ ok?: boolean; message?: string; error?: string }>({});
  const [pending, start] = useTransition();
  return (
    <div className="space-y-5">
      <p className="text-muted">أرسلنا رمزًا من 6 أرقام إلى <span dir="ltr" className="font-medium text-text">{maskedTarget}</span>. الرمز صالح 5 دقائق.</p>
      {demoCode ? (
        <div className="rounded-md border border-dashed border-seal bg-seal-soft p-3 text-[15px]" role="note">
          <p className="font-semibold text-seal">وضع التجربة</p>
          <p>لم يُربط مزود الرسائل بعد، لذلك يظهر الرمز هنا: <span dir="ltr" className="tabular font-bold tracking-[0.3em]">{demoCode}</span></p>
        </div>
      ) : null}
      <form action={a} className="space-y-4">
        <Field label="رمز التحقق" name="code" error={s.fieldErrors?.code}>
          <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} dir="ltr" required autoFocus className="tabular text-center text-2xl tracking-[0.5em]" error={s.fieldErrors?.code} />
        </Field>
        <FormMessage state={s} />
        <SubmitButton className="w-full" pendingText="جارٍ التحقق…">تحقّق</SubmitButton>
      </form>
      <div className="flex items-center justify-between text-[15px]">
        <button type="button" disabled={pending} onClick={() => start(async () => setResend(await resendCode()))} className="text-ink underline-offset-4 hover:underline disabled:opacity-50">
          أعد إرسال الرمز
        </button>
        <Link href="/login" className="text-muted hover:underline">تغيير الرقم</Link>
      </div>
      {resend.message || resend.error ? <FormMessage state={resend} /> : null}
    </div>
  );
}

export function MfaForm({ next }: { next?: string }) {
  const [s, a] = useActionState(verifyMfa, initialState);
  return (
    <form action={a} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="الرمز من تطبيق المصادقة" name="code" hint="أو أدخل أحد أكواد الاسترداد التي حفظتها عند التفعيل." error={s.fieldErrors?.code}>
        <Input name="code" autoComplete="one-time-code" dir="ltr" required autoFocus className="tabular text-center text-xl tracking-[0.3em]" />
      </Field>
      <FormMessage state={s} />
      <SubmitButton className="w-full" pendingText="جارٍ التحقق…">تحقّق</SubmitButton>
    </form>
  );
}

export function RecoverForm() {
  const [s, a] = useActionState(recoverStart, initialState);
  return (
    <form action={a} className="space-y-4">
      <Field label="رقم الجوال المسجّل" name="phone" error={s.fieldErrors?.phone}>
        <Input name="phone" type="tel" inputMode="tel" dir="ltr" placeholder="05XXXXXXXX" required className="text-start" error={s.fieldErrors?.phone} />
      </Field>
      <FormMessage state={s} />
      <SubmitButton className="w-full" pendingText="جارٍ الإرسال…">أرسل رمز الاستعادة</SubmitButton>
      <p className="text-[13px] text-muted">
        بعد الاستعادة نُنهي جميع الجلسات المفتوحة على حسابك. إن فقدت جوالك وتطبيق المصادقة معًا، تواصل مع الدعم للتحقق اليدوي من هويتك (يستغرق 48 ساعة لحمايتك).
      </p>
    </form>
  );
}
