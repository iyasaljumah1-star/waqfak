/**
 * Service-request workflow: explicit status state machine + stage planning.
 * PURE module (no DB / server imports) so the transition table is unit-testable.
 * The DB side (events, audit, notifications, SLA) lives in ./engine.ts.
 */

export type RequestStatus =
  | "draft" | "submitted" | "triage" | "awaiting_client" | "quote" | "awaiting_contract"
  | "in_progress" | "quality_review" | "awaiting_client_approval" | "completed" | "closed"
  | "on_hold" | "cancelled" | "rejected";

/** Who performs a transition. `client` = requester or a waqf member with requests.create;
 *  `assignee` = the staff member the request is assigned to; `reviewer` = staff with staff.quality_review
 *  who did not deliver the work (four-eyes); `ops` = staff with admin.requests.all. */
export type Actor = "client" | "assignee" | "reviewer" | "ops";

export type Transition = { from: RequestStatus; to: RequestStatus; by: Actor[]; label: string; needsNote?: boolean };

export const STATUS_LABEL: Record<RequestStatus, string> = {
  draft: "مسودة",
  submitted: "مُرسل",
  triage: "قيد الفرز",
  awaiting_client: "بانتظار العميل",
  quote: "عرض سعر",
  awaiting_contract: "بانتظار العقد",
  in_progress: "قيد التنفيذ",
  quality_review: "مراجعة الجودة",
  awaiting_client_approval: "بانتظار اعتماد العميل",
  completed: "مكتمل",
  closed: "مغلق",
  on_hold: "معلّق",
  cancelled: "ملغى",
  rejected: "مرفوض",
};

export const STATUS_TONE: Record<RequestStatus, "critical" | "fine" | "warn" | "ok" | "info" | "neutral" | "ink" | "seal"> = {
  draft: "neutral", submitted: "info", triage: "info", awaiting_client: "warn", quote: "seal", awaiting_contract: "seal",
  in_progress: "ink", quality_review: "ink", awaiting_client_approval: "warn", completed: "ok", closed: "neutral",
  on_hold: "fine", cancelled: "neutral", rejected: "critical",
};

export const TERMINAL: RequestStatus[] = ["closed", "cancelled", "rejected"];
/** Statuses that can be put on hold (and resumed back to). */
export const HOLDABLE: RequestStatus[] = ["submitted", "triage", "awaiting_client", "quote", "awaiting_contract", "in_progress", "quality_review", "awaiting_client_approval"];
/** "Early" statuses in which the client may cancel on their own. */
export const CLIENT_CANCELLABLE: RequestStatus[] = ["draft", "submitted", "triage", "awaiting_client", "quote", "awaiting_contract"];
/** Statuses where work is waiting on the client (SLA clock is not the company's). */
export const WAITING_ON_CLIENT: RequestStatus[] = ["awaiting_client", "quote", "awaiting_contract", "awaiting_client_approval"];

const T = (from: RequestStatus, to: RequestStatus, by: Actor[], label: string, needsNote = false): Transition => ({ from, to, by, label, needsNote });

