import { Input, Select, Textarea } from "@/components/ui/form";
import { IMPL_KIND_AR, IMPL_KINDS } from "@/server/modules/admin/editors/pure";
import type { penaltySchedule, regulatoryReferences, regulatoryRequirements } from "@/server/db/schema";
import { EField } from "./editor-form";
import { RowsEditor } from "./rows-editor";
import { FieldGrid } from "./shell";

const VER = [{ value: "verified", label: "متحقق منه" }, { value: "pending_verification", label: "بانتظار التحقق" }];
const AREAS = ["compliance", "assessment", "waqf", "finance", "governance", "beneficiaries", "documents", "requests", "reports", "establish", "privacy", "contracts", "billing", "authz", "settings", "security", "investment", "integrations", "scope", "launch"];

export function RequirementFields({ r, refs, suggestedCode }: { r: typeof regulatoryRequirements.$inferSelect | null; refs: { id: string; code: string; sourceName: string }[]; suggestedCode: string }) {
  return (
    <div className="space-y-5">
      {r ? <input type="hidden" name="id" value={r.id} /> : null}
      <FieldGrid cols={3}>
        <EField label="الرمز" name="code" required hint={r ? undefined : "الرمز التالي المتاح مقترح."}><Input name="code" dir="ltr" defaultValue={r?.code ?? suggestedCode} /></EField>
        <EField label="المصدر النظامي" name="referenceId"><Select name="referenceId" defaultValue={r?.referenceId ?? ""} placeholder="بلا مصدر (قرار داخلي)" options={refs.map((x) => ({ value: x.id, label: `${x.code} — ${x.sourceName}` }))} /></EField>
        <EField label="المادة" name="article" hint="مثل م14/2"><Input name="article" defaultValue={r?.article ?? ""} /></EField>
      </FieldGrid>
      <EField label="نص المتطلب" name="title" required><Textarea name="title" className="min-h-16" defaultValue={r?.title ?? ""} /></EField>
      <EField label="الوصف" name="description"><Textarea name="description" className="min-h-16" defaultValue={r?.description ?? ""} /></EField>
      <RowsEditor
        name="implementedAs"
        label="نُفّذ في المنصة بواسطة"
        initial={(r?.implementedAs ?? []) as never}
        addLabel="أضف بند تنفيذ"
        hint="للالتزام اكتب رمزه (OB-…)، وللقاعدة رمزها (R-…)، وللإشارة الحرجة رمزها (R01…). البنود تظهر في سجل التتبع وتُفحص صلاحيتها."
        columns={[
          { key: "kind", label: "النوع", type: "select", options: IMPL_KINDS.map((k) => ({ value: k, label: IMPL_KIND_AR[k] })), className: "basis-36 max-w-48" },
          { key: "ref", label: "المرجع", placeholder: "OB-GOV-03" },
        ]}
      />
      <FieldGrid cols={3}>
        <EField label="المجال" name="featureArea"><Select name="featureArea" defaultValue={r?.featureArea ?? "compliance"} placeholder="—" options={AREAS.map((a) => ({ value: a, label: a }))} /></EField>
        <EField label="حالة التنفيذ" name="status"><Select name="status" defaultValue={r?.status ?? "implemented"} options={[{ value: "implemented", label: "منفّذ" }, { value: "pending_verification", label: "بانتظار التحقق" }, { value: "planned", label: "مخطط" }, { value: "excluded", label: "مستبعد" }]} /></EField>
        <EField label="التحقق من النص" name="verificationStatus"><Select name="verificationStatus" defaultValue={r?.verificationStatus ?? "pending_verification"} options={VER} /></EField>
      </FieldGrid>
      <FieldGrid>
        <EField label="سبب الاستبعاد" name="exclusionReason" hint="مطلوب إن كانت الحالة «مستبعد»."><Input name="exclusionReason" defaultValue={r?.exclusionReason ?? ""} /></EField>
        <EField label="ملاحظات" name="notes"><Input name="notes" defaultValue={r?.notes ?? ""} /></EField>
      </FieldGrid>
    </div>
  );
}

