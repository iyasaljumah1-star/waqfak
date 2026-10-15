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
  const waqfConflict = conflict("will:waqf_answer_vs_bequests");
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
      ? conflictMark(`نوع الوصية في الصف ${i + 1} «وقف بعد الوفاة» والإجابة أن الوصايا لا تتضمن وقفًا`)
      : (KIND_VERB[r.kind] ?? KIND_VERB.other)(recipient);
    d.use("bequests", `الصف ${i + 1}: ${r.kind ?? "—"} / ${r.recipient ?? "—"} / ${r.basis === "share" ? `${r.percent ?? "—"}٪` : r.basis === "amount" ? `${r.amount ?? "—"} ر.س` : r.asset ?? "—"}`, inConflict ? "conflict" : "provided");
    if (inConflict) d.use("includesWaqf", k.includesWaqf, "conflict");
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

  // Waqf after death
  const waqfRows = rows.filter((r) => r.kind === "waqf");
  if (k.includesWaqf === "yes") {
    d.use("includesWaqf", k.includesWaqf);
    if (!waqfRows.length) d.gap("waqf_missing_row", "اختار الموصي الوقف بعد الوفاة ولا صف «وقف بعد الوفاة» في جدول الوصايا", { field: "bequests", kind: "conflict" });
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
    d.add("waqf", "الوقف بعد الوفاة", `ويكون ما أوصيت بوقفه وقفًا${wname ? ` ${wname}` : ""}، تُصرف غلته على: ${list || fill("المصارف")}. ويتولى نظارته ${nazir}، فإن خلت النظارة تولاها ${succ}.`, ["q16", "waqifsDeed"], "client");
  }
  d.check({
    key: "waqf_consistency", label: "اتساق الوقف بعد الوفاة بين الإجابة وجدول الوصايا", status: waqfConflict || conflict("will:waqf_answer_without_row") ? "failed" : k.includesWaqf ? "verified" : "incomplete",
    reason: waqfConflict ? waqfConflict.label : conflict("will:waqf_answer_without_row") ? conflict("will:waqf_answer_without_row")!.label : k.includesWaqf === "yes" ? "الإجابة «نعم» وفي الجدول صف وقف." : k.includesWaqf === "no" ? "الإجابة «لا» ولا صف وقف في الجدول." : "لم يُجب عن سؤال الوقف بعد الوفاة.",
    source: "إجابة «هل في وصاياك وقف بعد الوفاة؟» وعمود «نوع الوصية» في جدول الوصايا", rule: "تطابق إجابتين من النموذج (فحص آلي).", mode: "auto",
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
  return { title: "نص الوصية", clauses: d.clauses, signatures, checks: d.checks, gaps: d.gaps };
}

// ───────────────────────── Waqf deed (T03) ─────────────────────────

const WAQF_KIND_AR: Record<string, string> = { general: "عامًّا (خيريًّا)", ahli: "أهليًّا (ذُرّيًّا)", mixed: "مشتركًا" };
const DIVISION: Record<string, string> = { equal: "بالتساوي بينهم", inheritance: "للذكر مثل حظ الأنثيين", na: "" };
const SUCCESSION_DEED: Record<string, string> = { ...SUCCESSION_WILL };

export function draftDeed(x: DraftInput): Drafted {
  const k = x.keys;
  const d = new Doc(k);
  const today = x.today ?? new Date().toISOString().slice(0, 10);
  const waqif = d.need("waqifName", "اسم الواقف");
  const id = d.need("waqifId", "رقم هوية الواقف");
  d.use("waqfKind", k.waqfKind);
  const kind = WAQF_KIND_AR[k.waqfKind];
  if (!kind) d.gap("field:waqfKind", k.waqfKind === "undecided" ? "نوع الوقف لم يُحدد بعد (عام أو أهلي أو مشترك)" : "نوع الوقف غير محدد", { field: "waqfKind" });
  d.add("preamble", "المقدمة وبيانات الواقف", `أُقرّ أنا ${waqif}، صاحب الهوية الوطنية رقم ${id}، وأنا بكامل أهليتي واختياري، بأني أوقفت الأصل المبيّن في هذه الوثيقة وقفًا ${kind ?? fill("نوع الوقف")}، تحبيسًا لأصله وتسبيلًا لمنفعته، على الشروط الآتية.`, ["draft1"], "client");
  factChecks(d, k, x.tables, [{ field: "waqifId", what: "رقم هوية الواقف" }], [{ field: "ownershipDeedDate", what: "تاريخ صك الملكية" }], today);

  // Asset (principles 11–14; Q100 Q28)
  const deedConflict = (x.conflicts ?? []).find((c) => c.key === "doc_number:ownership:ownershipDeedNo");
  const desc = d.need("assetDescription", "وصف الأصل بما يميزه");
  const deedNo = deedConflict ? (d.use("ownershipDeedNo", k.ownershipDeedNo, "conflict"), conflictMark("رقم صك الملكية في الإجابة يخالف رقم المستند المرفق")) : d.need("ownershipDeedNo", "رقم صك الملكية");
  const deedDate = k.ownershipDeedDate ? ` وتاريخ ${k.ownershipDeedDate}` : "";
  d.use("share", k.share);
  const part = k.share === "share" ? `حصة مشاعة نسبتها ${num(k.sharePercent) !== null ? pct(num(k.sharePercent)!) : fill("نسبة الحصة")} منه` : k.share === "whole" ? "كامل الأصل" : fill("كامل الأصل أو حصة منه");
  if (k.share === "share" && num(k.sharePercent) === null) d.gap("field:sharePercent", "نسبة الحصة المشاعة غير محددة", { field: "sharePercent" });
  d.use("appurtenances", k.appurtenances);
  const app = k.appurtenances === "all" ? "بجميع حقوقه وما يلحق به وما فيه" : k.appurtenances === "except" ? `ويُستثنى منه: ${k.exceptionPart?.trim() || fill("الجزء المستثنى")}` : "";
  d.add("asset", "الأصل الموقوف", `الأصل الموقوف: ${desc}، المملوك للواقف بموجب الصك رقم ${deedNo}${deedDate}. ويشمل الوقف ${part}${app ? `، ${app}` : ""}.`, ["draft11"], "client");
  const ownVerified = x.verifiedDocs?.ownership;
  d.check({
    key: "ownership", label: "الأصل مملوك للواقف ومسجل باسمه بصك ساري", ref: "draft11",
    status: k.registeredToWaqif === "no" ? "failed" : k.registeredToWaqif !== "yes" ? "incomplete" : ownVerified ? "verified" : x.attached.ownership ? "specialist" : "client_attested",
    mode: ownVerified ? "professional" : undefined,
    reason: k.registeredToWaqif === "no" ? "أجاب الواقف بأن الأصل غير مسجل باسمه بصك ساري." : k.registeredToWaqif !== "yes" ? "لم يُجب." : ownVerified ? `تحقق الفريق من صك الملكية المرفق (${ownVerified}).` : x.attached.ownership ? "الصك مرفق ولم يُتحقق منه بعد." : "إقرار الواقف دون صك مرفق.",
    source: "إجابة «هل الأصل مملوك ومسجل باسم الواقف؟» ومستند صك الملكية", rule: "لا يُصاغ الوقف على أصل لا يملكه الواقف (الدليل الإرشادي لصياغة وثيقة الوقف، المبادئ 11–14).",
  });
  if (k.registeredToWaqif !== "yes") d.gap("ownership", "الأصل غير مسجل باسم الواقف بصك ساري (أو لم يُجب)", { field: "registeredToWaqif", hint: "لا يُصاغ الوقف على أصل لا يملكه الواقف؛ يُستكمل ما يثبت الملكية." });
  if (!x.attached.ownership) d.gap("doc:ownership", "صك ملكية الأصل لم يُرفق", { kind: "document", why: "لإثبات ملك الواقف للأصل ومطابقة رقم الصك.", hint: "يرفعه العميل في خانة المستند." });
  const mortVerified = x.verifiedDocs?.mortgagee;
  d.check({
    key: "mortgage", label: "الأصل غير مرهون أو أُرفقت موافقة المرتهن", ref: "q28",
    status: k.mortgaged === "no" ? "client_attested" : k.mortgaged === "yes" ? (x.attached.mortgagee ? (mortVerified ? "verified" : "specialist") : "failed") : "incomplete",
    mode: mortVerified ? "professional" : undefined,
    reason: k.mortgaged === "no" ? "إقرار الواقف بأن الأصل غير مرهون؛ لم يُتحقق من سجل الرهون." : k.mortgaged === "yes" ? (x.attached.mortgagee ? (mortVerified ? `تحقق الفريق من موافقة المرتهن (${mortVerified}).` : "موافقة المرتهن مرفقة ولم يُتحقق منها.") : "الأصل مرهون ولا موافقة مرتهن مرفقة.") : "لم يُجب.",
    source: "إجابة «هل الأصل مرهون؟» ومستند موافقة المرتهن", rule: "لا يوقف المرهون إلا بعد سداد الرهن أو موافقة المرتهن (100 سؤال، س28).",
  });
  if (k.mortgaged === "yes" && !x.attached.mortgagee) d.gap("mortgaged", "الأصل مرهون ولم تُرفق موافقة المرتهن", { kind: "document", hint: "100 سؤال س28: لا يوقف المرهون إلا بعد سداد الرهن أو موافقة المرتهن." });

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

  // Board
  if (k.nazirType === "board") {
    d.use("boardSize", k.boardSize);
    d.add("board", "مجلس النظارة", `يتكون مجلس النظارة من ${num(k.boardSize) ?? fill("عدد الأعضاء")} أعضاء. ${fill("أسماء الأعضاء الأوائل، وآلية تعيينهم، ونصاب اجتماعاته وقراراته")}`, ["draft1"]);
    d.gap("board_rules", "تشكيل مجلس النظارة وآلية قراراته لم تُحدد في النموذج", { owner: "specialist", clause: "board", hint: "يكتبها المختص في نص البند بعد الرجوع للواقف." });
  }

  // Closing (Q100 Q76)
  d.use("amendmentRight", k.amendmentRight);
  d.add("closing", "الخاتمة", k.amendmentRight === "yes"
    ? `يشترط الواقف لنفسه حق تعديل ${fill("الشروط القابلة للتعديل")}، على أن يكون تعديل الشروط بعد ثبوت الوقف بالرجوع إلى المحكمة المختصة.`
    : "هذه الوثيقة هي المرجع في شروط الوقف، ولا يُغيَّر شيء من شروطه بعد ثبوته إلا بالرجوع إلى المحكمة المختصة.", ["q76"], "client");
  if (k.amendmentRight === "yes") d.gap("amendment_scope", "الشروط التي يحتفظ الواقف بحق تعديلها لم تُحدد", { owner: "specialist", clause: "closing", hint: "تُحدد مع الواقف وتُكتب في نص البند." });
  d.check({ key: "official", label: "التوثيق لدى الجهة المختصة", status: "incomplete", reason: "لم يُسجَّل توثيق رسمي للوقف. يُسجَّل بعد صدوره ورفع ما يثبته، ولا يُعد اعتماد المنصة توثيقًا.", source: "سجل التوثيق الرسمي للمخرج", rule: "التوثيق يتم لدى الجهة المختصة لا في المنصة.", ref: "waqifsNajiz" });

  const signatures = [{ role: "الواقف", name: k.waqifName?.trim() || x.requesterName }, { role: "الشهود (وفق ما تطلبه جهة التوثيق)", name: "" }];
  return { title: "نص وثيقة الوقف", clauses: d.clauses, signatures, checks: d.checks, gaps: d.gaps };
}
