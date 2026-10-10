/**
 * «وقفك» visual system: shared presentation blocks for the public site.
 * Rules (see docs/DESIGN-SYSTEM.md):
 *  - Section bands separate the big parts of a page (plain ↔ stone ↔ ink), never two equal tones in a row.
 *  - Cards hold independent, selectable things (a service, an article, a category, a tool, a reference).
 *  - Panels highlight one piece of information inside reading flow (note, outcome, regulatory text, caution).
 *  - A hairline rule only separates items inside one card or list, not sections.
 *  - Icons name a concept (category, audience, kind, tool); the same concept keeps the same icon.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, CircleCheck, ExternalLink, Info, Lightbulb, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonClass } from "@/components/ui";
import type { PublicService } from "@/server/modules/public/queries";
import { Container } from "./bits";
import { categoryIcon, kindIcon } from "./icons";
import { availabilityCopy, CONTENT_AUDIENCE_LABEL, JOURNEY, KIND_LABEL, priceText, SERVICE_AUDIENCE_LABEL, TOPIC_LABEL } from "./labels";

// ───────────── Section bands ─────────────
export type SectionTone = "plain" | "stone" | "ink";
const sectionTone: Record<SectionTone, string> = {
  plain: "bg-surface",
  stone: "bg-stone",
  ink: "bg-ink text-white dark:bg-[#0d3a2e]",
};

export function Section({ tone = "plain", labelledBy, id, className, containerClassName, children }: { tone?: SectionTone; labelledBy?: string; id?: string; className?: string; containerClassName?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={labelledBy} data-tone={tone} className={cn(sectionTone[tone], "py-14 md:py-20", className)}>
      <Container className={containerClassName}>{children}</Container>
    </section>
  );
}

/** Section title + lede (+ action on the far side). Titles start-aligned; one size per level across the site. */
export function SectionHeader({ id, title, lede, action, icon: Icon, onInk, level = 2, className }: { id?: string; title: ReactNode; lede?: ReactNode; action?: ReactNode; icon?: LucideIcon; onInk?: boolean; level?: 2 | 3; className?: string }) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}>
      <div className="flex min-w-0 max-w-2xl items-start gap-4">
        {Icon ? <IconTile icon={Icon} tone={onInk ? "onInk" : "ink"} size="lg" className="mt-1" /> : null}
        <div className="min-w-0">
          <H id={id} className={cn("font-naskh font-bold leading-[1.5]", level === 2 ? "text-[1.7rem] md:text-[2.05rem]" : "text-[1.4rem] md:text-[1.55rem]", onInk ? "text-white" : "text-ink")}>
            {title}
          </H>
          {lede ? <p className={cn("mt-2 text-[16.5px] leading-8", onInk ? "text-white/80" : "text-muted")}>{lede}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

// ───────────── Icon tile ─────────────
const tileTone = {
  ink: "bg-ink-soft text-ink",
  seal: "bg-seal-soft text-[#8a5a06] dark:text-seal",
  surface: "bg-surface text-ink ring-1 ring-line",
  onInk: "bg-white/12 text-white",
};
const tileSize = { sm: "size-9 rounded-[10px] [&>svg]:size-[18px]", md: "size-11 rounded-[12px] [&>svg]:size-5", lg: "size-12 rounded-[14px] [&>svg]:size-6" };

export function IconTile({ icon: Icon, tone = "ink", size = "md", className }: { icon: LucideIcon; tone?: keyof typeof tileTone; size?: keyof typeof tileSize; className?: string }) {
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center", tileTone[tone], tileSize[size], className)}>
      <Icon strokeWidth={1.75} />
    </span>
  );
}

// ───────────── Card shell ─────────────
/** Base card: light surface, hairline border, 14px radius; the interactive variant lifts its border and shadow on hover/focus. */
export const cardClass = (interactive = false, className?: string) =>
  cn(
    "card relative flex flex-col rounded-md border border-line bg-surface",
    interactive && "transition-[border-color,box-shadow] duration-150 hover:border-ink/35 hover:shadow-card focus-within:border-ink/45 focus-within:shadow-card",
    className,
  );

