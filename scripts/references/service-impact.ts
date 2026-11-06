/**
 * Impact of the reference registry on the 64 services (offline; no database, no network, no service is touched).
 *
 *   npx tsx scripts/references/service-impact.ts
 *
 * Inputs:
 *  - data/references/impact/basis-2026-11-04.json: per service, the references and articles recorded in the review
 *    of 2026-11-04 (essential, auxiliary, guidance). Only the link service→reference→article is taken from there;
 *  - the registry (src/server/references/registry.ts) and the snapshot manifest: the state of each reference is
 *    computed now, never copied from the earlier review (its counts of 33 or 51 are not used);
 *  - ATTRS below: for each service, whether it needs a professional, a signature or an external act, and what the
 *    platform can provide (information, a draft, document preparation). These are the analyst's classification.
 * Output: data/references/reports/service-impact.json and service-impact.md.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PENDING_RETRIEVAL, REGISTRY, statusAt } from "../../src/server/references/registry";
import { loadManifest, REFERENCES_DIR } from "../../src/server/references/snapshots";
import { OUTCOME_LABEL_AR, type MatchOutcome } from "../../src/server/references/types";

const TODAY = "2026-11-06";

type Pair = [string, string];
type BasisService = { code: string; name: string; out: string; ess: Pair[]; aux: Pair[]; gd: Pair[]; verdict: string };
const basis = JSON.parse(readFileSync(path.join(REFERENCES_DIR, "impact", "basis-2026-11-04.json"), "utf8")) as { refs: Record<string, { name: string; kind: string }>; services: BasisService[] };

/** Codes of the 2026-11-04 review → registry ids (or PENDING_RETRIEVAL ids). Guides are not in the registry. */
const MAP: Record<string, string> = {
  GAA: "GAA-LAW", NZR: "NZR", PEN: "PEN-TABLE", BO: "BO-STD", DON: "DON", PRD: "PRD", PRT: "PRT", FND: "FND", UWD: "QWB", GOV: "GOV-PRIN",
  VPR: "NZR-VIOL", NZL: "NZR-LIC", ACC: "SOCPA-NPO", AML: "AML", PSL: "PSL", DOC: "TAWTHEEQ", CML: "CMA-LAW", VAL: "MUQAYYIMIN", NGO: "JAMEYAT",
  PROC: "MURAFAAT", LAWP: "MUHAMAH", EVD: "ITHBAT", PDPL: "PDPL", CIV: "CIVIL-TX", COM: "COMPANIES",
};

/** Additions made in this completion pass (new references and links found since 2026-11-04). */
const ADD: Record<string, { tier: "ess" | "aux"; ref: string; articles: string; reason: string }[]> = {
  N09: [{ tier: "ess", ref: "IHY", articles: "م4، م5 (حالات المجهول والمعطل)، م7–م9 (شروط البلاغ والتزامات المبلّغ)، م13 (طلب تعيين الناظر)، م19–م24 (الإحياء)، م27 (التظلم)", reason: "اللائحة النافذة التي حلت محل قواعد الإبلاغ؛ تحدد البلاغ والإحياء ومواعيدهما" }],
  N01: [
    { tier: "ess", ref: "NZR-LIC", articles: "لائحة النظارة م5/2", reason: "متطلب الترخيص منصوص عليه وإجراءاته غير منشورة: متابعة تنظيمية، لا يحجب دراسة الطلب ولا إعداد طلب التعيين" },
    { tier: "aux", ref: "IHY", articles: "م13 (إذا كان الوقف مجهولًا)", reason: "طريق تعيين الناظر على الوقف المجهول عبر الهيئة والمحكمة" },
  ],
  N07: [{ tier: "aux", ref: "BO-STD", articles: "م5/1/ج (البيانات المصرفية للمستفيد الحقيقي)، م5/4 (سجل المدفوعات)", reason: "بيانات الصرف وسجله؛ لا تطبق قبل ثبوت نفاذ المعايير" }],
};

