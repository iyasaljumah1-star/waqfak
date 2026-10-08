import { Input, Select, Textarea } from "@/components/ui/form";
import { ANSWER_TYPES } from "@/server/modules/admin/editors/pure";
import type { assessmentQuestions } from "@/server/db/schema";
import { EField } from "./editor-form";
import { LogicField } from "./logic-field";
import { RowsEditor } from "./rows-editor";
import { FieldGrid } from "./shell";

type Q = typeof assessmentQuestions.$inferSelect;

export function QuestionFields({ q, versionId, axes, flags, factKeys, readOnly }: {
  q: Q | null;
  versionId: string;
  axes: { code: string; nameAr: string }[];
  flags: { code: string; titleAr: string }[];
  factKeys: string[];
  readOnly?: boolean;
}) {
  return (
    <fieldset disabled={readOnly} className="space-y-5">
      <input type="hidden" name="versionId" value={versionId} />
      {q ? <input type="hidden" name="questionId" value={q.id} /> : null}
      <FieldGrid cols={3}>
        <EField label="الرمز" name="code" required><Input name="code" dir="ltr" defaultValue={q?.code ?? ""} placeholder="A5-07" /></EField>
        <EField label="المحور" name="axisCode" required>
          <Select name="axisCode" defaultValue={q?.axisCode ?? ""} placeholder="اختر" options={[{ value: "P", label: "P — الملف التعريفي" }, ...axes.map((a) => ({ value: a.code, label: `${a.code} — ${a.nameAr}` }))]} />
        </EField>
        <EField label="العمق" name="depth" hint="السريع يظهر في التقييم الأساسي؛ المعمّق في التقييم المعمّق فقط.">
          <Select name="depth" defaultValue={q?.depth ?? "basic"} options={[{ value: "basic", label: "سريع (أساسي)" }, { value: "deep", label: "معمّق" }]} />
        </EField>
      </FieldGrid>
      <EField label="نص السؤال" name="textAr" required><Textarea name="textAr" className="min-h-20" defaultValue={q?.textAr ?? ""} /></EField>
      <EField label="توضيح للمستخدم" name="helpAr"><Textarea name="helpAr" className="min-h-16" defaultValue={q?.helpAr ?? ""} /></EField>
      <FieldGrid cols={3}>
        <EField label="نوع الإجابة" name="answerType" required><Select name="answerType" defaultValue={q?.answerType ?? "yes_no"} options={ANSWER_TYPES} /></EField>
        <EField label="الوزن داخل المحور" name="weight" required hint="0 لا يدخل في الدرجة."><Input name="weight" type="number" min={0} max={10} defaultValue={q?.weight ?? 1} /></EField>
        <EField label="مفتاح الحقيقة" name="factKey" hint="اسم الحقيقة التي تستخدمها القواعد، مثل has_bank_account."><Input name="factKey" dir="ltr" defaultValue={q?.factKey ?? ""} /></EField>
      </FieldGrid>
      <RowsEditor
        name="options"
        label="الخيارات ودرجاتها"
        readOnly={readOnly}
        initial={(q?.options ?? []) as never}
        addLabel="أضف خيارًا"
        hint="الدرجة من 0 إلى 5. «لا أعرف» تُحتسب فجوة معرفة، و«لا ينطبق» تُستبعد من الحساب. سؤال مستوى النضج بلا خيارات يستخدم المقياس الافتراضي 0–5."
        columns={[
          { key: "value", label: "القيمة", dir: "ltr", placeholder: "yes" },
          { key: "label", label: "النص الظاهر", placeholder: "نعم" },
          { key: "score", label: "الدرجة", type: "number", className: "basis-20 max-w-24" },
          { key: "unknown", label: "لا أعرف", type: "checkbox" },
          { key: "na", label: "لا ينطبق", type: "checkbox" },
        ]}
      />
      <LogicField
        name="showIf"
        label="شرط الظهور (JSON-logic على الحقائق)"
        defaultValue={q?.showIf ?? null}
        readOnly={readOnly}
        knownVars={factKeys}
        hint="يظهر السؤال فقط إن تحقق الشرط. الحقائق: مفاتيح أسئلة هذه النسخة وsize_class وcomputed_type وغيرها المشتقة."
        examples={[{ label: "وقف متوسط أو كبير", value: { in: [{ var: "size_class" }, ["medium", "large"]] } }]}
      />
      <FieldGrid>
        <EField label="الإشارة الحرجة" name="criticalFlagCode"><Select name="criticalFlagCode" defaultValue={q?.criticalFlagCode ?? ""} placeholder="لا شيء" options={flags.map((f) => ({ value: f.code, label: `${f.code} — ${f.titleAr}` }))} /></EField>
        <EField label="المرجع النظامي" name="referenceText"><Input name="referenceText" defaultValue={q?.referenceText ?? ""} placeholder="لائحة تنظيم أعمال النظارة م15/1" /></EField>
      </FieldGrid>
      <LogicField
        name="criticalWhen"
        label="شرط رفع الإشارة الحرجة (JSON-logic على {answer})"
        defaultValue={q?.criticalWhen ?? null}
        readOnly={readOnly}
        knownVars={["answer"]}
        examples={[{ label: "الإجابة لا", value: { in: [{ var: "answer" }, ["no"]] } }]}
      />
      <EField label="الترتيب" name="position"><Input name="position" type="number" min={0} defaultValue={q?.position ?? ""} className="max-w-32" /></EField>
    </fieldset>
  );
}
