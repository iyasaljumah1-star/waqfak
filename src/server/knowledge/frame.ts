/**
 * What a question asks — read once, before retrieval, and used to judge every passage (owner's order of 2026-11-09,
 * «سابعاً» — N9-10). Each part has a reason the reviewer can read; a passage is matched against the PARTS of the
 * question, not against its words alone:
 *
 *  - the answer it asks for: a ruling, an obligation or a permission, a period, a penalty, a quantity or a rate, a date;
 *  - its focus: the thing counted or measured («عدد الإبل»: the camels), or the act ruled on;
 *  - the senses of ambiguous words, from their context: «قيد» registration or restriction, «أجر» reward or fee;
 *  - the places it names, from a gazetteer of the Kingdom's regions and seats and of countries (Arabic and English
 *    names), matched as whole words with their clitics — never inside another word («الرياض» is not in «الرياضية»);
 *  - its dates: absolute years (all of them, for a comparison) and any relative date («هذا العام»، «العام الماضي»،
 *    «قبل عشر سنوات»), which no passage can be matched to without guessing;
 *  - identifiers: a standard and its number («FAS 38», «المعيار 9»), an article («م8»).
 *
 * What each passage then lacks is named (lacking), what it only partly answers is flagged (partial), and whether it
 * answers the question or only gives context (answers) is said — so that a source shown is never presented as
 * supporting a result it does not support.
 */
import { normForSearch } from "@/server/engine/knowledge/pure";
import { tokenize } from "@/server/modules/ai/text";

/** Beyond this many content words a question is a request's text (retrieve.ts LONG_QUESTION). */
const LONG = 25;
const digits = (s: string) => s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

export type AnswerType = "ruling" | "obligation" | "permission" | "period" | "penalty" | "quantity" | "rate" | "date" | "reward" | "open";
export type Place = { key: string; ar: string[]; en: string[] };

/** The Kingdom (named in many ways), its regions and seats, and countries a question may name instead. */
const GAZETTEER: Place[] = [
  { key: "KSA", ar: ["المملكه", "السعوديه", "المملكه العربيه السعوديه"], en: ["saudi", "kingdom", "ksa"] },
  ...([
    ["الرياض", "riyadh"], ["مكه", "makkah|mecca"], ["المدينه المنوره", "madinah|medina"], ["القصيم", "qassim"], ["بريده", "buraydah"], ["الشرقيه", "eastern province"],
    ["الدمام", "dammam"], ["عسير", "asir"], ["ابها", "abha"], ["تبوك", "tabuk"], ["حائل|حايل", "hail|ha'il"], ["الحدود الشماليه", "northern borders"], ["عرعر", "arar"],
    ["جازان|جيزان", "jazan|jizan"], ["نجران", "najran"], ["الباحه", "baha|al-baha"], ["الجوف", "jouf|al-jouf"], ["سكاكا", "sakaka"], ["جده", "jeddah"], ["الطائف|الطايف", "taif"],
    ["الاحساء", "ahsa|al-ahsa"], ["الكويت", "kuwait"], ["الامارات", "emirates|uae"], ["قطر", "qatar"], ["البحرين", "bahrain"], ["عمان|سلطنه عمان", "oman"], ["اليمن", "yemen"],
    ["العراق", "iraq"], ["الاردن", "jordan"], ["مصر", "egypt"], ["سوريا", "syria"], ["لبنان", "lebanon"], ["المغرب", "morocco"], ["الجزائر", "algeria"], ["تونس", "tunisia"],
    ["ليبيا", "libya"], ["السودان", "sudan"], ["تركيا", "turkey|türkiye"], ["ايران", "iran"], ["باكستان", "pakistan"], ["ماليزيا", "malaysia"], ["اندونيسيا", "indonesia"],
    ["بريطانيا|المملكه المتحده", "britain|united kingdom|uk"], ["امريكا|الولايات المتحده", "united states|usa|america"],
  ] as const).map(([ar, en]) => ({ key: ar.split("|")[0]!, ar: ar.split("|"), en: en.split("|") })),
];
/** A name as a whole word, with the clitics Arabic attaches (و، ف، ب، ل، ال، في …). */
const arWord = (n: string) => new RegExp(`(?:^|[^ء-ي])(?:[وفبل]?(?:ال)?)${n.replace(/^ال/, "")}(?![ء-ي])`);
const enWord = (n: string) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");

export function placesIn(text: string): Place[] {
  const t = normForSearch(text);
  return GAZETTEER.filter((p) => p.ar.some((n) => arWord(normForSearch(n)).test(t)) || p.en.some((n) => enWord(n).test(text)));
}

