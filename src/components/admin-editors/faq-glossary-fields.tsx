import { Input, Select, Textarea } from "@/components/ui/form";
import { PUBLISH_STATUS_AR } from "@/server/modules/admin/editors/pure";
import type { faqs, glossaryTerms } from "@/server/db/schema";
import { EField } from "./editor-form";
import { FieldGrid } from "./shell";

const STATUS = Object.entries(PUBLISH_STATUS_AR).map(([value, label]) => ({ value, label }));
const AUD = [{ value: "all", label: "الجميع" }, { value: "waqif", label: "واقف" }, { value: "nazir", label: "ناظر" }, { value: "beneficiary", label: "مستفيد" }, { value: "entities", label: "جهات" }];

export function FaqFields({ f, topics }: { f: typeof faqs.$inferSelect | null; topics: string[] }) {
  return (
    <div className="space-y-5">
      {f ? <input type="hidden" name="id" value={f.id} /> : null}
      <EField label="السؤال" name="question" required><Input name="question" defaultValue={f?.question ?? ""} /></EField>
      <EField label="الإجابة" name="answer" required><Textarea name="answer" className="min-h-32" defaultValue={f?.answer ?? ""} /></EField>
      <FieldGrid cols={3}>
        <EField label="الموضوع" name="topic" required hint={topics.length ? `الموجود: ${topics.slice(0, 8).join("، ")}` : undefined}><Input name="topic" dir="ltr" list="faq-topics" defaultValue={f?.topic ?? ""} /></EField>
        <EField label="الجمهور" name="audience"><Select name="audience" defaultValue={f?.audience ?? "all"} options={AUD} /></EField>
        <EField label="الحالة" name="status"><Select name="status" defaultValue={f?.status ?? "published"} options={STATUS} /></EField>
      </FieldGrid>
      <datalist id="faq-topics">{topics.map((t) => <option key={t} value={t} />)}</datalist>
      <FieldGrid>
        <EField label="المصدر" name="source"><Input name="source" defaultValue={f?.source ?? ""} /></EField>
        <EField label="الترتيب" name="position"><Input name="position" type="number" min={0} defaultValue={f?.position ?? 0} /></EField>
      </FieldGrid>
    </div>
  );
}

export function TermFields({ t }: { t: typeof glossaryTerms.$inferSelect | null }) {
  return (
    <div className="space-y-5">
      {t ? <input type="hidden" name="id" value={t.id} /> : null}
      <FieldGrid cols={3}>
        <EField label="المصطلح" name="term" required><Input name="term" defaultValue={t?.term ?? ""} /></EField>
        <EField label="المعرّف" name="slug" required><Input name="slug" dir="ltr" defaultValue={t?.slug ?? ""} placeholder="nazir" /></EField>
        <EField label="الحالة" name="status"><Select name="status" defaultValue={t?.status ?? "published"} options={STATUS} /></EField>
      </FieldGrid>
      <EField label="التعريف" name="definition" required><Textarea name="definition" className="min-h-28" defaultValue={t?.definition ?? ""} /></EField>
      <FieldGrid>
        <EField label="مرادفات" name="synonyms" hint="مفصولة بفواصل."><Input name="synonyms" defaultValue={(t?.synonyms ?? []).join("، ")} /></EField>
        <EField label="مصطلحات مرتبطة (معرّفات)" name="related" hint="مثل: waqif, nazara"><Input name="related" dir="ltr" defaultValue={(t?.related ?? []).join(", ")} /></EField>
      </FieldGrid>
      <EField label="المصدر" name="source"><Input name="source" defaultValue={t?.source ?? ""} /></EField>
    </div>
  );
}
