import { Input, Select, Textarea } from "@/components/ui/form";
import { SEVERITY_OPTIONS } from "@/server/modules/admin/editors/pure";
import type { criticalFlagDefs } from "@/server/db/schema";
import { EField } from "./editor-form";
import { FieldGrid } from "./shell";

type F = typeof criticalFlagDefs.$inferSelect;

export function FlagFields({ f, penalties }: { f: F | null; penalties: { code: string; titleAr: string }[] }) {
  return (
    <div className="space-y-5">
      {f ? <input type="hidden" name="code" value={f.code} /> : <input type="hidden" name="isNew" value="1" />}
      <FieldGrid cols={3}>
        {!f ? <EField label="الرمز" name="code" required><Input name="code" dir="ltr" placeholder="R15" /></EField> : null}
        <EField label="الخطورة" name="severity"><Select name="severity" defaultValue={f?.severity ?? "critical"} options={SEVERITY_OPTIONS} /></EField>
        <EField label="المحور المتأثر" name="axisCode" hint="يُحدّ المحور عند 39 حين ترتفع الإشارة."><Input name="axisCode" dir="ltr" defaultValue={f?.axisCode ?? ""} placeholder="A5" /></EField>
      </FieldGrid>
      <EField label="العنوان" name="titleAr" required><Input name="titleAr" defaultValue={f?.titleAr ?? ""} /></EField>
      <EField label="المرجع النظامي" name="referenceText" required><Input name="referenceText" defaultValue={f?.referenceText ?? ""} /></EField>
      <FieldGrid>
        <EField label="بند الجزاء" name="penaltyCode"><Select name="penaltyCode" defaultValue={f?.penaltyCode ?? ""} placeholder="لا يوجد" options={penalties.map((p) => ({ value: p.code, label: `${p.code} — ${p.titleAr.slice(0, 60)}` }))} /></EField>
        <EField label="وصف الجزاء" name="penaltyText"><Input name="penaltyText" defaultValue={f?.penaltyText ?? ""} /></EField>
      </FieldGrid>
      <EField label="الإجراء المطلوب" name="actionAr"><Textarea name="actionAr" className="min-h-20" defaultValue={f?.actionAr ?? ""} /></EField>
      <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={f?.active ?? true} className="size-4 accent-[var(--ink)]" /> مفعّلة (تُرفع في حساب التقييمات)</label>
    </div>
  );
}
