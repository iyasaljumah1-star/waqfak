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
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "../../src/server/db";
import { auditLogs, kbChunks, kbSourceReviews, kbSources, users } from "../../src/server/db/schema";
import { canonical } from "../../src/server/lib/audit";
import { sha256 } from "../../src/server/lib/crypto";
import { recordComparisonReview, recordSourceReview, reviewSeal, roleOf, sourceReviewText } from "../../src/server/knowledge/review";
import { appendMatchRun, appendVersion, registerSource } from "../../src/server/references/db-store";
import { getEntry } from "../../src/server/references/registry";
import { loadManifest, versionFromSnapshot } from "../../src/server/references/snapshots";
import { loadCatalog, KNOWLEDGE_DIR, unitsOf } from "../../src/server/knowledge/catalog";
import { ingestUnits } from "../../src/server/knowledge/ingest";
import type { RefKind, ReviewRole } from "../../src/server/knowledge/policy";
import { retrieve, type RetrieveQuery, type RetrieveResult } from "../../src/server/knowledge/retrieve";
import { statuteUnits } from "../../src/server/knowledge/units";

/**
 * TEST ACCOUNT, not a human reviewer. The mechanism cases need a review on record to show what the policy does with
 * one; they record it through the same path a reviewer uses (knowledge/review.ts: the reviewer's own session, the
 * permission of the field, the audit entry), from an account given the catalog's reviewer roles inside the case's
 * rolled-back transaction. Such a case proves the mechanism, never that a human reviewed anything (owner's order
 * 2026-11-06, §4): the actual state — no review at all — is asserted separately (ACTUAL_STATE).
 */
export const TEST_REVIEWER = "00000000-0000-4000-8000-00000000ae01";
/** @deprecated name kept for the probes; it is the test account above. */
export const SYNTHETIC_REVIEWER = TEST_REVIEWER;
const TODAY = "2026-11-06";

const ROLE_OF: Record<ReviewRole, string> = { legal: "reviewer_legal", sharia: "reviewer_sharia", accounting: "reviewer_accounting", data: "reviewer_data", investment: "reviewer_investment" };

/** A test account holding the catalog's reviewer roles for these fields (inside the caller's rolled-back transaction). */
export async function testReviewer(tx: Tx, id = TEST_REVIEWER, fields: ReviewRole[] = ["sharia", "accounting", "legal", "data", "investment"]) {
  await tx.insert(users).values({ id, phone: `05${id.slice(-8).replace(/[^0-9]/g, "0")}`, fullName: "حساب اختبار (ليس مراجعًا بشريًا)", isStaff: true }).onConflictDoNothing();
  for (const f of fields) {
    // the roles and permissions come from the catalog, seeded with the owner role (the application role cannot create
    // them: owner's order 2026-11-07, N5-1)
    const ok = await tx.execute<{ n: number }>(sql`select count(*)::int as n from role_permissions rp join roles r on r.id = rp.role_id join permissions p on p.id = rp.permission_id where r.key = ${ROLE_OF[f]} and p.key = ${`knowledge.review.${f}`}`);
    if (!ok.rows[0]?.n) throw new Error(`the test database is not seeded: role ${ROLE_OF[f]} with knowledge.review.${f} is missing (run scripts/seed.ts)`);
    // a reviewer is named by an administrator from their own session (holder of admin.roles), never from the system
    // context (security.sql reviewer_grant_guard) — so the test does it the same way, with a test administrator
    await testAdmin(tx);
    await asUser(tx, TEST_ADMIN, () => tx.execute(sql`insert into user_roles (user_id, role_id) select ${id}::uuid, r.id from roles r where r.key = ${ROLE_OF[f]} on conflict do nothing`));
  }
  await testSession(tx, id);
}

/** TEST ACCOUNT of an administrator (super_admin), who names the test reviewers. */
export const TEST_ADMIN = "00000000-0000-4000-8000-00000000ad01";
export async function testAdmin(tx: Tx) {
  await tx.insert(users).values({ id: TEST_ADMIN, phone: "0500000ad1", fullName: "حساب اختبار مدير (ليس شخصًا)", isStaff: true }).onConflictDoNothing();
  await tx.execute(sql`insert into user_roles (user_id, role_id) select ${TEST_ADMIN}::uuid, r.id from roles r where r.key = 'super_admin' on conflict do nothing`);
}

