import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export const SITE_URL = process.env.APP_URL ?? "http://localhost:3000";

export function Container({ children, className, narrow }: { children: ReactNode; className?: string; narrow?: boolean }) {
  return <div className={cn("mx-auto w-full px-4 md:px-6", narrow ? "max-w-3xl" : "max-w-6xl", className)}>{children}</div>;
}

export function Crumbs({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav aria-label="مسار التنقل" className="text-[14px] text-muted">
      <ol className="flex flex-wrap items-center gap-1.5">
        <li>
          <Link href="/" className="hover:text-ink hover:underline">الرئيسية</Link>
        </li>
        {items.map((c, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span aria-hidden className="text-line-strong">/</span>
            {c.href ? <Link className="hover:text-ink hover:underline" href={c.href}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Page opening band used by inner pages: quiet stone ground, Naskh title, short lede. */
export function PageIntro({ title, lede, crumbs, children, aside, icon: Icon }: { title: ReactNode; lede?: ReactNode; crumbs?: { href?: string; label: string }[]; children?: ReactNode; aside?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="border-b border-line bg-stone">
      <Container className="py-8 md:py-12">
        {crumbs ? <Crumbs items={crumbs} /> : null}
        <div className={cn("mt-5 grid gap-8", aside && "lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end")}>
          <div className="min-w-0">
            {Icon ? (
              <span aria-hidden className="mb-4 grid size-12 place-items-center rounded-[14px] bg-surface text-ink shadow-card ring-1 ring-line">
                <Icon strokeWidth={1.75} className="size-6" />
              </span>
            ) : null}
            <h1 className="font-naskh text-[1.9rem] font-bold leading-[1.5] text-ink md:text-[2.5rem]">{title}</h1>
            {lede ? <p className="mt-3 max-w-2xl text-[17px] leading-8 text-muted">{lede}</p> : null}
            {children}
          </div>
          {aside}
        </div>
      </Container>
    </div>
  );
}

export function JsonLd({ data }: { data: unknown }) {
  // JSON, not HTML: escape "<" so the payload can never close the script element.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}

export function FilterChip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex h-9 items-center rounded-full border px-3.5 text-[14px] font-medium transition-colors",
        active ? "border-ink bg-ink text-white dark:text-[#0f141c]" : "border-line-strong bg-surface text-text hover:border-ink hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}

/** One concise note on estimate-based results (tools, assessment). */
export function IndicativeNote({ children }: { children?: ReactNode }) {
  return (
    <p className="rounded-md border-s-2 border-seal bg-seal-soft/60 px-3 py-2 text-[14px] leading-7 text-text/85">
      {children ?? "نتيجة تقديرية بحسب ما أدخلته؛ ولتأكيدها في حالتك اطلب رأي مختص."}
    </p>
  );
}
