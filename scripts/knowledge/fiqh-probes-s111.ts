/** Stage 11.1: the Stage 11 independent review's fiqh probes (96, ALL SYNTHETIC TEST TEXTS, not quotations) and 12 new variants, with a verdict per case (WRONG_FIRM / OVER / ok). Run: npx tsx scripts/knowledge/fiqh-probes-s111.ts [group] */
import { extractStatements, compare, weigh, analyzeIssue } from "../../src/server/knowledge/fiqh/analyze";
import { conservative, factHedge, schoolOf } from "../../src/server/knowledge/fiqh/conservative";
import type { Fact, SourceRef } from "../../src/server/knowledge/fiqh/types";
const src = (refKind = "classical_fiqh", code = "A"): SourceRef => ({ chunkId: code, refCode: code, refKind, title: `نص اختبار ${code}`, author: null, edition: null, locator: "ص1", volume: null, page: "1", topic: null, status: "unreviewed", flags: [] } as unknown as SourceRef);
const F = (t: string): Fact => ({ text: t, status: "established" });
const QS = "ما حكم بيع الوقف إذا تعطلت منافعه؟";
const lost = [F("تعطلت منافع العقار كليًا"), F("لا شرط للواقف في البيع")];
const present = [F("منافع العقار قائمة"), F("لا شرط للواقف في البيع")];
const JUDGE = "ولا يجوز بيعه إلا بإذن الحاكم على الصحيح من المذهب. وعنه يجوز بيعه.";
const EXC = "ولا يجوz".length && "ولا يجوز بيعه إلا أن تتعطل منافعه.";
function run(id: string, texts: (string | [string, string])[], facts: Fact[], expect: string, q = QS) {
  const issue = analyzeIssue(q, facts);
  const all = texts.flatMap((t, i) => { const [k, x] = typeof t === "string" ? ["classical_fiqh", t] : t; return extractStatements(src(k, `S${i + 1}`), x, { question: q, facts, idPrefix: `ق${i + 1}` }); });
  const lex = weigh(all, issue, compare(all, issue));
  const c = conservative(issue, all);
  const L = lex.status === "weighed" ? `weighed:${lex.leaning}` : lex.status;
  const C = c.weighing.status === "weighed" ? `weighed:${c.weighing.leaning}` : c.weighing.status;
  console.log(`\n[${id}] EXPECT ${expect}\n  texts=${JSON.stringify(texts)}\n  facts=${JSON.stringify(facts.map((f) => f.text))}\n  lexical=${L}  conservative=${C}  frame=${c.frame.status}`);
  for (const s of c.statements) console.log(`   ${s.id} rank=${s.rank} pol=${s.polarity} eff=${s.effective} applies=${s.applies}${s.otherSchool ? ` other=«${s.otherSchool}»` : ""} school=${schoolOf(s)}${s.unclear ? ` unclear=«${s.unclear.slice(0, 50)}»` : ""} conds=${JSON.stringify(s.conditions.map((x) => [x.kind, x.text, x.status, x.byFact]))}`);
  console.log(`   notEstablished=${JSON.stringify(c.frame.notEstablished.map((g) => g.text))} reliedUpon=${JSON.stringify(c.frame.basis.filter((b) => b.reliedUpon).map((b) => b.statementId))}`);
  // stage 11.1 evaluator: WRONG_FIRM = a firm leaning the expectation forbids; OVER = abstained where a leaning was expected
  const relied = c.frame.basis.filter((b) => b.reliedUpon).map((b) => b.statementId);
  const otherRelied = c.statements.some((s) => (s.otherSchool || schoolOf(s) !== "hanbali") && relied.includes(s.id));
  let v = "ok";
  if (/never permit|no permit|no firm permit/.test(expect)) v = C === "weighed:permit" ? "WRONG_FIRM" : "ok";
  else if (/^no ruling/.test(expect)) v = C.startsWith("weighed:") ? "WRONG_FIRM" : "ok";
  else if (/no prohibit leaning/.test(expect)) v = C === "weighed:prohibit" || otherRelied ? "WRONG_FIRM" : "ok";
  else if (/^permit/.test(expect)) v = C === "weighed:permit" ? "ok" : C === "weighed:prohibit" ? "WRONG_FIRM" : "OVER";
  else if (/not relied upon|not hanbali|school unknown/.test(expect)) v = otherRelied || (C.startsWith("weighed:") && relied.length > 0 && c.statements.some((s) => relied.includes(s.id) && s.otherSchool)) ? "WRONG_FIRM" : "ok";
  console.log(`   VERDICT ${v}`);
  tally[v] = (tally[v] ?? 0) + 1; if (v !== "ok") bad.push(`${v} ${id} → ${C}`);
}
const tally: Record<string, number> = {}; const bad: string[] = [];
process.on("exit", () => { console.log(`\n== TALLY ${JSON.stringify(tally)} of ${Object.values(tally).reduce((a, b) => a + b, 0)}`); for (const b of bad) console.log("  " + b); });
const which = process.argv[2] ?? "all";
// ---- hedges in facts (judge) ----
if (which === "all" || which === "hedge") {
  const H: [string, string][] = [
    ["H1 applied (noun تقديم)", "تم تقديم طلب إذن إلى المحكمة"],
    ["H2 استأذن (asked permission)", "استأذن الناظر المحكمة في البيع"],
    ["H3 رفع طلب", "رفع الناظر طلب إذن للمحكمة"],
    ["H4 first-instance, appealed", "أذنت المحكمة في البيع واستُؤنف الحكم"],
    ["H5 overturned (نقض)", "أذنت المحكمة في البيع ونُقض الحكم لاحقًا"],
    ["H6 expired", "انتهت مدة إذن المحكمة بالبيع"],
    ["H7 ستأذن future", "ستأذن المحكمة في البيع الأسبوع القادم"],
    ["H8 من المتوقع", "من المنتظر أن تأذن المحكمة في البيع"],
    ["H9 أعتقد", "أعتقد أن المحكمة أذنت في البيع"],
    ["H10 حسب إفادة", "أفاد المستأجر بأن المحكمة أذنت في البيع"],
    ["H11 لست متأكدا", "لست متأكدًا من أن المحكمة أذنت"],
    ["H12 ادعاء noun", "بحسب ادعاء الناظر أذنت المحكمة في البيع"],
    ["H13 إن صح", "أذنت المحكمة في البيع إن صح الخبر"],
    ["H14 قد + future", "قد تأذن المحكمة في البيع"],
    ["H15 مسودة", "أُعدّت مسودة قرار بالإذن في البيع"],
    ["H16 الحكم غير نهائي", "صدر حكم ابتدائي بالإذن في البيع قابل للاستئناف"],
    ["H17 أوقف تنفيذ", "أذنت المحكمة ثم أُوقف تنفيذ الإذن"],
    ["H18 مشروط", "أذنت المحكمة في البيع بشرط موافقة الهيئة ولم توافق"],
    ["H19 تحت الدراسة with ة", "طلب الإذن تحت الدراسة"],
    ["H20 English-ish?", "الإذن قيد الدراسة لدى المحكمة"],
    ["H21 rejected noun رفض after", "انتهت المحكمة إلى رفض الإذن"],
    ["H22 عدم الموافقة", "قررت المحكمة عدم الموافقة على البيع"],
  ];
  for (const [id, f] of H) run(id, [JUDGE], [...lost, F(f)], "needs_facts (or prohibit) — never permit");
}
// ---- hedges on benefits ----
if (which === "all" || which === "benefit") {
  const B: [string, string, Fact[]][] = [
    ["B1 أكثر/معظم partial", "تعطلت معظم منافع العقار", []],
    ["B2 مؤقتا", "تعطلت منافع العقار مؤقتًا بسبب الصيانة", []],
    ["B3 past state", "كانت منافع العقار متعطلة وأُصلح", []],
    ["B4 تعطلت ثم أصلحت (و)", "تعطلت منافع العقار وأُعيد ترميمه وتأجيره", []],
    ["B5 سيتعطل", "ستتعطل منافع العقار بعد هدمه المقرر", []],
    ["B6 يدّعي noun-form مدعى", "التعطل المدعى لمنافع العقار", []],
    ["B7 حسب قول", "حسب قول المستأجر تعطلت منافع العقار", []],
    ["B8 نصف", "تعطل نصف منافع العقار", []],
    ["B9 الطابق الأول", "تعطلت منافع الطابق الأول من العقار", []],
    ["B10 مهدد", "العقار مهدد بالتعطل", []],
    ["B11 أشيع", "أُشيع أن منافع العقار تعطلت", []],
    ["B12 على ما يبدو", "تعطلت منافع العقار على ما يظهر", []],
  ];
  for (const [id, f] of B) run(id, [EXC], [F(f), F("لا شرط للواقف في البيع")], "needs_facts — never permit");
}
// ---- over-abstention: plain facts read as hedged ----
if (which === "all" || which === "over") {
  const O: [string, string[], string][] = [
    ["O1 ثم as sequence", ["تعطلت منافع العقار كليًا", "لا شرط للواقف في البيع", "تقدم الناظر بطلب ثم أذنت المحكمة في البيع"], "permit (JUDGE)"],
    ["O2 granted on request (طلب)", ["تعطلت منافع العقار كليًا", "لا شرط للواقف في البيع", "أذنت المحكمة في البيع بناء على طلب الناظر"], "permit"],
    ["O3 شكلت لجنة", ["تعطلت منافع العقار كليًا", "لا شرط للواقف في البيع", "شكلت المحكمة لجنة وأذنت في البيع"], "permit"],
    ["O4 يشكل خطرا in benefits fact", ["تعطلت منافع العقار كليًا ويشكل خطرًا على المارة", "لا شرط للواقف في البيع", "أذنت المحكمة في البيع"], "permit"],
    ["O5 حتى الآن plain lost", ["تعطلت منافع العقار كليًا منذ سنتين حتى الآن", "لا شرط للواقف في البيع", "أذنت المحكمة في البيع"], "permit"],
    ["O6 لم يعد ممكنا (plain loss)", ["لم يعد الانتفاع بالعقار ممكنًا", "لا شرط للواقف في البيع", "أذنت المحكمة في البيع"], "permit"],
    ["O7 قدم التقرير", ["قدم المهندس تقريرًا يثبت تعطل منافع العقار كليًا", "لا شرط للواقف في البيع", "أذنت المحكمة في البيع"], "permit"],
    ["O8 رفض المستأجر irrelevant", ["تعطلت منافع العقار كليًا", "لا شرط للواقف في البيع", "أذنت المحكمة في البيع رغم رفض المستأجر"], "permit"],
    ["O9 a judge fact with سوف? no: إذا in fact", ["تعطلت منافع العقار كليًا", "لا شرط للواقف في البيع", "أذنت المحكمة في البيع وأذنت كذلك بالشراء إذا وجد البدل"], "permit"],
    ["O10 بعض in other sense", ["تعطلت منافع العقار كليًا بعد الحريق", "لا شرط للواقف في البيع", "أذنت المحكمة في البيع بعد اطلاعها على بعض التقارير"], "permit"],
    ["O11 الغي عقد الإيجار", ["تعطلت منافع العقار كليًا وأُلغي عقد الإيجار", "لا شرط للواقف في البيع", "أذنت المحكمة في البيع"], "permit"],
    ["O12 date + ؟ in fact?", ["تعطلت منافع العقار كليًا", "لا شرط للواقف في البيع", "أذنت المحكمة في البيع (القرار رقم 12)"], "permit"],
  ];
  for (const [id, fs, e] of O) run(id, [JUDGE], fs.map(F), e);
  for (const t of ["تقدم الناظر بطلب ثم أذنت المحكمة", "شكلت المحكمة لجنة وأذنت", "تعطلت منافع العقار ويشكل خطرا", "لم يعد الانتفاع بالعقار ممكنا", "قدم المهندس تقريرا", "اشكالية الصك حلت", "أذنت المحكمة في البيع حسب الطلب"]) console.log(`factHedge(«${t}») = ${factHedge(F(t))}`);
}
// ---- conditions / exceptions in unread words ----
if (which === "all" || which === "cond") {
  const C: [string, string, Fact[], string][] = [
    ["C1 في حالة (ة)", "ويجوز بيعه في حالة تعطل منافعه.", present, "no permit"],
    ["C2 متى (ى)", "ويجوز بيعه متى تعطلت منافعه.", present, "no permit"],
    ["C3 حين", "ويجوز بيعه حين تتعطل منافعه.", present, "no permit"],
    ["C4 بعد", "ويجوز بيعه بعد تعطل منافعه.", present, "no permit"],
    ["C5 لدى", "ويجوز بيعه لدى تعطل منافعه.", present, "no permit"],
    ["C6 شريطة (ة)", "ويجوز بيعه شريطة تعطل منافعه.", present, "no permit"],
    ["C7 على أن", "ويجوز بيعه على أن تكون منافعه متعطلة.", present, "no permit"],
    ["C8 مع (inverse)", "ولا يجوز بيعه مع قيام منافعه، ويجوز مع تعطلها.", present, "prohibit or none — never permit"],
    ["C9 باستثناء (mosque)", "ويجوز بيعه إذا تعطلت منافعه باستثناء المسجد.", [...lost, F("العين الموقوفة مسجد")], "no permit"],
    ["C10 بخلاف (mosque)", "ويجوز بيعه إذا تعطلت منافعه بخلاف المسجد.", [...lost, F("العين الموقوفة مسجد")], "no permit"],
    ["C11 غير (mosque)", "ويجوز بيع الوقف غير المسجد إذا تعطلت منافعه.", [...lost, F("العين الموقوفة مسجد")], "no permit"],
    ["C12 دون المسجد", "ويجوز بيعه إذا تعطلت منافعه دون المسجد.", [...lost, F("العين الموقوفة مسجد")], "no permit"],
    ["C13 حاشا", "ويجوز بيعه إذا تعطلت منافعه حاشا المسجد.", [...lost, F("العين الموقوفة مسجد")], "no permit"],
    ["C14 لكن not mosque", "ويجوز بيعه إذا تعطلت منافعه، لكن المسجد لا يباع.", [...lost, F("العين الموقوفة مسجد")], "no permit"],
    ["C15 فيما إذا (parsed?)", "وإنما يجوز بيعه فيما إذا تعطلت منافعه.", present, "no permit"],
    ["C16 إن كان (hamza)", "ويجوز بيعه إن كانت منافعه متعطلة.", present, "no permit"],
    ["C17 كلما? no; اذا ما", "ويجوز بيعه إذا ما تعطلت منافعه.", present, "no permit"],
    ["C18 only إنما", "إنما يباع إذا خرب.", present, "no permit"],
    ["C19 تعطل as noun subject", "وتعطل المنافع مجوز لبيعه.", present, "no permit"],
    ["C20 ولا يجوز... إلا لضرورة", "ولا يجوز بيعه إلا لضرورة.", present, "no firm permit"],
  ];
  for (const [id, t, f, e] of C) run(id, [t], f, e);
}
// ---- interrogatives ----
if (which === "all" || which === "q") {
  for (const [id, t] of [
    ["Q1 أيُباع", "أيُباع الوقف إذا تعطلت منافعه"], ["Q2 فهل", "فهل يجوز بيعه إذا تعطلت منافعه"], ["Q3 أليس", "أليس يجوز بيعه إذا تعطلت منافعه"],
    ["Q4 كيف لا", "كيف لا يجوز بيعه إذا تعطلت منافعه"], ["Q5 ما بال", "فما بال من يقول لا يجوز بيعه إذا تعطلت منافعه"],
    ["Q6 فإن قيل", "فإن قيل: يجوز بيعه إذا تعطلت منافعه، قلنا: لا يجوز"], ["Q7 فإن قال قائل", "فإن قال قائل يجوز بيعه إذا تعطلت منافعه"],
    ["Q8 أيجوز after و", "وأيجوز بيعه إذا تعطلت منافعه"], ["Q9 أفلا", "أفلا يجوز بيعه إذا تعطلت منافعه"], ["Q10 لم لا", "لم لا يجوز بيعه إذا تعطلت منافعه"],
    ["Q11 أم", "أيجوز بيعه أم لا إذا تعطلت منافعه"], ["Q12 سُئل", "وسئل عن الوقف إذا تعطلت منافعه هل يجوز بيعه"],
    ["Q13 أَوَليس", "أوليس يجوز بيعه إذا تعطلت منافعه"], ["Q14 مسألة heading", "مسألة: يجوز بيعه إذا تعطلت منافعه أم لا"],
  ] as const) run(id, [t], lost, "no ruling");
}
// ---- other schools ----
if (which === "all" || which === "school") {
  const S: [string, string][] = [
    ["S1 ذهب الشافعية (ة) w/o عندهم", "ويجوز بيعه إذا تعطلت منافعه. وذهب الشافعية إلى أنه لا يجوز بيعه، وهو المذهب."],
    ["S2 الحنفية (ة) قالوا", "ويجوز بيعه إذا تعطلت منافعه. والحنفية يقولون لا يجوز بيعه وهو المذهب."],
    ["S3 الإمام الشافعي", "ويجوز بيعه إذا تعطلت منافعه. ومنع منه الإمام الشافعي، وهو المذهب."],
    ["S4 أبو حنيفة with هو المذهب لديهم", "ويجوز بيعه إذا تعطلت منافعه. ولا يجوز بيعه عند أبي حنيفة، وهو المذهب لديهم."],
    ["S5 السادة المالكية", "ويجوز بيعه إذا تعطلت منافعه. والسادة المالكية على أنه لا يجوز بيعه، وهو المذهب."],
    ["S6 الشافعيون", "ويجوز بيعه إذا تعطلت منافعه. والشافعيون لا يجيزون بيعه، والصحيح من المذهب عندهم المنع."],
    ["S7 النووي", "ويجوز بيعه إذا تعطلت منافعه. وقال النووي: لا يجوز بيعه، وهو المذهب."],
    ["S8 الجمهور", "ولا يجوز بيعه وهو المذهب عند الجمهور. وعنه يجوز."],
    ["S9 الحنفي in other sense? صاحب الهداية", "ويجوز بيعه إذا تعطلت منافعه. وقال صاحب الهداية: لا يجوز بيعه، وهو المذهب."],
    ["S10 الزيدية/الإمامية", "ويجوز بيعه إذا تعطلت منافعه. وقالت الإمامية: لا يجوز بيعه وهو المذهب."],
    ["S11 ابن عابدين", "ويجوز بيعه إذا تعطلت منافعه. قال ابن عابدين: لا يجوز بيعه، وهو المذهب."],
    ["S12 Hanbali «المذهب» only (control)", "ويجوز بيعه إذا تعطلت منافعه على الصحيح من المذهب."],
    ["S13 «قول مالك» negative", "ولا يجوز بيعه وهو المذهب، وقول مالك فيه مثله."],
  ];
  for (const [id, t] of S) run(id, [t], lost, "other school never mutamad; no prohibit leaning");
  run("S14 contemporary book quoting Shafi'i «وهو المذهب»", [["contemporary_book", "قال النووي في المجموع لا يجوز بيع الوقف إذا تعطلت منافعه وهو المذهب."]], lost, "unknown school, not relied upon");
  run("S15 contemporary author naming «مذهب الحنابلة» but quoting Malikiyya", [["contemporary_book", "والراجح عند المالكية أنه لا يجوز بيع الوقف إذا تعطلت منافعه، وهو المذهب الحنبلي عند بعضهم."]], lost, "not hanbali");
  run("S16 classical book w/ Shafi'i named only by book author", [["classical_fiqh", "قال في المنهاج: لا يجوز بيع الوقف إذا تعطلت منافعه، وهو المذهب."]], lost, "Shafi'i book (Minhaj) — school unknown");
}

