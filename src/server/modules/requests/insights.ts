/**
 * Field-level analysis of a service request (PURE).
 *
 * For each answer and each waqf-file block the team sees, under the value, what the platform can say about it — and of
 * what kind: what the client entered (not verified), what the records establish (with the record), what the system
 * infers from them (an inference, stated as such), what it recommends next, what is missing or contradictory, and
 * what needs a specialist. It never states a conclusion the data does not support, never treats a client's entry as
 * verified, and never decides a specialist matter.
 */
import { CONTEXT_STATUS_AR, ctxField, type ContextBlock } from "./context/types";
import { displayValue, fieldRequired, tableRows, validateField, visibleFields, visibleSteps, type Answers, type DocMap, type Field, type ReviewKind, type ServiceForm } from "./intake/engine";
import type { FieldReviewStatus } from "@/server/db/schema/operations";

export type InsightKind = "client" | "fact" | "inference" | "recommendation" | "specialist" | "gap" | "conflict";
export type Insight = {
  kind: InsightKind;
  text: string;
  /** Records or documents the statement rests on. */
  evidence?: string[];
  /** Suggested team task (title), offered as a one-click task beside the insight. */
  task?: string;
};

export const INSIGHT_KIND_AR: Record<InsightKind, string> = {
  client: "إدخال العميل",
  fact: "حقيقة من السجلات",
  inference: "استنتاج آلي",
  recommendation: "توصية",
  specialist: "يحتاج رأي مختص",
  gap: "نقص",
  conflict: "تعارض",
};
const REVIEW_AR: Record<ReviewKind, string> = { sharia: "شرعي", legal: "قانوني", financial: "مالي ومحاسبي", technical: "فني" };

export type FieldOrigin = "client" | "file" | "file_changed" | "staff" | "client_completion" | "system";
export type FieldState = { status: FieldReviewStatus; approvedValue: unknown; decidedAt: string | null; decidedBy: string | null; note: string | null };
export type RevisionLite = { kind: string; target: string | null; at: string; actor: string; reason: string | null; before: unknown; after: unknown };
export type ItemLite = { seq: number; fieldKey: string | null; status: string; title: string };
export type ConflictLite = { key: string; label: string; fields: string[]; status: string; severity: string; action: string };

export type InsightInput = {
  code: string;
  form: ServiceForm;
  answers: Answers;
  docs: DocMap;
  /** Field key → current value in the waqf file / account for prefilled fields (to tell confirmed from changed). */
  fileValues: Record<string, string | null | undefined>;
  blocks: ContextBlock[];
  states: Record<string, FieldState>;
  revisions: RevisionLite[];
  items: ItemLite[];
  conflicts: ConflictLite[];
};

export type FieldView = {
  key: string;
  label: string;
  stepKey: string;
  stepTitle: string;
  value: string;
  raw: unknown;
  origin: FieldOrigin;
  required: boolean;
  error: string | null;
  review: ReviewKind | null;
  state: FieldReviewStatus;
  /** Approved, but the value changed since: shown as needing review. */
  approvalOutdated: boolean;
  insights: Insight[];
};
export type BlockView = { block: ContextBlock; state: FieldReviewStatus; approvalOutdated: boolean; insights: Insight[] };

export type RequestAnalysis = {
  steps: { key: string; title: string; fields: FieldView[] }[];
  blocks: BlockView[];
  summary: { fields: number; required: number; requiredValid: number; approved: number; needsReview: number; pending: number; gaps: number; conflicts: number; completeness: number };
};

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const fact = (b: ContextBlock) => b.facts;