export type Frame = {
  answer: AnswerType;
  focus: string[];
  senses: { qayd?: "registration" | "restriction"; ajr?: "reward" | "fee" | "ambiguous" };
  places: Place[];
  years: string[];
  relativeDate: string | null;
  identifiers: { kind: string; number: string }[];
  why: string[];
};

const MEASURE = /(?:^|\s)(?:كم\s+)?(?:عدد|نسبه|معدل|اجمالي|حجم|قيمه|متوسط|وسيط|الوسيط|مقدار|مجموع)(?:\s+(?:ال)?(?:العمري|الاجمالي|الكلي))?\s+((?:[ء-ي]+\s+){0,1}[ء-ي]+)/;

export function frameOf(question: string): Frame {
  const raw = digits(question);
  const q = normForSearch(raw);
  const why: string[] = [];
  // the answer asked for
  let answer: AnswerType = "open";
  // whole words only («الحاكم» holds «كم», «تعطلت» holds «عطل»)
  const w = (re: string) => new RegExp(`(?:^|\\s)(?:[وفبل]?(?:ال)?)(?:${re})(?=\\s|$)`).test(q);
  if (w("عقوب\\S*|غرام\\S*|جزاء\\S*|يعاقب\\S*")) answer = "penalty";
  else if (/(?:خلال|في)\s+كم\s+(?:يوم|شهر|سنه|اسبوع)|ما\s+(?:هي\s+)?المده|مهله|كم\s+يوم|كم\s+شهر|متي\s+ينتهي/.test(q)) answer = "period";
  else if (w("ثواب\\S*") || /عند الله/.test(q)) answer = "reward";
  else if (w("نسبه|معدل")) answer = "rate";
  else if (w("كم|عدد|اجمالي|مقدار|حجم")) answer = "quantity";
  else if (/متي|تاريخ\s+(?:سريان|نفاذ|صدور|بدء)/.test(q)) answer = "date";
  else if (/(?:^|\s)(?:هل\s+)?(?:يجب|يلزم|تجب|تلزم|يتعين)(?=\s)/.test(q)) answer = "obligation";
  else if (/حكم/.test(q)) answer = "ruling";
  else if (/يجوز|تجوز|يصح|تصح|يحق|يحل/.test(q)) answer = "permission";
  if (answer !== "open") why.push(`نوع الجواب المطلوب: ${ANSWER_AR[answer]}`);
  // the focus of a measure: what is counted or measured
  const m = q.match(MEASURE);
  const focus = m ? tokenize(m[1]!).slice(0, 1) : [];
  if (focus.length) why.push(`المقيس: «${m![1]}»`);
  // senses
  const senses: Frame["senses"] = {};
  if (/(?:^|\s)(?:قيد|القيد|قيود|القيود)(?=\s|$)/.test(q)) {
    // «قيد الوقف لدى الهيئة»: registration; «قيد جواز البيع»، «قيود التصرف»: a restriction
    senses.qayd = /قيود|القيود|قيد\s+(?:جواز|الجواز|على|علي|في التصرف|التصرف|البيع|بيع|الاستبدال|صحه|لزوم|وجوب)/.test(q) ? "restriction"
      : /قيد\s+(?:ال)?(?:وقف|اصول|اعيان|عقار|اوقاف)|(?:لدي|عند|في)\s+(?:ال)?(?:هيئه|سجل)|مهله|خلال/.test(q) ? "registration" : "restriction";
    why.push(`«قيد» بمعنى ${senses.qayd === "registration" ? "التسجيل" : "الشرط أو القيد"}`);
  }
  if (/(?:^|\s)(?:ال)?اجر(?:ه|ها|هم)?(?=\s|$)/.test(q)) {
    // «أجر الواقف / من أوقف / المتصدق / عند الله»: the reward; «أجر الناظر / العامل / المتولي»: the fee
    senses.ajr = /اجر\S*\s+(?:ال)?(?:ناظر|نظار|عامل|متولي|وكيل|مدير|محاسب|حارس|مستاجر)|اجره\s/.test(q) ? "fee"
      : /اجر\S*\s+(?:ال)?(?:واقف|متصدق|محسن|من\s+(?:اوقف|وقف|تصدق|حبس)|الوقف|الصدقه)|ثواب|عند الله/.test(q) ? "reward" : "ambiguous";
    why.push(`«أجر» بمعنى ${senses.ajr === "reward" ? "الثواب" : senses.ajr === "fee" ? "الأجرة" : "غير متعين"}`);
    if (senses.ajr === "reward") answer = "reward";
  }
  // places, dates, identifiers
  const places = placesIn(raw);
  if (places.length) why.push(`المكان: ${places.map((p) => p.ar[0]).join("، ")}`);
  const years = [...new Set(raw.match(/(?<!\d)(1[34]\d\d|20\d\d|19\d\d)(?!\d)/g) ?? [])];
  if (years.length) why.push(`السنوات: ${years.join("، ")}`);
  const rel = q.match(/(?:العام|السنه|الربع|الشهر|الاسبوع)\s+(?:الماضي|السابق|المنصرم|الماضيه|السابقه|الحالي|الحاليه|الجاري|الجاريه|القادم|المقبل|القادمه|المقبله)|(?:هذا|هذه)\s+(?:العام|السنه|الربع|الشهر)|(?:العام|السنه)\s+(?:هذا|هذه)|قبل\s+(?:\S+\s+)?(?:سنه|سنوات|سنتين|اعوام|عام|اشهر|شهر)|(?:الان|حاليا|اليوم)(?![ء-ي])/);
  if (rel) why.push(`تاريخ نسبي «${rel[0]}»`);
  const identifiers: Frame["identifiers"] = [];
  for (const x of raw.matchAll(/\b(FAS|IFRS|IAS|IPSAS|GS|SS|ISA)\s*[-–]?\s*(\d{1,3})\b/gi)) identifiers.push({ kind: x[1]!.toUpperCase(), number: x[2]! });
  for (const x of q.matchAll(/(?:المعيار|معيار)\s+(?:رقم\s+)?\(?(\d{1,3})\)?/g)) identifiers.push({ kind: "المعيار", number: x[1]! });
  if (identifiers.length) why.push(`المعرّف: ${identifiers.map((i) => `${i.kind} ${i.number}`).join("، ")}`);
  // a long request text (a client's matter) names places and times as its context, not as what it asks about
  if (tokenize(raw).length > LONG) return { answer, focus: [], senses, places: [], years, relativeDate: null, identifiers, why: [...why, "نص طويل: الأماكن والأزمنة فيه سياق لا قيود"] };
  return { answer, focus, senses, places, years, relativeDate: rel?.[0] ?? null, identifiers, why };
}

