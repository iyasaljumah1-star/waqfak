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
 * Cadence: only where the source states it is it preset — the catalog's own service definition (F03 «قيود شهرية»،
 * I07 «تقرير ربعي») or the nature of the service (N02/N05: one cycle per board meeting). Everywhere else it is NOT SET
 * until an authorized user fixes it within the contract (in the quote, or at term setup): no cycle, due date or
 * reminder exists before that. The project's reference files set no delivery periodicity for these services.
 */
import { addDays, addMonths } from "@/server/engines/dates";
import { outputsFor, type OutputDef, type Profile } from "@/server/modules/outputs/catalog";

export type Cadence = "monthly" | "quarterly" | "semiannual" | "annual" | "event" | "custom";
export const CADENCE_AR: Record<Cadence, string> = {
  monthly: "شهرية", quarterly: "ربع سنوية", semiannual: "نصف سنوية", annual: "سنوية", event: "بحسب الحدث (اجتماع أو دفعة)",
  custom: "تواريخ أو مراحل تعاقدية محددة",
};
export const CADENCE_MONTHS: Record<"monthly" | "quarterly" | "semiannual" | "annual", number> = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };
const ALL: Cadence[] = ["monthly", "quarterly", "semiannual", "annual", "event", "custom"];
export type ClientAcceptance = "required" | "info";
export const ACCEPTANCE_AR: Record<ClientAcceptance, string> = {
  required: "اعتماد العميل لازم لكل تسليم قبل إقفال دورته",
  info: "للإحاطة والاطلاع: للعميل أن يعتمد أو يطلب تعديلًا، ولا يلزم اعتماده لإقفال الدورة",
};

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
  /** Preset cadence where the source states it; null = not set until the contract fixes it. */
  cadence: Cadence | null;
  /** The source of the preset cadence (shown with it). */
  cadenceSource: string | null;
  allowed: Cadence[];
  /** Client acceptance of each delivery: the default, and whether a contract may change it. */
  acceptance: { mode: ClientAcceptance; fixed: boolean };
  /** N01: each delivery gets a delivery record («محضر التسليم») approved internally before the cycle closes. */
  deliveryRecord?: boolean;
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
const T_SEND = "إتاحة المعتمد للعميل في المنصة";

