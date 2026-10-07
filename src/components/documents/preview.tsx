"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * Inline preview for PDF / image / text. The global security headers forbid framing any app URL
 * (X-Frame-Options: DENY, frame-ancestors 'none'), so the file is fetched and shown from a blob: URL
 * (allowed by frame-src 'self' blob:). The fetch is a normal authorised GET, logged as a "view".
 */
export function DocumentPreview({ src, kind, title }: { src: string; kind: "pdf" | "image" | "text"; title: string }) {
  const [state, setState] = useState<{ url?: string; text?: string; error?: string }>({});

  useEffect(() => {
    let url: string | undefined;
    let cancelled = false;
    setState({});
    fetch(src, { credentials: "same-origin", cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? "تعذر تحميل المعاينة.");
        }
        if (kind === "text") return { text: await r.text() };
        url = URL.createObjectURL(await r.blob());
        return { url };
      })
      .then((s) => !cancelled && setState(s))
      .catch((e: Error) => !cancelled && setState({ error: e.message }));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src, kind]);

  if (state.error) return <p role="alert" className="px-4 py-10 text-center text-critical">{state.error}</p>;
  if (!state.url && state.text === undefined)
    return (
      <div role="status" className="flex h-64 items-center justify-center gap-2 text-muted">
        <Loader2 aria-hidden className="size-5 animate-spin" /> جارٍ تحميل المعاينة…
      </div>
    );
  if (kind === "text") return <pre dir="auto" className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words bg-surface-2 p-4 text-[14px] leading-7">{state.text}</pre>;
  if (kind === "image")
    return (
      <div className="flex justify-center bg-surface-2 p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={state.url} alt={`معاينة ${title}`} className="max-h-[70vh] max-w-full rounded border border-line object-contain" />
      </div>
    );
  return <iframe src={state.url} data-src={src} title={`معاينة ${title}`} className="block h-[60vh] w-full border-0 bg-surface-2 lg:h-[72vh]" />;
}
