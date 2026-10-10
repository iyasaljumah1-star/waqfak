import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The Waqfak mark (direction «الغرس»): a young palm in a rounded square — the trunk is the preserved asset (الأصل),
 * the fronds the renewing yield (الثمرة), one ripe date in gold.
 * The square takes `currentColor`; the palm is drawn in `--mark-cut` (default: the surface color), so set
 * `[--mark-cut:var(--ink)]` (or similar) when the mark sits on a dark background.
 */
export function Seal({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <rect width="48" height="48" rx="14" fill="currentColor" />
      <g fill="none" stroke="var(--mark-cut, var(--surface))" strokeWidth="2.5" strokeLinecap="round">
        <path d="M24 38V22" strokeWidth="2.7" />
        <path d="M24 22c-2-6-7-8-12-7 3 2 6 5 7 9" />
        <path d="M24 22c2-6 7-8 12-7-3 2-6 5-7 9" />
        <path d="M24 22c0-5 1.5-9 4-12" />
      </g>
      <circle cx="30.5" cy="27" r="2.7" fill="var(--seal)" />
    </svg>
  );
}

export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2.5 text-ink", className)} aria-label="وقفك — الصفحة الرئيسية">
      <Seal className="size-9" />
      <span className="text-[25px] font-bold leading-none">وقفك</span>
    </Link>
  );
}
