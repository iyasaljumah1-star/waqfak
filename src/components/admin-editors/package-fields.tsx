import { Input, Textarea } from "@/components/ui/form";
import { SIZE_OPTIONS } from "@/server/modules/admin/editors/pure";
import type { packages } from "@/server/db/schema";
import { EField, EFieldset } from "./editor-form";
import { CheckGroup, FieldGrid } from "./shell";

type Pkg = typeof packages.$inferSelect;

export function PackageFields({ p, services, items }: { p: Pkg | null; services: { id: string; code: string; nameAr: string; isActive: boolean }[]; items: { serviceId: string; note: string | null }[] }) {
  const sel = new Map(items.map((i) => [i.serviceId, i.note]));
  return (
    <div className="space-y-5">
      {p ? <input type="hidden" name="id" value={p.id} /> : null}
      <FieldGrid cols={3}>
        <EField label="الرمز" name="code" required hint="إنجليزي صغير، مثل governance."><Input name="code" dir="ltr" defaultValue={p?.code ?? ""} /></EField>
        <EField label="اسم الباقة" name="nameAr" required><Input name="nameAr" defaultValue={p?.nameAr ?? ""} /></EField>
        <EField label="الجمهور" name="audience"><Input name="audience" defaultValue={p?.audience ?? ""} placeholder="مثل: وقف متوسط" /></EField>
      </FieldGrid>
      <EField label="الوصف" name="description"><Textarea name="description" className="min-h-20" defaultValue={p?.description ?? ""} /></EField>
      <FieldGrid cols={3}>
        <EField label="السعر الشهري (ر.س)" name="monthlyPrice"><Input name="monthlyPrice" type="number" step="0.01" min={0} defaultValue={p?.monthlyPrice ?? ""} /></EField>
        <EField label="السعر السنوي (ر.س)" name="annualPrice"><Input name="annualPrice" type="number" step="0.01" min={0} defaultValue={p?.annualPrice ?? ""} /></EField>
        <EField label="الترتيب" name="position"><Input name="position" type="number" min={0} defaultValue={p?.position ?? 0} /></EField>
      </FieldGrid>
      <EFieldset legend="فئات الأوقاف المستهدفة" name="targetSizeClasses" hint="تُقترح الباقة في خطة العمل للأوقاف من هذه الفئات فقط. اتركها فارغة لكل الفئات.">
        <CheckGroup name="targetSizeClasses" options={SIZE_OPTIONS} selected={p?.targetSizeClasses ?? []} />
      </EFieldset>
      <EField label="الشروط" name="termsAr"><Textarea name="termsAr" className="min-h-20" defaultValue={p?.termsAr ?? ""} /></EField>
      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2"><input type="checkbox" name="isActive" defaultChecked={p?.isActive ?? true} className="size-4 accent-[var(--ink)]" /> مفعّلة</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="isClosed" defaultChecked={p?.isClosed ?? false} className="size-4 accent-[var(--ink)]" /> مغلقة (للأوقاف التي تنظرها وقفك فقط)</label>
      </div>
      <EFieldset legend="الخدمات المشمولة" name="services">
        <ul className="max-h-96 divide-y divide-line overflow-y-auto rounded-md border border-line">
          {services.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <label className="flex min-w-0 flex-1 items-center gap-2 text-[14px]">
                <input type="checkbox" name="services" value={s.id} defaultChecked={sel.has(s.id)} className="size-4 accent-[var(--ink)]" />
                <span dir="ltr" className="tabular w-10 shrink-0 text-muted">{s.code}</span>
                <span className="min-w-0">{s.nameAr}{s.isActive ? "" : " (موقوفة)"}</span>
              </label>
              <label className="sr-only" htmlFor={`note_${s.id}`}>ملاحظة {s.code}</label>
              <input id={`note_${s.id}`} name={`note_${s.id}`} defaultValue={sel.get(s.id) ?? ""} placeholder="ملاحظة (اختياري)" className="h-8 w-full rounded border border-line px-2 text-[13px] sm:w-56" />
            </li>
          ))}
        </ul>
      </EFieldset>
    </div>
  );
}
