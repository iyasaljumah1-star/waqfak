"use client";

import { useDeferredValue, useState } from "react";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";
import { useFieldError } from "./editor-form";

/** Markdown body editor with a live, safe preview (side by side on wide screens, tabs on phones). */
export function ContentBody({ name = "bodyMd", defaultValue }: { name?: string; defaultValue: string }) {
  const [text, setText] = useState(defaultValue);
  const deferred = useDeferredValue(text);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const err = useFieldError(name);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={name} className="text-[15px] font-medium">النص (Markdown)<span aria-hidden className="text-critical"> *</span></label>
        <div role="tablist" aria-label="التحرير والمعاينة" className="flex gap-1 lg:hidden">
          {(["edit", "preview"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("rounded-md px-3 py-1 text-[14px]", tab === t ? "bg-ink text-white dark:text-[#0f141c]" : "border border-line")}>
              {t === "edit" ? "تحرير" : "معاينة"}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className={cn(tab === "preview" && "hidden lg:block")}>
          <textarea
            id={name}
            name={name}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={22}
            aria-invalid={!!err}
            className="block min-h-[28rem] w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-[15px] leading-8 focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/20 aria-[invalid=true]:border-critical"
          />
          <p className="mt-1 text-[12px] text-muted">
            <span className="tabular">{words}</span> كلمة · العناوين بـ ## · القوائم بـ - أو 1. · الجداول بـ | · الروابط [النص](https://…)
          </p>
          {err ? <p className="text-[13px] font-medium text-critical">{err}</p> : null}
        </div>
        <div className={cn("deed-paper max-h-[40rem] overflow-y-auto rounded-md border border-line p-4", tab === "edit" && "hidden lg:block")} aria-label="معاينة حية" data-testid="md-preview">
          {deferred.trim() ? <Markdown source={deferred} /> : <p className="text-muted">تظهر المعاينة هنا أثناء الكتابة.</p>}
        </div>
      </div>
    </div>
  );
}
