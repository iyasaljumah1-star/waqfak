/**
 * What may be sent to a language model (PURE, unit-tested). Owner's order of 2026-11-01: no customer document and no
 * real waqf data reaches a model until the privacy review is done and the owner approves it explicitly (flag
 * «engine.llm_real_data», off). Until then only synthetic data — a demonstration waqf (waqfs.is_demo) — may be sent.
 * A request without a waqf is treated as real data. Whatever is sent is masked of identifiers first (maskFacts).
 */
export type DataClass = "synthetic" | "real";

export function dataClassOf(p: { waqfIsDemo: boolean | null | undefined; hasWaqf: boolean }): DataClass {
  return p.hasWaqf && p.waqfIsDemo === true ? "synthetic" : "real";
}

export function modelAllowed(p: { dataClass: DataClass; realDataFlag: boolean; providerId: string }): { ok: boolean; reason: string } {
  if (p.providerId === "disabled") return { ok: false, reason: "لا نموذج لغوي مفعّل في هذه البيئة." };
  if (p.dataClass === "real" && !p.realDataFlag) return { ok: false, reason: "معالجة البيانات الحقيقية بالنموذج اللغوي غير مفعّلة (بانتظار فحص الخصوصية وموافقة المالك)." };
  return { ok: true, reason: "" };
}

const ID_LIKE = /\b\d{10}\b|\b\d{4,}\b/g;
const PHONE = /(\+?966|0)5\d{8}/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const IBAN = /\bSA\d{2}[0-9A-Z]{18,22}\b/gi;

/** Masks identifiers in every string of the facts (phone, e-mail, IBAN, identity and other long numbers). */
export function maskFacts<T>(v: T): T {
  if (typeof v === "string") return v.replace(EMAIL, "[بريد]").replace(IBAN, "[آيبان]").replace(PHONE, "[جوال]").replace(ID_LIKE, "[رقم]") as T;
  if (Array.isArray(v)) return v.map(maskFacts) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, maskFacts(x)])) as T;
  return v;
}
