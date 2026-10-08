/** Revenue allocation rules: the founder's percentages for maintenance, reserve, nazir fee… must total ≤ 100%. */
export const ALLOCATION_KEYS = ["maintenancePct", "developmentPct", "reinvestPct", "reservePct", "nazirFeePct", "adminPct"] as const;
export type Allocation = Partial<Record<(typeof ALLOCATION_KEYS)[number], string | number | null>>;

export function allocationTotal(a: Allocation): number {
  return Math.round(ALLOCATION_KEYS.reduce((s, k) => s + (Number(a[k] ?? 0) || 0), 0) * 100) / 100;
}

export function validateAllocation(a: Allocation): { ok: true; beneficiariesPct: number } | { ok: false; error: string } {
  const t = allocationTotal(a);
  if (t > 100) return { ok: false, error: `مجموع النسب ${t}% يتجاوز 100%. خفّض إحدى النسب حتى يبقى للمستفيدين ما يستحقونه.` };
  return { ok: true, beneficiariesPct: Math.round((100 - t) * 100) / 100 };
}
