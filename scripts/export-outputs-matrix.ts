/**
 * Outputs matrix, generated from code (catalog + templates + service catalog): what each service produces, from which
 * data, on which references, how it is drafted, reviewed, approved and delivered.
 *   npx tsx scripts/export-outputs-matrix.ts > docs/OUTPUTS-MATRIX.md
 */
import { SERVICES } from "../src/server/seed/data/services";
import { outputsFor, PROFILE_REFS, REVIEW_LABEL, SPECIALTY_LABEL, TEMPLATES, type SectionKind } from "../src/server/modules/outputs/catalog";
import { formFor } from "../src/server/modules/requests/intake/forms";

const SECTION_AR: Record<SectionKind, string> = {
  meta: "بيانات المستند", request: "إجابات نموذج الطلب ونطاق العرض", documents: "المستندات المرفقة وملف الوقف", waqf: "ملف الوقف", conditions: "شروط الواقف نصًا",
  parties: "الأطراف", beneficiaries: "المستفيدون", assets: "الأصول والإيجارات", finance: "القيود المالية", budget: "الموازنة", distributions: "دفعات الصرف",
  governance: "الهيئات والمتطلبات التنظيمية", compliance: "الالتزامات النظامية", beneficial_owners: "سجل المستفيد الحقيقي", investment: "سياسة الاستثمار والمحافظ",
  scope: "النطاق", deed_clauses: "نص وثيقة الوقف مصوغًا بنودًا", will_clauses: "نص الوصية مصوغًا بنودًا", checklist: "قائمة المتطلبات", nazara: "ملف النظارة وقائمة الاستلام",
  stages: "مراحل التنفيذ", references: "المراجع",
};
const KIND_AR: Record<string, string> = {
  sharia_memo: "مذكرة شرعية", sharia_opinion: "رأي شرعي موقّع", will_text: "وثيقة وصية (نص مصوغ)", deed_draft: "وثيقة وقف (نص مصوغ)", legal_review: "تقرير مراجعة قانونية",
  legal_package: "حزمة إجراءات نظامية", finance_report: "تقرير مالي", finance_opinion: "رأي مالي", investment_policy: "سياسة استثمار", investment_assets: "دراسة أصول",
  investment_opinion: "رأي استثماري", governance_package: "حزمة حوكمة", ops_package: "حزمة تشغيلية", nazara_study: "دراسة ملف نظارة", aml_program: "برنامج امتثال",
};
const DRAFTED = new Set(["will_text", "deed_draft"]);

