/**
 * Acceptance cases of the unified knowledge engine: real retrieval over the knowledge base loaded from the catalog
 * (public reference texts), synthetic waqf facts and synthetic reviewers only. Shared by the test
 * (tests/knowledge-acceptance.test.ts) and the report (scripts/knowledge/acceptance-report.ts).
 *
 * The criterion is the retrieved passage itself — exact source and locator, a key phrase of the answer, its decision —
 * not that a query ran. Revised after the independent review (2026-11-06): each case names the passage expected; the
 * "no basis" case runs with every source reviewed; the version case loads a newer version; the probes that broke the
 * first version (altered official text, nonsense question, missing article, a contemporary book on the school's view,
 * OCR text, a reviewer of the wrong field) are cases of their own.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "../../src/server/db";
import { kbChunks, kbSourceReviews, kbSources, users } from "../../src/server/db/schema";
import { appendMatchRun, appendReview, appendVersion, registerSource } from "../../src/server/references/db-store";
import { getEntry } from "../../src/server/references/registry";
import { loadManifest, versionFromSnapshot } from "../../src/server/references/snapshots";
import { loadCatalog, KNOWLEDGE_DIR, unitsOf } from "../../src/server/knowledge/catalog";
import { ingestUnits } from "../../src/server/knowledge/ingest";
import { DEFAULT_REVIEW_ROLE, type RefKind, type ReviewRole } from "../../src/server/knowledge/policy";
import { retrieve, type RetrieveQuery, type RetrieveResult } from "../../src/server/knowledge/retrieve";
import { statuteUnits } from "../../src/server/knowledge/units";

export const SYNTHETIC_REVIEWER = "00000000-0000-4000-8000-00000000ae01";
const TODAY = "2026-11-06";

async function syntheticReviewer(tx: Tx) {
  await tx.insert(users).values({ id: SYNTHETIC_REVIEWER, phone: "0500000999", fullName: "مراجع اصطناعي (اختبار)" }).onConflictDoNothing();
}

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

async function currentSource(tx: Tx, refCode: string) {
  const [s] = await tx.select().from(kbSources).where(and(eq(kbSources.refCode, refCode), isNull(kbSources.supersededAt))).limit(1);
  return s!;
}

/**
 * Records an accepted (or rejected) review of the current source by a synthetic reviewer of the source's field (or of
 * the given field), and of its passages: `passages` = locators, or "all" for every passage of the source.
 */
export async function reviewSource(tx: Tx, refCode: string, o: { decision?: "accepted" | "rejected"; role?: ReviewRole; passages?: string[] | "all" } = {}) {
  await syntheticReviewer(tx);
  const s = await currentSource(tx, refCode);
  const role = o.role ?? ((s.meta as { reviewRole?: ReviewRole }).reviewRole ?? DEFAULT_REVIEW_ROLE[s.refKind as RefKind]);
  const note = "مراجعة اصطناعية لاختبار القبول";
  await tx.insert(kbSourceReviews).values({ sourceId: s.id, reviewerUserId: SYNTHETIC_REVIEWER, reviewerRole: role, decision: o.decision ?? "accepted", note });
  if (o.passages) {
    const chunks = await tx.select({ id: kbChunks.id, locator: kbChunks.locator }).from(kbChunks).where(eq(kbChunks.sourceId, s.id));
    const pick = o.passages === "all" ? chunks : chunks.filter((c) => (o.passages as string[]).includes(c.locator));
    for (let i = 0; i < pick.length; i += 500) await tx.insert(kbSourceReviews).values(pick.slice(i, i + 500).map((c) => ({ sourceId: s.id, chunkId: c.id, reviewerUserId: SYNTHETIC_REVIEWER, reviewerRole: role, decision: o.decision ?? "accepted", note })));
  }
}

const ROLE_SQL = sql.raw(`coalesce(s.meta->>'reviewRole', case when s.ref_kind in ('classical_fiqh','contemporary_book') then 'sharia' when s.ref_kind = 'professional_standard' then 'accounting' when s.ref_kind in ('statistical_source','dataset') then 'data' else 'legal' end)`);

