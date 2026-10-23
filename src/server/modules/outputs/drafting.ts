/**
 * Document drafting from structured answers (PURE): the will (W01) and the waqf deed (T03).
 *
 * Each clause is written from the client's own choices in the service form, following the drafting principles of the
 * project's reference files (each clause cites them by key — see citations.ts). Nothing is invented:
 *  - a missing value is printed «[يُستكمل: …]» and raises a gap naming the field and who completes it;
 *  - a value that conflicts with another source is printed «[تعارض يُحسم: …]» — neither value is chosen;
 *  - each clause lists the data it was built from (field, value, state).
 * Checks never pass because an answer exists (checks.ts): each says what was proven, from which data, by which rule,
 * and whether a specialist must still decide. Rulings are not issued here.
 */
import type { OutputBlock, OutputGap, Provenance } from "@/server/db/schema/operations";
import type { CheckResult } from "./checks";
import type { Conflict } from "./conflicts";

type Row = Record<string, string>;
export type DraftInput = {
  keys: Record<string, string>;
  tables: Record<string, Row[]>;
  attached: Record<string, number>;
  requesterName: string;
  /** Conflicts found in the data (conflicts.ts): the generator writes a placeholder where they touch a clause. */
  conflicts?: Conflict[];
  /** Document slots verified by the team (slot → date). */
  verifiedDocs?: Record<string, string>;
  today?: string;
};
export type ClauseData = { field: string; value: string; status: "provided" | "missing" | "conflict" | "default" | "computed" };
type Clause = Extract<OutputBlock, { type: "clause" }>;
export type Drafted = { title: string; clauses: Clause[]; signatures: { role: string; name: string }[]; checks: CheckResult[]; gaps: OutputGap[] };

const fill = (what: string) => `[يُستكمل: ${what}]`;
const conflictMark = (what: string) => `[تعارض يُحسم: ${what}]`;
const num = (v: string | undefined) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const money = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ريال سعودي`;
const pct = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}٪`;
const ORD = ["الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة", "السادسة", "السابعة", "الثامنة", "التاسعة", "العاشرة"];
const ordinal = (n: number) => ORD[n - 1] ?? `رقم ${n}`;
const FORM = "إجابة العميل في نموذج الطلب";
const SA_ID = /^[12]\d{9}$/;

class Doc {
  clauses: Clause[] = [];
  gaps: OutputGap[] = [];
  checks: CheckResult[] = [];
  private used: ClauseData[] = [];
  constructor(private k: Record<string, string>) {}
  /** Value of a field (recorded as the clause's data), or a placeholder + gap. */
  need(field: string, what: string, opts: { severity?: OutputGap["severity"]; owner?: OutputGap["owner"]; why?: string } = {}) {
    const v = this.k[field]?.trim();
    if (v) { this.used.push({ field, value: v, status: "provided" }); return v; }
    this.used.push({ field, value: "", status: "missing" });
    this.gap(`field:${field}`, `لم يُحدد: ${what}`, { field, ...opts });
    return fill(what);
  }
  /** Records a field the clause rests on without printing it as is. */
  use(field: string, value: string | undefined, status: ClauseData["status"] = "provided") {
    this.used.push({ field, value: value ?? "", status: value ? status : "missing" });
  }
  gap(key: string, label: string, o: { severity?: OutputGap["severity"]; owner?: OutputGap["owner"]; field?: string; hint?: string; why?: string; need?: OutputGap["need"]; kind?: OutputGap["kind"]; clause?: string } = {}) {
    if (this.gaps.some((g) => g.key === key)) return;
    const owner = o.owner ?? "client";
    const severity = o.severity ?? "blocking";
    this.gaps.push({
      key, label, severity, owner, field: o.field, kind: o.kind ?? (o.field ? "data" : undefined), why: o.why, clause: o.clause,
      need: o.need ?? (severity === "blocking" ? "mandatory" : owner === "specialist" ? "review" : "optional"),
      hint: o.hint ?? (owner === "client" ? `يستكمله العميل${o.field ? " في نموذج الطلب" : ""} عبر سجل النواقص.` : owner === "specialist" ? "يستكمله المختص في نص البند بعد الرجوع للعميل." : undefined),
    });
  }
  check(c: Omit<CheckResult, "mode"> & { mode?: CheckResult["mode"] }) {
    this.checks.push({ mode: c.status === "verified" ? "auto" : "professional", ...c });
  }
  /** A question the specialist must settle with a recorded, reasoned decision before approval (never decided here). */
  decision(key: string, label: string, reason: string, source: string) {
    this.checks.push({ key: `dec:${key}`, label, status: "specialist", mode: "professional", kind: "decision", reason, source, rule: "يحسمه المختص بقرار مسبب يُسجَّل قبل الاعتماد. لا تُضاف أحكام أو شروط نيابة عن الواقف دون موافقته، ولا يُعد القرار رأيًا شرعيًا ما لم يوقّعه مختص." });
  }
  add(key: string, title: string, text: string, refs: string[], prov: Provenance = "computed") {
    const data = this.used;
    this.used = [];
    this.clauses.push({ type: "clause", key, n: this.clauses.length + 1, title, text, generated: text, prov, refs, data });
  }
}

