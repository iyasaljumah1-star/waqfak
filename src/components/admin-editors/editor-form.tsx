"use client";

import { cloneElement, createContext, isValidElement, startTransition, useActionState, useContext, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Field, FormMessage } from "@/components/ui/form";
import { buttonClass } from "@/components/ui";
import { cn, initialState, type ActionState } from "@/lib/utils";

export type Act = (prev: ActionState, fd: FormData) => Promise<ActionState>;

const ErrorsCtx = createContext<Record<string, string | undefined>>({});
const PendingCtx = createContext(false);
const PrefixCtx = createContext("");

/** Field wrapper that shows the server-side error for `name` from the surrounding EditorForm. */
export function EField({ label, name, hint, required, children, className }: { label: string; name: string; hint?: ReactNode; required?: boolean; children: ReactNode; className?: string }) {
  const errors = useContext(ErrorsCtx);
  const prefix = useContext(PrefixCtx);
  if (prefix && isValidElement(children)) {
    // Several forms on one page: keep label ↔ input ids unique.
    const id = `${prefix}-${name}`;
    const err = errors[name];
    return (
      <div className={cn("space-y-1.5", className)}>
        <label htmlFor={id} className="block text-[15px] font-medium">
          {label}
          {required ? <span aria-hidden className="text-critical"> *</span> : null}
        </label>
        {cloneElement(children as ReactElement<{ id?: string; "aria-describedby"?: string }>, { id, "aria-describedby": `${id}-msg` })}
        {hint && !err ? <p id={`${id}-msg`} className="text-[13px] text-muted">{hint}</p> : null}
        {err ? <p id={`${id}-msg`} className="text-[13px] font-medium text-critical">{err}</p> : null}
      </div>
    );
  }
  return (
    <Field label={label} name={name} hint={hint} required={required} error={errors[name]} className={className}>
      {children}
    </Field>
  );
}

/** Group label for checkbox sets (fieldset/legend) with its server error. */
export function EFieldset({ legend, name, hint, children, className }: { legend: string; name: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  const errors = useContext(ErrorsCtx);
  const err = errors[name];
  return (
    <fieldset className={cn("space-y-1.5", className)}>
      <legend className="mb-1.5 text-[15px] font-medium">{legend}</legend>
      {children}
      {hint && !err ? <p className="text-[13px] text-muted">{hint}</p> : null}
      {err ? <p className="text-[13px] font-medium text-critical">{err}</p> : null}
    </fieldset>
  );
}

export function useFieldError(name: string) {
  return useContext(ErrorsCtx)[name];
}
export function useEditorPending() {
  return useContext(PendingCtx);
}

/**
 * Form for admin editors. Submits through React transitions (no automatic form reset, so typed values survive
 * a validation error or a preview), shows the action result, and feeds field errors to EField.
 * An optional `alt` action (preview / test) runs with the same fields from a second button.
 */
export function EditorForm({
  action, alt, children, submitLabel = "احفظ", pendingText = "جارٍ الحفظ…", altLabel, altVariant = "secondary", confirmText, className, renderAlt, renderMain, id, hideMain, idPrefix = "",
}: {
  idPrefix?: string;
  hideMain?: boolean;
  action: Act;
  alt?: Act;
  children: ReactNode;
  submitLabel?: string;
  pendingText?: string;
  altLabel?: string;
  altVariant?: "secondary" | "ghost" | "seal";
  confirmText?: string;
  className?: string;
  renderAlt?: (s: ActionState) => ReactNode;
  renderMain?: (s: ActionState) => ReactNode;
  id?: string;
}) {
  const [main, runMain, mainPending] = useActionState(action, initialState);
  const [altState, runAlt, altPending] = useActionState(alt ?? action, initialState);
  const [last, setLast] = useState<"main" | "alt">("main");
  const state = last === "alt" ? altState : main;
  const pending = mainPending || altPending;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const intent = submitter?.dataset.intent === "alt" ? "alt" : "main";
    if (intent === "main" && confirmText && !window.confirm(confirmText)) return;
    const fd = new FormData(e.currentTarget, submitter ?? undefined);
    setLast(intent);
    startTransition(() => (intent === "alt" ? runAlt(fd) : runMain(fd)));
  }

  return (
    <ErrorsCtx.Provider value={state.fieldErrors ?? {}}>
      <PendingCtx.Provider value={pending}>
        <PrefixCtx.Provider value={idPrefix}>
        <form id={id} onSubmit={onSubmit} noValidate className={cn("space-y-5", className)}>
          {children}
          <div className="space-y-3 border-t border-line pt-4">
            <div aria-live="polite">
              <FormMessage state={state} />
              {state.error && state.fieldErrors && Object.keys(state.fieldErrors).length ? (
                <ul className="mt-1 list-disc ps-6 text-[13px] text-critical">
                  {[...new Set(Object.values(state.fieldErrors).filter(Boolean))].map((m) => <li key={m}>{m}</li>)}
                </ul>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {!hideMain ? (
                <button type="submit" data-intent="main" disabled={pending} aria-busy={mainPending} className={buttonClass("primary", "md")}>
                  {mainPending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
                  {mainPending ? pendingText : submitLabel}
                </button>
              ) : null}
              {alt && altLabel ? (
                <button type="submit" data-intent="alt" disabled={pending} aria-busy={altPending} className={buttonClass(altVariant, "md")}>
                  {altPending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
                  {altLabel}
                </button>
              ) : null}
            </div>
          </div>
          {renderMain && last === "main" && main.ok ? renderMain(main) : null}
          {renderAlt && last === "alt" && altState.ok ? renderAlt(altState) : null}
        </form>
        </PrefixCtx.Provider>
      </PendingCtx.Provider>
    </ErrorsCtx.Provider>
  );
}

/** One-button form (publish, clone, delete…) with optional confirmation and inline result. */
export function ActionButton({
  action, fields, label, pendingText = "جارٍ التنفيذ…", variant = "secondary", size = "sm", confirmText, className,
}: {
  action: Act;
  fields: Record<string, string>;
  label: ReactNode;
  pendingText?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "seal";
  size?: "sm" | "md";
  confirmText?: string;
  className?: string;
}) {
  const [state, run, pending] = useActionState(action, initialState);
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (confirmText && !window.confirm(confirmText)) return;
    const fd = new FormData(e.currentTarget);
    startTransition(() => run(fd));
  }
  return (
    <form onSubmit={onSubmit} className={cn("inline-flex flex-col items-start gap-2", className)}>
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass(variant, size)}>
        {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
        {pending ? pendingText : label}
      </button>
      {state.error || (state.ok && state.message) ? <div aria-live="polite" className="max-w-xl"><FormMessage state={state} /></div> : null}
    </form>
  );
}
