import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser } from "playwright-core";
import { env } from "../../env";

/**
 * Shared HTML → PDF renderer (headless Chromium via playwright-core).
 * Contract used by several teams:
 *   renderPdf(html, { headerTitle?, landscape? }) → Buffer (A4, backgrounds printed, Arabic RTL, page-numbered footer)
 *   pdfShell(title, bodyHtml) → full HTML document with embedded fonts and the brand print CSS
 * Fonts are embedded as base64 @font-face so rendering never needs the network.
 * One browser instance is reused (cached promise); each render opens and closes its own page.
 */

// Brand face (Thmanyah Sans, original files embedded in the generated PDF) + Noto Naskh for document headings.
const FONT_FILES: { family: string; weight: number; file: string; dir: "brand" | "fontsource"; format: "opentype" | "woff2" }[] = [
  { family: "Thmanyah Sans", weight: 400, file: "thmanyahsans-Regular.otf", dir: "brand", format: "opentype" },
  { family: "Thmanyah Sans", weight: 500, file: "thmanyahsans-Medium.otf", dir: "brand", format: "opentype" },
  { family: "Thmanyah Sans", weight: 700, file: "thmanyahsans-Bold.otf", dir: "brand", format: "opentype" },
  { family: "Noto Naskh Arabic", weight: 500, file: "noto-naskh-arabic/files/noto-naskh-arabic-arabic-500-normal.woff2", dir: "fontsource", format: "woff2" },
  { family: "Noto Naskh Arabic", weight: 700, file: "noto-naskh-arabic/files/noto-naskh-arabic-arabic-700-normal.woff2", dir: "fontsource", format: "woff2" },
];

let fontCss: string | null = null;
/** @font-face rules with base64-embedded woff2 files (built once per process). */
export function embeddedFontCss(): string {
  if (fontCss !== null) return fontCss;
  const dirs = { brand: path.join(process.cwd(), "src", "app", "fonts"), fontsource: path.join(process.cwd(), "node_modules", "@fontsource") };
  const rules: string[] = [];
  for (const f of FONT_FILES) {
    try {
      const b64 = readFileSync(path.join(dirs[f.dir], f.file)).toString("base64");
      const mime = f.format === "woff2" ? "font/woff2" : "font/otf";
      rules.push(`@font-face{font-family:"${f.family}";font-style:normal;font-weight:${f.weight};font-display:block;src:url(data:${mime};base64,${b64}) format("${f.format}");}`);
    } catch {
      // Missing font file: Chromium falls back to a system font; the PDF still renders.
    }
  }
  fontCss = rules.join("\n");
  return fontCss;
}

