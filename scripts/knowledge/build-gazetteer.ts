/**
 * Builds data/knowledge/gazetteer/sa-admin.json — the gazetteer the retrieval frame resolves place names against
 * (stage 11, «ثالثاً»: an official gazetteer instead of word lists).
 *
 * Sources, recorded in the file with each part's standing:
 *  - the 13 administrative regions and their seats: نظام المناطق (أمر ملكي أ/92 في 27/8/1412هـ) and the list of the
 *    regions' emirates published by the Ministry of Interior (as reproduced by the National Center for Archives and
 *    Records / Saudipedia): VERIFIED against that list;
 *  - the governorates (محافظات الفئتين أ وب): COMPILED from the published lists of each emirate; NOT yet verified
 *    entry by entry against the Ministry of Interior's current official list (to be done before production — a
 *    governorate missing here is «unresolved», never guessed);
 *  - countries: ISO 3166-1, with their Arabic and English names from the Unicode CLDR (the runtime's Intl data).
 *
 * Names that are also common words («الوجه»، «تربة»، «الكامل»، «الخبر»، «مرات»، «جدة»…) are marked «ambiguous»: they
 * count as places only after a place word («محافظة»، «مدينة»، «منطقة»…) or in English. A name shared by two places
 * («عمان»: Oman and Amman) is a homograph: the frame abstains unless the question says which.
 *
 *   npx tsx scripts/knowledge/build-gazetteer.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

type Entry = { key: string; level: "country" | "region" | "governorate" | "city"; ar: string[]; en: string[]; domestic: boolean; parent?: string; ambiguous?: "word" | "name"; verified: boolean };

const REGIONS: [string, string[], string[], string][] = [
  ["الرياض", ["منطقة الرياض"], ["Riyadh Region"], "الرياض"],
  ["مكة المكرمة", ["منطقة مكة المكرمة"], ["Makkah Region", "Mecca Region"], "مكة المكرمة"],
  ["المدينة المنورة", ["منطقة المدينة المنورة"], ["Madinah Region", "Medina Region"], "المدينة المنورة"],
  ["القصيم", ["منطقة القصيم"], ["Qassim", "Al-Qassim"], "بريدة"],
  ["الشرقية", ["المنطقة الشرقية"], ["Eastern Province", "Eastern Region"], "الدمام"],
  ["عسير", ["منطقة عسير"], ["Asir", "Aseer"], "أبها"],
  ["تبوك", ["منطقة تبوك"], ["Tabuk Region"], "تبوك"],
  ["حائل", ["منطقة حائل"], ["Hail Region", "Ha'il Region"], "حائل"],
  ["الحدود الشمالية", ["منطقة الحدود الشمالية"], ["Northern Borders"], "عرعر"],
  ["جازان", ["منطقة جازان", "جيزان"], ["Jazan Region", "Jizan Region"], "جازان"],
  ["نجران", ["منطقة نجران"], ["Najran Region"], "نجران"],
  ["الباحة", ["منطقة الباحة"], ["Al-Baha Region", "Baha Region"], "الباحة"],
  ["الجوف", ["منطقة الجوف"], ["Al-Jouf", "Jouf"], "سكاكا"],
];

/** Governorates by region (Arabic | English). Compiled; see the header. */
const GOVERNORATES: Record<string, [string, string][]> = {
  "الرياض": [["الرياض", "Riyadh"], ["الدرعية", "Diriyah"], ["الخرج", "Al-Kharj"], ["الدوادمي", "Dawadmi"], ["المجمعة", "Majmaah"], ["القويعية", "Quwayiyah"], ["الأفلاج", "Aflaj"], ["وادي الدواسر", "Wadi ad-Dawasir"], ["الزلفي", "Zulfi"], ["شقراء", "Shaqra"], ["حوطة بني تميم", "Hotat Bani Tamim"], ["عفيف", "Afif"], ["الغاط", "Al-Ghat"], ["السليل", "As-Sulayyil"], ["ضرما", "Dhurma"], ["المزاحمية", "Muzahmiyah"], ["رماح", "Rumah"], ["ثادق", "Thadiq"], ["حريملاء", "Huraymila"], ["الحريق", "Al-Hariq"], ["مرات", "Marat"], ["الدلم", "Ad-Dilam"]],
  "مكة المكرمة": [["مكة المكرمة", "Makkah"], ["جدة", "Jeddah"], ["الطائف", "Taif"], ["القنفذة", "Al-Qunfudhah"], ["الليث", "Al-Lith"], ["رابغ", "Rabigh"], ["خليص", "Khulais"], ["الخرمة", "Al-Khurmah"], ["رنية", "Ranyah"], ["تربة", "Turabah"], ["الجموم", "Al-Jumum"], ["الكامل", "Al-Kamil"], ["المويه", "Al-Muwayh"], ["ميسان", "Maysan"], ["أضم", "Adham"], ["العرضيات", "Al-Ardiyat"], ["بحرة", "Bahra"]],
  "المدينة المنورة": [["المدينة المنورة", "Madinah"], ["ينبع", "Yanbu"], ["العلا", "AlUla"], ["المهد", "Mahd adh-Dhahab"], ["بدر", "Badr"], ["خيبر", "Khaybar"], ["الحناكية", "Al-Hinakiyah"], ["العيص", "Al-Ais"], ["وادي الفرع", "Wadi al-Fara"]],
  "القصيم": [["بريدة", "Buraydah"], ["عنيزة", "Unayzah"], ["الرس", "Ar-Rass"], ["المذنب", "Al-Midhnab"], ["البكيرية", "Al-Bukayriyah"], ["البدائع", "Al-Badai"], ["الأسياح", "Al-Asyah"], ["النبهانية", "An-Nabhaniyah"], ["الشماسية", "Ash-Shimasiyah"], ["عيون الجواء", "Uyun al-Jiwa"], ["رياض الخبراء", "Riyadh al-Khabra"], ["عقلة الصقور", "Uqlat as-Suqur"], ["ضرية", "Dariyah"]],
  "الشرقية": [["الدمام", "Dammam"], ["الأحساء", "Al-Ahsa"], ["حفر الباطن", "Hafr al-Batin"], ["الجبيل", "Jubail"], ["القطيف", "Qatif"], ["الخبر", "Khobar"], ["الخفجي", "Khafji"], ["رأس تنورة", "Ras Tanura"], ["بقيق", "Abqaiq"], ["النعيرية", "Nairyah"], ["قرية العليا", "Qaryat al-Ulya"], ["العديد", "Al-Udayd"]],
  "عسير": [["أبها", "Abha"], ["خميس مشيط", "Khamis Mushait"], ["بيشة", "Bisha"], ["النماص", "An-Namas"], ["محايل عسير", "Muhayil"], ["ظهران الجنوب", "Dhahran al-Janub"], ["تثليث", "Tathlith"], ["سراة عبيدة", "Sarat Abidah"], ["رجال ألمع", "Rijal Alma"], ["بلقرن", "Balqarn"], ["أحد رفيدة", "Ahad Rafidah"], ["المجاردة", "Al-Majardah"], ["البرك", "Al-Birk"], ["بارق", "Bariq"], ["تنومة", "Tanomah"], ["طريب", "Tarib"], ["الحرجة", "Al-Harajah"]],
  "تبوك": [["تبوك", "Tabuk"], ["الوجه", "Al-Wajh"], ["ضباء", "Duba"], ["تيماء", "Tayma"], ["أملج", "Umluj"], ["حقل", "Haql"], ["البدع", "Al-Bad"]],
  "حائل": [["حائل", "Hail"], ["بقعاء", "Baqaa"], ["الغزالة", "Al-Ghazalah"], ["الشنان", "Ash-Shinan"], ["الحائط", "Al-Hait"], ["السليمي", "As-Sulaymi"], ["الشملي", "Ash-Shamli"], ["موقق", "Mawqaq"], ["سميراء", "Samira"]],
  "الحدود الشمالية": [["عرعر", "Arar"], ["رفحاء", "Rafha"], ["طريف", "Turaif"], ["العويقيلة", "Al-Uwayqilah"]],
  "جازان": [["جازان", "Jazan"], ["صبيا", "Sabya"], ["أبو عريش", "Abu Arish"], ["صامطة", "Samtah"], ["بيش", "Baish"], ["الدرب", "Ad-Darb"], ["الحرث", "Al-Harth"], ["ضمد", "Damad"], ["الريث", "Ar-Rayth"], ["العارضة", "Al-Aridah"], ["العيدابي", "Al-Aidabi"], ["فرسان", "Farasan"], ["الدائر", "Ad-Dayer"], ["أحد المسارحة", "Ahad al-Masarihah"], ["الطوال", "At-Tuwal"], ["فيفا", "Fayfa"], ["هروب", "Harub"]],
  "نجران": [["نجران", "Najran"], ["شرورة", "Sharurah"], ["حبونا", "Hubuna"], ["بدر الجنوب", "Badr al-Janub"], ["يدمة", "Yadamah"], ["ثار", "Thar"], ["خباش", "Khubash"], ["الخرخير", "Al-Kharkhir"]],
  "الباحة": [["الباحة", "Al-Baha"], ["بلجرشي", "Baljurashi"], ["المندق", "Al-Mandaq"], ["المخواة", "Al-Makhwah"], ["قلوة", "Qilwah"], ["العقيق", "Al-Aqiq"], ["القرى", "Al-Qura"], ["غامد الزناد", "Ghamid az-Zinad"], ["الحجرة", "Al-Hajrah"], ["بني حسن", "Bani Hasan"]],
  "الجوف": [["سكاكا", "Sakaka"], ["القريات", "Al-Qurayyat"], ["دومة الجندل", "Dumat al-Jandal"], ["طبرجل", "Tabarjal"]],
};

