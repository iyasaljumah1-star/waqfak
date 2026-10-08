import type { ReactNode } from "react";
import { Lock, ScrollText } from "lucide-react";
import { cn, fmtNumber } from "@/lib/utils";

/** Masked sensitive value (decryption never reaches the browser; only the masked text is rendered). */
export function Masked({ value, label }: { value: string | null; label?: string }) {
  if (!value) return <span className="text-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-1" data-masked="true">
      <Lock aria-hidden className="size-3.5 text-muted" />
      <span dir="ltr" className="tabular tracking-wide">{value}</span>
      {label ? <span className="sr-only">{label} (مخفي جزئيًا)</span> : null}
    </span>
  );
}

/** Horizontal stacked bar for percentage allocations. */
export function AllocationBar({ parts }: { parts: { label: string; pct: number; tone?: string }[] }) {
  const palette = ["bg-ink", "bg-seal", "bg-olive", "bg-info", "bg-fine", "bg-warn", "bg-muted"];
  const total = parts.reduce((s, p) => s + p.pct, 0);
  return (
    <div className="space-y-2">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2 ring-1 ring-line" role="img" aria-label={`مجموع النسب ${fmtNumber(total)}%`}>
        {parts.filter((p) => p.pct > 0).map((p, i) => (
          <div key={p.label} className={cn("h-full", p.tone ?? palette[i % palette.length])} style={{ width: `${Math.min(100, p.pct)}%` }} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
        {parts.map((p, i) => (
          <li key={p.label} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn("inline-block size-2.5 rounded-sm", p.tone ?? palette[i % palette.length])} />
            {p.label}: <span className="tabular text-text">{fmtNumber(p.pct)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Document-like surface for deed / will drafts, with the mandatory "indicative draft" label. */
export function DeedPaper({ title, label, children, testId }: { title: string; label: string; children: ReactNode; testId?: string }) {
  return (
    <article className="deed-paper naskh space-y-4 leading-[2.1]" data-testid={testId}>
      <p className="flex items-center gap-2 rounded-md border border-seal/40 bg-seal-soft px-3 py-2 font-sans text-[14px] font-semibold text-seal" role="note">
        <ScrollText aria-hidden className="size-4 shrink-0" />
        {label}
      </p>
      <h2 className="text-center text-[1.5rem] font-bold text-ink">{title}</h2>
      {children}
    </article>
  );
}

/** Renders paragraphs from plain text (blank line = new paragraph; lines starting with "## " = clause headings). */
export function DeedText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className="space-y-3 text-[1.05rem]">
      {blocks.map((b, i) =>
        b.startsWith("## ") ? (
          <h3 key={i} className="pt-2 text-[1.15rem] font-bold text-ink">{b.slice(3)}</h3>
        ) : (
          <p key={i} className="whitespace-pre-line">{b}</p>
        ),
      )}
    </div>
  );
}

export function SubHead({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-[15px] font-semibold text-ink">{children}</h3>
      {actions}
    </div>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-muted">{children}</p>;
}
