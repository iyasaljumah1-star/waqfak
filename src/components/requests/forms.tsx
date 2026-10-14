"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { Star } from "lucide-react";
import { Checkbox, Field, FormMessage, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { cn, initialState, type ActionState } from "@/lib/utils";

type Act = (prev: ActionState, fd: FormData) => Promise<ActionState>;
type Variant = "primary" | "secondary" | "ghost" | "danger" | "seal";

function Hidden({ fields }: { fields?: Record<string, string | null | undefined> }) {
  return <>{Object.entries(fields ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v ?? ""} />)}</>;
}

/** Generic server-action form: hidden fields + optional inputs + submit. Resets on success. */
export function ActionForm({ action, hidden, children, submit, pendingText, variant = "primary", size = "md", className, inline }: {
  action: Act; hidden?: Record<string, string | null | undefined>; children?: ReactNode; submit: ReactNode; pendingText?: string; variant?: Variant; size?: "sm" | "md" | "lg"; className?: string; inline?: boolean;
}) {
  const [s, a] = useActionState(action, initialState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (s.ok) ref.current?.reset();
  }, [s]);
  return (
    <form ref={ref} action={a} className={cn(inline ? "inline-flex flex-col gap-2" : "space-y-3", className)}>
      <Hidden fields={hidden} />
      {children}
      <FormMessage state={s} />
      {/* fields here are not wired to the state, so the reasons are listed under the message */}
      {s.fieldErrors && Object.keys(s.fieldErrors).length ? (
        <ul className="list-disc ps-5 text-[14px] text-critical">{Object.entries(s.fieldErrors).filter(([, v]) => v).map(([k, v]) => <li key={k}>{v}</li>)}</ul>
      ) : null}
      <SubmitButton variant={variant} size={size} pendingText={pendingText ?? "جارٍ التنفيذ…"}>{submit}</SubmitButton>
    </form>
  );
}

/** One button per allowed transition. Transitions that need a reason open a small form. */
export function TransitionPanel({ action, id, transitions, holdParties }: {
  action: Act; id: string; transitions: { to: string; label: string; needsNote?: boolean }[]; holdParties?: Record<string, string>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [s, a] = useActionState(action, initialState);
  if (!transitions.length) return <p className="text-sm text-muted">لا إجراءات متاحة لك على الطلب في حالته الحالية.</p>;
  const danger = (to: string) => to === "cancelled" || to === "rejected";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {transitions.map((t) =>
          t.needsNote ? (
            <button key={t.to} type="button" aria-expanded={open === t.to} onClick={() => setOpen(open === t.to ? null : t.to)}
              className={cn("inline-flex h-10 items-center rounded-md px-3 text-[15px] font-medium", danger(t.to) ? "border border-critical/40 text-critical hover:bg-critical-soft" : "border border-line-strong bg-surface hover:bg-surface-2")}>
              {t.label}
            </button>
          ) : (
            <form key={t.to} action={a}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="to" value={t.to} />
              <SubmitButton size="md" variant={danger(t.to) ? "danger" : "primary"} pendingText="جارٍ التنفيذ…">{t.label}</SubmitButton>
            </form>
          ),
        )}
      </div>
      {open ? (
        <form action={a} className="space-y-3 rounded-lg border border-line bg-surface-2 p-3">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="to" value={open} />
          <Field label={open === "on_hold" ? "سبب التعليق" : "السبب أو الملاحظة"} name="note" required hint="تظهر للعميل في سجل الطلب.">
            <Textarea name="note" required minLength={3} className="min-h-20" />
          </Field>
          {open === "on_hold" && holdParties ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="بانتظار" name="holdParty" required>
                <Select name="holdParty" required options={Object.entries(holdParties).map(([value, label]) => ({ value, label }))} placeholder="اختر الجهة" />
              </Field>
              <Field label="تاريخ المتابعة" name="holdFollowUpOn">
                <Input name="holdFollowUpOn" type="date" dir="ltr" />
              </Field>
            </div>
          ) : null}
          <SubmitButton variant={danger(open) ? "danger" : "primary"} pendingText="جارٍ التنفيذ…">{transitions.find((t) => t.to === open)?.label}</SubmitButton>
        </form>
      ) : null}
      <FormMessage state={s} />
    </div>
  );
}