/** Basic facts before a version is built: IDs, dates, percentages (no ruling — only form and range). */
function factChecks(d: Doc, k: Record<string, string>, tables: Record<string, Row[]>, ids: { field: string; what: string }[], dates: { field: string; what: string }[], today: string) {
  const bad: string[] = [];
  for (const { field, what } of ids) {
    const v = k[field]?.trim();
    if (v && !SA_ID.test(v.replace(/\s/g, ""))) { bad.push(`${what}: «${v}» ليس رقم هوية من 10 أرقام يبدأ بـ1 أو 2`); d.gap(`invalid:${field}`, `${what} غير صحيح الصيغة`, { field, why: "يُطبع في المستند ويُطابق مع الهوية عند التوثيق." }); }
  }
  for (const { field, what } of dates) {
    const v = k[field]?.trim();
    if (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && v > today) { bad.push(`${what}: ${v} تاريخ مستقبلي`); d.gap(`invalid:${field}`, `${what} تاريخ مستقبلي`, { field }); }
  }
  for (const w of tables.witnesses ?? []) if (w.id?.trim() && !SA_ID.test(w.id.trim())) { bad.push(`هوية الشاهد «${w.name ?? ""}» غير صحيحة الصيغة`); d.gap("invalid:witnesses", "رقم هوية أحد الشهود غير صحيح الصيغة", { field: "witnesses" }); }
  d.check({
    key: "facts", label: "صيغة البيانات الأساسية (أرقام الهوية والتواريخ)", status: bad.length ? "failed" : "verified",
    reason: bad.length ? bad.join("؛ ") : "أرقام الهوية من 10 أرقام وتبدأ بـ1 أو 2، ولا تاريخ مستقبلي.",
    source: FORM, rule: "فحص صيغة فقط: لا يثبت صحة الرقم لدى الجهة المصدرة ولا هوية صاحبه.", mode: "auto",
  });
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
  const d = new Doc(k);
  const today = x.today ?? new Date().toISOString().slice(0, 10);
  const conflict = (key: string) => (x.conflicts ?? []).find((c) => c.key === key);
  // the chosen type of will (v3), or the v2 answer «includesWaqf» for requests made before the type question
  const willType = k.willType === "pure" || k.willType === "with_waqf" ? k.willType : k.includesWaqf === "yes" ? "with_waqf" : k.includesWaqf === "no" ? "pure" : "";
  const typeField = k.willType ? "willType" : "includesWaqf";
  d.use(typeField, k[typeField]);
  if (!willType) d.gap("field:willType", "لم يُحدد نوع الوصية (خالصة أو متضمنة وقفًا بعد الوفاة)", { field: "willType" });
  const name = d.need("testatorName", "اسم الموصي");
  const id = d.need("testatorId", "رقم هوية الموصي");
  d.add("preamble", "الديباجة", `أنا ${name}، صاحب الهوية الوطنية رقم ${id}، أوصي وأنا بكامل أهليتي واختياري بما يلي:`, ["draft1"], "client");
  factChecks(d, k, x.tables, [{ field: "testatorId", what: "رقم هوية الموصي" }], [{ field: "previousWillDate", what: "تاريخ الوصية السابقة" }], today);

  // Previous wills (drafting guide, principle 2)
  if (k.hasPreviousWill === "yes") {
    d.use("hasPreviousWill", k.hasPreviousWill);
    const date = d.need("previousWillDate", "تاريخ الوصية السابقة");
    d.use("previousWillAction", k.previousWillAction);
    if (k.previousWillAction === "revoke") d.add("previous", "الوصايا السابقة", `أُلغي جميع وصاياي السابقة، ومنها وصيتي المؤرخة في ${date}، وتحل هذه الوصية محلها.`, ["draft2"], "client");
    else if (k.previousWillAction === "amend") d.add("previous", "الوصايا السابقة", `تُعدَّل وصيتي المؤرخة في ${date} بما ورد في هذه الوصية، ويبقى ما لم يُعدَّل منها نافذًا.`, ["draft2"], "client");
    else {
      d.add("previous", "الوصايا السابقة", `${fill("حكم الوصية السابقة: إلغاء أو تعديل")} — وصيتي المؤرخة في ${date}.`, ["draft2"]);
      d.gap("field:previousWillAction", "لم يُحدد حكم الوصية السابقة (إلغاء أو تعديل)", { field: "previousWillAction" });
    }
    if (!x.attached.previousWill) d.gap("doc:previousWill", "الوصية السابقة لم تُرفق", { severity: "blocking", kind: "document", why: "لمطابقة تاريخ الوصية السابقة ومضمونها قبل إلغائها أو تعديلها.", hint: "يرفعها العميل في خانة المستند أو تُطلب عبر سجل النواقص." });
    d.check({ key: "previous_will", label: "الوصية السابقة مطابقة لما ورد في هذه الوصية", ref: "draft2", status: x.attached.previousWill ? (x.verifiedDocs?.previousWill ? "verified" : "specialist") : "incomplete",
      reason: x.attached.previousWill ? (x.verifiedDocs?.previousWill ? `تحقق الفريق من المستند (${x.verifiedDocs.previousWill}).` : "الوصية السابقة مرفقة؛ يطابق المختص تاريخها ومضمونها مع حكمها في هذه الوصية.") : "الوصية السابقة لم تُرفق.",
      source: "مستند «الوصية السابقة» وإجابة «تاريخ الوصية السابقة»", rule: "بيان حال الوصايا السابقة والنص على تاريخها أو إلغائها (الدليل الإرشادي لصياغة وثيقة الوقف، المبدأ الثاني).", mode: x.verifiedDocs?.previousWill ? "professional" : undefined });
  } else if (k.hasPreviousWill === "no") {
    d.use("hasPreviousWill", k.hasPreviousWill);
    d.add("previous", "الوصايا السابقة", "أُقرّ بأنه لا وصية سابقة لي.", ["draft2"], "client");
    d.check({ key: "previous_will", label: "لا وصية سابقة", status: conflict("will:previous_attached") ? "failed" : "client_attested", ref: "draft2",
      reason: conflict("will:previous_attached") ? "أجاب الموصي بعدم وجود وصية سابقة، ومرفق مستند «الوصية السابقة»." : "إقرار الموصي في النموذج؛ لا تملك المنصة سجلًا للوصايا.", source: FORM, rule: "بيان حال الوصايا السابقة (المبدأ الثاني)." });
  } else d.gap("field:hasPreviousWill", "لم يُبيّن هل للموصي وصية سابقة", { field: "hasPreviousWill" });

  // Bequests
  const rows = x.tables.bequests ?? [];
  const waqfConflict = conflict("will:waqf_answer_vs_bequests") ?? conflict("will:type_vs_bequests");
  const rowlessConflict = conflict("will:waqf_answer_without_row") ?? conflict("will:type_without_row");
  if (!rows.length) d.gap("field:bequests", "لا وصايا في جدول «ما توصي به»", { field: "bequests" });
  let sharePct = 0;
  let amounts = 0;
  let unknownRel = 0;
  const heirs: string[] = [];
  rows.forEach((r, i) => {
    const recipient = r.recipient?.trim() || fill(`الموصى له في الصف ${i + 1}`);
    if (!r.recipient?.trim()) d.gap(`field:bequests:${i}:recipient`, `الصف ${i + 1} من الوصايا بلا موصى له`, { field: "bequests" });
    let what: string;
    if (r.basis === "share") {
      const p = num(r.percent);
      if (p === null) { what = fill("النسبة"); d.gap(`field:bequests:${i}:percent`, `الصف ${i + 1}: النسبة غير محددة`, { field: "bequests" }); }
      else if (p <= 0 || p > 100) { what = fill("نسبة بين 0 و100"); d.gap(`invalid:bequests:${i}:percent`, `الصف ${i + 1}: النسبة ${p}٪ خارج الحدود`, { field: "bequests" }); }
      else { sharePct += p; what = `بنسبة ${pct(p)} من تركتي`; }
    } else if (r.basis === "amount") {
      const a = num(r.amount);
      if (a === null || a <= 0) { what = fill("المبلغ"); d.gap(`field:bequests:${i}:amount`, `الصف ${i + 1}: المبلغ غير محدد`, { field: "bequests" }); }
      else { amounts += a; what = `بمبلغ ${money(a)}`; }
    } else if (r.basis === "asset") {
      what = r.asset?.trim() ? `بـ${r.asset.trim()}` : fill("وصف العين");
      if (!r.asset?.trim()) d.gap(`field:bequests:${i}:asset`, `الصف ${i + 1}: العين الموصى بها غير موصوفة`, { field: "bequests" });
    } else { what = fill("مقدار الوصية"); d.gap(`field:bequests:${i}:basis`, `الصف ${i + 1}: مقدار الوصية غير محدد`, { field: "bequests" }); }
    // A waqf row that conflicts with the answer «no waqf» is not written as a waqf, nor as anything else.
    const inConflict = !!waqfConflict && r.kind === "waqf";
    const verb = inConflict
      ? conflictMark(`نوع الوصية في الصف ${i + 1} «وقف بعد الوفاة» والوصية ${k.willType ? "اختيرت خالصة لا تتضمن وقفًا" : "أُجيب بأنها لا تتضمن وقفًا"}`)
      : (KIND_VERB[r.kind] ?? KIND_VERB.other)(recipient);
    d.use("bequests", `الصف ${i + 1}: ${r.kind ?? "—"} / ${r.recipient ?? "—"} / ${r.basis === "share" ? `${r.percent ?? "—"}٪` : r.basis === "amount" ? `${r.amount ?? "—"} ر.س` : r.asset ?? "—"}`, inConflict ? "conflict" : "provided");
    if (inConflict) d.use(typeField, k[typeField], "conflict");
    d.add(`bequest:${i + 1}`, `الوصية ${ordinal(i + 1)}`, `أوصي ${what} ${verb}.`, ["q16"], "client");
    if (r.relation === "yes") heirs.push(recipient);
    if (!r.relation) unknownRel++;
  });

  // Third of the estate (Q100 Q16/Q75/Q77): the arithmetic, and the rest for the specialist
  const estate = num(k.estimatedEstate);
  const ofEstate = estate && estate > 0 ? sharePct + (amounts / estate) * 100 : sharePct;
  const known = !amounts || (estate !== null && estate > 0);
  const over = ofEstate > 100 / 3 + 1e-9;
  const total = pct(Math.round(ofEstate * 100) / 100);
  if (sharePct > 100) d.gap("share_over_100", `مجموع النسب الموصى بها ${pct(sharePct)} يتجاوز التركة كلها`, { field: "bequests" });
  d.check({
    key: "third_arith", label: "مجموع الوصايا في حدود ثلث التركة (حسابيًا)", ref: "q16",
    status: sharePct > 100 ? "failed" : !rows.length ? "incomplete" : !known ? "incomplete" : over ? "specialist" : amounts ? "client_attested" : "verified",
    reason: sharePct > 100 ? `مجموع النسب ${pct(sharePct)} يتجاوز 100٪ من التركة.`
      : !rows.length ? "لا وصايا بعد."
      : !known ? "في الوصايا مبالغ محددة ولم يُقدَّر إجمالي التركة؛ تعذّر الحساب."
      : over ? `المجموع ${total} من التركة، فوق الثلث: لا ينفذ الزائد إلا بإجازة الورثة، وأُضيف بند حد الثلث.`
      : amounts ? `المجموع ${total} من التركة، محسوب من تقدير العميل للتركة (لم تتحقق منه المنصة).` : `مجموع النسب ${total} من التركة.`,
    source: amounts ? "جدول الوصايا وتقدير التركة (إجابات العميل)" : "جدول الوصايا (إجابات العميل)",
    rule: "مقارنة حسابية بثلث التركة (33.33٪). لا تثبت وحدها نفاذ الوصايا ولا استيفاء الشروط الشرعية.",
  });
  if (over || !known) {
    d.add("third", "حد الثلث", "وما زاد من وصاياي على ثلث تركتي فلا ينفذ إلا بإجازة الورثة.", ["q16", "q77"]);
    d.gap(over ? "third_over" : "third_unknown", over ? `الوصايا تتجاوز ثلث التركة (${total})` : "تعذّر التحقق من حد الثلث: لم يُقدَّر إجمالي التركة", { severity: "warning", owner: over ? "specialist" : "client", field: over ? "bequests" : "estimatedEstate", why: "للتحقق من حد الثلث في الوصايا بالمبالغ.", hint: over ? "أُضيف بند حد الثلث؛ يراجع المستشار الشرعي أثره على كل وصية قبل الاعتماد." : "يُطلب من العميل تقدير التركة، أو يقرّ المستشار ببقاء بند حد الثلث." });
  }
  d.check({
    key: "third_legal", label: "نفاذ الوصايا في حدود الثلث شرعًا", ref: "q16", status: rows.length ? "specialist" : "incomplete",
    reason: rows.length ? "النسبة الحسابية لا تثبت وحدها نفاذ الوصايا؛ يقدّر المستشار الشرعي ما يلزم، ويُحسب الثلث من التركة عند الوفاة." : "لا وصايا بعد.",
    source: "جدول الوصايا", rule: "الوقف المعلق على الموت يأخذ حكم الوصية، ولا يلزم إلا في حدود ثلث التركة إلا بإجازة الورثة (100 سؤال، س16؛ وس77 البند 3).",
  });
  d.check({
    key: "heir", label: "الوصية لوارث", ref: "q16",
    status: heirs.length ? "specialist" : unknownRel ? "incomplete" : rows.length ? "client_attested" : "incomplete",
    reason: heirs.length ? `وصية لـ: ${heirs.join("، ")} (أُدخل أنه وارث). حكمها ونفاذها يقررهما المستشار الشرعي.`
      : unknownRel ? "صفة الموصى له غير محددة في بعض الصفوف." : rows.length ? "بحسب صفة الموصى له التي أدخلها العميل؛ لم يُتحقق من قائمة الورثة." : "لا وصايا بعد.",
    source: "عمود «صفة الموصى له» في جدول الوصايا", rule: "تُعرض كل وصية لوارث على المستشار الشرعي. لا يصدر النظام حكمًا فيها.",
  });
  if (heirs.length) d.gap("heir_bequest", `وصية لوارث: ${heirs.join("، ")}`, { severity: "warning", owner: "specialist", hint: "يراجع المستشار الشرعي حكمها ونفاذها ويكتب ملاحظته قبل الاعتماد." });

  // Waqf after death — only in a will that includes one; a pure will never gets a waqf clause it did not ask for
  const waqfRows = rows.filter((r) => r.kind === "waqf");
  if (willType === "with_waqf") {
    if (!waqfRows.length && !rowlessConflict) d.gap("waqf_missing_row", "الوصية تتضمن وقفًا بعد الوفاة ولا صف «وقف بعد الوفاة» في جدول الوصايا", { field: "bequests", kind: "conflict" });
    const masarif = x.tables.waqfMasarif ?? [];
    if (!masarif.length) d.gap("field:waqfMasarif", "مصارف الوقف بعد الوفاة غير محددة", { field: "waqfMasarif" });
    const shares = masarif.map((m) => num(m.share)).filter((n): n is number => n !== null);
    const sum = shares.reduce((a, b) => a + b, 0);
    d.check({ key: "waqf_shares", label: "أنصبة مصارف الوقف لا تتجاوز 100٪", status: !masarif.length ? "incomplete" : !shares.length ? "na" : sum > 100 ? "failed" : "verified",
      reason: !masarif.length ? "المصارف غير محددة." : !shares.length ? "لم تُحدد أنصبة؛ تُقسم الغلة وفق ما يبيّنه النص." : `مجموع الأنصبة ${pct(sum)}.`, source: "جدول مصارف الوقف", rule: "مجموع الأنصبة المحددة ≤ 100٪ (حساب)." });
    if (sum > 100) d.gap("waqf_shares_over", `مجموع أنصبة مصارف الوقف ${pct(sum)}`, { field: "waqfMasarif" });
    d.use("waqfMasarif", masarif.map((m) => `${m.beneficiary ?? "—"}${m.share ? ` ${m.share}٪` : ""}`).join("؛ "));
    const list = masarif.map((m, i) => `${i + 1}) ${m.beneficiary || fill("المصرف")}${num(m.share) !== null ? ` بنسبة ${pct(num(m.share)!)} من الغلة` : ""}`).join("؛ ");
    const wname = k.waqfName?.trim() ? `يُسمّى «${k.waqfName.trim()}»` : "";
    d.use("waqfName", k.waqfName);
    if (!k.waqfName?.trim()) d.gap("field:waqfName", "اسم الوقف بعد الوفاة غير محدد", { severity: "warning", field: "waqfName", need: "optional", why: "يُسمّى به الوقف في الوصية؛ يجوز تركه." });
    const nazir = d.need("waqfNazir", "ناظر الوقف بعد الوفاة");
    d.use("waqfSuccession", k.waqfSuccession);
    const succ = SUCCESSION_WILL[k.waqfSuccession] ?? d.need("waqfSuccession", "طريقة استخلاف الناظر");
    const final = k.waqfFinal?.trim();
    if (final) d.use("waqfFinal", final);
    d.add("waqf", "الوقف بعد الوفاة", `ويكون ما أوصيت بوقفه وقفًا${wname ? ` ${wname}` : ""}، تُصرف غلته على: ${list || fill("المصارف")}${final ? `، فإن انقطعت صُرفت على ${final}` : ""}. ويتولى نظارته ${nazir}، فإن خلت النظارة تولاها ${succ}.`, ["q16", "waqifsDeed"], "client");
    const conds = k.waqfConditions?.trim();
    if (conds) {
      d.use("waqfConditions", conds);
      d.add("waqf_conditions", "شروط الوقف", `ويشترط الموصي في الوقف: ${conds}`, ["draft1"], "client");
      d.gap("waqf_conditions_review", "شروط الوقف المقترحة تحتاج مراجعة المختص لصياغتها", { severity: "warning", owner: "specialist", need: "review", clause: "waqf_conditions", why: "الشروط نص حر من العميل؛ تُصاغ بعبارة محكمة قبل الاعتماد." });
    }
  }
  d.check({
    key: "waqf_consistency", label: "اتساق نوع الوصية مع جدول الوصايا",
    status: waqfConflict || rowlessConflict ? "failed" : !willType ? "incomplete" : willType === "pure" ? (waqfRows.length ? "failed" : "verified") : waqfRows.length ? "verified" : "incomplete",
    reason: waqfConflict ? waqfConflict.label : rowlessConflict ? rowlessConflict.label : !willType ? "لم يُحدد نوع الوصية." : willType === "pure" ? "وصية خالصة: لا صف وقف في الجدول، ولا بند وقف في النص." : waqfRows.length ? `وصية تتضمن وقفًا: ${waqfRows.length} صف وقف في الجدول.` : "لا صف وقف في الجدول بعد.",
    source: `${k.willType ? "إجابة «نوع الوصية»" : "إجابة «هل في وصاياك وقف بعد الوفاة؟»"} وعمود «نوع الوصية» في جدول الوصايا`, rule: "تطابق إجابتين من النموذج (فحص آلي).", mode: "auto",
  });

  // Executor
  const ex = d.need("executorName", "اسم الوصي");
  d.use("executorRelation", k.executorRelation);
  const rel = EXEC_REL[k.executorRelation] ? `، ${EXEC_REL[k.executorRelation]}` : "";
  const alt = k.alternateExecutor?.trim();
  if (alt) d.use("alternateExecutor", alt);
  d.add("executor", "منفذ الوصية", `أُسند تنفيذ هذه الوصية إلى ${ex}${rel}${alt ? `، فإن تعذّر قيامه بها فإلى ${alt}` : ""}.`, ["waqifsDoc"], "client");

  // Documentation
  const witnesses = (x.tables.witnesses ?? []).filter((w) => w.name?.trim());
  d.use("documentation", k.documentation);
  if (k.documentation === "najiz") d.add("documentation", "التوثيق", "تُوثَّق هذه الوصية لدى الجهة المختصة عبر منصة «ناجز».", ["waqifsNajiz"]);
  else if (k.documentation === "witnesses") {
    d.use("witnesses", witnesses.map((w) => w.name.trim()).join("، "));
    d.add("documentation", "الإشهاد", `أُشهد على هذه الوصية ${witnesses.length ? witnesses.map((w) => w.name.trim()).join("، ") : fill("أسماء الشهود")}، على أن تُوثَّق لدى الجهة المختصة لاحقًا.`, ["waqifsDoc"], "client");
    if (!witnesses.length) d.gap("field:witnesses", "لا شهود في جدول الشهود", { field: "witnesses" });
  } else d.gap("field:documentation", "طريقة توثيق الوصية غير محددة", { field: "documentation" });
  const withWaqf = rows.some((r) => r.kind === "waqf");
  d.check({
    key: "attestation", label: "الإشهاد على الوصية غير الموثقة", ref: "waqifsDoc",
    status: k.documentation === "najiz" ? "na" : k.documentation === "witnesses" ? (witnesses.length ? "specialist" : "incomplete") : "incomplete",
    reason: k.documentation === "najiz" ? "اختار الموصي التوثيق لدى الجهة المختصة عبر «ناجز»؛ لا يُشترط الشهود لإثبات الوصية لديها."
      : k.documentation === "witnesses" ? (witnesses.length ? `أُدخلت أسماء ${witnesses.length} من الشهود. إدخال الاسم لا يثبت حصول الإشهاد؛ يثبت بتوقيع الشهود على الوصية أو بمستند يرفق.${withWaqf ? "" : " والمصدر في ملفات المشروع يتناول الوصية بالوقف؛ لغيرها يقدّر المختص."}` : "لا شهود بعد.")
      : "طريقة التوثيق غير محددة.",
    source: "إجابة «كيف ستوثّق الوصية؟» وجدول الشهود", rule: "يلزم الإشهاد على وقف أو وصية بوقف لم يوثق لدى الجهة المختصة (الدليل الإرشادي للواقفين، ص40).",
  });
  d.check({ key: "official", label: "التوثيق لدى الجهة المختصة", status: "incomplete", reason: "لم يُسجَّل توثيق رسمي لهذه الوصية. يُسجَّل بعد صدوره ورفع ما يثبته، ولا يُعد اعتماد المنصة توثيقًا.", source: "سجل التوثيق الرسمي للمخرج", rule: "التوثيق يتم لدى الجهة المختصة لا في المنصة.", ref: "waqifsNajiz" });

  // Closing: never asserts "the only valid will" when an earlier one stays partly in force
  const closing = k.hasPreviousWill === "yes" && k.previousWillAction === "amend"
    ? "حُررت هذه الوصية بتاريخ (يُكتب عند التوقيع)، وتُقرأ مع وصيتي السابقة فيما لم تعدّله."
    : "حُررت هذه الوصية بتاريخ (يُكتب عند التوقيع)، وهي وصيتي الوحيدة النافذة.";
  d.add("closing", "الختام", closing, ["draft2"]);
  const signatures = [{ role: "الموصي", name: k.testatorName?.trim() || x.requesterName }, ...witnesses.map((w, i) => ({ role: `الشاهد ${i + 1}`, name: w.name.trim() }))];
  return { title: willType === "with_waqf" ? "نص الوصية المتضمنة وقفًا بعد الوفاة" : "نص الوصية", clauses: d.clauses, signatures, checks: d.checks, gaps: d.gaps };
}

