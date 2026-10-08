"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFieldError } from "./editor-form";

export type RowCol = {
  key: string;
  label: string;
  type?: "text" | "number" | "select" | "checkbox";
  options?: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
  dir?: "ltr" | "rtl";
};
type Row = Record<string, string | number | boolean | null | undefined>;

/**
 * Small repeating-rows editor (question options, implementation links, closing events, sources).
 * Serialises the rows as JSON into one hidden input named `name`; the server validates it.
 */
export function RowsEditor({ name, label, columns, initial, addLabel = "أضف صفًا", hint, readOnly }: {
  name: string;
  label: string;
  columns: RowCol[];
  initial?: Row[] | null;
  addLabel?: string;
  hint?: string;
  readOnly?: boolean;
}) {
  const empty = () => Object.fromEntries(columns.map((c) => [c.key, c.type === "checkbox" ? false : ""])) as Row;
  const [rows, setRows] = useState<Row[]>(() => (initial?.length ? initial.map((r) => ({ ...empty(), ...r })) : []));
  const err = useFieldError(name);
  const set = (i: number, k: string, v: Row[string]) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const serial = rows.map((r) => Object.fromEntries(columns.map((c) => [c.key, c.type === "number" ? (r[c.key] === "" || r[c.key] == null ? null : Number(r[c.key])) : r[c.key]])));

  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-[15px] font-medium">{label}</legend>
      <input type="hidden" name={name} value={JSON.stringify(serial)} />
      {rows.length ? (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border border-line bg-surface-2/40 p-2 md:flex-nowrap">
              {columns.map((c) => {
                const id = `${name}-${i}-${c.key}`;
                return (
                  <div key={c.key} className={cn("min-w-0", c.type === "checkbox" ? "shrink-0" : "flex-1 basis-32", c.className)}>
                    {c.type === "checkbox" ? (
                      <label htmlFor={id} className="flex h-9 items-center gap-1.5 text-[13px]">
                        <input id={id} type="checkbox" disabled={readOnly} checked={!!r[c.key]} onChange={(e) => set(i, c.key, e.target.checked)} className="size-4 accent-[var(--ink)]" />
                        {c.label}
                      </label>
                    ) : (
                      <>
                        <label htmlFor={id} className="mb-0.5 block text-[12px] text-muted">{c.label}</label>
                        {c.type === "select" ? (
                          <select id={id} disabled={readOnly} value={String(r[c.key] ?? "")} onChange={(e) => set(i, c.key, e.target.value)} className="block h-9 w-full rounded-md border border-line-strong bg-surface px-2 text-[14px]">
                            <option value="">—</option>
                            {c.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        ) : (
                          <input
                            id={id}
                            type={c.type === "number" ? "number" : "text"}
                            inputMode={c.type === "number" ? "decimal" : undefined}
                            step="any"
                            dir={c.dir}
                            readOnly={readOnly}
                            value={r[c.key] === null || r[c.key] === undefined ? "" : String(r[c.key])}
                            placeholder={c.placeholder}
                            onChange={(e) => set(i, c.key, e.target.value)}
                            className="block h-9 w-full rounded-md border border-line-strong bg-surface px-2 text-[14px] read-only:bg-surface-2"
                          />
                        )}
                      </>
                    )}
                  </div>
                );
              })}
              {!readOnly ? (
                <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={`احذف الصف ${i + 1}`} className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-critical hover:bg-critical-soft">
                  <Trash2 aria-hidden className="size-4" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-muted">لا توجد صفوف.</p>
      )}
      {!readOnly ? (
        <button type="button" onClick={() => setRows((rs) => [...rs, empty()])} className="inline-flex items-center gap-1 rounded-md border border-dashed border-line-strong px-3 py-1.5 text-[14px] text-ink hover:bg-ink-soft">
          <Plus aria-hidden className="size-4" /> {addLabel}
        </button>
      ) : null}
      {hint && !err ? <p className="text-[13px] text-muted">{hint}</p> : null}
      {err ? <p className="text-[13px] font-medium text-critical">{err}</p> : null}
    </fieldset>
  );
}