/** Small meta chip (classification, stage, kind). Not a status: status uses <Badge>. */
export function Chip({ children, tone = "neutral", icon: Icon, className, dir }: { children: ReactNode; tone?: "neutral" | "ink" | "seal" | "warn" | "onInk"; icon?: LucideIcon; className?: string; dir?: "ltr" | "rtl" }) {
  const t = {
    neutral: "bg-surface-2 text-muted ring-1 ring-inset ring-line",
    ink: "bg-ink-soft text-ink",
    seal: "bg-seal-soft text-[#7a4f05] dark:text-seal",
    warn: "bg-warn-soft text-warn",
    onInk: "bg-white/12 text-white/90",
  }[tone];
  return (
    <span dir={dir} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12.5px] font-medium leading-6", t, className)}>
      {Icon ? <Icon aria-hidden className="size-3.5 shrink-0" /> : null}
      {children}
    </span>
  );
}

/** "Continue" affordance at the foot of a link card (visual only; the whole card is the link). */
function CardMore({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden className="inline-flex items-center gap-1 text-[14px] font-medium text-ink">
      {children}
      <ArrowLeft className="size-4 transition-transform duration-150 group-hover:-translate-x-0.5" />
    </span>
  );
}

// ───────────── Service card ─────────────
const stageName = (n: number | null | undefined) => JOURNEY.find((j) => j.stage === n)?.name;

/**
 * One service as a self-contained card: code + stage, name (the link), summary, audiences, price and the way in.
 * Renders an <li>; place inside a <ul> grid. The service name is the only link (whole card is clickable via ::after).
 */
export function ServiceCard({ s, showIcon = false, headingLevel = 3 }: { s: PublicService; showIcon?: boolean; headingLevel?: 2 | 3 }) {
  const off = availabilityCopy(s);
  const H = headingLevel === 2 ? "h2" : "h3";
  const priced = !!s.basePrice || s.pricingModel === "free";
  const stage = stageName(s.stage);
  return (
    <li className={cardClass(true, "group p-5")}>
      <div className="flex flex-wrap items-center gap-2">
        {showIcon ? <IconTile icon={categoryIcon(s.code)} size="sm" /> : null}
        <Chip dir="ltr" className="tabular">{s.code}</Chip>
        {stage ? <Chip tone="ink">مرحلة {stage}</Chip> : null}
        {off ? <Chip tone="warn">{off.label}</Chip> : null}
      </div>
      <H className="mt-3 text-[17.5px] font-bold leading-7 text-text">
        <Link href={`/services/${s.code}`} className="after:absolute after:inset-0 after:rounded-md group-hover:text-ink focus-visible:outline-none">
          {s.nameAr}
        </Link>
      </H>
      <p className="mt-1.5 line-clamp-3 text-[15px] leading-7 text-muted">{s.summary}</p>
      {s.audiences.length ? (
        <p className="mt-3 text-[13px] leading-6 text-muted">
          <span className="font-medium text-text/80">تناسب: </span>
          {s.audiences.map((a) => SERVICE_AUDIENCE_LABEL[a] ?? a).join("، ")}
        </p>
      ) : null}
      <div className="mt-auto pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3.5">
        <p className={cn("text-start", priced ? "text-[14.5px] font-semibold text-text" : "text-[13.5px] font-medium text-muted")}>
          <span className="sr-only">السعر: </span>
          {priceText(s.pricingModel, s.basePrice)}
        </p>
        <CardMore>{s.availability.available ? "التفاصيل والطلب" : "التفاصيل"}</CardMore>
        </div>
      </div>
    </li>
  );
}

/** Grid wrapper for service cards: one column on phones, two from tablets (three when `wide`). */
export function ServiceGrid({ children, wide, className }: { children: ReactNode; wide?: boolean; className?: string }) {
  return <ul className={cn("grid gap-4 sm:grid-cols-2", wide && "xl:grid-cols-3", className)}>{children}</ul>;
}

// ───────────── Article card ─────────────
type ArticleLike = { slug: string; kind: string; titleAr: string; summary: string | null; topic: string | null; readingMinutes: number | null; audience: string[] };

