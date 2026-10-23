/**
 * Generates docs/SERVICE-DATA-MAP.md from the code itself (forms, context map, outputs), so the map cannot drift from
 * what the platform does: `npx tsx --conditions=react-server scripts/gen-service-data-map.ts`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { SERVICES } from "@/server/seed/data/services";
import { formFor, INTAKE_FORM_CODES } from "@/server/modules/requests/intake/forms";
import { contextFor } from "@/server/modules/requests/context/map";
import { CONTEXT_TITLE_AR, type ContextKey } from "@/server/modules/requests/context/types";
import { requestOutputs } from "@/server/modules/operations/continuous-pure";
import { WORKFLOWS } from "@/server/seed/data/services";
import { WAQF_MODE_AR, waqfModesFor } from "@/server/modules/requests/waqf-mode";
import type { Cond } from "@/server/modules/requests/intake/engine";

const resolveSrc = readFileSync("src/server/modules/requests/context/resolve.ts", "utf8");
const SOURCE: Record<string, { source: string; path: string | null }> = {};
for (const m of resolveSrc.matchAll(/return make\(key, "([^"]+)", (null|"[^"]*")/g)) {
  // the case label above each `make` call names the block
  const before = resolveSrc.slice(0, m.index);
  const c = [...before.matchAll(/case "([a-z.]+)":/g)].pop();
  if (c) SOURCE[c[1]] = { source: m[1], path: m[2] === "null" ? null : m[2].slice(1, -1) };
}
const REVIEW_AR: Record<string, string> = { sharia: "شرعية", legal: "قانونية", financial: "مالية ومحاسبية", technical: "فنية" };

const lines: string[] = [
  "# خريطة بيانات الخدمات ومصفوفة متطلباتها",
  "",
  "مولّدة من الكود (`scripts/gen-service-data-map.ts`): النماذج، وخريطة بيانات ملف الوقف لكل خدمة، والمخرجات. لا تُحرَّر يدويًا.",
  "",
  "لكل خدمة: البيانات التي تُسحب تلقائيًا من ملف الوقف (المصدر ومكان تحديثه)، والحقول المعبأة مسبقًا من الحساب أو الملف (يؤكدها العميل أو يعدّلها)، والحقول الخاصة بالخدمة، والمستندات، والمخرجات. كل سجل من ملف الوقف ناقص أو قديم تُنشأ له مهمة داخلية مرتبطة به عند إرسال الطلب، ويُعرض في صفحة الطلب بمصدره وتاريخ آخر تحديث وحالته (مسجل / ناقص / قديم / غير مسجل).",
  "",
  "## مصادر بيانات ملف الوقف",
  "",
  "| السجل | المصدر | مكان التحديث |",
  "|---|---|---|",
  ...Object.entries(CONTEXT_TITLE_AR).map(([k, t]) => `| ${t} (\`${k}\`) | ${SOURCE[k]?.source ?? "—"} | ${SOURCE[k]?.path ? `\`/app/w/{id}${SOURCE[k]!.path}\`` : "—"} |`),
  "",
];

for (const s of SERVICES) {
  if (!INTAKE_FORM_CODES.includes(s.code)) continue;
  const form = formFor({ code: s.code, audiences: s.audiences, requiredDocuments: s.docs ?? [] });
  // fields kept only to display answers given on an older form version are not asked any more
  const isLegacy = (f: { key: string; showIf?: unknown }) => { const c = f.showIf as { field?: string; notEmpty?: boolean } | undefined; return !!c && c.field === f.key && !!c.notEmpty; };
  const fields = form.steps.flatMap((st) => st.fields.filter((f) => !isLegacy(f)).map((f) => ({ ...f, step: st.key })));
  const ctx = contextFor(s.code);
  const prefilled = fields.filter((f) => f.prefill && f.type !== "hidden");
  const own = fields.filter((f) => f.step !== "applicant" && f.step !== "unregisteredWaqf" && !f.prefill && f.type !== "hidden" && !["dataReview", "dataCorrections", "dataUpdateScope", "priority", "preferredContact"].includes(f.key));
  const review = fields.filter((f) => f.review);
  const outs = requestOutputs({ code: s.code, outputs: s.outputs ?? null, nameAr: s.nameAr });
  lines.push(`## ${s.code} — ${s.nameAr}`, "");
  lines.push(`**يُسحب من ملف الوقف:** ${ctx.length ? ctx.map((k: ContextKey) => `${CONTEXT_TITLE_AR[k]}`).join("، ") : "لا شيء (تبدأ الخدمة من إجابات العميل)"}.`, "");
  if (ctx.length) lines.push("يؤكد العميل هذه البيانات أو يطلب تحديثها (للطلب فقط أو في الملف)، ولا يُطلب منه إدخالها من جديد.", "");
  if (prefilled.length) lines.push(`**معبأ مسبقًا ويحتاج تأكيدًا:** ${prefilled.map((f) => f.label).join("، ")}.`, "");
  const tables = fields.filter((f) => (f as { prefillTable?: string }).prefillTable);
  if (tables.length) lines.push(`**جداول تُعبأ من ملف الوقف (صفًا صفًا مع مصدر كل صف، ويصححها العميل أو الفريق بسبب):** ${tables.map((f) => `${f.label} (${(f as { prefillTable?: string }).prefillTable === "waqf.assets" ? "سجل الأصول" : "مجلس النظارة"})`).join("، ")}.`, "");
  lines.push(`**بيانات خاصة بالخدمة:** ${own.map((f) => `${f.label}${f.required ? " *" : ""}`).join("، ") || "—"}.`, "");
  if (review.length) lines.push(`**تحتاج مراجعة مختص:** ${review.map((f) => `${f.label} (${REVIEW_AR[f.review!]})`).join("، ")}.`, "");
  if (form.docs.length) lines.push(`**المستندات:** ${form.docs.map((d) => d.label).join("، ")}.`, "");
  const modes = waqfModesFor(s.code);
  lines.push(`**الوقف المعني بالطلب:** ${(["registered", "unregistered", "none"] as const).filter((m) => modes[m]).map((m) => WAQF_MODE_AR[m]).join("، ")}.${modes.reasons.unregistered ? ` (لا يُقبل الوقف غير المسجل: ${modes.reasons.unregistered})` : ""}`, "");
  const uw = fields.filter((f) => f.step === "unregisteredWaqf");
  const lvl = (f: { required?: boolean; requiredIf?: Cond; need?: string }) => (f.required || f.requiredIf ? (f.need === "start" ? "إلزامي (و«لا أعرف» يؤجل البدء)" : "إلزامي") : f.need === "start" ? "لازم لبدء التنفيذ" : f.need === "support" ? "مساند" : "اختياري");
  if (uw.length) lines.push(`**إذا كان الوقف غير مسجل يُجمع من العميل:** ${uw.map((f) => `${f.label} [${lvl(f)}]`).join("، ")}.`, "");
  const startLevel = fields.filter((f) => f.step !== "unregisteredWaqf" && f.need === "start");
  const supportLevel = fields.filter((f) => f.step !== "unregisteredWaqf" && f.need === "support");
  const showIfs = fields.filter((f) => f.showIf && f.step !== "applicant" && !isLegacy(f)).length;
  lines.push(`**شروط الإظهار:** ${showIfs} حقلًا يظهر بحسب إجابات سابقة؛ ويُستبعد ما لا ينطبق من حساب الاكتمال.`, "");
  lines.push(`**يمنع الإرسال:** الحقول المعلَّمة * وما يصبح إلزاميًا بحسب الإجابات، والمستندات الإلزامية.`, "");
  if (startLevel.length || form.docs.some((d) => d.need === "start")) lines.push(`**يُرسل الطلب دونه، ولا يبدأ التنفيذ قبله:** ${[...startLevel.map((f) => f.label), ...form.docs.filter((d) => d.need === "start").map((d) => (d.label.startsWith("مستند") ? d.label : `مستند ${d.label}`))].join("، ")}.`, "");
  if (supportLevel.length || form.docs.some((d) => d.need === "support")) lines.push(`**مساند يُستكمل لاحقًا:** ${[...supportLevel.map((f) => f.label), ...form.docs.filter((d) => d.need === "support").map((d) => (d.label.startsWith("مستند") ? d.label : `مستند ${d.label}`))].join("، ")}.`, "");
  lines.push(`**المخرجات:** ${outs.length ? outs.map((o) => o.title).join("، ") : "—"}.`, "");
  const wf = WORKFLOWS.find((w) => w.code === (s.workflow ?? (s.pricingModel === "hourly" ? "opinion" : "standard")))!;
  lines.push(`**مراحل العمل والمراجعة (${wf.nameAr}):** ${wf.stages.map((x) => x.name).join(" ← ")}. ${outs.length ? "يُعتمد كل مخرج بعد مراجعته من غير معدّه، وفق سياسة الفصل بين المُعد والمعتمد." : ""}`.trim(), "");
  lines.push(`**المهام المعتمدة على البيانات:** مهمة استقبال الطلب؛ ومهمة لكل سجل ناقص أو قديم مما يُسحب؛ ومهام إعداد كل مخرج ومراجعته بعد بدء التنفيذ.`, "");
  if (form.sources.length) lines.push(`**مصادر الأسئلة:** ${form.sources.join("؛ ")}.`, "");
}
writeFileSync("docs/SERVICE-DATA-MAP.md", lines.join("\n") + "\n");
console.log("services:", lines.filter((l) => l.startsWith("## ") && !l.startsWith("## مصادر")).length);
