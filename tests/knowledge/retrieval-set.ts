/**
 * Stage 11 («ثالثاً»): the Arabic and English set of questions for the retrieval frame — places against the gazetteer,
 * homographs, unresolved names, dates (Hijri, Gregorian, relative), legal identifiers. Each case says what the frame
 * must give. «limitation» cases are kept on purpose: they document what the frame does NOT do yet, and the report
 * (scripts/knowledge/retrieval-set-report.ts) prints them as failures with their reason — never hidden.
 */
export type SetCase = {
  id: string;
  lang: "ar" | "en";
  q: string;
  /** Place keys the frame must hold as qualifiers (places) or as context (contextPlaces). */
  places?: string[];
  context?: string[];
  /** The frame must abstain (an unresolved part), and on what (a word of the note). */
  unresolved?: RegExp | false;
  years?: string[];
  identifiers?: string[];
  article?: { article: number; paragraph: number | null } | null;
  /** A passage, with what judge() must say it lacks (or [] for nothing lacking). */
  passage?: { text: string; lacking: RegExp | null; partial?: RegExp };
  limitation?: string;
};

export const RETRIEVAL_SET: SetCase[] = [
  // ── places: the Kingdom's regions and governorates, countries ──
  { id: "A1", lang: "ar", q: "ما حكم بيع الوقف في الرياض؟", context: ["الرياض"], places: [], unresolved: false },
  { id: "A2", lang: "ar", q: "كم عدد الأوقاف في محافظة الخرج عام 2023؟", places: ["الخرج"], years: ["2023"], unresolved: false, passage: { text: "بلغ عدد الأوقاف في المملكة 1200 عام 2023", lacking: /المكان «الخرج»/ } },
  { id: "A3", lang: "ar", q: "كم عدد سكان محافظة الأحساء؟", places: ["الأحساء"], passage: { text: "بلغ عدد سكان الأحساء مليون نسمة", lacking: null } },
  { id: "A4", lang: "ar", q: "كم سكان حائل؟", places: ["حائل"], passage: { text: "منع التحايل 3", lacking: /المكان/ } },
  { id: "A5", lang: "ar", q: "كم عدد الأوقاف في سلطنة عمان؟", places: ["OM"], unresolved: false },
  { id: "A6", lang: "ar", q: "كم عدد الأوقاف في المملكة المتحدة؟", places: ["GB"], unresolved: false },
  { id: "A7", lang: "ar", q: "هل يجوز بيع الوقف في الكويت إذا تعطلت منافعه؟", places: ["KW"], passage: { text: "ويجوز بيع الوقف إذا تعطلت منافعه", lacking: /المكان/ } },
  { id: "A8", lang: "ar", q: "ما حكم وقف المصحف على مسجد في جدة؟", context: ["جدة"], places: [] },
  { id: "A9", lang: "ar", q: "كم عدد الأوقاف في منطقة عسير؟", places: ["عسير"] },
  { id: "A10", lang: "ar", q: "كم عدد الأوقاف في المنطقة الشرقية؟", places: ["الشرقية"] },
  // ── homographs and names not in the gazetteer: abstain ──
  { id: "H1", lang: "ar", q: "كم عدد الأوقاف في عمان؟", unresolved: /يحتمل أكثر من مكان/ },
  { id: "H2", lang: "ar", q: "كم عدد الأوقاف في الخبر؟", unresolved: /قد يكون اسم مكان/ },
  { id: "H2b", lang: "ar", q: "ما حكم الوقف في الخبر الوارد عن الصحابة؟", unresolved: false, places: [] },
  { id: "H3", lang: "ar", q: "كم عدد سكان محافظة الزهراء؟", unresolved: /غير موجود في المعجم/ },
  { id: "H4", lang: "ar", q: "ما الخبر الصحيح عن وقف النقود؟", unresolved: false, places: [] },
  { id: "H5", lang: "ar", q: "هل يجوز أن يقف الرجل على جدته؟", unresolved: false, places: [] },
  { id: "H6", lang: "ar", q: "ما حكم المحافظة على أصل الوقف؟", unresolved: false, places: [] },
  { id: "H7", lang: "ar", q: "هل يجب على الناظر الكشف عن الأثر المالي للوقف؟", unresolved: false, places: [] },
  { id: "H8", lang: "ar", q: "عدد الأوقاف في مدينة الملك عبدالله الاقتصادية", unresolved: /غير موجود في المعجم/ }, // the economic cities, districts and centres are not in the gazetteer: the frame abstains (it does not resolve them)
  // ── dates ──
  { id: "D1", lang: "ar", q: "كم بلغ عدد الأوقاف العام الماضي؟", unresolved: /التاريخ النسبي/ },
  { id: "D2", lang: "ar", q: "كم عدد الأوقاف المسجلة في 1445؟", years: ["1445"], passage: { text: "سُجل من الأوقاف 300 في عام 2024", lacking: null, partial: /بالتقويم الآخر/ } },
  { id: "D3", lang: "ar", q: "كم عدد الأوقاف المسجلة في 2023؟", years: ["2023"], passage: { text: "سُجل من الأوقاف 300 في عام 1444هـ", lacking: null, partial: /بالتقويم الآخر/ } },
  { id: "D4", lang: "ar", q: "كم عدد الأوقاف المسجلة في 2023؟", years: ["2023"], passage: { text: "سُجل 300 وقف في عام 2019", lacking: /السنة 2023/ } },
  { id: "D5", lang: "ar", q: "كم بلغ معدل البطالة في 2019 مقارنة بعام 2025؟", years: ["2019", "2025"], passage: { text: "بلغ معدل البطالة 6% في 2019", lacking: null, partial: /2025/ } },
  { id: "D6", lang: "ar", q: "ما حكم وقف النقود الآن؟", unresolved: false, limitation: undefined },
  // ── legal identifiers ──
  { id: "L1", lang: "ar", q: "ما نص المرسوم الملكي م/43 في الأوقاف؟", identifiers: ["مرسوم ملكي م/43"], passage: { text: "صدر نظام الهيئة بالمرسوم الملكي رقم م/11", lacking: /م\/43/ } },
  { id: "L2", lang: "ar", q: "ما مضمون قرار مجلس الوزراء رقم 123؟", identifiers: ["قرار 123"], passage: { text: "قرار مجلس الوزراء رقم (123) وتاريخ 1440", lacking: null } },
  { id: "L3", lang: "ar", q: "ما نص المادة الثامنة من لائحة تنظيم أعمال النظارة؟", article: { article: 8, paragraph: null } },
  { id: "L4", lang: "ar", q: "ما نص م16/ف3 من اللائحة؟", article: { article: 16, paragraph: 3 } },
  { id: "L5", lang: "ar", q: "ما متطلبات FAS 38؟", identifiers: ["FAS 38"], passage: { text: "FAS 37 requires …", lacking: /FAS 38/ } },
  // ── after the independent review (FR11-9 … FR11-15) ──
  { id: "R1", lang: "ar", q: "هل يجوز بيع الوقف بالكامل؟", unresolved: false, places: [] },
  { id: "R2", lang: "ar", q: "كم عدد الأوقاف في العديد من المناطق؟", unresolved: false, places: [] },
  { id: "R3", lang: "ar", q: "ما حكم الوقف على البنين دون البنات؟", unresolved: false, places: [] },
  { id: "R4", lang: "ar", q: "ما حكم وقف مصلى لصلاة المغرب؟", unresolved: false, places: [] },
  { id: "R5", lang: "ar", q: "كم عدد رياض الأطفال الوقفية؟", unresolved: false, places: [] },
  { id: "R6", lang: "ar", q: "كم عدد الأوقاف في المغرب؟", places: ["MA"] },
  { id: "R7", lang: "ar", q: "ما نص المادة الثانية عشرة من لائحة تنظيم أعمال النظارة؟", article: { article: 12, paragraph: null } },
  { id: "R8", lang: "ar", q: "ما نص المادة الخامسة والعشرين من النظام؟", article: { article: 25, paragraph: null } },
  { id: "R9", lang: "ar", q: "كم بلغ عدد الأوقاف العام الفائت؟", unresolved: /التاريخ النسبي/ },
  { id: "R10", lang: "ar", q: "كم عدد الأوقاف المسجلة منذ عامين؟", unresolved: /التاريخ النسبي/ },
  { id: "R11", lang: "ar", q: "هل يجب دفع رسوم بمبلغ 2000 ريال لتسجيل الوقف؟", years: [] },
  { id: "R12", lang: "ar", q: "ما نص الأمر الملكي أ/90؟", identifiers: ["أمر ملكي أ/90"] },
  { id: "R13", lang: "en", q: "What does Royal Decree M/43 say about endowments?", identifiers: ["مرسوم ملكي م/43"] },
  { id: "R14", lang: "en", q: "What did Cabinet Resolution No. 123 decide?", identifiers: ["قرار 123"], passage: { text: "the fee is set at number 123 riyals", lacking: /قرار 123/ } },
  { id: "R15", lang: "en", q: "How many endowments were registered recently?", unresolved: /التاريخ النسبي/ },
  { id: "R16", lang: "en", q: "Is a waqf of china tableware permissible?", unresolved: false, places: [] },
  { id: "R17", lang: "en", q: "What does Article Twelve of the regulation say?", article: { article: 12, paragraph: null } },
  // ── English ──
  { id: "E1", lang: "en", q: "How many endowments were registered in Riyadh in 2023?", places: ["الرياض"], years: ["2023"], passage: { text: "In 2023 the Kingdom registered 300 endowments", lacking: /المكان «الرياض»/ } },
  { id: "E2", lang: "en", q: "Is it permissible to sell a waqf in Jeddah?", context: ["جدة"], places: [] },
  { id: "E3", lang: "en", q: "How many endowments are there in Oman?", places: ["OM"], unresolved: false },
  { id: "E4", lang: "en", q: "Waqf law in Amman", places: ["JO-AMM"], unresolved: false },
  { id: "E5", lang: "en", q: "What does Article 8 of the Nazara Regulation say?", article: { article: 8, paragraph: null } },
  { id: "E6", lang: "en", q: "Art. 16(3) of the Nazara regulation", article: { article: 16, paragraph: 3 } },
  { id: "E7", lang: "en", q: "How many endowments were registered last year?", unresolved: /التاريخ النسبي/ },
  { id: "E8", lang: "en", q: "Endowments in the Eastern Province", places: ["الشرقية"] },
  { id: "E9", lang: "en", q: "How many people live in Hail?", places: ["حائل"] },
  { id: "E10", lang: "en", q: "How many endowments are in Springfield city?", unresolved: /غير موجود/ },
  { id: "E13", lang: "ar", q: "كم عدد الأوقاف في دبي؟", places: ["C:Dubai"] },
  { id: "E14", lang: "en", q: "How many waqfs exist in Istanbul?", places: ["C:Istanbul"] },
  { id: "E15", lang: "ar", q: "كم عدد الأوقاف في حي الملز؟", unresolved: /غير موجود في المعجم/ },
  { id: "E16", lang: "ar", q: "كم عدد الأوقاف في طرابلس؟", unresolved: /يحتمل أكثر من مكان/ },
  { id: "E17", lang: "ar", q: "كم عدد الأوقاف في مدينة فاس؟", unresolved: /غير موجود في المعجم/ },
  { id: "E18", lang: "ar", q: "كم عدد الأوقاف في فاس؟", unresolved: /غير موجود/, limitation: "مدينة خارج المعجم بلا كلمة مكان قبلها (فاس، تطوان…) لا تُكتشف بالعربية: يُجاب بأرقام المملكة" },
  { id: "E11", lang: "en", q: "What is the penalty for not registering a waqf?", passage: { text: "The regulation requires registration", lacking: /العقوبة/ } },
];

