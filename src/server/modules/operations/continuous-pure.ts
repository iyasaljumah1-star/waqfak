/**
 * Continuous services (PURE): the delivery model of each of the 12 services that run for a contract term (workflow
 * «subscription»), the schedule of their cycles, and the derived states shown on the continuous-services dashboard.
 *
 * Rules (owner's decision on continuous services, 15 Oct 2026):
 * - The request stays open for the term. A cycle's approval or delivery never closes it.
 * - Each period or event is a cycle with its own due date, executor, tasks, inputs, output and review.
 * - An output is approved or sent only by an explicit act. Generating a draft is neither.
 * - A cycle closes on its own; the next one opens on the same request.
 * - Cycles never create invoices. Invoices follow the contract's installments, shown apart as the financial cycle.
 * - No uniform monthly cycle. Each service has the cadence of its nature, adjustable within the allowed options of
 *   its contract. A service with no periodic document gets a follow-up record, not a manufactured report.
 *
 * Where the catalog states the period (F03 «قيود شهرية», I07 «تقرير ربعي»), it is fixed. Where it only says
 * «دوري», the default below is an operational choice set per contract at term setup.
 */
import { addDays, addMonths } from "@/server/engines/dates";
import { outputsFor, type OutputDef, type Profile } from "@/server/modules/outputs/catalog";

export type Cadence = "monthly" | "quarterly" | "semiannual" | "annual" | "event";
export const CADENCE_AR: Record<Cadence, string> = {
  monthly: "شهرية", quarterly: "ربع سنوية", semiannual: "نصف سنوية", annual: "سنوية", event: "بحسب الحدث (اجتماع أو دفعة)",
};
export const CADENCE_MONTHS: Record<Exclude<Cadence, "event">, number> = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };

/** Data a cycle needs before its delivery can be prepared (checked live against the waqf's records). */
export type InputCheck = "ledger_in_period" | "distribution_in_period" | "meeting_linked" | "minutes_approved" | "assets" | "beneficiaries" | "investment_policy" | "leases";
export type CycleInput = { key: string; label: string; check: InputCheck };

/**
 * output    = a document drafted on the platform per cycle, reviewed, approved, then sent to the client.
 * minutes   = the meeting's minutes from the governance module (approved there by the board); the cycle records them.
 * followup  = no delivered document: the cycle is a follow-up record closed with a note (what was attended and done).
 */
export type Delivery =
  | { kind: "output"; title: string; profile: Profile; review: "independent" | "self_allowed" }
  | { kind: "minutes"; title: string }
  | { kind: "followup"; title: string };

export type ContinuousSpec = {
  code: string;
  cadence: Cadence;
  allowed: Cadence[];
  /** Days after a period ends by which its delivery is due (default; set per contract). */
  dueOffsetDays: number;
  delivery: Delivery;
  tasks: string[];
  inputs: CycleInput[];
  /** End-of-service delivery (opened when the term ends or is terminated). */
  closing?: { title: string; profile: Profile };
  /** The service keeps its one-off onboarding output (N01: study of the waqf file before acceptance). */
  onboardingOutput: boolean;
  /** Why this cadence: the catalog text, or «operational default». */
  basis: string;
};

const T_REVIEW = "مراجعة المسودة واعتمادها";
const T_SEND = "إرسال المعتمد للعميل";

