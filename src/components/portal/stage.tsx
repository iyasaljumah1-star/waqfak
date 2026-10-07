import { cn } from "@/lib/utils";
import { JOURNEY_STAGES } from "./labels";

/** Compact journey indicator: five short bars, the current stage named in words. */
export function StageMeter({ stage, className }: { stage: number; className?: string }) {
  const s = Math.min(5, Math.max(1, stage || 1));
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span aria-hidden className="flex gap-0.5">
        {JOURNEY_STAGES.map((_, i) => (
          <span key={i} className={cn("h-1.5 w-4 rounded-full", i < s ? "bg-ink" : "bg-line")} />
        ))}
      </span>
      <span className="text-[13px] text-muted">
        المرحلة <span className="tabular">{s}</span> من 5: <span className="text-text">{JOURNEY_STAGES[s - 1]}</span>
      </span>
    </div>
  );
}
