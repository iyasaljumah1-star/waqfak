"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn, type ActionState } from "@/lib/utils";
import { buttonClass } from "./index";

export function SubmitButton({ children, pendingText = "جارٍ الحفظ…", variant = "primary", size = "md", className, ...p }: ComponentProps<"button"> & { pendingText?: string; variant?: "primary" | "secondary" | "ghost" | "danger" | "seal"; size?: "sm" | "md" | "lg" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || p.disabled} aria-busy={pending} className={buttonClass(variant, size, className)} {...p}>
      {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
      {pending ? pendingText : children}
    </button>
  );
}

const inputBase =
  "block w-full rounded-md border border-line-strong bg-surface px-3 text-[15px] text-text placeholder:text-muted/70 focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/20 aria-[invalid=true]:border-critical disabled:bg-surface-2";

export function Field({ label, name, hint, error, required, children, className }: { label: string; name: string; hint?: ReactNode; error?: string; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={name} className="block text-[15px] font-medium">
        {label}
        {required ? <span aria-hidden className="text-critical"> *</span> : null}
      </label>
      {children}
      {hint && !error ? <p id={`${name}-hint`} className="text-[13px] text-muted">{hint}</p> : null}
      {error ? <p id={`${name}-error`} className="text-[13px] font-medium text-critical">{error}</p> : null}
    </div>
  );
}

export function Input({ name, error, className, ...p }: ComponentProps<"input"> & { name: string; error?: string }) {
  return <input id={name} name={name} aria-invalid={!!error} aria-describedby={error ? `${name}-error` : `${name}-hint`} className={cn(inputBase, "h-11", className)} {...p} />;
}

export function Textarea({ name, error, className, ...p }: ComponentProps<"textarea"> & { name: string; error?: string }) {
  return <textarea id={name} name={name} aria-invalid={!!error} aria-describedby={error ? `${name}-error` : `${name}-hint`} className={cn(inputBase, "min-h-28 py-2 leading-7", className)} {...p} />;
}

export function Select({ name, error, className, options, placeholder, ...p }: ComponentProps<"select"> & { name: string; error?: string; options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <select id={name} name={name} aria-invalid={!!error} className={cn(inputBase, "h-11", className)} {...p}>
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function Checkbox({ name, label, defaultChecked, value = "on", required }: { name: string; label: ReactNode; defaultChecked?: boolean; value?: string; required?: boolean }) {
  return (
    <label className="flex items-start gap-3 text-[15px] leading-7">
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} required={required} className="mt-1.5 size-4 accent-[var(--ink)]" />
      <span>{label}</span>
    </label>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (state.error)
    return (
      <p role="alert" className="rounded-md bg-critical-soft px-3 py-2 text-[15px] text-critical">
        {state.error}
      </p>
    );
  if (state.ok && state.message)
    return (
      <p role="status" className="rounded-md bg-ok-soft px-3 py-2 text-[15px] text-ok">
        {state.message}
      </p>
    );
  return null;
}
