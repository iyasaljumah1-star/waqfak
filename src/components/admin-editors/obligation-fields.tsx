import { Input, Select, Textarea } from "@/components/ui/form";
import {
  AUTHORITIES, LEGAL_TYPE_OPTIONS, OBLIGATION_TYPES, OFFSET_UNITS, SEVERITY_OPTIONS, SIZE_OPTIONS, TRIGGER_EVENTS, WAQF_BOOL_FLAGS, WAQF_FACT_KEYS,
} from "@/server/modules/admin/editors/pure";
import { AUTHORITY_AR, CATEGORY_AR, FACT_LABEL, type ObligationConfig } from "@/server/modules/compliance/pure";
import { eventLabel } from "@/server/modules/compliance/engine";
import type { obligations } from "@/server/db/schema";
import { EField, EFieldset } from "./editor-form";
import { LogicField } from "./logic-field";
import { RowsEditor } from "./rows-editor";
import { CheckGroup, FieldGrid } from "./shell";

type O = typeof obligations.$inferSelect;
const ROLES = [
  { value: "nazir", label: "الناظر" }, { value: "board_chair", label: "رئيس مجلس النظارة" }, { value: "board_secretary", label: "أمين سر المجلس" },
  { value: "executive", label: "المدير التنفيذي" }, { value: "delegated_manager", label: "المفوّض بالإدارة" },
];
const SCOPES = [{ value: "all_open", label: "كل المفتوح" }, { value: "other_periods", label: "الفترات الأخرى" }, { value: "earliest_open", label: "الأقدم فقط" }];