export const TRANSITIONS: Transition[] = [
  T("draft", "submitted", ["client"], "إرسال الطلب"),
  T("draft", "cancelled", ["client"], "حذف المسودة"),

  T("submitted", "triage", ["assignee", "ops"], "بدء الفرز"),
  T("submitted", "rejected", ["ops"], "رفض الطلب", true),

  T("triage", "quote", ["assignee", "ops"], "إرسال عرض السعر"),
  T("triage", "in_progress", ["assignee", "ops"], "بدء التنفيذ"),
  T("triage", "awaiting_client", ["assignee", "ops"], "طلب معلومات من العميل", true),
  T("triage", "rejected", ["assignee", "ops"], "رفض الطلب", true),

  T("awaiting_client", "triage", ["client", "assignee", "ops"], "استكمال المعلومات"),
  T("awaiting_client", "in_progress", ["assignee", "ops"], "استئناف التنفيذ"),

  T("quote", "awaiting_contract", ["client"], "قبول عرض السعر"),
  T("quote", "triage", ["assignee", "ops"], "مراجعة عرض السعر"),

  T("awaiting_contract", "in_progress", ["assignee", "ops"], "بدء التنفيذ بعد توقيع العقد"),

  T("in_progress", "quality_review", ["assignee", "ops"], "إرسال لمراجعة الجودة"),
  T("in_progress", "awaiting_client", ["assignee", "ops"], "طلب معلومات من العميل", true),

  T("quality_review", "awaiting_client_approval", ["reviewer"], "اعتماد الجودة وإرسال للعميل"),
  T("quality_review", "in_progress", ["reviewer"], "إعادة للتعديل", true),

  T("awaiting_client_approval", "completed", ["client"], "اعتماد المخرجات"),
  T("awaiting_client_approval", "in_progress", ["client"], "طلب تعديلات", true),

  T("completed", "closed", ["assignee", "ops"], "إغلاق الطلب"),

  // Continuous services only (guarded): the request ends with the service term, not with a delivery.
  T("in_progress", "completed", ["assignee", "ops"], "إنهاء الخدمة المستمرة بانتهاء مدتها", true),
];

/** Transitions that exist for one kind of service only. */
export function appliesTo(t: Pick<Transition, "from" | "to">, continuous: boolean) {
  if (t.from === "in_progress" && t.to === "completed") return continuous;
  if (t.from === "in_progress" && t.to === "quality_review") return !continuous;
  return true;
}

// Client cancellation while early; ops may cancel anything not finished.
for (const s of CLIENT_CANCELLABLE) if (s !== "draft") TRANSITIONS.push(T(s, "cancelled", ["client", "ops"], "إلغاء الطلب", true));
for (const s of ["in_progress", "quality_review", "awaiting_client_approval", "on_hold"] as RequestStatus[]) TRANSITIONS.push(T(s, "cancelled", ["ops"], "إلغاء الطلب", true));
// Hold from any active status; resume returns to the status recorded when the hold began.
for (const s of HOLDABLE) {
  TRANSITIONS.push(T(s, "on_hold", ["assignee", "ops"], "تعليق الطلب", true));
  TRANSITIONS.push(T("on_hold", s, ["assignee", "ops"], "استئناف الطلب"));
}

export function findTransition(from: RequestStatus, to: RequestStatus): Transition | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}

export function canTransition(from: RequestStatus, to: RequestStatus, actors: Actor[]): boolean {
  const t = findTransition(from, to);
  return !!t && t.by.some((a) => actors.includes(a));
}

/** Transitions available from a status to a set of actor capacities (resume limited to the prior status). */
export function availableTransitions(from: RequestStatus, actors: Actor[], opts: { resumeTo?: RequestStatus | null } = {}): Transition[] {
  return TRANSITIONS.filter((t) => t.from === from && t.by.some((a) => actors.includes(a)) && (from !== "on_hold" || t.to === "cancelled" || t.to === opts.resumeTo));
}

export const HOLD_PARTY_LABEL: Record<string, string> = { client: "العميل", gaa: "الهيئة العامة للأوقاف", court: "المحكمة", third_party: "طرف ثالث" };

// ───────────────────────── Guards (business rules beyond the table) ─────────────────────────