/** A library item as a card: kind (icon + label), topic, reading time, title (the link), summary. */
export function ArticleCard({ item, headingLevel = 3, compact }: { item: ArticleLike; headingLevel?: 2 | 3; compact?: boolean }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  const Icon = kindIcon(item.kind);
  return (
    <article className={cardClass(true, cn("group", compact ? "p-4" : "p-5"))}>
      <div className="flex items-center gap-3">
        <IconTile icon={Icon} tone={item.kind === "regulation" ? "seal" : "ink"} size="sm" />
        <p className="flex min-w-0 flex-wrap items-center gap-x-2.5 text-start text-[13px] text-muted">
          <span className="font-semibold text-text/85">{KIND_LABEL[item.kind] ?? item.kind}</span>
          {item.topic && TOPIC_LABEL[item.topic] ? <span>{TOPIC_LABEL[item.topic]}</span> : null}
          {item.readingMinutes ? <span className="tabular">{item.readingMinutes} دقائق قراءة</span> : null}
        </p>
      </div>
      <H className={cn("mt-3 font-bold leading-[1.65] text-text", compact ? "text-[16px]" : "text-[17.5px]")}>
        <Link href={`/library/${item.slug}`} className="after:absolute after:inset-0 after:rounded-md group-hover:text-ink focus-visible:outline-none">
          {item.titleAr}
        </Link>
      </H>
      {item.summary && !compact ? <p className="mt-1.5 line-clamp-3 text-[15px] leading-7 text-muted">{item.summary}</p> : null}
      {item.audience.length ? <span className="sr-only">لـ {item.audience.map((a) => CONTENT_AUDIENCE_LABEL[a] ?? a).join("، ")}</span> : null}
      {!compact ? (
        <div className="mt-auto pt-4">
          <CardMore>اقرأ</CardMore>
        </div>
      ) : null}
    </article>
  );
}

// ───────────── Category / feature cards ─────────────
/** A door into a group (service category, tool, audience): icon, title, description, optional count. Whole card is the link. */
export function CategoryCard({ href, icon, title, description, meta, more = "استعرض", headingLevel = 3 }: { href: string; icon: LucideIcon; title: ReactNode; description?: ReactNode; meta?: ReactNode; more?: string; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className={cardClass(true, "group p-5 md:p-6")}>
      <div className="flex items-start justify-between gap-3">
        <IconTile icon={icon} size="lg" />
        {meta ? <span className="tabular pt-1 text-[13px] font-medium text-muted">{meta}</span> : null}
      </div>
      <H className="mt-4 font-naskh text-[1.2rem] font-bold leading-[1.55] text-text group-hover:text-ink">
        <Link href={href} className="after:absolute after:inset-0 after:rounded-md focus-visible:outline-none">
          {title}
        </Link>
      </H>
      {description ? <p className="mt-1.5 text-[15px] leading-7 text-muted">{description}</p> : null}
      <div className="mt-auto pt-4">
        <CardMore>{more}</CardMore>
      </div>
    </div>
  );
}

/** A statement of value (not a link): icon, title, short text. */
export function FeatureCard({ icon, title, children, onInk, plain }: { icon: LucideIcon; title: ReactNode; children: ReactNode; onInk?: boolean; plain?: boolean }) {
  return (
    <div
      className={cn(
        "card flex gap-4 rounded-md p-5",
        onInk ? "bg-white/[0.07] ring-1 ring-inset ring-white/12" : plain ? "bg-transparent p-0" : "border border-line bg-surface",
      )}
    >
      <IconTile icon={icon} tone={onInk ? "onInk" : "ink"} />
      <div className="min-w-0">
        <h3 className={cn("text-[16.5px] font-bold leading-7", onInk ? "text-white" : "text-text")}>{title}</h3>
        <div className={cn("mt-1 text-start text-[15px] leading-7", onInk ? "text-white/75" : "text-muted")}>{children}</div>
      </div>
    </div>
  );
}

// ───────────── Panels ─────────────
export type PanelTone = "note" | "info" | "ok" | "warn" | "statute";
const panelTone: Record<PanelTone, { box: string; icon: LucideIcon; label: string }> = {
  note: { box: "border-seal bg-seal-soft/55", icon: Lightbulb, label: "ملاحظة" },
  info: { box: "border-info bg-info-soft/70", icon: Info, label: "للعلم" },
  ok: { box: "border-ok bg-ok-soft/70", icon: CircleCheck, label: "المخرجات" },
  warn: { box: "border-warn bg-warn-soft/70", icon: TriangleAlert, label: "تنبيه" },
  statute: { box: "border-ink bg-stone", icon: Info, label: "نص نظامي" },
};

