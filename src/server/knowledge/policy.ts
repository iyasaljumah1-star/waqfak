/**
 * Citation policy of the unified knowledge engine (PURE, unit-tested). One place decides whether a retrieved passage may
 * be cited, applies to the service and the date, is relevant to the question, and how it must be labelled. engine-core
 * and any other caller get passages only through retrieve() (knowledge/retrieve.ts), which applies this policy.
 *
 * Rules:
 *  1. A registry instrument (statute, regulation, official instruction) is citable only when the reference engine's
 *     guard (references/citation.ts) authorises the exact article or paragraph — in force on the date, stored from an
 *     official host, compared, the comparison accepted by an authorised person — AND the knowledge-base passage holds
 *     that same text. What is cited is the guard's text, never the passage's own copy.
 *  2. Any other source (book, study, guide, standard, dataset) is citable only after an accepted review of the source by
 *     a reviewer of the field its kind requires; a passage taken from a file's text layer additionally needs an accepted
 *     review of that passage (compared with its page); a passage obtained by OCR is never cited. It is cited with its own
 *     kind; it is never presented as binding.
 *  3. A source not linked to the service is not applicable. A passage that does not cover the question is not relevant.
 *  4. A source superseded or repealed before the date is not used for a current question; for a historical question
 *     it is labelled as an earlier version.
 *  5. A question on the position of the Hanbali school is answered only from classical Hanbali books: a contemporary
 *     book or a study is not a source for attributing a view to the school.
 *  6. A passage blocked by a specialist's finding (e.g. a page shown to contradict the school) is never cited.
 *  7. When nothing citable remains, the answer is «insufficient references» — the caller must not generate.
 *  8. A historical question is answered from the version in force on the date asked, known by its own effective date;
 *     a version whose validity dates are unknown is not used for a historical question. An earlier version is labelled
 *     with the dates it was in force.
 *  9. A contemporary book is an auxiliary reference: it is never the sole basis of an answer.
 * 10. A registry instrument's citation shows only what the guard returned: its name, locator, version, heading and text.
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

export type ReviewRole = "sharia" | "accounting" | "legal" | "data" | "investment";
/** The field a source's reviewer must belong to, unless the catalog names one for the source. */
export const DEFAULT_REVIEW_ROLE: Record<RefKind, ReviewRole> = {
  statute: "legal", regulation: "legal", official_instruction: "legal", official_guide: "legal", professional_standard: "accounting",
  classical_fiqh: "sharia", contemporary_book: "sharia", academic_study: "legal", statistical_source: "data", dataset: "data", unclassified: "legal",
};

/** Share of the question's content words a passage must contain to count as relevant (the assistant uses 0.5). */
export const MIN_COVERAGE = 0.5;

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
  textOrigin: string;
  quality: string;
  services: string[];
  publishedOn: string | null;
  effectiveOn: string | null;
  repealedOn: string | null;
  superseded: boolean;
  /** For a historical question: the version's validity, from its own effective date and the next version's. */
  validFrom?: string | null;
  validTo?: string | null;
  validity?: "in_force" | "earlier" | "later" | "unknown";
  /** Where the text passed on comes from: the citation guard's authorised unit, or the knowledge base's own passage. */
  provenance?: "guard" | "passage";
  /** Blocked by a specialist's finding recorded in the catalog. */
  blocked: boolean;
  reviewRole: ReviewRole;
  /** Share of the question's content words found in the passage (1 for an article named in the question). */
  coverage: number;
  score: number;
};

export type Refusal =
  | "not_applicable"
  | "not_relevant"
  | "out_of_date"
  | "not_yet_effective"
  | "registry_refused"
  | "text_mismatch" // knowledge-base passage differs from the text the guard authorised
  | "blocked_passage"
  | "not_school_source"
  | "ocr_text"
  | "degraded_text"
  | "not_reviewed"
  | "passage_not_reviewed"
  | "review_rejected"
  | "unknown_validity"
  | "unclassified";