export const CONTINUOUS: Record<string, ContinuousSpec> = {
  N01: {
    code: "N01", cadence: null, cadenceSource: null, allowed: ALL.filter((c) => c !== "event"), dueOffsetDays: 15,
    acceptance: { mode: "required", fixed: true }, deliveryRecord: true,
    delivery: { kind: "output", title: "تقرير الناظر الدوري", profile: "nazara_report", review: "independent" },
    tasks: ["مطابقة الصرف والقيود للفترة", "متابعة الالتزامات والعقود والتحصيل", "إعداد تقرير الناظر", T_REVIEW, T_SEND, "إعداد محضر التسليم واعتماده"],
    inputs: [{ key: "ledger", label: "قيود الفترة في المالية", check: "ledger_in_period" }, { key: "beneficiaries", label: "سجل المستفيدين", check: "beneficiaries" }],
    closing: { title: "محضر تسليم الوقف عند انتهاء النظارة", profile: "nazara_study" },
    onboardingOutput: true,
    basis: "الكتالوج: «تقرير نظارة دوري معتمد» دون تحديد دوريته. ملفات المشروع لا تحدد دورية لتقرير الخدمة (مبادئ الحوكمة الاسترشادية تذكر تقارير سنوية يصدرها الناظر عن الوقف، وهي التزام الوقف لا دورية الخدمة). تُحدد بالعقد.",
  },
  N02: {
    code: "N02", cadence: "event", cadenceSource: "طبيعة الخدمة: مقعد في المجلس، فالمتابعة لكل اجتماع", allowed: ["event", "custom"], dueOffsetDays: 7,
    acceptance: { mode: "info", fixed: true },
    delivery: { kind: "followup", title: "متابعة اجتماع المجلس (العضو المستقل)" },
    tasks: ["دراسة جدول الأعمال ومستنداته", "حضور الاجتماع", "تسجيل موقف العضو المستقل وتحفظاته"],
    inputs: [{ key: "meeting", label: "اجتماع المجلس المرتبط بالدورة", check: "meeting_linked" }],
    onboardingOutput: false,
    basis: "الكتالوج: «مقعد مستقل في مجلس النظارة». لا يوجد تسليم دوري، فالمتابعة سجل لكل اجتماع دون تقرير مصطنع.",
  },
  N03: {
    code: "N03", cadence: null, cadenceSource: null, allowed: ALL, dueOffsetDays: 10, acceptance: { mode: "required", fixed: false },
    delivery: { kind: "output", title: "تقرير المساندة الدوري للناظر", profile: "periodic_report", review: "self_allowed" },
    tasks: ["مراجعة وضع الوقف للفترة", "جلسة متابعة مع الناظر", "إعداد التقرير الدوري", T_REVIEW, T_SEND],
    inputs: [],
    onboardingOutput: false,
    basis: "الكتالوج: «مساندة استشارية مستمرة وتقارير دورية» دون تحديد الدورية. تُحدد بالعقد.",
  },
  N04: {
    code: "N04", cadence: null, cadenceSource: null, allowed: ALL, dueOffsetDays: 10, acceptance: { mode: "required", fixed: false },
    delivery: { kind: "output", title: "تقرير الإدارة التشغيلية للناظر", profile: "periodic_report", review: "self_allowed" },
    tasks: ["متابعة التأجير والتحصيل", "متابعة الصيانة والإصلاح", "إعداد تقرير الفترة للناظر", T_REVIEW, T_SEND],
    inputs: [{ key: "ledger", label: "قيود الفترة في المالية", check: "ledger_in_period" }, { key: "leases", label: "عقود الإيجار في ملف الوقف", check: "leases" }],
    onboardingOutput: false,
    basis: "الكتالوج: «إدارة تشغيلية مستمرة وتقارير للناظر» دون تحديد الدورية. تُحدد بالعقد.",
  },
  N05: {
    code: "N05", cadence: "event", cadenceSource: "الكتالوج: «جداول الأعمال، والدعوات، والمحاضر» — محضر لكل اجتماع", allowed: ["event", "custom"], dueOffsetDays: 7,
    acceptance: { mode: "info", fixed: true },
    delivery: { kind: "minutes", title: "محضر اجتماع المجلس المعتمد" },
    tasks: ["إعداد جدول الأعمال وإرسال الدعوات", "حضور الاجتماع وتدوين المحضر", "تعميم المحضر وجمع الاعتماد", "متابعة تنفيذ القرارات"],
    inputs: [{ key: "meeting", label: "اجتماع المجلس المرتبط بالدورة", check: "meeting_linked" }, { key: "minutes", label: "محضر معتمد في الحوكمة", check: "minutes_approved" }],
    onboardingOutput: false,
    basis: "الكتالوج: «أمانة مجلس مستمرة ومحاضر معتمدة». المحضر يعتمده المجلس في وحدة الحوكمة، فاعتماد العميل للتسليم للإحاطة.",
  },
  N06: {
    code: "N06", cadence: null, cadenceSource: null, allowed: ALL, dueOffsetDays: 7, acceptance: { mode: "required", fixed: false },
    delivery: { kind: "output", title: "تقرير متابعة أعمال الوقف", profile: "periodic_report", review: "self_allowed" },
    tasks: ["متابعة المهام مع الأطراف", "حصر المنجز والمتأخر", "إعداد تقرير المتابعة", T_REVIEW, T_SEND],
    inputs: [],
    onboardingOutput: false,
    basis: "الكتالوج: «تشغيل يومي منتظم وتقارير متابعة» دون تحديد دورية التقارير. تُحدد بالعقد.",
  },
  N07: {
    code: "N07", cadence: null, cadenceSource: null, allowed: ALL, dueOffsetDays: 5, acceptance: { mode: "required", fixed: true },
    delivery: { kind: "output", title: "كشف الصرف وتحديث سجل المستفيدين", profile: "finance_report", review: "independent" },
    tasks: ["تحديث سجل المستفيدين", "إعداد كشف الصرف بأرقام مرجعية", "مطابقة الصرف من حساب الوقف", T_REVIEW, T_SEND],
    inputs: [{ key: "beneficiaries", label: "سجل المستفيدين", check: "beneficiaries" }, { key: "distribution", label: "دفعة صرف مسجلة في الفترة", check: "distribution_in_period" }],
    onboardingOutput: false,
    basis: "الكتالوج: «سجل المستفيدين وكشوف الصرف» دون دورية؛ وتتبع دفعات الصرف بشرط الواقف. تُحدد بالعقد.",
  },
  F03: {
    code: "F03", cadence: "monthly", cadenceSource: "الكتالوج: «مسك منتظم لدفاتر الوقف بقيود شهرية» و«دفاتر محاسبية شهرية»", allowed: ALL, dueOffsetDays: 10,
    acceptance: { mode: "required", fixed: false },
    delivery: { kind: "output", title: "دفاتر الشهر المحاسبية", profile: "finance_report", review: "self_allowed" },
    tasks: ["تسجيل قيود الشهر", "مطابقة كشف الحساب البنكي", "إقفال الشهر", T_REVIEW, T_SEND],
    inputs: [{ key: "ledger", label: "قيود الشهر في المالية", check: "ledger_in_period" }],
    onboardingOutput: false,
    basis: "الكتالوج: «مسك منتظم لدفاتر الوقف بقيود شهرية».",
  },
  F08: {
    code: "F08", cadence: null, cadenceSource: null, allowed: ALL, dueOffsetDays: 15, acceptance: { mode: "required", fixed: false },
    delivery: { kind: "output", title: "تقرير الأداء المالي للفترة", profile: "finance_report", review: "self_allowed" },
    tasks: ["استخراج أرقام الفترة من القيود", "تحليل المؤشرات", "كتابة الإيضاحات", T_REVIEW, T_SEND],
    inputs: [{ key: "ledger", label: "قيود الفترة في المالية", check: "ledger_in_period" }],
    onboardingOutput: false,
    basis: "الكتالوج: «تقرير الأداء المالي الدوري» دون تحديد الدورية. تُحدد بالعقد.",
  },
  I07: {
    code: "I07", cadence: "quarterly", cadenceSource: "الكتالوج: «تقرير ربعي بمؤشرات أداء الأصول والاستثمارات»", allowed: ALL, dueOffsetDays: 20,
    acceptance: { mode: "required", fixed: false },
    delivery: { kind: "output", title: "تقرير أداء الأصول والاستثمار", profile: "investment_assets", review: "self_allowed" },
    tasks: ["تحديث بيانات الأصول والمحافظ", "مقارنة الأداء بالسياسة المعتمدة", "كتابة التقييم والتوصية", T_REVIEW, T_SEND],
    inputs: [{ key: "assets", label: "أصول مسجلة في ملف الوقف", check: "assets" }, { key: "policy", label: "سياسة استثمار معتمدة", check: "investment_policy" }],
    onboardingOutput: false,
    basis: "الكتالوج: «تقرير ربعي». يجوز للعقد دورية أخرى.",
  },
  I09: {
    code: "I09", cadence: null, cadenceSource: null, allowed: ALL, dueOffsetDays: 30, acceptance: { mode: "required", fixed: false },
    delivery: { kind: "output", title: "خطة الصيانة والتشغيل ومتابعتها", profile: "ops_package", review: "self_allowed" },
    tasks: ["حصر حالة العقارات", "إعداد خطة الصيانة والتشغيل", "متابعة توثيق العقود في «إيجار»", T_REVIEW, T_SEND],
    inputs: [{ key: "assets", label: "عقارات مسجلة في ملف الوقف", check: "assets" }],
    onboardingOutput: false,
    basis: "الكتالوج: «خطة الصيانة والتشغيل» دون دورية. تُحدد بالعقد. ترخيص إدارة الأملاك للغير ما زال «بانتظار التحقق».",
  },
  C06: {
    code: "C06", cadence: null, cadenceSource: null, allowed: ALL, dueOffsetDays: 30, acceptance: { mode: "required", fixed: false },
    delivery: { kind: "output", title: "تقرير المستفيدين للفترة", profile: "periodic_report", review: "self_allowed" },
    tasks: ["تجميع بيانات الصرف والمستفيدين", "إتاحة القوائم المالية", "إعداد التقرير", T_REVIEW, T_SEND],
    inputs: [{ key: "beneficiaries", label: "سجل المستفيدين", check: "beneficiaries" }],
    onboardingOutput: false,
    basis: "الكتالوج: «تقارير دورية للمستفيدين» دون تحديد الدورية (الدليل المختصر: إتاحة المعلومات للموقوف عليهم «بشكل دوري» دون مدة). تُحدد بالعقد.",
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
export const CYCLE_KEY_RE = /^([A-Z]\d{2})\.(cycle|closing|record)@c(\d+)$/;
export const parseCycleKey = (key: string) => {
  const m = CYCLE_KEY_RE.exec(key);
  return m ? { code: m[1], closing: m[2] === "closing", record: m[2] === "record", seq: Number(m[3]) } : null;
};

// ───────────────────────── Schedule ─────────────────────────

export type CustomDelivery = { label: string; due: string; from?: string | null; to?: string | null };
export type TermLike = {
  cadence: Cadence; startOn: string; endOn: string; dueOffsetDays: number; status: "active" | "suspended" | "terminated"; terminatedOn?: string | null;
  customDates?: CustomDelivery[] | null;
};
export type CycleLike = {
  id: string; seq: number; kind: "periodic" | "event" | "closing"; label: string; periodStart: string | null; periodEnd: string | null; dueOn: string;
  status: "open" | "sent" | "closed" | "skipped"; outputKey: string | null; clientDecision?: "approved" | "revision_requested" | null;
};

/** The last day the service runs: the term end, or the termination date when terminated earlier. */
export const effectiveEnd = (t: TermLike) => (t.status === "terminated" && t.terminatedOn && t.terminatedOn < t.endOn ? t.terminatedOn : t.endOn);

const AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

/** Contractual dates (cadence «custom») sorted by due date and kept within the service's term. */
export function customDeliveries(t: TermLike) {
  const end = effectiveEnd(t);
  return [...(t.customDates ?? [])].filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.due) && (e.from ?? e.due) <= end).sort((a, b) => a.due.localeCompare(b.due));
}

