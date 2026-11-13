/**
 * Place names against the gazetteer (stage 11, «ثالثاً»): data/knowledge/gazetteer/sa-admin.json — the Kingdom's 13
 * regions (verified), its governorates (compiled; see the file's sources) and the ISO countries (CLDR names), built by
 * scripts/knowledge/build-gazetteer.ts. Replaces the closed list of the retrieval frame.
 *
 *  - a name is matched as a whole phrase, the longest first («المملكة المتحدة» is not «المملكة»);
 *  - a name that is also an ordinary word («الوجه»، «تربة»، «الخبر»، «جدة») is a place only after a place word
 *    («محافظة»، «مدينة»، «منطقة»…), in its English form, or as part of a longer name;
 *  - a name shared by two places («عمان»: Oman and Amman — the same letters once normalised) is unresolved unless the
 *    text names which;
 *  - a place word followed by a name the gazetteer does not hold («محافظة …») is unresolved: never guessed.
 * Unresolved names make the question unanswerable until the user says which place (the frame abstains).
 */
import data from "../../../data/knowledge/gazetteer/sa-admin.json";
import { normForSearch } from "@/server/engine/knowledge/pure";

type Raw = { key: string; level: "country" | "region" | "governorate" | "city"; ar: string[]; en: string[]; domestic: boolean; parent?: string; ambiguous?: "word" | "name"; verified: boolean };
export type Place = { key: string; ar: string[]; en: string[]; domestic: boolean; level: Raw["level"]; ambiguous?: "word" | "name" };

export const GAZETTEER_VERSION = (data as { version: string }).version;

/** The entries, a governorate of the same name as its region folded into the region (the same place for a question). */
const ENTRIES: Place[] = (() => {
  const raw = (data as { entries: Raw[] }).entries;
  const regionNames = new Set(raw.filter((e) => e.level === "region").flatMap((e) => e.ar.map(normForSearch)));
  const out: Place[] = [];
  const folded = new Map<string, string[]>();
  for (const e of raw) if (e.level === "governorate" && e.ar.some((n) => regionNames.has(normForSearch(n)))) folded.set(normForSearch(e.ar[0]!), e.en);
  for (const e of raw) {
    if (e.level === "governorate" && folded.has(normForSearch(e.ar[0]!))) continue;
    // a region keeps the English name of its seat folded into it («Riyadh»)
    if (e.level === "region") e.en = [...new Set([...e.en, ...(folded.get(normForSearch(e.ar[0]!)) ?? [])])];
    // the stable keys earlier stages and tests use: the Kingdom «KSA», a region or governorate by its Arabic name
    const key = e.key === "SA" ? "KSA" : e.key.replace(/^[RG]:/, "");
    const ar = e.key === "R:مكة المكرمة" ? [...e.ar, "مكة"] : e.key === "R:المدينة المنورة" ? [...e.ar, "طيبة الطيبة"] : e.ar;
    out.push({ key, ar, en: e.en, domestic: e.domestic, level: e.level, ...(e.ambiguous ? { ambiguous: e.ambiguous } : {}) });
  }
  return out;
})();

/** Words that set what follows as a place (normalised). */
const PLACE_WORD = /^(?:[وفب]?(?:ال)?(?:مدينه|محافظه|منطقه|امارة|اماره|بلده|قريه|دوله|عاصمه|مركز|حي|احياء)|بمدينه|بمحافظه|بمنطقه|بحي)$/;
/** After a place word, words that are not names («المحافظة على»، «منطقة سكنية»). */
const NOT_A_NAME = /^(?:علي|عليه|عليها|عليهم|بها|فيها|منها|لها|سكنيه|تجاريه|صناعيه|زراعيه|اداريه|خاصه|عامه|معينه|واحده|اخري|اخر|الوقف|وقف|الاوقاف|اوقاف|كبيره|صغيره|نائيه|بعيده|قريبه|الكبري|الصغري|حدوديه|ساحليه|جبليه|ريفيه|الحضريه|حضريه|ما|هذه|هذا|تلك|ذات|كل|اي|التي|الذي|في|من|الي|عن|مع|و|او)$/;

type Name = { words: string[]; place: Place; ambiguous: Place["ambiguous"] | null; en: boolean };
const NAMES: Name[] = ENTRIES.flatMap((p) => [
  ...p.ar.map((n) => ({ words: normForSearch(n).split(/\s+/).filter(Boolean), place: p, ambiguous: p.ambiguous ?? null, en: false })),
  ...p.en.map((n) => ({ words: n.toLowerCase().split(/[\s-]+/).filter(Boolean), place: p, ambiguous: null, en: true })),
]).sort((a, b) => b.words.length - a.words.length);

const tokensOf = (text: string) => {
  // Arabic words normalised (clitics kept, stripped per comparison); English words lower-cased
  const t = normForSearch(text.replace(/['’]s\b/gi, "").replace(/[^\p{L}\p{M}\p{N}\s'-]/gu, " "));
  return t.split(/\s+/).filter(Boolean);
};
/** Names by the head of their first word (Arabic without «ال»; English as is): looked up, never scanned. */
const BY_HEAD = new Map<string, Name[]>();
for (const n of NAMES) {
  const head = n.en ? n.words[0]! : n.words[0]!.replace(/^ال/, "");
  BY_HEAD.set(head, [...(BY_HEAD.get(head) ?? []), n]);
}
/**
 * The heads a token may carry, the clitics Arabic attaches to a name's first word removed (و، ف، ب، ل، لل، ك، ال), each
 * with whether the token had the article — a name written with «ال» is a name only with it («رياض الأطفال» is not
 * «الرياض»: FR11-11).
 */
