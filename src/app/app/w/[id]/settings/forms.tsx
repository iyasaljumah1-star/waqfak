"use client";

import { useActionState, useState } from "react";
import { Copy } from "lucide-react";
import { Checkbox, Field, FormMessage, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { ASSET_BANDS } from "@/components/portal/labels";
import { initialState, type ActionState } from "@/lib/utils";
import {
  changeMemberRole, createDelegation, endMembership, inviteMember, revokeDelegation, revokeInvitation, updateWaqfProfile,
} from "@/server/modules/waqf-core/actions";

type Opt = { value: string; label: string };

function Inline({ state }: { state: ActionState }) {
  if (!state.error && !state.message) return null;
  return <p role={state.error ? "alert" : "status"} className={state.error ? "text-[13px] text-critical" : "text-[13px] text-ok"}>{state.error ?? state.message}</p>;
}

export function MemberRoleForm({ waqfId, membershipId, roleKey, isIndependent, roles }: { waqfId: string; membershipId: string; roleKey: string; isIndependent: boolean; roles: Opt[] }) {
  const [s, a] = useActionState(changeMemberRole, initialState);
  return (
    <form action={a} className="space-y-1.5">
      <input type="hidden" name="waqfId" value={waqfId} />
      <input type="hidden" name="membershipId" value={membershipId} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`role-${membershipId}`}>الدور</label>
        <select id={`role-${membershipId}`} name="roleKey" defaultValue={roleKey} className="h-9 rounded-md border border-line-strong bg-surface px-2 text-sm">
          {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <label className="inline-flex items-center gap-1.5 text-sm">
          <input type="checkbox" name="isIndependent" defaultChecked={isIndependent} className="size-4 accent-[var(--ink)]" />
          مستقل
        </label>
        <SubmitButton size="sm" variant="secondary" pendingText="…">حفظ</SubmitButton>
      </div>
      <Inline state={s} />
    </form>
  );
}

export function EndMembershipForm({ waqfId, membershipId, name }: { waqfId: string; membershipId: string; name: string }) {
  const [s, a] = useActionState(endMembership, initialState);
  return (
    <form
      action={a}
      onSubmit={(e) => {
        if (!confirm(`إنهاء عضوية ${name}؟ يفقد الوصول إلى ملف الوقف فورًا.`)) e.preventDefault();
      }}
      className="space-y-1"
    >
      <input type="hidden" name="waqfId" value={waqfId} />
      <input type="hidden" name="membershipId" value={membershipId} />
      <SubmitButton size="sm" variant="ghost" className="text-critical" pendingText="…">إنهاء العضوية</SubmitButton>
      <Inline state={s} />
    </form>
  );
}

function DemoLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  const full = typeof window === "undefined" ? link : `${window.location.origin}${link}`;
  return (
    <div className="rounded-md border border-dashed border-seal bg-seal-soft p-3 text-[15px]" role="note">
      <p className="font-semibold text-seal">وضع التجربة</p>
      <p>لم يُربط مزود الرسائل بعد، لذلك يظهر رابط الدعوة هنا:</p>
      <div className="mt-1 flex items-center gap-2">
        <a data-testid="invite-link" href={link} dir="ltr" className="min-w-0 flex-1 truncate text-start text-ink underline">{full}</a>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(full).then(() => setCopied(true))}
          className="inline-flex shrink-0 items-center gap-1 text-sm text-ink"
        >
          <Copy aria-hidden className="size-4" />
          {copied ? "نُسخ" : "نسخ"}
        </button>
      </div>
    </div>
  );
}