export type GuardInput = {
  from: RequestStatus;
  to: RequestStatus;
  actorUserId: string;
  conflictCheck: string;
  workflowCode: string;
  /** user ids who delivered the work (submitted deliverables / sent to QA) */
  deliverers: string[];
  submittedDeliverables: number;
  unsignedOpinionDeliverables: number;
  contractSignedByClient: boolean;
  hasContract: boolean;
  quoteAmount: number | null;
  pricingModel: string;
  /** Intake verified by staff / request accepted for service (undefined = not tracked, legacy callers). */
  verified?: boolean;
  accepted?: boolean;
  /** Required deficiency items not accepted or cancelled. */
  blockingItems?: number;
  /** The request has versioned quotes, and one of them is accepted. */
  hasQuotes?: boolean;
  quoteAccepted?: boolean;
  /** New-style contract with parties: all required parties signed. */
  contractExecuted?: boolean;
  /** Installments marked "before start" that are not fully paid. */
  prestartUnpaid?: number;
  /** Platform outputs still being drafted (draft/returned) and waiting for review. */
  outputsUnfinished?: number;
  outputsInReview?: number;
  /** Every delivery comes from an output approved under a self-approval policy and the actor is an authorized manager:
   *  the four-eyes rule of quality review is satisfied by the output policy (recorded). */
  selfApprovalCoversQA?: boolean;
  /** Continuous service (workflow «subscription»): reasons the service may not end yet (empty = it may). */
  continuous?: { endBlockers: string[] } | null;
};

/** Returns an Arabic error when a guard blocks the transition, otherwise null. */
export function guardTransition(g: GuardInput): string | null {
  const starting = (g.to === "quote" || g.to === "in_progress") && (g.from === "triage" || g.from === "awaiting_client" || g.from === "awaiting_contract");
  if (starting && g.conflictCheck === "blocked")
    return "تعارض في الاستقلال: يبدأ العمل بعد اعتماد مدير التشغيل استثناءً مسببًا.";
  if ((g.to === "quote" || (g.from === "triage" && g.to === "in_progress")) && g.verified === false) return "تحقق من بيانات الطلب ومستنداته أولًا (لا نواقص مطلوبة مفتوحة).";
  if ((g.to === "quote" || (g.from === "triage" && g.to === "in_progress")) && g.accepted === false) return "اقبل الطلب للخدمة أولًا.";
  if (g.to === "quote" && !(g.quoteAmount && g.quoteAmount > 0)) return "حدّد مبلغ عرض السعر أولًا.";
  if (g.from === "quote" && g.to === "awaiting_contract" && g.hasQuotes && !g.quoteAccepted) return "يُقبل العرض من لوحة «عرض السعر» حتى يُسجَّل قبول النسخة المعروضة.";
  if (g.from === "triage" && g.to === "in_progress" && g.pricingModel !== "free" && g.hasContract && !g.contractSignedByClient)
    return "لم يوقّع العميل العقد بعد.";
  if (g.from === "awaiting_contract" && g.to === "in_progress" && !g.contractSignedByClient) return "يبدأ التنفيذ بعد توقيع العميل على العقد.";
  if (g.from === "awaiting_contract" && g.to === "in_progress" && g.contractExecuted === false) return "يبدأ التنفيذ بعد اكتمال توقيع جميع أطراف العقد.";
  if (g.from === "awaiting_contract" && g.to === "in_progress" && (g.prestartUnpaid ?? 0) > 0) return "لم تُسدد الدفعة التي يشترط العرض سدادها قبل البدء.";
  if ((g.to === "completed" || g.to === "closed") && (g.blockingItems ?? 0) > 0) return `لا يكتمل الطلب وفيه ${g.blockingItems} من النواقص أو الاستفسارات المطلوبة غير المغلقة.`;
  if (g.from === "in_progress" && g.to === "completed") {
    if (!g.continuous) return "يكتمل الطلب بعد مراجعة الجودة واعتماد العميل.";
    if (g.continuous.endBlockers.length) return `لا تُنهى الخدمة المستمرة بعد: ${g.continuous.endBlockers.join(" ")}`;
  }
  if (g.from === "in_progress" && g.to === "quality_review" && g.continuous)
    return "خدمة مستمرة: تُسلَّم مخرجاتها عبر دورات التسليم، ويبقى الطلب مفتوحًا حتى نهاية مدة الخدمة.";
  if (g.to === "quality_review" && (g.outputsUnfinished ?? 0) > 0) return `في الطلب ${g.outputsUnfinished} من المخرجات قيد الإعداد: أرسلها للمراجعة أولًا.`;
  if (g.to === "quality_review" && g.submittedDeliverables === 0) return "ارفع مخرجًا واحدًا على الأقل قبل الإرسال لمراجعة الجودة.";
  if (g.from === "quality_review" && g.to === "awaiting_client_approval") {
    if ((g.outputsUnfinished ?? 0) + (g.outputsInReview ?? 0) > 0) return "لا يُرسل للعميل قبل اعتماد كل المخرجات المعدّة في المنصة.";
    if (g.deliverers.includes(g.actorUserId) && !g.selfApprovalCoversQA) return "مبدأ العينين الأربع: يراجع جودةَ العمل زميلٌ آخر غير من أعدّه.";
    if (g.workflowCode === "opinion" && g.unsignedOpinionDeliverables > 0)
      return "الرأي المتخصص يجب أن يكون موقّعًا باسم المستشار وصفته قبل إرساله للعميل.";
  }
  return null;
}

