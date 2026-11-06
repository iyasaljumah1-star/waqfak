/**
 * Phase 1 verification run (offline, no database, no network): for every registered reference that has a verified
 * official snapshot, segments the official text, compares each knowledge-base copy with it article by article, and
 * writes a JSON report plus an Arabic summary under data/references/reports/.
 *
 *   npx tsx scripts/references/verify.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compareTexts, type ComparisonResult } from "../../src/server/references/compare";
import { PENDING_RETRIEVAL, REGISTRY, statusAt, validateRegistry } from "../../src/server/references/registry";
import { segment, toUnits } from "../../src/server/references/segment";
import { loadManifest, readCandidate, readSnapshot, REFERENCES_DIR } from "../../src/server/references/snapshots";
import { OUTCOME_LABEL_AR } from "../../src/server/references/types";

const TODAY = "2026-11-06";
const outDir = path.join(REFERENCES_DIR, "reports");
mkdirSync(outDir, { recursive: true });

const problems = validateRegistry();
if (problems.length) {
  console.error("Registry integrity violations:\n" + problems.join("\n"));
  process.exit(1);
}

const manifest = loadManifest();
type Row = { refId: string; name: string; status: string; officialArticles: number; units: number; candidate: string; result: ComparisonResult | null; note?: string };
const rows: Row[] = [];

for (const e of REGISTRY) {
  const snap = manifest.find((m) => m.refId === e.id && m.role === "text");
  const status = statusAt(e, TODAY);
  if (!snap) {
    rows.push({ refId: e.id, name: e.officialName, status, officialArticles: 0, units: 0, candidate: "—", result: null, note: status === "repealed" ? "ملغى: لا مطابقة لازمة" : "لا نسخة رسمية محفوظة: تعذر التحقق" });
    continue;
  }
  const official = readSnapshot(snap);
  const seg = segment(official);
  const units = toUnits(seg).length;
  if (!e.kbCandidates.length) rows.push({ refId: e.id, name: e.officialName, status, officialArticles: seg.articles.length, units, candidate: "—", result: null, note: "لا نسخة في قاعدة المعرفة للمقارنة" });
  for (const c of e.kbCandidates) {
    const cand = readCandidate(c.path);
    const result = compareTexts(official, cand.text);
    rows.push({ refId: e.id, name: e.officialName, status, officialArticles: seg.articles.length, units, candidate: c.label, result });
    writeFileSync(path.join(outDir, `${e.id}__${path.basename(c.path, ".txt")}.json`), JSON.stringify({ refId: e.id, official: { url: snap.url, sha256: snap.sha256, retrievedAt: snap.retrievedAt, via: snap.via, directConfirmed: snap.directConfirmed }, candidate: { ...c, sha256: cand.sha256 }, ranAt: TODAY, result }, null, 2));
  }
}

// Arabic summary
const lines: string[] = [];
lines.push(`# نتائج مطابقة المراجع — ${TODAY}`, "");
lines.push("| المرجع | الحالة في تاريخ الفحص | مواد النص الرسمي | وحدات مستخرجة | النسخة المقارنة | النتيجة | مطابق | تحريري | مؤثر | استخراج معيب | مواد زائدة |", "|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  const c = r.result?.counts;
  lines.push(`| ${r.name} | ${r.status} | ${r.officialArticles || "—"} | ${r.units || "—"} | ${r.candidate} | ${r.result ? OUTCOME_LABEL_AR[r.result.outcome] : r.note} | ${c?.identical ?? "—"} | ${c?.editorial_only ?? "—"} | ${c?.substantive_difference ?? "—"} | ${c?.extraction_defective ?? "—"} | ${r.result?.extraArticles.length ?? "—"} |`);
}
lines.push("", "## الاختلافات المؤثرة أو المفترض تأثيرها (حتى المراجعة)", "");
for (const r of rows) {
  if (!r.result) continue;
  const subs = r.result.articles.flatMap((a) => a.differences.filter((d) => d.class === "substantive" || d.class === "presumed_substantive"));
  if (!subs.length) continue;
  lines.push(`### ${r.name} — ${r.candidate}`, "", "| الموضع | التصنيف | السبب | النص الرسمي | النسخة | الأثر |", "|---|---|---|---|---|---|");
  for (const d of subs.slice(0, 60)) lines.push(`| ${d.locator} | ${d.class === "substantive" ? "مؤثر" : "مفترض التأثير"} | ${d.reason} | ${d.official.slice(0, 120) || "—"} | ${d.candidate.slice(0, 120) || "—"} | ${d.impact} |`);
  if (subs.length > 60) lines.push(`| … | | ${subs.length - 60} اختلافًا آخر في ملف JSON | | | |`);
  lines.push("");
}
lines.push("## مراجع لم تُسترجع نصوصها في هذه المرحلة", "", "| المرجع | المصدر الرسمي | سبب التعذر |", "|---|---|---|");
for (const p of PENDING_RETRIEVAL) lines.push(`| ${p.name} | ${p.official} | ${p.reason} |`);
writeFileSync(path.join(outDir, "summary.md"), lines.join("\n") + "\n");
console.log(lines.slice(0, rows.length + 4).join("\n"));