// ---- stage 11.1: NEW variants of the three wrong firm rulings (C4 «بعد», C19 derived form, Q5 «فما بال»), not seen before ----
if (which === "all" || which === "s111") {
  const V: [string, string, Fact[], string][] = [
    ["V1 مبيح (derived, permit)", "وخراب الوقف مبيح لبيعه.", present, "no permit"],
    ["V2 مجيز", "وتعطل المنفعة مجيز للاستبدال.", present, "no permit"],
    ["V3 موجب (derived, oblige)", "وتعطل منافعه موجب لبيعه.", present, "no ruling"],
    ["V4 مسوغ + جواز standalone control", "ويجوز بيعه.", present, "permit"],
    ["V5 بعد + noun", "ويجوز بيعه بعد خرابه.", present, "no permit"],
    ["V6 من بعد", "ويباع من بعد تعطل منافعه.", present, "no permit"],
    ["V7 بعدما", "ويجوز بيعه بعدما تتعطل منافعه.", present, "no permit"],
    ["V8 فما بال", "فما بال من منع بيعه وقد تعطلت منافعه؟", present, "no ruling"],
    ["V9 وما بال without ؟", "وما بال الناظر يمنع بيعه إذا خرب", present, "no ruling"],
    ["V10 فكيف يجوز", "فكيف يجوز بيعه وهو وقف", present, "no ruling"],
    ["V11 الأصح only", "وهو الأصح.", present, "no ruling"],
    ["V12 تجويز noun", "وفي تجويز بيعه نظر.", present, "no permit"],
  ];
  for (const [id, t, f, e] of V) run(id, [t], f, e);
}