// ───────────────────────── Stage planning ─────────────────────────

export type StageStatus = "pending" | "active" | "done" | "skipped";
export type PlanStage = { key: string; role: string; clientApproval?: boolean; status: StageStatus };

const isQuality = (s: PlanStage) => s.role === "quality";
const isClient = (s: PlanStage) => !!s.clientApproval || s.role === "client";

/**
 * Computes stage statuses after a status change. Rules:
 * - submitted/triage/quote/contract: first stage active.
 * - in_progress: stages before the first quality stage are worked in order (advanceStage moves along);
 *   returning from QA/client reactivates the last work stage and resets QA and later stages.
 * - quality_review: work stages done, quality stage active.
 * - awaiting_client_approval: quality done, the next stage (client approval / delivery) active.
 * - completed/closed: all done. cancelled/rejected: unfinished stages skipped. on_hold/awaiting_client: unchanged.
 */
export function planStages(stages: PlanStage[], from: RequestStatus, to: RequestStatus): StageStatus[] {
  const out = stages.map((s) => s.status);
  if (!stages.length) return out;
  const qIdx = stages.findIndex(isQuality);
  // last index of "work" stages (before QA, or before the first client stage when there is no QA)
  const firstClient = stages.findIndex(isClient);
  const workEnd = qIdx >= 0 ? qIdx - 1 : firstClient > 0 ? firstClient - 1 : stages.length - 1;

  switch (to) {
    case "submitted":
    case "triage":
    case "quote":
    case "awaiting_contract":
      if (!out.some((s) => s === "active" || s === "done")) out[0] = "active";
      return out;
    case "in_progress": {
      if (from === "quality_review" || from === "awaiting_client_approval") {
        const back = Math.max(0, workEnd);
        for (let i = back; i < stages.length; i++) out[i] = "pending";
        out[back] = "active";
        return out;
      }
      if (from === "on_hold" || from === "awaiting_client") {
        if (!out.includes("active")) out[out.findIndex((s) => s === "pending") >= 0 ? out.findIndex((s) => s === "pending") : 0] = "active";
        return out;
      }
      // Starting work: intake (first stage) is done, the next work stage becomes active.
      if (out[0] !== "done") out[0] = "done";
      const next = 1 <= workEnd ? 1 : -1;
      if (next > 0 && out[next] === "pending") out[next] = "active";
      else if (!out.includes("active") && workEnd === 0 && stages.length > 1) out[1] = "active";
      return out;
    }
    case "quality_review": {
      for (let i = 0; i <= workEnd; i++) out[i] = "done";
      if (qIdx >= 0) out[qIdx] = "active";
      else if (workEnd + 1 < stages.length) out[workEnd + 1] = "active";
      return out;
    }
    case "awaiting_client_approval": {
      const upto = qIdx >= 0 ? qIdx : workEnd;
      for (let i = 0; i <= upto; i++) out[i] = "done";
      if (upto + 1 < stages.length) {
        out[upto + 1] = "active";
        for (let i = upto + 2; i < stages.length; i++) out[i] = "pending";
      }
      return out;
    }
    case "completed":
    case "closed":
      return out.map((s) => (s === "skipped" ? s : "done"));
    case "cancelled":
    case "rejected":
      return out.map((s) => (s === "done" ? s : "skipped"));
    default:
      return out;
  }
}

