import { radarLabel, radarSvg, sparklineSvg, type RadarAxis, type RadarSeries } from "./radar";
import { cn } from "@/lib/utils";

/** Inline radar (same SVG as the PDF). The visible axes table next to it is the text alternative. */
export function RadarFigure({ axes, series, caption, className }: { axes: RadarAxis[]; series?: RadarSeries[]; caption?: string; className?: string }) {
  return (
    <figure className={cn("m-0", className)}>
      <div className="mx-auto w-full max-w-[560px]" dangerouslySetInnerHTML={{ __html: radarSvg(axes, { series, title: radarLabel(axes) }) }} />
      {caption ? <figcaption className="mt-1 text-center text-[13px] text-muted">{caption}</figcaption> : null}
    </figure>
  );
}

export function Sparkline({ values, label, className }: { values: number[]; label?: string; className?: string }) {
  return <span className={cn("inline-block align-middle", className)} dangerouslySetInnerHTML={{ __html: sparklineSvg(values, { label }) }} />;
}

/** Score bar used in axis tables (with the number; color never carries meaning alone). */
export function ScoreBar({ score, capped }: { score: number | null; capped?: boolean }) {
  if (score === null) return <span className="text-[13px] text-muted">لا ينطبق</span>;
  const tone = capped || score < 40 ? "bg-critical" : score < 60 ? "bg-fine" : score < 75 ? "bg-info" : "bg-ok";
  return (
    <span className="flex items-center gap-2">
      <span className="tabular w-9 shrink-0 text-end font-semibold">{Math.round(score)}</span>
      <span aria-hidden className="h-2 min-w-16 flex-1 overflow-hidden rounded-full bg-surface-2 ring-1 ring-line">
        <span className={cn("block h-full rounded-full", tone)} style={{ width: `${Math.max(2, score)}%` }} />
      </span>
    </span>
  );
}
