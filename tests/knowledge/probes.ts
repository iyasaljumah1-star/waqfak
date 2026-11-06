/**
 * Adversarial probes of the independent quality review (2026-11-06), rebuilt as a permanent suite (owner's order
 * 2026-11-06, §2.9): each runs in a rolled-back transaction on the test database and returns whether its criterion
 * holds and what the engine actually returned (kept in the report, refusals included). Reviews in the probes are
 * recorded by a TEST ACCOUNT through the reviewers' own path; they prove the mechanism, not a human review.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "../../src/server/db";
import { kbChunks, kbSources } from "../../src/server/db/schema";
import { loadCatalog, unitsOf } from "../../src/server/knowledge/catalog";
import { ingestUnits } from "../../src/server/knowledge/ingest";
import { ordinalHeadingValue } from "../../src/server/knowledge/ordinals";
import { readyRefCodes, retrieve, type RetrieveQuery, type RetrieveResult } from "../../src/server/knowledge/retrieve";
import { regulatoryBasisIn } from "../../src/server/modules/ai/regulatory";
import { sectionQuestion } from "../../src/server/knowledge/question";
import { acceptRegistry, asUser, reviewEverything, reviewSource, testReviewer, TEST_REVIEWER } from "./cases";

const T = "2026-11-06";
export type ProbeOut = { pass: boolean; output: unknown };
export type Probe = { id: string; finding: string; title: string; criterion: string; run: (tx: Tx) => Promise<ProbeOut> };

const brief = (r: RetrieveResult) => ({
  sufficient: r.sufficiency.sufficient,
  reason: r.sufficiency.sufficient ? null : (r.sufficiency as { reason: string }).reason,
  citable: r.citable.map((x) => `${x.hit.refCode} ${x.hit.locator} cov=${x.hit.coverage.toFixed(2)} [${x.hit.provenance}] | ${x.decision.citable ? x.decision.label.slice(0, 110) : ""} | ${x.hit.text.replace(/\s+/g, " ").slice(0, 120)}`),
  refused: r.results.filter((x) => !x.decision.citable).slice(0, 5).map((x) => `${x.hit.refCode} ${x.hit.locator}: ${(x.decision as { refusal: string }).refusal} — ${(x.decision as { detail: string }).detail.slice(0, 80)}`),
});
const q = (question: string, o: Partial<RetrieveQuery> = {}): RetrieveQuery => ({ question, service: "*", asOf: T, ...o });
const insufficient = (r: RetrieveResult) => !r.sufficiency.sufficient && r.citable.length === 0;
const NZR = (tx: Tx) => acceptRegistry(tx, "NZR", "NZR/uqn-p18926", [8, 16], "2022-02-04");
const OFFICIAL_16_3 = "3- مراعاة أن يكون الاستثمار في إطار الحد المقبول للمخاطر، وأن يكون عائده مجدياً مقارنة بمخاطره، وعدم تعريض الوقف لمخاطر عالية.";

async function reNZR(tx: Tx, text: string, over: { title?: string; version?: string; locator?: string; articleNo?: number; paragraphNo?: number } = {}) {
  const e = loadCatalog().find((x) => x.refCode === "NAZARA-REG")!;
  const units = unitsOf(e).units.map((u) => (u.locator === (over.locator ?? "م16/ف3") ? { ...u, text, articleNo: over.articleNo ?? u.articleNo, paragraphNo: over.paragraphNo ?? u.paragraphNo } : u));
  await ingestUnits(tx as never, { refCode: "NAZARA-REG", version: over.version ?? "نسخة معدلة (مجس)", title: over.title ?? e.title, issuer: e.issuer, refKind: "regulation", registryId: "NZR", registrySnapshot: e.registrySnapshot, services: e.services, origin: "مجس", originSha256: `probe-${text.length}-${over.title ?? ""}`, textQuality: "good", qualityNote: "", units });
}
const Q163 = q("ما نص المادة 16 الفقرة 3 من لائحة تنظيم أعمال النظارة؟", { service: "I01", refCodes: ["NAZARA-REG"], needBinding: true });

const nonsense: [string, string, string][] = [
  ["P1", "ما حكم وقف رمز مشفّر على كوكب المريخ لصالح مركبات فضائية؟", "C07"],
  ["P1b", "ما حكم وقف الناظر على كوكب المريخ؟", "*"],
  ["P1c", "أجرة الناظر في مركبة فضائية", "*"],
  ["P1d", "هل يستحق الناظر أجرة إذا سافر إلى القمر؟", "*"],
  ["P1e", "شروط الواقف في الصين", "*"],
  ["P1f", "ما حكم استبدال الوقف بسيارة كهربائية؟", "*"],
];
/** Same words, another matter: the shared words must not make a basis. */
const similar: [string, string][] = [
  ["S1", "ما مدة تسجيل السيارة لدى إدارة المرور؟"],
  ["S2", "كم مكافأة نهاية الخدمة للموظف في القطاع الخاص؟"],
  ["S3", "ما أجرة العامل في عقد المقاولات؟"],
  ["S4", "هل يجوز استبدال البطاقة المصرفية المفقودة؟"],
];
/** Legitimate questions: after review, the right passage must still answer them (relevance does not starve them). */
const legit: [string, string, string, RegExp, RegExp][] = [
  ["L1", "ما المدة التي يجب على الناظر خلالها تسجيل الوقف والأصول الموقوفة لدى الهيئة؟", "N01", /^NAZARA-REG$/, /ثلاثين يوم عمل/],
  ["L2", "هل للناظر أن يستدين على الوقف بلا إذن الحاكم لمصلحة الوقف؟", "C07", /^FQH-KASHSHAF/, /يستدين|الاستدانة|استدان/],
  ["L3", "كم بلغ معدل البطالة بين السعوديين في الربع الأول من عام 2025؟", "T02", /^GASTAT-LFS$/, /6\.3%/],
  ["L4", "ما الإفصاحات المطلوبة عن المساهمات المقدمة من الواقف في القوائم المالية للأوقاف؟", "F05", /^SOCPA-NPO-2025$/, /المساهمات المقدمة من الواقف/],
  ["L5", "هل يصح وقف الدراهم والدنانير عند الحنابلة؟", "C07", /^FQH-/, /الدراهم|الأثمان/],
];