export const PDF_PALETTE = { ink: "#1f2e4d", seal: "#a8823a", olive: "#5b7746", stone: "#eef0ec", critical: "#b3261e", fine: "#a85d00", ok: "#2e7d32", muted: "#55595f", line: "#dadfd6" };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Print CSS in the brand palette. Classes available to callers are documented inline. */
export const PDF_BASE_CSS = `
:root{--ink:${PDF_PALETTE.ink};--seal:${PDF_PALETTE.seal};--olive:${PDF_PALETTE.olive};--stone:${PDF_PALETTE.stone};--critical:${PDF_PALETTE.critical};--fine:${PDF_PALETTE.fine};--ok:${PDF_PALETTE.ok};--muted:${PDF_PALETTE.muted};--line:${PDF_PALETTE.line}}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:"Thmanyah Sans",Tahoma,sans-serif;color:#1c1d1f;font-size:10.5pt;line-height:1.75;direction:rtl;-webkit-print-color-adjust:exact;print-color-adjust:exact}
h1,h2,h3{color:var(--ink);line-height:1.4;margin:0 0 .5em;break-after:avoid}
h1{font-family:"Thmanyah Sans",sans-serif;font-size:22pt;font-weight:700}
h2{font-family:"Thmanyah Sans",sans-serif;font-size:15pt;font-weight:700;margin-top:1.4em;padding-bottom:.25em;border-bottom:1.5px solid var(--seal)}
h3{font-size:11.5pt;font-weight:600;margin-top:1em}
p{margin:0 0 .6em}
.naskh{font-family:"Noto Naskh Arabic",serif;line-height:1.9}
.muted{color:var(--muted)}
.small{font-size:9pt}
.tabular{font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse;margin:.5em 0 1em;font-size:9.5pt}
th,td{border-bottom:1px solid var(--line);padding:5px 6px;text-align:start;vertical-align:top}
th{background:var(--stone);color:var(--ink);font-weight:600}
tr{break-inside:avoid}
.page-break{break-before:page}
.avoid-break{break-inside:avoid}
.box{border:1px solid var(--line);border-radius:6px;padding:10px 12px;margin:.5em 0;break-inside:avoid}
.box.critical{border-color:var(--critical);border-inline-start:4px solid var(--critical);background:#fbeceb}
.box.seal{border-color:var(--seal);border-inline-start:4px solid var(--seal);background:#f5eedf}
.box.stone{background:var(--stone);border-color:var(--stone)}
.tag{display:inline-block;border-radius:999px;padding:0 8px;font-size:8.5pt;font-weight:600;line-height:1.8}
.tag.critical{background:#fbeceb;color:var(--critical)}
.tag.fine{background:#fdf1e2;color:var(--fine)}
.tag.ok{background:#e8f3e8;color:var(--ok)}
.tag.ink{background:#e7ebf3;color:var(--ink)}
.tag.seal{background:#f5eedf;color:var(--seal)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.kv{display:grid;grid-template-columns:auto 1fr;gap:2px 14px}
.kv dt{color:var(--muted)} .kv dd{margin:0;font-weight:500}
.brandbar{height:6px;background:var(--ink);border-bottom:3px solid var(--seal)}
`;

/** Full HTML document (RTL, Arabic, embedded fonts, brand print CSS). `bodyHtml` is trusted HTML built by the caller (escape user data!). */
export function pdfShell(title: string, bodyHtml: string, extraCss = ""): string {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${embeddedFontCss()}\n${PDF_BASE_CSS}\n${extraCss}</style></head><body>${bodyHtml}</body></html>`;
}

// ───────────── browser lifecycle ─────────────
const g = globalThis as unknown as { __waqfakPdfBrowser?: Promise<Browser> | null };

async function getBrowser(): Promise<Browser> {
  if (g.__waqfakPdfBrowser) {
    try {
      const b = await g.__waqfakPdfBrowser;
      if (b.isConnected()) return b;
    } catch {
      // fall through and relaunch
    }
  }
  g.__waqfakPdfBrowser = chromium
    .launch({ executablePath: env.CHROMIUM_PATH, args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"] })
    .then((b) => {
      b.on("disconnected", () => {
        g.__waqfakPdfBrowser = null;
      });
      return b;
    });
  g.__waqfakPdfBrowser.catch(() => {
    g.__waqfakPdfBrowser = null;
  });
  return g.__waqfakPdfBrowser;
}

const footerTemplate = (headerTitle?: string) => `
<div style="width:100%;font-family:sans-serif;font-size:8px;color:#55595f;padding:0 14mm;display:flex;justify-content:space-between;direction:rtl">
  <span>${headerTitle ? esc(headerTitle) + " — " : ""}وقفك</span>
  <span>صفحة <span class="pageNumber"></span> من <span class="totalPages"></span></span>
</div>`;

/** Renders an HTML document (ideally from pdfShell) to an A4 PDF buffer. */
export async function renderPdf(html: string, opts: { headerTitle?: string; landscape?: boolean } = {}): Promise<Buffer> {
  const browser = await getBrowser();
  const context = await browser.newContext({ locale: "ar-SA", javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    // Block every network request: documents must be self-contained (fonts/images inline).
    await page.route("**/*", (route) => (route.request().url().startsWith("data:") ? route.continue() : route.abort()));
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    await page.evaluate?.(() => (document as Document & { fonts?: FontFaceSet }).fonts?.ready).catch(() => undefined);
    const pdf = await page.pdf({
      format: "A4",
      landscape: !!opts.landscape,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: footerTemplate(opts.headerTitle),
      margin: { top: "16mm", bottom: "18mm", left: "14mm", right: "14mm" },
      preferCSSPageSize: false,
    });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
  }
}