type Attr = { prof: string; mode: string };
/** 7: professional / signature / external act — 8: what the platform can provide. */
const ATTRS: Record<string, Attr> = {
  C01: { prof: "لا يلزم مهني؛ اعتماد بشري للتقرير قبل إصداره", mode: "معلومات وتقرير تشخيصي (مسودة حتى الاعتماد)" },
  T01: { prof: "لا", mode: "معلومات ومسودة مذكرة تصميم" },
  T02: { prof: "لا", mode: "مسودة دراسة" },
  T03: { prof: "إجراء خارجي: توثيق الوقف لدى الجهة المختصة؛ توقيع الواقف", mode: "مسودة وثيقة وإعداد مستندات التوثيق" },
  T04: { prof: "مراجعة بشرية مختصة", mode: "مسودة تقرير مراجعة" },
  T05: { prof: "مقيّم معتمد إذا لزم تقييم", mode: "مسودة مصفوفة وتوصية" },
  T06: { prof: "إجراء خارجي: التوثيق ثم التسجيل لدى الهيئة", mode: "إعداد مستندات" },
  T07: { prof: "إجراء خارجي: مؤسسة سوق مالية مرخصة والتسجيل", mode: "إعداد مستندات ومسودة ملحق" },
  T08: { prof: "إجراء خارجي: طلب الترخيص لدى الهيئة", mode: "إعداد مستندات" },
  T09: { prof: "إجراء خارجي: قيد الكيان لدى جهته المختصة", mode: "مسودة مستندات التأسيس وإعدادها" },
  W01: { prof: "توقيع الموصي وإشهاده", mode: "مسودة نص الوصية" },
  W02: { prof: "إجراء خارجي: التوثيق", mode: "إعداد مستندات" },
  W03: { prof: "مراجعة بشرية مختصة", mode: "مسودة تقرير" },
  W04: { prof: "اعتماد الموصي", mode: "مسودة لائحة" },
  W05: { prof: "إجراء خارجي: التوثيق والتسجيل، وإجازة الورثة عند الاقتضاء", mode: "إعداد مستندات" },
  N01: { prof: "إجراء خارجي: قرار تعيين من الجهة المختصة؛ ومتطلب ترخيص (م5/2) غير محسوم تنظيميًا", mode: "دراسة ملف الوقف، ومسودة طلب التعيين، وإعداد مرفقاته؛ مباشرة النظارة لا تبدأ قبل وثيقة التعيين" },
  N02: { prof: "إجراء خارجي: العضوية بقرار من يملكه في الوقف", mode: "معلومات" },
  N03: { prof: "مستشار مختص", mode: "معلومات ومسودات للناظر" },
  N04: { prof: "تفويض مكتوب من الناظر (م11/4)", mode: "مسودة التفويض وتقارير تشغيل" },
  N05: { prof: "اعتماد المجلس للمحاضر", mode: "مسودات جداول ومحاضر" },
  N06: { prof: "لا", mode: "معلومات وتقارير متابعة" },
  N07: { prof: "اعتماد الناظر للصرف وتنفيذه من حساب الوقف", mode: "إعداد كشوف وسجل" },
  N08: { prof: "توقيع الناظرين؛ تحديث البيانات لدى الهيئة", mode: "إعداد محضر التسليم وحزمة المستندات" },
  N09: { prof: "إجراء خارجي: البلاغ عبر قناة الهيئة، والمحكمة عند الإثبات أو التعيين", mode: "إعداد ملف الإثبات ومسودة البلاغ وخطة الإحياء" },
  G01: { prof: "اعتماد الناظر أو المجلس", mode: "مسودات لوائح وسياسات" },
  G02: { prof: "اعتماد الناظر أو المجلس", mode: "مسودة" },
  G03: { prof: "اعتماد الناظر", mode: "مسودات مواثيق" },
  G04: { prof: "اعتماد المجلس", mode: "مسودة خطة" },
  G05: { prof: "اعتماد الناظر", mode: "مسودة دليل" },
  G06: { prof: "اعتماد الناظر", mode: "مسودة سياسة ونماذج" },
  G07: { prof: "اعتماد الناظر", mode: "مسودة سياسة" },
  G08: { prof: "توقيع مراجع داخلي مختص", mode: "مسودة داخلية" },
  G09: { prof: "اعتماد المجلس", mode: "مسودة تقرير" },
  G10: { prof: "اعتماد الناظر؛ مسؤول امتثال", mode: "مسودة برنامج وإعداد سجل" },
  F01: { prof: "لا", mode: "مسودة مذكرة" },
  F02: { prof: "محاسب", mode: "مسودة دليل حسابات" },
  F03: { prof: "محاسب", mode: "إعداد قيود ودفاتر" },
  F04: { prof: "اعتماد الناظر", mode: "مسودة موازنة" },
  F05: { prof: "اعتماد الناظر", mode: "مسودة بيان" },
  F06: { prof: "توقيع محاسب قانوني مرخص", mode: "إعداد مستندات للمراجع فقط؛ لا رأي آلي" },
  F07: { prof: "تقديم الناظر للهيئة", mode: "إعداد مستندات" },
  F08: { prof: "لا", mode: "تقرير من القيود" },
  F09: { prof: "إجراء خارجي: البنك", mode: "إعداد مستندات" },
  I01: { prof: "اعتماد الناظر أو المجلس", mode: "مسودة سياسة" },
  I02: { prof: "لا", mode: "مسودة مذكرة" },
  I03: { prof: "مختص", mode: "مسودة دراسة" },
  I04: { prof: "إجراء خارجي: إذن الجهة المختصة؛ مقيّم معتمد", mode: "إعداد ملف الطلب" },
  I05: { prof: "مؤسسة سوق مالية مرخصة", mode: "معلومات ومقارنة" },
  I06: { prof: "إجراء خارجي: التسجيل والقيد", mode: "إعداد مستندات" },
  I07: { prof: "لا", mode: "تقرير" },
  I08: { prof: "مقيّم معتمد للتقييم", mode: "إعداد سجل" },
  I09: { prof: "لا", mode: "مسودة خطة" },
  C02: { prof: "اعتماد بشري للتقرير", mode: "مسودة تقرير" },
  C03: { prof: "لا", mode: "مسودة تقرير وخطة" },
  C04: { prof: "إجراء خارجي: التمثيل أمام لجنة النظر في المخالفات بصاحب صفة", mode: "مسودة خطة تصحيحية وإعداد ملف" },
  C05: { prof: "اعتماد الناظر", mode: "مسودة تقرير" },
  C06: { prof: "اعتماد الناظر", mode: "مسودة تقارير" },
  C07: { prof: "توقيع مستشار شرعي", mode: "مسودة داخلية للمستشار فقط" },
  C08: { prof: "توقيع مرخص (محامٍ)", mode: "مسودة داخلية فقط" },
  C09: { prof: "مختص", mode: "مسودة رأي" },
  C10: { prof: "مختص؛ في حدود ما لا يتطلب ترخيص المشورة", mode: "معلومات عامة" },
  C11: { prof: "إجراء خارجي: الطلب إلى الواقف أو الجهة المختصة", mode: "مسودة طلب" },
  C12: { prof: "إجراء خارجي محتمل: المحكمة", mode: "مسودة اتفاق أو ملف إحالة" },
  C13: { prof: "محامٍ مرخص؛ المحكمة", mode: "مسودة مذكرة فقط" },
};

