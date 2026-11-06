/**
 * Acceptance cases of the unified knowledge engine: real retrieval over the knowledge base loaded from the catalog
 * (public reference texts), synthetic waqf facts only. Shared by the test (tests/knowledge-acceptance.test.ts) and the
 * report (scripts/knowledge/acceptance-report.ts). The acceptance criterion is the retrieved text, its source, its
 * applicability and the accuracy of the locator — not merely that a query ran.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "../../src/server/db";
import { kbSourceReviews, kbSources } from "../../src/server/db/schema";
import { appendMatchRun, appendReview, appendVersion, registerSource } from "../../src/server/references/db-store";
import { getEntry } from "../../src/server/references/registry";
import { loadManifest, versionFromSnapshot } from "../../src/server/references/snapshots";
import { loadCatalog, KNOWLEDGE_DIR } from "../../src/server/knowledge/catalog";
import type { RefKind } from "../../src/server/knowledge/policy";
import { retrieve, type RetrieveQuery, type RetrieveResult } from "../../src/server/knowledge/retrieve";

export const SYNTHETIC_REVIEWER = "00000000-0000-4000-8000-00000000ae01";
const TODAY = "2026-11-06";

/** Records, inside the caller's (rolled-back) transaction, an accepted comparison of an official snapshot. */
export async function acceptRegistry(tx: Tx, registryId: string, snapshotId: string, articles: number[], effectiveFrom: string) {
  const entry = getEntry(registryId)!;
  const snap = loadManifest().find((m) => m.id === snapshotId)!;
  const srcId = await registerSource(tx, entry);
  const v = versionFromSnapshot(snap, effectiveFrom, `${snapshotId} (اختبار)`);
  const vId = await appendVersion(tx, srcId, v);
  const perArticle = Object.fromEntries(articles.map((a) => [`م${a}`, "identical"])) as Record<string, "identical">;
  const runId = await appendMatchRun(tx, vId, { id: "x", versionId: vId, candidateLabel: "اختبار قبول", candidateSha256: v.source.sha256, outcome: "identical", perArticle, ranAt: `${TODAY}T08:00:00Z` }, { synthetic: true });
  await appendReview(tx, runId, { reviewer: "مراجع اصطناعي", reviewerUserId: SYNTHETIC_REVIEWER, at: `${TODAY}T09:00:00Z`, decision: "accepted", note: "مراجعة اصطناعية لاختبار القبول" });
}

/** Records an accepted (or rejected) human review of the current knowledge-base source. */
export async function reviewSource(tx: Tx, refCode: string, decision: "accepted" | "rejected" = "accepted") {
  const [s] = await tx.select({ id: kbSources.id }).from(kbSources).where(and(eq(kbSources.refCode, refCode), isNull(kbSources.supersededAt))).limit(1);
  await tx.insert(kbSourceReviews).values({ sourceId: s!.id, reviewerUserId: SYNTHETIC_REVIEWER, decision, note: "مراجعة اصطناعية لاختبار القبول" });
}

/** The original text the unit must come from: the official snapshot, the extracted page, or the verified quotation. */
export function originalText(refCode: string): string {
  const e = loadCatalog().find((x) => x.refCode === refCode)!;
  const p = JSON.parse(gunzipSync(readFileSync(path.join(KNOWLEDGE_DIR, e.text))).toString("utf8")) as { text?: string; pages?: { text: string }[]; quotes?: { quote: string }[] };
  return p.text ?? p.pages?.map((x) => x.text).join("\n") ?? p.quotes?.map((q) => q.quote).join("\n") ?? "";
}
export type CaseRow = {
  id: string;
  category: string;
  question: string;
  service: string | null;
  expected: string;
  retrievedRef: string | null;
  retrievedKind: RefKind | null;
  locator: string | null;
  excerpt: string | null;
  matchesOriginal: boolean | null;
  latestVersion: boolean | null;
  applicable: boolean | null;
  citable: boolean;
  decision: string;
  sufficient: boolean;
  pass: boolean;
  note: string;
};

