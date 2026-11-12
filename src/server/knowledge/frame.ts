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
import { allPlaces, readPlaces, type Place } from "./gazetteer";

/** Beyond this many content words a question is a request's text (retrieve.ts LONG_QUESTION). */
const LONG = 25;
const digits = (s: string) => s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

export type AnswerType = "ruling" | "obligation" | "permission" | "period" | "penalty" | "quantity" | "rate" | "date" | "reward" | "open";
export type { Place } from "./gazetteer";

/**
 * The places a text names (stage 11: against the gazetteer, data/knowledge/gazetteer — the Kingdom's regions and
 * governorates and the ISO countries — never a closed list here). A name the gazetteer cannot resolve is not a place.
 */
export function placesIn(text: string): Place[] {
  return readPlaces(text).places;
}

export type Frame = {
  answer: AnswerType;
  focus: string[];
  senses: { qayd?: "registration" | "restriction"; ajr?: "reward" | "fee" | "ambiguous" };
  places: Place[];
  /** Places named as where the matter arises (a city of the Kingdom in a normative question): context, not matter. */
  contextPlaces: Place[];
  years: string[];
  relativeDate: string | null;
  identifiers: { kind: string; number: string }[];
  /**
   * Stage 11: what the question names that cannot be resolved with certainty — a place the gazetteer does not hold, a
   * name shared by two places, a common word in a place's position, a date relative to «now». The question is not
   * answered until it is said (retrieve() abstains); never guessed.
   */
  unresolved: string[];
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
  // stage 11: an English question («how many», «what rate», «when») asks the same kinds of answer
  if (answer === "open") {
    if (/\b(?:penalt(?:y|ies)|fines?)\b/i.test(raw)) answer = "penalty";
    else if (/\b(?:rate|percentage|share of)\b/i.test(raw)) answer = "rate";
    else if (/\b(?:how many|how much|number of|total)\b/i.test(raw)) answer = "quantity";
    else if (/\bwhen\b|\bdate of\b/i.test(raw)) answer = "date";
    else if (/\b(?:is it (?:permissible|allowed|lawful)|may (?:a|the)|can (?:a|the))\b/i.test(raw)) answer = "permission";
    else if (/\b(?:must|obliged|required to|obligation)\b/i.test(raw)) answer = "obligation";
    else if (/\bruling\b/i.test(raw)) answer = "ruling";
  }
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
  // a normative question (a ruling, a duty, a permission, a reward) asks what holds in the Kingdom: a city or region
  // of the Kingdom named in it is where the matter arises, not a limit on the answer — the Kingdom's rule is one in
  // all its regions (N10-7). Another country stays a qualifier: its law is not the Kingdom's. A factual question
  // (a number, a rate, a date, a period, a penalty) keeps every place: Riyadh's population is not the Kingdom's
  const normative = answer === "ruling" || answer === "obligation" || answer === "permission" || answer === "reward";
  const reading = readPlaces(raw);
  const named = reading.places;
  const unresolved = [...reading.unresolved];
  const places = normative ? named.filter((p) => !p.domestic) : named;
  if (normative && places.length < named.length) why.push(`مكان في المملكة في سؤال حكم: سياق لا قيد (${named.filter((p) => p.domestic).map((p) => p.ar[0]).join("، ")})`);
  if (places.length) why.push(`المكان: ${places.map((p) => p.ar[0]).join("، ")}`);
  const years = [...new Set(raw.match(/(?<!\d)(1[34]\d\d|20\d\d|19\d\d)(?!\d)/g) ?? [])];
  if (years.length) why.push(`السنوات: ${years.map((y) => `${y}${isHijri(y) ? "هـ" : "م"}`).join("، ")}`);
  const relEn = raw.match(/\b(?:last|this|next|previous|current|past)\s+(?:year|month|quarter|week)\b|\b\d+\s+(?:years?|months?)\s+ago\b|\b(?:now|today|currently|nowadays)\b/i);
  const rel = relEn ?? q.match(/(?:العام|السنه|الربع|الشهر|الاسبوع)\s+(?:الماضي|السابق|المنصرم|الماضيه|السابقه|الحالي|الحاليه|الجاري|الجاريه|القادم|المقبل|القادمه|المقبله)|(?:هذا|هذه)\s+(?:العام|السنه|الربع|الشهر)|(?:العام|السنه)\s+(?:هذا|هذه)|قبل\s+(?:\S+\s+)?(?:سنه|سنوات|سنتين|اعوام|عام|اشهر|شهر)|(?:الان|حاليا|اليوم)(?![ء-ي])/);
  if (rel) {
    why.push(`تاريخ نسبي «${rel[0]}»`);
    // a date relative to «now» in a question about a number or a date cannot be matched without guessing the year
    if (answer === "quantity" || answer === "rate" || answer === "date" || answer === "period") unresolved.push(`التاريخ النسبي «${rel[0]}»: تُذكر السنة`);
  }
  const identifiers: Frame["identifiers"] = [];
  for (const x of raw.matchAll(/\b(FAS|IFRS|IAS|IPSAS|GS|SS|ISA)\s*[-–]?\s*(\d{1,3})\b/gi)) identifiers.push({ kind: x[1]!.toUpperCase(), number: x[2]! });
  for (const x of q.matchAll(/(?:المعيار|معيار)\s+(?:رقم\s+)?\(?(\d{1,3})\)?/g)) identifiers.push({ kind: "المعيار", number: x[1]! });
  // legal instruments by number: a royal decree («م/43»), a resolution or a circular («قرار رقم 123»)
  for (const x of raw.matchAll(/(?:^|[\s(])م\s*\/\s*(\d{1,4})(?!\d)/g)) identifiers.push({ kind: "مرسوم ملكي", number: `م/${x[1]}` });
  for (const x of q.matchAll(/(?:قرار|تعميم)(?:\s+(?:مجلس الوزراء|الهيئه|الوزير|المجلس))?\s+رقم\s+\(?(\d{1,6})\)?/g)) identifiers.push({ kind: "قرار", number: x[1]! });
  if (identifiers.length) why.push(`المعرّف: ${identifiers.map((i) => `${i.kind} ${i.number}`).join("، ")}`);
  if (unresolved.length) why.push(`غير محدد: ${unresolved.join("؛ ")}`);
  // a long request text (a client's matter) names places and times as its context, not as what it asks about
  if (tokenize(raw).length > LONG) return { answer, focus: [], senses, places: [], contextPlaces: [], years, relativeDate: null, identifiers, unresolved: [], why: [...why, "نص طويل: الأماكن والأزمنة فيه سياق لا قيود"] };
  return { answer, focus, senses, places, contextPlaces: named.filter((p) => !places.includes(p)), years, relativeDate: rel?.[0] ?? null, identifiers, unresolved, why };
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
  // a year in the other calendar counts — flagged: a Hijri year spans two Gregorian years (stage 11)
  const yearIn = (y: string) => new RegExp(`(?<!\\d)${y}(?!\\d)`).test(raw);
  const have = f.years.filter((y) => yearIn(y) || equivalentYears(y).some(yearIn));
  for (const y of have) if (!yearIn(y)) partial.push(`السنة ${y} مذكورة بالتقويم الآخر (${equivalentYears(y).filter(yearIn).join("، ")}): مطابقة تقريبية`);
  if (f.years.length && !have.length) lacking.push(f.years.length === 1 ? `السنة ${f.years[0]}` : `السنوات ${f.years.join("، ")}`);
  else if (have.length && have.length < f.years.length) partial.push(`لا يذكر ${f.years.filter((y) => !have.includes(y)).join("، ")} (يجيب عن جزء من المقارنة)`);
  // places (the Kingdom is the default scope of the corpus: named or not, a passage about it answers for it)
  const pp = placesIn(raw);
  for (const p of f.places) if (p.key !== "KSA" && !pp.some((x) => x.key === p.key)) lacking.push(`المكان «${p.ar[0]}»`);
  // identifiers
  for (const id of f.identifiers) {
    if (id.kind === "مرسوم ملكي" || id.kind === "قرار") {
      const n = id.number.replace(/^م\//, "");
      const re = id.kind === "مرسوم ملكي" ? new RegExp(`م\\s*\\/\\s*${n}(?!\\d)`) : new RegExp(`رقم\\s*\\(?${n}\\)?(?!\\d)`);
      if (!re.test(raw) && !re.test(t)) lacking.push(`${id.kind} ${id.number}`);
      continue;
    }
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

/** Words that set a place as where the matter arises: «في الرياض»، «بجدة»، «مدينة الطائف»، «in Riyadh». */
const CUE = /^(?:[وف]?(?:في|داخل|من|الي|بمدينه|بمنطقه|بمحافظه|مدينه|منطقه|محافظه)|in|at|from)$/i;
const strip = (w: string) => normForSearch(w.replace(/[؟?!.,،:;«»"'()]+$/g, ""));

/**
 * The question without the places it names as context (N10-7), in its own spelling (N10b-1: the article and school
 * matchers read the original words). A place is removed only where a locative word sets it — «في الرياض», «بجدة»,
 * «مدينة الطائف», «in Riyadh» — so a word that is also a place name used otherwise stays («يقف على جده», «حائل»
 * as an adjective: N10b-4). Its trailing punctuation is kept.
 */
export function withoutContextPlaces(question: string, f: Frame): string {
  if (!f.contextPlaces.length) return question;
  const words = question.split(/\s+/).filter(Boolean);
  // every name of the gazetteer, longest first: a longer name wins where two overlap («المملكة المتحدة» is not «المملكة»)
  const context = new Set(f.contextPlaces.map((p) => p.key));
  const names = allPlaces().flatMap((p) => [...p.ar.map((n) => normForSearch(n).split(/\s+/)), ...p.en.map((n) => n.toLowerCase().split(/\s+/))].map((n) => ({ n, ctx: context.has(p.key) })))
    .sort((a, b) => b.n.length - a.n.length);
  const drop = new Set<number>();
  for (let i = 0; i < words.length; i++) {
    // the place's first word may carry the clitics (و، ف، ب، ل، ال); «ب» or «ل» on it is itself the locative
    const first = strip(words[i]!).replace(/^[«"'(\[]+/, "").toLowerCase();
    const hit = names.find(({ n }) => {
      const head = n[0]!.replace(/^ال/, "");
      return new RegExp(`^[وف]?(?:ب|ل|لل)?(?:ال)?${head.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`).test(first)
        && n.slice(1).every((x, k) => strip(words[i + 1 + k] ?? "").replace(/^[«"'(\[]+/, "").toLowerCase() === x);
    });
    if (!hit) continue;
    const len = hit.n.length;
    if (hit.ctx) {
      const own = /^[وف]?(?:ب|ل)/.test(first) && !new RegExp(`^[وف]?${hit.n[0]!.replace(/^ال/, "")}`).test(first.replace(/^ال/, ""));
      const cued = own || (i > 0 && CUE.test(strip(words[i - 1]!))) || (i > 1 && CUE.test(strip(words[i - 2]!)) && CUE.test(strip(words[i - 1]!)));
      if (cued) {
        for (let k = 0; k < len; k++) drop.add(i + k);
        for (let j = i - 1; j >= 0 && j >= i - 2 && CUE.test(strip(words[j]!)); j--) drop.add(j);
        // the question mark (or other closing punctuation) on the last word removed stays with the sentence
        const tail = words[i + len - 1]!.match(/[؟?!.]+$/)?.[0];
        if (tail) {
          words[i + len - 1] = tail;
          drop.delete(i + len - 1);
        }
      }
    }
    i += len - 1;
  }
  return words.filter((_, i) => !drop.has(i)).join(" ").replace(/\s+([؟?!.])/g, "$1");
}

/** Hijri years 1300–1499 (a four-digit year below 1500); the rest Gregorian. */
export const isHijri = (y: string) => Number(y) >= 1300 && Number(y) < 1500;
/** The years of the other calendar a year overlaps (a Hijri year spans parts of two Gregorian years, and back). */
export function equivalentYears(y: string): string[] {
  const n = Number(y);
  if (isHijri(y)) {
    const g = Math.floor((n - 1) * 0.970229 + 622.54);
    return [String(g), String(g + 1)];
  }
  if (n >= 1882 && n < 2077) {
    const h = Math.floor((n - 622.54) / 0.970229) + 1;
    return [h - 1, h, h + 1].filter((x) => equivalentYears(String(x)).includes(y)).map(String);
  }
  return [];
}