export const CONTINUOUS: Record<string, ContinuousSpec> = {
  N01: {
    code: "N01", cadence: "quarterly", allowed: ["quarterly", "semiannual", "annual"], dueOffsetDays: 15,
    delivery: { kind: "output", title: "تقرير النظارة الدوري", profile: "periodic_report", review: "independent" },
    tasks: ["مطابقة الصرف والقيود للفترة", "متابعة الالتزامات النظامية المستحقة", "إعداد تقرير النظارة", T_REVIEW, T_SEND],
    inputs: [{ key: "ledger", label: "قيود الفترة في المالية", check: "ledger_in_period" }, { key: "beneficiaries", label: "سجل المستفيدين", check: "beneficiaries" }],
    closing: { title: "محضر تسليم الوقف عند انتهاء النظارة", profile: "nazara_study" },
    onboardingOutput: true,
    basis: "الكتالوج: «تقرير نظارة دوري معتمد» و«محضر تسليم عند انتهاء النظارة». الدورية لم تُحدد، فالافتراضي ربعي ويُضبط بالعقد.",
  },
  N02: {
    code: "N02", cadence: "event", allowed: ["event"], dueOffsetDays: 7,
    delivery: { kind: "followup", title: "متابعة اجتماع المجلس (العضو المستقل)" },
    tasks: ["دراسة جدول الأعمال ومستنداته", "حضور الاجتماع", "تسجيل موقف العضو المستقل وتحفظاته"],
    inputs: [{ key: "meeting", label: "اجتماع المجلس المرتبط بالدورة", check: "meeting_linked" }],
    onboardingOutput: false,
    basis: "الكتالوج: «مقعد مستقل في مجلس النظارة». لا يوجد تسليم دوري، فالمتابعة سجل لكل اجتماع دون تقرير مصطنع.",
  },
  N03: {
    code: "N03", cadence: "quarterly", allowed: ["monthly", "quarterly", "semiannual"], dueOffsetDays: 10,
    delivery: { kind: "output", title: "تقرير المساندة الدوري للناظر", profile: "periodic_report", review: "self_allowed" },
    tasks: ["مراجعة وضع الوقف للفترة", "جلسة متابعة مع الناظر", "إعداد التقرير الدوري", T_REVIEW, T_SEND],
    inputs: [],
    onboardingOutput: false,
    basis: "الكتالوج: «مساندة استشارية مستمرة وتقارير دورية» و«مراجعة دورية لوضع الوقف». الافتراضي ربعي.",
  },
  N04: {
    code: "N04", cadence: "monthly", allowed: ["monthly", "quarterly"], dueOffsetDays: 10,
    delivery: { kind: "output", title: "تقرير الإدارة التشغيلية للناظر", profile: "periodic_report", review: "self_allowed" },
    tasks: ["متابعة التأجير والتحصيل", "متابعة الصيانة والإصلاح", "إعداد تقرير الفترة للناظر", T_REVIEW, T_SEND],
    inputs: [{ key: "ledger", label: "قيود الفترة في المالية", check: "ledger_in_period" }, { key: "leases", label: "عقود الإيجار في ملف الوقف", check: "leases" }],
    onboardingOutput: false,
    basis: "الكتالوج: «إدارة تشغيلية مستمرة وتقارير للناظر». الافتراضي شهري لأن الإدارة يومية بتفويض.",
  },
  N05: {
    code: "N05", cadence: "event", allowed: ["event"], dueOffsetDays: 7,
    delivery: { kind: "minutes", title: "محضر اجتماع المجلس المعتمد" },
    tasks: ["إعداد جدول الأعمال وإرسال الدعوات", "حضور الاجتماع وتدوين المحضر", "تعميم المحضر وجمع الاعتماد", "متابعة تنفيذ القرارات"],
    inputs: [{ key: "meeting", label: "اجتماع المجلس المرتبط بالدورة", check: "meeting_linked" }, { key: "minutes", label: "محضر معتمد في الحوكمة", check: "minutes_approved" }],
    onboardingOutput: false,
    basis: "الكتالوج: «أمانة مجلس مستمرة ومحاضر معتمدة». التسليم يتبع الاجتماعات، والمحضر يعتمده المجلس في وحدة الحوكمة.",
  },
  N06: {
    code: "N06", cadence: "monthly", allowed: ["monthly", "quarterly"], dueOffsetDays: 7,
    delivery: { kind: "output", title: "تقرير متابعة أعمال الوقف", profile: "periodic_report", review: "self_allowed" },
    tasks: ["متابعة المهام مع الأطراف", "حصر المنجز والمتأخر", "إعداد تقرير المتابعة", T_REVIEW, T_SEND],
    inputs: [],
    onboardingOutput: false,
    basis: "الكتالوج: «تشغيل يومي منتظم وتقارير متابعة». الافتراضي شهري.",
  },
  N07: {
    code: "N07", cadence: "event", allowed: ["event", "monthly", "quarterly", "semiannual", "annual"], dueOffsetDays: 5,
    delivery: { kind: "output", title: "كشف الصرف وتحديث سجل المستفيدين", profile: "finance_report", review: "independent" },
    tasks: ["تحديث سجل المستفيدين", "إعداد كشف الصرف بأرقام مرجعية", "مطابقة الصرف من حساب الوقف", T_REVIEW, T_SEND],
    inputs: [{ key: "beneficiaries", label: "سجل المستفيدين", check: "beneficiaries" }, { key: "distribution", label: "دفعة صرف مسجلة في الفترة", check: "distribution_in_period" }],
    onboardingOutput: false,
    basis: "الكتالوج: «سجل المستفيدين وكشوف الصرف» و«الصرف من حساب الوقف فقط». الكشف يتبع دفعات الصرف المقررة.",
  },
  F03: {
    code: "F03", cadence: "monthly", allowed: ["monthly"], dueOffsetDays: 10,
    delivery: { kind: "output", title: "دفاتر الشهر المحاسبية", profile: "finance_report", review: "self_allowed" },
    tasks: ["تسجيل قيود الشهر", "مطابقة كشف الحساب البنكي", "إقفال الشهر", T_REVIEW, T_SEND],
    inputs: [{ key: "ledger", label: "قيود الشهر في المالية", check: "ledger_in_period" }],
    onboardingOutput: false,
    basis: "الكتالوج: «مسك منتظم لدفاتر الوقف بقيود شهرية» و«دفاتر محاسبية شهرية».",
  },
  F08: {
    code: "F08", cadence: "quarterly", allowed: ["monthly", "quarterly", "semiannual", "annual"], dueOffsetDays: 15,
    delivery: { kind: "output", title: "تقرير الأداء المالي للفترة", profile: "finance_report", review: "self_allowed" },
    tasks: ["استخراج أرقام الفترة من القيود", "تحليل المؤشرات", "كتابة الإيضاحات", T_REVIEW, T_SEND],
    inputs: [{ key: "ledger", label: "قيود الفترة في المالية", check: "ledger_in_period" }],
    onboardingOutput: false,
    basis: "الكتالوج: «تقرير الأداء المالي الدوري». الافتراضي ربعي.",
  },
  I07: {
    code: "I07", cadence: "quarterly", allowed: ["quarterly", "monthly", "semiannual", "annual"], dueOffsetDays: 20,
    delivery: { kind: "output", title: "تقرير أداء الأصول والاستثمار الربعي", profile: "investment_assets", review: "self_allowed" },
    tasks: ["تحديث بيانات الأصول والمحافظ", "مقارنة الأداء بالسياسة المعتمدة", "كتابة التقييم والتوصية", T_REVIEW, T_SEND],
    inputs: [{ key: "assets", label: "أصول مسجلة في ملف الوقف", check: "assets" }, { key: "policy", label: "سياسة استثمار معتمدة", check: "investment_policy" }],
    onboardingOutput: false,
    basis: "الكتالوج: «تقرير ربعي بمؤشرات أداء الأصول والاستثمارات مقارنة بالسياسة المعتمدة». نموذج الطلب يتيح للعميل دورية أخرى يثبتها العقد.",
  },
  I09: {
    code: "I09", cadence: "annual", allowed: ["semiannual", "annual"], dueOffsetDays: 30,
    delivery: { kind: "output", title: "خطة الصيانة والتشغيل ومتابعتها", profile: "ops_package", review: "self_allowed" },
    tasks: ["حصر حالة العقارات", "إعداد خطة الصيانة والتشغيل", "متابعة توثيق العقود في «إيجار»", T_REVIEW, T_SEND],
    inputs: [{ key: "assets", label: "عقارات مسجلة في ملف الوقف", check: "assets" }],
    onboardingOutput: false,
    basis: "الكتالوج: «خطة الصيانة والتشغيل». الافتراضي خطة سنوية. ترخيص إدارة الأملاك للغير ما زال «بانتظار التحقق».",
  },
  C06: {
    code: "C06", cadence: "annual", allowed: ["semiannual", "annual"], dueOffsetDays: 30,
    delivery: { kind: "output", title: "تقرير المستفيدين للفترة", profile: "periodic_report", review: "self_allowed" },
    tasks: ["تجميع بيانات الصرف والمستفيدين", "إتاحة القوائم المالية", "إعداد التقرير", T_REVIEW, T_SEND],
    inputs: [{ key: "beneficiaries", label: "سجل المستفيدين", check: "beneficiaries" }],
    onboardingOutput: false,
    basis: "الكتالوج: «تقارير دورية للمستفيدين وإتاحة القوائم المالية لهم». الافتراضي سنوي مع القوائم المالية.",
  },
};