const LFS_Q = q("كم بلغ معدل البطالة بين السعوديين في الربع الأول من عام 2025؟", { service: "T02", refCodes: ["GASTAT-LFS"] });
const lfsId = async (tx: Tx) => (await tx.select({ id: kbSources.id }).from(kbSources).where(and(eq(kbSources.refCode, "GASTAT-LFS"), isNull(kbSources.supersededAt))).limit(1))[0]!.id;
const attempt = async (tx: Tx, fn: () => Promise<unknown>) => {
  await tx.execute(sql`savepoint att`);
  try {
    await fn();
    await tx.execute(sql`release savepoint att`);
    return "ACCEPTED";
  } catch (e) {
    await tx.execute(sql`rollback to savepoint att`);
    await tx.execute(sql`select set_config('app.user_id', '', true)`);
    return String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message).slice(0, 120);
  }
};
/** Questions the fourth round of the independent review got through (N2-b). */
const offTopic = ["معدل البطالة في ألمانيا", "الصين", "الذهب", "السيارة", "شروط الواقف في اليابان", "تسجيل الوقف لدى الهيئة في كندا", "مخاطر عالية في القيادة الرياضية", "هل يجب على الناظر أن يطبخ الطعام للمستفيدين يوم الجمعة؟"];

/** Probes added after the fourth round of the independent review (report qa-round4). */
const ROUND4: Probe[] = [
  {
    id: "R3b", finding: "R3b", title: "قبول مطابقة نظامية ثم رفض لاحق من المراجع نفسه", criterion: "الرفض اللاحق يُسقط الاستشهاد",
    run: async (tx) => {
      const { recordComparisonReview } = await import("../../src/server/knowledge/review");
      const runId = await NZR(tx);
      const before = (await retrieve(tx, Q163)).citable.length;
      await tx.execute(sql`select pg_sleep(0.01)`);
      await asUser(tx, TEST_REVIEWER, () => recordComparisonReview(tx, { userId: TEST_REVIEWER }, { runId, decision: "rejected", note: "مجس: رفض لاحق بعد القبول" }));
      const after = (await retrieve(tx, Q163)).citable.length;
      return { pass: before > 0 && after === 0, output: { before, after } };
    },
  },
  {
    id: "R1d", finding: "R1d", title: "مراجعة بإدراج مباشر مع قيد تدقيق مزور (بصمة عشوائية)", criterion: "يُرفض القيد المزور إن لم يكمل السلسلة؛ وإن أكملها كشفه المتحقق «مكسورًا»",
    run: async (tx) => {
      await testReviewer(tx, TEST_REVIEWER, ["data"]);
      const sid = await lfsId(tx);
      const rid = "11111111-1111-4111-8111-111111111113";
      const offChain = await attempt(tx, () => asUser(tx, TEST_REVIEWER, async () => {
        await tx.execute(sql`insert into kb_source_reviews (id, source_id, reviewer_user_id, reviewer_role, decision, note) values (${rid}::uuid, ${sid}::uuid, ${TEST_REVIEWER}::uuid, 'data', 'accepted', 'مجس: إدراج مباشر')`);
        await tx.execute(sql`insert into audit_logs (actor_user_id, action, entity_type, entity_id, after, prev_hash, hash) values (${TEST_REVIEWER}::uuid, 'knowledge.review.recorded', 'kb_source_review', ${rid}, '{"decision":"accepted"}'::jsonb, 'forged-prev', ${"e".repeat(64)})`);
      }));
      const linked = await attempt(tx, () => asUser(tx, TEST_REVIEWER, async () => {
        await tx.execute(sql`insert into kb_source_reviews (id, source_id, reviewer_user_id, reviewer_role, decision, note) values (${rid}::uuid, ${sid}::uuid, ${TEST_REVIEWER}::uuid, 'data', 'accepted', 'مجس: إدراج مباشر')`);
        const prev = ((await tx.execute(sql`select app_audit_last_hash() h`)).rows[0] as { h: string | null }).h ?? "GENESIS";
        await tx.execute(sql`insert into audit_logs (actor_user_id, action, entity_type, entity_id, after, prev_hash, hash, at) values (${TEST_REVIEWER}::uuid, 'knowledge.review.recorded', 'kb_source_review', ${rid}, '{"decision":"accepted","role":"data","textSha256":"none"}'::jsonb, ${prev}, ${"e".repeat(64)}, now())`);
      }));
      const { createChainVerifier } = await import("../../src/server/modules/admin/audit/chain");
      const rows = (await tx.execute(sql`select * from audit_logs order by id`)).rows as Record<string, unknown>[];
      const v = createChainVerifier();
      for (const r of rows) v.push({ id: Number(r.id), at: new Date(r.at as string), actorUserId: r.actor_user_id as string | null, action: r.action as string, entityType: r.entity_type as string, entityId: r.entity_id as string | null, waqfId: r.waqf_id as string | null, before: r.before, after: r.after, prevHash: r.prev_hash as string | null, hash: r.hash as string, actorRoles: r.actor_roles as string[] | null } as never);
      const report = v.report() as { broken?: unknown[]; brokenCount?: number } & Record<string, unknown>;
      const brokenIds = JSON.stringify(report).includes(String(rows.find((r) => r.entity_id === rid)?.id ?? "x"));
      // the linked forgery may be stored, but a review whose audit hash does not recompute never counts
      const citable = linked === "ACCEPTED" ? (await retrieve(tx, LFS_Q)).citable.length : 0;
      return { pass: offChain !== "ACCEPTED" && citable === 0, output: { offChain, linked, citableAfterLinkedForgery: citable, verifierFlagsForgedRow: brokenIds, verifier: JSON.stringify(report).slice(0, 300) } };
    },
  },
  {
    id: "R4b", finding: "R4b", title: "موظف بلا أدوار يمنح نفسه دور مراجع من جلسته", criterion: "يُرفض المنح، ولا مراجعة، ولا استشهاد",
    run: async (tx) => {
      const U = "00000000-0000-4000-8000-0000000aa0b2";
      await testReviewer(tx, U, []);
      await tx.execute(sql`select set_config('app.global_access', 'off', true)`);
      const grant = await attempt(tx, () => asUser(tx, U, () => tx.execute(sql`insert into user_roles (user_id, role_id) select ${U}::uuid, id from roles where key = 'reviewer_data'`)));
      const perm = await attempt(tx, () => asUser(tx, U, () => tx.execute(sql`insert into role_permissions (role_id, permission_id) select r.id, p.id from roles r, permissions p where r.key = 'viewer' and p.key = 'knowledge.review.data'`)));
      await tx.execute(sql`select set_config('app.global_access', 'on', true)`);
      const r = await retrieve(tx, LFS_Q);
      return { pass: grant !== "ACCEPTED" && perm !== "ACCEPTED" && r.citable.length === 0, output: { selfGrant: grant, rolePermission: perm, citable: r.citable.length } };
    },
  },
  {
    id: "R5", finding: "R5", title: "مراجعة نسخة مستبدلة، ومقطع من مصدر آخر", criterion: "ترفضهما قاعدة البيانات",
    run: async (tx) => {
      await testReviewer(tx);
      const old = (await tx.execute(sql`select id from kb_sources where superseded_at is not null limit 1`)).rows[0] as { id: string } | undefined;
      const sid = await lfsId(tx);
      const other = (await tx.execute(sql`select c.id from kb_chunks c join kb_sources s on s.id = c.source_id where s.ref_code = 'Q100' and s.superseded_at is null limit 1`)).rows[0] as { id: string };
      const superseded = old ? await attempt(tx, () => asUser(tx, TEST_REVIEWER, () => tx.execute(sql`insert into kb_source_reviews (source_id, reviewer_user_id, reviewer_role, decision, note) values (${old.id}::uuid, ${TEST_REVIEWER}::uuid, 'legal', 'accepted', 'مجس: نسخة مستبدلة')`))) : "no superseded row";
      const foreign = await attempt(tx, () => asUser(tx, TEST_REVIEWER, () => tx.execute(sql`insert into kb_source_reviews (source_id, chunk_id, reviewer_user_id, reviewer_role, decision, note) values (${sid}::uuid, ${other.id}::uuid, ${TEST_REVIEWER}::uuid, 'data', 'accepted', 'مجس: مقطع من مصدر آخر')`)));
      return { pass: superseded !== "ACCEPTED" && foreign !== "ACCEPTED", output: { superseded, foreign } };
    },
  },
  {
    id: "R6", finding: "R6", title: "نسخة المقطع = نص الحارس + كلمات «المريخ»", criterion: "الصلة تُقاس على نص الحارس: السؤال العبثي غير كافٍ",
    run: async (tx) => {
      await NZR(tx);
      await reNZR(tx, `المادة 16: استثمار الوقف\n${OFFICIAL_16_3} وقف الناظر على كوكب المريخ وأجرة الناظر في مركبة فضائية`);
      const r = await retrieve(tx, q("ما حكم وقف الناظر على كوكب المريخ؟", { service: "I01", refCodes: ["NAZARA-REG"] }));
      return { pass: insufficient(r), output: brief(r) };
    },
  },
  {
    id: "R6b", finding: "R6b", title: "وسم إصدار مزور في صف المصدر", criterion: "الإصدار في الإحالة هو إصدار الحارس",
    run: async (tx) => {
      await NZR(tx);
      await reNZR(tx, `المادة 16: استثمار الوقف\n${OFFICIAL_16_3}`, { version: "النسخة الرسمية المعدلة بقرار 1447 (مزورة)" });
      const r = await retrieve(tx, Q163);
      return { pass: r.citable.length > 0 && r.citable.every((x) => !x.hit.version.includes("مزورة") && !(x.decision as { label: string }).label.includes("مزورة")), output: { label: r.citable.map((x) => (x.decision as { label: string }).label), version: r.citable.map((x) => x.hit.version) } };
    },
  },
  {
    id: "H1", finding: "H1", title: "سؤال تاريخي عن لائحة ملغاة في تاريخ بعد إلغائها (الحارس)", criterion: "يرفض الحارس: لا نص نافذ في ذلك التاريخ",
    run: async () => {
      const { cite } = await import("../../src/server/references/citation");
      const { REGISTRY } = await import("../../src/server/references/registry");
      const { InMemoryVersionStore } = await import("../../src/server/references/versions");
      const { loadManifest, versionFromSnapshot } = await import("../../src/server/references/snapshots");
      const store = new InMemoryVersionStore();
      const v = { ...versionFromSnapshot(loadManifest().find((m) => m.id === "NZR/uqn-p18926")!, "2022-11-18", "مجس"), refId: "PRT", id: "PRT@probe" };
      store.addVersion(v);
      store.addMatchRun({ id: "run1", versionId: v.id, candidateLabel: "مجس", candidateSha256: v.source.sha256, outcome: "identical", perArticle: { م8: "identical" }, ranAt: "2026-01-01T00:00:00Z" } as never);
      store.addReview({ runId: "run1", decision: "accepted", reviewer: "مجس", at: "2026-01-02T00:00:00Z" } as never);
      const after = cite(REGISTRY, store, { refId: "PRT", article: 8, paragraph: 1, asOf: "2026-11-06", historical: true });
      const before = cite(REGISTRY, store, { refId: "PRT", article: 8, paragraph: 1, asOf: "2025-01-01", historical: true });
      return { pass: !after.ok && before.ok, output: { afterRepeal: after.ok ? "ok" : after.refusal, beforeRepeal: before.ok ? "ok" : before.refusal } };
    },
  },
  {
    id: "H3", finding: "H3", title: "نسختان تبدآن في اليوم نفسه", criterion: "لا تُستعمل أي منهما لسؤال تاريخي",
    run: async (tx) => {
      const base = { refCode: "SYN-SAME", title: "دليل اصطناعي", issuer: null, refKind: "official_guide" as const, services: ["C01"], origin: "مجس", textQuality: "good" as const, qualityNote: "" };
      const u = (t: string) => [{ locator: "س1", articleNo: null, paragraphNo: null, pageFile: null, pagePrinted: null, text: t, textOrigin: "verified_quote" as const }];
      await ingestUnits(tx as never, { ...base, version: "أ", effectiveOn: "2024-01-01", originSha256: "a", units: u("مدة حفظ سجلات الوقف الاصطناعي في الدليل الاصطناعي خمس سنوات.") });
      await reviewSource(tx, "SYN-SAME");
      await ingestUnits(tx as never, { ...base, version: "ب", effectiveOn: "2024-01-01", originSha256: "b", units: u("مدة حفظ سجلات الوقف الاصطناعي في الدليل الاصطناعي عشر سنوات.") });
      await reviewSource(tx, "SYN-SAME");
      const r = await retrieve(tx, q("ما مدة حفظ سجلات الوقف الاصطناعي في الدليل الاصطناعي؟", { service: "C01", asOf: "2025-06-01", refCodes: ["SYN-SAME"], historical: true }));
      return { pass: r.citable.length === 0, output: brief(r) };
    },
  },
  {
    id: "Q3", finding: "Q3", title: "«م 2025» في السؤال", criterion: "لا يُقرأ رقم مادة",
    run: async () => {
      const { namedArticle } = await import("../../src/server/knowledge/retrieve");
      const a = namedArticle("ما الجديد في تسجيل الأوقاف لعام م 2025؟");
      const b = namedArticle("ما نص م16/ف3؟");
      const area = [namedArticle("أرض مساحتها 500 م2 موقوفة"), namedArticle("مساحة 120 م 2 للعمارة"), namedArticle("خزان 30 م3")];
      return { pass: a === null && area.every((x) => x === null) && b?.article === 16 && b.paragraph === 3, output: { year: a, area, article: b } };
    },
  },
  {
    id: "N2b", finding: "N2-b", title: "أسئلة خارج الموضوع نجحت في الجولة الرابعة", criterion: "كلها «المراجع غير كافية» بعد مراجعة كل شيء",
    run: async (tx) => {
      await NZR(tx); await reviewEverything(tx);
      const out: string[] = [];
      for (const t of offTopic) {
        const r = await retrieve(tx, q(t));
        out.push(`${r.sufficiency.sufficient ? "SUFFICIENT" : "insufficient"} | ${t}${r.citable[0] ? ` | ${r.citable[0].hit.refCode} ${r.citable[0].hit.locator}` : ""}`);
      }
      // known limit, reported not asserted: «أجرة الناظر بالعملات الرقمية» — «أجرة» and «الناظر» with the common
      // «عمل» stand together in the passage on the nazir's fee; a lexical measure cannot tell the currency is off-topic
      // and «ما مدة تسجيل السيارة لدى الهيئة؟» — three of its four words are the matter of the nazir guide's page on
      // the registration period with the authority
      const limits: string[] = [];
      for (const t of ["أجرة الناظر بالعملات الرقمية", "ما مدة تسجيل السيارة لدى الهيئة؟"]) {
        const lim = await retrieve(tx, q(t));
        limits.push(`${lim.sufficiency.sufficient ? "SUFFICIENT" : "insufficient"} | ${t}${lim.citable[0] ? ` | ${lim.citable[0].hit.refCode} ${lim.citable[0].hit.locator}` : ""}`);
      }
      return { pass: out.every((x) => x.startsWith("insufficient")), output: { asserted: out, knownLimits: limits } };
    },
  },
  {
    id: "N2c", finding: "N2-c", title: "نص طلب حقيقي طويل (≈400 حرف) يقتبس م16/ف3", criterion: "كافٍ: م16/ف3 بنص الحارس",
    run: async (tx) => {
      await NZR(tx);
      const { sectionQuestion, matterOf } = await import("../../src/server/knowledge/question");
      const matter = matterOf({ details: "السلام عليكم، نحن نظار وقف عائلي يملك عمارتين تجاريتين في الرياض، ونرغب في إعداد سياسة استثمار للوقف. نريد أن يكون الاستثمار في إطار الحد المقبول للمخاطر، وأن يكون عائده مجدياً مقارنة بمخاطره، وعدم تعريض الوقف لمخاطر عالية، مع مراعاة عمارة العقار الموقوف وصيانته قبل توزيع الغلة على المستحقين، فما الذي تنص عليه اللائحة في ذلك؟" }, (x) => x);
      const r = await retrieve(tx, { question: sectionQuestion({ serviceName: "سياسة الاستثمار الوقفية", sectionTitle: "التحليل", matter }), service: "I01", asOf: T, refCodes: ["NAZARA-REG"], limit: 4 });
      return { pass: r.sufficiency.sufficient && r.citable.some((x) => x.hit.locator === "م16/ف3"), output: brief(r) };
    },
  },
  {
    id: "N5-1", finding: "N5-1", title: "موظف يعيد تسمية صلاحية يحملها إلى knowledge.review.data", criterion: "يُرفض تعديل جدول الصلاحيات من جلسة مستخدم",
    run: async (tx) => {
      const U = "00000000-0000-4000-8000-0000000aa0c1";
      await testReviewer(tx, U, []);
      await tx.execute(sql`insert into user_roles (user_id, role_id) select ${U}::uuid, id from roles where key = 'viewer' on conflict do nothing`);
      const rename = await attempt(tx, () => asUser(tx, U, () => tx.execute(sql`update permissions set key = 'knowledge.review.data' where key = 'waqf.view'`)));
      const add = await attempt(tx, () => asUser(tx, U, () => tx.execute(sql`insert into permissions (key, name_ar, domain) values ('admin.roles2', 'x', 'admin')`)));
      return { pass: rename !== "ACCEPTED" && add !== "ACCEPTED", output: { rename, add } };
    },
  },
  {
    id: "N5-2", finding: "N5-2/R2", title: "مراجعة بإدراج مباشر في جلسة المراجع مع قيد audit() صحيح السلسلة والبصمة لكن دون ختم الخادم", criterion: "لا تُحتسب: لا ختم صالح",
    run: async (tx) => {
      const { audit } = await import("../../src/server/lib/audit");
      await testReviewer(tx, TEST_REVIEWER, ["data"]);
      const sid = await lfsId(tx);
      await asUser(tx, TEST_REVIEWER, async () => {
        const [row] = (await tx.execute(sql`insert into kb_source_reviews (source_id, reviewer_user_id, reviewer_role, decision, note) values (${sid}::uuid, ${TEST_REVIEWER}::uuid, 'data', 'accepted', 'مجس: إدراج مباشر بقيد تدقيق صحيح') returning id`)).rows as { id: string }[];
        await audit(tx, { actorUserId: TEST_REVIEWER, action: "knowledge.review.recorded", entityType: "kb_source_review", entityId: row!.id, after: { decision: "accepted", role: "data", textSha256: "x".repeat(64), seal: "forged" } });
      });
      const r = await retrieve(tx, LFS_Q);
      return { pass: r.citable.length === 0, output: brief(r) };
    },
  },
  {
    id: "N5-4", finding: "N5-4", title: "مستخدم مقفل يرفع القفل عن نفسه أو يجعل نفسه موظفًا", criterion: "تُرفض",
    run: async (tx) => {
      const U = "00000000-0000-4000-8000-0000000aa0c4";
      await tx.execute(sql`insert into users (id, phone, full_name, locked_until) values (${U}::uuid, '0500000444', 'مجس', now() + interval '1 day')`);
      const unlock = await attempt(tx, () => asUser(tx, U, () => tx.execute(sql`update users set locked_until = null where id = ${U}::uuid`)));
      const staff = await attempt(tx, () => asUser(tx, U, () => tx.execute(sql`update users set is_staff = true where id = ${U}::uuid`)));
      return { pass: unlock !== "ACCEPTED" && staff !== "ACCEPTED", output: { unlock, staff } };
    },
  },
  {
    id: "N5-5", finding: "N5-5", title: "المساعد: «ما حكم بيع الوقف إذا تعطلت منافعه؟» بعد مراجعة كل شيء", criterion: "لا يُقتبس مقطع لا يغطي السؤال بوضوح؛ ما يُقتبس صلته ≥ 0.75",
    run: async (tx) => {
      await reviewEverything(tx);
      const b = await regulatoryBasisIn(tx, "ما حكم بيع الوقف إذا تعطلت منافعه؟", T);
      return { pass: !b.sufficient || b.quotes.every((x) => !/DRAFTING-GUIDE/.test(x.refCode)), output: b };
    },
  },
  {
    id: "A2b", finding: "A2", title: "«الميسّر» بجانب مقطع غير فقهي لسؤال فقهي (بيع الوقف إذا تعطلت منافعه)", criterion: "لا يُمرَّر «الميسّر» إلا بجانب نص من كتب الفقه الأصلية",
    run: async (tx) => {
      await reviewEverything(tx);
      const r = await retrieve(tx, q("ما حكم بيع الوقف إذا تعطلت منافعه؟", { service: "*" }));
      const maysar = r.citable.filter((x) => x.hit.refKind === "contemporary_book");
      return { pass: maysar.length === 0 || r.citable.some((x) => x.hit.refKind === "classical_fiqh"), output: brief(r) };
    },
  },
];

