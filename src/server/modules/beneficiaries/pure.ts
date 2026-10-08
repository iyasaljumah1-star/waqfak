/** Pure beneficiary math: shares by division rule, exact amount splitting, class share checks. */

export type Person = { id: string; gender?: "m" | "f" | "" | null };

/** Shares (fractions summing to 1) for one tier by the founder's division rule. male_double needs a gender per person. */
export function computeShares(people: Person[], rule: "equal" | "male_double" | string | null): { ok: true; shares: Record<string, number> } | { ok: false; error: string } {
  if (!people.length) return { ok: false, error: "لا مستحقين نشطين في هذه الفئة." };
  if (rule === "male_double") {
    const missing = people.filter((p) => p.gender !== "m" && p.gender !== "f");
    if (missing.length) return { ok: false, error: "قاعدة «للذكر مثل حظ الأنثيين» تحتاج تحديد الجنس لكل مستحق." };
    const units = people.reduce((s, p) => s + (p.gender === "m" ? 2 : 1), 0);
    return { ok: true, shares: Object.fromEntries(people.map((p) => [p.id, (p.gender === "m" ? 2 : 1) / units])) };
  }
  return { ok: true, shares: Object.fromEntries(people.map((p) => [p.id, 1 / people.length])) };
}

/**
 * Splits `total` by weights into 2-decimal amounts that add up exactly to `total` (largest-remainder method).
 * Weights need not sum to 1.
 */
export function splitAmount(total: number, weights: { id: string; weight: number }[]): { id: string; amount: number }[] {
  const valid = weights.filter((w) => w.weight > 0);
  const sum = valid.reduce((s, w) => s + w.weight, 0);
  if (!valid.length || sum <= 0) return [];
  const totalCents = Math.round(total * 100);
  const raw = valid.map((w) => ({ id: w.id, exact: (totalCents * w.weight) / sum }));
  const floored = raw.map((r) => ({ id: r.id, c: Math.floor(r.exact), rem: r.exact - Math.floor(r.exact) }));
  let left = totalCents - floored.reduce((s, r) => s + r.c, 0);
  const order = [...floored].sort((a, b) => b.rem - a.rem);
  for (const r of order) {
    if (left <= 0) break;
    r.c += 1;
    left -= 1;
  }
  return floored.map((r) => ({ id: r.id, amount: r.c / 100 }));
}

/** Within one tier, classes that share ("و") must not exceed 100% in total. */
export function tierShareIssues(classes: { tier: number; relation: string; sharePct: string | number | null; name: string }[]): string[] {
  const issues: string[] = [];
  const byTier = new Map<number, number>();
  for (const c of classes) if (c.sharePct !== null && c.sharePct !== "") byTier.set(c.tier, (byTier.get(c.tier) ?? 0) + Number(c.sharePct));
  for (const [tier, sum] of byTier) if (sum > 100.0001) issues.push(`مجموع حصص الطبقة ${tier} يتجاوز 100% (${sum.toFixed(2)}%).`);
  if (classes.length && !classes.some((c) => c.relation === "then" || c.tier > 1) && classes.length > 1 && !byTier.size)
    issues.push("فئات متعددة بالتشريك بلا نسب محددة: تُقسم الغلة بينها بالتساوي ما لم يحدد شرط الواقف غير ذلك.");
  return issues;
}

/** Masks an identifier for display: keeps the last 4 characters. */
export const maskId = (v: string | null) => (v ? `${"•".repeat(Math.max(2, Math.min(8, v.length - 4)))}${v.slice(-4)}` : null);
