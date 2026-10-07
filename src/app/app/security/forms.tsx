"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { ShieldCheck } from "lucide-react";
import { Alert, Button } from "@/components/ui";
import { Field, FormMessage, Input, SubmitButton } from "@/components/ui/form";
import { initialState, type ActionState } from "@/lib/utils";
import { changePassword, confirmTotp, revokeOtherSessions, revokeSession, startTotp, turnOffMfa } from "@/server/modules/account/actions";

type Enrollment = { factorId: string; secret: string; qr: string };

/** One component for every MFA state so enrollment and recovery codes survive the server refresh after confirming. */
export function MfaPanel({ enabled, isStaff }: { enabled: boolean; isStaff: boolean }) {
  const router = useRouter();
  const [enroll, setEnroll] = useState<Enrollment | null>(null);
  const [startState, setStartState] = useState<ActionState>({});
  const [pending, start] = useTransition();
  const [confirmState, confirm] = useActionState(confirmTotp, initialState);
  const [offState, off] = useActionState(turnOffMfa, initialState);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const c = confirmState.data?.codes;
    if (confirmState.ok && Array.isArray(c)) {
      setCodes(c as string[]);
      setEnroll(null);
    }
  }, [confirmState]);

  if (codes)
    return (
      <div className="space-y-4">
        <Alert tone="ok" title="فُعّل التحقق بخطوتين">احفظ أكواد الاسترداد الآن. لن نعرضها مرة أخرى.</Alert>
        <p className="text-[15px]">
          كل كود يُستخدم مرة واحدة للدخول إن فقدت جوالك. احفظها في مكان آمن خارج الجوال (مدير كلمات مرور أو ورقة محفوظة).
        </p>
        <ol data-testid="recovery-codes" dir="ltr" className="tabular grid grid-cols-2 gap-2 rounded-md border border-line bg-surface-2 p-4 font-mono text-[15px] sm:grid-cols-4">
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => navigator.clipboard?.writeText(codes.join("\n"))}>انسخ الأكواد</Button>
        </div>
        <label className="flex items-start gap-3 text-[15px]">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-1.5 size-4 accent-[var(--ink)]" />
          حفظت أكواد الاسترداد في مكان آمن.
        </label>
        <Button
          type="button"
          disabled={!saved}
          onClick={() => {
            setCodes(null);
            router.refresh();
          }}
        >
          تم
        </Button>
      </div>
    );

  if (enabled)
    return (
      <div className="space-y-4">
        <p className="flex items-center gap-2 font-medium text-ok">
          <ShieldCheck aria-hidden className="size-5" />
          التحقق بخطوتين مفعّل بتطبيق المصادقة.
        </p>
        {isStaff ? (
          <p className="text-sm text-muted">التحقق بخطوتين إلزامي لموظفي وقفك ولا يمكن إيقافه.</p>
        ) : (
          <details className="rounded-md border border-line p-3">
            <summary className="cursor-pointer text-[15px] text-muted">إيقاف التحقق بخطوتين</summary>
            <form action={off} className="mt-3 space-y-3">
              <p className="text-sm text-muted">إيقافه يجعل الدخول برمز الجوال وحده. لتأكيد أنك صاحب الحساب أدخل الرمز الحالي من التطبيق.</p>
              <Field label="الرمز الحالي" name="off-code" error={offState.fieldErrors?.code}>
                <Input name="code" id="off-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} dir="ltr" className="tabular max-w-40 text-center tracking-[0.3em]" />
              </Field>
              <FormMessage state={offState} />
              <SubmitButton variant="danger" size="sm" pendingText="…">أوقف التحقق بخطوتين</SubmitButton>
            </form>
          </details>
        )}
      </div>
    );

  if (enroll)
    return (
      <div className="space-y-4">
        <ol className="list-decimal space-y-1 ps-5 text-[15px]">
          <li>افتح تطبيق مصادقة على جوالك (مثل Google Authenticator أو Microsoft Authenticator).</li>
          <li>امسح الرمز أدناه، أو أدخل المفتاح يدويًا.</li>
          <li>أدخل الرمز المكوّن من 6 أرقام الذي يظهر في التطبيق.</li>
        </ol>
        <div className="flex flex-col items-start gap-4 sm:flex-row">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enroll.qr} alt="رمز QR لإضافة حساب وقفك إلى تطبيق المصادقة" width={180} height={180} className="rounded-md border border-line bg-white p-1" />
          <div className="min-w-0 space-y-1">
            <p className="text-[13px] text-muted">المفتاح اليدوي</p>
            <p data-testid="totp-secret" dir="ltr" className="break-all font-mono text-[15px] tracking-wider">{enroll.secret}</p>
          </div>
        </div>
        <form action={confirm} className="space-y-3">
          <input type="hidden" name="factorId" value={enroll.factorId} />
          <Field label="الرمز من التطبيق" name="code" error={confirmState.fieldErrors?.code}>
            <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} dir="ltr" required className="tabular max-w-48 text-center text-xl tracking-[0.3em]" />
          </Field>
          <FormMessage state={confirmState} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton pendingText="جارٍ التحقق…">أكّد التفعيل</SubmitButton>
            <Button type="button" variant="ghost" onClick={() => setEnroll(null)}>إلغاء</Button>
          </div>
        </form>
      </div>
    );

  return (
    <div className="space-y-3">
      <p className="text-[15px]">أضف طبقة حماية ثانية: بعد رمز الجوال أو كلمة المرور نطلب رمزًا من تطبيق مصادقة على جوالك.</p>
      <FormMessage state={startState} />
      <Button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await startTotp();
            setStartState(r.error ? r : {});
            if (r.ok && r.data) setEnroll(r.data as Enrollment);
          })
        }
      >
        {pending ? "جارٍ التجهيز…" : "فعّل التحقق بخطوتين"}
      </Button>
    </div>
  );
}