export const PROBES: Probe[] = [
  ...nonsense.map(([id, text, svc]): Probe => ({
    id, finding: "B2/N2", title: `سؤال عبثي: «${text}»`, criterion: "«المراجع غير كافية» بعد مراجعة كل المصادر والمقاطع",
    run: async (tx) => { await reviewEverything(tx); const r = await retrieve(tx, q(text, { service: svc })); return { pass: insufficient(r), output: brief(r) }; },
  })),
  ...similar.map(([id, text]): Probe => ({
    id, finding: "N2", title: `متشابه لفظيًا ومختلف موضوعيًا: «${text}»`, criterion: "«المراجع غير كافية» بعد مراجعة كل المصادر",
    // nothing may be offered as a basis: an auxiliary book's passage may be retrieved, but the basis stays insufficient
    run: async (tx) => { await NZR(tx); await reviewEverything(tx); const r = await retrieve(tx, q(text)); return { pass: !r.sufficiency.sufficient, output: brief(r) }; },
  })),
  ...legit.map(([id, text, svc, ref, key]): Probe => ({
    id, finding: "N2", title: `سؤال مشروع: «${text}»`, criterion: `كافٍ، وأول سند من ${ref.source} ويتضمن الجواب`,
    run: async (tx) => {
      await NZR(tx); await reviewEverything(tx);
      const r = await retrieve(tx, q(text, { service: svc }));
      const h = r.citable[0];
      const bare = (t: string) => t.replace(/[ً-ْـ]/g, "");
      return { pass: r.sufficiency.sufficient && !!h && ref.test(h.hit.refCode) && r.citable.some((x) => ref.test(x.hit.refCode) && key.test(bare(x.hit.text))), output: brief(r) };
    },
  })),
  {
    id: "P2", finding: "B2", title: "المادة 99 من لائحة النظارة (مرجع محدد)", criterion: "«المادة 99 غير موجودة»، ولا سند من مواد أخرى",
    run: async (tx) => { await NZR(tx); const r = await retrieve(tx, q("ما نص المادة 99 من لائحة تنظيم أعمال النظارة؟", { service: "I01", refCodes: ["NAZARA-REG"], needBinding: true })); return { pass: insufficient(r) && /المادة 99/.test(String(brief(r).reason)), output: brief(r) }; },
  },
  {
    id: "P2b", finding: "B2", title: "المادة 300 دون تحديد المرجع، وكل شيء مراجَع", criterion: "«المادة 300 غير موجودة»",
    run: async (tx) => { await NZR(tx); await reviewEverything(tx); const r = await retrieve(tx, q("ما نص المادة 300 من لائحة النظارة في استثمار الوقف؟", { needBinding: true })); return { pass: insufficient(r) && /المادة 300/.test(String(brief(r).reason)), output: brief(r) }; },
  },
  {
    id: "P2c", finding: "B2", title: "المادة 9 (موجودة ولم تُقارن)", criterion: "تُسترجع ويرفضها الحارس",
    run: async (tx) => { await NZR(tx); const r = await retrieve(tx, q("ما نص المادة 9 من لائحة تنظيم أعمال النظارة؟", { service: "C07", refCodes: ["NAZARA-REG"] })); return { pass: insufficient(r) && r.results.some((x) => x.hit.articleNo === 9), output: brief(r) }; },
  },
  {
    id: "P4", finding: "B8", title: "رأي الحنابلة في وقف المشاع، و«الميسّر» مراجَع كله", criterion: "لا يُستشهد بالميسّر، ولا كفاية دون كتاب حنبلي",
    run: async (tx) => { await reviewSource(tx, "BOOK-MAYSAR", { passages: "all" }); const r = await retrieve(tx, q("هل يجوز وقف نصيب مشاع عند الحنابلة؟", { service: "C07" })); return { pass: !r.sufficiency.sufficient && !r.citable.some((x) => x.hit.refCode === "BOOK-MAYSAR"), output: brief(r) }; },
  },
  {
    id: "P4d", finding: "B8", title: "«هل يحصل الوقف بالفعل دون القول؟» في C07 و«الميسّر» مراجَع", criterion: "لا كفاية من الميسّر وحده؛ ص231–232 محجوبة",
    run: async (tx) => { await reviewSource(tx, "BOOK-MAYSAR", { passages: "all" }); const r = await retrieve(tx, q("هل يحصل الوقف بالفعل دون القول؟", { service: "C07" })); return { pass: !r.sufficiency.sufficient && !r.citable.some((x) => ["231", "232"].includes(x.hit.pagePrinted ?? "")), output: brief(r) }; },
  },
  {
    id: "B8c", finding: "B8", title: "خارج C07: «الميسّر» وحده لسؤال فقهي بلا كلمات المذهب", criterion: "الكتاب المعاصر لا يكون السند الوحيد",
    run: async (tx) => { await reviewSource(tx, "BOOK-MAYSAR", { passages: "all" }); const r = await retrieve(tx, q("ما اللجان المتفرعة من مجلس النظارة في الوقف المؤسسي؟", { refCodes: ["BOOK-MAYSAR"] })); return { pass: !r.sufficiency.sufficient, output: brief(r) }; },
  },
  {
    id: "P5a", finding: "B1", title: "نص فقرة معدَّل بالكامل", criterion: "text_mismatch، غير كافٍ",
    run: async (tx) => { await NZR(tx); await reNZR(tx, "المادة 16: استثمار الوقف\n3- يجوز للناظر تعريض الوقف لمخاطر عالية دون قيد."); const r = await retrieve(tx, Q163); return { pass: insufficient(r) && r.results.some((x) => (x.decision as { refusal?: string }).refusal === "text_mismatch"), output: brief(r) }; },
  },
  {
    id: "P5b", finding: "B1", title: "الفقرة الرسمية + جملة ملحقة", criterion: "يمرّ نص الحارس وحده",
    run: async (tx) => { await NZR(tx); await reNZR(tx, `المادة 16: استثمار الوقف\n${OFFICIAL_16_3} ويجوز للناظر مع ذلك تعريض الوقف لمخاطر عالية.`); const r = await retrieve(tx, Q163); return { pass: r.citable.length > 0 && r.citable.every((x) => !x.hit.text.includes("مع ذلك") && x.hit.provenance === "guard"), output: brief(r) }; },
  },
  {
    id: "P5c", finding: "N1", title: "الفقرة الرسمية بسطر عنوان مزور", criterion: "العنوان والنص من الحارس، ولا يمر شيء من المقطع",
    run: async (tx) => { await NZR(tx); await reNZR(tx, `المادة 16: يجوز للناظر تعريض الوقف لمخاطر عالية دون قيد ولا يلزمه إذن\n${OFFICIAL_16_3}`); const r = await retrieve(tx, Q163); return { pass: r.citable.length > 0 && r.citable.every((x) => x.hit.text.startsWith("المادة 16: استثمار الوقف\n") && !x.hit.text.includes("دون قيد")), output: brief(r) }; },
  },
  {
    id: "P5d", finding: "N1", title: "اسم مصدر مزور في صف المصدر", criterion: "الاسم في الإحالة من الحارس",
    run: async (tx) => { await NZR(tx); await reNZR(tx, `المادة 16: استثمار الوقف\n${OFFICIAL_16_3}`, { title: "لائحة مزورة تجيز كل شيء" }); const r = await retrieve(tx, Q163); return { pass: r.citable.length > 0 && r.citable.every((x) => x.hit.title === "لائحة تنظيم أعمال النظارة" && !(x.decision as { label: string }).label.includes("مزورة")), output: brief(r) }; },
  },
  {
    id: "P5e", finding: "N1", title: "نص مادة أخرى (م8/ف1) مقيد برقم م16/ف3", criterion: "يُرفض: النص لا يطابق ما أجازه الحارس لتلك الفقرة",
    run: async (tx) => {
      await NZR(tx);
      const e = loadCatalog().find((x) => x.refCode === "NAZARA-REG")!;
      await reNZR(tx, unitsOf(e).units.find((u) => u.locator === "م8/ف1")!.text);
      const r = await retrieve(tx, Q163);
      return { pass: insufficient(r), output: brief(r) };
    },
  },
  {
    id: "P6", finding: "B4", title: "مقاطع OCR داخل مصادر جودتها «جيدة»، وكل شيء مراجَع", criterion: "كل مقطع OCR يُسترجع بنصه نفسه ويُرفض «ocr_text»",
    run: async (tx) => {
      await reviewEverything(tx);
      const ocr = (await tx.execute(sql`select s.ref_code, c.id, c.locator, c.text from kb_chunks c join kb_sources s on s.id = c.source_id where s.superseded_at is null and s.text_quality = 'good' and c.text_origin = 'ocr' and s.registry_id is null and length(c.text) > 120 order by s.ref_code, c.seq`)).rows as { ref_code: string; id: string; locator: string; text: string }[];
      const sample = ocr.filter((_, i) => i % Math.max(1, Math.floor(ocr.length / 8)) === 0).slice(0, 8);
      const out = [];
      for (const c of sample) {
        const words = c.text.replace(/[^\u0600-\u06FF\s]/g, " ").split(/\s+/).filter((w) => w.length > 3).slice(5, 17).join(" ");
        const r = await retrieve(tx, q(words, { refCodes: [c.ref_code], limit: 10 }));
        const me = r.results.find((x) => x.hit.chunkId === c.id);
        out.push({ ref: c.ref_code, locator: c.locator, retrieved: !!me, decision: me ? (me.decision.citable ? "CITABLE" : (me.decision as { refusal: string }).refusal) : null });
      }
      return { pass: ocr.length > 0 && out.some((o) => o.retrieved) && out.every((o) => o.decision !== "CITABLE"), output: { ocrChunksInGoodSources: ocr.length, sample: out } };
    },
  },
  {
    id: "P6b", finding: "B4", title: "صفحة من طبقة النص بمراجعة المصدر وحدها", criterion: "passage_not_reviewed",
    run: async (tx) => { await reviewSource(tx, "ASSETS-GUIDE"); const r = await retrieve(tx, q("ما المقصود بالمنقولات التي يمكن وقفها وما مزاياها؟", { service: "T05", refCodes: ["ASSETS-GUIDE"] })); return { pass: insufficient(r) && r.results.some((x) => (x.decision as { refusal?: string }).refusal === "passage_not_reviewed"), output: brief(r) }; },
  },
  {
    id: "P6c", finding: "N3/B5", title: "مستخدم بلا دور ومقفل يسجل مراجعة، وإدراج مباشر من سياق النظام", criterion: "تُرفض كلتاهما، ولا يصير المصدر قابلاً للاستشهاد",
    run: async (tx) => {
      const out: Record<string, string> = {};
      const U = "00000000-0000-4000-8000-00000000ae09";
      await testReviewer(tx, U, []);
      await tx.execute(sql`update users set locked_until = now() + interval '1 day' where id = ${U}::uuid`);
      const [s] = await tx.select({ id: kbSources.id }).from(kbSources).where(and(eq(kbSources.refCode, "GASTAT-LFS"), isNull(kbSources.supersededAt))).limit(1);
      for (const [k, who, ctx] of [["roleless_locked", U, U], ["system_context", TEST_REVIEWER, ""]] as const) {
        await tx.execute(sql`savepoint p6c`);
        try {
          if (ctx) await asUser(tx, ctx, () => tx.execute(sql`insert into kb_source_reviews (source_id, reviewer_user_id, reviewer_role, decision, note) values (${s!.id}, ${who}::uuid, 'data', 'accepted', 'مجس P6c: إدراج مباشر')`));
          else { await testReviewer(tx); await tx.execute(sql`insert into kb_source_reviews (source_id, reviewer_user_id, reviewer_role, decision, note) values (${s!.id}, ${who}::uuid, 'data', 'accepted', 'مجس P6c: إدراج من سياق النظام')`); }
          out[k] = "ACCEPTED";
        } catch (e) {
          out[k] = String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message).slice(0, 120);
        }
        await tx.execute(sql`rollback to savepoint p6c`);
        await tx.execute(sql`select set_config('app.user_id', '', true)`);
      }
      const r = await retrieve(tx, q("كم بلغ معدل البطالة بين السعوديين في الربع الأول من عام 2025؟", { service: "T02", refCodes: ["GASTAT-LFS"] }));
      return { pass: !Object.values(out).includes("ACCEPTED") && r.citable.length === 0, output: { ...out, retrieval: brief(r) } };
    },
  },
  {
    id: "P6d", finding: "N3", title: "مراجعة صحيحة ثم سحب الصلاحية / تعطيل الحساب", criterion: "يسقط أثر المراجعة فورًا في الحالتين",
    run: async (tx) => {
      const Q = q("كم بلغ معدل البطالة بين السعوديين في الربع الأول من عام 2025؟", { service: "T02", refCodes: ["GASTAT-LFS"] });
      await reviewSource(tx, "GASTAT-LFS");
      const before = (await retrieve(tx, Q)).citable.length;
      await tx.execute(sql`savepoint d`);
      await tx.execute(sql`delete from user_roles where user_id = ${TEST_REVIEWER}::uuid`);
      const afterWithdraw = (await retrieve(tx, Q)).citable.length;
      await tx.execute(sql`rollback to savepoint d`);
      await tx.execute(sql`update users set status = 'locked' where id = ${TEST_REVIEWER}::uuid`);
      const afterDisable = (await retrieve(tx, Q)).citable.length;
      return { pass: before > 0 && afterWithdraw === 0 && afterDisable === 0, output: { before, afterWithdraw, afterDisable } };
    },
  },
  {
    id: "P7", finding: "B6/N4", title: "ترقيم نظامي المعاملات المدنية والشركات", criterion: "كل رقم مادة يطابق عنوانها المكتوب وتسلسلها؛ الشركات (عدة وثائق) بلا أرقام",
    run: async (tx) => {
      const rows = (await tx.execute(sql`select s.ref_code, c.article_no, c.locator, split_part(c.text, E'\n', 1) as head from kb_chunks c join kb_sources s on s.id = c.source_id where s.ref_code in ('CIVIL-TX','COMPANIES') and s.superseded_at is null and c.article_no is not null order by s.ref_code, c.seq`)).rows as { ref_code: string; article_no: number; locator: string; head: string }[];
      const civil = rows.filter((r) => r.ref_code === "CIVIL-TX");
      const wrong = civil.filter((r) => !r.locator.endsWith("(تابع)") && ordinalHeadingValue(r.head) !== r.article_no);
      const nums = civil.filter((r) => !r.locator.endsWith("(تابع)")).map((r) => r.article_no);
      const increasing = nums.every((n, i) => i === 0 || n > nums[i - 1]!);
      const companies = rows.filter((r) => r.ref_code === "COMPANIES").length;
      return { pass: civil.length > 700 && wrong.length === 0 && increasing && companies === 0, output: { civilNumbered: nums.length, headingMismatch: wrong.slice(0, 5), increasing, companiesNumbered: companies } };
    },
  },
  {
    id: "P7c", finding: "B6", title: "«المادة الثامنة» و«الثامنة عشرة بعد السبعمائة» في المعاملات المدنية", criterion: "م8 نصها المادة الثامنة، وم718 نصها الثامنة عشرة بعد السبعمائة",
    run: async (tx) => {
      const rows = (await tx.execute(sql`select c.article_no, left(regexp_replace(c.text, '\s+', ' ', 'g'), 70) t from kb_chunks c join kb_sources s on s.id = c.source_id where s.ref_code = 'CIVIL-TX' and s.superseded_at is null and c.article_no in (1, 8, 17, 718, 721) and c.locator not like '%تابع%' order by c.article_no`)).rows as { article_no: number; t: string }[];
      const ok = (n: number, re: RegExp) => re.test(rows.find((r) => r.article_no === n)?.t ?? "");
      return { pass: ok(8, /^املادة الثامنة:/) && ok(718, /الثامنة عرشة بعد السبعامئة/) && ok(721, /احلادية والعرشون بعد السبعامئة/) && ok(17, /السابعة عرشة:/), output: rows };
    },
  },
  {
    id: "P8", finding: "B9/B16", title: "تعديل خدمات مصدر ونص مقطع في مكانهما", criterion: "يرفضهما قاعدة البيانات",
    run: async (tx) => {
      const out: Record<string, string> = {};
      for (const [k, stmt] of [["services", sql`update kb_sources set services = '{Z99}' where ref_code = 'INVEST-RULES'`], ["chunk_text", sql`update kb_chunks set text = 'عبث' where id = (select id from kb_chunks limit 1)`]] as const) {
        await tx.execute(sql`savepoint p8`);
        try { await tx.execute(stmt); out[k] = "ACCEPTED"; } catch (e) { out[k] = String((e as { cause?: { message?: string } }).cause?.message ?? e).slice(0, 80); }
        await tx.execute(sql`rollback to savepoint p8`);
      }
      return { pass: !Object.values(out).includes("ACCEPTED"), output: out };
    },
  },
  {
    id: "P9", finding: "B10", title: "سؤال تاريخي (2024-01-01) ونسخة لاحقة محمّلة اليوم بلا تاريخ سريان", criterion: "لا يُستشهد بأحدث نسخة محمّلة؛ «تاريخ السريان غير معروف»",
    run: async (tx) => {
      const [cur] = await tx.select().from(kbSources).where(and(eq(kbSources.refCode, "INVEST-RULES"), isNull(kbSources.supersededAt)));
      await reviewSource(tx, "INVEST-RULES", { passages: "all" });
      await ingestUnits(tx as never, { refCode: "INVEST-RULES", version: "v-next", title: cur!.title, issuer: cur!.issuer, refKind: "official_guide", services: cur!.services, origin: "مجس", originSha256: "probe", textQuality: "good", qualityNote: "", units: [{ locator: "صفحة الملف 14", articleNo: null, paragraphNo: null, pageFile: 14, pagePrinted: "14", text: "مسؤوليات لجنة الاستثمار والاستدامة المالية في المنظمات غير الربحية نسخة لاحقة", textOrigin: "text_layer" }], meta: cur!.meta as Record<string, unknown> });
      await reviewSource(tx, "INVEST-RULES", { passages: "all" });
      const r = await retrieve(tx, q("مسؤوليات لجنة الاستثمار والاستدامة المالية في المنظمات غير الربحية", { service: "I03", asOf: "2024-01-01", refCodes: ["INVEST-RULES"], historical: true }));
      return { pass: r.citable.length === 0 && r.results.every((x) => (x.decision as { refusal?: string }).refusal === "unknown_validity" || (x.decision as { refusal?: string }).refusal === "not_relevant"), output: brief(r) };
    },
  },
  {
    id: "P10", finding: "B15", title: "الخدمة null وقت التشغيل", criterion: "not_applicable لكل النتائج",
    run: async (tx) => { const r = await retrieve(tx, q("استبدال الوقف إذا تعطلت منافعه", { service: null as never, kinds: ["classical_fiqh"] })); return { pass: r.results.every((x) => (x.decision as { refusal?: string }).refusal === "not_applicable"), output: brief(r) }; },
  },
  {
    id: "P12", finding: "B13", title: "مرجع «جاهز» بمقارنة المادة 8 وحدها", criterion: "(قيد معروف منخفض) يُعدّ جاهزًا؛ الاستشهاد نفسه يبقى على مستوى المادة",
    run: async (tx) => { await acceptRegistry(tx, "NZR", "NZR/uqn-p18926", [8], "2022-02-04"); const ready = [...await readyRefCodes(tx, ["NAZARA-REG"], T)]; const r = await retrieve(tx, Q163); return { pass: insufficient(r), output: { ready, article16: brief(r) } }; },
  },
  {
    id: "P13", finding: "B12", title: "مسار التحميل بعد تشغيل البذرة", criterion: "المراجع الأربعة القديمة محملة من الكتالوج وحده؛ المحمّل القديم يرفضها",
    run: async (tx) => {
      const rows = (await tx.execute(sql`select ref_code, ref_kind, meta->>'loader' loader, superseded_at is null cur from kb_sources where ref_code in ('NAZARA-REG','CIVIL-TX','COMPANIES','NAZIR-GUIDE') and superseded_at is null order by 1`)).rows as { ref_code: string; ref_kind: string; loader: string | null }[];
      const { ingestSource } = await import("../../src/server/engine/knowledge/ingest");
      const legacy = await ingestSource(tx as never, { refCode: "NAZARA-REG", version: "x", title: "x", kind: "statute", origin: "x", text: "المادة الأولى: نص" }).then(() => "ACCEPTED", (e: Error) => e.message.slice(0, 90));
      return { pass: rows.length === 4 && rows.every((r) => r.loader === "knowledge/catalog" && r.ref_kind !== "unclassified") && legacy !== "ACCEPTED", output: { current: rows, legacyLoader: legacy } };
    },
  },
  {
    id: "A1", finding: "B11", title: "المساعد العام: سؤال نظامي في الحالة الفعلية (لا مراجعة)", criterion: "«المراجع غير كافية»: لا يُقدَّم شرح المكتبة سندًا",
    run: async (tx) => { const b = await regulatoryBasisIn(tx, "ما المدة التي يجب على الناظر خلالها تسجيل الوقف لدى الهيئة؟", T); return { pass: !b.sufficient, output: b }; },
  },
  {
    id: "A2", finding: "B11", title: "المساعد العام: السؤال نفسه بعد مطابقة معتمدة (حساب اختبار)", criterion: "يقتبس م8/ف1 بنص الحارس ووسمه",
    run: async (tx) => { await NZR(tx); const b = await regulatoryBasisIn(tx, "ما المدة التي يجب على الناظر خلالها تسجيل الوقف والأصول الموقوفة لدى الهيئة؟", T); return { pass: b.sufficient && b.quotes.some((x) => x.refCode === "NAZARA-REG" && x.locator === "م8/ف1" && x.binding && /ثلاثين يوم عمل/.test(x.text)), output: b }; },
  },
  {
    id: "A3", finding: "B11", title: "المساعد العام: سؤال عبثي بعد مراجعة كل شيء", criterion: "«المراجع غير كافية»",
    run: async (tx) => { await reviewEverything(tx); const b = await regulatoryBasisIn(tx, "ما حكم وقف الناظر على كوكب المريخ؟", T); return { pass: !b.sufficient, output: b }; },
  },
  ...ROUND4,
];

