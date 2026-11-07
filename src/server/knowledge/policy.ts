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
 *  9. (Owner's order 2026-11-07, §4 — replaces the former «never the sole basis» rule.) A contemporary book («الميسّر»)
 *     may serve alone for internal drafts; it is never labelled binding nor as the school's view, and, like any source,
 *     it reaches a final document only through the human review of the passage used and of the reasoning.
 * 10. A registry instrument's citation shows only what the guard returned: its name, locator, version, heading and text.
 * 11. (B13, owner's order 2026-11-07, §5.) A review approves the passage it names, and only it: an accepted review of a
 *     source as a whole, or of another passage, approves no passage (it attests the source's identity and edition). A
 *     rejected review of the source as a whole withdraws all its passages. Each passage stands: unreviewed, under
 *     review, approved or rejected.
 *
 * Two tiers (owner's order 2026-11-07, §4, §5, §8): `decide` says whether a passage may be cited in a FINAL document
 * (human-reviewed); `draftUse` says whether it may be used in an internal DRAFT, with the flags its use must carry
 * (unreviewed, OCR, contemporary…). A draft never becomes final by itself: the server's final gate and the database
 * require the reviews (outputs/quality.ts, security.sql output_unreviewed_basis).
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
  provenance?: "guard" | "passage" | "stored_official";
  /** What the passage lacks of the question's qualifiers (a year, «غير X»): not relevant whatever the shared words. */
  lacking?: string[];
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
  | "auxiliary_alone"
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
  passage_not_reviewed: "المقطع المستخدم لم يراجعه مختص من مجاله (اعتماد المصدر جملةً أو مقطع آخر منه لا يعتمد هذا المقطع)",
  review_rejected: "المراجعة البشرية رفضت المرجع أو المقطع",
  auxiliary_alone: "مرجع مساعد (كتاب معاصر) لا يُستند إليه دون نص من كتب الفقه الأصلية",
  unknown_validity: "تاريخ سريان هذه النسخة غير معروف، فلا يُعرف النص النافذ في التاريخ المطلوب",
  unclassified: "نوع المرجع غير محدد",
};

export type Decision = { citable: true; label: string; binding: boolean } | { citable: false; refusal: Refusal; detail: string };

export type SourceReview = { decision: "accepted" | "rejected"; at: string; role: ReviewRole; chunkId: string | null };

const no = (refusal: Refusal, detail: string): Decision => ({ citable: false, refusal, detail });

/** A label that states the source's nature next to every citation. */
export function citationLabel(h: Pick<Hit, "refKind" | "title" | "locator" | "version" | "superseded"> & Partial<Pick<Hit, "validFrom" | "validTo" | "registryId" | "provenance">>, historical = false): string {
  const base = `${KIND_AR[h.refKind]}: ${h.title} — ${h.locator} (${h.version})`;
  // H2: a registered text always shows its validity — its end when on record, else that its end is unknown (never guessed)
  const registered = !!h.registryId && (h.provenance === "guard" || h.provenance === "stored_official");
  if ((historical || registered) && h.validFrom) {
    if (h.validTo) return `${base} — ${historical ? "نسخة سابقة، " : ""}سارية من ${h.validFrom} إلى ${h.validTo}`;
    return `${base} — سارية من ${h.validFrom}؛ تاريخ انتهاء السريان غير معلوم`;
  }
  if (registered && !h.validFrom) return `${base} — تاريخ بدء السريان وانتهائه غير معلومين`;
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
  } else if (h.registryId) {
    // a registry instrument repealed on or before the date is not cited for it, even historically (review H1)
    if (h.repealedOn && h.repealedOn <= ctx.asOf) return no("out_of_date", `${h.refCode}: لم يعد ساريًا منذ ${h.repealedOn}`);
  } else {
    // a registry instrument's version on the date is chosen by the guard; any other source by its own dates (review B10)
    if (h.validity === "unknown" || !h.validity) return no("unknown_validity", `${h.refCode} ${h.version}`);
    if (h.validity === "earlier") return no("out_of_date", `${h.refCode} ${h.version}: انتهى سريانها في ${h.validTo}`);
    if (h.validity === "later") return no("not_yet_effective", `${h.refCode} ${h.version}: تسري من ${h.validFrom}`);
    if (h.repealedOn && h.repealedOn <= ctx.asOf) return no("out_of_date", `${h.refCode}: لم يعد ساريًا منذ ${h.repealedOn}`);
  }
  if (h.effectiveOn && h.effectiveOn > ctx.asOf) return no("not_yet_effective", `${h.refCode}: يسري من ${h.effectiveOn}`);
  if (h.lacking?.length) return no("not_relevant", `${h.refCode} ${h.locator}: لا يتناول ${h.lacking.join("، ")} الوارد في السؤال (اشتراك الألفاظ لا يثبت الصلة)`);
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
  const st = passageStatus(h, evidence.reviews ?? []);
  if (st === "rejected") return no("review_rejected", `${h.refCode} ${h.locator}`);
  if (st !== "approved") return no("passage_not_reviewed", `${h.refCode} ${h.locator} (مراجع ${h.reviewRole})`);
  return { citable: true, label: citationLabel(h, !!ctx.historical), binding: false };
}

export type PassageStatus = "unreviewed" | "under_review" | "approved" | "rejected";
export const PASSAGE_STATUS_AR: Record<PassageStatus, string> = { unreviewed: "غير مراجع", under_review: "قيد المراجعة", approved: "مراجع ومعتمد", rejected: "مرفوض" };

/**
 * A passage's standing from the reviews of its field (B13): the latest review OF THIS PASSAGE decides; a later rejection
 * of the source as a whole withdraws it. An acceptance of the source as a whole approves no passage. («under review» is
 * the caller's to add: a passage used in a document or dossier awaiting its review.)
 */
export function passageStatus(h: Pick<Hit, "chunkId" | "reviewRole">, reviews: SourceReview[]): Exclude<PassageStatus, "under_review"> {
  const mine = reviews.filter((r) => r.role === h.reviewRole).sort((a, b) => b.at.localeCompare(a.at));
  const passage = mine.find((r) => r.chunkId === h.chunkId);
  const sourceRejection = mine.find((r) => r.chunkId === null && r.decision === "rejected");
  if (sourceRejection && (!passage || sourceRejection.at >= passage.at)) return "rejected";
  if (!passage) return "unreviewed";
  return passage.decision === "accepted" ? "approved" : "rejected";
}

/** Why a passage is used in a draft with a warning: each flag is shown next to its use. */
export type DraftFlag = "unreviewed" | "ocr" | "degraded" | "contemporary" | "not_school_attribution" | "registry_unconfirmed" | "earlier_version";
export const DRAFT_FLAG_AR: Record<DraftFlag, string> = {
  unreviewed: "مقطع غير مراجع: يلزم مراجعته قبل أي مستند نهائي",
  ocr: "نص مستخرج آليًا بالتعرف الضوئي: قد يحتوي أخطاء، ولا يُعامل نقلًا محققًا",
  degraded: "نص الملف معيب الاستخراج: لا يُعامل نقلًا محققًا",
  contemporary: "كتاب معاصر: شرح المؤلف وتلخيصه، لا نص المذهب",
  not_school_attribution: "لا يُنسب منه قول إلى المذهب الحنبلي",
  registry_unconfirmed: "النص الرسمي المحفوظ؛ مطابقته لم تُعتمد بعد من مراجع نظامي",
  earlier_version: "نسخة سابقة",
};
export type DraftUse = { usable: true; status: Exclude<PassageStatus, "under_review">; flags: DraftFlag[]; label: string } | { usable: false; refusal: Refusal; detail: string };

/**
 * Whether a passage may serve an internal draft (owner's order 2026-11-07, §4–§5): applicable to the service, in force on
 * the date, relevant, not blocked by a specialist's finding, not rejected by a review — reviewed or not. A registry
 * instrument is used only from its stored official text (the guard's version), even before its comparison is accepted.
 */
export function draftUse(h: Hit, ctx: DecideContext, evidence: DecideEvidence & { registryDraftText?: boolean }): DraftUse {
  const final = decide(h, ctx, evidence);
  const status = BINDING_KINDS.has(h.refKind) || h.registryId ? (final.citable ? "approved" : "unreviewed") : passageStatus(h, evidence.reviews ?? []);
  const flags: DraftFlag[] = [];
  if (!final.citable) {
    const r = final.refusal;
    // what stops a final citation but not a draft's use (with its flag)
    const draftable: Refusal[] = ["passage_not_reviewed", "not_reviewed", "ocr_text", "degraded_text", "not_school_source", "registry_refused", "text_mismatch"];
    const notUsable: DraftUse = { usable: false, refusal: r, detail: final.detail };
    if (!draftable.includes(r)) return notUsable;
    if (r === "registry_refused" || r === "text_mismatch") {
      if (!evidence.registryDraftText) return notUsable;
      flags.push("registry_unconfirmed");
    }
  }
  if (status === "rejected") return { usable: false, refusal: "review_rejected", detail: `${h.refCode} ${h.locator}` };
  if (status !== "approved") flags.push("unreviewed");
  if (h.textOrigin === "ocr") flags.push("ocr");
  if (h.quality !== "good") flags.push("degraded");
  if (h.refKind === "contemporary_book") flags.push("contemporary");
  if (ctx.schoolQuestion && h.refKind !== "classical_fiqh" && !BINDING_KINDS.has(h.refKind)) flags.push("not_school_attribution");
  if (h.superseded || h.validity === "earlier") flags.push("earlier_version");
  return { usable: true, status, flags: [...new Set(flags)], label: citationLabel(h, !!ctx.historical) };
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
  return { sufficient: true };
}

/**
 * Enough for an internal draft: at least one usable passage; a binding one (its stored official text) when the section
 * states what the rules require. A school question with no classical book is still drafted — every use flagged «لا يُنسب
 * منه قول إلى المذهب» (owner's order 2026-11-07, §4.6).
 */
export function draftSufficiency(decided: { hit: Hit; draft: DraftUse }[], need: { binding: boolean; missingArticle?: string | null }): Sufficiency {
  if (need.missingArticle) return { sufficient: false, reason: `المراجع غير كافية: ${need.missingArticle} غير موجودة في النص المحفوظ.` };
  const ok = decided.filter((d) => d.draft.usable);
  if (!ok.length) {
    const why = [...new Set(decided.filter((d) => !d.draft.usable).map((d) => REFUSAL_AR[(d.draft as { refusal: Refusal }).refusal]))];
    return { sufficient: false, reason: decided.length ? `المراجع غير كافية حتى للمسودة: لا مقطع صالح (${why.join("؛ ")}).` : "المراجع غير كافية: لم يُعثر على نص ذي صلة في قاعدة المعرفة." };
  }
  if (need.binding && !ok.some((d) => BINDING_KINDS.has(d.hit.refKind))) return { sufficient: false, reason: "المراجع غير كافية حتى للمسودة: لا نص نظامي ملزم محفوظ من مصدره الرسمي؛ المراجع الإرشادية أو العلمية لا تقوم مقامه." };
  return { sufficient: true };
}
