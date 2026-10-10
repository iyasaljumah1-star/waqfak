/**
 * Hand-made radar chart for the 11 assessment axes, generated as an SVG string so the exact same
 * drawing is used on the web (inline) and in the PDF report. Pure: no React, no DOM.
 */

export const AXIS_SHORT: Record<string, string> = {
  A1: "الشرعي", A2: "النظامي", A3: "النظارة", A4: "الحوكمة", A5: "المالي", A6: "الاستثمار",
  A7: "الأصول", A8: "الوثائق", A9: "المستفيدون", A10: "المخاطر", A11: "الرقمنة",
};

export type RadarAxis = { code: string; name: string; score: number | null; capped?: boolean };
export type RadarSeries = { label: string; scores: Record<string, number | null>; color: string; fill?: string; dashed?: boolean };
export type RadarPalette = { ink: string; grid: string; text: string; muted: string; critical: string; fill: string; surface: string };

export const WEB_PALETTE: RadarPalette = { ink: "var(--ink)", grid: "var(--line)", text: "var(--text)", muted: "var(--muted)", critical: "var(--critical)", fill: "var(--ink)", surface: "var(--surface)" };
export const PRINT_PALETTE: RadarPalette = { ink: "#0e4d3c", grid: "#dadfd6", text: "#1c1d1f", muted: "#55595f", critical: "#b3261e", fill: "#0e4d3c", surface: "#ffffff" };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const r1 = (n: number) => Math.round(n * 10) / 10;

export function radarLabel(axes: RadarAxis[]): string {
  return `مخطط عنكبوتي لدرجات محاور التقييم من 100: ${axes.map((a) => `${a.name} ${a.score === null ? "لا ينطبق" : Math.round(a.score)}`).join("، ")}.`;
}

/**
 * @param axes   axes in display order (first axis at the top, then clockwise)
 * @param series extra series to overlay (comparison); the primary series is `axes[].score`
 */
export function radarSvg(axes: RadarAxis[], opts: { palette?: RadarPalette; size?: number; series?: RadarSeries[]; title?: string; showValues?: boolean } = {}): string {
  const p = opts.palette ?? WEB_PALETTE;
  const W = 560;
  const H = 470;
  const cx = W / 2;
  const cy = H / 2 + 4;
  const R = 160;
  const n = axes.length || 1;
  const angle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const pt = (i: number, v: number) => [cx + Math.cos(angle(i)) * R * (v / 100), cy + Math.sin(angle(i)) * R * (v / 100)] as const;
  const s = (st: Record<string, string | number>) => Object.entries(st).map(([k, v]) => `${k}:${v}`).join(";");

  const parts: string[] = [];
  // grid rings
  for (const ring of [25, 50, 75, 100]) {
    const pts = axes.map((_, i) => pt(i, ring).map(r1).join(",")).join(" ");
    parts.push(`<polygon points="${pts}" style="${s({ fill: "none", stroke: p.grid, "stroke-width": ring === 100 ? 1.4 : 1 })}"/>`);
  }
  // ring labels (on the first spoke)
  for (const ring of [50, 100]) {
    const [x, y] = pt(0, ring);
    parts.push(`<text x="${r1(x + 4)}" y="${r1(y + 12)}" style="${s({ fill: p.muted, "font-size": "10px" })}">${ring}</text>`);
  }
  // spokes + labels
  axes.forEach((a, i) => {
    const [x, y] = pt(i, 100);
    parts.push(`<line x1="${cx}" y1="${cy}" x2="${r1(x)}" y2="${r1(y)}" style="${s({ stroke: p.grid, "stroke-width": 1 })}"/>`);
    const [lx, ly] = pt(i, 118);
    const cos = Math.cos(angle(i));
    const anchor = Math.abs(cos) < 0.2 ? "middle" : cos > 0 ? "start" : "end";
    const name = esc(AXIS_SHORT[a.code] ?? a.name);
    const val = a.score === null ? "—" : String(Math.round(a.score));
    const color = a.capped ? p.critical : a.score === null ? p.muted : p.text;
    parts.push(
      `<text x="${r1(lx)}" y="${r1(ly)}" text-anchor="${anchor}" dominant-baseline="middle" style="${s({ fill: color, "font-size": "13px", "font-weight": 600 })}">${name}` +
        (opts.showValues === false ? "" : `<tspan x="${r1(lx)}" dy="16" style="${s({ fill: a.capped ? p.critical : p.muted, "font-size": "12px", "font-weight": 500 })}">${val}</tspan>`) +
        `</text>`,
    );
  });

  const poly = (scores: (number | null)[], stroke: string, fill: string, dashed = false) => {
    const pts = scores.map((v, i) => pt(i, v ?? 0).map(r1).join(",")).join(" ");
    return `<polygon points="${pts}" style="${s({ fill, "fill-opacity": 0.14, stroke, "stroke-width": 2.2, "stroke-linejoin": "round", ...(dashed ? { "stroke-dasharray": "5 4" } : {}) })}"/>`;
  };
  for (const ser of opts.series ?? []) parts.push(poly(axes.map((a) => ser.scores[a.code] ?? null), ser.color, ser.fill ?? "none", ser.dashed));
  parts.push(poly(axes.map((a) => a.score), p.ink, p.fill));
  axes.forEach((a, i) => {
    if (a.score === null) return;
    const [x, y] = pt(i, a.score);
    parts.push(`<circle cx="${r1(x)}" cy="${r1(y)}" r="${a.capped ? 5 : 3.6}" style="${s({ fill: a.capped ? p.critical : p.ink, stroke: p.surface, "stroke-width": 1.5 })}"/>`);
  });

  const label = esc(opts.title ?? radarLabel(axes));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${label}" style="direction:ltr;max-width:${opts.size ?? W}px;height:auto;font-family:inherit">${parts.join("")}</svg>`;
}

/** Small trend line for assessment history (scores 0..100, oldest first). */
export function sparklineSvg(values: number[], opts: { width?: number; height?: number; color?: string; label?: string } = {}): string {
  const w = opts.width ?? 120;
  const h = opts.height ?? 32;
  const color = opts.color ?? "var(--ink)";
  if (!values.length) return "";
  const xs = values.length === 1 ? [w / 2] : values.map((_, i) => 3 + (i * (w - 6)) / (values.length - 1));
  const ys = values.map((v) => h - 3 - ((Math.max(0, Math.min(100, v)) / 100) * (h - 6)));
  const d = xs.map((x, i) => `${i ? "L" : "M"}${r1(x)},${r1(ys[i])}`).join(" ");
  const last = values.length - 1;
  const label = esc(opts.label ?? `اتجاه الدرجة: ${values.map((v) => Math.round(v)).join(" ثم ")}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${label}" style="direction:ltr">` +
    `<line x1="0" x2="${w}" y1="${r1(h - 3 - 0.5 * (h - 6))}" y2="${r1(h - 3 - 0.5 * (h - 6))}" style="stroke:var(--line);stroke-dasharray:2 3"/>` +
    `<path d="${d}" style="fill:none;stroke:${color};stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>` +
    `<circle cx="${r1(xs[last])}" cy="${r1(ys[last])}" r="3" style="fill:${color}"/></svg>`;
}