export const CONTINUOUS_CODES = Object.keys(CONTINUOUS);
export const continuousSpec = (code: string): ContinuousSpec | null => CONTINUOUS[code] ?? null;
export const isContinuous = (svc: { code: string; workflowTemplateCode?: string | null }) =>
  !!CONTINUOUS[svc.code] || svc.workflowTemplateCode === "subscription";

/**
 * The request-level outputs of a service. A continuous service delivers per cycle, so its one-off catalog output is
 * not planned — except the onboarding study of N01, and outputs a request already has (kept, never hidden).
 */
export function requestOutputs(svc: { code: string; outputs?: string | null; nameAr?: string }, existingKeys: string[] = []): OutputDef[] {
  const defs = outputsFor(svc);
  const spec = CONTINUOUS[svc.code];
  if (!spec || spec.onboardingOutput) return defs;
  return defs.filter((d) => existingKeys.includes(d.key));
}

// ───────────────────────── Keys ─────────────────────────

export const cycleOutputKey = (code: string, seq: number, kind: "periodic" | "event" | "closing" = "periodic") =>
  kind === "closing" ? `${code}.closing@c${seq}` : `${code}.cycle@c${seq}`;
export const CYCLE_KEY_RE = /^([A-Z]\d{2})\.(cycle|closing)@c(\d+)$/;
export const parseCycleKey = (key: string) => {
  const m = CYCLE_KEY_RE.exec(key);
  return m ? { code: m[1], closing: m[2] === "closing", seq: Number(m[3]) } : null;
};

