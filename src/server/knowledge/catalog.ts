import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { assessQuality, splitPassages } from "@/server/engine/knowledge/pure";
import { getEntry } from "@/server/references/registry";
import { ingestUnits, type SourceInput } from "./ingest";
import type { RefKind } from "./policy";
import { pagesQuality, pageUnits, quoteUnits, statuteUnits, type ExtractedPage, type Unit, type VerifiedQuote } from "./units";

/**
 * The catalog of the unified knowledge engine (data/knowledge/catalog.json, built by scripts/knowledge/build_catalog.py)
 * and its loading into the knowledge base. Dates come from the reference registry for registered instruments, never
 * from the file: an instrument's effective date, and the date from which a repealed one stops applying (the effective
 * date of the instrument that repealed it).
 */
export type CatalogEntry = {
  refCode: string;
  registryId: string | null;
  registrySnapshot: string | null;
  refKind: RefKind;
  title: string;
  issuer: string | null;
  version: string;
  origin: string;
  originSha256: string;
  textForm: "statute" | "pages" | "quotes";
  text: string;
  note: string;
  services: string[];
  repealedFrom?: string | null;
  reviewRole?: string | null;
  blockedPages?: string[];
  /** Quality set by the catalog (a specialist's partial verification), overriding the measured one when lower. */
  quality?: "good" | "degraded" | "unreadable" | null;
};

export const KNOWLEDGE_DIR = path.join(process.cwd(), "data", "knowledge");

export function loadCatalog(dir = KNOWLEDGE_DIR): CatalogEntry[] {
  return (JSON.parse(readFileSync(path.join(dir, "catalog.json"), "utf8")) as { sources: CatalogEntry[] }).sources;
}

export function unitsOf(e: CatalogEntry, dir = KNOWLEDGE_DIR): { units: Unit[]; quality: "good" | "degraded" | "unreadable"; note: string } {
  const payload = JSON.parse(gunzipSync(readFileSync(path.join(dir, e.text))).toString("utf8")) as { text?: string; pages?: ExtractedPage[]; quotes?: VerifiedQuote[] };
  if (e.textForm === "statute") {
    let units = statuteUnits(payload.text ?? "");
    // a text with the known letter-order defect («املادة») is not parsed by the registry's segmenter: engine-core's
    // splitter, which reads that form, gives article passages (no paragraph locators)
    if (!units.length) {
      const ps = splitPassages(payload.text ?? "");
      // article numbers are trusted only when they form a unique sequence; compound ordinals in a reordered text
      // («الثامنة عرشة بعد السبعامئة») are misread, so a non-unique numbering gives sequential passages without numbers
      // a number is kept only when it follows the previous trusted one (n+1); anything else is a misread ordinal of the
      // reordered text and the passage keeps no number — no number is better than a wrong one (review B6/N4)
      let last = 0;
      units = ps.map((p, i) => {
        const ok = p.articleNo !== null && p.articleNo === last + 1 && /^\s*(المادة|املادة)/.test(p.text);
        if (ok) last = p.articleNo!;
        return { locator: ok ? `م${p.articleNo}` : `مقطع ${i + 1}`, articleNo: ok ? p.articleNo : null, paragraphNo: null, pageFile: null, pagePrinted: null, text: p.text, textOrigin: "text_layer" as const };
      });
    }
    const q = e.registrySnapshot ? { quality: "good" as const, note: "نص لقطة رسمية." } : assessQuality(payload.text ?? "");
    return { units, quality: q.quality, note: q.note };
  }
  if (e.textForm === "pages") {
    const pages = payload.pages ?? [];
    const quality = pagesQuality(pages);
    const ocr = pages.filter((p) => p.method === "ocr").length;
    return { units: pageUnits(pages), quality, note: `${pages.length} صفحة، منها ${ocr} بالتعرف الضوئي.` };
  }
  return { units: quoteUnits(payload.quotes ?? []), quality: "good", note: "اقتباسات تحقق منها المختص على الصفحة أو المصدر." };
}

function datesOf(e: CatalogEntry): { effectiveOn: string | null; repealedOn: string | null } {
  const reg = e.registryId ? getEntry(e.registryId) : undefined;
  const effectiveOn = reg?.effective.value?.from ?? null;
  const repealer = e.repealedFrom ? getEntry(e.repealedFrom) : undefined;
  const repealedOn = repealer?.effective.value?.from ?? null;
  return { effectiveOn, repealedOn };
}

const ORDER = ["good", "degraded", "unreadable"] as const;
const worse = (a: (typeof ORDER)[number], b?: (typeof ORDER)[number] | null) => (b && ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ingestCatalog(db: NodePgDatabase<any>, entries = loadCatalog(), dir = KNOWLEDGE_DIR) {
  const out: { refCode: string; status: string; units: number; quality: string }[] = [];
  for (const e of entries) {
    const u = unitsOf(e, dir);
    const d = datesOf(e);
    const input: SourceInput = {
      refCode: e.refCode, version: e.version, title: e.title, issuer: e.issuer, refKind: e.refKind, registryId: e.registryId, registrySnapshot: e.registrySnapshot,
      effectiveOn: d.effectiveOn, repealedOn: d.repealedOn, services: e.services, origin: e.origin, originSha256: e.originSha256, textQuality: worse(u.quality, e.quality),
      qualityNote: `${u.note} ${e.note}`.trim(), units: u.units, meta: { textForm: e.textForm, reviewRole: e.reviewRole ?? null, blockedPages: e.blockedPages ?? [] },
    };
    const r = await ingestUnits(db, input);
    out.push({ refCode: e.refCode, status: r.status, units: r.units, quality: u.quality });
  }
  return out;
}