export function PasswordForm({ hasPassword, hasEmail }: { hasPassword: boolean; hasEmail: boolean }) {
  const [s, a] = useActionState(changePassword, initialState);
  const fe = s.fieldErrors ?? {};
  return (
    <form action={a} className="max-w-md space-y-4">
      {hasPassword ? (
        <Field label="كلمة المرور الحالية" name="current" required error={fe.current}>
          <Input name="current" type="password" autoComplete="current-password" dir="ltr" className="text-start" required error={fe.current} />
        </Field>
      ) : null}
      {!hasEmail ? (
        <Field label="البريد الإلكتروني للدخول" name="email" required hint="تدخل به مع كلمة المرور." error={fe.email}>
          <Input name="email" type="email" autoComplete="email" dir="ltr" className="text-start" required error={fe.email} />
        </Field>
      ) : null}
      <Field label={hasPassword ? "كلمة المرور الجديدة" : "كلمة المرور"} name="password" required hint="12 حرفًا على الأقل. عبارة طويلة تتذكرها أفضل من رموز معقدة." error={fe.password}>
        <Input name="password" type="password" autoComplete="new-password" dir="ltr" className="text-start" required minLength={12} error={fe.password} />
      </Field>
      <Field label="أعد كتابة كلمة المرور" name="confirm" required error={fe.confirm}>
        <Input name="confirm" type="password" autoComplete="new-password" dir="ltr" className="text-start" required error={fe.confirm} />
      </Field>
      <FormMessage state={s} />
      <SubmitButton>{hasPassword ? "غيّر كلمة المرور" : "عيّن كلمة المرور"}</SubmitButton>
    </form>
  );
}

export function RevokeSessionButton({ sessionId }: { sessionId: string }) {
  const [s, a] = useActionState(revokeSession, initialState);
  return (
    <form action={a}>
      <input type="hidden" name="sessionId" value={sessionId} />
      <SubmitButton size="sm" variant="ghost" className="text-critical" pendingText="…">إنهاء</SubmitButton>
      {s.error ? <p className="text-[13px] text-critical">{s.error}</p> : null}
    </form>
  );
}

export function RevokeOthersButton() {
  const [s, a] = useActionState(async () => revokeOtherSessions(), initialState);
  return (
    <form action={a} className="flex flex-wrap items-center gap-2">
      <SubmitButton size="sm" variant="secondary" pendingText="…">أنهِ كل الجلسات الأخرى</SubmitButton>
      {s.message || s.error ? <span className={s.error ? "text-sm text-critical" : "text-sm text-ok"}>{s.error ?? s.message}</span> : null}
    </form>
  );
}