/** Every current source reviewed, with all its passages (the worst case for a question without a basis). */
async function reviewEverything(tx: Tx) {
  await syntheticReviewer(tx);
  await tx.execute(sql`insert into kb_source_reviews (source_id, reviewer_user_id, reviewer_role, decision, note)
    select s.id, ${SYNTHETIC_REVIEWER}::uuid, ${ROLE_SQL}, 'accepted', 'مراجعة اصطناعية شاملة' from kb_sources s where s.superseded_at is null`);
  await tx.execute(sql`insert into kb_source_reviews (source_id, chunk_id, reviewer_user_id, reviewer_role, decision, note)
    select s.id, c.id, ${SYNTHETIC_REVIEWER}::uuid, ${ROLE_SQL}, 'accepted', 'مراجعة اصطناعية شاملة' from kb_chunks c join kb_sources s on s.id = c.source_id where s.superseded_at is null`);
}

/** The original unit the passage must come from: the same paragraph of the snapshot, the same page, the same quote. */
export function originalUnitText(refCode: string, locator: string): string | null {
  const e = loadCatalog().find((x) => x.refCode === refCode);
  if (!e) return null;
  if (e.textForm === "statute" && e.registrySnapshot) {
    const p = JSON.parse(gunzipSync(readFileSync(path.join(KNOWLEDGE_DIR, e.text))).toString("utf8")) as { text: string };
    return statuteUnits(p.text).find((u) => u.locator === locator)?.text ?? null;
  }
  return unitsOf(e).units.find((u) => u.locator === locator)?.text ?? null;
}
const nrm = (s: string) => s.replace(/[ً-ْـ]/g, "").replace(/\s+/g, " ").trim();

export type CaseRow = {
  id: string; category: string; question: string; service: string; expected: string;
  retrievedRef: string | null; retrievedKind: RefKind | null; locator: string | null; excerpt: string | null;
  matchesOriginal: boolean | null; latestVersion: boolean | null; applicable: boolean | null;
  citable: boolean; decision: string; sufficient: boolean; pass: boolean; note: string;
};

export type Case = {
  id: string;
  category: string;
  query: RetrieveQuery;
  expected: string;
  setup?: (tx: Tx) => Promise<void>;
  /** Returns null when the result is right, else what is wrong. */
  judge: (r: RetrieveResult) => string | null;
};

const first = (r: RetrieveResult) => r.citable[0] ?? null;
const refusal = (d: { citable: boolean }) => (d.citable ? "citable" : (d as unknown as { refusal: string }).refusal);
/** The first citable passage is exactly `ref` at `locator` (or matching it) and contains `key`. */
const expectCitable = (r: RetrieveResult, ref: string, locator: string | RegExp, key?: string | RegExp): string | null => {
  const h = first(r);
  if (!h) return `لا مقطع قابل للاستشهاد (${r.sufficiency.sufficient ? "" : (r.sufficiency as { reason: string }).reason})`;
  if (h.hit.refCode !== ref) return `المرجع ${h.hit.refCode} ${h.hit.locator} لا ${ref}`;
  if (typeof locator === "string" ? h.hit.locator !== locator : !locator.test(h.hit.locator)) return `الموضع ${h.hit.locator}`;
  if (key && !(typeof key === "string" ? nrm(h.hit.text).includes(nrm(key)) : key.test(nrm(h.hit.text)))) return "النص لا يتضمن الجواب";
  return null;
};

const SYN_VERSIONS = async (tx: Tx) => {
  const base = { refCode: "SYN-GUIDE", title: "دليل اصطناعي", issuer: null, refKind: "official_guide" as const, services: ["C01"], origin: "اختبار", textQuality: "good" as const, qualityNote: "" };
  const u = (t: string) => [{ locator: "س1", articleNo: null, paragraphNo: null, pageFile: null, pagePrinted: null, text: t, textOrigin: "verified_quote" as const }];
  await ingestUnits(tx as never, { ...base, version: "الإصدار 1", originSha256: "v1", units: u("مدة حفظ سجلات الوقف الاصطناعي في الدليل الاصطناعي خمس سنوات.") });
  await reviewSource(tx, "SYN-GUIDE");
  await ingestUnits(tx as never, { ...base, version: "الإصدار 2", originSha256: "v2", units: u("مدة حفظ سجلات الوقف الاصطناعي في الدليل الاصطناعي عشر سنوات.") });
  await reviewSource(tx, "SYN-GUIDE");
};

