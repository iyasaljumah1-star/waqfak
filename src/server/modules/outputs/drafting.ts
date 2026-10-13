/**
 * Document drafting from structured answers (PURE): the will (W01) and the waqf deed (T03).
 *
 * Each clause is written from the client's own choices in the service form, following the drafting principles of the
 * project's reference files (cited on each clause). Nothing is invented: a missing value is printed as an explicit
 * «[يُستكمل: …]» placeholder and raises a gap naming the field and who must complete it. Rulings are not issued
 * here — anything that needs a sharia or legal judgment is left to the independent reviewer of the output.
 */
import type { OutputBlock, OutputGap, Provenance } from "@/server/db/schema/operations";

type Row = Record<string, string>;
export type DraftInput = { keys: Record<string, string>; tables: Record<string, Row[]>; attached: Record<string, number>; requesterName: string };
export type DraftCheck = { label: string; ok: boolean; detail?: string };
export type Drafted = { title: string; clauses: Extract<OutputBlock, { type: "clause" }>[]; signatures: { role: string; name: string }[]; checks: DraftCheck[]; gaps: OutputGap[] };

const REF = {
  draft1: "الدليل الإرشادي لصياغة وثيقة الوقف — المبدأ الأول (بنود الوثيقة)",
  draft2: "الدليل الإرشادي لصياغة وثيقة الوقف — المبدأ الثاني (حال الوصايا السابقة)",
  draft11: "الدليل الإرشادي لصياغة وثيقة الوقف — المبادئ 11–14 (وصف الأصل وملكيته وما يلحق به والمشاع)",
  draft26: "الدليل الإرشادي لصياغة وثيقة الوقف — المبدآن 26–27 (انتفاع الواقف، والتسوية بين المستحقين)",
  q16: "100 سؤال وجواب — س16 وس75 وس77 (الوقف المعلق على الموت وحد الثلث)",
  q28: "100 سؤال وجواب — س28 (وقف المرهون)",
  q76: "100 سؤال وجواب — س76 (تعديل الشروط بعد الانعقاد)",
  waqifs: "الدليل الإرشادي للواقفين (توثيق الوصية والإشهاد، وصياغة صك الوقفية)",
  nazara: "لائحة تنظيم أعمال النظارة (واجبات الناظر)",
};

const fill = (what: string) => `[يُستكمل: ${what}]`;
const num = (v: string | undefined) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const money = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ريال سعودي`;
const pct = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}٪`;
const ORD = ["الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة", "السادسة", "السابعة", "الثامنة", "التاسعة", "العاشرة"];
const ordinal = (n: number) => ORD[n - 1] ?? `رقم ${n}`;

class Doc {
  clauses: Drafted["clauses"] = [];
  gaps: OutputGap[] = [];
  checks: DraftCheck[] = [];
  /** Value of a field, or a placeholder + gap. */
  need(k: Record<string, string>, field: string, what: string, opts: { severity?: OutputGap["severity"]; owner?: OutputGap["owner"] } = {}) {
    const v = k[field]?.trim();
    if (v) return v;
    this.gap(`field:${field}`, `لم يُحدد: ${what}`, { field, ...opts });
    return fill(what);
  }
  gap(key: string, label: string, o: { severity?: OutputGap["severity"]; owner?: OutputGap["owner"]; field?: string; hint?: string } = {}) {
    if (this.gaps.some((g) => g.key === key)) return;
    const owner = o.owner ?? "client";
    this.gaps.push({ key, label, severity: o.severity ?? "blocking", owner, field: o.field, hint: o.hint ?? (owner === "client" ? `يستكمله العميل${o.field ? " في نموذج الطلب" : ""} عبر سجل النواقص.` : owner === "specialist" ? "يستكمله المختص في نص البند بعد الرجوع للعميل." : undefined) });
  }
  add(key: string, title: string, text: string, refs: string[], prov: Provenance = "computed") {
    this.clauses.push({ type: "clause", key, n: this.clauses.length + 1, title, text, generated: text, prov, refs });
  }
}

