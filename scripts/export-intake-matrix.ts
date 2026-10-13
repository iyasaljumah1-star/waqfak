/**
 * Writes docs/SERVICE-FORMS.md: for every service in the catalog, the intake form actually served (steps, questions,
 * conditions, required documents) and the sources it rests on. Generated from the code, so it never drifts.
 *   npx tsx scripts/export-intake-matrix.ts
 */
import { writeFileSync } from "node:fs";
import { CATEGORIES, SERVICES } from "../src/server/seed/data/services";
import { formFor } from "../src/server/modules/requests/intake/forms";
import type { Cond, DocSlot, Field } from "../src/server/modules/requests/intake/engine";

let optionLabels = new Map<string, string>();
const val = (field: string, v: string) => (v === "yes" ? "نعم" : v === "no" ? "لا" : optionLabels.get(`${field}:${v}`) ?? v);
const condText = (c: Cond | undefined, labels: Map<string, string>): string => {
  if (!c) return "";
  if ("all" in c) return c.all.map((x) => condText(x, labels)).join(" و");
  if ("any" in c) return c.any.map((x) => condText(x, labels)).join(" أو ");
  const l = `«${labels.get(c.field) ?? c.field}»`;
  if (c.notEmpty) return `إذا عُبّئ ${l}`;
  if (c.in) return `إذا كان ${l} من: ${c.in.map((v) => val(c.field, v)).join("، ")}`;
  if (c.eq) return `إذا كان ${l} «${val(c.field, c.eq)}»`;
  return `إذا عُبّئ ${l}`;
};

const req = (f: Field | DocSlot, labels: Map<string, string>) =>
  f.required ? "مطلوب" : f.requiredIf ? `مطلوب ${condText(f.requiredIf, labels)}` : "اختياري";

const out: string[] = [
  "# نماذج الخدمات — مصفوفة المتطلبات",
  "",
  `مولّدة من الكود (\`src/server/modules/requests/intake/forms.ts\`) بتاريخ ${new Date().toISOString().slice(0, 10)} عبر \`scripts/export-intake-matrix.ts\`.`,
  "",
  "كل نموذج = خطوة مشتركة «مقدم الطلب وصفته» + أسئلة الخدمة + «ملاحظات إضافية» + المستندات + المراجعة قبل الإرسال.",
  "المستندات تجمع ما يحدده النموذج وما يضبطه المسؤول على الخدمة في لوحة الإدارة (required_documents).",
  "«المصادر» تذكر ملف المشروع الذي بُني عليه السؤال، أو «تعريف الخدمة في الكتالوج» حين لا يوجد مصدر أخص؛ ولا تُنسب إلى ملف متطلبات لا يتضمنها.",
  "",
  "## الخطوة المشتركة: مقدم الطلب وصفته",
  "",
  "- الصفة (تُعرض بحسب جمهور الخدمة)، ووكيل عن صاحب الشأن دائمًا.",
  "- الوكيل: اسم صاحب الشأن ورقم الوكالة (مطلوبان) وتاريخها، ومستند الوكالة مطلوب — نظام المعاملات المدنية م87–م90 (التعاقد بالنيابة في حدود سندها).",
  "- ممثل جهة اعتبارية: اسم الجهة ومنصبه (مطلوبان) ورقمها، ومستند التفويض مطلوب.",
  "- الاسم والجوال والبريد (معبأة من الحساب)، ووسيلة التواصل، والأولوية، وموعد يهم العميل مع سببه.",
  "",
];

for (const cat of CATEGORIES) {
  out.push(`## ${cat.code} — ${cat.nameAr}`, "");
  for (const s of SERVICES.filter((x) => x.cat === cat.code)) {
    const form = formFor({ code: s.code, audiences: s.audiences, requiredDocuments: s.docs ?? [] });
    const labels = new Map(form.steps.flatMap((st) => st.fields).map((f) => [f.key, f.label]));
    optionLabels = new Map(form.steps.flatMap((st) => st.fields).flatMap((f) => (f.options ?? []).map(([k, l]) => [`${f.key}:${k}`, l] as [string, string])));
    out.push(`### ${s.code} ${s.nameAr}`, "");
    out.push(`المصادر: ${form.sources.join("؛ ")}.`, "");
    for (const st of form.steps.slice(1, -1)) {
      out.push(`**${st.title}**`, "");
      for (const f of st.fields) out.push(`- ${f.label} — ${req(f, labels)}${f.showIf ? ` (يظهر ${condText(f.showIf, labels)})` : ""}`);
      out.push("");
    }
    const docs = form.docs.filter((d) => !["poa", "authorization"].includes(d.key));
    out.push(docs.length ? `**المستندات:** ${docs.map((d) => `${d.label} (${req(d, labels)})`).join("، ")}.` : "**المستندات:** لا مستندات إلزامية في النموذج؛ تُطلب عند الحاجة من سجل النواقص.", "");
  }
}

writeFileSync("docs/SERVICE-FORMS.md", out.join("\n"));
console.log(`docs/SERVICE-FORMS.md — ${SERVICES.length} services`);
