/**
 * Runs the knowledge engine's acceptance suite against the test database named by KE_TEST_DATABASE_URL, each item in
 * a rolled-back transaction, and writes data/knowledge/reports/acceptance.{json,md} with every output, refusals
 * included:
 *   A. the actual state — the knowledge base as loaded, no review on record: every question must be refused;
 *   B. the mechanism cases — with reviews recorded by a TEST ACCOUNT through the reviewers' own path (not a human review);
 *   C. the adversarial probes of the independent review, rebuilt (tests/knowledge/probes.ts);
 *   D. a measure of the processing pipeline's section queries (reported, not asserted).
 *
 *   npx tsx --conditions=react-server scripts/knowledge/acceptance-report.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "../../src/server/db/schema";
import { CASES, KNOWN_LIMITS, runActual, runCase, type ActualRow, type CaseRow } from "../../tests/knowledge/cases";
import { pipelineMeasure, PROBES } from "../../tests/knowledge/probes";

async function main() {
  const url = process.env.KE_TEST_DATABASE_URL ?? "";
  if (!/ke_test/.test(url)) throw new Error("KE_TEST_DATABASE_URL must name the ke_test database");
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema, casing: "snake_case" });
  async function rb<T>(fn: (tx: import("../../src/server/db").Tx) => Promise<T>): Promise<T> {
    let out: T | undefined;
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', '', true), set_config('app.global_access', 'on', true)`);
      out = await fn(tx as never);
      tx.rollback();
    }).catch((e) => { if (!/rollback/i.test(String(e?.message ?? e))) throw e; });
    return out as T;
  }
  const actual: ActualRow[] = [];
  for (const c of CASES) actual.push(await rb((tx) => runActual(tx, c)));
  const rows: (CaseRow & { knownLimit: boolean })[] = [];
  for (const [list, known] of [[CASES, false], [KNOWN_LIMITS, true]] as const) for (const c of list) rows.push({ ...(await rb((tx) => runCase(tx, c))), knownLimit: known });
  const probes: { id: string; finding: string; title: string; criterion: string; pass: boolean; output: unknown }[] = [];
  for (const p of PROBES) {
    const r = await rb(async (tx) => p.run(tx).catch((e: Error) => ({ pass: false, output: { ERROR: String((e as { cause?: { message?: string } }).cause?.message ?? e.message).slice(0, 300) } })));
    probes.push({ id: p.id, finding: p.finding, title: p.title, criterion: p.criterion, ...r });
  }
  const pipeline = await rb((tx) => pipelineMeasure(tx));
  const kb = await rb(async (tx) => (await tx.execute(sql`select count(*) filter (where superseded_at is null)::int cur, (select count(*)::int from kb_chunks c join kb_sources s on s.id = c.source_id where s.superseded_at is null) units from kb_sources`)).rows[0] as { cur: number; units: number });
  await pool.end();

  const dir = path.join(process.cwd(), "data/knowledge/reports");
  mkdirSync(dir, { recursive: true });
  const ranAt = new Date().toISOString();
  writeFileSync(path.join(dir, "acceptance.json"), JSON.stringify({ ranAt, kb, actual, rows, probes, pipeline }, null, 1));
  const yes = (b: boolean | null) => (b === null ? "—" : b ? "نعم" : "لا");
  const cell = (s: string | null | undefined, n = 160) => (s ?? "—").replace(/\|/g, "/").replace(/\s+/g, " ").slice(0, n);
  const L = [
    "# نتائج اختبارات الاسترجاع والاستشهاد — محرك المعرفة الموحد", "",
    `شُغّلت ${ranAt.slice(0, 16)} على قاعدة اختبار محلية (waqfak_ke_test): ${kb.cur} مصدرًا حاليًا و${kb.units} وحدة استرجاع. كل بند في معاملة تُلغى بعده.`, "",
    "## أ. الحالة الفعلية: لا مراجعة بشرية مسجلة", "",
    "أسئلة الحالات كلها على قاعدة المعرفة كما هي، دون أي إعداد. المعيار: لا مقطع قابل للاستشهاد و«المراجع غير كافية».", "",
    "| # | السؤال | الخدمة | نتائج مسترجعة | قابل للاستشهاد | أول نتيجة وقرارها | السبب | النتيجة |", "|---|---|---|---|---|---|---|---|",
    ...actual.map((r) => `| ${r.id} | ${cell(r.question, 90)} | ${r.service} | ${r.retrieved} | ${r.citable} | ${cell(r.top, 110)} | ${cell(r.reason, 120)} | ${r.pass ? "ناجح" : "فشل"} |`), "",
    "## ب. حالات الآلية (مراجعات من حساب اختبار عبر مسار المراجع نفسه — لا تثبت مراجعة بشرية)", "",
    "| # | الفئة | السؤال | الخدمة | المرجع المتوقع | المرجع المسترجع | الموضع | مقتطف النص المسترجع | مطابق للأصل | أحدث نسخة | منطبق | قرار الاستشهاد | النتيجة |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.id} | ${cell(r.category, 80)} | ${cell(r.question, 90)} | ${r.service ?? "—"} | ${cell(r.expected, 120)} | ${r.retrievedRef ?? "—"} | ${r.locator ?? "—"} | ${cell(r.excerpt, 140)} | ${yes(r.matchesOriginal)} | ${yes(r.latestVersion)} | ${yes(r.applicable)} | ${cell(r.decision, 140)} | ${r.pass ? "ناجح" : r.knownLimit ? "فشل (قيد معروف)" : "فشل"}${r.note ? ` — ${cell(r.note, 140)}` : ""} |`), "",
    "## ج. المجسات العدائية لمراجعة الجودة", "",
    "| # | الملاحظة | المجس | المعيار | النتيجة | المخرج |", "|---|---|---|---|---|---|",
    ...probes.map((p) => `| ${p.id} | ${p.finding} | ${cell(p.title, 120)} | ${cell(p.criterion, 120)} | ${p.pass ? "ناجح" : "فشل"} | ${cell(JSON.stringify(p.output), 400)} |`), "",
    "## د. استعلامات المعالجة بأقسامها (قياس لا اختبار)", "",
    "| الخدمة | بناء الاستعلام | الاستعلام | كافٍ | قابل للاستشهاد | السبب |", "|---|---|---|---|---|---|",
    ...pipeline.map((p) => `| ${p.service} | ${p.how} | ${cell(p.question, 90)} | ${p.sufficient ? "نعم" : "لا"} | ${cell(p.citable.join("؛ "), 200)} | ${cell(p.reason, 160)} |`), "",
  ];
  writeFileSync(path.join(dir, "acceptance.md"), L.join("\n"));
  console.log(`actual: ${actual.filter((r) => r.pass).length}/${actual.length}`);
  console.log(rows.map((r) => `${r.id} ${r.pass ? "PASS" : "FAIL"} ${r.retrievedRef} ${r.locator}`).join("\n"));
  console.log(probes.map((p) => `${p.id} ${p.pass ? "PASS" : "FAIL"}`).join("  "));
  console.log(JSON.stringify(pipeline.map((p) => ({ s: p.service, how: p.how, ok: p.sufficient, n: p.citable.length, why: p.reason?.slice(0, 80) }))));
}
main().catch((e) => { console.error(e); process.exit(1); });
