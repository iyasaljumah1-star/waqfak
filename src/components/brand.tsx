import Link from "next/link";
import { cn } from "@/lib/utils";

/** The Waqfak mark: a seal (ختم) enclosing a sprouting stem — the fixed asset and the ongoing fruit. */
export function Seal({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="32" cy="32" r="23.5" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 3" />
      <path d="M32 46V27" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M32 33c-6.5 0-10-4-10.5-9.5 6 .2 10 3.3 10.5 9.5Z" fill="currentColor" />
      <path d="M32 28.5c5.8 0 9.2-3.6 9.7-8.6-5.4.2-9 3-9.7 8.6Z" fill="currentColor" opacity=".75" />
      <path d="M24 46h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2 text-ink", className)} aria-label="وقفك — الصفحة الرئيسية">
      <Seal className="size-9" />
      <span className="font-naskh text-[26px] font-bold leading-none">وقفك</span>
    </Link>
  );
}