/**
 * Names that are also ordinary words or personal names. «word»: a common word («الخبر» the news, «الوجه» the face,
 * «مرات» times) — a place only after a place word («محافظة»، «مدينة»…) or in English; after «في» alone it is unresolved.
 * «name»: a name or a rarer word («جدة»، «حائل»، «بدر») — a place also after «في»، «من»، «إلى» or with «ب».
 */
const AMBIGUOUS: Record<string, "word" | "name"> = Object.fromEntries([
  ...["الوجه", "تربة", "الكامل", "الخبر", "مرات", "العديد", "الحريق", "البدع", "القرى", "حقل", "الطوال", "الحرث", "الريث", "هروب", "الحجرة", "المهد", "البدائع", "الغزالة",
    "البرك", "الدائر", "العارضة", "الدرب", "الحائط", "ثار", "رماح", "العقيق", "الشرقية", "المجمعة"].map((n) => [n, "word" as const]),
  ...["جدة", "حائل", "بدر", "الخرج", "شقراء", "عفيف", "السليل", "الليث", "بارق", "طريف", "الرس", "العلا", "بحرة", "قلوة", "الغاط", "الدلم", "العيص", "خليص", "رنية", "ميسان",
    "أضم", "ضمد", "فرسان", "المذنب", "الجوف", "الباحة"].map((n) => [n, "name" as const]),
]);