// ───────────────────────── Will (W01) ─────────────────────────

const KIND_VERB: Record<string, (r: string) => string> = {
  waqf: (r) => `وقفًا بعد وفاتي على ${r}`,
  charity: (r) => `صدقةً لـ${r}`,
  person: (r) => `لـ${r}`,
  other: (r) => `لـ${r}`,
};
const EXEC_REL: Record<string, string> = { heir: "وهو من ورثتي", relative: "وهو من أقاربي من غير الورثة", other: "", entity: "" };
const SUCCESSION_WILL: Record<string, string> = {
  eldest: "الأصلح فالأصلح من الموقوف عليهم",
  named: "من يسميه الناظر قبله كتابةً",
  board: "من ينتخبه مجلس النظارة",
  authority: "من تعيّنه الجهة المختصة",
};

export function draftWill(x: DraftInput): Drafted {
  const k = x.keys;
  const d = new Doc();
  const name = d.need(k, "testatorName", "اسم الموصي");
  const id = d.need(k, "testatorId", "رقم هوية الموصي");
  d.add("preamble", "الديباجة", `أنا ${name}، صاحب الهوية الوطنية رقم ${id}، أوصي وأنا بكامل أهليتي واختياري بما يلي:`, [REF.draft1], "client");

  // Previous wills (drafting guide, principle 2)
  if (k.hasPreviousWill === "yes") {
    const date = d.need(k, "previousWillDate", "تاريخ الوصية السابقة");
    if (k.previousWillAction === "revoke") d.add("previous", "الوصايا السابقة", `أُلغي جميع وصاياي السابقة، ومنها وصيتي المؤرخة في ${date}، وتحل هذه الوصية محلها.`, [REF.draft2], "client");
    else if (k.previousWillAction === "amend") d.add("previous", "الوصايا السابقة", `تُعدَّل وصيتي المؤرخة في ${date} بما ورد في هذه الوصية، ويبقى ما لم يُعدَّل منها نافذًا.`, [REF.draft2], "client");
    else {
      d.add("previous", "الوصايا السابقة", `${fill("حكم الوصية السابقة: إلغاء أو تعديل")} — وصيتي المؤرخة في ${date}.`, [REF.draft2]);
      d.gap("field:previousWillAction", "لم يُحدد حكم الوصية السابقة (إلغاء أو تعديل)", { field: "previousWillAction" });
    }
    if (!x.attached.previousWill) d.gap("doc:previousWill", "الوصية السابقة لم تُرفق", { severity: "warning", hint: "تُطلب من العميل لمطابقة التاريخ والمضمون." });
  } else if (k.hasPreviousWill === "no") {
    d.add("previous", "الوصايا السابقة", "أُقرّ بأنه لا وصية سابقة لي.", [REF.draft2], "client");
  } else d.gap("field:hasPreviousWill", "لم يُبيّن هل للموصي وصية سابقة", { field: "hasPreviousWill" });

  // Bequests
  const rows = x.tables.bequests ?? [];
  if (!rows.length) d.gap("field:bequests", "لا وصايا في جدول «ما توصي به»", { field: "bequests" });
  let sharePct = 0;
  let amounts = 0;
  const heirs: string[] = [];
  rows.forEach((r, i) => {
    const recipient = r.recipient?.trim() || fill(`الموصى له في الصف ${i + 1}`);
    if (!r.recipient?.trim()) d.gap(`field:bequests:${i}:recipient`, `الصف ${i + 1} من الوصايا بلا موصى له`, { field: "bequests" });
    let what: string;
    if (r.basis === "share") {
      const p = num(r.percent);
      if (p === null) { what = fill("النسبة"); d.gap(`field:bequests:${i}:percent`, `الصف ${i + 1}: النسبة غير محددة`, { field: "bequests" }); }
      else { sharePct += p; what = `بنسبة ${pct(p)} من تركتي`; }
    } else if (r.basis === "amount") {
      const a = num(r.amount);
      if (a === null) { what = fill("المبلغ"); d.gap(`field:bequests:${i}:amount`, `الصف ${i + 1}: المبلغ غير محدد`, { field: "bequests" }); }
      else { amounts += a; what = `بمبلغ ${money(a)}`; }
    } else if (r.basis === "asset") {
      what = r.asset?.trim() ? `بـ${r.asset.trim()}` : fill("وصف العين");
      if (!r.asset?.trim()) d.gap(`field:bequests:${i}:asset`, `الصف ${i + 1}: العين الموصى بها غير موصوفة`, { field: "bequests" });
    } else { what = fill("مقدار الوصية"); d.gap(`field:bequests:${i}:basis`, `الصف ${i + 1}: مقدار الوصية غير محدد`, { field: "bequests" }); }
    const verb = (KIND_VERB[r.kind] ?? KIND_VERB.other)(recipient);
    d.add(`bequest:${i + 1}`, `الوصية ${ordinal(i + 1)}`, `أوصي ${what} ${verb}.`, [REF.q16], "client");
    if (r.relation === "yes") heirs.push(recipient);
  });

  // Third of the estate (Q100 Q16/Q75/Q77)
  const estate = num(k.estimatedEstate);
  const ofEstate = estate && estate > 0 ? sharePct + (amounts / estate) * 100 : sharePct;
  const known = !amounts || (estate !== null && estate > 0);
  const over = ofEstate > 100 / 3 + 1e-9;
  d.checks.push({ label: "مجموع الوصايا في حدود ثلث التركة", ok: known && !over, detail: known ? `المجموع ${pct(Math.round(ofEstate * 100) / 100)} من التركة${amounts && estate ? " (المبالغ محسوبة من تقدير التركة الذي أدخله العميل)" : ""}` : "في الوصايا مبالغ محددة ولم يُقدَّر إجمالي التركة؛ تعذّر الحساب" });
  if (sharePct > 100) d.gap("share_over_100", `مجموع النسب الموصى بها ${pct(sharePct)} يتجاوز التركة كلها`, { field: "bequests" });
  if (over || !known) {
    d.add("third", "حد الثلث", "وما زاد من وصاياي على ثلث تركتي فلا ينفذ إلا بإجازة الورثة.", [REF.q16]);
    d.gap(over ? "third_over" : "third_unknown", over ? `الوصايا تتجاوز ثلث التركة (${pct(Math.round(ofEstate * 100) / 100)})` : "تعذّر التحقق من حد الثلث: لم يُقدَّر إجمالي التركة", { severity: "warning", owner: over ? "specialist" : "client", field: over ? "bequests" : "estimatedEstate", hint: over ? "أُضيف بند حد الثلث؛ يراجع المستشار الشرعي أثره على كل وصية قبل الاعتماد." : "يُطلب من العميل تقدير التركة، أو يقرّ المستشار ببقاء بند حد الثلث." });
  }
  d.checks.push({ label: "لا وصية لأحد الورثة", ok: !heirs.length, detail: heirs.length ? `وصية لـ: ${heirs.join("، ")}` : undefined });
  if (heirs.length) d.gap("heir_bequest", `وصية لوارث: ${heirs.join("، ")}`, { severity: "warning", owner: "specialist", hint: "يراجع المستشار الشرعي حكمها ونفاذها ويكتب ملاحظته قبل الاعتماد." });

  // Waqf after death
  const waqfRows = rows.filter((r) => r.kind === "waqf");
  if (k.includesWaqf === "yes") {
    if (!waqfRows.length) d.gap("waqf_missing_row", "اختار الموصي الوقف بعد الوفاة ولا صف «وقف بعد الوفاة» في جدول الوصايا", { field: "bequests" });
    const masarif = x.tables.waqfMasarif ?? [];
    if (!masarif.length) d.gap("field:waqfMasarif", "مصارف الوقف بعد الوفاة غير محددة", { field: "waqfMasarif" });
    const shares = masarif.map((m) => num(m.share)).filter((n): n is number => n !== null);
    const total = shares.reduce((a, b) => a + b, 0);
    d.checks.push({ label: "أنصبة مصارف الوقف لا تتجاوز 100٪", ok: total <= 100, detail: shares.length ? `المجموع ${pct(total)}` : "الأنصبة غير محددة؛ تُقسم وفق ما يبينه النص" });
    if (total > 100) d.gap("waqf_shares_over", `مجموع أنصبة مصارف الوقف ${pct(total)}`, { field: "waqfMasarif" });
    const list = masarif.map((m, i) => `${i + 1}) ${m.beneficiary || fill("المصرف")}${num(m.share) !== null ? ` بنسبة ${pct(num(m.share)!)} من الغلة` : ""}`).join("؛ ");
    const wname = k.waqfName?.trim() ? `يُسمّى «${k.waqfName.trim()}»` : "";
    if (!k.waqfName?.trim()) d.gap("field:waqfName", "اسم الوقف بعد الوفاة غير محدد", { severity: "warning", field: "waqfName" });
    const nazir = d.need(k, "waqfNazir", "ناظر الوقف بعد الوفاة");
    const succ = SUCCESSION_WILL[k.waqfSuccession] ?? d.need(k, "waqfSuccession", "طريقة استخلاف الناظر");
    d.add("waqf", "الوقف بعد الوفاة", `ويكون ما أوصيت بوقفه وقفًا${wname ? ` ${wname}` : ""}، تُصرف غلته على: ${list || fill("المصارف")}. ويتولى نظارته ${nazir}، فإن خلت النظارة تولاها ${succ}.`, [REF.q16, REF.waqifs], "client");
  } else if (waqfRows.length) {
    d.gap("waqf_inconsistent", "في جدول الوصايا وقف بعد الوفاة، وأجاب الموصي بأن وصاياه لا تتضمن وقفًا", { field: "includesWaqf" });
  }

  // Executor
  const ex = d.need(k, "executorName", "اسم الوصي");
  const rel = EXEC_REL[k.executorRelation] ? `، ${EXEC_REL[k.executorRelation]}` : "";
  const alt = k.alternateExecutor?.trim();
  d.add("executor", "منفذ الوصية", `أُسند تنفيذ هذه الوصية إلى ${ex}${rel}${alt ? `، فإن تعذّر قيامه بها فإلى ${alt}` : ""}.`, [REF.waqifs], "client");

  // Documentation
  const witnesses = (x.tables.witnesses ?? []).filter((w) => w.name?.trim());
  if (k.documentation === "najiz") d.add("documentation", "التوثيق", "تُوثَّق هذه الوصية لدى الجهة المختصة عبر منصة «ناجز».", [REF.waqifs]);
  else if (k.documentation === "witnesses") {
    d.add("documentation", "الإشهاد", `أُشهد على هذه الوصية ${witnesses.length ? witnesses.map((w) => w.name.trim()).join("، ") : fill("أسماء الشهود")}، على أن تُوثَّق لدى الجهة المختصة لاحقًا.`, [REF.waqifs], "client");
    if (!witnesses.length) d.gap("field:witnesses", "لا شهود في جدول الشهود", { field: "witnesses" });
  } else d.gap("field:documentation", "طريقة توثيق الوصية غير محددة", { field: "documentation" });
  d.checks.push({ label: "الوصية غير الموثقة مشهود عليها", ok: k.documentation === "najiz" || witnesses.length > 0 });

  d.add("closing", "الختام", "حُررت هذه الوصية بتاريخ (يُكتب عند التوقيع)، وهي وصيتي الوحيدة النافذة.", [REF.draft2]);
  const signatures = [{ role: "الموصي", name: k.testatorName?.trim() || x.requesterName }, ...witnesses.map((w, i) => ({ role: `الشاهد ${i + 1}`, name: w.name.trim() }))];
  return { title: "نص الوصية", clauses: d.clauses, signatures, checks: d.checks, gaps: d.gaps };
}