// ───────────────────────── Waqf deed (T03) ─────────────────────────

const WAQF_KIND_AR: Record<string, string> = { general: "عامًّا (خيريًّا)", ahli: "أهليًّا (ذُرّيًّا)", mixed: "مشتركًا" };
const DIVISION: Record<string, string> = { equal: "بالتساوي بينهم", inheritance: "للذكر مثل حظ الأنثيين", na: "" };
const SUCCESSION_DEED: Record<string, string> = { ...SUCCESSION_WILL };

const ASSET_KIND_AR: Record<string, string> = { real_estate: "عقار", shares: "أسهم", fund_units: "وحدات صندوق", sukuk: "صكوك", cash: "نقد", movable: "منقولات", usufruct: "منفعة", intellectual_property: "حقوق معنوية", other: "أصل" };
const DOC_KIND_AR: Record<string, string> = { deed: "صك ملكية عقاري", securities_statement: "كشف حساب أوراق مالية", bank_statement: "كشف حساب بنكي", contract: "عقد أو مستند ملكية", other: "مستند" };
const DOC_PHRASE: Record<string, string> = { deed: "صك الملكية", securities_statement: "كشف حساب الأوراق المالية (إفادة الإيداع)", bank_statement: "كشف الحساب البنكي", contract: "مستند الملكية", other: "المستند" };
const ORDINAL_M = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر"];
const ROLE_AR: Record<string, string> = { chair: "رئيسًا", member: "عضوًا", secretary: "أمينًا للسر" };
const V2_KIND: Record<string, string> = { real_estate: "real_estate", cash: "cash", securities: "shares", business: "other", movable: "movable", intangible: "intellectual_property", benefit: "usufruct", other: "other" };

