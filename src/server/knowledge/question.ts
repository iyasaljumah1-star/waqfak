/**
 * The question the processing pipeline asks the knowledge engine for one section (PURE, unit-tested).
 *
 * The relevance rule (retrieve.ts coverageOf) measures a passage against the question's words. A section's heading and
 * writing instruction («اكتب التحليل مميزًا بين النص الأصلي والاستنتاج…») are not the matter asked about, so a question
 * built only from them finds no passage relevant (measured: data/knowledge/reports/acceptance.md, part D). The matter
 * of the request — its details and the free-text answers of its intake form — is what a basis must cover. It is used
 * for local retrieval only (it never leaves the server), masked for personal data and bounded in length.
 */
export function matterOf(req: { details?: string | null; intake?: Record<string, unknown> | null }, mask: (s: string) => string, max = 500): string {
  const parts: string[] = [];
  if (req.details) parts.push(req.details);
  for (const v of Object.values(req.intake ?? {})) {
    if (typeof v === "string" && v.trim().length >= 12 && /[؀-ۿ]/.test(v)) parts.push(v);
  }
  return mask(parts.join(" ").replace(/\s+/g, " ").trim()).slice(0, max);
}

/** The matter when the request has one, with the writer's own query; otherwise the service, section and instruction. */
export function sectionQuestion(o: { serviceName: string; sectionTitle: string; instruction?: string | null; query?: string | null; matter?: string | null }): string {
  if (o.matter && o.matter.length >= 12) return `${o.matter} ${o.query ?? ""}`.trim();
  return `${o.serviceName} ${o.sectionTitle} ${o.instruction ?? ""} ${o.query ?? ""}`.replace(/\s+/g, " ").trim();
}