export function NoteForm({ action, id, staff }: { action: Act; id: string; staff?: boolean }) {
  return (
    <ActionForm action={action} hidden={{ id }} submit="أرسل" pendingText="جارٍ الإرسال…" size="md">
      <Field label={staff ? "رسالة أو ملاحظة" : "رسالتك إلى فريق وقفك"} name="body">
        <Textarea name="body" required minLength={2} className="min-h-24" />
      </Field>
      {staff ? (
        <fieldset className="flex flex-wrap gap-4 text-[15px]">
          <legend className="sr-only">من يرى الرسالة</legend>
          <label className="flex items-center gap-2"><input type="radio" name="visibility" value="internal" defaultChecked className="accent-[var(--ink)]" /> ملاحظة داخلية (للفريق فقط)</label>
          <label className="flex items-center gap-2"><input type="radio" name="visibility" value="client" className="accent-[var(--ink)]" /> رسالة للعميل</label>
        </fieldset>
      ) : null}
    </ActionForm>
  );
}

export function RatingForm({ action, id, current, comment }: { action: Act; id: string; current?: number | null; comment?: string | null }) {
  const [v, setV] = useState(current ?? 0);
  return (
    <ActionForm action={action} hidden={{ id, rating: String(v) }} submit={current ? "حدّث التقييم" : "أرسل التقييم"} size="md">
      <div role="radiogroup" aria-label="التقييم من 1 إلى 5" className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={v === n} aria-label={`${n} من 5`} onClick={() => setV(n)} className="rounded p-1 hover:bg-surface-2">
            <Star aria-hidden className={cn("size-7", n <= v ? "fill-seal text-seal" : "text-line-strong")} />
          </button>
        ))}
      </div>
      <Field label="تعليق (اختياري)" name="comment">
        <Textarea name="comment" defaultValue={comment ?? ""} className="min-h-20" />
      </Field>
    </ActionForm>
  );
}

/** E-signature with an OTP sent to the signer's phone (demo mode shows the code on screen). */
export function SignContractForm({ requestOtp, sign, contractId, partyKey = "", asLabel }: { requestOtp: Act; sign: Act; contractId: string; partyKey?: string; asLabel?: string }) {
  const [o, sendOtp] = useActionState(requestOtp, initialState);
  const [s, doSign] = useActionState(sign, initialState);
  const challengeId = (o.data?.challengeId as string) ?? "";
  if (s.ok) return <FormMessage state={s} />;
  return (
    <div className="space-y-4">
      {!challengeId ? (
        <form action={sendOtp} className="space-y-3">
          <input type="hidden" name="contractId" value={contractId} />
          <input type="hidden" name="partyKey" value={partyKey} />
          {asLabel ? <p className="text-[15px] font-medium">توقّع {asLabel}</p> : null}
          <p className="text-[15px] text-muted">التوقيع بالموافقة الموثقة: نرسل رمزًا إلى جوالك المسجل، وتحفظ المنصة بصمة نص العقد ووقت التوقيع وعنوان الجهاز.</p>
          <FormMessage state={o} />
          <SubmitButton variant="seal" pendingText="جارٍ الإرسال…">أرسل رمز التوقيع</SubmitButton>
        </form>
      ) : (
        <form action={doSign} className="space-y-3">
          <input type="hidden" name="contractId" value={contractId} />
          <input type="hidden" name="partyKey" value={partyKey} />
          <input type="hidden" name="challengeId" value={challengeId} />
          <p className="text-[15px] text-muted">أرسلنا رمزًا من 6 أرقام إلى <span dir="ltr" className="font-medium text-text">{String(o.data?.masked ?? "")}</span>. الرمز صالح 5 دقائق.</p>
          {o.data?.demoCode ? (
            <div className="rounded-md border border-dashed border-seal bg-seal-soft p-3 text-[15px]" role="note">
              <p className="font-semibold text-seal">وضع التجربة</p>
              <p>لم يُربط مزود الرسائل بعد، لذلك يظهر الرمز هنا: <span dir="ltr" data-testid="demo-otp" className="tabular font-bold tracking-[0.3em]">{String(o.data.demoCode)}</span></p>
            </div>
          ) : null}
          <Field label="رمز التوقيع" name="code" error={s.fieldErrors?.code}>
            <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} dir="ltr" required className="tabular max-w-56 text-center text-xl tracking-[0.4em]" />
          </Field>
          <Checkbox name="consent" required label="قرأت نص العقد كاملًا، وأوافق عليه، وأقر بأن هذا التوقيع الإلكتروني ملزم لي." />
          {s.fieldErrors?.consent ? <p className="text-[13px] text-critical">{s.fieldErrors.consent}</p> : null}
          <FormMessage state={s} />
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton variant="seal" pendingText="جارٍ التوقيع…">وقّع العقد</SubmitButton>
            <button type="button" onClick={() => window.location.reload()} className="text-[15px] text-ink underline-offset-4 hover:underline">طلب رمز جديد</button>
          </div>
        </form>
      )}
    </div>
  );
}

