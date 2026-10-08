import Link from "next/link";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui";
import { cn } from "@/lib/utils";

/** Page wrapper for the editors: works inside the admin layout or on its own (keeps a readable width and gutter). */
export function EditorPage({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <div className={cn("mx-auto w-full min-w-0 space-y-6", wide ? "max-w-7xl" : "max-w-6xl")}>{children}</div>;
}

export function TabNav({ tabs, current, label }: { tabs: { key: string; label: string; href: string; count?: number }[]; current: string; label: string }) {
  return (
    <nav aria-label={label} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === current ? "page" : undefined}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[15px]",
            t.key === current ? "bg-ink text-white dark:text-[#0f141c]" : "border border-line bg-surface hover:bg-surface-2",
          )}
        >
          {t.label}
          {t.count !== undefined ? <span className={cn("tabular rounded-full px-1.5 text-[12px]", t.key === current ? "bg-white/20" : "bg-surface-2 text-muted")}>{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

/** Confirmation banners driven by ?created=1 / ?deleted=1 / ?saved=<msg> after a redirect. */
export function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  if (one("saved")) return <Alert tone="ok" title="تم الحفظ">{one("saved")}</Alert>;
  if (one("created")) return <Alert tone="ok" title="أُنشئ السجل وحُفظ في سجل العمليات." />;
  if (one("deleted")) return <Alert tone="ok" title="حُذف السجل وسُجّل الحذف في سجل العمليات." />;
  return null;
}

/** Grid for form fields: one column on phones, two on wider screens. */
export function FieldGrid({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) {
  return <div className={cn("grid gap-4", cols === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2")}>{children}</div>;
}

export function CheckGroup({ name, options, selected }: { name: string; options: { value: string; label: string }[]; selected: string[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {options.map((o) => (
        <label key={o.value} className="flex items-center gap-2 text-[15px]">
          <input type="checkbox" name={name} value={o.value} defaultChecked={selected.includes(o.value)} className="size-4 accent-[var(--ink)]" />
          {o.label}
        </label>
      ))}
    </div>
  );
}

/** Read-only key/value change log list (price_change_log, compliance_change_log). */
export function ChangeList({ items, empty = "لا تغييرات مسجلة بعد." }: { items: { key: string; at: string; who: string | null; text: ReactNode }[]; empty?: string }) {
  if (!items.length) return <p className="text-[14px] text-muted">{empty}</p>;
  return (
    <ol className="space-y-2 text-[14px]">
      {items.map((i) => (
        <li key={i.key} className="border-b border-line pb-2 last:border-0">
          <p className="text-[12px] text-muted">{i.at} — {i.who ?? "النظام"}</p>
          <div className="break-words">{i.text}</div>
        </li>
      ))}
    </ol>
  );
}
