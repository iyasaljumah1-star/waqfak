"use client";

import { useActionState, type ReactNode } from "react";
import { Checkbox, Field, FormMessage, Input, Select, SubmitButton } from "@/components/ui/form";
import { ASSET_BANDS } from "@/components/portal/labels";
import { initialState, NAZIR_MODE_LABEL, TYPE_LABEL } from "@/lib/utils";
import { registerWaqf } from "@/server/modules/waqf-core/actions";

const ROLE_OPTIONS = [
  { value: "nazir", label: "ناظر الوقف" },
  { value: "founder", label: "الواقف" },
  { value: "board_chair", label: "رئيس مجلس النظارة" },
  { value: "delegated_manager", label: "مفوَّض بالإدارة" },
  { value: "executive", label: "مدير تنفيذي للوقف" },
];

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="border-t border-line pt-6 first:border-t-0 first:pt-0">
      <legend className="float-start mb-1 w-full text-[17px] font-semibold text-ink">{title}</legend>
      {hint ? <p className="mb-4 text-sm text-muted">{hint}</p> : <div className="mb-4" />}
      <div className="clear-both grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function RegisterWaqfForm({ today }: { today: string }) {
  const [s, action] = useActionState(registerWaqf, initialState);
  const fe = s.fieldErrors ?? {};
  const v = ((s.data?.values ?? {}) as Record<string, string>);
  return (
    <form key={s.error ? JSON.stringify(v) : "f"} action={action} className="space-y-8 rounded-lg border border-line bg-surface p-4 md:p-6" noValidate>
      <Section title="الوقف وصكّه" hint="انقل البيانات كما وردت في صك الوقف. يمكنك استكمال الناقص لاحقًا من ملف الوقف.">
        <Field label="اسم الوقف" name="name" required error={fe.name} className="sm:col-span-2">
          <Input name="name" defaultValue={v.name} required maxLength={200} error={fe.name} placeholder="مثال: وقف آل فلان الخيري" />
        </Field>
        <Field label="رقم الصك" name="deedNo" error={fe.deedNo}>
          <Input name="deedNo" defaultValue={v.deedNo} dir="ltr" className="text-start" maxLength={60} error={fe.deedNo} />
        </Field>
        <Field label="تاريخ الصك (ميلادي)" name="deedDate" error={fe.deedDate}>
          <Input name="deedDate" defaultValue={v.deedDate} type="date" max={today} error={fe.deedDate} />
        </Field>
        <Field label="تاريخ الصك (هجري)" name="deedDateHijri" hint="اختياري، كما كُتب في الصك، مثل 1440/05/12." error={fe.deedDateHijri}>
          <Input name="deedDateHijri" defaultValue={v.deedDateHijri} dir="ltr" className="text-start" maxLength={40} error={fe.deedDateHijri} />
        </Field>
      </Section>

      <Section title="التوثيق والتسجيل" hint="من هذين التاريخين نحسب المواعيد النظامية المترتبة عليهما.">
        <Field label="تاريخ التوثيق" name="documentedOn" error={fe.documentedOn}>
          <Input name="documentedOn" defaultValue={v.documentedOn} type="date" max={today} error={fe.documentedOn} />
        </Field>
        <Field label="تاريخ التسجيل لدى الهيئة العامة للأوقاف" name="registeredOn" hint="اتركه فارغًا إن لم يُسجَّل بعد." error={fe.registeredOn}>
          <Input name="registeredOn" defaultValue={v.registeredOn} type="date" max={today} error={fe.registeredOn} />
        </Field>
        <Field label="الرقم الوطني الموحد" name="nationalUnifiedNumber" hint="اختياري. 10 أرقام تبدأ بـ 7." error={fe.nationalUnifiedNumber}>
          <Input name="nationalUnifiedNumber" defaultValue={v.nationalUnifiedNumber} dir="ltr" inputMode="numeric" className="text-start" maxLength={12} error={fe.nationalUnifiedNumber} />
        </Field>
      </Section>

      <Section title="التصنيف والنظارة">
        <Field label="نوع الوقف" name="legalType" required error={fe.legalType}>
          <Select name="legalType" defaultValue={v.legalType} required placeholder="اختر" error={fe.legalType} options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="صيغة النظارة" name="nazirMode" required error={fe.nazirMode}>
          <Select name="nazirMode" defaultValue={v.nazirMode} required placeholder="اختر" error={fe.nazirMode} options={Object.entries(NAZIR_MODE_LABEL).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="القيمة التقديرية للأصول" name="assetBand" required hint="تحدد فئة حجم الوقف (صغير، متوسط، كبير) وما يلزمه نظامًا." error={fe.assetBand} className="sm:col-span-2">
          <Select name="assetBand" defaultValue={v.assetBand} required placeholder="اختر الشريحة" error={fe.assetBand} options={ASSET_BANDS.map((b) => ({ value: b.value, label: b.label }))} />
        </Field>
      </Section>

      <Section title="صفتك والسنة المالية">
        <Field label="صفتك في الوقف" name="myRole" required hint="إدارة الأطراف والدعوات للناظر ورئيس المجلس. الواقف الناظر يأخذ الصفتين." error={fe.myRole}>
          <Select name="myRole" defaultValue={v.myRole} required placeholder="اختر" error={fe.myRole} options={ROLE_OPTIONS} />
        </Field>
        <Field label="نهاية السنة المالية" name="fiscalYearEnd" hint="الشهر-اليوم، مثل 12-31." error={fe.fiscalYearEnd}>
          <Input name="fiscalYearEnd" dir="ltr" className="text-start" defaultValue={v.fiscalYearEnd ?? "12-31"} pattern="\d{2}-\d{2}" maxLength={5} error={fe.fiscalYearEnd} />
        </Field>
      </Section>

      <fieldset className="border-t border-line pt-6">
        <legend className="float-start mb-1 w-full text-[17px] font-semibold text-ink">أوضاع تترتب عليها التزامات</legend>
        <p className="clear-both mb-3 text-sm text-muted">حدّد ما ينطبق الآن. يمكنك تعديلها لاحقًا من إعدادات الوقف.</p>
        <div className="space-y-1">
          <Checkbox name="collectsDonations" defaultChecked={v.collectsDonations === "on"} label="يجمع الوقف تبرعات من الغير" />
          <Checkbox name="hasForeignParty" defaultChecked={v.hasForeignParty === "on"} label="أحد أطرافه (واقف أو ناظر أو مستفيد حقيقي) غير سعودي أو مقيم خارج المملكة" />
          <Checkbox name="hasBeneficiariesAbroad" defaultChecked={v.hasBeneficiariesAbroad === "on"} label="له مستفيدون خارج المملكة" />
          <Checkbox name="hasActiveLitigation" defaultChecked={v.hasActiveLitigation === "on"} label="عليه أو له دعوى قضائية قائمة" />
        </div>
      </fieldset>

      <div className="space-y-3 border-t border-line pt-6">
        <FormMessage state={s} />
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingText="جارٍ فتح الملف…">افتح ملف الوقف</SubmitButton>
          <p className="text-[13px] text-muted">بالحفظ تقرّ بأن لك صفة في هذا الوقف. يُسجَّل الإجراء في سجل عمليات الوقف.</p>
        </div>
      </div>
    </form>
  );
}