export function analyzeRequest(i: InsightInput): RequestAnalysis {
  const steps: RequestAnalysis["steps"] = [];
  const openItems = i.items.filter((x) => x.status === "open" || x.status === "correction_requested");
  for (const st of visibleSteps(i.form, i.answers)) {
    const fields: FieldView[] = [];
    for (const f of visibleFields(st, i.answers)) {
      if (f.type === "hidden" || f.type === "ack") continue;
      const v = i.answers[f.key];
      const required = fieldRequired(f, i.answers);
      const error = validateField(f, v, i.answers);
      const lastRev = [...i.revisions].reverse().find((r) => r.target === f.key && (r.kind === "intake_edit" || r.kind === "client_completion"));
      const fileV = f.prefill ? i.fileValues[f.key] : undefined;
      const origin: FieldOrigin = lastRev ? (lastRev.kind === "client_completion" ? "client_completion" : "staff") : f.prefill && fileV != null && fileV !== "" ? (String(v ?? "") === String(fileV) ? "file" : "file_changed") : "client";
      const st8 = i.states[f.key];
      const approvalOutdated = st8?.status === "approved" && !same(st8.approvedValue, v ?? null);
      const insights: Insight[] = [];
      // what the value is, and how far it can be relied on
      if (v === undefined || v === null || (typeof v === "string" && !v.trim())) {
        if (required) insights.push({ kind: "gap", text: "إجابة مطلوبة لم تُقدَّم.", task: `استكمال «${f.label}» من العميل` });
      } else if (origin === "file") {
        insights.push({ kind: "fact", text: "مطابق لملف الوقف.", evidence: ["ملف الوقف"] });
      } else if (origin === "file_changed") {
        insights.push({ kind: "conflict", text: `يخالف ما في ملف الوقف (${String(fileV)}). يُتحقق من المستند ثم تُصحَّح الإجابة أو يُحدَّث الملف بإجرائه.`, evidence: ["ملف الوقف", "إجابة العميل"], task: `التحقق من «${f.label}» مقابل ملف الوقف` });
      } else if (origin === "staff" && lastRev) {
        insights.push({ kind: "fact", text: `صحّحه الفريق${lastRev.reason ? ` — السبب: ${lastRev.reason}` : ""}. القيمة السابقة محفوظة في سجل التصحيحات.`, evidence: [`سجل التصحيحات ${lastRev.at.slice(0, 10)}`] });
      } else if (origin === "client_completion" && lastRev) {
        insights.push({ kind: "client", text: "استكمله العميل ردًا على طلب استكمال، ولم يُراجع بعد." });
      } else if (st8?.status !== "approved") {
        insights.push({ kind: "client", text: "أدخله العميل، ولم يُتحقق منه بعد." });
      }
      if (error && v !== undefined) insights.push({ kind: "gap", text: error });
      if (f.review && v !== undefined) insights.push({ kind: "specialist", text: `يحتاج رأيًا ${REVIEW_AR[f.review]} قبل الاعتماد عليه.`, task: `مراجعة ${REVIEW_AR[f.review]}: «${f.label}»` });
      for (const c of i.conflicts.filter((x) => x.status === "open" && x.fields.includes(f.key))) insights.push({ kind: "conflict", text: `${c.label}. ${c.action}` });
      for (const it of openItems.filter((x) => x.fieldKey === f.key)) insights.push({ kind: "gap", text: `طلب استكمال مفتوح #${it.seq}: ${it.title}` });
      if (approvalOutdated) insights.push({ kind: "recommendation", text: "تغيّرت القيمة بعد اعتمادها؛ أعد مراجعتها." });
      insights.push(...serviceFieldRules(i, f, v));
      fields.push({
        key: f.key, label: f.label, stepKey: st.key, stepTitle: st.title, value: displayValue(f, v), raw: v ?? null, origin, required, error: v === undefined ? (required ? error : null) : error,
        review: f.review ?? null, state: approvalOutdated ? "needs_review" : st8?.status ?? "pending", approvalOutdated, insights,
      });
    }
    if (fields.length) steps.push({ key: st.key, title: st.title, fields });
  }

  const blocks: BlockView[] = i.blocks.map((b) => {
    const s = i.states[ctxField(b.key)];
    const approvalOutdated = s?.status === "approved" && !same(s.approvedValue, b.fingerprint);
    const ins: Insight[] = [];
    const src = [`${b.source}${b.asOf ? ` (آخر تحديث ${b.asOf.slice(0, 10)})` : ""}`];
    if (b.status === "missing") ins.push({ kind: "gap", text: `${b.title}: غير مسجلة في ملف الوقف؛ لا يُفترض وجودها. تُطلب من العميل أدلتها أو تُسجَّل في الملف.`, evidence: src, task: `استكمال «${b.title}»` });
    else ins.push({ kind: "fact", text: `${CONTEXT_STATUS_AR[b.status]} في ${b.source}.`, evidence: src });
    for (const g of b.gaps) ins.push({ kind: b.status === "stale" ? "recommendation" : "gap", text: g, task: `معالجة: ${g}` });
    if (approvalOutdated) ins.push({ kind: "recommendation", text: "تغيّرت هذه البيانات في ملف الوقف بعد اعتمادها؛ أعد مراجعتها." });
    if (i.answers.dataReview === "needs_update") ins.push({ kind: "client", text: `أفاد العميل بأن بعض البيانات يحتاج تحديثًا${i.answers.dataUpdateScope === "file" ? " في ملف الوقف" : " لهذا الطلب"}: ${String(i.answers.dataCorrections ?? "")}` });
    ins.push(...serviceBlockRules(i, b));
    return { block: b, state: approvalOutdated ? "needs_review" : s?.status ?? "pending", approvalOutdated, insights: ins };
  });

  const all = steps.flatMap((s) => s.fields);
  const req = all.filter((f) => f.required);
  const requiredValid = req.filter((f) => !f.error && f.raw !== null).length;
  const units = [...all.map((f) => f.state), ...blocks.map((b) => b.state)];
  const gaps = [...all.flatMap((f) => f.insights), ...blocks.flatMap((b) => b.insights)].filter((x) => x.kind === "gap").length;
  const conflicts = [...all.flatMap((f) => f.insights), ...blocks.flatMap((b) => b.insights)].filter((x) => x.kind === "conflict").length;
  const blocksReady = blocks.filter((b) => b.block.status === "recorded" || b.block.status === "partial").length;
  const denom = req.length + blocks.length;
  return {
    steps, blocks,
    summary: {
      fields: all.length, required: req.length, requiredValid,
      approved: units.filter((s) => s === "approved").length, needsReview: units.filter((s) => s === "needs_review").length, pending: units.filter((s) => s === "pending").length,
      gaps, conflicts, completeness: denom ? Math.round(((requiredValid + blocksReady) / denom) * 100) : 100,
    },
  };
}