export const REFUSAL_AR: Record<Refusal, string> = {
  not_applicable: "المرجع غير مربوط بهذه الخدمة",
  not_relevant: "المقطع لا يغطي السؤال",
  out_of_date: "النص منسوخ أو ملغى أو حلت محله نسخة أحدث في التاريخ المطلوب",
  not_yet_effective: "النص لم يكن نافذًا في التاريخ المطلوب",
  registry_refused: "حارس الاستشهاد رفض المادة",
  text_mismatch: "نص المقطع في قاعدة المعرفة لا يطابق النص الرسمي المعتمد",
  blocked_passage: "المقطع محجوب بملاحظة مختص (ثبت خطؤه)",
  not_school_source: "الكتاب المعاصر أو الدراسة ليس مصدرًا لنسبة قول إلى المذهب",
  ocr_text: "النص بالتعرف الضوئي لا يُستشهد به",
  degraded_text: "النص المستخرج غير موثوق",
  not_reviewed: "المرجع لم يراجعه مختص من مجاله ولم يُعتمد للاستشهاد",
  passage_not_reviewed: "المقطع مستخرج من الملف ولم يُقابل بصفحته",
  review_rejected: "المراجعة البشرية رفضت المرجع أو المقطع",
  unknown_validity: "تاريخ سريان هذه النسخة غير معروف، فلا يُعرف النص النافذ في التاريخ المطلوب",
  unclassified: "نوع المرجع غير محدد",
};

export type Decision = { citable: true; label: string; binding: boolean } | { citable: false; refusal: Refusal; detail: string };

export type SourceReview = { decision: "accepted" | "rejected"; at: string; role: ReviewRole; chunkId: string | null };

const no = (refusal: Refusal, detail: string): Decision => ({ citable: false, refusal, detail });

/** A label that states the source's nature next to every citation. */
export function citationLabel(h: Pick<Hit, "refKind" | "title" | "locator" | "version" | "superseded"> & Partial<Pick<Hit, "validFrom" | "validTo">>, historical = false): string {
  const base = `${KIND_AR[h.refKind]}: ${h.title} — ${h.locator} (${h.version})`;
  if (historical && h.validFrom) return `${base} — ${h.validTo ? `نسخة سابقة، سارية من ${h.validFrom} إلى ${h.validTo}` : `سارية من ${h.validFrom}`}`;
  return `${base}${h.superseded ? " — نسخة سابقة" : ""}`;
}

/** A question asking for the position of the Hanbali school. */
export const SCHOOL_QUESTION = /المذهب|الحنابلة|الحنبلي|عند أحمد|الإمام أحمد|مذهب أحمد/;

export type DecideContext = { service: string; asOf: string; historical?: boolean; schoolQuestion?: boolean };
export type DecideEvidence = { registry?: CitationResult | null; registryTextMatches?: boolean; reviews?: SourceReview[] };