/** Arabic forms people use for countries besides the CLDR name. */
const COUNTRY_ALIASES: Record<string, string[]> = {
  SA: ["السعودية", "المملكة", "المملكة العربية السعودية"], US: ["أمريكا", "الولايات المتحدة"], GB: ["بريطانيا", "المملكة المتحدة"], AE: ["الإمارات"], OM: ["سلطنة عمان", "عمان"],
  KW: ["الكويت"], QA: ["قطر"], BH: ["البحرين"], YE: ["اليمن"], IQ: ["العراق"], JO: ["الأردن"], EG: ["مصر"], SY: ["سوريا", "سورية"], LB: ["لبنان"], MA: ["المغرب"], DZ: ["الجزائر"],
  TN: ["تونس"], LY: ["ليبيا"], SD: ["السودان"], TR: ["تركيا"], IR: ["إيران"], PK: ["باكستان"], MY: ["ماليزيا"], ID: ["إندونيسيا"], IN: ["الهند"], CN: ["الصين"], JP: ["اليابان"],
  DE: ["ألمانيا"], FR: ["فرنسا"], CA: ["كندا"], PS: ["فلسطين"],
};
const COUNTRY_EN_ALIASES: Record<string, string[]> = { US: ["USA", "America", "United States"], GB: ["UK", "Britain", "United Kingdom"], AE: ["UAE", "Emirates"], SA: ["Saudi", "KSA", "Saudi Arabia", "Kingdom"], TR: ["Turkey", "Türkiye"] };
/** Countries whose Arabic name is also a common word («مالي»: financial). */
const COUNTRY_AMBIGUOUS: Record<string, "word" | "name"> = { ML: "word", BJ: "word", MA: "name", QA: "name", TD: "name" };
/** Places abroad whose names are homographs of another entry (after normalisation: «عُمان» = «عمّان»). */
const HOMOGRAPHS: Entry[] = [
  { key: "JO-AMM", level: "city", ar: ["عمان", "عمّان", "عمان الأردنية", "عمّان الأردنية", "العاصمة الأردنية"], en: ["Amman"], domestic: false, parent: "JO", verified: true },
  { key: "LY-TIP", level: "city", ar: ["طرابلس", "طرابلس الغرب", "طرابلس الليبية"], en: ["Tripoli"], domestic: false, parent: "LY", verified: true },
  { key: "LB-TRI", level: "city", ar: ["طرابلس", "طرابلس الشام", "طرابلس اللبنانية"], en: ["Tripoli Lebanon"], domestic: false, parent: "LB", verified: true },
];
/**
 * Cities abroad a question may name (stage 11, after the independent review FR11-12): a COMPILED list of capitals and
 * large cities, not an official source — so that «في دبي» limits the answer to Dubai (and is then not answered from the
 * Kingdom's figures) instead of being ignored. A city abroad not listed here is still not recognised (documented).
 */
