/**
 * Retrieval of official texts. Only hosts in OFFICIAL_HOSTS are fetched as official; anything else is refused, so a
 * secondary copy can never be stored as «official». Every attempt, successful or not, is returned as a FetchAttempt
 * with the failure kind, so the registry records why a text is missing instead of silently substituting another.
 */
import { sha256 } from "./versions";
import { OFFICIAL_HOSTS, type FetchAttempt, type FetchFailureKind } from "./types";

export type FetchedText = { url: string; finalUrl: string; retrievedAt: string; sha256: string; contentType: string; text: string; title: string | null; dateLine: string | null };
export type FetchOutcome = { ok: true; doc: FetchedText; attempt: FetchAttempt } | { ok: false; attempt: FetchAttempt };

export type FetchOptions = {
  refId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  now?: () => Date;
  /** Extra hosts accepted as official (tests use a local server). Never set in production code. */
  allowHostsForTest?: string[];
};

export function isOfficialUrl(url: string, extra: string[] = []): boolean {
  try {
    const u = new URL(url);
    const host = u.host;
    if (extra.includes(host)) return true;
    return u.protocol === "https:" && (OFFICIAL_HOSTS as readonly string[]).includes(host);
  } catch {
    return false;
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

/** HTML → text with block structure kept as line breaks. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|tr|table|section|article|blockquote)>/gi, "\n")
      .replace(/<(td|th)[^>]*>/gi, " | ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t ]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Isolates the legal text on a gazette page: from the title (h1) to the copyright footer. Returns null when the page
 * does not have that structure, which is reported as an extraction failure rather than guessed.
 */
export function extractGazetteBody(html: string): { title: string; dateLine: string | null; body: string } | null {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!h1) return null;
  const title = htmlToText(h1[1]!).trim();
  const after = html.slice(h1.index! + h1[0].length);
  const footer = after.search(/جميع الحقوق محفوظة/);
  const region = footer >= 0 ? after.slice(0, footer) : null;
  if (!region) return null;
  const text = htmlToText(region);
  const lines = text.split("\n");
  const dateIdx = lines.findIndex((l) => /^\d{4}-\d{1,2}-\d{1,2}\s+الموافق\s+\d{1,2}-\d{1,2}-\d{4}$/.test(l));
  const dateLine = dateIdx >= 0 ? lines[dateIdx]! : null;
  const body = lines.filter((_, i) => i !== dateIdx).join("\n").trim();
  if (body.length < 200) return null;
  return { title, dateLine, body };
}

export async function fetchOfficial(url: string, opts: FetchOptions): Promise<FetchOutcome> {
  const now = opts.now ?? (() => new Date());
  const at = now().toISOString();
  const fail = (kind: FetchFailureKind, detail: string): FetchOutcome => ({ ok: false, attempt: { refId: opts.refId, url, at, ok: false, via: "direct_http", failure: { kind, detail } } });
  if (!isOfficialUrl(url, opts.allowHostsForTest)) return fail("link", "العنوان ليس على نطاق رسمي معتمد أو ليس https؛ لا يُسترجع بوصفه مصدرًا رسميًا");

  const f = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await f(url, { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": "waqfak-reference-verifier/1.0", accept: "text/html,application/pdf;q=0.5" } });
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    return fail("link", ctrl.signal.aborted ? "انتهت مهلة الاتصال" : `تعذر الاتصال: ${msg}`);
  }
  clearTimeout(timer);
  if (res.status === 403 || res.status === 451 || res.status === 429) return fail("access_blocked", `HTTP ${res.status}`);
  if (!res.ok) return fail("link", `HTTP ${res.status}`);
  if (res.url && !isOfficialUrl(res.url, opts.allowHostsForTest)) return fail("link", `أُعيد التوجيه إلى نطاق غير رسمي: ${res.url}`);
  const contentType = res.headers.get("content-type") ?? "";
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > (opts.maxBytes ?? 8 * 1024 * 1024)) return fail("file", `الملف أكبر من الحد (${buf.byteLength} بايت)`);
  if (/application\/pdf/i.test(contentType)) return fail("file", "ملف PDF: استخراج نصه غير مبني في هذه المرحلة، ولا يُعتمد نص مستخرج آليًا دون مطابقة");
  if (!/text\/html|application\/xhtml/i.test(contentType)) return fail("file", `نوع محتوى غير مدعوم: ${contentType || "غير محدد"}`);
  const html = new TextDecoder("utf-8").decode(buf);
  const body = extractGazetteBody(html);
  if (!body) return fail("extraction", "لم يُعثر على بنية النص النظامي في الصفحة (العنوان ثم النص ثم تذييل الحقوق)");
  const text = `# ${body.title}\n\n${body.dateLine ?? ""}\n\n${body.body}\n`;
  return {
    ok: true,
    doc: { url, finalUrl: res.url || url, retrievedAt: at, sha256: sha256(text), contentType, text, title: body.title, dateLine: body.dateLine },
    attempt: { refId: opts.refId, url, at, ok: true, via: "direct_http" },
  };
}
