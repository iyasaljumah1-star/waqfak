/**
 * Reference registry types. A reference is an official text (statute, regulation, decision, guide, professional
 * standard, fiqh source). Every stated fact about it carries the evidence it was read from; a fact without evidence is
 * recorded as unknown with the reason, never guessed.
 */

/** Kind of instrument. Binding force is a separate field: a «guide» is never binding even if issued by the authority. */
export type RefKind =
  | "statute" // نظام
  | "regulation" // لائحة / قواعد / ضوابط / معايير صادرة بقرار
  | "decision" // قرار أو تعميم رسمي
  | "guide" // دليل إرشادي
  | "professional_standard" // معيار مهني
  | "fiqh"; // مرجع فقهي

export type BindingLevel = "binding" | "guidance" | "professional" | "fiqh";

/** Validity of an instrument at a given date. */
export type RefStatus =
  | "in_force" // ساري
  | "in_force_amended" // ساري بتعديلاته
  | "not_yet_in_force" // صادر ولم يبدأ العمل به
  | "repealed" // ملغى أو حل محله غيره
  | "historical" // إصدار سابق محفوظ للأثر التاريخي
  | "draft" // مشروع لم يثبت اعتماده
  | "unknown"; // لم تثبت حالته من مصدر رسمي

/** Official hosts the fetcher may treat as an official source. Anything else is secondary at best. */
export const OFFICIAL_HOSTS = [
  "www.uqn.gov.sa", // جريدة أم القرى
  "uqn.gov.sa",
  "laws.boe.gov.sa", // هيئة الخبراء بمجلس الوزراء
  "awqaf.gov.sa", // الهيئة العامة للأوقاف
  "www.awqaf.gov.sa",
  "digitalcms.awqaf.gov.sa",
  "socpa.org.sa", // الهيئة السعودية للمراجعين والمحاسبين
  "cma.gov.sa", // هيئة السوق المالية
  "www.cma.gov.sa",
] as const;

export type Evidence = {
  /** The page or file the fact was read from. */
  url: string;
  /** Short verbatim quote, or a locator in the source («سطر التاريخ تحت العنوان»). */
  quote: string;
  retrievedAt: string; // ISO date-time
};

export type Fact<T> =
  | { value: T; evidence: Evidence[]; note?: string }
  | { value: null; unknownReason: string; evidence?: Evidence[] };

/** How a source text reached the platform. */
export type RetrievalVia =
  | "direct_http" // fetched by the platform's own fetcher from an official host
  | "relay_scrape" // fetched from an official host by a scraping relay and stored as a snapshot
  | "manual_upload"; // supplied by a person; never official by itself

/** Why a retrieval failed. */
export type FetchFailureKind =
  | "link" // unreachable, timed out, HTTP error, moved
  | "access_blocked" // reachable but refused (403/451, network policy)
  | "file" // wrong type, too large, PDF text layer unusable
  | "extraction" // page reached but the legal text could not be isolated
  | "no_official_publication"; // searched official sources, no publication found

export type FetchAttempt = {
  refId: string;
  url: string;
  at: string;
  ok: boolean;
  via: RetrievalVia;
  failure?: { kind: FetchFailureKind; detail: string };
};

/** One extracted unit of a version: an article, a paragraph or an item, with its stable locator. */
export type RefUnit = {
  /** e.g. «م8», «م8/ف2», «م8/ف2/ب». */
  locator: string;
  article: number;
  paragraph: number | null;
  item: string | null;
  heading: string | null;
  text: string;
};

/** Result classes of a comparison between the official text and a knowledge-base copy (order = severity). */
export type MatchOutcome =
  | "identical" // 1 مطابق
  | "editorial_only" // 2 مطابق مع اختلافات تحريرية لا تؤثر في المعنى
  | "substantive_difference" // 3 اختلاف مؤثر في المعنى (أو مفترض التأثير حتى المراجعة)
  | "extraction_defective" // 4 استخراج غير مكتمل أو مشوه
  | "unverifiable" // 5 تعذر التحقق
  | "repealed_or_superseded"; // 6 نسخة ملغاة أو مستبدلة

export const OUTCOME_LABEL_AR: Record<MatchOutcome, string> = {
  identical: "مطابق",
  editorial_only: "مطابق مع اختلافات تحريرية لا تؤثر في المعنى",
  substantive_difference: "اختلاف مؤثر في المعنى",
  extraction_defective: "استخراج غير مكتمل أو مشوه",
  unverifiable: "تعذر التحقق",
  repealed_or_superseded: "نسخة ملغاة أو مستبدلة",
};

/** Outcomes that allow a unit to be cited (after human review of the run). */
export const CITABLE_OUTCOMES: ReadonlySet<MatchOutcome> = new Set(["identical", "editorial_only"]);