// ───────────────────────── Schedule ─────────────────────────

export type TermLike = { cadence: Cadence; startOn: string; endOn: string; dueOffsetDays: number; status: "active" | "suspended" | "terminated"; terminatedOn?: string | null };
export type CycleLike = {
  id: string; seq: number; kind: "periodic" | "event" | "closing"; label: string; periodStart: string | null; periodEnd: string | null; dueOn: string;
  status: "open" | "sent" | "closed" | "skipped"; outputKey: string | null;
};

/** The last day the service runs: the term end, or the termination date when terminated earlier. */
export const effectiveEnd = (t: TermLike) => (t.status === "terminated" && t.terminatedOn && t.terminatedOn < t.endOn ? t.terminatedOn : t.endOn);

const AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

/** Period n (1-based) of a periodic cadence, clipped to the term. Null when it starts after the service's end. */
export function periodOf(t: TermLike, n: number): { label: string; from: string; to: string; due: string } | null {
  if (t.cadence === "event" || n < 1) return null;
  const m = CADENCE_MONTHS[t.cadence];
  const from = addMonths(t.startOn, (n - 1) * m);
  const end = effectiveEnd(t);
  if (from > end) return null;
  let to = addDays(addMonths(t.startOn, n * m), -1);
  if (to > end) to = end;
  const due = addDays(to, t.dueOffsetDays);
  const monthly = t.cadence === "monthly" && from.slice(8) === "01";
  const label = monthly ? `${AR_MONTHS[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}` : `الفترة ${n}: ${from} إلى ${to}`;
  return { label, from, to, due };
}

/** Every period of the term up to the service's end. */
export function schedule(t: TermLike, max = 120) {
  const out: NonNullable<ReturnType<typeof periodOf>>[] = [];
  for (let n = 1; n <= max; n++) {
    const p = periodOf(t, n);
    if (!p) break;
    out.push(p);
  }
  return out;
}

/** The periodic cycle to open next (by period number), or null when the term has no more periods. */
export function nextPeriodic(t: TermLike, cycles: CycleLike[]) {
  if (t.cadence === "event") return null;
  const n = cycles.filter((c) => c.kind === "periodic").length + 1;
  const p = periodOf(t, n);
  return p ? { n, ...p } : null;
}

// ───────────────────────── Derived states ─────────────────────────

export type OutputState = { status: "draft" | "in_review" | "returned" | "approved" | null; currentVersion?: number } | null;
export type CyclePhase = "preparing" | "returned" | "in_review" | "approved" | "sent" | "followup" | "closed" | "skipped";
export const PHASE_AR: Record<CyclePhase, string> = {
  preparing: "قيد الإعداد", returned: "أُعيد للتعديل", in_review: "بانتظار المراجعة والاعتماد", approved: "معتمد بانتظار الإرسال",
  sent: "أُرسل للعميل بانتظار إقفال الدورة", followup: "متابعة قائمة", closed: "مقفلة", skipped: "متجاوزة بسبب مسجّل",
};

export function cyclePhase(c: Pick<CycleLike, "status" | "outputKey">, o: OutputState, delivery: Delivery["kind"]): CyclePhase {
  if (c.status === "closed") return "closed";
  if (c.status === "skipped") return "skipped";
  if (c.status === "sent") return "sent";
  if (!c.outputKey || delivery !== "output") return "followup";
  if (!o?.status || o.status === "draft") return "preparing";
  return o.status;
}

export type TermState = "active" | "suspended" | "terminated" | "ended";
export const TERM_AR: Record<TermState, string> = { active: "سارية", suspended: "معلّقة", terminated: "منهاة قبل موعدها", ended: "انتهت المدة" };