export type Case = {
  id: string;
  category: string;
  query: RetrieveQuery;
  expected: string;
  setup?: (tx: Tx) => Promise<void>;
  /** Judges the result: returns null when it passes, else what is wrong. */
  judge: (r: RetrieveResult, row: CaseRow) => string | null;
};

const top = (r: RetrieveResult, ref?: string) => (ref ? r.results.find((x) => x.hit.refCode === ref) : r.results[0]) ?? null;
const refusalOf = (d: { citable: boolean }) => (d.citable ? "citable" : (d as unknown as { refusal: string; detail: string }).refusal);

export const CASES: Case[] = [
  {
    id: "1a", category: "1. مادة نظامية برقمها (قبل اعتماد المطابقة)",
    query: { question: "ما نص المادة 16 من لائحة تنظيم أعمال النظارة في استثمار الوقف؟", service: "I01", asOf: TODAY, refCodes: ["NAZARA-REG"] },
    expected: "لائحة تنظيم أعمال النظارة م16 — تُسترجع ولا يُستشهد بها لأن المطابقة لم تُعتمد",
    judge: (r) => {
      const h = top(r, "NAZARA-REG");
      if (!h || h.hit.articleNo !== 16) return "لم تُسترجع المادة 16";
      if (h.decision.citable) return "استُشهد بها دون مراجعة معتمدة";
      return r.sufficiency.sufficient ? "عُدّت المراجع كافية" : null;
    },
  },
  {
    id: "1b", category: "1. مادة نظامية برقمها (بعد مراجعة اصطناعية معتمدة)",
    query: { question: "ما نص المادة 16 الفقرة 3 من لائحة تنظيم أعمال النظارة؟", service: "I01", asOf: TODAY, refCodes: ["NAZARA-REG"], needBinding: true },
    expected: "م16/ف3 قابلة للاستشهاد، ملزمة، مع رابط الجريدة",
    setup: (tx) => acceptRegistry(tx, "NZR", "NZR/uqn-p18926", [8, 16], "2022-02-04"),
    judge: (r) => {
      const h = r.citable[0];
      if (!h || h.hit.locator !== "م16/ف3") return `أول مقطع قابل للاستشهاد ${h?.hit.locator ?? "لا شيء"}`;
      if (!(h.decision.citable && h.decision.binding)) return "لم يُعدّ ملزمًا";
      return r.sufficiency.sufficient ? null : "لم تُعدّ كافية";
    },
  },
  {
    id: "2", category: "2. حكم من نص نظامي بوصف المسألة",
    query: { question: "ما المدة التي يجب على الناظر خلالها تسجيل الوقف والأصول الموقوفة لدى الهيئة؟", service: "N01", asOf: TODAY },
    expected: "لائحة النظارة م8/ف1 (ثلاثين يوم عمل)",
    setup: (tx) => acceptRegistry(tx, "NZR", "NZR/uqn-p18926", [8, 16], "2022-02-04"),
    judge: (r) => {
      const h = r.citable[0];
      return h && h.hit.refCode === "NAZARA-REG" && h.hit.locator === "م8/ف1" && h.hit.text.includes("ثلاثين يوم عمل") ? null : `المسترجع: ${h?.hit.refCode ?? "—"} ${h?.hit.locator ?? ""}`;
    },
  },
  {
    id: "3", category: "3. نص من ملف PDF مرفق بالمشروع",
    query: { question: "ما الأصول التي يمكن وقفها من المنقولات وكيف تثبت؟", service: "T05", asOf: TODAY, refCodes: ["ASSETS-GUIDE"] },
    expected: "الدليل الإرشادي لاختيار الأصول الوقفية — صفحة محددة؛ غير ملزم",
    setup: (tx) => reviewSource(tx, "ASSETS-GUIDE"),
    judge: (r) => {
      const h = r.citable[0];
      if (!h || h.hit.refCode !== "ASSETS-GUIDE" || !h.hit.pageFile) return "لم يُسترجع بصفحته";
      return h.decision.citable && !h.decision.binding ? null : "وُصف بأنه ملزم";
    },
  },
  {
    id: "4", category: "4. نص فقهي مع الجزء والصفحة",
    query: { question: "هل يلزم الوقف بمجرد القول دون حكم حاكم في المذهب الحنبلي؟", service: "C07", asOf: TODAY, kinds: ["classical_fiqh"] },
    expected: "شرح منتهى الإرادات ج2 ص425 أو كشاف القناع بالجزء والصفحة",
    setup: async (tx) => { await reviewSource(tx, "FQH-SHARH-MUNTAHA"); await reviewSource(tx, "FQH-KASHSHAF"); },
    judge: (r) => {
      const h = r.citable[0];
      if (!h) return "لا مقطع قابل للاستشهاد";
      if (!/^ج\d+ ص\d+/.test(h.hit.locator)) return `الموضع بلا جزء وصفحة: ${h.hit.locator}`;
      return /لازم/.test(h.hit.text.replace(/[ً-ْ]/g, "")) ? null : "النص لا يتناول اللزوم";
    },
  },
  {
    id: "5", category: "5. معيار محاسبي مع الإصدار",
    query: { question: "ما الإفصاحات المطلوبة عن مساهمات الواقف في القوائم المالية للأوقاف؟", service: "F05", asOf: TODAY, kinds: ["professional_standard"] },
    expected: "المعايير المحاسبية للمنشآت غير الهادفة للربح (المحدثة) مع الفقرة والإصدار",
    setup: (tx) => reviewSource(tx, "SOCPA-NPO-2025"),
    judge: (r) => {
      const h = r.citable[0];
      if (!h || h.hit.refCode !== "SOCPA-NPO-2025") return `المسترجع ${h?.hit.refCode ?? "—"}`;
      return h.hit.version && h.hit.version !== "غير محدد" && !h.decision.citable === false && !(h.decision as { binding: boolean }).binding ? null : "الإصدار أو الطبيعة غير ظاهرين";
    },
  },
  {
    id: "6a", category: "6. دليل استثماري مع طبيعته ونطاقه",
    query: { question: "ما مسؤوليات لجنة الاستثمار في المنظمات غير الربحية؟", service: "I03", asOf: TODAY, refCodes: ["INVEST-RULES"] },
    expected: "دليل قواعد وضوابط الاستثمار — دليل رسمي إرشادي، غير ملزم، لا يكفي سندًا ملزمًا",
    setup: (tx) => reviewSource(tx, "INVEST-RULES"),
    judge: (r) => {
      const h = r.citable[0];
      if (!h || h.hit.refKind !== "official_guide") return "لم يُسترجع بطبيعته";
      return h.decision.citable && !h.decision.binding && h.decision.label.startsWith("دليل رسمي إرشادي") ? null : "وسم الطبيعة غير صحيح";
    },
  },
  {
    id: "6b", category: "6. الدليل نفسه لخدمة غير مربوطة به",
    query: { question: "ما مسؤوليات لجنة الاستثمار في المنظمات غير الربحية؟", service: "T07", asOf: TODAY, refCodes: ["INVEST-RULES"] },
    expected: "غير منطبق على T07",
    setup: (tx) => reviewSource(tx, "INVEST-RULES"),
    judge: (r) => (r.results.length && r.results.every((x) => refusalOf(x.decision) === "not_applicable") && !r.sufficiency.sufficient ? null : "رُبط بخدمة غير مربوطة به"),
  },
  {
    id: "7", category: "7. بيانات إحصائية لخدمة T02 مع تاريخها ومصدرها",
    query: { question: "كم بلغ معدل البطالة بين السعوديين في الربع الأول من عام 2025؟", service: "T02", asOf: TODAY, kinds: ["statistical_source", "dataset"] },
    expected: "الهيئة العامة للإحصاء — نشرة سوق العمل للربع الأول 2025 (خبر 29-06-2025): 6.3%",
    setup: (tx) => reviewSource(tx, "GASTAT-LFS"),
    judge: (r) => {
      const h = r.citable[0];
      return h && h.hit.refCode === "GASTAT-LFS" && h.hit.text.includes("6.3%") && /\d{2}-\d{2}-\d{4}/.test(h.hit.locator) ? null : `المسترجع ${h?.hit.refCode ?? "—"} ${h?.hit.locator ?? ""}`;
    },
  },
  {
    id: "8", category: "8. نص OCR أو ملف معيب",
    query: { question: "ما اختصاصات الهيئة العامة للأوقاف في نظامها؟", service: "T01", asOf: TODAY, refCodes: ["GAA-LAW"] },
    expected: "نظام الهيئة — نص OCR من ملف ممسوح: يُسترجع للبحث، ولا يُستشهد به (لا نص رسمي محفوظ في السجل)",
    judge: (r) => {
      const h = top(r, "GAA-LAW");
      if (!h) return "لم يُسترجع";
      if (h.decision.citable) return "استُشهد بنص OCR";
      if ((h.decision as { refusal: string }).refusal !== "registry_refused") return `سبب الرفض ${(h.decision as { refusal: string }).refusal}`;
      return h.hit.quality === "degraded" && !r.sufficiency.sufficient ? null : "لم يُوسم النص بأنه معيب";
    },
  },
  {
    id: "9a", category: "9. مرجع ملغى حلت محله لائحة أحدث (سؤال حالي)",
    query: { question: "ما مكافأة المبلغ عن الأوقاف المجهولة والمندثرة؟", service: "N09", asOf: TODAY, refCodes: ["REPORTING-RULES", "REVIVAL-REG"] },
    expected: "القواعد الملغاة لا تُستعمل؛ لائحة الإحياء م17 هي النص الحالي",
    setup: (tx) => acceptRegistry(tx, "IHY", "IHY/uqn-4001990", [17], "2026-08-25"),
    judge: (r) => {
      const old = r.results.filter((x) => x.hit.refCode === "REPORTING-RULES");
      if (old.some((x) => x.decision.citable)) return "استُعمل المرجع الملغى";
      const h = r.citable[0];
      return h && h.hit.refCode === "REVIVAL-REG" && h.hit.articleNo === 17 ? null : `المسترجع ${h?.hit.refCode ?? "—"} ${h?.hit.locator ?? ""}`;
    },
  },
  {
    id: "9b", category: "9. نسخة سابقة بعد تسجيل نسخة أحدث",
    query: { question: "ما نص المادة الثامنة من نظام المعاملات المدنية؟", service: "C08", asOf: TODAY, refCodes: ["CIVIL-TX"], historical: false },
    expected: "لا يعود الصف السابق (المستبدل) إلا لسؤال تاريخي",
    judge: (r) => (r.results.every((x) => !x.hit.superseded) ? null : "عادت نسخة مستبدلة لسؤال حالي"),
  },
  {
    id: "10", category: "10. مرجع غير منطبق على الخدمة",
    query: { question: "ما حكم استبدال الوقف إذا تعطلت منافعه؟", service: "F02", asOf: TODAY, kinds: ["classical_fiqh"] },
    expected: "الكتب الفقهية غير مربوطة بخدمة F02 (دليل الحسابات)",
    setup: (tx) => reviewSource(tx, "FQH-KASHSHAF"),
    judge: (r) => (r.citable.length === 0 && !r.sufficiency.sufficient ? null : `استُشهد بـ ${r.citable[0]?.hit.refCode}`),
  },
  {
    id: "11", category: "11. سؤال لا سند كافيًا له",
    query: { question: "ما حكم وقف رمز مشفّر على كوكب المريخ لصالح مركبات فضائية؟", service: "C07", asOf: TODAY },
    expected: "«المراجع غير كافية» دون نص",
    judge: (r) => (!r.sufficiency.sufficient && r.citable.length === 0 ? null : "قُدّم سند لسؤال بلا سند"),
  },
  {
    id: "12", category: "12. منع الاستشهاد بنص غير موجود",
    query: { question: "ما نص المادة 99 من لائحة تنظيم أعمال النظارة؟", service: "I01", asOf: TODAY, refCodes: ["NAZARA-REG"] },
    expected: "لا مادة 99: لا شيء قابل للاستشهاد",
    setup: (tx) => acceptRegistry(tx, "NZR", "NZR/uqn-p18926", [8, 16], "2022-02-04"),
    judge: (r) => (r.citable.every((x) => x.hit.articleNo !== 99) && !r.results.some((x) => x.hit.articleNo === 99) ? null : "ظهرت مادة 99"),
  },
  {
    id: "13", category: "13. منع الخلط بين المرجع الرسمي والبحث الأكاديمي",
    query: { question: "ما أهمية وجود معايير محاسبية للوقف الإسلامي؟", service: "F02", asOf: TODAY, needBinding: true },
    expected: "الدراسة الأكاديمية تُوسم «دراسة أكاديمية» ولا تكفي حين يلزم سند ملزم",
    setup: (tx) => reviewSource(tx, "ACC-STUDY"),
    judge: (r) => {
      const h = r.citable.find((x) => x.hit.refCode === "ACC-STUDY");
      if (!h) return "لم تُسترجع الدراسة";
      if (!h.decision.citable || h.decision.binding || !h.decision.label.startsWith("دراسة أكاديمية")) return "وُسمت بغير طبيعتها";
      return r.sufficiency.sufficient ? "عُدّت كافية سندًا ملزمًا" : null;
    },
  },
];