export const ANSWER_AR: Record<AnswerType, string> = {
  ruling: "حكم", obligation: "وجوب أو عدمه", permission: "جواز أو منع", period: "مدة", penalty: "عقوبة أو غرامة", quantity: "عدد أو مقدار", rate: "نسبة أو معدل",
  date: "تاريخ", reward: "الأجر بمعنى الثواب", open: "مفتوح",
};

/** A stated period: a number (digits or words, as whole words) and, within a few words, a unit of time (whole word). */
const PERIOD = /(?:^|\s)(?:\d+|واحد|اثن[ا-ي]*|ثلاث[ا-ي]*|اربع[ا-ي]*|خمس[ا-ي]*|ست[ا-ي]*|سبع[ا-ي]*|ثمان[ا-ي]*|تسع[ا-ي]*|عشر[ا-ي]*)\s+(?:\S+\s+){0,5}?(?:يوم|يوما|ايام|اسبوع|اسابيع|شهر|شهرا|اشهر|سنه|سنوات|سنتين|عام|اعوام)(?![ء-ي])/;
/** A penalty: the sanction itself, not any «مخالفة». */
const PENALTY = /عقوب|غرام[هةت]|جزاء|يعاقب|الجزاءات|حرمان من|غرامه ماليه|سجن|ايقاف عن|عزل(?![ء-ي])|يعزل|جدول المخالفات/;
const NUMBER = /\d|[٠-٩]|مليون|الف|مئه|بالمئه|%/;
/** A rule stated: the verbs and the qualifications of the school's and the regulations' language, jussive forms included. */
const RULING = /يجوز|تجوز|يجز|تجز|يصح|تصح|يحرم|يجب|تجب|يلزم|تلزم|يتعين|يحق|يمنع|يحظر|يلتزم|جاز|وجب|لا باس|حكم|يكره|كره|يستحب|يندب|مباح|محرم|واجب|ممنوع|جائز|يباع|لا يستبدل|يستبدل|لا يملك|ليس له|للناظر|للمتولي|فله|وله ان|له ان/;
/** «أجر» as reward in a passage: «أجر» (bare, or with a possessive) beside reward words, or the reward words themselves. */
const REWARD = /ثواب|عند الله|صدقه جاريه|يدوم اجر|اجرها|اجره وثوابه|حسنات|في الاخره|الاجر والثواب/;
const FEE = /اجره(?:\s+(?:ال)?(?:ناظر|مثل|عامل))|اجره المثل|الاجره|عوض|مكافاه|اتعاب|راتب/;