/** Within in_progress: completes the active work stage and activates the next work stage. Returns null if not allowed. */
export function advanceStage(stages: PlanStage[]): StageStatus[] | null {
  const out = stages.map((s) => s.status);
  const a = out.indexOf("active");
  if (a < 0) return null;
  const next = a + 1;
  if (next >= stages.length || isQuality(stages[next]) || isClient(stages[next])) return null;
  out[a] = "done";
  out[next] = "active";
  return out;
}

// ───────────────────────── Conflict of interest / separation of duties ─────────────────────────

export type ConflictInput = { rule: string; waqfakRole: string | null; openServiceCodes: string[]; hasWaqf: boolean };
export type ConflictResult = { result: "passed" | "blocked"; note: string | null };

export function evaluateConflict(c: ConflictInput): ConflictResult {
  const role = c.waqfakRole ?? "none";
  switch (c.rule) {
    case "blocked_if_waqfak_controls_finance": {
      const controls = ["nazir", "delegated_manager", "bookkeeper"].includes(role) || c.openServiceCodes.includes("F03") || c.openServiceCodes.includes("N01") || c.openServiceCodes.includes("N04");
      return controls
        ? { result: "blocked", note: "استقلال المراجعة: تتولى وقفك النظارة أو الإدارة أو مسك الدفاتر لهذا الوقف، وحرصًا على استقلال الرأي تُسند مراجعة عملها إلى مراجع خارجي مستقل، أو يعتمد مدير التشغيل استثناءً مسببًا." }
        : { result: "passed", note: null };
    }
    case "blocked_if_waqfak_nazir": {
      const nazir = role === "nazir" || c.openServiceCodes.includes("N01");
      return nazir
        ? { result: "blocked", note: "استقلال التقييم: وقفك هي ناظر هذا الوقف، وحرصًا على استقلال الرأي يُسند تقييم أداء النظارة أو المجلس الذي تعمل فيه إلى مقيّم مستقل، أو يعتمد مدير التشغيل استثناءً مسببًا." }
        : { result: "passed", note: null };
    }
    case "inside_nazara_only":
      return role === "nazir"
        ? { result: "passed", note: null }
        : { result: "blocked", note: "تُقدَّم هذه الخدمة للأوقاف التي تتولى وقفك نظارتها، ضمن أجر النظارة؛ حرصًا على استقلال المراجعة المالية لاحقًا." };
    default:
      return { result: "passed", note: null };
  }
}

// ───────────────────────── Actor resolution ─────────────────────────

export type ActorFacts = {
  userId: string;
  isRequester: boolean;
  memberCanCreate: boolean;
  isAssignee: boolean;
  perms: Set<string> | string[];
  deliverers: string[];
};

export function actorsFor(f: ActorFacts): Actor[] {
  const has = (p: string) => (Array.isArray(f.perms) ? f.perms.includes(p) : f.perms.has(p));
  const a: Actor[] = [];
  if (f.isRequester || f.memberCanCreate) a.push("client");
  if (f.isAssignee && has("staff.requests.assigned")) a.push("assignee");
  if (has("staff.quality_review") && !f.deliverers.includes(f.userId)) a.push("reviewer");
  if (has("admin.requests.all")) a.push("ops");
  return a;
}