export function InviteForm({ waqfId, roles }: { waqfId: string; roles: Opt[] }) {
  const [s, a] = useActionState(inviteMember, initialState);
  const link = typeof s.data?.link === "string" ? s.data.link : null;
  return (
    <form action={a} className="space-y-4">
      <input type="hidden" name="waqfId" value={waqfId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="رقم جوال المدعو" name="phone" required error={s.fieldErrors?.phone}>
          <Input name="phone" type="tel" inputMode="tel" dir="ltr" placeholder="05XXXXXXXX" className="text-start" required error={s.fieldErrors?.phone} />
        </Field>
        <Field label="الدور" name="roleKey" required error={s.fieldErrors?.roleKey}>
          <Select name="roleKey" required placeholder="اختر الدور" options={roles} error={s.fieldErrors?.roleKey} />
        </Field>
      </div>
      <Field label="رسالة قصيرة (اختياري)" name="note" hint="تظهر للمدعو في صفحة الدعوة.">
        <Input name="note" maxLength={300} />
      </Field>
      <FormMessage state={s} />
      {link ? <DemoLink link={link} /> : null}
      <SubmitButton pendingText="جارٍ الإرسال…">أرسل الدعوة</SubmitButton>
    </form>
  );
}

export function RevokeInvitationForm({ waqfId, invitationId }: { waqfId: string; invitationId: string }) {
  const [s, a] = useActionState(revokeInvitation, initialState);
  return (
    <form action={a} className="space-y-1">
      <input type="hidden" name="waqfId" value={waqfId} />
      <input type="hidden" name="invitationId" value={invitationId} />
      <SubmitButton size="sm" variant="ghost" className="text-critical" pendingText="…">إلغاء الدعوة</SubmitButton>
      <Inline state={s} />
    </form>
  );
}

export function DelegationForm({ waqfId, perms, today }: { waqfId: string; perms: Opt[]; today: string }) {
  const [s, a] = useActionState(createDelegation, initialState);
  const fe = s.fieldErrors ?? {};
  const v = (s.data?.values ?? {}) as Record<string, string | string[]>;
  const chosen = new Set([v.perm ?? []].flat());
  const link = typeof s.data?.link === "string" ? s.data.link : null;
  return (
    <form key={s.error ? JSON.stringify(v) : s.ok ? "ok" : "f"} action={a} className="space-y-4">
      <input type="hidden" name="waqfId" value={waqfId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="رقم جوال الوكيل" name="phone" required hint="إن لم يكن مسجّلًا نرسل إليه دعوة، وتبدأ الوكالة عند قبوله." error={fe.phone}>
          <Input name="phone" type="tel" inputMode="tel" dir="ltr" placeholder="05XXXXXXXX" className="text-start" required defaultValue={v.phone as string} error={fe.phone} />
        </Field>
        <Field label="رقم الوكالة" name="poaNo" required hint="كما في صك الوكالة الصادر من الجهة المختصة." error={fe.poaNo}>
          <Input name="poaNo" dir="ltr" className="text-start" required defaultValue={v.poaNo as string} error={fe.poaNo} />
        </Field>
        <Field label="تبدأ في" name="validFrom" required error={fe.validFrom}>
          <Input name="validFrom" type="date" required defaultValue={(v.validFrom as string) ?? today} error={fe.validFrom} />
        </Field>
        <Field label="تنتهي في" name="validTo" required error={fe.validTo}>
          <Input name="validTo" type="date" min={today} required defaultValue={v.validTo as string} error={fe.validTo} />
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1 text-[15px] font-medium">نطاق الوكالة</legend>
        <p className="mb-2 text-[13px] text-muted">لا يتجاوز نطاق الوكيل هذه القائمة مهما اتسعت الوكالة، ويتقيد بما تحدده هنا.</p>
        <div className="grid gap-x-6 sm:grid-cols-2">
          {perms.map((p) => (
            <Checkbox key={p.value} name="perm" value={p.value} label={p.label} defaultChecked={chosen.size ? chosen.has(p.value) : p.value === "waqf.view"} />
          ))}
        </div>
        {fe.perm ? <p className="text-[13px] font-medium text-critical">{fe.perm}</p> : null}
      </fieldset>
      <Field label="ملاحظات" name="notes" error={fe.notes}>
        <Textarea name="notes" maxLength={500} defaultValue={v.notes as string} className="min-h-20" />
      </Field>
      <FormMessage state={s} />
      {link ? <DemoLink link={link} /> : null}
      <SubmitButton pendingText="جارٍ الحفظ…">سجّل الوكالة</SubmitButton>
    </form>
  );
}

export function RevokeDelegationForm({ waqfId, delegationId }: { waqfId: string; delegationId: string }) {
  const [s, a] = useActionState(revokeDelegation, initialState);
  return (
    <form
      action={a}
      onSubmit={(e) => {
        if (!confirm("إلغاء الوكالة؟ يُغلق وصول الوكيل فورًا.")) e.preventDefault();
      }}
      className="space-y-1"
    >
      <input type="hidden" name="waqfId" value={waqfId} />
      <input type="hidden" name="delegationId" value={delegationId} />
      <SubmitButton size="sm" variant="ghost" className="text-critical" pendingText="…">إلغاء الوكالة</SubmitButton>
      <Inline state={s} />
    </form>
  );
}

export function WaqfProfileForm({
  waqfId, fiscalYearEnd, flags, sizeLabel, sizeLocked,
}: {
  waqfId: string;
  fiscalYearEnd: string;
  flags: { collectsDonations: boolean; hasForeignParty: boolean; hasBeneficiariesAbroad: boolean; hasActiveLitigation: boolean };
  sizeLabel: string;
  sizeLocked: boolean;
}) {
  const [s, a] = useActionState(updateWaqfProfile, initialState);
  return (
    <form action={a} className="space-y-4">
      <input type="hidden" name="waqfId" value={waqfId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="نهاية السنة المالية" name="fiscalYearEnd" hint="الشهر-اليوم، مثل 12-31." error={s.fieldErrors?.fiscalYearEnd}>
          <Input name="fiscalYearEnd" dir="ltr" className="text-start" defaultValue={fiscalYearEnd} maxLength={5} error={s.fieldErrors?.fiscalYearEnd} />
        </Field>
        <Field
          label="القيمة التقديرية للأصول"
          name="assetBand"
          hint={sizeLocked ? `فئة الحجم (${sizeLabel}) مثبّتة من الإدارة ولا تتغير من هنا.` : `الفئة الحالية: ${sizeLabel}. اختر شريحة جديدة إن تغيرت قيمة الأصول.`}
          error={s.fieldErrors?.assetBand}
        >
          <Select name="assetBand" placeholder="بدون تغيير" disabled={sizeLocked} options={ASSET_BANDS.map((b) => ({ value: b.value, label: b.label }))} />
        </Field>
      </div>
      <div className="space-y-1">
        <Checkbox name="collectsDonations" defaultChecked={flags.collectsDonations} label="يجمع الوقف تبرعات من الغير" />
        <Checkbox name="hasForeignParty" defaultChecked={flags.hasForeignParty} label="أحد أطرافه غير سعودي أو مقيم خارج المملكة" />
        <Checkbox name="hasBeneficiariesAbroad" defaultChecked={flags.hasBeneficiariesAbroad} label="له مستفيدون خارج المملكة" />
        <Checkbox name="hasActiveLitigation" defaultChecked={flags.hasActiveLitigation} label="عليه أو له دعوى قضائية قائمة" />
      </div>
      <FormMessage state={s} />
      <SubmitButton>احفظ وأعد حساب الالتزامات</SubmitButton>
    </form>
  );
}
