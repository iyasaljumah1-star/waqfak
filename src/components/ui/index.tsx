import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleAlert, Info, OctagonAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ───────────── Buttons ─────────────
type Variant = "primary" | "secondary" | "ghost" | "danger" | "seal";
type Size = "sm" | "md" | "lg";
const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none select-none whitespace-nowrap";
const variants: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-ink-hover dark:text-[#0f141c]",
  secondary: "border border-line-strong bg-surface text-text hover:bg-surface-2",
  ghost: "text-ink hover:bg-ink-soft",
  danger: "bg-critical text-white hover:opacity-90 dark:text-[#1a0b0a]",
  seal: "bg-seal text-[#0b1f1a] hover:opacity-90",
};
const sizes: Record<Size, string> = { sm: "h-8 px-3.5 text-sm", md: "h-11 px-5 text-[15px]", lg: "h-12 px-7 text-base" };

export const buttonClass = (variant: Variant = "primary", size: Size = "md", className?: string) => cn(base, variants[variant], sizes[size], className);

export function Button({ variant = "primary", size = "md", className, ...p }: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...p} />;
}

export function ButtonLink({ variant = "primary", size = "md", className, ...p }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...p} />;
}

// ───────────── Status & tones ─────────────
export type Tone = "critical" | "fine" | "warn" | "ok" | "info" | "neutral" | "ink" | "seal";
const toneClass: Record<Tone, string> = {
  critical: "bg-critical-soft text-critical",
  fine: "bg-fine-soft text-fine",
  warn: "bg-warn-soft text-warn",
  ok: "bg-ok-soft text-ok",
  info: "bg-info-soft text-info",
  neutral: "bg-surface-2 text-muted border border-line",
  ink: "bg-ink-soft text-ink",
  seal: "bg-seal-soft text-seal",
};
const toneIcon: Partial<Record<Tone, LucideIcon>> = { critical: OctagonAlert, fine: AlertTriangle, warn: CircleAlert, ok: CheckCircle2, info: Info };

export function Badge({ tone = "neutral", children, icon = true, className }: { tone?: Tone; children: ReactNode; icon?: boolean; className?: string }) {
  const Icon = icon ? toneIcon[tone] : undefined;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[13px] font-medium leading-6", toneClass[tone], className)}>
      {Icon ? <Icon aria-hidden className="size-3.5 shrink-0" /> : null}
      {children}
    </span>
  );
}

