/**
 * Citation policy of the unified knowledge engine (PURE, unit-tested). One place decides whether a retrieved passage may
 * be cited, applies to the service and the date, and how it must be labelled. engine-core and any other caller get
 * passages only through retrieve() (knowledge/retrieve.ts), which applies this policy: there is no second route.
 *
 * Rules:
 *  1. A registry instrument (statute, regulation, official instruction) is citable only when the reference engine's
 *     guard (references/citation.ts) authorises the exact article or paragraph: in force on the date, stored from an
 *     official host, compared, and the comparison accepted by an authorised person.
 *  2. Any other source (book, study, guide, standard, dataset) is citable only after an accepted human review of that
 *     source (kb_source_reviews) and when its extracted text is of good quality. It is cited with its own kind; it is
 *     never presented as a binding text.
 *  3. A source not linked to the service is not applicable and is not returned as a basis.
 *  4. A source superseded or repealed before the date is not used for a current question (historical questions only).
 *  5. When nothing citable remains, the answer is «insufficient references» — the caller must not generate.
 */
import type { CitationResult } from "@/server/references/citation";

export const REF_KINDS = [
  "statute", "regulation", "official_instruction", "official_guide", "professional_standard", "classical_fiqh",
  "contemporary_book", "academic_study", "statistical_source", "dataset", "unclassified",
] as const;
export type RefKind = (typeof REF_KINDS)[number];

export const KIND_AR: Record<RefKind, string> = {
  statute: "نظام",
  regulation: "لائحة",
  official_instruction: "قرار أو تعليمات رسمية",
  official_guide: "دليل رسمي إرشادي",
  professional_standard: "معيار مهني",
  classical_fiqh: "كتاب فقهي أصلي",
  contemporary_book: "كتاب معاصر (مرجع مساعد)",
  academic_study: "دراسة أكاديمية",
  statistical_source: "مصدر إحصائي",
  dataset: "بيانات",
  unclassified: "غير مصنف",
};

/** Kinds whose text binds by itself. Everything else is guidance, scholarship, professional practice or data. */
export const BINDING_KINDS: ReadonlySet<RefKind> = new Set(["statute", "regulation", "official_instruction"]);

export type Hit = {
  chunkId: string;
  refCode: string;
  refKind: RefKind;
  registryId: string | null;
  version: string;
  title: string;
  locator: string;
  articleNo: number | null;
  paragraphNo: number | null;
  pageFile: number | null;
  pagePrinted: string | null;
  text: string;
  quality: string;
  services: string[];
  publishedOn: string | null;
  effectiveOn: string | null;
  repealedOn: string | null;
  superseded: boolean;
  score: number;
};

export type Refusal =
  | "not_applicable" // not linked to the service
  | "out_of_date" // superseded or repealed on the date
  | "not_yet_effective"
  | "registry_refused" // the reference guard refused (detail says why)
  | "not_reviewed" // non-registry source without an accepted review
  | "review_rejected"
  | "degraded_text" // extracted text unreliable (OCR or reordered letters)
  | "unclassified"; // kind unknown: never cited

export const REFUSAL_AR: Record<Refusal, string> = {
  not_applicable: "المرجع غير مربوط بهذه الخدمة",
  out_of_date: "النص منسوخ أو ملغى أو حلت محله نسخة أحدث في التاريخ المطلوب",
  not_yet_effective: "النص لم يكن نافذًا في التاريخ المطلوب",
  registry_refused: "حارس الاستشهاد رفض المادة",
  not_reviewed: "المرجع لم يراجعه مختص ولم يُعتمد للاستشهاد",
  review_rejected: "المراجعة البشرية رفضت المرجع",
  degraded_text: "النص المستخرج غير موثوق (OCR أو خلل ترتيب الحروف)",
  unclassified: "نوع المرجع غير محدد",
};

export type Decision = { citable: true; label: string; binding: boolean } | { citable: false; refusal: Refusal; detail: string };

export type SourceReview = { decision: "accepted" | "rejected"; at: string };

/** A label that states the source's nature next to every citation. */
export function citationLabel(h: Pick<Hit, "refKind" | "title" | "locator" | "version">): string {
  return `${KIND_AR[h.refKind]}: ${h.title} — ${h.locator} (${h.version})`;
}

export function decide(
  h: Hit,
  ctx: { service: string | null; asOf: string; historical?: boolean },
  evidence: { registry?: CitationResult | null; reviews?: SourceReview[] },
): Decision {
  if (ctx.service && !h.services.includes(ctx.service)) return { citable: false, refusal: "not_applicable", detail: `${h.refCode} غير مربوط بالخدمة ${ctx.service}` };
  if (!ctx.historical) {
    if (h.superseded) return { citable: false, refusal: "out_of_date", detail: `${h.refCode} ${h.version}: نسخة سابقة` };
    if (h.repealedOn && h.repealedOn <= ctx.asOf) return { citable: false, refusal: "out_of_date", detail: `${h.refCode}: لم يعد ساريًا منذ ${h.repealedOn}` };
  }
  if (h.effectiveOn && h.effectiveOn > ctx.asOf) return { citable: false, refusal: "not_yet_effective", detail: `${h.refCode}: يسري من ${h.effectiveOn}` };
  if (h.refKind === "unclassified") return { citable: false, refusal: "unclassified", detail: h.refCode };
  if (BINDING_KINDS.has(h.refKind) || h.registryId) {
    const r = evidence.registry;
    if (!r) return { citable: false, refusal: "registry_refused", detail: `${h.refCode}: لا قرار من حارس الاستشهاد (المادة غير محددة أو المرجع غير مسجل)` };
    if (!r.ok) return { citable: false, refusal: "registry_refused", detail: r.detail };
    return { citable: true, label: citationLabel(h), binding: BINDING_KINDS.has(h.refKind) };
  }
  if (h.quality !== "good") return { citable: false, refusal: "degraded_text", detail: `${h.refCode}: جودة النص «${h.quality}»` };
  const latest = [...(evidence.reviews ?? [])].sort((a, b) => b.at.localeCompare(a.at))[0];
  if (!latest) return { citable: false, refusal: "not_reviewed", detail: h.refCode };
  if (latest.decision !== "accepted") return { citable: false, refusal: "review_rejected", detail: h.refCode };
  return { citable: true, label: citationLabel(h), binding: false };
}

export type Sufficiency = { sufficient: true } | { sufficient: false; reason: string };

/** Enough to answer: at least one citable passage, and a binding one when the question needs a binding basis. */
export function sufficiency(decided: { hit: Hit; decision: Decision }[], need: { binding: boolean }): Sufficiency {
  const ok = decided.filter((d) => d.decision.citable);
  if (!ok.length) {
    const why = [...new Set(decided.filter((d) => !d.decision.citable).map((d) => REFUSAL_AR[(d.decision as { refusal: Refusal }).refusal]))];
    return { sufficient: false, reason: decided.length ? `المراجع غير كافية: لا مقطع قابل للاستشهاد (${why.join("؛ ")}).` : "المراجع غير كافية: لم يُعثر على نص ذي صلة في قاعدة المعرفة." };
  }
  if (need.binding && !ok.some((d) => d.decision.citable && d.decision.binding)) return { sufficient: false, reason: "المراجع غير كافية: لا نص نظامي ملزم قابل للاستشهاد؛ المراجع الإرشادية أو العلمية لا تقوم مقامه." };
  return { sufficient: true };
}
