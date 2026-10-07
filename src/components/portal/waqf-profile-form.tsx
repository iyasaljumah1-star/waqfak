"use client";

import Link from "next/link";
import { useActionState, type ReactNode } from "react";
import { Checkbox, Field, FormMessage, Input, Select, SubmitButton } from "@/components/ui/form";
import { initialState, NAZIR_MODE_LABEL, TYPE_LABEL } from "@/lib/utils";
import { updateWaqfProfile } from "@/server/modules/waqf-core/actions";
import { ASSET_BANDS } from "./labels";

export type WaqfProfileValues = {
  name: string;
  deedNo: string | null;
  deedDate: string | null;
  deedDateHijri: string | null;
  documentedOn: string | null;
  registeredOn: string | null;
  registrationExpiresOn: string | null;
  nationalUnifiedNumber: string | null;
  legalType: string | null;
  nazirMode: string | null;
  fiscalYearEnd: string;
  collectsDonations: boolean;
  hasForeignParty: boolean;
  hasBeneficiariesAbroad: boolean;
  hasActiveLitigation: boolean;
};

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="border-t border-line pt-5 first:border-t-0 first:pt-0">
      <legend className="float-start mb-1 w-full text-[15px] font-semibold text-ink">{title}</legend>
      {hint ? <p className="clear-both mb-3 text-[13px] text-muted">{hint}</p> : <div className="clear-both mb-3" />}
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