/** The assets of the deed: the assets table (form v3), or the single asset of a v2 answer set. */
function assetRows(x: DraftInput): Row[] {
  const t = x.tables.assets ?? [];
  if (t.length) return t;
  const k = x.keys;
  if (!k.assetDescription) return [];
  const kind = V2_KIND[k.assetType ?? ""] ?? "other";
  return [{ kind, description: k.assetDescription, docKind: kind === "real_estate" ? "deed" : "other", docNo: k.ownershipDeedNo ?? "", docDate: k.ownershipDeedDate ?? "", owned: k.registeredToWaqif ?? "", mortgaged: k.mortgaged ?? "", share: k.share ?? "", sharePercent: k.sharePercent ?? "" }];
}

const FAMILY = /أولاد|ذري|ذرّي|أبناء|بنات|نسل|عقب|أحفاد/;

/** The parts of a free-text note that each ask for something (sentences; «، وأن …» starts a new request). */
export function noteParts(text: string | undefined): string[] {
  if (!text?.trim()) return [];
  return text.split(/[.؟!\n]+|،\s*و(?=أن\s|أرغب|أريد|أود|نرجو|يرجى)/u).map((x) => x.trim().replace(/^و\s*/, "")).filter((x) => x.length >= 8);
}

/**
 * What the specialist must settle on the deed before approval (each a recorded, reasoned decision): questions the
 * form leaves open by nature, the client's own notes, and his request to see the draft. Shown only where they apply.
 */
