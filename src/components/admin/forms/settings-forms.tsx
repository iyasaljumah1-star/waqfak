"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage, Input, SubmitButton, Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import { runRetention, saveCompanyProfile, saveGeneralSettings, saveLicense, saveRetention, setFeatureFlag } from "@/server/modules/admin/settings/actions";
import { COMPANY_FIELDS, GENERAL_SETTINGS, RETENTION_FIELDS, type RetentionPolicy } from "@/server/modules/admin/settings/defs";

export function CompanyForm({ values }: { values: Record<string, string> }) {
  const [s, action] = useActionState(saveCompanyProfile, {});
  const fe = s.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={s} />
      <div className="grid gap-4 sm:grid-cols-2">
        {COMPANY_FIELDS.map((f) => (
          <Field key={f.key} label={f.label} name={f.key} error={fe[f.key]} required={f.key === "nameAr"}>
            <Input name={f.key} defaultValue={values[f.key] ?? ""} dir={f.dir} type={f.type ?? "text"} error={fe[f.key]} />
          </Field>
        ))}
      </div>
      <SubmitButton>احفظ بيانات الشركة</SubmitButton>
    </form>
  );
}

export type LicenseView = { key: string; nameAr: string; issuer?: string; number?: string; expiresOn?: string; active?: boolean };

export function LicenseForm({ lic, today }: { lic: LicenseView; today: string }) {
  const [s, action] = useActionState(saveLicense, {});
  const [active, setActive] = useState(!!lic.active);
  const fe = s.fieldErrors ?? {};
  const expired = !!lic.expiresOn && lic.expiresOn <= today;
  const isNazara = lic.key === "gaa_nazara_license";
  return (
    <form action={action} className="space-y-3 rounded-lg border border-line p-4" noValidate>
      <input type="hidden" name="key" value={lic.key} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{lic.nameAr}</h3>
        <span className="flex gap-1">
          {lic.active ? <Badge tone={expired ? "critical" : "ok"}>{expired ? "مفعّل لكنه منتهٍ" : "مفعّل"}</Badge> : <Badge tone="neutral">غير مفعّل</Badge>}
        </span>
      </div>
      <FormMessage state={s} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="رقم الترخيص" name={`number-${lic.key}`} error={fe.number}>
          <Input name="number" id={`number-${lic.key}`} defaultValue={lic.number ?? ""} dir="ltr" error={fe.number} />
        </Field>
        <Field label="الجهة المصدرة" name={`issuer-${lic.key}`} error={fe.issuer}>
          <Input name="issuer" id={`issuer-${lic.key}`} defaultValue={lic.issuer ?? ""} error={fe.issuer} />
        </Field>
        <Field label="تاريخ الانتهاء" name={`expiresOn-${lic.key}`} error={fe.expiresOn}>
          <Input name="expiresOn" id={`expiresOn-${lic.key}`} type="date" defaultValue={lic.expiresOn ?? ""} dir="ltr" error={fe.expiresOn} />
        </Field>
      </div>
      <label className="flex items-start gap-3 text-[15px]">
        <input type="checkbox" name="active" checked={active} onChange={(e) => setActive(e.target.checked)} className="mt-1.5 size-4 accent-[var(--ink)]" />
        <span>الترخيص ساري ومفعّل{isNazara ? " (شرط لمباشرة النظارة على الأوقاف الحقيقية)" : ""}</span>
      </label>
      {isNazara ? (
        <p className="text-[13px] leading-6 text-muted">
          يحدد هذا الترخيص إمكان مباشرة «وقفك» النظارة على وقف حقيقي. طلبات تولي النظارة تُستقبل وتُدرس دائمًا، ويمكن تجربة المنظومة على الأوقاف التجريبية بلا ترخيص.
        </p>
      ) : null}
      <SubmitButton variant="secondary" size="sm">احفظ الترخيص</SubmitButton>
    </form>
  );
}

export type FlagView = { key: string; enabled: boolean; description: string; reason: string | null; updatedAt: string; updatedBy: string | null };