export function decide(h: Hit, ctx: DecideContext, evidence: DecideEvidence): Decision {
  if (ctx.service !== "*" && !h.services.includes(ctx.service)) return no("not_applicable", `${h.refCode} غير مربوط بالخدمة ${ctx.service}`);
  if (!ctx.historical) {
    if (h.superseded) return no("out_of_date", `${h.refCode} ${h.version}: نسخة سابقة`);
    if (h.repealedOn && h.repealedOn <= ctx.asOf) return no("out_of_date", `${h.refCode}: لم يعد ساريًا منذ ${h.repealedOn}`);
  } else if (!h.registryId) {
    // a registry instrument's version on the date is chosen by the guard; any other source by its own dates (review B10)
    if (h.validity === "unknown" || !h.validity) return no("unknown_validity", `${h.refCode} ${h.version}`);
    if (h.validity === "earlier") return no("out_of_date", `${h.refCode} ${h.version}: انتهى سريانها في ${h.validTo}`);
    if (h.validity === "later") return no("not_yet_effective", `${h.refCode} ${h.version}: تسري من ${h.validFrom}`);
    if (h.repealedOn && h.repealedOn <= ctx.asOf) return no("out_of_date", `${h.refCode}: لم يعد ساريًا منذ ${h.repealedOn}`);
  }
  if (h.effectiveOn && h.effectiveOn > ctx.asOf) return no("not_yet_effective", `${h.refCode}: يسري من ${h.effectiveOn}`);
  if (h.coverage < MIN_COVERAGE) return no("not_relevant", `${h.refCode} ${h.locator}: يغطي ${Math.round(h.coverage * 100)}٪ من كلمات السؤال`);
  if (h.refKind === "unclassified") return no("unclassified", h.refCode);
  if (h.blocked) return no("blocked_passage", `${h.refCode} ${h.locator}`);
  if (BINDING_KINDS.has(h.refKind) || h.registryId) {
    const r = evidence.registry;
    if (!r) return no("registry_refused", `${h.refCode}: لا قرار من حارس الاستشهاد (المادة غير محددة أو المرجع غير مسجل)`);
    if (!r.ok) return no("registry_refused", r.detail);
    if (!evidence.registryTextMatches) return no("text_mismatch", `${h.refCode} ${h.locator}`);
    // a registry citation is made only from what the guard returned (rule 10)
    if (h.provenance !== "guard") return no("text_mismatch", `${h.refCode} ${h.locator}: النص ليس نص الحارس`);
    return { citable: true, label: citationLabel(h, !!ctx.historical), binding: BINDING_KINDS.has(h.refKind) };
  }
  if (ctx.schoolQuestion && h.refKind !== "classical_fiqh") return no("not_school_source", `${KIND_AR[h.refKind]}: ${h.refCode}`);
  if (h.textOrigin === "ocr") return no("ocr_text", `${h.refCode} ${h.locator}`);
  if (h.quality !== "good") return no("degraded_text", `${h.refCode}: جودة النص «${h.quality}»`);
  const mine = (evidence.reviews ?? []).filter((r) => r.role === h.reviewRole).sort((a, b) => b.at.localeCompare(a.at));
  const source = mine.filter((r) => r.chunkId === null)[0];
  if (!source) return no("not_reviewed", `${h.refCode} (مراجع ${h.reviewRole})`);
  if (source.decision !== "accepted") return no("review_rejected", h.refCode);
  if (h.textOrigin === "text_layer") {
    const passage = mine.filter((r) => r.chunkId === h.chunkId)[0];
    if (!passage) return no("passage_not_reviewed", `${h.refCode} ${h.locator}`);
    if (passage.decision !== "accepted") return no("review_rejected", `${h.refCode} ${h.locator}`);
  }
  return { citable: true, label: citationLabel(h, !!ctx.historical), binding: false };
}

export type Sufficiency = { sufficient: true } | { sufficient: false; reason: string };

/**
 * Enough to answer: at least one citable passage; a binding one when the question needs a binding basis; a classical
 * Hanbali one when it asks for the school's position. A question naming an article that does not exist is never
 * answered from other articles.
 */
export function sufficiency(decided: { hit: Hit; decision: Decision }[], need: { binding: boolean; school?: boolean; missingArticle?: string | null }): Sufficiency {
  if (need.missingArticle) return { sufficient: false, reason: `المراجع غير كافية: ${need.missingArticle} غير موجودة في النص المحفوظ.` };
  const ok = decided.filter((d) => d.decision.citable);
  if (!ok.length) {
    const why = [...new Set(decided.filter((d) => !d.decision.citable).map((d) => REFUSAL_AR[(d.decision as { refusal: Refusal }).refusal]))];
    return { sufficient: false, reason: decided.length ? `المراجع غير كافية: لا مقطع قابل للاستشهاد (${why.join("؛ ")}).` : "المراجع غير كافية: لم يُعثر على نص ذي صلة في قاعدة المعرفة." };
  }
  if (need.binding && !ok.some((d) => d.decision.citable && d.decision.binding)) return { sufficient: false, reason: "المراجع غير كافية: لا نص نظامي ملزم قابل للاستشهاد؛ المراجع الإرشادية أو العلمية لا تقوم مقامه." };
  if (need.school && !ok.some((d) => d.hit.refKind === "classical_fiqh")) return { sufficient: false, reason: "المراجع غير كافية: لا نص من كتب المذهب الحنبلي الأصلية قابل للاستشهاد." };
  // a contemporary book is an auxiliary reference: never the sole basis (rule 9, review B8)
  if (ok.every((d) => d.hit.refKind === "contemporary_book")) return { sufficient: false, reason: "المراجع غير كافية: الكتاب المعاصر مرجع مساعد لا يُستند إليه منفرداً." };
  return { sufficient: true };
}