const CITIES_ABROAD: [string, string, string][] = [
  ["AE", "دبي", "Dubai"], ["AE", "أبوظبي", "Abu Dhabi"], ["AE", "الشارقة", "Sharjah"], ["QA", "الدوحة", "Doha"], ["BH", "المنامة", "Manama"], ["OM", "مسقط", "Muscat"],
  ["EG", "القاهرة", "Cairo"], ["EG", "الإسكندرية", "Alexandria"], ["LB", "بيروت", "Beirut"], ["SY", "دمشق", "Damascus"], ["SY", "حلب", "Aleppo"], ["IQ", "بغداد", "Baghdad"],
  ["YE", "صنعاء", "Sanaa"], ["YE", "عدن", "Aden"], ["SD", "الخرطوم", "Khartoum"], ["MA", "الرباط", "Rabat"], ["MA", "الدار البيضاء", "Casablanca"], ["PS", "القدس", "Jerusalem"],
  ["TR", "إسطنبول", "Istanbul"], ["TR", "أنقرة", "Ankara"], ["IR", "طهران", "Tehran"], ["PK", "كراتشي", "Karachi"], ["PK", "إسلام آباد", "Islamabad"], ["PK", "لاهور", "Lahore"],
  ["MY", "كوالالمبور", "Kuala Lumpur"], ["ID", "جاكرتا", "Jakarta"], ["GB", "لندن", "London"], ["FR", "باريس", "Paris"], ["US", "نيويورك", "New York"], ["US", "واشنطن", "Washington"],
  ["DE", "برلين", "Berlin"], ["IN", "نيودلهي", "New Delhi"], ["IN", "مومباي", "Mumbai"], ["CN", "بكين", "Beijing"], ["JP", "طوكيو", "Tokyo"], ["SG", "سنغافورة", "Singapore"],
];

