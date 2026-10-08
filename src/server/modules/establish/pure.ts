/**
 * New-waqf wizard (scenario 2): state shape, step list, classification and the indicative Arabic deed draft.
 * Clause order follows «الدليل الإرشادي لصياغة وثيقة الوقف» (المبدأ الأول: البنود العشرة).
 * Classification follows «الدليل الاسترشادي لتصنيف أنواع الوقف» via the shared deriveType engine.
 */
import { deriveType } from "../../engines/assessment";
import { allocationTotal } from "../deed/pure";
import { NAZIR_MODE_LABEL as NAZIR_MODE_LABEL_AR } from "@/lib/utils";
import { ASSET_CATEGORY_LABEL, CONDITION_CATEGORY_LABEL, DIVISION_LABEL, SUBSTITUTION_LABEL } from "../waqf-file/labels";

export const ESTABLISH_STEPS = [
  { key: "classification", label: "نوع الوقف" },
  { key: "founder", label: "الواقف" },
  { key: "assets", label: "الأصول" },
  { key: "beneficiaries", label: "المصارف والشروط" },
  { key: "nazara", label: "النظارة" },
  { key: "allocation", label: "توزيع الغلة" },
  { key: "review", label: "المراجعة والمسودة" },
] as const;
export type StepKey = (typeof ESTABLISH_STEPS)[number]["key"];

export type EstAsset = { category: string; title: string; ownershipDocNo: string; value: string; inFounderName: string; sharePct: string };
export type EstClass = { name: string; kind: string; tier: string; relation: string; sharePct: string; divisionRule: string; substitutionRule: string };
export type EstCondition = { category: string; text: string };

export type EstablishState = {
  v: 1;
  kind: "establish";
  step: number;
  completed: number[];
  waqfName: string;
  classification: { beneficiaryKind: string; charitableQualifier: string; thenToCharity: string; duration: string; durationYears: string; fieldOfWork: string; geographicScope: string; computedType: string | null; reason: string | null };
  founder: { name: string; nationality: string; isSelf: string; powers: string[]; selfBenefit: string; selfBenefitNote: string };
  assets: EstAsset[];
  classes: EstClass[];
  finalDestination: string;
  conditions: EstCondition[];
  nazara: { mode: string; nazirName: string; boardSize: string; successionRule: string; feePct: string; feeFixed: string; duties: string };
  allocation: { maintenancePct: string; developmentPct: string; reinvestPct: string; reservePct: string; nazirFeePct: string; adminPct: string; notes: string };
  finishedAt?: string | null;
  deedText?: string | null;
};

export function emptyState(founderName = ""): EstablishState {
  return {
    v: 1, kind: "establish", step: 1, completed: [], waqfName: "",
    classification: { beneficiaryKind: "", charitableQualifier: "", thenToCharity: "", duration: "perpetual", durationYears: "", fieldOfWork: "", geographicScope: "", computedType: null, reason: null },
    founder: { name: founderName, nationality: "سعودي", isSelf: "on", powers: [], selfBenefit: "none", selfBenefitNote: "" },
    assets: [], classes: [], finalDestination: "", conditions: [],
    nazara: { mode: "", nazirName: "", boardSize: "", successionRule: "", feePct: "", feeFixed: "", duties: "" },
    allocation: { maintenancePct: "", developmentPct: "", reinvestPct: "", reservePct: "", nazirFeePct: "", adminPct: "", notes: "" },
  };
}

/** Merges a stored (possibly older / partial) state over the empty shape. */
export function normalizeState(raw: unknown, founderName = ""): EstablishState {
  const e = emptyState(founderName);
  if (!raw || typeof raw !== "object") return e;
  const r = raw as Partial<EstablishState>;
  return {
    ...e, ...r, v: 1, kind: "establish",
    classification: { ...e.classification, ...(r.classification ?? {}) },
    founder: { ...e.founder, ...(r.founder ?? {}) },
    nazara: { ...e.nazara, ...(r.nazara ?? {}) },
    allocation: { ...e.allocation, ...(r.allocation ?? {}) },
    assets: Array.isArray(r.assets) ? r.assets : [],
    classes: Array.isArray(r.classes) ? r.classes : [],
    conditions: Array.isArray(r.conditions) ? r.conditions : [],
    completed: Array.isArray(r.completed) ? r.completed : [],
  };
}