/** Cases reported but not asserted: known limits of the current retrieval, kept visible in the acceptance report. */
export const KNOWN_LIMITS: Case[] = [
  {
    id: "7L", category: "7. (قيد معروف) سؤال عربي ومصدره المحفوظ بالإنجليزية",
    query: { question: "كم بلغ إجمالي عدد سكان المملكة في تعداد 2022؟", service: "T02", asOf: TODAY, kinds: ["statistical_source", "dataset"] },
    expected: "خبر واس 31 مايو 2023 (بالإنجليزية): 32,175,224",
    setup: (tx) => reviewSource(tx, "SPA-CENSUS-2023"),
    judge: (r) => (r.citable[0]?.hit.refCode === "SPA-CENSUS-2023" ? null : "البحث النصي لا يصل إلى مصدر بلغة أخرى؛ يلزم نص عربي للمصدر أو بحث دلالي متعدد اللغات"),
  },
];

export async function runCase(tx: Tx, c: Case): Promise<CaseRow> {
  if (c.setup) await c.setup(tx);
  const r = await retrieve(tx, c.query);
  const h = r.citable[0] ?? r.results[0] ?? null;
  const row: CaseRow = {
    id: c.id, category: c.category, question: c.query.question, service: c.query.service, expected: c.expected,
    retrievedRef: h?.hit.refCode ?? null, retrievedKind: h?.hit.refKind ?? null, locator: h?.hit.locator ?? null, excerpt: h ? h.hit.text.replace(/\s+/g, " ").slice(0, 220) : null,
    matchesOriginal: h ? originalText(h.hit.refCode).replace(/\s+/g, " ").includes(h.hit.text.replace(/^\[[^\]]+\]\s*/, "").split("\n").slice(-1)[0]!.replace(/\s+/g, " ").trim().slice(0, 80)) : null,
    latestVersion: h ? !h.hit.superseded : null, applicable: h ? refusalOf(h.decision) !== "not_applicable" : null,
    citable: !!h?.decision.citable, decision: h ? (h.decision.citable ? `قابل للاستشهاد — ${h.decision.label}` : `مرفوض: ${(h.decision as { detail: string }).detail}`) : "لا نتيجة",
    sufficient: r.sufficiency.sufficient, pass: false, note: "",
  };
  const why = c.judge(r, row);
  row.pass = why === null;
  row.note = why ?? (r.sufficiency.sufficient ? "" : (r.sufficiency as { reason: string }).reason);
  return row;
}