/** What the frame gives for a case, and every way it differs from the case's expectation. */
export async function evaluate(c: SetCase): Promise<{ pass: boolean; problems: string[]; got: Record<string, unknown> }> {
  const F = await import("../../src/server/knowledge/frame");
  const K = await import("../../src/server/knowledge/retrieve");
  const f = F.frameOf(c.q);
  const problems: string[] = [];
  const keys = (ps: { key: string }[]) => ps.map((p) => p.key).sort();
  if (c.places && JSON.stringify(keys(f.places)) !== JSON.stringify([...c.places].sort())) problems.push(`places: ${keys(f.places).join("، ") || "—"} (expected ${c.places.join("، ") || "—"})`);
  if (c.context && JSON.stringify(keys(f.contextPlaces)) !== JSON.stringify([...c.context].sort())) problems.push(`context: ${keys(f.contextPlaces).join("، ") || "—"} (expected ${c.context.join("، ")})`);
  if (c.unresolved === false && f.unresolved.length) problems.push(`unresolved unexpectedly: ${f.unresolved.join("؛ ")}`);
  if (c.unresolved instanceof RegExp && !f.unresolved.some((u) => c.unresolved instanceof RegExp && c.unresolved.test(u))) problems.push(`not unresolved (expected ${c.unresolved})`);
  if (c.years && JSON.stringify([...f.years].sort()) !== JSON.stringify([...c.years].sort())) problems.push(`years: ${f.years.join("، ")}`);
  if (c.identifiers) for (const id of c.identifiers) if (!f.identifiers.some((x) => `${x.kind} ${x.number}` === id)) problems.push(`identifier missing: ${id}`);
  if (c.article !== undefined && JSON.stringify(K.namedArticle(c.q)) !== JSON.stringify(c.article)) problems.push(`article: ${JSON.stringify(K.namedArticle(c.q))}`);
  let judged: unknown = null;
  if (c.passage) {
    const j = F.judge(f, c.passage.text);
    judged = j;
    if (c.passage.lacking === null && j.lacking.length) problems.push(`passage lacks: ${j.lacking.join("؛ ")}`);
    if (c.passage.lacking instanceof RegExp && !j.lacking.some((l) => (c.passage!.lacking as RegExp).test(l))) problems.push(`passage not lacking ${c.passage.lacking} (lacks: ${j.lacking.join("؛ ") || "—"})`);
    if (c.passage.partial && !j.partial.some((x) => c.passage!.partial!.test(x))) problems.push(`passage partial not flagged ${c.passage.partial}`);
  }
  return { pass: !problems.length, problems, got: { places: keys(f.places), context: keys(f.contextPlaces), unresolved: f.unresolved, years: f.years, identifiers: f.identifiers, answer: f.answer, judged } };
}