/**
 * A live, second-factor-verified session of the test account, as login creates one (the row holds the token's hash).
 * Its token is what the account's requests carry (actorOf): reviews are bound to it by the database.
 */
const TOKENS = new Map<string, string>();
export async function testSession(tx: Tx, userId: string, o: { mfa?: boolean; expired?: boolean; revoked?: boolean } = {}) {
  const token = `test-session-${userId}-${o.mfa === false ? "nomfa" : ""}${o.expired ? "exp" : ""}${o.revoked ? "rev" : ""}`;
  const exp = o.expired ? sql`now() - interval '1 minute'` : sql`now() + interval '1 hour'`;
  await tx.execute(sql`insert into sessions (user_id, token_hash, mfa_verified, idle_expires_at, absolute_expires_at, revoked_at)
    select ${userId}::uuid, ${sha256(token)}, ${o.mfa !== false}, ${exp}, ${exp}, ${o.revoked ? sql`now()` : sql`null`}
    where not exists (select 1 from sessions where token_hash = ${sha256(token)})`);
  if (!o.mfa && o.mfa !== false && !o.expired && !o.revoked) TOKENS.set(userId, token);
  return token;
}
/** The reviewer's request as the server sees it: the account and its session token. */
export const actorOf = (userId: string) => ({ userId, sessionToken: TOKENS.get(userId) ?? "" });
/** @deprecated alias of testReviewer. */
export const syntheticReviewer = testReviewer;

/** Runs `fn` in the session of `userId` (as a reviewer's action does), then returns to the system context. */
export async function asUser<T>(tx: Tx, userId: string, fn: () => Promise<T>): Promise<T> {
  await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
  const out = await fn(); // on error the transaction is aborted and rolled back: nothing to restore
  await tx.execute(sql`select set_config('app.user_id', '', true)`);
  return out;
}

/** Fires the deferred checks now (every review recorded so far must have its audit entry). */
export async function checkDeferred(tx: Tx) {
  await tx.execute(sql`set constraints all immediate`);
  await tx.execute(sql`set constraints all deferred`);
}

/** Records, inside the caller's (rolled-back) transaction, an accepted comparison of an official snapshot. */
export async function acceptRegistry(tx: Tx, registryId: string, snapshotId: string, articles: number[], effectiveFrom: string, reviewer = TEST_REVIEWER) {
  await testReviewer(tx, reviewer);
  const entry = getEntry(registryId)!;
  const snap = loadManifest().find((m) => m.id === snapshotId)!;
  const srcId = await registerSource(tx, entry);
  const v = versionFromSnapshot(snap, effectiveFrom, `${snapshotId} (اختبار)`);
  const vId = await appendVersion(tx, srcId, v);
  const perArticle = Object.fromEntries(articles.map((a) => [`م${a}`, "identical"])) as Record<string, "identical">;
  const runId = await appendMatchRun(tx, vId, { id: "x", versionId: vId, candidateLabel: "اختبار قبول", candidateSha256: v.source.sha256, outcome: "identical", perArticle, ranAt: `${TODAY}T08:00:00Z` }, { synthetic: true });
  await asUser(tx, reviewer, () => recordComparisonReview(tx, actorOf(reviewer), { runId, decision: "accepted", note: "مراجعة من حساب اختبار لاختبار الآلية" }));
  return runId;
}

async function currentSource(tx: Tx, refCode: string) {
  const [s] = await tx.select().from(kbSources).where(and(eq(kbSources.refCode, refCode), isNull(kbSources.supersededAt))).limit(1);
  return s!;
}

/**
 * Records, through knowledge/review.ts in the test account's session, an accepted (or rejected) review of the current
 * source and of its passages: `passages` = locators, or "all" for every passage of the source.
 */
