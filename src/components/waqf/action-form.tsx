"use client";

import { useActionState, useId, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { buttonClass } from "@/components/ui";
import { Checkbox, Field, FormMessage, Input, Select, Textarea } from "@/components/ui/form";
import { cn, initialState, type ActionState } from "@/lib/utils";

export type Opt = { value: string; label: string };
export type FieldSpec = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "textarea" | "select" | "checkbox" | "email" | "tel";
  options?: Opt[];
  placeholder?: string;
  required?: boolean;
  hint?: string;
  defaultValue?: string | number | boolean | null;
  /** occupies the full row on wide screens */
  wide?: boolean;
  ltr?: boolean;
  maxLength?: number;
  step?: string;
  min?: string;
  max?: string;
  inputMode?: "decimal" | "numeric" | "text";
  autoComplete?: string;
};

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * Submits without React's automatic form reset, so a failed submit keeps what the user typed.
 * The submitter button's name/value (e.g. intent) is included.
 */
function useNoResetSubmit(action: Action) {
  const [state, dispatch, pending] = useActionState(action, initialState);
  const [, start] = useTransition();
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const fd = new FormData(e.currentTarget, submitter && submitter.getAttribute("name") ? submitter : undefined);
    start(() => dispatch(fd));
  };
  return { state, pending, onSubmit };
}

export function Submit({ pending, children, variant = "primary", size = "md", name, value, className }: { pending: boolean; children: ReactNode; variant?: "primary" | "secondary" | "ghost" | "danger" | "seal"; size?: "sm" | "md"; name?: string; value?: string; className?: string }) {
  return (
    <button type="submit" name={name} value={value} disabled={pending} aria-busy={pending} className={buttonClass(variant, size, className)}>
      {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

export function FieldInput({ f, error, idPrefix }: { f: FieldSpec; error?: string; idPrefix: string }) {
  const id = `${idPrefix}-${f.name}`;
  const dv = f.defaultValue === null || f.defaultValue === undefined ? "" : String(f.defaultValue);
  if (f.type === "checkbox")
    return (
      <div className={cn(f.wide && "sm:col-span-2")}>
        <Checkbox name={f.name} label={f.label} defaultChecked={f.defaultValue === true || f.defaultValue === "on"} />
        {f.hint ? <p className="ms-7 text-[13px] text-muted">{f.hint}</p> : null}
        {error ? <p className="ms-7 text-[13px] font-medium text-critical">{error}</p> : null}
      </div>
    );
  const common = { id, name: f.name, error, required: f.required, placeholder: f.placeholder, defaultValue: dv };
  return (
    <Field label={f.label} name={id} hint={f.hint} error={error} required={f.required} className={cn(f.wide && "sm:col-span-2")}>
      {f.type === "textarea" ? (
        <Textarea {...common} maxLength={f.maxLength ?? 4000} className="min-h-24" />
      ) : f.type === "select" ? (
        <Select {...common} options={f.options ?? []} placeholder={f.required ? "اختر" : "—"} />
      ) : (
        <Input
          {...common}
          type={f.type === "number" ? "text" : (f.type ?? "text")}
          inputMode={f.type === "number" ? (f.inputMode ?? "decimal") : f.inputMode}
          maxLength={f.maxLength ?? 300}
          dir={f.ltr || f.type === "date" || f.type === "number" ? "ltr" : undefined}
          className={f.ltr || f.type === "date" || f.type === "number" ? "text-start tabular" : undefined}
          autoComplete={f.autoComplete ?? "off"}
          min={f.min}
          max={f.max}
          step={f.step}
        />
      )}
    </Field>
  );
}

/** Declarative form bound to a server action. Fields are serializable specs; hidden values go in `hidden`. */
export function ActionForm({
  action, fields, hidden, submitLabel, children, cols = 2, secondary, footnote, testId,
}: {
  action: Action;
  fields: FieldSpec[];
  hidden?: Record<string, string | null | undefined>;
  submitLabel: string;
  children?: ReactNode;
  cols?: 1 | 2;
  secondary?: ReactNode;
  footnote?: ReactNode;
  testId?: string;
}) {
  const { state, pending, onSubmit } = useNoResetSubmit(action);
  const uid = useId().replace(/:/g, "");
  const fe = state.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate data-testid={testId}>
      {Object.entries(hidden ?? {}).map(([k, v]) => (v === null || v === undefined ? null : <input key={k} type="hidden" name={k} value={v} />))}
      <div className={cn("grid gap-4", cols === 2 && "sm:grid-cols-2")}>
        {fields.map((f) => (
          <FieldInput key={f.name} f={f} error={fe[f.name]} idPrefix={uid} />
        ))}
      </div>
      {children}
      <FormMessage state={state} />
      {footnote ? <p className="text-[13px] text-muted">{footnote}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Submit pending={pending}>{submitLabel}</Submit>
        {secondary}
      </div>
    </form>
  );
}

/** A single-button form (approve, end, delete…). Shows the error/success inline next to the button. */
export function ActionButton({
  action, hidden, label, variant = "secondary", confirm, size = "sm", children,
}: {
  action: Action;
  hidden: Record<string, string | null | undefined>;
  label: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "seal";
  confirm?: string;
  size?: "sm" | "md";
  children?: ReactNode;
}) {
  const { state, pending, onSubmit } = useNoResetSubmit(action);
  return (
    <form
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) {
          e.preventDefault();
          return;
        }
        onSubmit(e);
      }}
      className="inline-flex flex-col items-start gap-1"
    >
      {Object.entries(hidden).map(([k, v]) => (v === null || v === undefined ? null : <input key={k} type="hidden" name={k} value={v} />))}
      {children}
      <Submit pending={pending} variant={variant} size={size}>{label}</Submit>
      {state.error ? <span role="alert" className="text-[13px] font-medium text-critical">{state.error}</span> : null}
      {state.ok && state.message ? <span role="status" className="text-[13px] text-ok">{state.message}</span> : null}
    </form>
  );
}