export function FlagRow({ flag }: { flag: FlagView }) {
  const [s, action] = useActionState(setFeatureFlag, {});
  const [open, setOpen] = useState(false);
  const fe = s.fieldErrors ?? {};
  const next = flag.enabled ? "off" : "on";
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{flag.description}</p>
          <p dir="ltr" className="text-end text-[12px] text-muted sm:text-start">{flag.key}</p>
          {flag.reason ? <p className="mt-1 text-[14px] text-muted">السبب: {flag.reason}</p> : null}
          <p className="text-[12px] text-muted">آخر تغيير: {flag.updatedAt}{flag.updatedBy ? ` — ${flag.updatedBy}` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={flag.enabled ? "ok" : "neutral"}>{flag.enabled ? "مفعّلة" : "موقوفة"}</Badge>
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm hover:bg-surface-2">
            {flag.enabled ? "أوقف" : "فعّل"}
          </button>
        </div>
      </div>
      {open || s.error || s.ok ? (
        <form action={action} className={cn("mt-3 space-y-2 rounded-md bg-surface-2 p-3", !open && s.ok && "hidden")} noValidate>
          <input type="hidden" name="key" value={flag.key} />
          <input type="hidden" name="enabled" value={next} />
          <FormMessage state={s} />
          <Field label={`سبب ${flag.enabled ? "الإيقاف" : "التفعيل"} (يظهر للفريق ويُحفظ في السجل)`} name={`reason-${flag.key}`} error={fe.reason} required>
            <Textarea name="reason" id={`reason-${flag.key}`} className="min-h-16" error={fe.reason} />
          </Field>
          <SubmitButton size="sm" variant={flag.enabled ? "danger" : "primary"}>{flag.enabled ? "أكّد الإيقاف" : "أكّد التفعيل"}</SubmitButton>
        </form>
      ) : null}
    </li>
  );
}

export function GeneralForm({ values }: { values: Record<string, number> }) {
  const [s, action] = useActionState(saveGeneralSettings, {});
  const fe = s.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={s} />
      <div className="grid gap-4 sm:grid-cols-2">
        {GENERAL_SETTINGS.map((g) => (
          <Field key={g.key} label={`${g.label} (${g.unit})`} name={g.key} hint={g.hint} error={fe[g.key]} required>
            <Input name={g.key} type="number" inputMode="decimal" dir="ltr" min={g.min} max={g.max} step={g.step ?? 1} defaultValue={values[g.key]} error={fe[g.key]} />
          </Field>
        ))}
      </div>
      <SubmitButton>احفظ الإعدادات</SubmitButton>
    </form>
  );
}

export function RetentionForm({ values }: { values: RetentionPolicy }) {
  const [s, action] = useActionState(saveRetention, {});
  const [r, run] = useActionState(runRetention, {});
  const fe = s.fieldErrors ?? {};
  return (
    <div className="space-y-6">
      <form action={action} className="space-y-4" noValidate>
        <FormMessage state={s} />
        <div className="grid gap-4 sm:grid-cols-2">
          {RETENTION_FIELDS.map((f) => (
            <Field key={f.key} label={`${f.label} (${f.unit})`} name={f.key} hint={f.hint} error={fe[f.key]} required>
              <Input name={f.key} type="number" dir="ltr" min={f.min} max={f.max} defaultValue={values[f.key]} error={fe[f.key]} />
            </Field>
          ))}
        </div>
        <SubmitButton>احفظ سياسة الاحتفاظ</SubmitButton>
      </form>
      <form action={run} className="space-y-2 border-t border-line pt-4">
        <p className="text-[15px]">يحذف التنفيذ ما تجاوز المدد أعلاه من الجلسات ورموز التحقق والرسائل الصادرة. التنفيذ يدوي من هنا حتى تُربط السياسة بالمهام اليومية المجدولة.</p>
        <FormMessage state={r} />
        <SubmitButton variant="secondary" pendingText="جارٍ التنفيذ…">نفّذ السياسة الآن</SubmitButton>
      </form>
    </div>
  );
}