/**
 * Reviews a source through knowledge/review.ts: the source as a whole and (B13: a review approves the passage it names,
 * and only it) its passages — all of them unless `passages` names some, or `passages: "none"` reviews the source alone.
 */
export async function reviewSource(tx: Tx, refCode: string, o: { decision?: "accepted" | "rejected"; passages?: string[] | "all" | "none"; reviewer?: string; fields?: ReviewRole[] } = {}) {
  o = { ...o, passages: o.passages ?? "all" };
  if (o.passages === "none") o.passages = undefined;
  const reviewer = o.reviewer ?? TEST_REVIEWER;
  await testReviewer(tx, reviewer, o.fields);
  const s = await currentSource(tx, refCode);
  const note = "مراجعة من حساب اختبار لاختبار الآلية";
  await asUser(tx, reviewer, () => recordSourceReview(tx, actorOf(reviewer), { sourceId: s.id, decision: o.decision ?? "accepted", note }));
  if (o.passages) {
    const chunks = await tx.select({ id: kbChunks.id, locator: kbChunks.locator }).from(kbChunks).where(eq(kbChunks.sourceId, s.id));
    const pick = o.passages === "all" ? chunks : chunks.filter((c) => (o.passages as string[]).includes(c.locator));
    if (pick.length > 20) await bulkReviews(tx, reviewer, pick.map((c) => ({ sourceId: s.id, chunkId: c.id, role: roleOf(s) })), o.decision ?? "accepted");
    else for (const c of pick) await asUser(tx, reviewer, () => recordSourceReview(tx, actorOf(reviewer), { sourceId: s.id, chunkId: c.id, decision: o.decision ?? "accepted", note }));
  }
}

/**
 * Many reviews at once for the worst-case tests, recorded the way knowledge/review.ts records them — the reviewer's
 * session, then one audit entry per review on the same hash chain (lib/audit.ts's formula) — in batches.
 */
async function bulkReviews(tx: Tx, reviewer: string, items: { sourceId: string; chunkId: string | null; role: ReviewRole }[], decision: "accepted" | "rejected") {
  const note = "مراجعة من حساب اختبار لاختبار الآلية";
  const sources = new Map((await tx.select({ id: kbSources.id, refCode: kbSources.refCode, version: kbSources.version, sha256: kbSources.sha256 }).from(kbSources)).map((x) => [x.id, x]));
  const chunkIds = items.map((x) => x.chunkId).filter((x): x is string => !!x);
  const texts = new Map<string, string>();
  for (let i = 0; i < chunkIds.length; i += 2000) for (const c of await tx.select({ id: kbChunks.id, text: kbChunks.text }).from(kbChunks).where(inArray(kbChunks.id, chunkIds.slice(i, i + 2000)))) texts.set(c.id, c.text);
  await asUser(tx, reviewer, async () => {
    await tx.execute(sql`select set_config('app.session_token', ${actorOf(reviewer).sessionToken}, true)`);
    await tx.execute(sql`select pg_advisory_xact_lock(724501)`);
    let prev = ((await tx.execute<{ h: string | null }>(sql`select app_audit_last_hash() as h`)).rows[0]?.h) ?? "GENESIS";
    for (let i = 0; i < items.length; i += 500) {
      const part = items.slice(i, i + 500);
      const rows = await tx.insert(kbSourceReviews).values(part.map((x) => ({ sourceId: x.sourceId, chunkId: x.chunkId, reviewerUserId: reviewer, reviewerRole: x.role, decision, note }))).returning({ id: kbSourceReviews.id, sessionId: kbSourceReviews.sessionId });
      const at = new Date().toISOString();
      const entries = rows.map((r, k) => {
        const textSha256 = sha256(sourceReviewText(sources.get(part[k].sourceId)!, part[k].chunkId ? texts.get(part[k].chunkId!) : null));
        const seal = reviewSeal({ kind: "kb_source_review", id: r.id, reviewer, decision, target: `${part[k].sourceId}|${part[k].chunkId ?? ""}`, role: part[k].role, textSha256, sessionId: r.sessionId });
        const after = { sourceId: part[k].sourceId, chunkId: part[k].chunkId, role: part[k].role, decision, note, bulk: true, textSha256, seal };
        const hash = sha256(JSON.stringify(canonical([prev, at, reviewer, "knowledge.review.recorded", "kb_source_review", r.id, null, null, after])));
        const e = { actorUserId: reviewer, action: "knowledge.review.recorded", entityType: "kb_source_review", entityId: r.id, after, prevHash: prev, hash, at: new Date(at) };
        prev = hash;
        return e;
      });
      await tx.insert(auditLogs).values(entries);
    }
    await tx.execute(sql`select set_config('app.session_token', '', true)`);
  });
}