export function termState(t: TermLike, today: string): TermState {
  if (t.status === "terminated") return "terminated";
  if (t.status === "suspended") return "suspended";
  return t.endOn < today ? "ended" : "active";
}

/** A cycle is late when its delivery is still pending after its due date (not while the service is suspended). */
export const isLate = (c: Pick<CycleLike, "status" | "dueOn">, today: string, term: TermState) =>
  term !== "suspended" && (c.status === "open") && c.dueOn < today;

/**
 * Whether the service may be ended (request in progress → completed): its term ended or was terminated, every period
 * that started before the end has a cycle, every cycle is closed or skipped, and the closing delivery (if the service
 * has one) is closed. Returns the reasons it may not.
 */
export function endBlockers(spec: ContinuousSpec | null, t: TermLike | null, cycles: CycleLike[], today: string): string[] {
  if (!t) return ["لم تُحدد مدة الخدمة ودوريتها بعد."];
  const st = termState(t, today);
  const out: string[] = [];
  if (st === "terminated" && effectiveEnd(t) >= today) out.push(`الإنهاء نافذ في ${effectiveEnd(t)}: تستمر الخدمة حتى ذلك التاريخ.`);
  if (st === "active" || st === "suspended") out.push(`مدة الخدمة ${st === "active" ? `سارية حتى ${t.endOn}` : "معلّقة"}: تُنهى الخدمة بانتهاء مدتها أو بقرار إنهاء مسجّل.`);
  const open = cycles.filter((c) => c.status === "open" || c.status === "sent");
  if (open.length) out.push(`دورات لم تُقفل: ${open.map((c) => c.label).join("، ")}.`);
  if (t.cadence !== "event") {
    const have = cycles.filter((c) => c.kind === "periodic").length;
    const missing = schedule(t).slice(have);
    if (missing.length) out.push(`فترات بلا دورة (تُفتح وتُسلَّم أو تُتجاوز بسبب): ${missing.map((p) => p.label).join("، ")}.`);
  }
  if (spec?.closing && !cycles.some((c) => c.kind === "closing" && (c.status === "closed" || c.status === "skipped")))
    out.push(`لم يُقفل تسليم نهاية الخدمة: ${spec.closing.title}.`);
  return out;
}

export type CycleCounts = { total: number; done: number; late: number; pending: number; awaitingReview: number; awaitingSend: number; skipped: number };

export function cycleCounts(rows: { c: Pick<CycleLike, "status" | "dueOn">; phase: CyclePhase }[], today: string, term: TermState): CycleCounts {
  return {
    total: rows.length,
    done: rows.filter((r) => r.c.status === "closed" || r.c.status === "sent").length,
    late: rows.filter((r) => isLate(r.c, today, term)).length,
    pending: rows.filter((r) => r.c.status === "open").length,
    awaitingReview: rows.filter((r) => r.phase === "in_review").length,
    awaitingSend: rows.filter((r) => r.phase === "approved").length,
    skipped: rows.filter((r) => r.c.status === "skipped").length,
  };
}

/** Checklist template of a new cycle. */
export const checklistOf = (spec: ContinuousSpec, kind: "periodic" | "event" | "closing") =>
  (kind === "closing" ? ["حصر الأصول والمستندات والأرصدة", "إعداد محضر التسليم", T_REVIEW, "تسليم الملف للناظر الخلف أو الجهة المختصة"] : spec.tasks)
    .map((label, i) => ({ key: `t${i + 1}`, label, done: false }));

// ───────────────────────── Plan snapshot ─────────────────────────

export type ContinuousSnap = {
  hasTerm: boolean;
  termState: string | null;
  termLabel: string | null;
  cadence: string;
  deliveryKind: "output" | "minutes" | "followup";
  next: { label: string; due: string } | null;
  canOpenNext: boolean;
  closingDue: boolean;
  cycles: {
    id: string; seq: number; label: string; due: string; late: boolean; phase: CyclePhase; kind: string;
    outputKey: string | null; outputId: string | null; outputStatus: string | null; returnedNote: string | null;
    blocking: string[]; unwritten: string[]; viewerCanApprove: boolean; approveBlockedReason?: string;
    inputsMissing: string[]; checklistOpen: number;
  }[];
  endBlockers: string[];
};

/** Cadence suggested at term setup: the client's answer in the intake form when the service allows it. */
export function suggestedCadence(spec: ContinuousSpec, answers: Record<string, unknown>): Cadence {
  const f = String(answers.frequency ?? "");
  const c = (f === "irregular" ? "event" : f) as Cadence;
  return spec.allowed.includes(c) ? c : spec.cadence;
}