export function classify(c: EstablishState["classification"]) {
  return deriveType({
    beneficiary_kind: c.beneficiaryKind || null,
    charitable_qualifier: c.beneficiaryKind === "private" ? c.charitableQualifier || null : null,
    then_to_charity: c.beneficiaryKind === "private" ? c.thenToCharity || null : null,
  });
}

/** What is still missing before the draft can be finalized (each item names the step to fix it). */
export function missingItems(s: EstablishState): { step: number; text: string }[] {
  const m: { step: number; text: string }[] = [];
  if (!s.classification.beneficiaryKind) m.push({ step: 1, text: "حدّد على من تُصرف غلة الوقف لنحدد نوعه." });
  if (!s.founder.name.trim()) m.push({ step: 2, text: "اكتب اسم الواقف." });
  if (!s.assets.length) m.push({ step: 3, text: "أضف أصلًا موقوفًا واحدًا على الأقل." });
  if (!s.classes.length) m.push({ step: 4, text: "أضف مصرفًا واحدًا على الأقل." });
  if (s.classification.beneficiaryKind !== "public" && !s.finalDestination.trim()) m.push({ step: 4, text: "حدّد مآل الوقف إذا انقطع المستحقون (جهة بر دائمة)." });
  if (!s.nazara.mode) m.push({ step: 5, text: "اختر صيغة النظارة." });
  if (s.nazara.mode && s.nazara.mode !== "founder" && !s.nazara.nazirName.trim()) m.push({ step: 5, text: "اكتب اسم الناظر أو الجهة الناظرة." });
  if (allocationTotal(s.allocation) > 100) m.push({ step: 6, text: "مجموع نسب توزيع الغلة يتجاوز 100%." });
  if (!s.waqfName.trim()) m.push({ step: 7, text: "اختر اسمًا للوقف." });
  return m;
}

const n = (v: string) => Number(String(v).replace(/,/g, "")) || 0;
const sar = (v: number) => `${new Intl.NumberFormat("ar-SA-u-nu-latn").format(v)} ريال`;
const TYPE_AR: Record<string, string> = { public: "وقف عام (خيري)", private: "وقف خاص (أهلي)", joint: "وقف مشترك" };