function deedDecisions(d: Doc, k: Record<string, string>, tables: Record<string, Row[]>, rows: Row[], reserve: number | null) {
  const board = k.nazirType === "board";
  if (board || k.nazirType === "named" || k.nazirType === "entity") {
    d.decision("succession_vacancy", "الاستخلاف عند خلو النظارة كلها", `اختار الواقف: «${SUCCESSION_DEED[k.succession] ?? "لم يُحدد"}».${board && k.succession === "board" ? " إن خلا المجلس كله لم يبق من ينتخب؛ يُحدَّد البديل مع الواقف." : ""}`, `${FORM}: النظارة والاستخلاف`);
  }
  if (rows.some((r) => FAMILY.test(r.beneficiary ?? "") || r.division === "inheritance")) {
    d.decision("descendants", "دخول أولاد البنات، وترتيب الأجيال والحجب، وانقطاع الذرية", "في المصارف ذرية؛ النص المولد لا يبيّن هذه المسائل، ولا تُفترض.", `${FORM}: جدول المصارف`);
  }
  if (reserve !== null && rows.some((r) => num(r.share) !== null)) {
    d.decision("share_base", "وعاء الأنصبة بعد استقطاع نسبة العمارة", `حدد الواقف ${pct(reserve)} للعمارة وأنصبة بالنسبة؛ يُبيَّن هل الأنصبة من الغلة كلها أم مما يبقى بعد الاستقطاع.`, `${FORM}: النسبة المستقطعة وجدول المصارف`);
  }
  const tiers = new Map<number, number>();
  for (const r of rows) tiers.set(num(r.tier) ?? 0, (tiers.get(num(r.tier) ?? 0) ?? 0) + 1);
  if ([...tiers.values()].some((n) => n > 1)) {
    d.decision("partial_extinction", "انقطاع فئة واحدة من مستحقي الطبقة", "في طبقة واحدة أكثر من مستحق؛ النص يبيّن المصرف عند انقطاع المستحقين جميعًا فقط.", `${FORM}: جدول المصارف`);
  }
  if (board) {
    d.decision("conflict_of_interest", "تعارض المصالح في مجلس النظارة", (tables.boardMembers ?? []).some((m) => FAMILY.test(m.capacity ?? "")) ? "من الأعضاء من صفته من الذرية الموقوف عليها." : "يُبيَّن حكم العضو الذي له مصلحة في قرار المجلس.", `${FORM}: أعضاء المجلس`);
    d.decision("board_terms", "مدد العضوية والعزل والمكافآت وآلية القرار", "يحددها الواقف؛ لا تُستنتج من أسماء الأعضاء.", `${FORM}: النظارة`);
  }
  d.decision("added_clauses", "البنود والقواعد التي يضيفها المختص ولم يحددها العميل", "كل قاعدة يكتبها المختص من عنده (نصاب، استخلاف بديل، بند معياري) تُعرض على الواقف ويُسجَّل قبوله قبل الاعتماد.", "نص البنود بعد تحرير المختص");
  noteParts(k.notes).forEach((t, i) => {
    d.decision(`client_note:${i + 1}`, `ملاحظة العميل ${i + 1}: «${t}»`, "يقرر المختص: تُطبق (ويُذكر البند) أو تحتاج إيضاح العميل (يُرسل له استفسار) أو لا تنطبق (مع السبب). لا تُضاف شروط جديدة إلى الوقف دون موافقة الواقف.", `${FORM}: ما الذي تريد أن يعرفه الفريق`);
  });
  if (k.clientPreview === "yes") {
    d.decision("client_preview", "اطلاع العميل على المسودة قبل الاعتماد", "طلب الواقف الاطلاع على المسودة قبل اعتمادها؛ يُسجَّل تاريخ إرسالها له وما أبداه.", `${FORM}: الاطلاع على المسودة`);
  }
}