export function ObligationFields({ o, reqs, pens }: { o: O | null; reqs: { id: string; code: string; title: string }[]; pens: { code: string; titleAr: string }[] }) {
  const cfg = (o?.appliesTo ?? {}) as ObligationConfig;
  const flags = WAQF_BOOL_FLAGS.map((f) => ({ value: f, label: FACT_LABEL[f] ?? (f === "hasActiveLitigation" ? "نزاع قضائي قائم" : f) }));
  const events = TRIGGER_EVENTS.map((e) => ({ value: e, label: `${eventLabel(e)} (${e})` }));
  const closes = (cfg.closesOn ?? []).map((c) => (typeof c === "string" ? { event: c, scope: "all_open" } : { event: c.event, scope: c.scope ?? "all_open" }));
  return (
    <div className="space-y-6">
      {o ? <input type="hidden" name="id" value={o.id} /> : null}
      <section className="space-y-4" aria-labelledby="ob-id">
        <h3 id="ob-id" className="font-semibold text-ink">التعريف والمرجع</h3>
        <FieldGrid cols={3}>
          <EField label="الرمز" name="code" required hint="مثل OB-GOV-03."><Input name="code" dir="ltr" defaultValue={o?.code ?? ""} /></EField>
          <EField label="الفئة" name="obligationType" required><Select name="obligationType" defaultValue={o?.obligationType ?? "governance"} options={OBLIGATION_TYPES.map((t) => ({ value: t, label: CATEGORY_AR[t] ?? t }))} /></EField>
          <EField label="الجهة" name="authority" required><Select name="authority" defaultValue={o?.authority ?? "gaa"} options={AUTHORITIES.map((a) => ({ value: a, label: AUTHORITY_AR[a] ?? a }))} /></EField>
        </FieldGrid>
        <EField label="عنوان الالتزام" name="titleAr" required><Input name="titleAr" defaultValue={o?.titleAr ?? ""} /></EField>
        <EField label="الوصف" name="description"><Textarea name="description" className="min-h-16" defaultValue={o?.description ?? ""} /></EField>
        <FieldGrid>
          <EField label="المتطلب النظامي" name="requirementId" hint="يربط الالتزام بسجل تتبع المتطلبات.">
            <Select name="requirementId" defaultValue={o?.requirementId ?? ""} placeholder="بلا ربط" options={reqs.map((r) => ({ value: r.id, label: `${r.code} — ${r.title.slice(0, 70)}` }))} />
          </EField>
          <EField label="المرجع (المصدر والمادة)" name="referenceText" required><Input name="referenceText" defaultValue={o?.referenceText ?? ""} placeholder="لائحة تنظيم أعمال النظارة م14/2" /></EField>
        </FieldGrid>
      </section>

      <section className="space-y-4 border-t border-line pt-5" aria-labelledby="ob-when">
        <h3 id="ob-when" className="font-semibold text-ink">متى ينشأ وموعده</h3>
        <FieldGrid cols={3}>
          <EField label="الحدث المنشئ" name="triggerEvent" required hint="«التزام دائم» يُنشأ لكل وقف موثّق منطبق فور الحفظ."><Select name="triggerEvent" defaultValue={o?.triggerEvent ?? "standing"} options={events} /></EField>
          <EField label="التكرار" name="recurrence"><Select name="recurrence" defaultValue={o?.recurrence ?? "none"} options={[{ value: "none", label: "مرة لكل حدث" }, { value: "annual", label: "سنوي (مع نهاية السنة المالية)" }]} /></EField>
          <div className="grid grid-cols-2 gap-2">
            <EField label="المهلة" name="offsetValue"><Input name="offsetValue" type="number" min={0} defaultValue={o?.offsetValue ?? ""} /></EField>
            <EField label="الوحدة" name="offsetUnit" required><Select name="offsetUnit" defaultValue={o?.offsetUnit ?? "none"} options={OFFSET_UNITS} /></EField>
          </div>
        </FieldGrid>
        <FieldGrid cols={3}>
          <EField label="التذكير قبل الموعد (أيام)" name="reminderOffsetsDays" hint="مفصولة بفواصل، مثل 30، 7، 1."><Input name="reminderOffsetsDays" dir="ltr" defaultValue={(o?.reminderOffsetsDays ?? [30, 7, 1]).join(", ")} /></EField>
          <EField label="المسؤول الافتراضي" name="defaultAssigneeRole"><Select name="defaultAssigneeRole" defaultValue={o?.defaultAssigneeRole ?? "nazir"} options={ROLES} /></EField>
          <EField label="الخطورة" name="severity"><Select name="severity" defaultValue={o?.severity ?? "medium"} options={SEVERITY_OPTIONS} /></EField>
        </FieldGrid>
        <RowsEditor
          name="closesOn"
          label="أحداث تُغلق الالتزام تلقائيًا"
          initial={closes}
          addLabel="أضف حدث إغلاق"
          hint="مثل: التسجيل يُغلق التزام «تسجيل الوقف». «الفترات الأخرى» تُغلق القديم حين يتجدد الحدث."
          columns={[{ key: "event", label: "الحدث", type: "select", options: events }, { key: "scope", label: "النطاق", type: "select", options: SCOPES }]}
        />
      </section>

      <section className="space-y-4 border-t border-line pt-5" aria-labelledby="ob-who">
        <h3 id="ob-who" className="font-semibold text-ink">على من ينطبق</h3>
        <p className="text-[14px] text-muted">تُجمع الشروط كلها (و). اترك المجموعة فارغة لتنطبق على الجميع. عاين الانطباق قبل الحفظ.</p>
        <FieldGrid>
          <EFieldset legend="فئات الحجم" name="sizeClasses"><CheckGroup name="sizeClasses" options={SIZE_OPTIONS} selected={cfg.sizeClasses ?? []} /></EFieldset>
          <EFieldset legend="النوع النظامي" name="legalTypes"><CheckGroup name="legalTypes" options={LEGAL_TYPE_OPTIONS} selected={cfg.legalTypes ?? []} /></EFieldset>
          <EFieldset legend="يشترط أن يكون" name="requiresFlags"><CheckGroup name="requiresFlags" options={flags} selected={cfg.requiresFlags ?? []} /></EFieldset>
          <EFieldset legend="يُستثنى إن كان" name="excludesFlags"><CheckGroup name="excludesFlags" options={flags} selected={cfg.excludesFlags ?? []} /></EFieldset>
        </FieldGrid>
        <LogicField
          name="rule"
          label="قاعدة انطباق إضافية (JSON-logic على بيانات الوقف)"
          defaultValue={cfg.rule ?? null}
          knownVars={WAQF_FACT_KEYS}
          hint={`الحقائق المتاحة: ${WAQF_FACT_KEYS.join("، ")}.`}
          examples={[
            { label: "الأوقاف الكبيرة", value: { "==": [{ var: "sizeClass" }, "large"] } },
            { label: "مجلس نظارة", value: { "==": [{ var: "nazirMode" }, "board"] } },
            { label: "مستفيدون > 50", value: { ">": [{ var: "beneficiaryCount" }, 50] } },
          ]}
        />
        <LogicField
          name="satisfiedWhen"
          label="يُعد مستوفى حين (اختياري)"
          defaultValue={cfg.satisfiedWhen ?? null}
          knownVars={WAQF_FACT_KEYS}
          hint="إن تحقق الشرط يُسجّل الالتزام منجزًا من بيانات الوقف دون إجراء، مثل {&quot;!!&quot;: {&quot;var&quot;: &quot;registered&quot;}}."
        />
      </section>

      <section className="space-y-4 border-t border-line pt-5" aria-labelledby="ob-do">
        <h3 id="ob-do" className="font-semibold text-ink">الإجراء والدليل والجزاء</h3>
        <EField label="الإجراء المطلوب" name="requiredAction" required><Textarea name="requiredAction" className="min-h-20" defaultValue={o?.requiredAction ?? ""} /></EField>
        <FieldGrid>
          <EField label="الدليل المطلوب للإغلاق" name="evidenceRequired"><Input name="evidenceRequired" defaultValue={o?.evidenceRequired ?? ""} placeholder="محضر الاجتماع المعتمد" /></EField>
          <EField label="بند الجزاء (جدول المخالفات)" name="penaltyCode"><Select name="penaltyCode" defaultValue={o?.penaltyCode ?? ""} placeholder="لا يوجد" options={pens.map((p) => ({ value: p.code, label: `${p.code} — ${p.titleAr.slice(0, 60)}` }))} /></EField>
        </FieldGrid>
      </section>

      <section className="space-y-4 border-t border-line pt-5" aria-labelledby="ob-st">
        <h3 id="ob-st" className="font-semibold text-ink">الحالة</h3>
        <FieldGrid cols={3}>
          <EField label="حالة التعريف" name="status" hint="المنشور فقط يُطبّق على الأوقاف. «متقاعد» يُوقف الاستحقاقات المفتوحة."><Select name="status" defaultValue={o?.status ?? "published"} options={[{ value: "published", label: "منشور (يُطبّق)" }, { value: "draft", label: "مسودة" }, { value: "retired", label: "متقاعد" }]} /></EField>
          <EField label="التحقق من المصدر" name="verificationStatus" hint="«بانتظار التحقق» يعمل ويظهر بعلامة للمستخدم."><Select name="verificationStatus" defaultValue={o?.verificationStatus ?? "pending_verification"} options={[{ value: "verified", label: "متحقق منه" }, { value: "pending_verification", label: "بانتظار التحقق" }]} /></EField>
          <EField label="ملاحظات داخلية" name="notes"><Input name="notes" defaultValue={o?.notes ?? ""} /></EField>
        </FieldGrid>
      </section>
    </div>
  );
}