/** Indicative Arabic deed text. Never presented as final: the UI labels it as a draft needing legal and Sharia review. */
export function buildDeedDraft(s: EstablishState, today: string): string {
  const name = s.waqfName.trim() || "(اسم الوقف)";
  const founder = s.founder.name.trim() || "(اسم الواقف)";
  const t = classify(s.classification);
  const out: string[] = [];
  out.push("## البند الأول: المقدمة");
  out.push(`الحمد لله وحده، والصلاة والسلام على من لا نبي بعده. أما بعد، فإني أنا ${founder}، ${s.founder.nationality ? `${s.founder.nationality} الجنسية، ` : ""}وأنا بكامل أهليتي المعتبرة شرعًا ونظامًا، أقرّ بأني أوقفت وحبست وسبّلت ما هو مبيّن في هذه الوثيقة، ابتغاء وجه الله تعالى، وقفًا ${s.classification.duration === "temporary" && s.classification.durationYears ? `مؤقتًا لمدة ${s.classification.durationYears} سنة` : "مؤبدًا"} لا يُباع ولا يُوهب ولا يُورث، إلا وفق ما تقضي به الأحكام الشرعية والأنظمة المرعية.`);
  out.push("## البند الثاني: الأصل الموقوف");
  if (s.assets.length) {
    out.push(
      s.assets
        .map((a, i) => `${i + 1}. ${ASSET_CATEGORY_LABEL[a.category] ?? "أصل"}: ${a.title || "(وصف الأصل)"}${a.ownershipDocNo ? `، بموجب مستند الملكية رقم ${a.ownershipDocNo}` : ""}${a.sharePct && n(a.sharePct) < 100 ? `، وذلك حصة مشاعة قدرها ${a.sharePct}%` : ""}${n(a.value) ? `، وقيمته التقديرية ${sar(n(a.value))}` : ""}.`)
        .join("\n"),
    );
    out.push("ويشمل الوقف ما يتبع الأصل ويلحق به من حقوق ومرافق، ما لم يُستثنَ في هذه الوثيقة.");
  } else out.push("(تُذكر هنا الأصول الموقوفة بأوصافها المميزة ومستندات ملكيتها.)");
  out.push("## البند الثالث: اسم الوقف");
  out.push(`يُسمّى هذا الوقف «${name}»، وهو ${t.type ? TYPE_AR[t.type] : "(يُحدد نوعه)"}${s.classification.fieldOfWork ? `، ومجاله ${s.classification.fieldOfWork}` : ""}${s.classification.geographicScope ? `، ونطاقه الجغرافي ${s.classification.geographicScope}` : ""}.`);
  out.push("## البند الرابع: مصارف الوقف وطبقاته");
  if (s.classes.length) {
    const sorted = [...s.classes].sort((a, b) => n(a.tier) - n(b.tier));
    out.push(
      sorted
        .map((c, i) => {
          const rel = i === 0 ? "" : c.relation === "then" ? "ثم " : "و";
          const share = c.sharePct ? ` بنسبة ${c.sharePct}% من صافي الغلة` : "";
          const div = c.divisionRule ? `، ويُقسم بينهم ${DIVISION_LABEL[c.divisionRule] ?? ""}` : "";
          const sub = c.substitutionRule ? `، و${SUBSTITUTION_LABEL[c.substitutionRule] ?? ""}` : "";
          return `${rel}على ${c.name}${share}${div}${sub}.`;
        })
        .join("\n"),
    );
  } else out.push("(تُذكر هنا المصارف وأوصاف المستحقين وترتيبهم.)");
  if (s.finalDestination.trim()) out.push(`فإن انقرض المستحقون أو تعذّر الصرف عليهم صُرفت الغلة على ${s.finalDestination.trim()}.`);
  const conds = s.conditions.filter((c) => c.text.trim());
  if (conds.length) {
    out.push("ويشترط الواقف ما يأتي:");
    out.push(conds.map((c, i) => `${i + 1}. (${CONDITION_CATEGORY_LABEL[c.category] ?? "شرط"}) ${c.text.trim()}`).join("\n"));
  }
  out.push("## البند الخامس: ما استثناه الواقف لنفسه");
  out.push(
    s.founder.selfBenefit === "usufruct"
      ? `يستثني الواقف لنفسه الانتفاع بالأصل الموقوف مدة حياته${s.founder.selfBenefitNote ? `، ${s.founder.selfBenefitNote}` : ""}، ثم يعود الانتفاع إلى المصارف المذكورة.`
      : s.founder.selfBenefit === "yield"
        ? `يستثني الواقف لنفسه غلة الوقف أو جزءًا منها مدة حياته${s.founder.selfBenefitNote ? `، ${s.founder.selfBenefitNote}` : ""}، ثم تعود إلى المصارف المذكورة.`
        : "لم يستثنِ الواقف لنفسه شيئًا من منافع الوقف أو غلته.",
  );
  if (s.founder.powers.length) out.push(`ويحتفظ الواقف حال حياته بصلاحية: ${s.founder.powers.join("، ")}.`);
  out.push("## البند السادس: النظارة وأحكامها");
  const mode = s.nazara.mode;
  out.push(
    mode === "founder"
      ? "النظارة على هذا الوقف للواقف نفسه مدة حياته."
      : mode === "board"
        ? `يتولى النظارة على هذا الوقف مجلس نظارة${s.nazara.boardSize ? ` من ${s.nazara.boardSize} أعضاء` : ""}${s.nazara.nazirName ? `، هم: ${s.nazara.nazirName}` : ""}.`
        : mode
          ? `يتولى النظارة على هذا الوقف ${s.nazara.nazirName || "(اسم الناظر)"} (${NAZIR_MODE_LABEL_AR[mode] ?? ""}).`
          : "(تُحدد هنا صيغة النظارة واسم الناظر.)",
  );
  if (s.nazara.successionRule.trim()) out.push(`وتنتقل النظارة من بعده: ${s.nazara.successionRule.trim()}.`);
  if (n(s.nazara.feePct) || n(s.nazara.feeFixed))
    out.push(`ويستحق الناظر أجرة قدرها ${n(s.nazara.feePct) ? `${s.nazara.feePct}% من الغلة` : ""}${n(s.nazara.feePct) && n(s.nazara.feeFixed) ? " و" : ""}${n(s.nazara.feeFixed) ? `${sar(n(s.nazara.feeFixed))} سنويًا` : ""}.`);
  out.push("## البند السابع: واجبات الناظر وصلاحياته");
  out.push(
    `على الناظر عمارة الوقف وحفظه وتنميته، وتحصيل غلته وصرفها في مصارفه وفق شرط الواقف، وتسجيل الوقف وأصوله لدى الهيئة العامة للأوقاف، وفتح حساب بنكي باسم الوقف، وإمساك سجلات ودفاتر منتظمة، والإفصاح عما تقضي به الأنظمة.${s.nazara.duties.trim() ? ` ${s.nazara.duties.trim()}` : ""}`,
  );
  if (mode === "board") {
    out.push("## البند الثامن: اجتماعات مجلس النظارة وقراراته");
    out.push("يجتمع المجلس بدعوة من رئيسه، ويصح اجتماعه بحضور أغلبية أعضائه، وتصدر قراراته بأغلبية الحاضرين، وتُدوَّن في محاضر يوقعها الحاضرون، وعلى العضو الإفصاح عن أي تعارض في المصالح والامتناع عن التصويت فيه.");
  }
  const a = s.allocation;
  const parts = [
    ["عمارة الأصول وصيانتها", a.maintenancePct], ["تنمية الأصول", a.developmentPct], ["إعادة الاستثمار", a.reinvestPct], ["الاحتياطي", a.reservePct],
    ["أجرة الناظر", a.nazirFeePct], ["المصاريف الإدارية", a.adminPct],
  ].filter(([, v]) => n(v as string) > 0);
  out.push(`## البند ${mode === "board" ? "التاسع" : "الثامن"}: توزيع الغلة`);
  if (parts.length) {
    const rest = Math.max(0, 100 - allocationTotal(a));
    out.push(`تُقسم غلة الوقف الصافية على النحو الآتي: ${parts.map(([l, v]) => `${v}% لـ${l}`).join("، ")}، ويُصرف الباقي (${rest}%) على المستحقين وفق البند الرابع.`);
  } else out.push("تُقدَّم عمارة الوقف وما يحفظ أصله على الصرف على المستحقين، ثم يُصرف الباقي وفق البند الرابع.");
  if (a.notes.trim()) out.push(a.notes.trim());
  out.push(`## البند ${mode === "board" ? "العاشر" : "التاسع"}: الخاتمة`);
  out.push(`هذا ما أوقفه الواقف، وما لم يرد فيه نص في هذه الوثيقة يُرجع فيه إلى الأحكام الشرعية والأنظمة المرعية في المملكة العربية السعودية. ويُوثَّق هذا الوقف لدى الجهة المختصة، ويُغني التوثيق الرسمي عن التوقيع والإشهاد.\nحُررت هذه المسودة في ${today}.`);
  return out.join("\n\n");
}
