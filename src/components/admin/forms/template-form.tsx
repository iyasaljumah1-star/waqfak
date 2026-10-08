"use client";

import { useActionState, useState } from "react";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui";
import { Field, FormMessage, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { saveTemplate } from "@/server/modules/admin/notifications/actions";

export type TemplateView = { key: string; titleAr: string; bodyAr: string; severity: string; channels: string[]; locked: boolean; updatedAt: string };

const SEV = [
  { value: "critical", label: "حرج" },
  { value: "important", label: "مهم" },
  { value: "info", label: "للعلم" },
];
const CH: Record<string, string> = { in_app: "داخل المنصة", email: "البريد", sms: "رسالة نصية" };

export function TemplateCard({ t }: { t: TemplateView }) {
  const [s, action] = useActionState(saveTemplate, {});
  const [open, setOpen] = useState(false);
  const fe = s.fieldErrors ?? {};
  const vars = [...new Set([...`${t.titleAr} ${t.bodyAr}`.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
  const has = (c: string) => t.channels.includes(c);
  return (
    <li className="rounded-lg border border-line bg-surface">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full flex-wrap items-start justify-between gap-2 px-4 py-3 text-start">
        <span className="min-w-0">
          <span className="block font-medium">{t.titleAr}</span>
          <span dir="ltr" className="block text-end text-[12px] text-muted sm:text-start">{t.key}</span>
        </span>
        <span className="flex flex-wrap gap-1">
          {t.locked ? <Badge tone="seal" icon={false}><Lock aria-hidden className="size-3" />مقفل</Badge> : null}
          <Badge tone={t.severity === "critical" ? "critical" : t.severity === "important" ? "fine" : "neutral"} icon={false}>{SEV.find((x) => x.value === t.severity)?.label}</Badge>
          {t.channels.map((c) => <Badge key={c} tone="neutral" icon={false}>{CH[c] ?? c}</Badge>)}
        </span>
      </button>
      {open ? (
        <form action={action} className="space-y-3 border-t border-line px-4 py-4" noValidate>
          <input type="hidden" name="key" value={t.key} />
          <FormMessage state={s} />
          {t.locked ? <p className="text-[13px] text-muted">قالب أمني أو نظامي: يمكن تحسين صياغته، ولا يمكن إيقاف قنواته أو خفض أهميته.</p> : null}
          <Field label="العنوان" name={`titleAr-${t.key}`} error={fe.titleAr} required>
            <Input name="titleAr" id={`titleAr-${t.key}`} defaultValue={t.titleAr} error={fe.titleAr} />
          </Field>
          <Field label="النص" name={`bodyAr-${t.key}`} error={fe.bodyAr} hint={vars.length ? `المتغيرات المتاحة: ${vars.map((v) => `{${v}}`).join("، ")}` : "لا متغيرات لهذا القالب."}>
            <Textarea name="bodyAr" id={`bodyAr-${t.key}`} defaultValue={t.bodyAr} className="min-h-20" error={fe.bodyAr} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="الأهمية" name={`severity-${t.key}`}>
              <Select name="severity" id={`severity-${t.key}`} defaultValue={t.severity} options={SEV} />
            </Field>
            <fieldset>
              <legend className="mb-1.5 text-[15px] font-medium">القنوات</legend>
              <div className="flex flex-wrap gap-4 text-[15px]">
                <label className="flex items-center gap-2 text-muted"><input type="checkbox" checked disabled className="size-4" />داخل المنصة (دائمًا)</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="email" defaultChecked={has("email")} disabled={t.locked && has("email")} className="size-4 accent-[var(--ink)]" />البريد</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="sms" defaultChecked={has("sms")} disabled={t.locked && has("sms")} className="size-4 accent-[var(--ink)]" />رسالة نصية</label>
                {/* disabled inputs are not submitted; keep locked channels on */}
                {t.locked && has("email") ? <input type="hidden" name="email" value="on" /> : null}
                {t.locked && has("sms") ? <input type="hidden" name="sms" value="on" /> : null}
              </div>
              <p className="mt-1 text-[12px] text-muted">الرسائل النصية والبريد لا تحمل بيانات حساسة: العنوان ورابط المنصة فقط.</p>
            </fieldset>
          </div>
          <div className="flex items-center justify-between gap-2">
            <SubmitButton size="sm">احفظ القالب</SubmitButton>
            <span className="text-[12px] text-muted">آخر تعديل: {t.updatedAt}</span>
          </div>
        </form>
      ) : null}
    </li>
  );
}