// codes the runtime names that are not current ISO 3166-1 alpha-2 (groupings, reserved, deprecated)
const NOT_ISO = new Set(["EU", "EZ", "UN", "QO", "XA", "XB", "ZZ", "AC", "CP", "DG", "EA", "IC", "TA", "CQ", "AN", "BU", "CS", "DD", "FX", "SU", "TP", "UK", "XK", "YD", "YU", "ZR"]);
function countries(): Entry[] {
  const ar = new Intl.DisplayNames(["ar"], { type: "region" });
  const en = new Intl.DisplayNames(["en"], { type: "region" });
  const out: Entry[] = [];
  for (let a = 65; a < 91; a++) for (let b = 65; b < 91; b++) {
    const code = String.fromCharCode(a, b);
    if (NOT_ISO.has(code)) continue;
    let e: string | undefined;
    try { e = en.of(code); } catch { continue; }
    if (!e || e === code) continue;
    const arName = ar.of(code)!;
    out.push({
      ...(COUNTRY_AMBIGUOUS[code] ? { ambiguous: COUNTRY_AMBIGUOUS[code] } : {}), key: code, level: "country", ar: [...new Set([arName, ...(COUNTRY_ALIASES[code] ?? [])])], en: [...new Set([e, ...(COUNTRY_EN_ALIASES[code] ?? [])])], domestic: code === "SA", verified: true,
    });
  }
  return out;
}

const entries: Entry[] = [
  ...countries(),
  ...REGIONS.map(([key, alt, en]) => ({ key: `R:${key}`, level: "region" as const, ar: [key, ...alt], en, domestic: true, parent: "SA", ...(AMBIGUOUS[key] ? { ambiguous: AMBIGUOUS[key] } : {}), verified: true })),
  ...Object.entries(GOVERNORATES).flatMap(([region, govs]) => govs.map(([ar, en]) => ({ key: `G:${ar}`, level: "governorate" as const, ar: [ar], en: [en], domestic: true, parent: `R:${region}`, ...(AMBIGUOUS[ar] ? { ambiguous: AMBIGUOUS[ar] } : {}), verified: false }))),
  ...HOMOGRAPHS,
  ...CITIES_ABROAD.map(([cc, ar, en]) => ({ key: `C:${en}`, level: "city" as const, ar: [ar], en: [en], domestic: false, parent: cc, verified: false })),
];
const out = {
  version: "sa-admin/1",
  builtAt: new Date().toISOString().slice(0, 10),
  sources: [
    { part: "regions", standing: "verified", source: "نظام المناطق (أمر ملكي رقم أ/92 في 27/8/1412هـ) وقائمة إمارات المناطق الـ13 ومقارها (وزارة الداخلية؛ المركز الوطني للوثائق والمحفوظات)" },
    { part: "governorates", standing: "compiled, not verified entry by entry", source: "قوائم محافظات الإمارات المنشورة؛ تلزم مطابقتها بالقائمة الرسمية لوزارة الداخلية قبل الإنتاج" },
    { part: "countries", standing: "verified", source: "ISO 3166-1 alpha-2، بالأسماء العربية والإنجليزية من Unicode CLDR" },
    { part: "cities abroad", standing: "compiled, not official", source: "عواصم ومدن كبرى خارج المملكة، جُمعت لتقييد السؤال بها بدل تجاهلها؛ مدينة غير مدرجة لا تُعرف" },
  ],
  counts: { countries: entries.filter((e) => e.level === "country").length, regions: REGIONS.length, governorates: Object.values(GOVERNORATES).flat().length },
  entries,
};
const dir = path.join(process.cwd(), "data/knowledge/gazetteer");
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, "sa-admin.json"), `${JSON.stringify(out, null, 1)}\n`);
console.log(out.counts);