/** Core waqf profile: identity, deed, classification, and the facts that drive regulatory obligations. */
export function WaqfProfileForm({
  waqfId, values, sizeLabel, sizeLocked, today, cancelHref,
}: {
  waqfId: string;
  values: WaqfProfileValues;
  sizeLabel: string;
  sizeLocked: boolean;
  today: string;
  cancelHref: string;
}) {
  const [s, a] = useActionState(updateWaqfProfile, initialState);
  const fe = s.fieldErrors ?? {};
  const echo = (s.data?.values ?? null) as Record<string, string> | null;
  // After a failed submit React resets the form; re-fill from the echoed values, otherwise from the saved profile.
  const v = (k: keyof WaqfProfileValues) => (echo ? echo[k] ?? "" : ((values[k] as string | null) ?? ""));
  const flag = (k: keyof WaqfProfileValues) => (echo ? echo[k] === "on" : !!values[k]);
  return (
    <form key={echo ? JSON.stringify(echo) : "saved"} action={a} className="space-y-6" noValidate>
      <input type="hidden" name="waqfId" value={waqfId} />
      <Group title="الوقف وصكّه">
        <Field label="اسم الوقف" name="name" required error={fe.name} className="sm:col-span-2">
          <Input name="name" defaultValue={v("name")} required maxLength={200} error={fe.name} />
        </Field>
        <Field label="رقم الصك" name="deedNo" error={fe.deedNo}>
          <Input name="deedNo" defaultValue={v("deedNo")} dir="ltr" className="text-start" maxLength={60} error={fe.deedNo} />
        </Field>
        <Field label="تاريخ الصك (ميلادي)" name="deedDate" error={fe.deedDate}>
          <Input name="deedDate" type="date" max={today} defaultValue={v("deedDate")} error={fe.deedDate} />
        </Field>
        <Field label="تاريخ الصك (هجري)" name="deedDateHijri" hint="كما كُتب في الصك، مثل 1440/05/12." error={fe.deedDateHijri}>
          <Input name="deedDateHijri" defaultValue={v("deedDateHijri")} dir="ltr" className="text-start" maxLength={40} error={fe.deedDateHijri} />
        </Field>
      </Group>

      <Group title="التوثيق والتسجيل" hint="تغيير هذه التواريخ يعيد حساب المواعيد النظامية المترتبة عليها.">
        <Field label="تاريخ التوثيق" name="documentedOn" error={fe.documentedOn}>
          <Input name="documentedOn" type="date" max={today} defaultValue={v("documentedOn")} error={fe.documentedOn} />
        </Field>
        <Field label="تاريخ التسجيل لدى الهيئة" name="registeredOn" hint="اتركه فارغًا إن لم يُسجَّل بعد." error={fe.registeredOn}>
          <Input name="registeredOn" type="date" max={today} defaultValue={v("registeredOn")} error={fe.registeredOn} />
        </Field>
        <Field label="انتهاء شهادة التسجيل" name="registrationExpiresOn" error={fe.registrationExpiresOn}>
          <Input name="registrationExpiresOn" type="date" defaultValue={v("registrationExpiresOn")} error={fe.registrationExpiresOn} />
        </Field>
        <Field label="الرقم الوطني الموحد" name="nationalUnifiedNumber" hint="10 أرقام تبدأ بـ 7." error={fe.nationalUnifiedNumber}>
          <Input name="nationalUnifiedNumber" defaultValue={v("nationalUnifiedNumber")} dir="ltr" inputMode="numeric" className="text-start" maxLength={12} error={fe.nationalUnifiedNumber} />
        </Field>
      </Group>

      <Group title="التصنيف والنظارة">
        <Field label="نوع الوقف" name="legalType" required error={fe.legalType}>
          <Select name="legalType" required defaultValue={v("legalType")} placeholder="اختر" error={fe.legalType} options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="صيغة النظارة" name="nazirMode" required hint="تغييرها تغيير جوهري يلزم إبلاغ الهيئة به." error={fe.nazirMode}>
          <Select name="nazirMode" required defaultValue={v("nazirMode")} placeholder="اختر" error={fe.nazirMode} options={Object.entries(NAZIR_MODE_LABEL).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field
          label="القيمة التقديرية للأصول"
          name="assetBand"
          hint={sizeLocked ? `فئة الحجم (${sizeLabel}) مثبّتة من الإدارة ولا تتغير من هنا.` : `الفئة الحالية: ${sizeLabel}. اختر شريحة جديدة إن تغيرت قيمة الأصول.`}
          error={fe.assetBand}
        >
          <Select name="assetBand" placeholder="بدون تغيير" defaultValue={echo?.assetBand ?? ""} disabled={sizeLocked} options={ASSET_BANDS.map((b) => ({ value: b.value, label: b.label }))} />
        </Field>
        <Field label="نهاية السنة المالية" name="fiscalYearEnd" hint="الشهر-اليوم، مثل 12-31." error={fe.fiscalYearEnd}>
          <Input name="fiscalYearEnd" dir="ltr" className="text-start" defaultValue={v("fiscalYearEnd")} maxLength={5} error={fe.fiscalYearEnd} />
        </Field>
      </Group>

      <fieldset className="border-t border-line pt-5">
        <legend className="float-start mb-1 w-full text-[15px] font-semibold text-ink">أوضاع تترتب عليها التزامات</legend>
        <div className="clear-both space-y-1">
          <Checkbox name="collectsDonations" defaultChecked={flag("collectsDonations")} label="يجمع الوقف تبرعات من الغير" />
          <Checkbox name="hasForeignParty" defaultChecked={flag("hasForeignParty")} label="أحد أطرافه غير سعودي أو مقيم خارج المملكة" />
          <Checkbox name="hasBeneficiariesAbroad" defaultChecked={flag("hasBeneficiariesAbroad")} label="له مستفيدون خارج المملكة" />
          <Checkbox name="hasActiveLitigation" defaultChecked={flag("hasActiveLitigation")} label="عليه أو له دعوى قضائية قائمة" />
        </div>
      </fieldset>

      <div className="space-y-3 border-t border-line pt-5">
        <FormMessage state={s} />
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingText="جارٍ الحفظ…">احفظ وأعد حساب الالتزامات</SubmitButton>
          <Link href={cancelHref} className="text-sm text-muted hover:underline">إلغاء</Link>
        </div>
      </div>
    </form>
  );
}