const manifest = loadManifest();
const reportOutcome = (refId: string): { outcome: MatchOutcome; candidate: string }[] => {
  const e = REGISTRY.find((x) => x.id === refId);
  return (e?.kbCandidates ?? []).map((c) => {
    try {
      const r = JSON.parse(readFileSync(path.join(REFERENCES_DIR, "reports", `${refId}__${path.basename(c.path, ".txt")}.json`), "utf8"));
      return { outcome: r.result.outcome as MatchOutcome, candidate: c.label };
    } catch {
      return { outcome: "unverifiable" as MatchOutcome, candidate: c.label };
    }
  });
};

export type Classification = "معتمد" | "مكتمل فنياً – غير معتمد نظامياً" | "معلق" | "غير مكتمل" | "غير صالح للاستخدام";

type RefState = { id: string; name: string; binding: string; status: string; verification: string; classification: Classification; citable: false };

const BIND_AR: Record<string, string> = { binding: "ملزم", guidance: "إرشادي", professional: "مهني" };

function refState(code: string): RefState {
  const id = MAP[code] ?? code;
  const e = REGISTRY.find((x) => x.id === id);
  if (!e) {
    const p = PENDING_RETRIEVAL.find((x) => x.id === id);
    if (p) return { id, name: p.name, binding: "ملزم", status: "غير مسترجع", verification: `لم يُسترجع نصه: ${p.reason}`, classification: "غير مكتمل", citable: false };
    const g = basis.refs[code];
    return { id: code, name: g?.name ?? code, binding: /دليل|مبادئ|تثقيفية/.test(g?.kind ?? "") ? "إرشادي" : "غير محدد", status: "غير مسجل", verification: "مرجع إرشادي أو تثقيفي غير مسجل في سجل المراجع؛ لم يُطابق بمصدر رسمي", classification: "غير مكتمل", citable: false };
  }
  const st = statusAt(e, TODAY);
  const text = manifest.find((m) => m.refId === id && m.role === "text");
  const outcomes = reportOutcome(id);
  let verification: string;
  let cls: Classification;
  if (st === "repealed") {
    verification = "ملغى: يُحفظ تاريخيًا ولا يُستند إليه لمخرج جديد";
    cls = "غير صالح للاستخدام";
  } else if (st === "unknown") {
    verification = `حالة النفاذ غير ثابتة: ${"unknownReason" in e.status ? e.status.unknownReason : ""}`.trim();
    cls = e.structuredData?.length || text ? "معلق" : "غير مكتمل";
  } else if (!text) {
    verification = "ساري، ولم يُحفظ نص رسمي له";
    cls = "غير مكتمل";
  } else {
    const o = outcomes.length ? outcomes.map((x) => `${x.candidate}: ${OUTCOME_LABEL_AR[x.outcome]}`).join("؛ ") : "لا نسخة في قاعدة المعرفة";
    verification = `نص رسمي محفوظ (عبر وسيط، لم يُؤكد مباشرة)؛ المطابقة: ${o}؛ لم تُراجع بشريًا`;
    cls = "مكتمل فنياً – غير معتمد نظامياً";
  }
  if (id === "SOCPA-NPO") cls = "معلق";
  return { id, name: e.officialName, binding: BIND_AR[e.binding] ?? e.binding, status: st, verification, classification: cls, citable: false };
}