/** Wraps arbitrary children (e.g. RowsEditor) in a no-reset action form with a submit button. */
export function RawActionForm({ action, hidden, children, submitLabel, extraButtons, className, testId }: {
  action: Action;
  hidden?: Record<string, string | null | undefined>;
  children: ReactNode;
  submitLabel?: string;
  extraButtons?: (pending: boolean) => ReactNode;
  className?: string;
  testId?: string;
}) {
  const { state, pending, onSubmit } = useNoResetSubmit(action);
  return (
    <form onSubmit={onSubmit} className={cn("space-y-4", className)} noValidate data-testid={testId}>
      {Object.entries(hidden ?? {}).map(([k, v]) => (v === null || v === undefined ? null : <input key={k} type="hidden" name={k} value={v} />))}
      {children}
      {state.fieldErrors && Object.keys(state.fieldErrors).length ? (
        <ul className="list-disc space-y-0.5 ps-5 text-[13px] font-medium text-critical">
          {Object.entries(state.fieldErrors).filter(([k]) => k !== "_").map(([k, v]) => <li key={k}>{v}</li>)}
        </ul>
      ) : null}
      <FormMessage state={state} />
      <div className="flex flex-wrap items-center gap-2">
        {submitLabel ? <Submit pending={pending}>{submitLabel}</Submit> : null}
        {extraButtons?.(pending)}
      </div>
    </form>
  );
}

export type RowField = { key: string; label: string; type?: "text" | "number" | "select" | "checkbox" | "date"; options?: Opt[]; width?: string; placeholder?: string };

/**
 * Repeating rows inside a form. Each cell is submitted as `${prefix}.${key}` (read on the server with readRows).
 * Checkboxes are submitted as hidden "on"/"off" values so row alignment is preserved.
 */