// ───────────────────────── Waqf deed (T03) ─────────────────────────

const WAQF_KIND_AR: Record<string, string> = { general: "عامًّا (خيريًّا)", ahli: "أهليًّا (ذُرّيًّا)", mixed: "مشتركًا" };
const DIVISION: Record<string, string> = { equal: "بالتساوي بينهم", inheritance: "للذكر مثل حظ الأنثيين", na: "" };
const SUCCESSION_DEED: Record<string, string> = { ...SUCCESSION_WILL };

export function draftDeed(x: DraftInput): Drafted {
  const k = x.keys;
  const d = new Doc();
  const waqif = d.need(k, "waqifName", "اسم الواقف");
  const id = d.need(k, "waqifId", "رقم هوية الواقف");
  const kind = WAQF_KIND_AR[k.waqfKind];
  if (!kind) d.gap("field:waqfKind", k.waqfKind === "undecided" ? "نوع الوقف لم يُحدد بعد (عام أو أهلي أو مشترك)" : "نوع الوقف غير محدد", { field: "waqfKind" });
  d.add("preamble", "المقدمة وبيانات الواقف", `أُقرّ أنا ${waqif}، صاحب الهوية الوطنية رقم ${id}، وأنا بكامل أهليتي واختياري، بأني أوقفت الأصل المبيّن في هذه الوثيقة وقفًا ${kind ?? fill("نوع الوقف")}، تحبيسًا لأصله وتسبيلًا لمنفعته، على الشروط الآتية.`, [REF.draft1], "client");

  // Asset (principles 11–14; Q100 Q28)
  const desc = d.need(k, "assetDescription", "وصف الأصل بما يميزه");
  const deedNo = d.need(k, "ownershipDeedNo", "رقم صك الملكية");
  const deedDate = k.ownershipDeedDate ? ` وتاريخ ${k.ownershipDeedDate}` : "";
  const part = k.share === "share" ? `حصة مشاعة نسبتها ${num(k.sharePercent) !== null ? pct(num(k.sharePercent)!) : fill("نسبة الحصة")} منه` : k.share === "whole" ? "كامل الأصل" : fill("كامل الأصل أو حصة منه");
  if (k.share === "share" && num(k.sharePercent) === null) d.gap("field:sharePercent", "نسبة الحصة المشاعة غير محددة", { field: "sharePercent" });
  const app = k.appurtenances === "all" ? "بجميع حقوقه وما يلحق به وما فيه" : k.appurtenances === "except" ? `ويُستثنى منه: ${k.exceptionPart?.trim() || fill("الجزء المستثنى")}` : "";
  d.add("asset", "الأصل الموقوف", `الأصل الموقوف: ${desc}، المملوك للواقف بموجب الصك رقم ${deedNo}${deedDate}. ويشمل الوقف ${part}${app ? `، ${app}` : ""}.`, [REF.draft11], "client");
  d.checks.push({ label: "الأصل مسجل باسم الواقف بصك ساري", ok: k.registeredToWaqif === "yes" });
  if (k.registeredToWaqif !== "yes") d.gap("ownership", "الأصل غير مسجل باسم الواقف بصك ساري (أو لم يُجب)", { field: "registeredToWaqif", hint: "لا يُصاغ الوقف على أصل لا يملكه الواقف؛ يُستكمل ما يثبت الملكية." });
  if (!x.attached.ownership) d.gap("doc:ownership", "صك ملكية الأصل لم يُرفق", { hint: "يرفعه العميل في خانة المستند." });
  d.checks.push({ label: "الأصل غير مرهون أو أُرفقت موافقة المرتهن", ok: k.mortgaged === "no" || (k.mortgaged === "yes" && !!x.attached.mortgagee) });
  if (k.mortgaged === "yes" && !x.attached.mortgagee) d.gap("mortgaged", "الأصل مرهون ولم تُرفق موافقة المرتهن", { hint: "100 سؤال س28: لا يوقف المرهون إلا بعد سداد الرهن أو موافقة المرتهن." });
  else if (k.mortgaged === "yes") d.gap("mortgagee_check", "الأصل مرهون: تحقق من موافقة المرتهن المرفقة", { severity: "warning", owner: "team" });

  // Name
  d.add("name", "اسم الوقف", `يُسمّى هذا الوقف «${d.need(k, "waqfName", "اسم الوقف")}».`, [REF.draft1], "client");

  // Masarif and tiers (principles 26–27)
  const rows = (x.tables.masarif ?? []).slice().sort((a, b) => (num(a.tier) ?? 99) - (num(b.tier) ?? 99));
  if (!rows.length) d.gap("field:masarif", "المصارف غير محددة", { field: "masarif" });
  const tiers = [...new Set(rows.map((r) => num(r.tier) ?? 0))];
  const reserve = num(k.reservePercent);
  const parts = tiers.map((t, i) => {
    const people = rows.filter((r) => (num(r.tier) ?? 0) === t);
    const sum = people.map((p) => num(p.share)).filter((n): n is number => n !== null).reduce((a, b) => a + b, 0);
    if (sum > 100) d.gap(`tier_over:${t}`, `مجموع أنصبة الطبقة ${t} ${pct(sum)}`, { field: "masarif" });
    const who = people.map((p) => `${p.beneficiary || fill("المستحق")}${num(p.share) !== null ? ` (${pct(num(p.share)!)} من الغلة)` : ""}${DIVISION[p.division] ? ` ${DIVISION[p.division]}` : ""}`).join("، و");
    return i === 0 ? `على ${who}` : `فإن انقرضوا أو انقطعوا فعلى ${who}`;
  });
  const alt = d.need(k, "alternateMasraf", "المصرف البديل عند انقطاع المستحقين");
  d.checks.push({ label: "أنصبة كل طبقة لا تتجاوز 100٪", ok: !d.gaps.some((g) => g.key.startsWith("tier_over:")) });
  d.add("masarif", "المصارف وترتيبها", `تُصرف غلة الوقف${reserve !== null ? ` بعد استقطاع ${pct(reserve)} من صافي الريع لعمارة الوقف وصيانته وتنميته` : ""} ${parts.join("؛ ") || fill("المصارف")}؛ فإن انقطع المستحقون جميعًا صُرفت الغلة إلى ${alt}.${reserve === null ? " ويُقدّر الناظر ما يلزم لعمارة الوقف وصيانته قبل الصرف على المستحقين." : ""}`, [REF.draft1, REF.draft26], "client");

  // Exception (principle 26)
  if (k.selfBenefit === "yes") {
    const scope = k.selfBenefitScope === "all" ? "غلة الوقف كاملة" : k.selfBenefitScope === "use" ? "السكنى في الأصل أو الانتفاع بعينه" : k.selfBenefitScope === "part" ? `جزءًا من غلة الوقف مقداره ${fill("مقدار الجزء المستثنى")}` : fill("مقدار الانتفاع");
    if (k.selfBenefitScope === "part") d.gap("self_benefit_amount", "مقدار ما يستثنيه الواقف من الغلة لم يُحدد", { owner: "specialist", hint: "يُسأل الواقف عن المقدار وآلية الانتفاع، ويُكتب في نص البند (الدليل: المبدأ 26)." });
    d.add("exception", "استثناء الانتفاع", `أستثني لنفسي مدة حياتي ${scope}، ثم يُصرف ذلك بعد وفاتي على المصارف المبيّنة في هذه الوثيقة.`, [REF.draft26], "client");
  } else if (k.selfBenefit === "no") d.add("exception", "استثناء الانتفاع", "لا يستثني الواقف لنفسه شيئًا من غلة الوقف أو منفعته.", [REF.draft26], "client");
  else d.gap("field:selfBenefit", "لم يُبيّن هل يستثني الواقف الانتفاع", { field: "selfBenefit" });

  // Nazara
  const succ = SUCCESSION_DEED[k.succession] ?? d.need(k, "succession", "طريقة استخلاف الناظر");
  let nazir: string;
  if (k.nazirType === "self") nazir = "الواقف نفسه مدة حياته";
  else if (k.nazirType === "named" || k.nazirType === "entity") nazir = d.need(k, "nazirName", "اسم الناظر أو الجهة");
  else if (k.nazirType === "board") nazir = `مجلس نظارة من ${num(k.boardSize) ?? fill("عدد الأعضاء")} أعضاء`;
  else nazir = d.need(k, "nazirType", "من يتولى النظارة");
  d.add("nazara", "النظارة", `يتولى نظارة الوقف ${nazir}، فإن خلت النظارة تولاها ${succ}.`, [REF.draft1, REF.waqifs], "client");

  // Duties of the nazir
  const inv = k.investmentAllowed === "yes" ? "وللناظر استثمار أصول الوقف وتنميتها بما يحقق مصلحته وفق الأنظمة والضوابط المنظمة لاستثمار الأوقاف." : k.investmentAllowed === "no" ? "ولا يأذن الواقف للناظر في استثمار أصول الوقف." : fill("الإذن بالاستثمار");
  if (!k.investmentAllowed) d.gap("field:investmentAllowed", "لم يُحدد الإذن بالاستثمار", { field: "investmentAllowed" });
  d.add("duties", "واجبات الناظر", `يلتزم الناظر بشرط الواقف في هذه الوثيقة، وبالواجبات المقررة نظامًا على النظار. ${inv}`, [REF.nazara]);

  // Board
  if (k.nazirType === "board") {
    d.add("board", "مجلس النظارة", `يتكون مجلس النظارة من ${num(k.boardSize) ?? fill("عدد الأعضاء")} أعضاء. ${fill("أسماء الأعضاء الأوائل، وآلية تعيينهم، ونصاب اجتماعاته وقراراته")}`, [REF.draft1]);
    d.gap("board_rules", "تشكيل مجلس النظارة وآلية قراراته لم تُحدد في النموذج", { owner: "specialist", hint: "يكتبها المختص في نص البند بعد الرجوع للواقف." });
  }

  // Closing (Q100 Q76)
  d.add("closing", "الخاتمة", k.amendmentRight === "yes"
    ? `يشترط الواقف لنفسه حق تعديل ${fill("الشروط القابلة للتعديل")}، على أن يكون تعديل الشروط بعد ثبوت الوقف بالرجوع إلى المحكمة المختصة.`
    : "هذه الوثيقة هي المرجع في شروط الوقف، ولا يُغيَّر شيء من شروطه بعد ثبوته إلا بالرجوع إلى المحكمة المختصة.", [REF.q76], "client");
  if (k.amendmentRight === "yes") d.gap("amendment_scope", "الشروط التي يحتفظ الواقف بحق تعديلها لم تُحدد", { owner: "specialist", hint: "تُحدد مع الواقف وتُكتب في نص البند." });

  const signatures = [{ role: "الواقف", name: k.waqifName?.trim() || x.requesterName }, { role: "الشهود (وفق ما تطلبه جهة التوثيق)", name: "" }];
  return { title: "نص وثيقة الوقف", clauses: d.clauses, signatures, checks: d.checks, gaps: d.gaps };
}
