import "server-only";
import { kindFromMime } from "../../adapters/scan";

export const jsonError = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  Response.json({ error, ...extra }, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "X-Frame-Options": "DENY" } });

/** RFC 6266 / 5987: ASCII fallback plus UTF-8 filename*. */
export function contentDisposition(type: "inline" | "attachment", name: string) {
  const clean = name.replace(/[\r\n"\\]/g, "_").slice(0, 180) || "document";
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

const INLINE_KINDS = new Set(["pdf", "png", "jpg", "webp", "txt"]);

/** Hardened response for decrypted file bytes. */
export function fileResponse(data: Buffer, mime: string, name: string, wantInline: boolean) {
  const kind = kindFromMime(mime);
  const inline = wantInline && !!kind && INLINE_KINDS.has(kind);
  const csp = ["default-src 'none'", "img-src 'self' data:", "style-src 'unsafe-inline'", "frame-ancestors 'self'"];
  // Chrome's PDF viewer does not run in a sandboxed document; everything else is sandboxed.
  if (kind !== "pdf") csp.push("sandbox");
  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": kind === "txt" ? "text/plain; charset=utf-8" : mime,
      "Content-Length": String(data.length),
      "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", name),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": csp.join("; "),
      "X-Frame-Options": "SAMEORIGIN",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
    },
  });
}

/** A generated, escaped HTML preview (Office files): sandboxed, no script, no remote resource. */
export function htmlPreviewResponse(html: string) {
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'; sandbox",
      "X-Frame-Options": "SAMEORIGIN",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
    },
  });
}

/** Rejects cross-site form posts (defence in depth on top of SameSite=Lax cookies). */
export function sameOrigin(req: Request, appUrl: string) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const o = new URL(origin).origin;
    return o === new URL(appUrl).origin || o === new URL(req.url).origin;
  } catch {
    return false;
  }
}
