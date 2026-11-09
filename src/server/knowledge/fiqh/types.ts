/**
 * Fiqh research dossier (owner's order of 2026-11-07, §3, §7, §8). What the engine prepares for a sharia reviewer: the
 * matter, the facts and what is missing, the statements found with their nature, standing and source, the comparison,
 * and a preliminary weighing. A research recommendation — never a ruling, never a fatwa: only a qualified reviewer's
 * recorded review approves, modifies or rejects it.
 *
 * Every element says what it is (§8), so that nothing passes for what it is not:
 *  - «quote»: text taken verbatim from a source, with its locator (a flag says when it is OCR or unreviewed);
 *  - «author»: a contemporary author's explanation, summary or choice — never the school's text;
 *  - «engine»: the engine's own analysis (matching facts to conditions, grouping, weighing) — never a source.
 */
export const STAGES = ["research", "summary", "extraction", "comparison", "preliminary", "draft"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_AR: Record<Stage | "final", string> = {
  research: "بحث أولي",
  summary: "ملخص المسألة",
  extraction: "استخراج الأقوال والنصوص",
  comparison: "مقارنة فقهية",
  preliminary: "ترجيح مبدئي",
  draft: "مسودة مستند",
  final: "مستند نهائي معتمد بعد المراجعة",
};

export type FactStatus = "established" | "assumed";
export type Fact = { text: string; status: FactStatus };

/** A fact the matter turns on: given (by a fact of the request), assumed, or missing. */
export type Factor = { key: string; question: string; essential: boolean; status: "given" | "assumed" | "missing"; by?: string };

export type Issue = {
  question: string;
  /** The act asked about («استبدال», «استدانة»…), from the question's wording. */
  head: string | null;
  topic: string | null;
  subIssues: string[];
  factors: Factor[];
  /** What is asked: whether it is obligatory, or whether it is permitted (a «يجوز» does not answer «يجب»). */
  asks: "obligation" | "permission" | "unknown";
  /** Essential facts missing: no weighing until they are given (§3.1). */
  missing: string[];
  facts: Fact[];
  by: "engine";
};

/** Nature of a statement, as its source's wording shows it (§3.3). «unverified» when the wording does not tell. */
export type StatementKind =
  | "text" // the book's own statement (متن/شرح)
  | "nass" // نص صريح عن الإمام (نص عليه / منصوص)
  | "riwaya" // رواية
  | "wajh" // وجه
  | "qila" // قول آخر مصدَّر بـ«قيل»
  | "takhrij" // تخريج
  | "ikhtiyar" // اختيار لعالم مسمى
  | "ihtimal" // احتمال
  | "naql" // نقل عن كتاب أو عالم مسمى
  | "author_explanation" // شرح المؤلف المعاصر
  | "author_summary" // تلخيص المؤلف
  | "author_choice"; // اختيار المؤلف المعاصر
export const KIND_AR: Record<StatementKind, string> = {
  text: "نص الكتاب",
  nass: "نص صريح عن الإمام",
  riwaya: "رواية",
  wajh: "وجه",
  qila: "قول آخر (مصدَّر بـ«قيل»)",
  takhrij: "تخريج",
  ikhtiyar: "اختيار",
  ihtimal: "احتمال",
  naql: "نقل منسوب",
  author_explanation: "شرح المؤلف (كتاب معاصر)",
  author_summary: "تلخيص المؤلف (كتاب معاصر)",
  author_choice: "اختيار المؤلف (كتاب معاصر)",
};

/** Standing in the school, only as the source's wording states it (§3.3): never inferred from the book's fame. */
export type Rank = "mutamad" | "other" | "unverified";
export const RANK_AR: Record<Rank, string> = {
  mutamad: "المعتمد في المذهب — بنص الكتاب",
  other: "خلاف المعتمد بحسب نص الكتاب",
  unverified: "مرتبته غير متحققة من النص المتاح",
};

export type Polarity = "permit" | "prohibit" | "oblige" | "not_obliged" | "unknown";
export const POLARITY_AR: Record<Polarity, string> = { permit: "الجواز / الصحة", prohibit: "المنع / عدم الصحة", oblige: "الوجوب / اللزوم", not_obliged: "عدم الوجوب / عدم اللزوم", unknown: "لم يتبين الحكم من النص" };

/** One conjunct of a condition («إلا أن يشترطه الواقف ويأذن الحاكم»: two parts, joined by «و»). */
export type ConditionPart = { text: string; status: "met" | "unmet" | "unknown"; byFact?: string };
export type Condition = {
  text: string; kind: "condition" | "exception"; status: "met" | "unmet" | "unknown"; byFact?: string;
  /** Where it starts in the statement's bare text (to read the connector between two exceptions). */
  at?: number;
  /** Its parts and how they are joined, when the clause holds more than one («و»: all; «أو»: any). */
  parts?: ConditionPart[]; join?: "and" | "or";
};

/**
 * How a statement's exceptions combine (owner's order 2026-11-08, §3.2): one; alternatives («أو إلا»: any one met
 * reverses the ruling); cumulative («إلا أن A وB»: all must be met); or «unclear» — two «إلا» clauses with nothing in the
 * text saying how they relate (nested, repeated, or alternative): no ruling is drawn from it, and a human decides.
 */
export type ExceptionStructure = "none" | "single" | "alternative" | "cumulative" | "unclear";
export const EXCEPTION_AR: Record<ExceptionStructure, string> = {
  none: "لا استثناء", single: "استثناء واحد", alternative: "استثناءات بديلة (أيها تحقق)", cumulative: "استثناء مجتمع الأجزاء (لا بد من تحققها كلها)",
  unclear: "استثناءات لا يتبين من النص وجه اجتماعها — تُعرض على المراجع",
};

export type SourceRef = {
  chunkId: string;
  refCode: string;
  refKind: string;
  title: string;
  author: string | null;
  edition: string | null;
  /** As stored: «ج16 ص522», «ص 216 (الملف 216)». Never invented: what the passage's locator says. */
  locator: string;
  volume: string | null;
  page: string | null;
  topic: string | null;
  status: "approved" | "unreviewed" | "rejected" | "under_review";
  flags: string[];
};

export type Statement = {
  id: string;
  kind: StatementKind;
  rank: Rank;
  /** Verbatim span of the source (a «quote»), or the contemporary author's words (an «author» element). */
  text: string;
  element: "quote" | "author";
  attributedTo: string | null;
  polarity: Polarity;
  conditions: Condition[];
  /** What the conditions give on these facts: «applies», «does_not_apply» or «unknown» (engine's matching). */
  applies: "applies" | "does_not_apply" | "unknown";
  /** The polarity in force on these facts (an exception met reverses «لا … إلا أن …»). */
  effective: Polarity;
  exceptionStructure: ExceptionStructure;
  /** Why the reading gives no ruling, when the structure is not clear (a question, an unresolved reference, an unclear
   * combination of exceptions, contrary rulings in one clause). */
  unclear?: string;
  /** The text says the school holds the contrary of this view («والمذهب خلافه») — without stating the school's view. */
  schoolHoldsContrary?: boolean;
  /** The statement reports another school («وقال الشافعي…»، «وهو المذهب عند الشافعية»): never this school's view. */
  otherSchool?: string;
  source: SourceRef;
  /** Words of the text that gave the kind, rank and polarity (so that the reviewer can check the reading). */
  markers: string[];
};

export type Divergence = { a: string; b: string; nature: "real" | "in_condition" | "unverified"; note: string };

export type Comparison = {
  positions: { polarity: Polarity; statementIds: string[]; refCodes: string[] }[];
  agreements: string[];
  divergences: Divergence[];
  /** «الميسّر» set beside the original books: where it agrees, differs, or has no counterpart (§3.6). */
  contemporaryChecks: { statementId: string; outcome: "agrees" | "differs" | "no_original" | "attributes_school"; note: string }[];
  waqifCondition: string;
  by: "engine";
};

export type Weighing =
  | {
      status: "weighed";
      leaning: Polarity;
      statementIds: string[];
      reasons: string[];
      supporting: string[];
      others: { statementId: string; why: string }[];
      mutamad: string[];
      differsFromMutamad: boolean;
      unresolved: string[];
      confidence: "high" | "medium" | "low";
      uncertainty: string[];
      humanReview: string[];
      by: "engine";
    }
  | { status: "needs_facts" | "insufficient" | "unresolved"; reasons: string[]; unresolved: string[]; humanReview: string[]; by: "engine" };

/**
 * The regulatory track (owner's order 2026-11-08, §4), kept apart from the fiqh result: what the regulations and the
 * official guidance retrieved say, each with its standing — never used to prove the school's view, never dropped, and
 * never declared in agreement with the fiqh result where it differs.
 */
export type RegulatoryStanding = "binding" | "guidance" | "non_binding" | "explanation";
export const REG_STANDING_AR: Record<RegulatoryStanding, string> = {
  binding: "نص نظامي ملزم", guidance: "دليل أو تعليمات إرشادية رسمية", non_binding: "توجيه غير ملزم", explanation: "شرح أو إيضاح",
};
export type RegulatoryItem = { statementId: string; refCode: string; title: string; locator: string; standing: RegulatoryStanding; polarity: Polarity; applies: "applies" | "does_not_apply" | "unknown"; text: string };
export type RegulatoryTrack = {
  items: RegulatoryItem[];
  /** Each item against the fiqh leaning: no conflict seen, a conflict, or its effect not determinable. */
  relation: { statementId: string; outcome: "no_conflict_seen" | "conflict" | "undetermined"; note: string }[];
  /** The combined effect, in words: the fiqh result and the constraints together (never «اتفقت» across the two tracks). */
  combined: string[];
  legalReview: boolean;
  by: "engine";
};

export type FiqhDossier = {
  kind: "fiqh_dossier";
  engineVersion: string;
  stage: Stage;
  asOf: string;
  service: string;
  issue: Issue;
  sources: SourceRef[];
  statements: Statement[];
  comparison: Comparison | null;
  weighing: Weighing | null;
  regulatory: RegulatoryTrack | null;
  /** Fixed: what the dossier is and is not (§3.8). */
  standing: string;
  limits: string[];
};

export const DOSSIER_STANDING =
  "توصية بحثية مبدئية أعدّها المحرك لمساعدة المراجع الشرعي المختص، قابلة للمراجعة والتعديل والرفض. ليست فتوى ولا حكمًا شرعيًا نهائيًا، ولا تصير معتمدة إلا بمراجعة موثقة من مراجع مختص.";
