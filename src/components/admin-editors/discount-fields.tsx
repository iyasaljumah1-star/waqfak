import { Input, Select } from "@/components/ui/form";
import type { discounts } from "@/server/db/schema";
import { EField, EFieldset } from "./editor-form";
import { CheckGroup, FieldGrid } from "./shell";

type Disc = typeof discounts.$inferSelect;

export function DiscountFields({ d, services, packages }: { d: Disc | null; services: { code: string; nameAr: string }[]; packages: { code: string; nameAr: string }[] }) {
  return (
    <div className="space-y-5">
      {d ? <input type="hidden" name="id" value={d.id} /> : null}
      <FieldGrid cols={3}>
        <EField label="رمز الخصم" name="code" required hint="يكتبه العميل عند الطلب، مثل RAMADAN26."><Input name="code" dir="ltr" defaultValue={d?.code ?? ""} /></EField>
        <EField label="النوع" name="kind" required><Select name="kind" defaultValue={d?.kind ?? "percent"} options={[{ value: "percent", label: "نسبة مئوية" }, { value: "fixed", label: "مبلغ ثابت (ر.س)" }]} /></EField>
        <EField label="القيمة" name="value" required><Input name="value" type="number" step="0.01" min={0} defaultValue={d?.value ?? ""} /></EField>
        <EField label="يسري من" name="validFrom"><Input name="validFrom" type="date" defaultValue={d?.validFrom ?? ""} /></EField>
        <EField label="حتى" name="validTo"><Input name="validTo" type="date" defaultValue={d?.validTo ?? ""} /></EField>
        <EField label="الحد الأقصى للاستخدام" name="maxUses" hint={d ? `استُخدم ${d.uses} مرة.` : "اتركه فارغًا بلا حد."}><Input name="maxUses" type="number" min={1} defaultValue={d?.maxUses ?? ""} /></EField>
      </FieldGrid>
      <EFieldset legend="يُطبق على الخدمات" name="services" hint="اترك الخدمات والباقات فارغة ليُطبق على الجميع.">
        <div className="max-h-48 overflow-y-auto rounded-md border border-line p-3">
          <CheckGroup name="services" options={services.map((s) => ({ value: s.code, label: `${s.code} ${s.nameAr}` }))} selected={d?.appliesTo?.services ?? []} />
        </div>
      </EFieldset>
      <EFieldset legend="يُطبق على الباقات" name="packages">
        <CheckGroup name="packages" options={packages.map((p) => ({ value: p.code, label: p.nameAr }))} selected={d?.appliesTo?.packages ?? []} />
      </EFieldset>
      <label className="flex items-center gap-2"><input type="checkbox" name="isActive" defaultChecked={d?.isActive ?? true} className="size-4 accent-[var(--ink)]" /> مفعّل</label>
    </div>
  );
}
