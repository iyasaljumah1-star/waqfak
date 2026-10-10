import { Input, Select, Textarea } from "@/components/ui/form";
import { SEVERITY_OPTIONS } from "@/server/modules/admin/editors/pure";
import type { recommendationRules } from "@/server/db/schema";
import { EField, EFieldset } from "./editor-form";
import { LogicField } from "./logic-field";
import { FieldGrid } from "./shell";

type R = typeof recommendationRules.$inferSelect;

export const FACT_HINT =
  "الحقائق: مفتاح كل سؤال (مثل has_bank_account)، score_<رمز السؤال> من 0 إلى 5، axis_A1…A11 من 0 إلى 100، flag_R01… للإشارات الحرجة، size_class، computed_type، nazir_kind، waqf_state، waqfak_role.";

/** Rule editor fields plus the live test inputs (facts JSON or a demo assessment). */
export function RuleFields({ r, isNew, readOnly, needs, services, assessments }: {
  r: Partial<R> | null;
  isNew: boolean;
  readOnly?: boolean;
  needs: { code: string; titleAr: string; groupCode: string }[];
  services: { code: string; nameAr: string; isActive: boolean }[];
  assessments: { id: string; label: string }[];
}) {
  const sel = new Set(r?.serviceCodes ?? []);
  return (
    <div className="space-y-6">
      <fieldset className="space-y-5">
        {readOnly ? <p className="rounded-md bg-surface-2 px-3 py-2 text-[14px] text-muted">هذا الإصدار منشور وثابت. غيّر الحقول هنا لتجربة بدائل في لوحة الاختبار دون حفظها.</p> : null}
        {r?.id ? <input type="hidden" name="ruleId" value={r.id} /> : null}
        {!isNew ? <input type="hidden" name="code" value={r?.code ?? ""} /> : null}
        <FieldGrid cols={3}>
          {isNew ? <EField label="رمز القاعدة" name="code" required hint="R-مجموعة-رقم، مثل R-FIN-020."><Input name="code" dir="ltr" defaultValue={r?.code ?? ""} /></EField> : null}
          <EField label="الاحتياج" name="needCode" required className={isNew ? "lg:col-span-2" : "lg:col-span-3"}>
            <Select name="needCode" defaultValue={r?.needCode ?? ""} placeholder="اختر" options={needs.map((n) => ({ value: n.code, label: `${n.code} — ${n.titleAr}` }))} />
          </EField>
        </FieldGrid>
        <EField label="عنوان التوصية" name="titleAr" required><Input name="titleAr" defaultValue={r?.titleAr ?? ""} /></EField>
        <LogicField
          name="condition"
          label="شرط القاعدة (JSON-logic على حقائق التقييم)"
          optional={false}
          defaultValue={r?.condition ?? null}
          rows={7}
          hint={FACT_HINT}
          examples={[
            { label: "لا حساب بنكي", value: { in: [{ var: "has_bank_account" }, ["no", "unknown"]] } },
            { label: "وقف كبير + إشارة R11", value: { and: [{ "==": [{ var: "size_class" }, "large"] }, { var: "flag_R11" }] } },
          ]}
        />
        <FieldGrid cols={3}>
          <EField label="الخطورة" name="severity" required hint="حرج 10 · مرتفع 6 · متوسط 3 · منخفض 1"><Select name="severity" defaultValue={r?.severity ?? "medium"} options={SEVERITY_OPTIONS} /></EField>
          <EField label="الاستعجال (أيام)" name="urgencyDays" required hint="≤30 يضاعف ×3، ≤90 ×2"><Input name="urgencyDays" type="number" min={0} max={3650} defaultValue={r?.urgencyDays ?? 90} /></EField>
          <EField label="الرافعة" name="leverage" required hint="الأولوية = الخطورة × الاستعجال × الرافعة"><Input name="leverage" type="number" step="0.05" min={0.1} max={5} defaultValue={r?.leverage ?? "1"} /></EField>
        </FieldGrid>
        <EField label="السبب كما يراه العميل" name="reasonAr" required><Textarea name="reasonAr" className="min-h-20" defaultValue={r?.reasonAr ?? ""} /></EField>
        <FieldGrid>
          <EField label="لماذا يهم" name="whyItMattersAr"><Textarea name="whyItMattersAr" className="min-h-20" defaultValue={r?.whyItMattersAr ?? ""} /></EField>
          <EField label="ما يمكنك فعله بنفسك" name="selfServiceHintAr"><Textarea name="selfServiceHintAr" className="min-h-20" defaultValue={r?.selfServiceHintAr ?? ""} /></EField>
        </FieldGrid>
        <EField label="المرجع النظامي" name="reference" hint="يُستخدم أيضًا في سجل تتبع المتطلبات (المصدر + المادة)."><Input name="reference" defaultValue={r?.reference ?? ""} /></EField>
        <EFieldset legend="الخدمات المرتبطة" name="serviceCodes" hint="تُحذف آليًا عند التعارض أو غياب الترخيص أو وجود طلب مفتوح.">
          <div className="max-h-56 overflow-y-auto rounded-md border border-line p-3">
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {services.map((s) => (
                <label key={s.code} className="flex items-center gap-2 text-[14px]">
                  <input type="checkbox" name="serviceCodes" value={s.code} defaultChecked={sel.has(s.code)} className="size-4 accent-[var(--ink)]" />
                  <span dir="ltr" className="tabular">{s.code}</span> {s.nameAr}{s.isActive ? "" : " (موقوفة)"}
                </label>
              ))}
            </div>
          </div>
        </EFieldset>
        <LogicField
          name="suppressIf"
          label="شرط الكتم (اختياري)"
          defaultValue={r?.suppressIf ?? null}
          hint="إن تحقق تُعرض التوصية مكتومة (مثلًا حين تكون وقفك ناظرًا: waqfak_role)."
          examples={[{ label: "وقفك ناظر", value: { in: [{ var: "waqfak_role" }, ["nazir"]] } }]}
        />
      </fieldset>

      <section aria-labelledby="test-h" className="space-y-4 rounded-lg border border-seal/40 bg-seal-soft/40 p-4">
        <div>
          <h3 id="test-h" className="font-semibold">اختبر هذه القاعدة</h3>
          <p className="text-[14px] text-muted">يُقيّم الشرط كما هو مكتوب أعلاه (دون حفظ) على حقائق تكتبها أو حقائق تقييم تجريبي، ويُشغّل مجموعة القواعد المنشورة مع هذه النسخة لإظهار التوصيات الناتجة.</p>
        </div>
        <EField label="تقييم تجريبي" name="testAssessmentId"><Select name="testAssessmentId" defaultValue="" placeholder="بلا تقييم — استخدم الحقائق المكتوبة" options={assessments.map((a) => ({ value: a.id, label: a.label }))} /></EField>
        <EField label="حقائق (JSON) — تُضاف فوق حقائق التقييم إن اخترته" name="testFacts">
          <Textarea name="testFacts" dir="ltr" className="min-h-24 font-mono text-[13px]" placeholder='{"has_bank_account": "no", "size_class": "medium"}' />
        </EField>
      </section>
    </div>
  );
}