/** Every current source reviewed, with all its passages (the worst case for a question without a basis). */
export async function reviewEverything(tx: Tx) {
  await testReviewer(tx);
  const rows = await tx.select({ s: kbSources, c: kbChunks.id }).from(kbChunks).innerJoin(kbSources, eq(kbSources.id, kbChunks.sourceId)).where(isNull(kbSources.supersededAt));
  const sources = new Map(rows.map((r) => [r.s.id, r.s]));
  await bulkReviews(tx, TEST_REVIEWER, [...sources.values()].map((s) => ({ sourceId: s.id, chunkId: null, role: roleOf(s) })), "accepted");
  await bulkReviews(tx, TEST_REVIEWER, rows.map((r) => ({ sourceId: r.s.id, chunkId: r.c, role: roleOf(r.s) })), "accepted");
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
  setup?: (tx: Tx) => Promise<unknown>;
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

/** Two versions of a synthetic guide, each with its own effective date (2020-01-01, then 2025-01-01), or undated. */
const SYN_VERSIONS = (dated = true) => async (tx: Tx) => {
  const base = { refCode: "SYN-GUIDE", title: "دليل اصطناعي", issuer: null, refKind: "official_guide" as const, services: ["C01"], origin: "اختبار", textQuality: "good" as const, qualityNote: "" };
  const u = (t: string) => [{ locator: "س1", articleNo: null, paragraphNo: null, pageFile: null, pagePrinted: null, text: t, textOrigin: "verified_quote" as const }];
  await ingestUnits(tx as never, { ...base, version: "الإصدار 1", effectiveOn: dated ? "2020-01-01" : null, originSha256: "v1", units: u("مدة حفظ سجلات الوقف الاصطناعي في الدليل الاصطناعي خمس سنوات.") });
  await reviewSource(tx, "SYN-GUIDE");
  await ingestUnits(tx as never, { ...base, version: "الإصدار 2", effectiveOn: dated ? "2025-01-01" : null, originSha256: "v2", units: u("مدة حفظ سجلات الوقف الاصطناعي في الدليل الاصطناعي عشر سنوات.") });
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
    expected: "مراجعة المصدر وحدها لا تكفي لصفحة مستخرجة: «لم يراجعه مختص» (B13)",
    setup: (tx) => reviewSource(tx, "ASSETS-GUIDE", { passages: "none" }),
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
    setup: SYN_VERSIONS(),
    judge: (r) => (r.results.some((x) => x.hit.text.includes("خمس سنوات")) ? "عادت النسخة السابقة" : expectCitable(r, "SYN-GUIDE", "س1", "عشر سنوات")),
  },
  {
    id: "9c", category: "9. سؤال تاريخي: النص النافذ في التاريخ المطلوب (مجس المراجعة P9)",
    query: { question: "ما مدة حفظ سجلات الوقف الاصطناعي في الدليل الاصطناعي؟", service: "C01", asOf: "2023-06-01", refCodes: ["SYN-GUIDE"], historical: true },
    expected: "في 2023-06-01 النافذ هو الإصدار 1 (خمس سنوات) موسومًا «نسخة سابقة، سارية من 2020-01-01 إلى 2025-01-01»؛ الإصدار 2 لم يكن نافذًا",
    setup: SYN_VERSIONS(),
    judge: (r) => {
      if (r.citable.some((x) => x.hit.text.includes("عشر سنوات"))) return "استُشهد بنسخة لم تكن نافذة";
      const why = expectCitable(r, "SYN-GUIDE", "س1", "خمس سنوات");
      if (why) return why;
      const later = r.results.find((x) => x.hit.text.includes("عشر سنوات"));
      if (!later || refusal(later.decision) !== "not_yet_effective") return "النسخة اللاحقة لم تُرفض بأنها غير نافذة";
      return (first(r)!.decision as { label: string }).label.endsWith("نسخة سابقة، سارية من 2020-01-01 إلى 2025-01-01") ? null : "الوسم لا يبين تاريخ السريان والانتهاء";
    },
  },
  {
    id: "9d", category: "9. سؤال تاريخي ونسخ بلا تاريخ سريان (مجس المراجعة P9)",
    query: { question: "ما مدة حفظ سجلات الوقف الاصطناعي في الدليل الاصطناعي؟", service: "C01", asOf: "2023-06-01", refCodes: ["SYN-GUIDE"], historical: true },
    expected: "لا يُعرف النافذ في التاريخ: لا يُستشهد بأي نسخة (لا أحدث نسخة محمّلة)",
    setup: SYN_VERSIONS(false),
    judge: (r) => (r.citable.length === 0 && r.results.length > 0 && r.results.every((x) => refusal(x.decision) === "unknown_validity") ? null : "استُشهد بنسخة لا يُعرف تاريخ سريانها"),
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
    id: "11b", category: "11. سؤال عبثي من كلمات وقفية شائعة (مجس المراجعة P1b)",
    query: { question: "ما حكم وقف الناظر على كوكب المريخ؟", service: "N01", asOf: TODAY },
    expected: "«المراجع غير كافية» حتى بعد مراجعة كل المصادر",
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
    expected: "مراجع شرعي لا يستطيع تسجيل مراجعة معيار محاسبي، ولا يصير المعيار قابلاً للاستشهاد",
    setup: async (tx) => {
      const R = "00000000-0000-4000-8000-00000000ae05";
      const refused = await reviewSource(tx, "SOCPA-NPO-2025", { reviewer: R, fields: ["sharia"] }).then(() => false, (e: Error) => /المراجعة المحاسبية/.test(e.message));
      if (!refused) throw new Error("قُبلت مراجعة من غير مجال المصدر");
    },
    judge: (r) => (r.citable.length === 0 && r.results.some((x) => refusal(x.decision) === "passage_not_reviewed") ? null : "قُبلت مراجعة من غير مجاله"),
  },
  {
    id: "14a", category: "14. سؤال عبثي يشترك مع نص في كلمات نادرة متباعدة (مجس المراجعة P1e)",
    query: { question: "شروط الواقف في الصين", service: "*", asOf: TODAY },
    expected: "«المراجع غير كافية» حتى بعد مراجعة كل المصادر: كلمات السؤال لا تجتمع في موضع واحد",
    setup: reviewEverything,
    judge: (r) => (!r.sufficiency.sufficient && r.citable.length === 0 ? null : `قُدّم سند: ${first(r)?.hit.refCode} ${first(r)?.hit.locator} cov=${first(r)?.hit.coverage.toFixed(2)}`),
  },
  {
    id: "14b", category: "14. سؤال مشروع بعد مراجعة كل المصادر (الصلة لا تمنع الجواب الصحيح)",
    query: { question: "هل للناظر أن يستدين على الوقف بلا إذن الحاكم لمصلحة الوقف؟", service: "C07", asOf: TODAY },
    expected: "كشاف القناع (ط وزارة العدل) ج10 ص55 أو طبعة مصيلحي ج4 ص267: الاستدانة بلا إذن حاكم لمصلحة",
    setup: reviewEverything,
    judge: (r) => (r.sufficiency.sufficient && r.citable.some((x) => /^FQH-KASHSHAF/.test(x.hit.refCode) && /الاستدانة|يستدين|استدان/.test(x.hit.text)) ? null : `لم يُجب من الكشاف (${r.citable.map((x) => `${x.hit.refCode} ${x.hit.locator}`).join("، ") || (r.sufficiency as { reason?: string }).reason})`),
  },
  {
    id: "14c", category: "14. مادة غير موجودة دون تحديد المرجع (مجس المراجعة P2b)",
    query: { question: "ما نص المادة 300 من لائحة تنظيم أعمال النظارة؟", service: "*", asOf: TODAY, needBinding: true },
    expected: "«غير موجودة»؛ لا تُعوَّض بمادة أخرى ولو رُوجع كل شيء",
    setup: async (tx) => { await acceptRegistry(tx, "NZR", "NZR/uqn-p18926", [8, 16], "2022-02-04"); await reviewEverything(tx); },
    judge: (r) => (!r.sufficiency.sufficient && r.citable.length === 0 && /المادة 300/.test((r.sufficiency as { reason?: string }).reason ?? "") ? null : "قُدّم سند لمادة غير موجودة"),
  },
  {
    id: "14d", category: "14. «الميسّر» وحده (قرار المالك 2026-11-07، رابعاً)",
    query: { question: "ما اللجان المتفرعة من مجلس النظارة في الوقف المؤسسي؟", service: "*", asOf: TODAY, refCodes: ["BOOK-MAYSAR"] },
    expected: "يُستعمل «الميسّر» وحده: صالح للمسودة بوسم «كتاب معاصر»، ويُستشهد بمقطعه نهائيًا بعد مراجعة المقطع، ولا يُوسم ملزمًا",
    setup: (tx) => reviewSource(tx, "BOOK-MAYSAR", { passages: "all" }),
    judge: (r) => {
      const m = r.citable.find((x) => x.hit.refCode === "BOOK-MAYSAR");
      const d = r.usable.find((x) => x.hit.refCode === "BOOK-MAYSAR");
      if (!m || !r.sufficiency.sufficient) return `الكفاية ${r.sufficiency.sufficient}`;
      if (m.decision.citable && m.decision.binding) return "وُسم ملزمًا";
      return d?.draft.usable && d.draft.flags.includes("contemporary") ? null : "لا وسم «كتاب معاصر» في المسودة";
    },
  },
  {
    id: "14e", category: "14. صفحات «الميسّر» التي رصد المختصون خطأها محجوبة (B8)",
    query: { question: "ضوابط الاستدانة للوقف موافقة القاضي أو وجود شرط للواقف", service: "*", asOf: TODAY, refCodes: ["BOOK-MAYSAR"] },
    expected: "ص194 (الاستدانة) تُسترجع وتُرفض «محجوب بملاحظة مختص»",
    setup: (tx) => reviewSource(tx, "BOOK-MAYSAR", { passages: "all" }),
    judge: (r) => {
      const p = r.results.find((x) => x.hit.pagePrinted === "194");
      if (!p) return "لم تُسترجع ص194";
      return !p.decision.citable && refusal(p.decision) === "blocked_passage" ? null : `القرار ${refusal(p.decision)}`;
    },
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
  // every review the setup recorded must have its audit entry (the database's deferred check, fired now)
  await checkDeferred(tx);
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

export type ActualRow = { id: string; question: string; service: string; retrieved: number; citable: number; sufficient: boolean; reason: string; top: string | null; pass: boolean };

/**
 * The actual state, with the knowledge base as loaded and NO review on record (no reviewer has been named): every
 * case's question must be refused — nothing citable, «المراجع غير كافية». Run without the cases' setups.
 */
export async function runActual(tx: Tx, c: Case): Promise<ActualRow> {
  const r = await retrieve(tx, c.query);
  const top = r.results[0] ? `${r.results[0].hit.refCode} ${r.results[0].hit.locator}: ${r.results[0].decision.citable ? "قابل للاستشهاد" : (r.results[0].decision as { refusal: string }).refusal}` : null;
  return {
    id: c.id, question: c.query.question, service: c.query.service, retrieved: r.results.length, citable: r.citable.length, sufficient: r.sufficiency.sufficient,
    reason: r.sufficiency.sufficient ? "" : (r.sufficiency as { reason: string }).reason, top, pass: r.citable.length === 0 && !r.sufficiency.sufficient,
  };
}