type Row = {
  code: string;
  name: string;
  output: string;
  refs: (RefState & { tier: "جوهري" | "مساعد" | "إرشادي"; articles: string; reason: string })[];
  missingImpact: string;
  professional: string;
  provision: string;
  classification: Classification;
  n01Note?: string;
};

const TIER_AR = { ess: "جوهري", aux: "مساعد", gd: "إرشادي" } as const;
const reasonOf = (tier: keyof typeof TIER_AR, articles: string) => {
  const m = articles.match(/\(([^)]+)\)/);
  if (m) return m[1];
  return tier === "ess" ? "يقوم عليه مضمون المخرج" : tier === "aux" ? "يُرجع إليه في جزء من المخرج" : "استرشادي للمنهجية والصياغة";
};

const rows: Row[] = basis.services.map((s) => {
  const refs: Row["refs"] = [];
  for (const tier of ["ess", "aux", "gd"] as const)
    for (const [code, articles] of s[tier]) {
      const st = refState(code);
      if (refs.some((r) => r.id === st.id && r.tier === TIER_AR[tier])) continue;
      refs.push({ ...st, tier: TIER_AR[tier], articles: articles || "غير محددة في المراجعة", reason: reasonOf(tier, articles) });
    }
  for (const a of ADD[s.code] ?? []) {
    const add = { ...refState(a.ref), tier: TIER_AR[a.tier], articles: a.articles, reason: a.reason };
    const i = refs.findIndex((r) => r.id === add.id);
    if (i >= 0) refs[i] = add;
    else refs.push(add);
  }
  for (const r of refs) if (r.classification === "غير صالح للاستخدام") r.articles = r.articles.replace(/\s*\(مشروع[^)]*\)/, "");
  for (const r of refs) if (r.classification === "غير صالح للاستخدام") r.reason = `سجل تاريخي: ${REGISTRY.find((e) => e.id === r.id)?.repealedBy.length ? `ملغى، حل محله ${REGISTRY.find((e) => e.id === r.id)!.repealedBy.map((x) => REGISTRY.find((e) => e.id === x.refId)?.officialName ?? x.refId).join("، ")}` : "ملغى"}`;
  // QWB is historical: kept on N09 as such, never as a basis
  const ess = refs.filter((r) => r.tier === "جوهري" && r.id !== "NZR-LIC");
  const blockingEss = ess.filter((r) => r.classification !== "معتمد");
  let missingImpact: string;
  if (!ess.length) missingImpact = "لا مرجع ملزم جوهري؛ غياب المراجع لا يمنع تقديم الخدمة يدويًا، ويقتصر المحرك على المنهجية والحساب";
  else if (blockingEss.length)
    missingImpact = `لا يُستشهد في مخرج للعميل بنص من: ${blockingEss.map((r) => r.name).join("، ")}، حتى تُعتمد المطابقة؛ تبقى الخدمة اليدوية قائمة بمراجعة بشرية، ويعرض المحرك المرجع اسمًا وحالةً دون اقتباس`;
  else missingImpact = "المراجع الجوهرية معتمدة";
  const a = ATTRS[s.code] ?? { prof: "غير محدد", mode: "غير محدد" };
  const allCls = ess.map((r) => r.classification);
  const classification: Classification = !ess.length ? "مكتمل فنياً – غير معتمد نظامياً" : allCls.includes("غير مكتمل") ? "غير مكتمل" : allCls.includes("معلق") ? "معلق" : allCls.includes("غير صالح للاستخدام") ? "غير مكتمل" : "مكتمل فنياً – غير معتمد نظامياً";
  const row: Row = { code: s.code, name: s.name, output: s.out, refs, missingImpact, professional: a.prof, provision: a.mode, classification };
  if (s.code === "N01")
    row.n01Note =
      "فجوة الترخيص (NZR-LIC) لا تعطل الخدمة آليًا: تُدرس الطلبات ويُعد طلب التعيين ومرفقاته، ويُعرض متطلب م5/2 كما ورد مع بيان عدم نشر إجراءاته، والقرار للجهة المختصة. لا يُذكر أن الشركة ناظر قبل وثيقة التعيين، ولا يقوم عقد الإدارة مقام التعيين. إعداد الطلب ليس صدور التعيين.";
  return row;
});

