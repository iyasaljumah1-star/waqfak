import { Input, Select, Textarea } from "@/components/ui/form";
import { AUDIENCES, CONFLICT_RULES, PRICING_MODELS } from "@/server/modules/admin/editors/pure";
import type { services } from "@/server/db/schema";
import { EField, EFieldset } from "./editor-form";
import { CheckGroup, FieldGrid } from "./shell";

type Svc = typeof services.$inferSelect;
const DEPTS = [
  { value: "sharia", label: "شرعي" }, { value: "legal", label: "قانوني" }, { value: "finance", label: "مالي" },
  { value: "investment", label: "استثماري" }, { value: "governance", label: "حوكمة" }, { value: "operations", label: "تشغيل" },
];

/** Service editor fields (server-rendered inside the client EditorForm). */
export function ServiceFields({ s, cats, wfs }: { s: Partial<Svc> | null; cats: { id: string; nameAr: string; code: string }[]; wfs: { code: string; nameAr: string }[] }) {
  return (
    <div className="space-y-5">
      {s?.id ? <input type="hidden" name="id" value={s.id} /> : null}
      <FieldGrid cols={3}>
        <EField label="الرمز" name="code" required hint="مثل T01؛ يظهر في الروابط والتوصيات."><Input name="code" dir="ltr" defaultValue={s?.code ?? ""} required /></EField>
        <EField label="الفئة" name="categoryId" required><Select name="categoryId" defaultValue={s?.categoryId ?? ""} placeholder="اختر" options={cats.map((c) => ({ value: c.id, label: `${c.code} — ${c.nameAr}` }))} /></EField>
        <EField label="مرحلة رحلة الوقف" name="stage" hint="1 فكرة … 5 تطوير"><Input name="stage" type="number" min={1} max={5} defaultValue={s?.stage ?? ""} /></EField>
      </FieldGrid>
      <EField label="اسم الخدمة" name="nameAr" required><Input name="nameAr" defaultValue={s?.nameAr ?? ""} /></EField>
      <EField label="الملخص" name="summary" required><Textarea name="summary" className="min-h-20" defaultValue={s?.summary ?? ""} /></EField>
      <EField label="الوصف التفصيلي" name="description"><Textarea name="description" defaultValue={s?.description ?? ""} /></EField>
      <FieldGrid>
        <EField label="المتطلبات من العميل" name="requirements"><Textarea name="requirements" className="min-h-20" defaultValue={s?.requirements ?? ""} /></EField>
        <EField label="المخرجات" name="outputs"><Textarea name="outputs" className="min-h-20" defaultValue={s?.outputs ?? ""} /></EField>
      </FieldGrid>
      <FieldGrid cols={3}>
        <EField label="نموذج التسعير" name="pricingModel" required><Select name="pricingModel" defaultValue={s?.pricingModel ?? "quote"} options={PRICING_MODELS} /></EField>
        <EField label="السعر الأساسي (ر.س)" name="basePrice" hint="للأسعار حسب الفئة استخدم جدول الأسعار."><Input name="basePrice" type="number" step="0.01" min={0} defaultValue={s?.basePrice ?? ""} /></EField>
        <EField label="مدة الإنجاز (أيام)" name="slaDays"><Input name="slaDays" type="number" min={0} defaultValue={s?.slaDays ?? ""} /></EField>
      </FieldGrid>
      <EFieldset legend="الفئات المستهدفة" name="audiences">
        <CheckGroup name="audiences" options={AUDIENCES} selected={s?.audiences ?? []} />
      </EFieldset>
      <FieldGrid>
        <EField label="قاعدة التعارض" name="conflictRule" hint="تحجب الخدمة حين يتعارض دور وقفك في الوقف، حفاظًا على الاستقلال (لائحة النظارة م18/2، م15/4).">
          <Select name="conflictRule" defaultValue={s?.conflictRule ?? "none"} options={CONFLICT_RULES} />
        </EField>
        <EField label="الترخيص المطلوب" name="requiresLicenseKey" hint="مفتاح الترخيص في إعدادات الشركة، مثل gaa_nazara_license. تُحجب الخدمة حتى يُسجّل الترخيص.">
          <Input name="requiresLicenseKey" dir="ltr" defaultValue={s?.requiresLicenseKey ?? ""} />
        </EField>
        <EField label="قالب سير العمل" name="workflowTemplateCode" required><Select name="workflowTemplateCode" defaultValue={s?.workflowTemplateCode ?? "standard"} options={wfs.map((w) => ({ value: w.code, label: `${w.nameAr} (${w.code})` }))} /></EField>
        <EField label="القسم" name="departmentKey"><Select name="departmentKey" defaultValue={s?.departmentKey ?? ""} placeholder="—" options={DEPTS} /></EField>
        <EField label="دور المختص الافتراضي" name="defaultSpecialistRole"><Input name="defaultSpecialistRole" dir="ltr" defaultValue={s?.defaultSpecialistRole ?? ""} /></EField>
        <EField label="الترتيب" name="position"><Input name="position" type="number" min={0} defaultValue={s?.position ?? 0} /></EField>
      </FieldGrid>
      <EField label="القيود النظامية (تظهر للعميل)" name="regulatoryRestrictions"><Textarea name="regulatoryRestrictions" className="min-h-20" defaultValue={s?.regulatoryRestrictions ?? ""} /></EField>
      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2"><input type="checkbox" name="isActive" defaultChecked={s?.isActive ?? true} className="size-4 accent-[var(--ink)]" /> مفعّلة (تُطلب وتُقترح في التوصيات)</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="isPublished" defaultChecked={s?.isPublished ?? true} className="size-4 accent-[var(--ink)]" /> منشورة في الموقع العام</label>
      </div>
    </div>
  );
}