export function RowsEditor({ prefix, fields, initial, addLabel, min = 1, max = 50, onChange }: {
  prefix: string;
  fields: RowField[];
  initial: Record<string, string>[];
  addLabel: string;
  min?: number;
  max?: number;
  onChange?: (rows: Record<string, string>[]) => void;
}) {
  const blank = () => Object.fromEntries(fields.map((f) => [f.key, f.type === "checkbox" ? "off" : ""]));
  const [rows, setRows] = useState<{ k: number; v: Record<string, string> }[]>(() => {
    const init = initial.length ? initial : Array.from({ length: min }, blank);
    return init.map((v, i) => ({ k: i, v: { ...blank(), ...v } }));
  });
  const [seq, setSeq] = useState(rows.length);
  const update = (next: { k: number; v: Record<string, string> }[]) => {
    setRows(next);
    onChange?.(next.map((r) => r.v));
  };
  const set = (k: number, key: string, val: string) => update(rows.map((r) => (r.k === k ? { ...r, v: { ...r.v, [key]: val } } : r)));
  return (
    <div className="space-y-3">
      <ol className="space-y-3">
        {rows.map((r, idx) => (
          <li key={r.k} className="rounded-md border border-line bg-surface-2/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[13px] font-medium text-muted">#{idx + 1}</span>
              {rows.length > min ? (
                <button type="button" onClick={() => update(rows.filter((x) => x.k !== r.k))} className="inline-flex items-center gap-1 text-[13px] text-critical hover:underline">
                  <Trash2 aria-hidden className="size-3.5" /> احذف
                </button>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {fields.map((f) => {
                const id = `${prefix}-${r.k}-${f.key}`;
                if (f.type === "checkbox")
                  return (
                    <label key={f.key} className="flex items-center gap-2 self-end pb-2 text-[14px]">
                      <input type="hidden" name={`${prefix}.${f.key}`} value={r.v[f.key] === "on" ? "on" : "off"} />
                      <input type="checkbox" checked={r.v[f.key] === "on"} onChange={(e) => set(r.k, f.key, e.target.checked ? "on" : "off")} className="size-4 accent-[var(--ink)]" />
                      {f.label}
                    </label>
                  );
                return (
                  <div key={f.key} className={cn("space-y-1", f.width)}>
                    <label htmlFor={id} className="block text-[13px] font-medium">{f.label}</label>
                    {f.type === "select" ? (
                      <select id={id} name={`${prefix}.${f.key}`} value={r.v[f.key]} onChange={(e) => set(r.k, f.key, e.target.value)} className="block h-10 w-full rounded-md border border-line-strong bg-surface px-2 text-[14px]">
                        <option value="">—</option>
                        {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      <input
                        id={id}
                        name={`${prefix}.${f.key}`}
                        value={r.v[f.key]}
                        onChange={(e) => set(r.k, f.key, e.target.value)}
                        placeholder={f.placeholder}
                        type={f.type === "date" ? "date" : "text"}
                        inputMode={f.type === "number" ? "decimal" : undefined}
                        dir={f.type === "number" || f.type === "date" ? "ltr" : undefined}
                        className={cn("block h-10 w-full rounded-md border border-line-strong bg-surface px-2 text-[14px]", (f.type === "number" || f.type === "date") && "text-start tabular")}
                        autoComplete="off"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ol>
      {rows.length < max ? (
        <button
          type="button"
          onClick={() => {
            update([...rows, { k: seq, v: blank() }]);
            setSeq(seq + 1);
          }}
          className={buttonClass("secondary", "sm")}
        >
          <Plus aria-hidden className="size-4" /> {addLabel}
        </button>
      ) : null}
    </div>
  );
}

/** Collapsible area for secondary forms (keeps pages calm). */
export function Disclosure({ summary, children, defaultOpen, testId }: { summary: string; children: ReactNode; defaultOpen?: boolean; testId?: string }) {
  return (
    <details className="group rounded-md border border-line bg-surface" open={defaultOpen} data-testid={testId}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[15px] font-medium text-ink hover:bg-surface-2">
        <Plus aria-hidden className="size-4 transition-transform group-open:rotate-45" />
        {summary}
      </summary>
      <div className="border-t border-line p-4">{children}</div>
    </details>
  );
}