export function ReferenceFields({ r, codes }: { r: typeof regulatoryReferences.$inferSelect | null; codes: string[] }) {
  return (
    <div className="space-y-5">
      {r ? <input type="hidden" name="id" value={r.id} /> : null}
      <FieldGrid cols={3}>
        <EField label="الرمز" name="code" required><Input name="code" dir="ltr" defaultValue={r?.code ?? ""} placeholder="NAZARA-REG" /></EField>
        <EField label="اسم المصدر" name="sourceName" required className="lg:col-span-2"><Input name="sourceName" defaultValue={r?.sourceName ?? ""} /></EField>
      </FieldGrid>
      <FieldGrid cols={3}>
        <EField label="الجهة المصدرة" name="issuer"><Input name="issuer" defaultValue={r?.issuer ?? ""} /></EField>
        <EField label="رقم القرار وتاريخه" name="decisionRef"><Input name="decisionRef" defaultValue={r?.decisionRef ?? ""} /></EField>
        <EField label="درجة الإلزام" name="bindingLevel"><Select name="bindingLevel" defaultValue={r?.bindingLevel ?? "binding"} options={[{ value: "binding", label: "ملزم" }, { value: "guidance", label: "إرشادي" }, { value: "draft", label: "مسودة" }, { value: "reference", label: "مرجعي" }]} /></EField>
      </FieldGrid>
      <FieldGrid cols={3}>
        <EField label="رابط المصدر الرسمي" name="sourceUrl"><Input name="sourceUrl" dir="ltr" type="url" defaultValue={r?.sourceUrl ?? ""} placeholder="https://" /></EField>
        <EField label="التحقق" name="verificationStatus"><Select name="verificationStatus" defaultValue={r?.verificationStatus ?? "pending_verification"} options={VER} /></EField>
        <EField label="تاريخ آخر تحقق" name="lastVerifiedOn"><Input name="lastVerifiedOn" type="date" defaultValue={r?.lastVerifiedOn ?? ""} /></EField>
      </FieldGrid>
      <FieldGrid>
        <EField label="حلّ محله" name="supersededBy" hint="المصدر الأحدث الذي يحل محل هذا."><Select name="supersededBy" defaultValue={r?.supersededBy ?? ""} placeholder="لا شيء" options={codes.filter((c) => c !== r?.code).map((c) => ({ value: c, label: c }))} /></EField>
        <EField label="ملاحظات" name="notes"><Input name="notes" defaultValue={r?.notes ?? ""} /></EField>
      </FieldGrid>
    </div>
  );
}

export function PenaltyFields({ p }: { p: typeof penaltySchedule.$inferSelect | null }) {
  return (
    <div className="space-y-5">
      {p ? <input type="hidden" name="id" value={p.id} /> : null}
      <FieldGrid cols={3}>
        <EField label="رمز البند" name="code" required><Input name="code" dir="ltr" defaultValue={p?.code ?? ""} placeholder="7-4" /></EField>
        <EField label="الفئة" name="category" required className="lg:col-span-2"><Input name="category" defaultValue={p?.category ?? ""} /></EField>
      </FieldGrid>
      <EField label="المخالفة" name="titleAr" required><Textarea name="titleAr" className="min-h-16" defaultValue={p?.titleAr ?? ""} /></EField>
      <FieldGrid cols={3}>
        <EField label="الجزاء — وقف كبير" name="largeText"><Input name="largeText" defaultValue={p?.largeText ?? ""} /></EField>
        <EField label="الجزاء — وقف متوسط" name="mediumText"><Input name="mediumText" defaultValue={p?.mediumText ?? ""} /></EField>
        <EField label="الجزاء — وقف صغير" name="smallText"><Input name="smallText" defaultValue={p?.smallText ?? ""} /></EField>
      </FieldGrid>
      <FieldGrid cols={3}>
        <EField label="خطر العزل" name="dismissalRisk"><Select name="dismissalRisk" defaultValue={p?.dismissalRisk ?? "no"} options={[{ value: "no", label: "لا" }, { value: "escalation", label: "بالتصعيد" }, { value: "after_notice", label: "بعد إنذار" }, { value: "immediate", label: "مباشر" }]} /></EField>
        <EField label="أعلى غرامة (ر.س)" name="maxFine"><Input name="maxFine" type="number" min={0} defaultValue={p?.maxFine ?? ""} /></EField>
        <EField label="التحقق" name="verificationStatus" hint="المبالغ تُطابق مع الأصل خلية خلية قبل اعتمادها."><Select name="verificationStatus" defaultValue={p?.verificationStatus ?? "pending_verification"} options={VER} /></EField>
      </FieldGrid>
      <EField label="ملاحظات" name="notes"><Input name="notes" defaultValue={p?.notes ?? ""} /></EField>
    </div>
  );
}