export function draftDeed(x: DraftInput): Drafted {
  const k = x.keys;
  const d = new Doc(k);
  const today = x.today ?? new Date().toISOString().slice(0, 10);
  const waqif = d.need("waqifName", "اسم الواقف");
  const id = d.need("waqifId", "رقم هوية الواقف");
  d.use("waqfKind", k.waqfKind);
  const kind = WAQF_KIND_AR[k.waqfKind];
  if (!kind) d.gap("field:waqfKind", k.waqfKind === "undecided" ? "نوع الوقف لم يُحدد بعد (عام أو أهلي أو مشترك)" : "نوع الوقف غير محدد", { field: "waqfKind" });
  // Assets (principles 11–14; Q100 Q28): one clause per asset, each with its own ownership document
  const assets = assetRows(x);
  const many = assets.length > 1;
  d.add("preamble", "المقدمة وبيانات الواقف", `أُقرّ أنا ${waqif}، صاحب الهوية الوطنية رقم ${id}، وأنا بكامل أهليتي واختياري، بأني أوقفت ${many ? "الأصول المبيّنة" : "الأصل المبيّن"} في هذه الوثيقة وقفًا ${kind ?? fill("نوع الوقف")}، تحبيسًا ${many ? "لأصولها" : "لأصله"} وتسبيلًا ${many ? "لمنفعتها" : "لمنفعته"}، على الشروط الآتية.`, ["draft1"], "client");
  factChecks(d, k, x.tables, [{ field: "waqifId", what: "رقم هوية الواقف" }], [], today);
  if (!assets.length) {
    d.gap("field:assets", "لم تُحدد الأصول الموقوفة", { field: "assets" });
    d.add("asset", "الأصل الموقوف", `الأصل الموقوف: ${fill("وصف الأصل ومستند ملكيته")}.`, ["draft11"], "client");
  }
  d.use("appurtenances", k.appurtenances);
  const app = k.appurtenances === "all" ? `بجميع ${many ? "حقوقها وما يلحق بها وما فيها" : "حقوقه وما يلحق به وما فيه"}` : k.appurtenances === "except" ? `ويُستثنى: ${k.exceptionPart?.trim() || fill("الجزء المستثنى")}` : "";
  const bad: string[] = [];
  assets.forEach((r, i) => {
    const n = i + 1;
    const tag = many ? ` (${n})` : "";
    const desc = (r.description ?? "").trim().replace(/[\s.،؛]+$/u, "");
    if (!desc) d.gap(`asset:${n}:description`, `الأصل${tag}: الوصف غير محدد`, { field: "assets" });
    const docKind = r.docKind ?? "";
    // a share is never proven by a real-estate deed, nor a property by a securities statement
    const mismatch = (r.kind === "real_estate" && docKind && docKind !== "deed") || (r.kind !== "real_estate" && docKind === "deed");
    if (mismatch) { bad.push(`الأصل${tag}`); d.gap(`asset:${n}:doc_kind`, `الأصل${tag}: مستند الملكية «${DOC_KIND_AR[docKind] ?? docKind}» لا يناسب نوعه «${ASSET_KIND_AR[r.kind ?? ""] ?? r.kind}»`, { field: "assets", why: "لا يُنسب أصل إلى مستند أصل آخر ولا إلى مستند من غير نوعه." }); }
    if (!docKind) d.gap(`asset:${n}:doc_kind_missing`, `الأصل${tag}: نوع مستند الملكية غير محدد`, { field: "assets" });
    if (!r.docNo?.trim()) d.gap(`asset:${n}:doc_no`, `الأصل${tag}: رقم مستند الملكية غير محدد`, { field: "assets", why: "يُعيَّن به الأصل ويُطابق عند التوثيق." });
    if (r.docDate && /^\d{4}-\d{2}-\d{2}$/.test(r.docDate) && r.docDate > today) d.gap(`asset:${n}:doc_date`, `الأصل${tag}: تاريخ المستند مستقبلي`, { field: "assets" });
    if (r.owned !== "yes") d.gap(`asset:${n}:owned`, `الأصل${tag}: ${r.owned === "no" ? "غير مملوك للواقف أو غير مسجل باسمه" : "لم يُبيَّن ملك الواقف له"}`, { field: "assets", hint: "لا يُصاغ الوقف على أصل لا يملكه الواقف؛ يُستكمل ما يثبت الملكية." });
    if (r.share === "share" && num(r.sharePercent) === null) d.gap(`asset:${n}:share`, `الأصل${tag}: نسبة الحصة المشاعة غير محددة`, { field: "assets" });
    const conflict = (x.conflicts ?? []).find((c) => c.key.startsWith(`file:assets:${n}:`) && c.severity === "material");
    const docNo = conflict ? conflictMark(conflict.label) : r.docNo?.trim() ? r.docNo.trim() : fill("رقم مستند الملكية");
    const docDate = r.docDate ? ` وتاريخ ${r.docDate}` : "";
    const part = r.share === "share" ? `حصة مشاعة نسبتها ${num(r.sharePercent) !== null ? pct(num(r.sharePercent)!) : fill("نسبة الحصة")} منه` : r.share === "whole" ? "كامل الأصل" : fill("كامل الأصل أو حصة منه");
    d.use("assets", `${n}: ${desc} — ${DOC_KIND_AR[docKind] ?? "مستند"} ${r.docNo ?? ""}`.trim(), conflict ? "conflict" : "provided");
    const title = many ? `الأصل الموقوف (${n}): ${ASSET_KIND_AR[r.kind ?? ""] ?? "أصل"}` : "الأصل الموقوف";
    d.add(many ? `asset:${n}` : "asset", title, `${many ? `الأصل ${ORDINAL_M[i] ?? n}` : "الأصل الموقوف"}: ${desc || fill("وصف الأصل")}، المملوك للواقف بموجب ${DOC_PHRASE[docKind] ?? "مستند الملكية"} رقم ${docNo}${docDate}. ويشمل الوقف ${part}${app ? `، ${app}` : ""}.`, ["draft11"], "client");
  });
  const ownVerified = x.verifiedDocs?.ownership;
  const attachedOwn = x.attached.ownership ?? 0;
  const notOwned = assets.filter((r) => r.owned !== "yes").length;
  d.check({
    key: "ownership", label: many ? "كل أصل مملوك للواقف ومسجل باسمه بمستند ملكيته" : "الأصل مملوك للواقف ومسجل باسمه بمستند ساري", ref: "draft11",
    status: !assets.length ? "incomplete" : assets.some((r) => r.owned === "no") || bad.length ? "failed" : notOwned ? "incomplete" : ownVerified && attachedOwn >= assets.length ? "verified" : attachedOwn ? "specialist" : "client_attested",
    mode: ownVerified ? "professional" : undefined,
    reason: !assets.length ? "لا أصول." : bad.length ? `مستند ملكية لا يناسب نوع الأصل: ${bad.join("، ")}.` : assets.some((r) => r.owned === "no") ? "أصل غير مملوك للواقف أو غير مسجل باسمه." : notOwned ? "لم يُبيَّن ملك الواقف لكل الأصول." : ownVerified && attachedOwn >= assets.length ? `تحقق الفريق من مستندات الملكية المرفقة (${ownVerified}).` : attachedOwn ? `مستندات الملكية المرفقة: ${attachedOwn} لعدد ${assets.length} من الأصول، ولم يُتحقق منها كلها بعد.` : "إقرار الواقف دون مستند ملكية مرفق.",
    source: "جدول الأصول الموقوفة ومستندات الملكية المرفقة", rule: "لا يُصاغ الوقف على أصل لا يملكه الواقف، ولكل أصل مستند ملكيته (الدليل الإرشادي لصياغة وثيقة الوقف، المبادئ 11–14).",
  });
  if (!attachedOwn) d.gap("doc:ownership", "مستند ملكية الأصول لم يُرفق", { kind: "document", why: "لإثبات ملك الواقف ومطابقة رقم كل مستند.", hint: "يرفعه العميل في خانة المستند." });
  else if (attachedOwn < assets.length) d.gap("doc:ownership_count", `مستندات الملكية المرفقة (${attachedOwn}) أقل من عدد الأصول (${assets.length})`, { kind: "document", why: "لكل أصل مستند ملكيته؛ لا يُكتفى بمستند أصل عن غيره.", hint: "يرفع العميل مستند ملكية كل أصل." });
  const mortgaged = assets.filter((r) => r.mortgaged === "yes");
  const unknownMortgage = assets.filter((r) => r.mortgaged !== "yes" && r.mortgaged !== "no");
  const mortVerified = x.verifiedDocs?.mortgagee;
  d.check({
    key: "mortgage", label: "لا أصل مرهونًا، أو أُرفقت موافقة المرتهن", ref: "q28",
    status: unknownMortgage.length || !assets.length ? "incomplete" : mortgaged.length ? (x.attached.mortgagee ? (mortVerified ? "verified" : "specialist") : "failed") : "client_attested",
    mode: mortVerified ? "professional" : undefined,
    reason: !assets.length ? "لا أصول." : unknownMortgage.length ? "لم يُبيَّن الرهن لكل الأصول." : mortgaged.length ? (x.attached.mortgagee ? (mortVerified ? `تحقق الفريق من موافقة المرتهن (${mortVerified}).` : "موافقة المرتهن مرفقة ولم يُتحقق منها.") : `أصل مرهون (${mortgaged.length}) ولا موافقة مرتهن مرفقة.`) : "إقرار الواقف بأن الأصول غير مرهونة؛ لم يُتحقق من سجل الرهون.",
    source: "عمود «مرهون» في جدول الأصول ومستند موافقة المرتهن", rule: "لا يوقف المرهون إلا بعد سداد الرهن أو موافقة المرتهن (100 سؤال، س28).",
  });
  if (mortgaged.length && !x.attached.mortgagee) d.gap("mortgaged", "أصل مرهون ولم تُرفق موافقة المرتهن", { kind: "document", hint: "100 سؤال س28: لا يوقف المرهون إلا بعد سداد الرهن أو موافقة المرتهن." });

  // Name
  d.add("name", "اسم الوقف", `يُسمّى هذا الوقف «${d.need("waqfName", "اسم الوقف")}».`, ["draft1"], "client");

  // Masarif and tiers (principles 26–27)
  const rows = (x.tables.masarif ?? []).slice().sort((a, b) => (num(a.tier) ?? 99) - (num(b.tier) ?? 99));
  if (!rows.length) d.gap("field:masarif", "المصارف غير محددة", { field: "masarif" });
  const tiers = [...new Set(rows.map((r) => num(r.tier) ?? 0))];
  const reserve = num(k.reservePercent);
  const overTiers: number[] = [];
  const parts = tiers.map((t, i) => {
    const people = rows.filter((r) => (num(r.tier) ?? 0) === t);
    const sum = people.map((p) => num(p.share)).filter((n): n is number => n !== null).reduce((a, b) => a + b, 0);
    if (sum > 100) { overTiers.push(t); d.gap(`tier_over:${t}`, `مجموع أنصبة الطبقة ${t} ${pct(sum)}`, { field: "masarif" }); }
    const who = people.map((p) => `${p.beneficiary || fill("المستحق")}${num(p.share) !== null ? ` (${pct(num(p.share)!)} من الغلة)` : ""}${DIVISION[p.division] ? ` ${DIVISION[p.division]}` : ""}`).join("، و");
    return i === 0 ? `على ${who}` : `فإن انقرضوا أو انقطعوا فعلى ${who}`;
  });
  d.use("masarif", rows.map((r) => `${r.tier}: ${r.beneficiary}${r.share ? ` ${r.share}٪` : ""}`).join("؛ "));
  d.use("reservePercent", k.reservePercent, k.reservePercent ? "provided" : "default");
  const alt = d.need("alternateMasraf", "المصرف البديل عند انقطاع المستحقين");
  d.check({ key: "tiers", label: "أنصبة كل طبقة لا تتجاوز 100٪", status: !rows.length ? "incomplete" : overTiers.length ? "failed" : "verified", reason: !rows.length ? "المصارف غير محددة." : overTiers.length ? `الطبقات ${overTiers.join("، ")} تتجاوز 100٪.` : "مجموع الأنصبة المحددة في كل طبقة ≤ 100٪.", source: "جدول المصارف", rule: "حساب أنصبة كل طبقة." });
  // the reserve is left to the nazir when not given — stated as such, not as a figure
  d.add("masarif", "المصارف وترتيبها", `تُصرف غلة الوقف${reserve !== null ? ` بعد استقطاع ${pct(reserve)} من صافي الريع لعمارة الوقف وصيانته وتنميته` : ""} ${parts.join("؛ ") || fill("المصارف")}؛ فإن انقطع المستحقون جميعًا صُرفت الغلة إلى ${alt}.${reserve === null ? " ويُقدّر الناظر ما يلزم لعمارة الوقف وصيانته قبل الصرف على المستحقين (لم يحدد الواقف نسبة)." : ""}`, ["draft1", "draft26"], "client");

  // Exception (principle 26)
  d.use("selfBenefit", k.selfBenefit);
  if (k.selfBenefit === "yes") {
    d.use("selfBenefitScope", k.selfBenefitScope);
    const scope = k.selfBenefitScope === "all" ? "غلة الوقف كاملة" : k.selfBenefitScope === "use" ? "السكنى في الأصل أو الانتفاع بعينه" : k.selfBenefitScope === "part" ? `جزءًا من غلة الوقف مقداره ${fill("مقدار الجزء المستثنى")}` : fill("مقدار الانتفاع");
    if (k.selfBenefitScope === "part") d.gap("self_benefit_amount", "مقدار ما يستثنيه الواقف من الغلة لم يُحدد", { owner: "specialist", clause: "exception", hint: "يُسأل الواقف عن المقدار وآلية الانتفاع، ويُكتب في نص البند (الدليل: المبدأ 26)." });
    d.add("exception", "استثناء الانتفاع", `أستثني لنفسي مدة حياتي ${scope}، ثم يُصرف ذلك بعد وفاتي على المصارف المبيّنة في هذه الوثيقة.`, ["draft26"], "client");
  } else if (k.selfBenefit === "no") d.add("exception", "استثناء الانتفاع", "لا يستثني الواقف لنفسه شيئًا من غلة الوقف أو منفعته.", ["draft26"], "client");
  else d.gap("field:selfBenefit", "لم يُبيّن هل يستثني الواقف الانتفاع", { field: "selfBenefit" });

  // Nazara
  d.use("succession", k.succession);
  const succ = SUCCESSION_DEED[k.succession] ?? d.need("succession", "طريقة استخلاف الناظر");
  let nazir: string;
  d.use("nazirType", k.nazirType);
  if (k.nazirType === "self") nazir = "الواقف نفسه مدة حياته";
  else if (k.nazirType === "named" || k.nazirType === "entity") nazir = d.need("nazirName", "اسم الناظر أو الجهة");
  else if (k.nazirType === "board") nazir = `مجلس نظارة من ${num(k.boardSize) ?? fill("عدد الأعضاء")} أعضاء`;
  else nazir = d.need("nazirType", "من يتولى النظارة");
  d.add("nazara", "النظارة", `يتولى نظارة الوقف ${nazir}، فإن خلت النظارة تولاها ${succ}.`, ["draft1", "waqifsDeed"], "client");

  // Duties of the nazir
  d.use("investmentAllowed", k.investmentAllowed);
  const inv = k.investmentAllowed === "yes" ? "وللناظر استثمار أصول الوقف وتنميتها بما يحقق مصلحته وفق الأنظمة والضوابط المنظمة لاستثمار الأوقاف." : k.investmentAllowed === "no" ? "ولا يأذن الواقف للناظر في استثمار أصول الوقف." : fill("الإذن بالاستثمار");
  if (!k.investmentAllowed) d.gap("field:investmentAllowed", "لم يُحدد الإذن بالاستثمار", { field: "investmentAllowed" });
  d.add("duties", "واجبات الناظر", `يلتزم الناظر بشرط الواقف في هذه الوثيقة، وبالواجبات المقررة نظامًا على النظار. ${inv}`, ["nazara"]);

  // Board: the members come from the request (prefilled from the waqf file's nazara board); the board's rules are the
  // waqif's decisions, written by the specialist — never inferred from the members' names
  if (k.nazirType === "board") {
    d.use("boardSize", k.boardSize);
    const members = x.tables.boardMembers ?? [];
    const size = num(k.boardSize);
    if (members.length && size !== null && members.length !== size) d.gap("board_count", `أعضاء المجلس المسمَّون (${members.length}) يخالفون عدد أعضاء المجلس (${size})`, { field: "boardMembers", why: "لا يُختار أحد الرقمين آليًا." });
    members.forEach((m, i) => { const c = (x.conflicts ?? []).find((cf) => cf.key.startsWith(`file:boardMembers:${i + 1}:`) && cf.severity === "material"); if (c) d.use("boardMembers", m.name, "conflict"); });
    const names = members.length
      ? members.map((m, i) => { const c = (x.conflicts ?? []).find((cf) => cf.key.startsWith(`file:boardMembers:${i + 1}:`) && cf.severity === "material"); return `${c ? conflictMark(c.label) : m.name?.trim() || fill("اسم العضو")} ${ROLE_AR[m.role ?? ""] ?? "عضوًا"}`; }).join("، و")
      : fill("أسماء الأعضاء الأوائل");
    if (members.length) d.use("boardMembers", members.map((m) => m.name).join("، "));
    d.add("board", "مجلس النظارة", `يتكون مجلس النظارة من ${size ?? fill("عدد الأعضاء")} أعضاء، والمجلس الأول: ${names}. ${fill("نصاب اجتماعات المجلس وآلية قراراته ومدد العضوية والعزل والمكافآت، بحسب ما يقرره الواقف")}`, ["draft1"]);
    d.gap("board_rules", "نصاب المجلس وآلية قراراته ومدد العضوية والعزل والمكافآت لم يحددها الواقف في النموذج", { owner: "specialist", clause: "board", hint: "يكتبها المختص في نص البند بعد الرجوع للواقف." });
  }

  // Closing (Q100 Q76)
  d.use("amendmentRight", k.amendmentRight);
  d.add("closing", "الخاتمة", k.amendmentRight === "yes"
    ? `يشترط الواقف لنفسه حق تعديل ${fill("الشروط القابلة للتعديل")}، على أن يكون تعديل الشروط بعد ثبوت الوقف بالرجوع إلى المحكمة المختصة.`
    : "هذه الوثيقة هي المرجع في شروط الوقف، ولا يُغيَّر شيء من شروطه بعد ثبوته إلا بالرجوع إلى المحكمة المختصة.", ["q76"], "client");
  if (k.amendmentRight === "yes") d.gap("amendment_scope", "الشروط التي يحتفظ الواقف بحق تعديلها لم تُحدد", { owner: "specialist", clause: "closing", hint: "تُحدد مع الواقف وتُكتب في نص البند." });
  d.check({ key: "official", label: "التوثيق لدى الجهة المختصة", status: "incomplete", reason: "لم يُسجَّل توثيق رسمي للوقف. يُسجَّل بعد صدوره ورفع ما يثبته، ولا يُعد اعتماد المنصة توثيقًا.", source: "سجل التوثيق الرسمي للمخرج", rule: "التوثيق يتم لدى الجهة المختصة لا في المنصة.", ref: "waqifsNajiz" });

  deedDecisions(d, k, x.tables, rows, reserve);

  const signatures = [{ role: "الواقف", name: k.waqifName?.trim() || x.requesterName }, { role: "الشهود (وفق ما تطلبه جهة التوثيق)", name: "" }];
  return { title: "نص وثيقة الوقف", clauses: d.clauses, signatures, checks: d.checks, gaps: d.gaps };
}