/**
 * Period n (1-based) of the term: a calendar period of the cadence (clipped to the term), or the n-th contractual date
 * («custom»). Null when there is none (events have no schedule).
 */
export function periodOf(t: TermLike, n: number): { label: string; from: string; to: string; due: string } | null {
  if (t.cadence === "event" || n < 1) return null;
  if (t.cadence === "custom") {
    const e = customDeliveries(t)[n - 1];
    return e ? { label: e.label, from: e.from ?? t.startOn, to: e.to ?? e.due, due: e.due } : null;
  }
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

/** `reapproved`: approved again after the client's revision request (the new version is ready to be made available). */
export type OutputState = { status: "draft" | "in_review" | "returned" | "approved" | null; currentVersion?: number; reapproved?: boolean } | null;
export type CyclePhase =
  | "preparing" | "returned" | "in_review" | "approved" | "client_review" | "client_revision" | "client_approved" | "followup" | "closed" | "skipped";
export const PHASE_AR: Record<CyclePhase, string> = {
  preparing: "قيد الإعداد", returned: "أُعيد للتعديل (مراجعة داخلية)", in_review: "بانتظار المراجعة والاعتماد الداخلي", approved: "معتمد داخليًا ولم يُتح للعميل",
  client_review: "أُتيح للعميل في المنصة بانتظار رده", client_revision: "طلب العميل تعديله", client_approved: "اعتمده العميل",
  followup: "متابعة قائمة", closed: "مقفلة", skipped: "متجاوزة بسبب مسجّل",
};

/** A cycle's phase from its own status, the client's decision, and its output's review status. */
export function cyclePhase(c: Pick<CycleLike, "status" | "outputKey" | "clientDecision">, o: OutputState, delivery: Delivery["kind"]): CyclePhase {
  if (c.status === "closed") return "closed";
  if (c.status === "skipped") return "skipped";
  if (c.status === "sent") return c.clientDecision === "approved" ? "client_approved" : "client_review";
  if (!c.outputKey || delivery !== "output") return "followup";
  if (c.clientDecision === "revision_requested" && o?.status === "approved" && !o.reapproved) return "client_revision";
  if (!o?.status || o.status === "draft") return "preparing";
  return o.status;
}

export type TermState = "active" | "suspended" | "terminated" | "ended";
export const TERM_AR: Record<TermState, string> = { active: "سارية", suspended: "معلّقة", terminated: "منهاة قبل موعدها", ended: "انتهت المدة" };

export function termState(t: Pick<TermLike, "status" | "endOn">, today: string): TermState {
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

/**
 * What still prevents closing a cycle: its tasks, the client's approval when the contract requires it (never implied by
 * silence or time), and — for N01 — the delivery record approved internally.
 */
export function closeBlockers(c: { status: string; clientDecision?: string | null; checklist: { done: boolean; label: string }[] }, opts: { acceptance: ClientAcceptance; needsOutput: boolean; recordRequired: boolean; recordApproved: boolean }): string[] {
  const out: string[] = [];
  if (opts.needsOutput && c.status !== "sent") out.push("لم يُتح التسليم للعميل بعد.");
  if (opts.needsOutput && c.status === "sent" && opts.acceptance === "required" && c.clientDecision !== "approved")
    out.push(c.clientDecision === "revision_requested" ? "طلب العميل تعديل التسليم." : "لم يعتمد العميل التسليم بعد (لا يُعد سكوته اعتمادًا).");
  if (opts.recordRequired && !opts.recordApproved) out.push("محضر التسليم لم يُعتمد داخليًا بعد.");
  const open = c.checklist.filter((x) => !x.done);
  if (open.length) out.push(`مهام الدورة غير المنجزة: ${open.map((x) => x.label).join("، ")}.`);
  return out;
}

export type CycleCounts = { total: number; done: number; late: number; pending: number; awaitingReview: number; awaitingSend: number; awaitingClient: number; skipped: number };

export function cycleCounts(rows: { c: Pick<CycleLike, "status" | "dueOn">; phase: CyclePhase }[], today: string, term: TermState): CycleCounts {
  return {
    total: rows.length,
    done: rows.filter((r) => r.c.status === "closed" || r.phase === "client_approved").length,
    late: rows.filter((r) => isLate(r.c, today, term)).length,
    pending: rows.filter((r) => r.c.status === "open").length,
    awaitingReview: rows.filter((r) => r.phase === "in_review").length,
    awaitingSend: rows.filter((r) => r.phase === "approved").length,
    awaitingClient: rows.filter((r) => r.phase === "client_review").length,
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
  /** The cadence is not set (no quote cadence, no preset): the term cannot be activated before it is chosen. */
  cadenceUnset?: boolean;
  termState: string | null;
  termLabel: string | null;
  cadence: string;
  deliveryKind: "output" | "minutes" | "followup";
  acceptance?: ClientAcceptance;
  next: { label: string; due: string } | null;
  canOpenNext: boolean;
  closingDue: boolean;
  cycles: {
    id: string; seq: number; label: string; due: string; late: boolean; phase: CyclePhase; kind: string;
    outputKey: string | null; outputId: string | null; outputStatus: string | null; returnedNote: string | null;
    blocking: string[]; unwritten: string[]; viewerCanApprove: boolean; approveBlockedReason?: string;
    inputsMissing: string[]; checklistOpen: number;
    clientNote?: string | null; closeBlockers?: string[];
    record?: { key: string; outputId: string | null; status: string | null; viewerCanApprove: boolean; blocking: string[]; unwritten: string[] } | null;
  }[];
  endBlockers: string[];
};

/** The cadence the client asked for in the intake form (a hint for the contract; never applied by itself). */
export function clientPreference(answers: Record<string, unknown>): Cadence | null {
  const f = String(answers.frequency ?? "");
  const c = (f === "irregular" ? "event" : f) as Cadence;
  return ALL.includes(c) ? c : null;
}

/** Key of the delivery record output of a cycle (N01). */
export const recordOutputKey = (code: string, seq: number) => `${code}.record@c${seq}`;

/** Contractual dates, one per line: «YYYY-MM-DD | الوصف» (the date is the delivery's due date). */
export function parseCustomDates(text: string) {
  const out: { label: string; due: string }[] = [];
  const errors: string[] = [];
  for (const [i, raw] of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).entries()) {
    const [date, ...rest] = raw.split("|").map((x) => x.trim());
    const label = rest.join(" | ");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) errors.push(`السطر ${i + 1}: التاريخ بصيغة YYYY-MM-DD.`);
    else if (label.length < 3) errors.push(`السطر ${i + 1}: اكتب وصف التسليم أو المرحلة بعد العلامة |.`);
    else out.push({ label: label.slice(0, 160), due: date });
  }
  return { dates: out, errors };
}

