/** Pure asset helpers: totals → asset band → size-class suggestion; lease expiry alerts. */
import { deriveSizeClass, type SizeClass } from "../../engines/assessment";

export type AssetBand = "lt5" | "5to50" | "50to200" | "gte200";
const M = 1_000_000;

export function bandForValue(total: number): AssetBand {
  if (total >= 200 * M) return "gte200";
  if (total >= 50 * M) return "50to200";
  if (total >= 5 * M) return "5to50";
  return "lt5";
}

/** Size class implied by the recorded assets (market value, else book value), same rule as the assessment engine. */
export function suggestSizeClass(total: number, directBenefit: boolean): SizeClass | null {
  return deriveSizeClass({ asset_band: bandForValue(total), direct_benefit: directBenefit ? "yes" : "no" });
}

export const assetValue = (a: { marketValue: string | null; bookValue: string | null; sharePct?: string | null }) => {
  const v = Number(a.marketValue ?? a.bookValue ?? 0) || 0;
  return v; // values are entered for the waqf's own share (مشاع) — sharePct is informational
};

export function leaseAlert(endsOn: string | null, today: string): "expired" | "soon" | "ok" | "open" {
  if (!endsOn) return "open";
  if (endsOn < today) return "expired";
  const d = (new Date(`${endsOn}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000;
  return d <= 90 ? "soon" : "ok";
}