export const CASES: Case[] = [
  {
    id: "1a", category: "1. مادة نظامية برقمها (قبل اعتماد المطابقة)",
    query: { question: "ما نص المادة 16 من لائحة تنظيم أعمال النظارة في استثمار الوقف؟", service: "I01", asOf: TODAY, refCodes: ["NAZARA-REG"] },
    expected: "لائحة تنظيم أعمال النظارة م16 — تُسترجع ولا يُستشهد بها لأن المطابقة لم تُعتمد",
    judge: (r) => (r.results[0]?.hit.articleNo !== 16 ? "لم تُسترجع المادة 16" : r.citable.length ? "استُشهد بها دون مراجعة" : r.sufficiency.sufficient ? "عُدّت كافية" : null),
  },
  {
    id: "1b", category: "1. مادة نظامية برقمها (بعد مطابقة معتمدة)",
    query: { question: "ما نص المادة 16 الفقرة 3 من لائحة تنظيم أعمال النظارة؟", service: "I01", asOf: TODAY, refCodes: ["NAZARA-REG"], needBinding: true },
    expected: "م16/ف3 قابلة للاستشهاد، ملزمة، بنص الحارس",
    setup: (tx) => acceptRegistry(tx, "NZR", "NZR/uqn-p18926", [8, 16], "2022-02-04"),
    judge: (r) => expectCitable(r, "NAZARA-REG", "م16/ف3", "الحد المقبول للمخاطر") ?? ((first(r)!.decision as { binding: boolean }).binding && r.sufficiency.sufficient ? null : "لم يُعدّ ملزمًا كافيًا"),
  },
  {
    id: "1c", category: "1. نص رسمي معدَّل في قاعدة المعرفة (مجس المراجعة P5)",
    query: { question: "ما نص المادة 16 الفقرة 3 من لائحة تنظيم أعمال النظارة؟", service: "I01", asOf: TODAY, refCodes: ["NAZARA-REG"], needBinding: true },
    expected: "مقطع لا يطابق النص المعتمد: «لا يطابق النص الرسمي»، غير كافٍ",
    setup: async (tx) => {
      await acceptRegistry(tx, "NZR", "NZR/uqn-p18926", [8, 16], "2022-02-04");
      const e = loadCatalog().find((x) => x.refCode === "NAZARA-REG")!;
      const units = unitsOf(e).units.map((u) => (u.locator === "م16/ف3" ? { ...u, text: "المادة 16: استثمار الوقف\n3- يجوز للناظر تعريض الوقف لمخاطر عالية دون قيد." } : u));
      await ingestUnits(tx as never, { refCode: "NAZARA-REG", version: "نسخة معدلة (اختبار)", title: e.title, issuer: e.issuer, refKind: "regulation", registryId: "NZR", registrySnapshot: e.registrySnapshot, services: e.services, origin: "اختبار", originSha256: "altered", textQuality: "good", qualityNote: "", units });
    },
    judge: (r) => {
      const h = r.results.find((x) => x.hit.locator === "م16/ف3");
      if (!h) return "لم يُسترجع المقطع";
      return !h.decision.citable && refusal(h.decision) === "text_mismatch" && !r.sufficiency.sufficient ? null : `القرار ${refusal(h.decision)}`;
    },
  },
  {
    id: "2", category: "2. حكم من نص نظامي بوصف المسألة",
    query: { question: "ما المدة التي يجب على الناظر خلالها تسجيل الوقف والأصول الموقوفة لدى الهيئة؟", service: "N01", asOf: TODAY },
    expected: "لائحة النظارة م8/ف1 (ثلاثين يوم عمل)",
    setup: (tx) => acceptRegistry(tx, "NZR", "NZR/uqn-p18926", [8, 16], "2022-02-04"),
    judge: (r) => expectCitable(r, "NAZARA-REG", "م8/ف1", "ثلاثين يوم عمل"),
  },
  {
    id: "3", category: "3. نص من ملف PDF مرفق بالمشروع",
    query: { question: "ما المقصود بالمنقولات التي يمكن وقفها وما مزاياها؟", service: "T05", asOf: TODAY, refCodes: ["ASSETS-GUIDE"] },
    expected: "الدليل الإرشادي لاختيار الأصول الوقفية — صفحة الملف 7 (المنقولات)، بعد مقابلة الصفحة؛ غير ملزم",
    setup: (tx) => reviewSource(tx, "ASSETS-GUIDE", { passages: ["صفحة الملف 7"] }),
    judge: (r) => expectCitable(r, "ASSETS-GUIDE", "صفحة الملف 7", "المنقولات") ?? ((first(r)!.decision as { binding: boolean }).binding ? "وُسم ملزمًا" : null),
  },
  {
    id: "3b", category: "3. صفحة من ملف لم تُقابل بصورتها",
    query: { question: "ما المقصود بالمنقولات التي يمكن وقفها وما مزاياها؟", service: "T05", asOf: TODAY, refCodes: ["ASSETS-GUIDE"] },
    expected: "مراجعة المصدر وحدها لا تكفي لصفحة مستخرجة: «لم يُقابل بصفحته»",
    setup: (tx) => reviewSource(tx, "ASSETS-GUIDE"),
    judge: (r) => (r.citable.length === 0 && r.results.some((x) => refusal(x.decision) === "passage_not_reviewed") ? null : "استُشهد بصفحة غير مقابلة"),
  },
  {
    id: "4", category: "4. نص فقهي مع الجزء والصفحة",
    query: { question: "هل يلزم الوقف بمجرد القول دون حكم حاكم في المذهب الحنبلي؟", service: "C07", asOf: TODAY },
    expected: "شرح منتهى الإرادات ج2 ص425 (أو كشاف القناع ط وزارة العدل ج10)",
    setup: async (tx) => { await reviewSource(tx, "FQH-SHARH-MUNTAHA"); await reviewSource(tx, "FQH-KASHSHAF"); },
    judge: (r) => expectCitable(r, first(r)?.hit.refCode === "FQH-KASHSHAF" ? "FQH-KASHSHAF" : "FQH-SHARH-MUNTAHA", /^ج(2 ص425|10 ص\d+)/, /لازم/),
  },
  {
    id: "4b", category: "4. رأي المذهب من كتاب معاصر (مجس المراجعة P4)",
    query: { question: "هل يجوز وقف نصيب مشاع عند الحنابلة؟", service: "C07", asOf: TODAY },
    expected: "الميسّر ص86 (يخالف المذهب) لا يُستشهد به؛ السند من كتب المذهب فقط",
    setup: (tx) => reviewSource(tx, "BOOK-MAYSAR", { passages: "all" }),
    judge: (r) => (r.citable.some((x) => x.hit.refCode === "BOOK-MAYSAR") ? "استُشهد بالميسّر لرأي المذهب" : r.sufficiency.sufficient ? "عُدّت كافية بلا كتاب حنبلي" : null),
  },
  {
    id: "5", category: "5. معيار محاسبي مع الإصدار",
    query: { question: "ما الإفصاحات المطلوبة عن المساهمات المقدمة من الواقف في القوائم المالية للأوقاف؟", service: "F05", asOf: TODAY, kinds: ["professional_standard"] },
    expected: "معايير المنشآت غير الهادفة للربح المحدثة — الفقرة 131د (إفصاحات الأوقاف)",
    setup: (tx) => reviewSource(tx, "SOCPA-NPO-2025"),
    judge: (r) => expectCitable(r, "SOCPA-NPO-2025", /131د/, "المساهمات المقدمة من الواقف"),
  },
  {
    id: "6a", category: "6. دليل استثماري مع طبيعته ونطاقه",
    query: { question: "ما مسؤوليات لجنة الاستثمار في المنظمات غير الربحية؟", service: "I03", asOf: TODAY },
    expected: "دليل قواعد وضوابط الاستثمار — «دليل رسمي إرشادي»، غير ملزم",
    setup: (tx) => reviewSource(tx, "INVEST-RULES", { passages: "all" }),
    judge: (r) => {
      const why = expectCitable(r, "INVEST-RULES", /.+/, "لجنة الاستثمار");
      if (why) return why;
      const d = first(r)!.decision as { binding: boolean; label: string };
      return !d.binding && d.label.startsWith("دليل رسمي إرشادي") ? null : "وسم الطبيعة غير صحيح";
    },
  },
  {
    id: "6b", category: "6. الدليل نفسه لخدمة غير مربوطة به",
    query: { question: "ما مسؤوليات لجنة الاستثمار في المنظمات غير الربحية؟", service: "T07", asOf: TODAY, refCodes: ["INVEST-RULES"] },
    expected: "غير منطبق على T07",
    setup: (tx) => reviewSource(tx, "INVEST-RULES", { passages: "all" }),
    judge: (r) => (r.results.length && r.results.every((x) => refusal(x.decision) === "not_applicable") && !r.sufficiency.sufficient ? null : "رُبط بخدمة غير مربوطة به"),
  },
  {
    id: "7", category: "7. بيانات إحصائية لخدمة T02 مع تاريخها ومصدرها",
    query: { question: "كم بلغ معدل البطالة بين السعوديين في الربع الأول من عام 2025؟", service: "T02", asOf: TODAY, kinds: ["statistical_source", "dataset"] },
    expected: "الهيئة العامة للإحصاء — نشرة سوق العمل للربع الأول 2025 (خبر 29-06-2025)، الفقرة 4: 6.3%",
    setup: (tx) => reviewSource(tx, "GASTAT-LFS"),
    judge: (r) => expectCitable(r, "GASTAT-LFS", /29-06-2025.*الفقرة 4/, "6.3%"),
  },
  {
    id: "8", category: "8. نص OCR أو ملف معيب",
    query: { question: "ما اختصاصات الهيئة العامة للأوقاف في نظامها؟", service: "T01", asOf: TODAY, refCodes: ["GAA-LAW"] },
    expected: "نظام الهيئة — نص OCR من ملف ممسوح: يُسترجع للبحث ولا يُستشهد به",
    judge: (r) => {
      const h = r.results.find((x) => x.hit.refCode === "GAA-LAW");
      if (!h) return "لم يُسترجع";
      return !h.decision.citable && h.hit.quality === "degraded" && !r.sufficiency.sufficient ? null : "استُشهد بنص OCR";
    },
  },
  {
    id: "8b", category: "8. صفحة OCR داخل مصدر جيد (مجس المراجعة P6)",
    query: { question: "الميسر في فقه وإدارة الوقف سلسلة إثرائية في العمل الخيري", service: "C07", asOf: TODAY, refCodes: ["BOOK-MAYSAR"] },
    expected: "صفحات الميسّر المقروءة بالتعرف الضوئي لا يُستشهد بها ولو رُوجع الكتاب كله",
    setup: (tx) => reviewSource(tx, "BOOK-MAYSAR", { passages: "all" }),
    judge: (r) => (r.results.some((x) => x.hit.textOrigin === "ocr") && r.results.filter((x) => x.hit.textOrigin === "ocr").every((x) => !x.decision.citable) ? null : "لم تُسترجع صفحة OCR أو استُشهد بها"),
  },
  {
    id: "9a", category: "9. مرجع ملغى حلت محله لائحة أحدث (سؤال حالي)",
    query: { question: "ما مكافأة المبلغ عن الأوقاف المجهولة والمندثرة؟", service: "N09", asOf: TODAY, refCodes: ["REPORTING-RULES", "REVIVAL-REG"] },
    expected: "القواعد الملغاة لا تُستعمل؛ لائحة الإحياء م17 هي النص الحالي",
    setup: (tx) => acceptRegistry(tx, "IHY", "IHY/uqn-4001990", [17], "2026-08-25"),
    judge: (r) => (r.results.some((x) => x.hit.refCode === "REPORTING-RULES" && x.decision.citable) ? "استُعمل الملغى" : expectCitable(r, "REVIVAL-REG", /^م17\/ف\d$/)),
  },
  {
    id: "9b", category: "9. نسخة سابقة بعد تسجيل نسخة أحدث",
    query: { question: "ما مدة حفظ سجلات الوقف الاصطناعي في الدليل الاصطناعي؟", service: "C01", asOf: TODAY, refCodes: ["SYN-GUIDE"] },
    expected: "النسخة الثانية فقط (عشر سنوات)؛ السابقة (خمس سنوات) لا تعود لسؤال حالي",
    setup: SYN_VERSIONS,
    judge: (r) => (r.results.some((x) => x.hit.text.includes("خمس سنوات")) ? "عادت النسخة السابقة" : expectCitable(r, "SYN-GUIDE", "س1", "عشر سنوات")),
  },
  {
    id: "9c", category: "9. السؤال نفسه تاريخيًا",
    query: { question: "ما مدة حفظ سجلات الوقف الاصطناعي في الدليل الاصطناعي؟", service: "C01", asOf: TODAY, refCodes: ["SYN-GUIDE"], historical: true },
    expected: "تعود النسختان، والسابقة موسومة «نسخة سابقة»",
    setup: SYN_VERSIONS,
    judge: (r) => {
      const old = r.results.find((x) => x.hit.text.includes("خمس سنوات"));
      if (!old) return "لم تعد النسخة السابقة";
      return old.decision.citable && (old.decision as { label: string }).label.endsWith("نسخة سابقة") ? null : "النسخة السابقة غير موسومة";
    },
  },
  {
    id: "10", category: "10. مرجع غير منطبق على الخدمة",
    query: { question: "ما حكم استبدال الوقف إذا تعطلت منافعه؟", service: "F02", asOf: TODAY, kinds: ["classical_fiqh"] },
    expected: "الكتب الفقهية غير مربوطة بخدمة F02",
    setup: (tx) => reviewSource(tx, "FQH-KASHSHAF"),
    judge: (r) => (r.results.length && r.citable.length === 0 && !r.sufficiency.sufficient && r.results.every((x) => refusal(x.decision) === "not_applicable") ? null : "استُشهد بمرجع غير مربوط"),
  },
  {
    id: "11", category: "11. سؤال لا سند كافيًا له (وكل المصادر مراجَعة)",
    query: { question: "ما حكم وقف رمز مشفّر على كوكب المريخ لصالح مركبات فضائية؟", service: "C07", asOf: TODAY },
    expected: "«المراجع غير كافية» حتى بعد مراجعة كل المصادر (حد الصلة)",
    setup: reviewEverything,
    judge: (r) => (!r.sufficiency.sufficient && r.citable.length === 0 ? null : `قُدّم سند: ${first(r)?.hit.refCode} ${first(r)?.hit.locator}`),
  },
  {
    id: "12", category: "12. منع الاستشهاد بنص غير موجود",
    query: { question: "ما نص المادة 99 من لائحة تنظيم أعمال النظارة؟", service: "I01", asOf: TODAY, refCodes: ["NAZARA-REG"], needBinding: true },
    expected: "لا مادة 99: «غير موجودة»، لا سند من مواد أخرى",
    setup: (tx) => acceptRegistry(tx, "NZR", "NZR/uqn-p18926", [8, 16], "2022-02-04"),
    judge: (r) => (!r.sufficiency.sufficient && r.citable.length === 0 && /المادة 99/.test((r.sufficiency as { reason?: string }).reason ?? "") ? null : "قُدّم سند لمادة غير موجودة"),
  },
  {
    id: "13", category: "13. منع الخلط بين المرجع الرسمي والبحث الأكاديمي",
    query: { question: "ما أهمية وجود معايير محاسبية للوقف الإسلامي؟", service: "F02", asOf: TODAY, needBinding: true },
    expected: "الدراسة الأكاديمية تُوسم «دراسة أكاديمية» ولا تكفي حين يلزم سند ملزم",
    setup: (tx) => reviewSource(tx, "ACC-STUDY", { passages: "all" }),
    judge: (r) => {
      const h = r.citable.find((x) => x.hit.refCode === "ACC-STUDY");
      if (!h) return "لم تُسترجع الدراسة";
      const d = h.decision as { binding: boolean; label: string };
      if (d.binding || !d.label.startsWith("دراسة أكاديمية")) return "وُسمت بغير طبيعتها";
      return r.sufficiency.sufficient ? "عُدّت كافية سندًا ملزمًا" : null;
    },
  },
  {
    id: "13b", category: "13. مراجعة من غير مجال المصدر",
    query: { question: "ما الإفصاحات المطلوبة عن المساهمات المقدمة من الواقف في القوائم المالية للأوقاف؟", service: "F05", asOf: TODAY, kinds: ["professional_standard"] },
    expected: "مراجعة معيار محاسبي من مراجع شرعي لا تجعله قابلاً للاستشهاد",
    setup: (tx) => reviewSource(tx, "SOCPA-NPO-2025", { role: "sharia" }),
    judge: (r) => (r.citable.length === 0 && r.results.some((x) => refusal(x.decision) === "not_reviewed") ? null : "قُبلت مراجعة من غير مجاله"),
  },
];

