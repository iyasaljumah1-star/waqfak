import { Input, Select, Textarea } from "@/components/ui/form";
import { CONTENT_KINDS } from "@/server/modules/admin/editors/pure";
import type { contentItems } from "@/server/db/schema";
import { ContentBody } from "./content-body";
import { EField, EFieldset } from "./editor-form";
import { RowsEditor } from "./rows-editor";
import { CheckGroup, FieldGrid } from "./shell";

type C = typeof contentItems.$inferSelect;
const AUD = [{ value: "waqif", label: "واقف" }, { value: "nazir", label: "ناظر" }, { value: "board", label: "مجلس" }, { value: "beneficiary", label: "مستفيد" }, { value: "entities", label: "جهات" }];

export function ContentFields({ c }: { c: C | null }) {
  return (
    <div className="space-y-5">
      {c ? <input type="hidden" name="id" value={c.id} /> : null}
      <FieldGrid cols={3}>
        <EField label="النوع" name="kind" required hint="نشر الأنظمة والأدلة يتطلب مراجعة متخصص."><Select name="kind" defaultValue={c?.kind ?? "article"} options={CONTENT_KINDS} /></EField>
        <EField label="المعرّف في الرابط" name="slug" required><Input name="slug" dir="ltr" defaultValue={c?.slug ?? ""} placeholder="nazir-duties" /></EField>
        <EField label="الموضوع" name="topic"><Input name="topic" dir="ltr" defaultValue={c?.topic ?? ""} placeholder="governance" /></EField>
      </FieldGrid>
      <EField label="العنوان" name="titleAr" required><Input name="titleAr" defaultValue={c?.titleAr ?? ""} /></EField>
      <EField label="الملخص" name="summary"><Textarea name="summary" className="min-h-16" defaultValue={c?.summary ?? ""} /></EField>
      <ContentBody defaultValue={c?.bodyMd ?? ""} />
      <RowsEditor
        name="sourceRefs"
        label="المصادر"
        initial={(c?.sourceRefs ?? []) as never}
        addLabel="أضف مصدرًا"
        hint="اذكر النظام والمادة أو الدليل. الرابط اختياري ويبدأ بـ https://."
        columns={[{ key: "label", label: "المصدر", placeholder: "لائحة تنظيم أعمال النظارة، المادة 15" }, { key: "url", label: "الرابط", dir: "ltr", placeholder: "https://" }]}
      />
      <EFieldset legend="الجمهور" name="audience"><CheckGroup name="audience" options={AUD} selected={c?.audience ?? []} /></EFieldset>
      <FieldGrid cols={3}>
        <EField label="آخر تحقق من المصادر" name="lastVerifiedAt"><Input name="lastVerifiedAt" type="date" defaultValue={c?.lastVerifiedAt ?? ""} /></EField>
        <EField label="مدة القراءة (دقائق)" name="readingMinutes" hint="تُحسب آليًا إن تُركت فارغة."><Input name="readingMinutes" type="number" min={1} defaultValue={c?.readingMinutes ?? ""} /></EField>
        <label className="flex items-center gap-2 self-end pb-3"><input type="checkbox" name="requiresLogin" defaultChecked={c?.requiresLogin ?? false} className="size-4 accent-[var(--ink)]" /> للمسجلين فقط</label>
      </FieldGrid>
      <FieldGrid>
        <EField label="عنوان محركات البحث" name="seoTitle"><Input name="seoTitle" defaultValue={c?.seoTitle ?? ""} /></EField>
        <EField label="وصف محركات البحث" name="seoDescription"><Input name="seoDescription" defaultValue={c?.seoDescription ?? ""} /></EField>
      </FieldGrid>
    </div>
  );
}