/**
 * The processing pipeline's section questions, measured for the report (not asserted): the former question (service +
 * section + writing instruction) against the question built from a synthetic request matter (knowledge/question.ts).
 */
export const PIPELINE_QUERIES: { service: string; section: string; instruction: string; matter: string; refCodes: string[] }[] = [
  { service: "I01", section: "التحليل", instruction: "اكتب التحليل مميزًا بين النص الأصلي والاستنتاج، مع ذكر مستند كل استنتاج.", matter: "نرغب في سياسة استثمار للوقف تراعي الحد المقبول للمخاطر وعائدًا مجديًا مقارنة بمخاطره دون تعريض الوقف لمخاطر عالية", refCodes: ["NAZARA-REG", "PRODUCTS-REG", "INVEST-GUIDE"] },
  { service: "N01", section: "المسائل والمخاطر", instruction: "حدد المسائل القانونية والمخاطر، واذكر سند كل مسألة من المراجع المعتمدة.", matter: "نطلب تولي النظارة وتسجيل الوقف وكافة الأصول الموقوفة التابعة له لدى الهيئة خلال المدة النظامية", refCodes: ["NAZARA-REG"] },
  { service: "C07", section: "التحليل", instruction: "اكتب التحليل مميزًا بين النص الأصلي والاستنتاج، مع ذكر مستند كل استنتاج.", matter: "هل للناظر أن يستدين على الوقف بلا إذن الحاكم لمصلحة الوقف؟", refCodes: ["FQH-KASHSHAF", "FQH-KASHSHAF-B21642", "FQH-SHARH-MUNTAHA"] },
];
export async function pipelineMeasure(tx: Tx) {
  await NZR(tx);
  await reviewEverything(tx);
  const out = [];
  for (const p of PIPELINE_QUERIES) {
    const names: Record<string, string> = { I01: "سياسة الاستثمار الوقفية", N01: "تولي النظارة (ناظر اعتباري)", C07: "استشارة شرعية" };
    for (const [how, matter] of [["تعليمة القسم (السابق)", null], ["مسألة الطلب (الحالي)", p.matter]] as const) {
      const question = sectionQuestion({ serviceName: names[p.service]!, sectionTitle: p.section, instruction: p.instruction, matter });
      const r = await retrieve(tx, { question, service: p.service, asOf: T, refCodes: p.refCodes, limit: 4 });
      out.push({ service: p.service, how, question, ...brief(r) });
    }
  }
  return out;
}
export { kbChunks };