/** Cases reported but not asserted: known limits of the current retrieval, kept visible in the acceptance report. */
export const KNOWN_LIMITS: Case[] = [
  {
    id: "7L", category: "7. (قيد معروف) سؤال عربي ومصدره المحفوظ بالإنجليزية",
    query: { question: "كم بلغ إجمالي عدد سكان المملكة في تعداد 2022؟", service: "T02", asOf: TODAY, kinds: ["statistical_source", "dataset"] },
    expected: "خبر واس 31 مايو 2023 (بالإنجليزية)، الفقرة 1: 32,175,224",
    setup: (tx) => reviewSource(tx, "SPA-CENSUS-2023"),
    judge: (r) => expectCitable(r, "SPA-CENSUS-2023", /الفقرة 1$/, "32,175,224"),
  },
];

export async function runCase(tx: Tx, c: Case): Promise<CaseRow> {
  if (c.setup) await c.setup(tx);
  const r = await retrieve(tx, c.query);
  const h = r.citable[0] ?? r.results[0] ?? null;
  const orig = h ? originalUnitText(h.hit.refCode, h.hit.locator) : null;
  const tail = (s: string) => nrm(s).split(" ").slice(-12).join(" ");
  const row: CaseRow = {
    id: c.id, category: c.category, question: c.query.question, service: c.query.service, expected: c.expected,
    retrievedRef: h?.hit.refCode ?? null, retrievedKind: h?.hit.refKind ?? null, locator: h?.hit.locator ?? null, excerpt: h ? h.hit.text.replace(/\s+/g, " ").slice(0, 220) : null,
    // the passage against the same unit of the original (paragraph of the snapshot, page, quote)
    matchesOriginal: h && orig !== null ? nrm(orig).includes(tail(h.hit.text)) : null,
    latestVersion: h ? !h.hit.superseded : null, applicable: h ? refusal(h.decision) !== "not_applicable" : null,
    citable: !!h?.decision.citable, decision: h ? (h.decision.citable ? `قابل للاستشهاد — ${h.decision.label}` : `مرفوض: ${(h.decision as { detail: string }).detail}`) : "لا نتيجة",
    sufficient: r.sufficiency.sufficient, pass: false, note: "",
  };
  const why = c.judge(r);
  row.pass = why === null;
  row.note = why ?? (r.sufficiency.sufficient ? "" : (r.sufficiency as { reason: string }).reason);
  return row;
}
