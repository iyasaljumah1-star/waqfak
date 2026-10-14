/**
 * Service map, generated from the code and the service catalog: every service, its family, the workflow stages it
 * runs, its commercial path, its form (structured vs free fields, required documents), its outputs and their review.
 *   npx tsx scripts/export-service-map.ts > docs/SERVICE-MAP.md
 */
import { SERVICES, WORKFLOWS, CATEGORIES } from "../src/server/seed/data/services";
import { formFor } from "../src/server/modules/requests/intake/forms";
import { executionProfile, FAMILY_AR, type Family } from "../src/server/modules/operations/service-profile";

const lines: string[] = ["# خريطة الخدمات وتنفيذها", "", "مولّدة من الكود (`scripts/export-service-map.ts`). محرك الطلب واحد لكل الخدمات، ولكل خدمة ما ينطبق عليها من قدراته.", ""];
const byFamily = new Map<Family, string[]>();
const rows: string[] = [];
let free = 0, structured = 0;
for (const s of SERVICES) {
  const wf = WORKFLOWS.find((w) => w.code === (s.workflow ?? "standard"))!;
  const p = executionProfile({ ...s, workflow: s.workflow ?? "standard" }, wf.stages);
  const form = formFor({ code: s.code, audiences: s.audiences, requiredDocuments: s.docs ?? [] });
  const fields = form.steps.slice(1, -1).flatMap((st) => st.fields).filter((f) => f.type !== "ack");
  const fr = fields.filter((f) => f.type === "text" || f.type === "textarea").length;
  free += fr; structured += fields.length - fr;
  const docs = form.docs.filter((d) => d.required).length;
  byFamily.set(p.family, [...(byFamily.get(p.family) ?? []), s.code]);
  rows.push(`| ${s.code} | ${s.nameAr} | ${p.familyLabel} | ${wf.nameAr}: ${wf.stages.map((x) => x.name).join(" ← ")} | ${p.commercialLabel} | ن${form.version}: ${fields.length - fr} منظّم / ${fr} نصي، ${docs} مستند مطلوب | ${p.outputs.length ? p.outputs.map((o) => `${o.title} (${o.format}؛ ${o.review})`).join("، ") : "يُرفع ويُسجَّل"} | ${p.notes.join(" ") || "—"} |`);
}
lines.push(`عدد الخدمات: ${SERVICES.length} في ${CATEGORIES.length} فئات. حقول النماذج: ${structured} منظّم و${free} نصي.`, "");
lines.push("## المجموعات", "");
for (const [f, codes] of byFamily) lines.push(`- **${FAMILY_AR[f]}** (${codes.length}): ${codes.join("، ")}`);
lines.push("", "## مسارات العمل", "");
for (const w of WORKFLOWS) lines.push(`- **${w.nameAr}**: ${w.stages.map((x) => `${x.name}${x.clientApproval ? " (على العميل)" : ""}`).join(" ← ")}`);
lines.push("", "## ما يشترك فيه الجميع", "",
  "- آلة حالات واحدة وحراس قواعد واحدة (التحقق والقبول، العرض والعقد، الدفعة المشروطة، المخرجات قبل الجودة، العينان الأربع).",
  "- خطة الطلب وزر «نفّذ الخطوة التالية» تُبنى من حالة كل طلب، وتُخفى الخطوات التي لا تنطبق: لا عرض ولا عقد للخدمة المجانية، ولا دفعة مشروطة بلا شرط، ومخرج مرفوع حين لا قالب توليد.",
  "- المهام تُنشأ من مراحل الخدمة نفسها ومن مخرجاتها، ويُنفّذها المسند أو المدير المخوّل مباشرة.",
  "- المراسلات بقنوات منفصلة، والرجوع المنضبط، وتصحيح البيانات بسجل وأثر، ودورة الفاتورة (مسودة ← اعتماد ← إرسال).",
  "", "## الخدمات", "",
  "| الرمز | الخدمة | المجموعة | مسار العمل ومراحله | المسار التجاري | النموذج | المخرجات | ملاحظات |",
  "|---|---|---|---|---|---|---|---|", ...rows);
console.log(lines.join("\n"));