const lines: string[] = [];
lines.push("# مصفوفة المخرجات", "", "مولّدة من الكود (`scripts/export-outputs-matrix.ts`) — لا تُحرَّر يدويًا.", "");
lines.push("قواعد مشتركة لكل المخرجات:", "");
lines.push("- **التوليد**: زر «أنشئ المسودة» أو «نفّذ الخطوة التالية» يبني المسودة من بيانات الطلب والوقف؛ كل معلومة موسومة بمصدرها (إجابة العميل، مستند، سجلات المنصة، محسوب، يحتاج تحققًا).");
lines.push("- **النواقص**: لا تُخترع قيمة. الناقص يظهر «[يُستكمل: …]» في النص، ويُسجَّل نقصًا يسمّي الحقل أو المستند ومن يستكمله (العميل، المختص، الفريق). النقص الجوهري يمنع الإرسال للمراجعة والاعتماد، ويُعاد الفحص بعد كل توليد.");
lines.push("- **النسخ**: كل توليد أو تعديل نسخة جديدة لا تُمحى؛ إعادة التوليد تُبقي ما كتبه الإنسان (البنود المعدلة، النصوص التخصصية، البيانات المصححة) وتنبّه إن تغيّرت البيانات تحت بند معدّل؛ والمقارنة بين أي نسختين متاحة.");
lines.push("- **الاعتماد**: «مستقل» = يعتمده من لم يُعدّ أي نسخة؛ «ذاتي مسموح» = يجوز للمدير المخوّل اعتماد ما أعدّه ويُسجَّل اعتمادًا ذاتيًا. الرأي الشرعي والرأي المتخصص يُوقَّع باسم المستشار وصفته.");
lines.push("- **التسليم**: المعتمد يصبح تسليمًا للطلب، ولا يراه العميل إلا بعد مراجعة الجودة؛ عند الإفراج يُنتج PDF (العنوان، الرقم، التاريخ، الحالة، النسخة، أعدّه/راجعه واعتمده، الأقسام، المراجع، خانات التوقيع حين تنطبق) ويُحفظ في خزنة المستندات.");
lines.push("- **الفرق بين المسودة والاعتماد والتوثيق**: المسودة داخلية وتحمل شريطًا ظاهرًا؛ الاعتماد قرار داخلي من «وقفك»؛ التوثيق الرسمي (كتابة العدل، المحكمة، «ناجز») خارج المنصة ولا يُدّعى.");
lines.push("");
lines.push("| الخدمة | المخرج | النوع | التخصص | مصادر البيانات | الأقسام التي يكتبها المختص | المراجع | الاعتماد | الملف |");
lines.push("|---|---|---|---|---|---|---|---|---|");
let n = 0;
const missing: string[] = [];
for (const s of SERVICES) {
  const defs = outputsFor(s);
  if (!defs.length) { missing.push(`${s.code} ${s.nameAr}`); continue; }
  for (const d of defs) {
    n++;
    const t = TEMPLATES[d.profile];
    const data = t.sections.filter((k) => k !== "meta" && k !== "references").map((k) => SECTION_AR[k]).join("، ");
    const spec = t.analysis.map((a) => a.title).join("، ");
    const form = formFor({ code: s.code, audiences: s.audiences, requiredDocuments: s.docs ?? [] });
    const refs = `${PROFILE_REFS[d.profile].join("، ")}${form.sources.length ? ` + ${form.sources.length} من مصادر النموذج` : ""}`;
    const sign = d.specialty === "sharia" || s.workflow === "opinion" ? " · توقيع المستشار" : "";
    lines.push(`| ${s.code} ${s.nameAr} | ${d.title} | ${KIND_AR[d.profile]}${DRAFTED.has(d.profile) ? " — **صياغة آلية للبنود**" : ""} | ${SPECIALTY_LABEL[d.specialty]} | ${data} | ${spec || "—"} | ${refs} | ${REVIEW_LABEL[d.review]}${sign} | PDF |`);
  }
}
lines.push("", `عدد المخرجات المعرّفة: ${n}.`, "");
if (missing.length) lines.push("خدمات بلا قالب توليد (يُرفع مخرجها المعدّ خارج المنصة ويُسجَّل):", "", ...missing.map((m) => `- ${m}`), "");
lines.push("## الصياغة الآلية للبنود", "");
lines.push("- **الوصية (W01)**: الديباجة، الوصايا السابقة (إلغاء أو تعديل بتاريخها)، بند لكل وصية من جدول الوصايا (نسبة أو مبلغ أو عين، ونوعها)، حد الثلث عند تجاوزه أو تعذّر حسابه، الوقف بعد الوفاة (الاسم والمصارف والناظر والاستخلاف)، منفذ الوصية وبديله، التوثيق أو الإشهاد، الختام، وخانات توقيع الموصي والشهود. فحوص: حد الثلث، الوصية لوارث (للمختص)، اتساق الوقف بين الجدول والإجابة، أنصبة المصارف، الإشهاد.");
lines.push("- **وثيقة الوقف (T03)**: المقدمة وبيانات الواقف ونوع الوقف، الأصل (الوصف والصك والمشاع وما يلحق به)، الاسم، المصارف بطبقاتها وقسمتها والمصرف البديل ونسبة العمارة، استثناء الانتفاع، النظارة والاستخلاف، واجبات الناظر والإذن بالاستثمار، المجلس، الخاتمة وتعديل الشروط، وخانات التوقيع. فحوص: الملكية والصك، الرهن وموافقة المرتهن، أنصبة الطبقات.");
lines.push("- ما يحتاج حكمًا أو تقديرًا (أثر تجاوز الثلث، الوصية لوارث، آلية المجلس، مقدار الانتفاع الجزئي) لا يُكتب آليًا: يُسجَّل نقصًا على المختص ويكتب ملاحظته قبل الاعتماد المستقل.");
console.log(lines.join("\n"));