export function Alert({ tone = "info", title, children, action, className }: { tone?: Tone; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const Icon = toneIcon[tone] ?? Info;
  return (
    <div role={tone === "critical" ? "alert" : "status"} className={cn("flex gap-3 rounded-lg p-4", toneClass[tone], className)}>
      <Icon aria-hidden className="mt-1 size-5 shrink-0" />
      <div className="min-w-0 flex-1 text-[15px] leading-7">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-text/90">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}

// ───────────── Layout primitives ─────────────
export function PageHeader({ title, description, actions, crumbs }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; crumbs?: { href?: string; label: string }[] }) {
  return (
    <header className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {crumbs?.length ? (
          <nav aria-label="مسار التنقل" className="mb-1 text-sm text-muted">
            <ol className="flex flex-wrap items-center gap-1">
              {crumbs.map((c, i) => (
                <li key={i} className="flex items-center gap-1">
                  {c.href ? <Link className="hover:text-ink hover:underline" href={c.href}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
                  {i < crumbs.length - 1 ? <span aria-hidden className="text-line-strong">/</span> : null}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <h1 className="font-naskh text-[1.75rem] font-bold leading-tight text-ink md:text-[2rem]">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function Panel({ title, description, actions, children, className, id, tight }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string; tight?: boolean }) {
  return (
    <section id={id} className={cn("rounded-lg border border-line bg-surface", className)}>
      {title || actions ? (
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3 md:px-5">
          <div>
            {title ? <h2 className="text-[17px] font-semibold text-text">{title}</h2> : null}
            {description ? <p className="text-sm text-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={tight ? "" : "p-4 md:p-5"}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className={cn("tabular mt-1 text-2xl font-semibold", tone === "critical" ? "text-critical" : tone === "ok" ? "text-ok" : tone === "fine" ? "text-fine" : "text-text")}>{value}</p>
      {sub ? <p className="mt-0.5 text-[13px] text-muted">{sub}</p> : null}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line-strong px-6 py-10 text-center">
      {Icon ? <Icon aria-hidden className="size-8 text-muted" /> : null}
      <p className="font-semibold">{title}</p>
      {children ? <div className="max-w-md text-sm text-muted">{children}</div> : null}
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton h-4", className)} />;
}

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="جارٍ التحميل" className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={i === 0 ? "h-7 w-1/3" : "h-4 w-full"} />
      ))}
    </div>
  );
}

export function ProgressBar({ value, tone = "ink", label }: { value: number; tone?: "ink" | "ok" | "critical" | "fine"; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  const color = tone === "ok" ? "bg-ok" : tone === "critical" ? "bg-critical" : tone === "fine" ? "bg-fine" : "bg-ink";
  return (
    <div role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label} className="h-2 w-full overflow-hidden rounded-full bg-surface-2 ring-1 ring-line">
      <div className={cn("h-full rounded-full transition-[width] duration-500", color)} style={{ width: `${v}%` }} />
    </div>
  );
}

/** Key/value grid for profile sections. */
export function DefinitionList({ items, cols = 2 }: { items: { label: string; value: ReactNode; hint?: string }[]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-4", cols === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : cols === 2 ? "sm:grid-cols-2" : "")}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-[13px] text-muted">{it.label}</dt>
          <dd className="mt-0.5 break-words">{it.value ?? "—"}</dd>
          {it.hint ? <p className="text-[12px] text-muted">{it.hint}</p> : null}
        </div>
      ))}
    </dl>
  );
}

/** Responsive table: a real table on desktop, stacked rows on phones (via data-label). */
export function DataTable<T>({ rows, columns, empty, rowKey, caption }: {
  rows: T[];
  columns: { key: string; label: string; render: (r: T) => ReactNode; className?: string; hideOnMobile?: boolean }[];
  empty?: ReactNode;
  rowKey: (r: T) => string;
  caption?: string;
}) {
  if (!rows.length) return <>{empty ?? <p className="py-6 text-center text-muted">لا توجد بيانات بعد.</p>}</>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[15px]">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="hidden md:table-header-group">
          <tr className="border-b border-line text-start text-[13px] text-muted">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn("px-3 py-2 text-start font-medium", c.className)}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className="block border-b border-line py-2 md:table-row md:py-0 hover:bg-surface-2/60">
              {columns.map((c) => (
                <td key={c.key} data-label={c.label} className={cn("flex gap-3 px-1 py-1 md:table-cell md:px-3 md:py-3 align-top", c.hideOnMobile && "hidden md:table-cell", c.className)}>
                  <span className="w-28 shrink-0 text-[13px] text-muted md:hidden">{c.label}</span>
                  <span className="min-w-0 flex-1">{c.render(r)}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Vertical sequence (requests stages, waqf journey). */
export function Steps({ steps }: { steps: { label: ReactNode; status: "done" | "active" | "pending" | "skipped"; meta?: ReactNode }[] }) {
  return (
    <ol className="relative space-y-4 border-s border-line ps-5">
      {steps.map((s, i) => (
        <li key={i} className="relative">
          <span
            aria-hidden
            className={cn(
              "absolute -start-[27px] top-1.5 size-3 rounded-full ring-4 ring-surface",
              s.status === "done" ? "bg-ok" : s.status === "active" ? "bg-ink" : "bg-line-strong",
            )}
          />
          <p className={cn("font-medium", s.status === "pending" && "text-muted")}>
            {s.label}
            <span className="sr-only"> — {s.status === "done" ? "منجزة" : s.status === "active" ? "جارية" : s.status === "skipped" ? "متجاوزة" : "قادمة"}</span>
          </p>
          {s.meta ? <div className="text-sm text-muted">{s.meta}</div> : null}
        </li>
      ))}
    </ol>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-surface-2 px-1.5 text-[12px]">{children}</kbd>;
}