// ───────────── Service rules: inferences only from recorded facts, each with its evidence ─────────────

const blk = (i: InsightInput, k: ContextBlock["key"]) => i.blocks.find((b) => b.key === k);
const num = (x: unknown) => (x === null || x === undefined || x === "" ? null : Number(String(x).replace(/[,٬]/g, "")));

function serviceFieldRules(i: InsightInput, f: Field, v: unknown): Insight[] {
  const out: Insight[] = [];
  const a = i.answers;
  // custom weights must total 100%
  if (f.key === "weights" && a.weighting === "custom") {
    const total = tableRows(v as string).reduce((s, r) => s + (num(r.weight) ?? 0), 0);
    if (Math.round(total) !== 100) out.push({ kind: "gap", text: `مجموع الأوزان ${total}٪، والمطلوب 100٪.`, task: "تصحيح أوزان محاور التقييم مع العميل" });
  }
  // a period must run forward
  if (f.key === "periodTo" && typeof a.periodFrom === "string" && typeof v === "string" && v < a.periodFrom) out.push({ kind: "conflict", text: "نهاية الفترة قبل بدايتها." });
  // budget: expenses against revenues
  if (i.code === "F04" && f.key === "expenses") {
    const rev = tableRows(a.revenues as string).reduce((s, r) => s + (num(r.amount) ?? 0), 0);
    const exp = tableRows(v as string).reduce((s, r) => s + (num(r.amount) ?? 0), 0);
    if (rev && exp > rev) out.push({ kind: "inference", text: `المصروفات المخطط لها (${exp.toLocaleString("en")}) تتجاوز الإيرادات المتوقعة (${rev.toLocaleString("en")}) بعجز ${(exp - rev).toLocaleString("en")} ر.س.`, evidence: ["إجابات العميل في الجدولين"] });
    const maint = tableRows(v as string).filter((r) => r.category === "maintenance").reduce((s, r) => s + (num(r.amount) ?? 0), 0);
    if (exp && !maint) out.push({ kind: "recommendation", text: "لا بند للصيانة والتشغيل؛ والأصل استقطاع ما يلزم لهما قبل الصرف (لائحة تنظيم أعمال النظارة م12/2).", evidence: ["لائحة تنظيم أعمال النظارة م12/2"] });
    const prev = blk(i, "finance.records");
    if (prev && !prev.facts.statementYear) out.push({ kind: "gap", text: "لا قوائم مالية سابقة مسجلة يُبنى عليها تقدير الإيرادات.", evidence: [prev.source] });
  }
  if (i.code === "G09" && f.key === "kpisRecorded" && v === "none") out.push({ kind: "inference", text: "بلا مؤشرات مقاسة يقوم التقييم على السجلات والمقابلات والتقييم الذاتي، لا على نتائج رقمية.", evidence: ["إجابة العميل"] });
  if (i.code === "G09" && f.key === "hasPlan" && v === "no") out.push({ kind: "recommendation", text: "لا خطة معتمدة للفترة: يُقيَّم الأداء مقابل شرط الواقف والالتزامات النظامية، ويُوصى بإعداد خطة (خدمة G04).", evidence: ["إجابة العميل"] });
  if (i.code === "G03" && f.key === "independent") {
    const size = num(a.boardSize);
    const ind = num(v);
    if (size && ind !== null && ind * 3 < size) out.push({ kind: "recommendation", text: `المستقلون المقترحون ${ind} من ${size}. تنص مبادئ حوكمة الأوقاف على أن يشكل المستقلون نسبة مؤثرة في المداولات، ولا سيما في الأوقاف الكبيرة والأهلية.`, evidence: ["مبادئ حوكمة الأوقاف (مسودة)، المبدأ الرابع"] });
  }
  if (i.code === "C08" && f.key === "legalDeadline" && typeof v === "string") out.push({ kind: "recommendation", text: `مهلة نظامية في ${v}: تُقدَّم المسألة على غيرها في التوزيع.`, task: `متابعة المهلة النظامية ${v}` });
  return out;
}

