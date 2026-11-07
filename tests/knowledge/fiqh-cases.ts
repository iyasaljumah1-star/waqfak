/**
 * Fiqh research cases (owner's order of 2026-11-07, §9 — practical fiqh tests). Synthetic matters and facts only (no real
 * waqf, no client). `kb` cases run on the test knowledge base's published texts; the others run the pure analysis on
 * SYNTHETIC TEST TEXTS (marked «نص اختبار», attributed to no real book) where a situation needs a controlled text.
 */
import type { Fact, FiqhDossier, Statement } from "../../src/server/knowledge/fiqh/types";

export type FiqhCase = { id: string; title: string; question: string; facts: Fact[]; kb?: boolean; refCodes?: string[]; judge?: (d: FiqhDossier) => string | null };

const has = (d: FiqhDossier, p: (s: Statement) => boolean) => d.statements.some(p);

export const FIQH_CASES: FiqhCase[] = [
  {
    id: "F1", title: "مسألة لها قول واحد ظاهر في المصادر المتاحة",
    question: "هل للناظر أن يستدين على الوقف؟",
    facts: [{ text: "الاستدانة لمصلحة عمارة الوقف", status: "established" }, { text: "ليس للواقف شرط يمنع الاستدانة", status: "established" }],
    judge: (d) => {
      if (!has(d, (s) => s.source.refCode === "FQH-KASHSHAF" && s.source.locator.includes("ص55") && s.polarity === "permit")) return "لم يُستخرج نص كشاف القناع ج10 ص55 بالجواز";
      if (d.weighing?.status !== "weighed" || d.weighing.leaning !== "permit") return `الترجيح ${d.weighing?.status} ${(d.weighing as { leaning?: string })?.leaning ?? ""}`;
      return null;
    },
  },
  {
    id: "F2", title: "مسألة لها أكثر من قول في المذهب الحنبلي",
    question: "ما حكم وقف الدراهم والنقود؟",
    facts: [{ text: "وجه الانتفاع بالنقود الموقوفة القرض الحسن للمحتاجين", status: "established" }],
    judge: (d) => {
      if (!has(d, (s) => s.source.refCode === "FQH-INSAF" && s.rank === "mutamad" && s.polarity === "prohibit")) return "لم يُستخرج المعتمد (لم يصح على الصحيح من المذهب) من الإنصاف";
      if (!has(d, (s) => s.source.refCode === "FQH-INSAF" && s.kind === "riwaya" && s.polarity === "permit")) return "لم تُستخرج الرواية (وعنه يصح)";
      if (!has(d, (s) => s.kind === "ikhtiyar" && /شيخ/.test(s.attributedTo ?? ""))) return "لم يُستخرج اختيار الشيخ تقي الدين منسوبًا";
      return d.comparison && d.comparison.divergences.length ? null : "لم تُرصد الأقوال المختلفة";
    },
  },
  {
    id: "F3", title: "قيد واستثناء يغيران الحكم بحسب الواقعة: بيع الوقف إذا تعطلت منافعه",
    question: "ما حكم بيع الوقف إذا تعطلت منافعه؟",
    facts: [{ text: "تعطلت منافع العقار الموقوف كليًا بسبب خرابه", status: "established" }, { text: "لا شرط للواقف في البيع أو المنع منه", status: "established" }],
    judge: (d) => {
      const s = d.statements.find((x) => x.source.refCode === "FQH-INSAF" && x.source.locator.includes("ص522"));
      if (!s) return "لم يُستخرج نص الإنصاف ج16 ص522";
      if (s.polarity !== "prohibit") return `حكم النص ${s.polarity}`;
      if (s.effective !== "permit") return "لم يُطبَّق الاستثناء «إلا أن يكون بحال لا ينتفع به» على الواقعة";
      return null;
    },
  },
  {
    id: "F4", title: "مسألة وردت في «الميسّر» شرحًا لا نقلًا حرفيًا",
    question: "هل للواقف أن يغير مصارف الوقف وإبداله واستبداله؟",
    facts: [{ text: "اشترط الواقف في صك الوقف أن له تغيير المصارف", status: "established" }],
    refCodes: ["BOOK-MAYSAR"],
    judge: (d) => {
      const m = d.statements.filter((s) => s.source.refCode === "BOOK-MAYSAR");
      if (!m.length) return "لم يُستخرج شيء من «الميسّر»";
      if (m.some((s) => s.element !== "author" && s.kind !== "naql")) return "عُدّ كلام المؤلف نصًا منقولًا";
      if (m.some((s) => s.rank === "mutamad")) return "نُسبت مرتبة المعتمد إلى كتاب معاصر";
      return null;
    },
  },
  {
    id: "F6", title: "مسألة لا تكفي المصادر المتاحة لحسمها",
    question: "ما حكم وقف حقوق البرمجيات مفتوحة المصدر على طلاب الحاسب؟",
    facts: [{ text: "البرمجيات منشورة برخصة مفتوحة", status: "established" }],
    judge: (d) => (d.weighing && d.weighing.status !== "weighed" ? null : `رُجّح: ${JSON.stringify(d.weighing)}`.slice(0, 300)),
  },
  {
    id: "F7", title: "مسألة تتوقف نتيجتها على شرط الواقف أو واقعة لم يقدمها المستخدم",
    question: "ما حكم تغيير مصرف الوقف إلى جهة أصلح؟",
    facts: [],
    judge: (d) => (d.weighing?.status === "needs_facts" && d.issue.missing.some((m) => /شرط الواقف/.test(m)) ? null : `حالة الترجيح ${d.weighing?.status}؛ الناقص ${d.issue.missing.join("؛ ")}`),
  },
];
