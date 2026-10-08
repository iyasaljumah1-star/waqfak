/** Flattens JSON into dotted paths for a before/after field diff. Pure; safe on client and server. */
export function flatten(v: unknown, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const entries = Object.entries(v as Record<string, unknown>);
    if (!entries.length && prefix) out[prefix] = {};
    for (const [k, x] of entries) flatten(x, prefix ? `${prefix}.${k}` : k, out);
  } else if (prefix) out[prefix] = v;
  else if (v !== null && v !== undefined) out["(القيمة)"] = v;
  return out;
}

export type DiffRow = { path: string; before: unknown; after: unknown; change: "added" | "removed" | "changed" | "same" };

export function diffRows(before: unknown, after: unknown): DiffRow[] {
  const a = flatten(before);
  const b = flatten(after);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return keys.map((k) => {
    const inA = k in a;
    const inB = k in b;
    const same = inA && inB && JSON.stringify(a[k]) === JSON.stringify(b[k]);
    return { path: k, before: a[k], after: b[k], change: !inA ? "added" : !inB ? "removed" : same ? "same" : "changed" };
  });
}

export const show = (v: unknown) => (v === undefined ? "" : v === null ? "null" : typeof v === "string" ? v : JSON.stringify(v));