function serviceBlockRules(i: InsightInput, b: ContextBlock): Insight[] {
  const out: Insight[] = [];
  const x = fact(b);
  if (i.code === "G09" || i.code === "N05" || i.code === "C05") {
    if (b.key === "board.meetings" && typeof x.target === "number" && typeof x.held === "number" && x.held < x.target)
      out.push({ kind: "inference", text: `عُقد ${x.held} من ${x.target} اجتماعات مستهدفة في الفترة؛ وتنص مبادئ الحوكمة على الالتزام بعدد الاجتماعات المقررة.`, evidence: [b.source, "مبادئ حوكمة الأوقاف، المبدأ الرابع"] });
    if (b.key === "board.resolutions" && typeof x.resolutions === "number" && x.resolutions > 0) {
      const done = Number(x.done ?? 0);
      const tasks = Number(x.tasks ?? 0);
      out.push({ kind: "inference", text: `نُفّذ ${done} من ${tasks} مهمة تنفيذ لقرارات الفترة${Number(x.overdue) ? `، ومنها ${x.overdue} متأخرة` : ""}${Number(x.approvedNoTask) ? `؛ و${x.approvedNoTask} قرارًا معتمدًا بلا متابعة تنفيذ مسجلة` : ""}.`, evidence: [b.source] });
    }
  }
  if (i.code === "G09" && b.key === "board.composition") {
    if (Number(x.members) && !Number(x.independent)) out.push({ kind: "inference", text: "لا عضو مستقل في المجلس القائم.", evidence: [b.source, "مبادئ حوكمة الأوقاف، المبدأ الرابع"] });
    if (Number(x.withoutAccount)) out.push({ kind: "recommendation", text: `${x.withoutAccount} من الأعضاء بلا حساب في المنصة؛ لا يمكن جمع تقييمهم الذاتي إلا خارجها.`, evidence: [b.source] });
  }
  if (i.code === "G09" && b.key === "governance.evaluations" && x.lastYear) out.push({ kind: "fact", text: `آخر تقييم مسجل لسنة ${x.lastYear}: يُقارن به التقييم الحالي.`, evidence: [b.source] });
  if ((i.code === "G08" || i.code === "F06" || i.code === "F05") && b.key === "finance.records") {
    if (!Number(x.ledgerEntries)) out.push({ kind: "inference", text: "لا قيود محاسبية مسجلة للفترة في المنصة: تقوم المراجعة على الكشوف البنكية والمستندات المرفقة.", evidence: [b.source] });
  }
  if ((i.code === "I08" || i.code === "I01" || i.code === "I07") && b.key === "assets.register" && Number(x.staleValuations))
    out.push({ kind: "recommendation", text: `${x.staleValuations} أصلًا قيمته المسجلة أقدم من 12 شهرًا؛ لا يُعتمد عليها في القرار قبل تحديثها.`, evidence: [b.source], task: "تحديث تقييم الأصول القديمة" });
  if (b.key === "documents.key" && i.code === "C08" && !Number(x.waqf_deed)) out.push({ kind: "gap", text: "صك الوقف غير مرفوع: لا يُبنى الرأي القانوني على وصف الصك دون نصه.", evidence: [b.source], task: "طلب صك الوقف من العميل" });
  if (b.key === "compliance.obligations" && Number(x.overdue)) out.push({ kind: "recommendation", text: `${x.overdue} التزامًا نظاميًا متأخرًا؛ يُذكر أثرها في المخرج.`, evidence: [b.source] });
  return out;
}