if (rows.length !== 64) throw new Error(`expected 64 services, got ${rows.length}`);
for (const r of rows) if (!ATTRS[r.code]) throw new Error(`${r.code}: no attributes`);

const outDir = path.join(REFERENCES_DIR, "reports");
writeFileSync(path.join(outDir, "service-impact.json"), JSON.stringify({ ranAt: TODAY, rows }, null, 1));

const L: string[] = [];
L.push(`# أثر سجل المراجع على الخدمات الـ64 — ${TODAY}`, "");
L.push("الحالة محسوبة من السجل الحالي، لا من أرقام مراجعة 2026-11-04. لا يُستشهد بنص أي مرجع في مخرج للعميل حتى الآن: لم تُعتمد أي مطابقة بشريًا. لم تُفعّل أي خدمة ولم تُربط بالمحرك.", "", "تصنيف الخدمة يصف حال سندها المرجعي الجوهري لا جاهزيتها للتشغيل: «مكتمل فنياً – غير معتمد نظامياً» يعني أن كل مرجع جوهري لها محفوظ من مصدر رسمي ومطابق آليًا دون اعتماد بشري، أو أنها بلا مرجع ملزم جوهري؛ «معلق» أن مرجعًا جوهريًا حالته أو قرار بشأنه معلق؛ «غير مكتمل» أن مرجعًا جوهريًا لم يُسترجع. لا خدمة «معتمدة».", "");
const byCls = new Map<string, number>();
rows.forEach((r) => byCls.set(r.classification, (byCls.get(r.classification) ?? 0) + 1));
L.push("| التصنيف | عدد الخدمات |", "|---|---|", ...[...byCls].map(([k, v]) => `| ${k} | ${v} |`), "");
for (const r of rows) {
  L.push(`## ${r.code} — ${r.name}`, "", `المخرج: ${r.output}. التصنيف: **${r.classification}**.`, "");
  L.push("| المرجع | الدرجة | المواد | السبب | حالة التحقق | ملزم/إرشادي/مهني | التصنيف |", "|---|---|---|---|---|---|---|");
  for (const x of r.refs) L.push(`| ${x.name} | ${x.tier} | ${x.articles} | ${x.reason} | ${x.verification} | ${x.binding} | ${x.classification} |`);
  if (!r.refs.length) L.push("| — | | | | | | |");
  L.push("", `- أثر غياب المرجع: ${r.missingImpact}.`, `- يحتاج مهنيًا أو توقيعًا أو إجراءً خارجيًا: ${r.professional}.`, `- ما يمكن تقديمه: ${r.provision}.`);
  if (r.n01Note) L.push(`- النظارة الاعتبارية: ${r.n01Note}`);
  L.push("");
}
writeFileSync(path.join(outDir, "service-impact.md"), L.join("\n") + "\n");
console.log([...byCls].map(([k, v]) => `${k}: ${v}`).join("\n"));
