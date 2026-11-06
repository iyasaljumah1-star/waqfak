/**
 * Link-status matrix of every reference and file (order of 2026-11-06, §3.7), computed — not declared — from the
 * catalog, the knowledge base of the test database (KE_TEST_DATABASE_URL), a retrieval probe per source, the
 * acceptance results and the reference registry.
 *
 *   npx tsx --conditions=react-server scripts/knowledge/link-matrix.ts
 *
 * Retrievable: three passages of the source are taken (first, middle, last), a question is built from 10 words of each,
 * and the source must come back in the top 6 of retrieve() without any reference filter, for at least 2 of the 3.
 * Approved for inference: citable without any synthetic review — i.e. as the database stands.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "../../src/server/db/schema";
import { loadCatalog } from "../../src/server/knowledge/catalog";
import { retrieve } from "../../src/server/knowledge/retrieve";
import { PENDING_RETRIEVAL, REGISTRY } from "../../src/server/references/registry";

const TODAY = "2026-11-06";

async function main() {
  const url = process.env.KE_TEST_DATABASE_URL ?? "";
  if (!/ke_test/.test(url)) throw new Error("KE_TEST_DATABASE_URL must name the ke_test database");
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema, casing: "snake_case" });
  const acceptance = JSON.parse(readFileSync(path.join(process.cwd(), "data/knowledge/reports/acceptance.json"), "utf8")) as { rows: { retrievedRef: string | null; pass: boolean; citable: boolean }[] };
  const tested = new Set(acceptance.rows.filter((r) => r.pass && r.retrievedRef).map((r) => r.retrievedRef!));
  const rows: Record<string, unknown>[] = [];
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', '', true), set_config('app.global_access', 'on', true)`);
    for (const e of loadCatalog()) {
      const [src] = await tx.select().from(schema.kbSources).where(and(eq(schema.kbSources.refCode, e.refCode), isNull(schema.kbSources.supersededAt))).limit(1);
      const chunks = src ? await tx.select({ text: schema.kbChunks.text, origin: schema.kbChunks.textOrigin }).from(schema.kbChunks).where(eq(schema.kbChunks.sourceId, src.id)) : [];
      let probes = 0;
      let found = 0;
      for (const c of [chunks[0], chunks[Math.floor(chunks.length / 2)], chunks[chunks.length - 1]].filter(Boolean)) {
        const words = c!.text.replace(/^\[[^\]]+\]\s*/, "").replace(/[^؀-ۿA-Za-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
        if (words.length < 5) continue;
        const mid = Math.max(0, Math.floor(words.length / 2) - 5);
        probes++;
        const r = await retrieve(tx as never, { question: words.slice(mid, mid + 10).join(" "), service: null, asOf: TODAY, historical: false, limit: 6 });
        if (r.results.some((x) => x.hit.refCode === e.refCode)) found++;
      }
      const any = await retrieve(tx as never, { question: e.title, service: null, asOf: TODAY, refCodes: [e.refCode], limit: 3 });
      const citableNow = any.results.some((x) => x.decision.citable);
      // the knowledge base holds the official snapshot of these; the project also holds a copy of the file
      const PROJECT_COPY: Record<string, string> = { "NAZARA-REG": "تنظيم أعمال النظارة.pdf", "PRODUCTS-REG": "List of Waqf Investment Products_1.pdf", "DONATIONS-REG": "regulationsforestablishingendowmentsthroughcollectingdonations.pdf", "BO-STD": "معايير المستفيد الحقيقي  النسخة المُعتمدة.pdf" };
      const fromProject = /ملف المشروع|ملف مرفق/.test(e.origin) || !!PROJECT_COPY[e.refCode];
      const verified =
        e.textForm === "quotes" ? "اقتباسات تحقق منها المختص على الصفحة أو المصدر" :
        e.registrySnapshot ? "نص لقطة رسمية؛ مطابقة آلية في محرك المراجع دون اعتماد بشري" :
        src?.textQuality === "degraded" ? "لا — نص OCR أو خلل ترتيب الحروف" : "لا — طبقة نص الملف دون مقابلة بالصفحات";
      rows.push({
        refCode: e.refCode, title: e.title, kind: e.refKind, registryId: e.registryId,
        inProject: fromProject, extracted: chunks.length > 0, extraction: chunks.length ? [...new Set(chunks.map((c) => c.origin))].join("+") : "—",
        verified, inKb: !!src, units: chunks.length, retrievable: probes ? found >= Math.min(2, probes) : false, probe: `${found}/${probes}`,
        services: e.services, linked: e.services.length > 0, tested: tested.has(e.refCode), approved: citableNow, quality: src?.textQuality ?? "—",
        superseded: e.repealedFrom ? `ملغى (حل محله ${e.repealedFrom})` : "",
      });
    }
    throw new Error("rollback");
  }).catch((err) => { if ((err as Error).message !== "rollback") throw err; });
  // registry instruments and pending ones that have no text in the knowledge base
  const inCat = new Set(loadCatalog().map((e) => e.registryId).filter(Boolean));
  for (const r of REGISTRY.filter((x) => !inCat.has(x.id))) rows.push({ refCode: r.id, title: r.officialName, kind: r.kind, registryId: r.id, inProject: false, extracted: false, extraction: "—", verified: "لا نص محفوظ", inKb: false, units: 0, retrievable: false, probe: "—", services: r.candidateServices.codes, linked: false, tested: false, approved: false, quality: "—", superseded: "" });
  for (const p of PENDING_RETRIEVAL) rows.push({ refCode: p.id, title: p.name, kind: "statute", registryId: null, inProject: false, extracted: false, extraction: "—", verified: `لم يُسترجع: ${p.reason}`, inKb: false, units: 0, retrievable: false, probe: "—", services: [], linked: false, tested: false, approved: false, quality: "—", superseded: "" });
  await pool.end();
  const dir = path.join(process.cwd(), "data/knowledge/reports");
  writeFileSync(path.join(dir, "link-matrix.json"), JSON.stringify({ ranAt: new Date().toISOString(), rows }, null, 1));
  const y = (b: unknown) => (b ? "✓" : "✗");
  const L = ["# مصفوفة حالة الربط لكل مرجع وملف — محرك المعرفة الموحد", "", `محسوبة ${TODAY} من قاعدة الاختبار waqfak_ke_test. «قابل للاسترجاع»: عاد المصدر في أول 6 نتائج لسؤالين من ثلاثة مبنيين من نصه، دون تقييد بالمرجع. «معتمد للاستدلال»: قابل للاستشهاد كما هي قاعدة البيانات الآن، دون أي مراجعة اصطناعية.`, "",
    "| المرجع | النوع | موجود في المشروع | مستخرج نصياً | متحقق من النص | مدخل في قاعدة المعرفة (وحدات) | قابل للاسترجاع | مربوط بالخدمة | مختبر بنجاح | معتمد للاستدلال | ملاحظة |", "|---|---|---|---|---|---|---|---|---|---|---|"];
  for (const r of rows as Record<string, never>[]) L.push(`| ${r.refCode} — ${String(r.title).slice(0, 60)} | ${r.kind} | ${y(r.inProject)} | ${y(r.extracted)} ${r.extraction} | ${r.verified} | ${y(r.inKb)} (${r.units}) | ${y(r.retrievable)} ${r.probe} | ${y(r.linked)} ${(r.services as string[]).length ? `(${(r.services as string[]).length})` : ""} | ${y(r.tested)} | ${y(r.approved)} | ${[r.quality !== "—" ? `جودة: ${r.quality}` : "", r.superseded].filter(Boolean).join("؛ ")} |`);
  writeFileSync(path.join(dir, "link-matrix.md"), L.join("\n") + "\n");
  const R = rows as { inKb: boolean; retrievable: boolean; linked: boolean; tested: boolean; approved: boolean }[];
  console.log(`rows ${R.length}; inKb ${R.filter((r) => r.inKb).length}; retrievable ${R.filter((r) => r.retrievable).length}; linked ${R.filter((r) => r.linked).length}; tested ${R.filter((r) => r.tested).length}; approved ${R.filter((r) => r.approved).length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
