"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, Wand2 } from "lucide-react";
import { parseLogic, unknownVars } from "@/server/modules/admin/editors/pure";
import { cn } from "@/lib/utils";
import { useFieldError } from "./editor-form";

const pretty = (v: unknown) => (v === null || v === undefined ? "" : JSON.stringify(v, null, 2));

/**
 * JSON-logic editor with live validation (same validator the server uses on save) and a warning
 * for `var` names that are not known facts. The server re-validates; this only speeds up feedback.
 */
export function LogicField({
  name, label, defaultValue, optional = true, knownVars, hint, examples, rows = 5, readOnly,
}: {
  name: string;
  label: string;
  defaultValue?: unknown;
  optional?: boolean;
  knownVars?: readonly string[];
  hint?: string;
  examples?: { label: string; value: unknown }[];
  rows?: number;
  readOnly?: boolean;
}) {
  const [text, setText] = useState(() => pretty(defaultValue));
  const serverErrorRaw = useFieldError(name);
  // A server error describes the text that was submitted; once the user edits the field, show the live check instead.
  const [lastErr, setLastErr] = useState(serverErrorRaw);
  const [edited, setEdited] = useState(false);
  if (serverErrorRaw !== lastErr) {
    setLastErr(serverErrorRaw);
    setEdited(false);
  }
  const serverError = edited ? undefined : serverErrorRaw;
  const check = useMemo(() => {
    const p = parseLogic(text, { optional, label });
    if (!p.ok) return { tone: "error" as const, msg: p.error };
    if (p.value === null) return { tone: "empty" as const, msg: optional ? "بلا شرط: ينطبق دائمًا." : "" };
    const unk = knownVars ? unknownVars(p.value, knownVars) : [];
    if (unk.length) return { tone: "warn" as const, msg: `صالح، لكن هذه الحقائق غير معروفة: ${unk.join("، ")}.` };
    return { tone: "ok" as const, msg: "قاعدة صالحة." };
  }, [text, optional, label, knownVars]);

  function format() {
    try {
      setText(pretty(JSON.parse(text)));
      setEdited(true);
    } catch {
      /* leave as typed; the status line explains the error */
    }
  }

  const err = serverError ?? (check.tone === "error" && text.trim() ? check.msg : undefined);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={name} className="block text-[15px] font-medium">
          {label}
          {!optional ? <span aria-hidden className="text-critical"> *</span> : null}
        </label>
        {!readOnly ? (
          <div className="flex flex-wrap gap-1">
            {examples?.map((ex) => (
              <button key={ex.label} type="button" onClick={() => {
                setText(pretty(ex.value));
                setEdited(true);
              }} className="rounded border border-line px-2 py-0.5 text-[12px] text-muted hover:bg-surface-2 hover:text-text">
                {ex.label}
              </button>
            ))}
            <button type="button" onClick={format} className="inline-flex items-center gap-1 rounded border border-line px-2 py-0.5 text-[12px] text-muted hover:bg-surface-2 hover:text-text">
              <Wand2 aria-hidden className="size-3" /> تنسيق
            </button>
          </div>
        ) : null}
      </div>
      <textarea
        id={name}
        name={name}
        dir="ltr"
        spellCheck={false}
        rows={rows}
        readOnly={readOnly}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setEdited(true);
        }}
        aria-invalid={!!err}
        aria-describedby={`${name}-status`}
        placeholder='{"==": [{"var": "sizeClass"}, "large"]}'
        className="block w-full rounded-md border border-line-strong bg-surface px-3 py-2 font-mono text-[13px] leading-6 text-text focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/20 aria-[invalid=true]:border-critical read-only:bg-surface-2"
      />
      <p id={`${name}-status`} className={cn("flex items-start gap-1.5 text-[13px]", err ? "font-medium text-critical" : check.tone === "warn" ? "text-fine" : check.tone === "ok" ? "text-ok" : "text-muted")}>
        {err ? <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" /> : check.tone === "ok" ? <CheckCircle2 aria-hidden className="mt-0.5 size-3.5 shrink-0" /> : null}
        <span>{err ?? check.msg}</span>
      </p>
      {hint ? <p className="text-[13px] text-muted">{hint}</p> : null}
    </div>
  );
}