export type Judgement = { lacking: string[]; partial: string[]; answers: "direct" | "context"; why: string[] };

/**
 * A passage against a question's frame. `text` is the passage (for a foreign-language one, its Arabic descriptor and
 * its own text, both).
 */
export function judge(f: Frame, text: string, opts: { scope?: string; hasWord?: (w: string) => boolean } = {}): Judgement {
  // the answer is read in the passage; what it is about (dates, places, identifiers, focus, senses) in `scope` when
  // given — a foreign passage's Arabic descriptor, so that its dateline «Riyadh» is not taken for its subject
  const raw = digits(opts.scope ?? text);
  const t = normForSearch(raw);
  const rawText = digits(text);
  const tText = normForSearch(rawText);
  const lacking: string[] = [];
  const partial: string[] = [];
  const why: string[] = [];
  // dates
  if (f.relativeDate) lacking.push(`التاريخ النسبي «${f.relativeDate}» (لا يُطابق بنص دون تحديد السنة)`);
  const have = f.years.filter((y) => raw.includes(y));
  if (f.years.length && !have.length) lacking.push(f.years.length === 1 ? `السنة ${f.years[0]}` : `السنوات ${f.years.join("، ")}`);
  else if (have.length && have.length < f.years.length) partial.push(`لا يذكر ${f.years.filter((y) => !have.includes(y)).join("، ")} (يجيب عن جزء من المقارنة)`);
  // places (the Kingdom is the default scope of the corpus: named or not, a passage about it answers for it)
  const pp = placesIn(raw);
  for (const p of f.places) if (p.key !== "KSA" && !pp.some((x) => x.key === p.key)) lacking.push(`المكان «${p.ar[0]}»`);
  // identifiers
  for (const id of f.identifiers) {
    const re = id.kind === "المعيار" ? new RegExp(`(?:المعيار|معيار|FAS|IFRS|IAS)\\s*(?:رقم\\s*)?\\(?${id.number}\\)?(?!\\d)`, "i") : new RegExp(`${id.kind}\\s*[-–]?\\s*${id.number}(?!\\d)`, "i");
    if (!re.test(raw) && !re.test(t)) lacking.push(`${id.kind} ${id.number}`);
  }
  // the focus of a measure
  const toks = new Set(tokenize(raw));
  // (the caller's matching forms — its synonym groups — decide «present»: «العاطلين» is «البطالة»)
  for (const w of f.focus) if (!(opts.hasWord?.(w) ?? false) && !toks.has(w) && !t.includes(w)) lacking.push(`المقيس «${w}»`);
  // senses
  if (f.senses.ajr === "reward" && !REWARD.test(t)) lacking.push("الأجر بمعنى الثواب");
  if (f.senses.ajr === "fee" && !FEE.test(t)) lacking.push("الأجر بمعنى الأجرة");
  if (f.senses.ajr === "ambiguous" && FEE.test(t) && !REWARD.test(t)) partial.push("«أجر» في السؤال غير متعين: النص في الأجرة");
  // the kind of answer
  const direct = f.answer === "penalty" ? PENALTY.test(tText) : f.answer === "period" ? PERIOD.test(tText) : f.answer === "quantity" || f.answer === "rate" ? NUMBER.test(rawText)
    : f.answer === "date" ? /\d{4}|\d{1,2}\s*[/-]\s*\d{1,2}|january|february|march|april|may|june|july|august|september|october|november|december|محرم|صفر|ربيع|جماد|رجب|شعبان|رمضان|شوال|القعده|الحجه|يناير|فبراير|مارس|ابريل|مايو|يونيو|يوليو|اغسطس|سبتمبر|اكتوبر|نوفمبر|ديسمبر/i.test(rawText)
      : f.answer === "reward" ? REWARD.test(tText) : f.answer === "open" ? true : RULING.test(tText);
  if (!direct) {
    if (f.answer === "penalty") lacking.push("العقوبة أو الغرامة المسؤول عنها");
    else if (f.answer === "period") lacking.push("المدة المسؤول عنها");
    else if (f.answer === "quantity" || f.answer === "rate") lacking.push("الرقم المسؤول عنه");
  }
  if (!lacking.length) why.push(...f.why);
  return { lacking, partial, answers: direct ? "direct" : "context", why };
}