/** First step of a request: pick the waqf (or none) and open the draft. The rest of the form is the intake wizard. */
export function StartRequestForm({ action, service, rec, waqfs, defaultWaqf, allowNoWaqf }: {
  action: Act; service: string; rec?: string; waqfs: { id: string; name: string }[]; defaultWaqf?: string; allowNoWaqf: boolean;
}) {
  const [s, a] = useActionState(action, initialState);
  const options = [...waqfs.map((w) => ({ value: w.id, label: w.name })), ...(allowNoWaqf ? [{ value: "none", label: "لا يوجد وقف بعد (تأسيس أو وصية)" }] : [])];
  return (
    <form action={a} className="space-y-4">
      <input type="hidden" name="service" value={service} />
      <input type="hidden" name="rec" value={rec ?? ""} />
      <Field label="الوقف المعني بالطلب" name="waqf" required hint="تظهر الأوقاف التي تملك فيها صلاحية طلب الخدمات. تُرفق مستندات الطلب بملف الوقف المختار." error={s.fieldErrors?.waqf}>
        <Select name="waqf" required options={options} defaultValue={defaultWaqf ?? (options.length === 1 ? options[0].value : "")} placeholder="اختر الوقف" />
      </Field>
      <FormMessage state={s} />
      <SubmitButton size="lg" pendingText="جارٍ الفتح…">ابدأ نموذج الطلب</SubmitButton>
    </form>
  );
}

export function SandboxPayForm({ action, invoiceId, paymentId, cards }: { action: Act; invoiceId: string; paymentId: string; cards: { label: string; number: string }[] }) {
  const [s, a] = useActionState(action, initialState);
  const [num, setNum] = useState("");
  return (
    <form action={a} className="space-y-4">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="paymentId" value={paymentId} />
      <div className="rounded-md bg-surface-2 p-3 text-[13px]">
        <p className="mb-1 font-medium text-text">بطاقات الاختبار</p>
        <ul className="space-y-1">
          {cards.map((c) => (
            <li key={c.number} className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setNum(c.number)} className="tabular rounded border border-line bg-surface px-2 py-0.5 text-ink hover:bg-ink-soft" dir="ltr">{c.number}</button>
              <span className="text-muted">{c.label}</span>
            </li>
          ))}
        </ul>
      </div>
      <Field label="رقم البطاقة" name="card" error={s.fieldErrors?.card}>
        <Input name="card" inputMode="numeric" autoComplete="off" dir="ltr" value={num} onChange={(e) => setNum(e.target.value)} required className="tabular text-start" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="تاريخ الانتهاء" name="expiry" error={s.fieldErrors?.expiry}>
          <Input name="expiry" placeholder="12/29" dir="ltr" autoComplete="off" required className="tabular text-start" />
        </Field>
        <Field label="رمز التحقق CVC" name="cvc" error={s.fieldErrors?.cvc}>
          <Input name="cvc" inputMode="numeric" maxLength={3} dir="ltr" autoComplete="off" required className="tabular text-start" />
        </Field>
      </div>
      <FormMessage state={s} />
      <SubmitButton size="lg" className="w-full" pendingText="جارٍ المعالجة…">ادفع (تجريبي)</SubmitButton>
    </form>
  );
}

export function PrintButton({ label = "اطبع" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="inline-flex h-8 items-center gap-2 rounded-md border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-surface-2">
      {label}
    </button>
  );
}
