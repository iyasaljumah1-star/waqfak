"use client";

import { useMemo, useState } from "react";
import { validateStages } from "@/server/modules/admin/editors/pure";
import { cn } from "@/lib/utils";
import { useFieldError } from "./editor-form";

/** Workflow stages as JSON with live validation and a readable preview of the resulting stages. */
export function StagesField({ name = "stages", defaultValue }: { name?: string; defaultValue: unknown }) {
  const [text, setText] = useState(() => JSON.stringify(defaultValue ?? [], null, 2));
  const serverErrRaw = useFieldError(name);
  const [lastErr, setLastErr] = useState(serverErrRaw);
  const [edited, setEdited] = useState(false);
  if (serverErrRaw !== lastErr) {
    setLastErr(serverErrRaw);
    setEdited(false);
  }
  const serverErr = edited ? undefined : serverErrRaw;
  const check = useMemo(() => {
    try {
      return validateStages(JSON.parse(text));
    } catch (e) {
      return { ok: false as const, error: `ليست JSON صالحًا: ${(e as Error).message}` };
    }
  }, [text]);
  const err = serverErr ?? (!check.ok ? check.error : undefined);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-1.5">
        <label htmlFor={name} className="block text-[15px] font-medium">المراحل (JSON)</label>
        <textarea
          id={name}
          name={name}
          dir="ltr"
          spellCheck={false}
          rows={18}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setEdited(true);
          }}
          aria-invalid={!!err}
          className="block w-full rounded-md border border-line-strong bg-surface px-3 py-2 font-mono text-[13px] leading-6 focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/20 aria-[invalid=true]:border-critical"
        />
        <p className={cn("text-[13px]", err ? "font-medium text-critical" : "text-ok")}>{err ?? "المراحل صالحة."}</p>
        <p className="text-[13px] text-muted">لكل مرحلة: key (إنجليزي)، name، slaDays، role، وclientApproval اختياريًا للمراحل التي يعتمدها العميل.</p>
      </div>
      <div>
        <p className="mb-1.5 text-[15px] font-medium">معاينة</p>
        {check.ok ? (
          <ol className="relative space-y-3 border-s border-line ps-5">
            {check.value.map((s) => (
              <li key={s.key} className="relative">
                <span aria-hidden className="absolute -start-[27px] top-1.5 size-3 rounded-full bg-ink ring-4 ring-surface" />
                <p className="font-medium">{s.name}</p>
                <p className="text-[13px] text-muted">
                  <span dir="ltr">{s.key}</span> · {s.slaDays} يوم · {s.role}
                  {s.clientApproval ? " · يعتمدها العميل" : ""}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[14px] text-muted">أصلح الأخطاء لتظهر المعاينة.</p>
        )}
      </div>
    </div>
  );
}