function headsOf(tok: string): { head: string; al: boolean }[] {
  const out = new Map<string, boolean>([[tok, false]]);
  for (const a of ["", "و", "ف"]) {
    if (a && !tok.startsWith(a)) continue;
    const t1 = tok.slice(a.length);
    for (const b of ["", "ب", "ل", "ك"]) {
      if (b && !t1.startsWith(b)) continue;
      const t2 = t1.slice(b.length);
      if (!out.has(t2)) out.set(t2, false);
      if (t2.startsWith("ال")) out.set(t2.slice(2), true);
      // «لل» = «ل» + «ال»
      if (b === "ل" && t2.startsWith("ل")) out.set(t2.slice(1), true);
    }
  }
  return [...out].filter(([h]) => h).map(([head, al]) => ({ head, al }));
}

export type PlaceReading = { places: Place[]; unresolved: string[]; soft: string[] };

/** The places a text names, and the names it gives that cannot be resolved with certainty. */
export function readPlaces(text: string): PlaceReading {
  const toks = tokensOf(text);
  const found: Place[] = [];
  const unresolved: string[] = [];
  const soft: string[] = [];
  const used = new Set<number>();
  for (let i = 0; i < toks.length; i++) {
    if (used.has(i)) continue;
    const cued = i > 0 && PLACE_WORD.test(toks[i - 1]!);
    // «في»، «من»، «إلى» before the name, or «ب» on it: a weaker sign of a place
    const prep = i > 0 && /^(?:في|من|الي|داخل|سكان|اهالي|اهل|ابناء|امير|امانه|بلديه)$/.test(toks[i - 1]!);
    const weak = prep || /^[وف]?ب/.test(toks[i]!);
    // every name that starts here, longest first
    const at = headsOf(toks[i]!).flatMap(({ head, al }) => (BY_HEAD.get(head) ?? []).filter((n) => n.en || al === n.words[0]!.startsWith("ال") || (!al && head === n.words[0])))
      .filter((n) => n.words.slice(1).every((w, k) => toks[i + 1 + k] === w))
      // an English name only as a proper noun, capitalised in the text («china», «jordan shoes»: FR11-11)
      .filter((n) => {
        if (!n.en || n.words[0]!.length <= 3) return true;
        const m = text.match(new RegExp(`\\b${n.words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s-]+")}`, "i"));
        return !!m && m[0][0] === m[0][0]!.toUpperCase();
      })
      .sort((a, b) => b.words.length - a.words.length);
    if (!at.length) {
      // a place word followed by a name the gazetteer does not hold: unresolved, never guessed
      if (cued && !NOT_A_NAME.test(toks[i]!) && /^[ء-ي]/.test(toks[i]!) && toks[i]!.replace(/^ال/, "").length >= 3)
        unresolved.push(`المكان «${toks[i - 1]} ${toks[i]}» غير موجود في المعجم الجغرافي المعتمد`);
      continue;
    }
    const len = at[0]!.words.length;
    const longest = at.filter((n) => n.words.length === len);
    // an ordinary word that is also a name counts only as a place: after a place word, or within a longer name
    const usable = longest.filter((n) => !n.ambiguous || cued || n.words.length > 1 || (n.ambiguous === "name" && weak));
    if (!usable.length) {
      // a common word in a place's position («في الخبر»): it may be either — said, not guessed
      // only after a preposition, not followed by «من» («في العديد من»), and never for «بالكامل»: said for a factual
      // question only (frame.ts) — in a normative one the word is read as a word (FR11-10)
      if (prep && toks[i + len] !== "من" && longest.some((n) => n.ambiguous === "word")) soft.push(`«${toks.slice(i, i + len).join(" ")}» قد يكون اسم مكان (${longest[0]!.place.ar[0]}) أو كلمة عادية: يُحدَّد المقصود`);
      continue;
    }
    const keys = [...new Set(usable.map((n) => n.place.key))];
    for (let k = 0; k < len; k++) used.add(i + k);
    if (keys.length > 1) {
      unresolved.push(`«${toks.slice(i, i + len).join(" ")}» يحتمل أكثر من مكان (${usable.map((n) => n.place.ar[0]).filter((x, j, a) => a.indexOf(x) === j).join("، ")}) ولم يُبيَّن أيها`);
      continue;
    }
    if (!found.some((p) => p.key === keys[0])) found.push(usable[0]!.place);
  }
  // an English place-like name after «in» that the gazetteer does not hold («in Springfield», «in Dubai» before it was
  // listed): said for a factual question only (frame.ts), never guessed (FR11-12)
  const MONTHS = /^(?:January|February|March|April|May|June|July|August|September|October|November|December|Islamic|Saudi|Arabic|English|Hanbali|Shariah|Sharia|The|A|An)$/;
  for (const m of text.matchAll(/\bin\s+(?:the\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g)) {
    const name = m[1]!;
    if (MONTHS.test(name.split(/\s+/)[0]!)) continue;
    if (found.some((p) => p.en.some((e) => e.toLowerCase() === name.toLowerCase() || name.toLowerCase().startsWith(e.toLowerCase())))) continue;
    soft.push(`المكان «${name}» غير موجود في المعجم الجغرافي المعتمد`);
  }
  // a homograph named elsewhere in full resolves it («سلطنة عمان … عمان»): drop the unresolved note for it
  const resolved = unresolved.filter((u) => !(u.includes("يحتمل") && found.some((p) => u.includes(`(${p.ar[0]}`) || u.includes(`، ${p.ar[0]}`))));
  return { places: found, unresolved: [...new Set(resolved)], soft: [...new Set(soft)] };
}

export const placesInText = (text: string) => readPlaces(text).places;

/** Every entry (for the context-place removal kept for its tests, frame.ts withoutContextPlaces). */
export const allPlaces = (): Place[] => ENTRIES;