/** Highlight box inside reading flow. Accent border on the start side, tinted ground, icon + optional title. */
export function InfoPanel({ tone = "note", title, children, icon, className }: { tone?: PanelTone; title?: ReactNode; children: ReactNode; icon?: LucideIcon; className?: string }) {
  const t = panelTone[tone];
  const Icon = icon ?? t.icon;
  return (
    <aside aria-label={typeof title === "string" ? title : t.label} className={cn("card flex gap-3 rounded-md border-s-4 p-4 md:p-5", t.box, className)}>
      <Icon aria-hidden className="mt-1 size-5 shrink-0 text-text/70" />
      <div className="min-w-0 flex-1 text-[15.5px] leading-8">
        {title ? <p className="mb-0.5 font-bold text-text">{title}</p> : null}
        <div className="text-text/90">{children}</div>
      </div>
    </aside>
  );
}

// ───────────── Reference card ─────────────
/** A regulation, guide or source. Internal links open the summary; external sources open the official text. */
export function ReferenceCard({ href, title, summary, meta, external, icon: Icon, headingLevel = 3 }: { href?: string | null; title: ReactNode; summary?: ReactNode; meta?: ReactNode; external?: boolean; icon: LucideIcon; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  const link = href ? (
    external ? (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="after:absolute after:inset-0 after:rounded-md focus-visible:outline-none">
        {title}
        <ExternalLink aria-hidden className="ms-1.5 inline size-3.5 align-[-1px] text-muted" />
        <span className="sr-only"> (يفتح في نافذة جديدة)</span>
      </a>
    ) : (
      <Link href={href} className="after:absolute after:inset-0 after:rounded-md focus-visible:outline-none">{title}</Link>
    )
  ) : (
    title
  );
  return (
    <div className={cardClass(!!href, "group flex-row gap-4 p-4 md:p-5")}>
      <IconTile icon={Icon} tone="seal" size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <H className="text-[16px] font-bold leading-7 text-text group-hover:text-ink">{link}</H>
        {summary ? <p className="mt-1 line-clamp-3 text-[14.5px] leading-7 text-muted">{summary}</p> : null}
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted">{meta}</div> : null}
      </div>
    </div>
  );
}

// ───────────── Related content ─────────────
export function RelatedContent({ id, title, children, more, className }: { id: string; title: ReactNode; children: ReactNode; more?: { href: string; label: string }; className?: string }) {
  return (
    <section aria-labelledby={id} className={className}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id={id} className="font-naskh text-[1.35rem] font-bold leading-[1.5] text-ink">{title}</h2>
        {more ? (
          <Link href={more.href} className="inline-flex items-center gap-1 text-[14.5px] font-medium text-ink underline-offset-4 hover:underline">
            {more.label}
            <ArrowLeft aria-hidden className="size-4" />
          </Link>
        ) : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

// ───────────── Call to action ─────────────
/** Closing invitation of a page: one framed band with a primary and an optional secondary action. */
export function CallToAction({ id = "cta-title", title, lede, primary, secondary }: { id?: string; title: ReactNode; lede?: ReactNode; primary: { href: string; label: string }; secondary?: { href: string; label: string } }) {
  return (
    <section aria-labelledby={id} className="bg-surface py-14 md:py-16">
      <Container>
        <div className="relative overflow-hidden rounded-lg bg-ink-soft px-6 py-9 sm:px-10 md:flex md:items-center md:justify-between md:gap-10 md:py-11 dark:bg-[#10241c]">
          <svg aria-hidden viewBox="0 0 48 48" className="pointer-events-none absolute -bottom-10 -end-6 size-56 text-ink/[0.08]">
            <g fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M24 38V22" strokeWidth="2.7" />
              <path d="M24 22c-2-6-7-8-12-7 3 2 6 5 7 9" />
              <path d="M24 22c2-6 7-8 12-7-3 2-6 5-7 9" />
              <path d="M24 22c0-5 1.5-9 4-12" />
            </g>
          </svg>
          <div className="relative max-w-2xl">
            <h2 id={id} className="font-naskh text-[1.55rem] font-bold leading-[1.55] text-ink md:text-[1.85rem]">{title}</h2>
            {lede ? <p className="mt-2 text-[16px] leading-8 text-text/80">{lede}</p> : null}
          </div>
          <div className="relative mt-6 flex flex-wrap gap-3 md:mt-0 md:shrink-0">
            <Link href={primary.href} className={buttonClass("primary", "lg")}>{primary.label}</Link>
            {secondary ? <Link href={secondary.href} className={buttonClass("secondary", "lg")}>{secondary.label}</Link> : null}
          </div>
        </div>
      </Container>
    </section>
  );
}
