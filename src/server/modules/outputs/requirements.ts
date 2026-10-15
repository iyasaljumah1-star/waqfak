/**
 * The deficiency list of an output (PURE): what the document needs before it can move on, why, who provides it, its
 * state, and what it stops. Four layers, kept apart:
 *   common     — rules for every service (form answers, conflicts between sources);
 *   service    — what this service's document rests on (W01 and T03 declared below; others from their form);
 *   document   — the documents the form asks for (attached, then verified by the team);
 *   specialist — what only a specialist decides (rulings, attestation evidence): never closed by the platform.
 *
 * A requirement's state is read from the version's gaps and checks — the same records the generator wrote — so the
 * list, the draft placeholders and the approval guard can never disagree.
 */
import type { OutputCheck, OutputGap } from "@/server/db/schema/operations";
import type { CheckReview } from "./checks";

export type ReqNeed = "mandatory" | "optional" | "review";
export type ReqScope = "common" | "service" | "document" | "specialist";
export type ReqStatus = "met" | "attested" | "missing" | "conflict" | "failed" | "pending_review" | "na";
export type ReqOwner = "client" | "team" | "specialist";

export type Requirement = {
  key: string;
  label: string;
  why: string;
  need: ReqNeed;
  scope: ReqScope;
  /** Where the value comes from (form field, document, waqf file, specialist). */
  source: string;
  owner: ReqOwner;
  status: ReqStatus;
  /** What the open requirement stops (empty when met). */
  effect: string;
  /** Detail of the current state (the gap or check behind it). */
  detail?: string;
  /** Field of the form to correct (anchor on the request page). */
  field?: string;
};

type Spec = Omit<Requirement, "status" | "effect" | "detail"> & {
  /** Gap keys (exact, or prefix ending with ":") that mean this requirement is open. */
  gaps?: string[];
  /** Check behind the requirement. */
  check?: string;
  /** Applies only when… (on the answers). */
  when?: (k: Record<string, string>, t: Record<string, Record<string, string>[]>) => boolean;
};

export const REQ_STATUS_AR: Record<ReqStatus, string> = {
  met: "مستوفى", attested: "إقرار العميل", missing: "ناقص", conflict: "تعارض", failed: "فشل التحقق", pending_review: "بانتظار المختص", na: "غير منطبق",
};
export const REQ_NEED_AR: Record<ReqNeed, string> = { mandatory: "إلزامي", optional: "اختياري", review: "يحتاج مراجعة مختص" };
export const REQ_SCOPE_AR: Record<ReqScope, string> = { common: "قواعد عامة", service: "متطلبات الخدمة", document: "المستندات", specialist: "قرار المختص" };
export const REQ_OWNER_AR: Record<ReqOwner, string> = { client: "العميل", team: "فريق التنفيذ", specialist: "المختص" };

const FORM = "نموذج الطلب";

const W01: Spec[] = [
  { key: "testator", label: "اسم الموصي ورقم هويته", why: "يُكتب بهما الموصي في الديباجة ويُطابقان عند التوثيق.", need: "mandatory", scope: "service", source: `${FORM}: بيانات الموصي`, owner: "client", gaps: ["field:testatorName", "field:testatorId", "invalid:testatorId", "conflict:doc_number:testatorId:testatorId", "conflict:applicant:"], field: "testatorName" },
  { key: "previous_will", label: "حال الوصايا السابقة وحكمها", why: "يُبيَّن هل للموصي وصية سابقة وهل تُلغى أو تُعدَّل (الدليل الإرشادي لصياغة وثيقة الوقف، المبدأ الثاني).", need: "mandatory", scope: "service", source: `${FORM}: الوصايا السابقة`, owner: "client", gaps: ["field:hasPreviousWill", "field:previousWillDate", "field:previousWillAction", "invalid:previousWillDate", "conflict:will:previous_attached"], field: "hasPreviousWill" },
  { key: "previous_will_doc", label: "نسخة الوصية السابقة", why: "لمطابقة تاريخها ومضمونها قبل إلغائها أو تعديلها.", need: "mandatory", scope: "document", source: "مستند «الوصية السابقة»", owner: "client", gaps: ["doc:previousWill"], check: "previous_will", when: (k) => k.hasPreviousWill === "yes" },
  { key: "bequests", label: "الوصايا: الموصى له ونوعها ومقدارها", why: "مضمون الوصية؛ لا يُكتب بند بلا موصى له ومقدار.", need: "mandatory", scope: "service", source: `${FORM}: جدول «ما توصي به»`, owner: "client", gaps: ["field:bequests", "invalid:bequests:", "share_over_100"], field: "bequests" },
  { key: "waqf_consistency", label: "اتساق الوقف بعد الوفاة بين الإجابة والجدول", why: "لا يُصاغ بند وقف أو ينفى وقف على إجابتين متعارضتين.", need: "mandatory", scope: "common", source: `${FORM}: «هل في وصاياك وقف بعد الوفاة؟» وجدول الوصايا`, owner: "client", gaps: ["conflict:will:waqf_answer_vs_bequests", "conflict:will:waqf_answer_without_row", "waqf_missing_row"], check: "waqf_consistency", field: "includesWaqf" },
  { key: "waqf_terms", label: "مصارف الوقف بعد الوفاة وناظره", why: "يُعيَّن بها الوقف: على من تُصرف غلته ومن يتولاه وكيف يُستخلف.", need: "mandatory", scope: "service", source: `${FORM}: الوقف بعد الوفاة`, owner: "client", gaps: ["field:waqfMasarif", "field:waqfNazir", "field:waqfSuccession", "waqf_shares_over"], when: (k) => k.includesWaqf === "yes", field: "waqfMasarif" },
  { key: "waqf_name", label: "اسم الوقف بعد الوفاة", why: "يُسمّى به الوقف؛ يجوز تركه.", need: "optional", scope: "service", source: `${FORM}: اسم الوقف`, owner: "client", gaps: ["field:waqfName"], when: (k) => k.includesWaqf === "yes", field: "waqfName" },
  { key: "estate", label: "تقدير إجمالي التركة", why: "لحساب نسبة الوصايا بالمبالغ إلى الثلث.", need: "optional", scope: "service", source: `${FORM}: تقدير التركة (تقدير العميل)`, owner: "client", gaps: ["third_unknown", "conflict:will:amounts_over_estate"], when: (_k, t) => (t.bequests ?? []).some((r) => r.basis === "amount"), field: "estimatedEstate" },
  { key: "executor", label: "منفذ الوصية", why: "من يتولى تنفيذ الوصية بعد الوفاة.", need: "mandatory", scope: "service", source: `${FORM}: الوصي`, owner: "client", gaps: ["field:executorName"], field: "executorName" },
  { key: "alternate_executor", label: "وصي بديل", why: "يتولى التنفيذ إن تعذّر على الأول.", need: "optional", scope: "service", source: `${FORM}: الوصي البديل`, owner: "client", gaps: [], field: "alternateExecutor" },
  { key: "documentation", label: "طريقة توثيق الوصية والشهود", why: "توثيق لدى الجهة المختصة، أو إشهاد على وصية لم توثق.", need: "mandatory", scope: "service", source: `${FORM}: التوثيق وجدول الشهود`, owner: "client", gaps: ["field:documentation", "field:witnesses", "invalid:witnesses", "conflict:will:testator_as_witness"], field: "documentation" },
  { key: "attestation", label: "ما يثبت حصول الإشهاد", why: "إدخال أسماء الشهود لا يثبت الإشهاد؛ يلزم الإشهاد على وصية بوقف لم توثق (الدليل الإرشادي للواقفين، ص40).", need: "review", scope: "specialist", source: "توقيع الشهود على الوصية أو مستند يرفق", owner: "specialist", check: "attestation", when: (k) => k.documentation === "witnesses" },
  { key: "third", label: "نفاذ الوصايا في حدود الثلث", why: "الوقف المعلق على الموت يأخذ حكم الوصية ولا يلزم إلا في الثلث إلا بإجازة الورثة (100 سؤال، س16).", need: "review", scope: "specialist", source: "جدول الوصايا ورأي المستشار الشرعي", owner: "specialist", check: "third_legal", gaps: ["third_over"] },
  { key: "heir", label: "الوصية لوارث", why: "حكمها ونفاذها يقررهما المستشار الشرعي؛ لا يصدر النظام حكمًا.", need: "review", scope: "specialist", source: "عمود «صفة الموصى له»", owner: "specialist", check: "heir", gaps: ["heir_bequest"], when: (_k, t) => (t.bequests ?? []).some((r) => r.relation === "yes") },
];

const T03: Spec[] = [
  { key: "waqif", label: "اسم الواقف ورقم هويته", why: "يُكتب بهما الواقف ويُطابقان عند التوثيق.", need: "mandatory", scope: "service", source: `${FORM}: بيانات الواقف`, owner: "client", gaps: ["field:waqifName", "field:waqifId", "invalid:waqifId", "conflict:doc_number:waqifId:waqifId", "conflict:applicant:"], field: "waqifName" },
  { key: "asset", label: "وصف الأصل ورقم صكه", why: "يُعيَّن به الموقوف (الدليل الإرشادي لصياغة وثيقة الوقف، المبادئ 11–14).", need: "mandatory", scope: "service", source: `${FORM}: الأصل`, owner: "client", gaps: ["field:assetDescription", "field:ownershipDeedNo", "field:sharePercent", "conflict:doc_number:ownership:ownershipDeedNo", "invalid:ownershipDeedDate"], field: "assetDescription" },
  { key: "ownership", label: "ملك الواقف للأصل", why: "لا يُصاغ الوقف على أصل لا يملكه الواقف.", need: "mandatory", scope: "document", source: "صك الملكية المرفق", owner: "client", gaps: ["ownership", "doc:ownership"], check: "ownership" },
  { key: "mortgage", label: "الرهن أو موافقة المرتهن", why: "لا يوقف المرهون إلا بعد سداد الرهن أو موافقة المرتهن (100 سؤال، س28).", need: "mandatory", scope: "document", source: "إجابة الرهن ومستند موافقة المرتهن", owner: "client", gaps: ["mortgaged"], check: "mortgage" },
  { key: "masarif", label: "المصارف وترتيبها والمصرف البديل", why: "على من تُصرف الغلة وما يكون عند الانقطاع.", need: "mandatory", scope: "service", source: `${FORM}: المصارف`, owner: "client", gaps: ["field:masarif", "field:alternateMasraf", "tier_over:"], field: "masarif" },
  { key: "nazara", label: "الناظر واستخلافه", why: "من يتولى الوقف ومن يخلفه.", need: "mandatory", scope: "service", source: `${FORM}: النظارة`, owner: "client", gaps: ["field:nazirType", "field:nazirName", "field:succession"], field: "nazirType" },
  { key: "reserve", label: "نسبة عمارة الوقف", why: "إن لم تُحدد يقدّرها الناظر، ويُنص على ذلك.", need: "optional", scope: "service", source: `${FORM}: النسبة المستقطعة`, owner: "client", gaps: [], field: "reservePercent" },
  { key: "board", label: "تشكيل مجلس النظارة وآلية قراراته", why: "لا يحددها النموذج؛ يكتبها المختص بعد الرجوع للواقف.", need: "review", scope: "specialist", source: "المختص", owner: "specialist", gaps: ["board_rules"], when: (k) => k.nazirType === "board" },
  { key: "self_benefit", label: "مقدار ما يستثنيه الواقف لنفسه", why: "الدليل الإرشادي لصياغة وثيقة الوقف، المبدأ 26.", need: "review", scope: "specialist", source: "المختص بعد الرجوع للواقف", owner: "specialist", gaps: ["self_benefit_amount"], when: (k) => k.selfBenefit === "yes" },
];

const SERVICE: Record<string, Spec[]> = { W01, T03 };
export const REQUIREMENT_SERVICES = Object.keys(SERVICE);

const matches = (key: string, pats: string[]) => pats.some((p) => (p.endsWith(":") ? key.startsWith(p) : key === p));

function effectOf(need: ReqNeed, status: ReqStatus): string {
  if (status === "met" || status === "na" || status === "attested") return "";
  if (status === "conflict") return "يمنع الإرسال للمراجعة والاعتماد حتى يُصحَّح مصدر البيانات. المعاينة والحفظ والتعديل الداخلي متاحة.";
  if (status === "failed") return "يمنع الإرسال للمراجعة والاعتماد.";
  if (status === "pending_review") return "يمنع الاعتماد النهائي حتى يسجّل المختص رأيه.";
  if (need === "mandatory") return "يمنع الاعتماد النهائي (وإرسال المسودة للمراجعة). المعاينة والحفظ والتعديل الداخلي متاحة.";
  return "لا يمنع؛ يظهر في المسودة وتقرير النواقص.";
}

type Input = {
  serviceCode: string;
  keys: Record<string, string>;
  tables: Record<string, Record<string, string>[]>;
  gaps: OutputGap[];
  checks: OutputCheck[];
  reviews?: CheckReview[];
};

/** The deficiency list of a version: the service's declared requirements, then every other gap and open check. */
export function requirementsOf(x: Input): Requirement[] {
  const specs = SERVICE[x.serviceCode] ?? [];
  const reviewed = new Map((x.reviews ?? []).map((r) => [r.key, r]));
  const used = new Set<string>();
  const usedChecks = new Set<string>();
  const out: Requirement[] = [];
  for (const s of specs) {
    const { gaps: pats = [], check, when, ...base } = s;
    if (when && !when(x.keys, x.tables)) { out.push({ ...base, status: "na", effect: "" }); continue; }
    const hit = x.gaps.filter((g) => matches(g.key, pats));
    hit.forEach((g) => used.add(g.key));
    const c = check ? x.checks.find((k) => k.key === check) : undefined;
    if (check) usedChecks.add(check);
    const rv = c ? reviewed.get(c.key) : undefined;
    const isConflict = hit.some((g) => g.kind === "conflict" || g.key.startsWith("conflict:"));
    let status: ReqStatus;
    if (isConflict) status = "conflict";
    else if (c?.status === "failed" || rv?.status === "failed") status = "failed";
    else if (hit.length) status = base.need === "review" ? (rv ? "met" : "pending_review") : "missing";
    else if (c?.status === "specialist") status = rv ? (rv.status === "na" ? "na" : "met") : "pending_review";
    else if (c?.status === "incomplete") status = "missing";
    else if (c?.status === "client_attested") status = base.need === "review" ? (rv ? "met" : "pending_review") : "attested";
    else status = "met";
    out.push({ ...base, status, effect: effectOf(base.need, status), detail: [...new Set([...hit.map((g) => g.label), ...(c && status !== "met" ? [c.reason] : []), ...(rv ? [`رأي المختص: ${rv.note}`] : [])])].join("؛ ") || undefined });
  }
  // everything else the generator raised (common rules, documents, other services' fields)
  for (const g of x.gaps) {
    if (used.has(g.key)) continue;
    const need: ReqNeed = g.need ?? (g.severity === "blocking" ? "mandatory" : g.owner === "specialist" ? "review" : "optional");
    const conflict = g.kind === "conflict" || g.key.startsWith("conflict:");
    const scope: ReqScope = conflict ? "common" : g.kind === "document" || g.key.startsWith("doc:") ? "document" : g.owner === "specialist" ? "specialist" : "service";
    const status: ReqStatus = conflict ? "conflict" : need === "review" ? "pending_review" : "missing";
    out.push({
      key: `gap:${g.key}`, label: g.label, why: g.why ?? g.hint ?? "", need, scope, source: g.source ?? (g.field ? FORM : g.kind === "document" ? "مستندات الطلب" : "بيانات المنصة"),
      owner: g.owner === "specialist" ? "specialist" : g.owner === "team" ? "team" : "client", status, effect: g.effect ?? effectOf(need, status), detail: g.hint, field: g.field,
    });
  }
  for (const c of x.checks) {
    if (usedChecks.has(c.key) || c.key === "official") continue;
    const rv = reviewed.get(c.key);
    if (c.status === "failed" || (c.status === "specialist" && !rv) || rv?.status === "failed") {
      const status: ReqStatus = c.status === "failed" || rv?.status === "failed" ? "failed" : "pending_review";
      out.push({ key: `check:${c.key}`, label: c.label, why: c.rule, need: status === "failed" ? "mandatory" : "review", scope: status === "failed" ? "service" : "specialist", source: c.source, owner: status === "failed" ? "client" : "specialist", status, effect: effectOf("review", status), detail: c.reason });
    }
  }
  return out;
}

/** Whether the list blocks submission (mandatory open, conflicts, failures) and approval (also specialist items). */
export function requirementBlockers(list: Requirement[]) {
  const open = (r: Requirement) => r.status === "missing" || r.status === "conflict" || r.status === "failed";
  return {
    submit: list.filter((r) => (r.need === "mandatory" && open(r)) || r.status === "conflict" || r.status === "failed"),
    approve: list.filter((r) => (r.need === "mandatory" && open(r)) || r.status === "conflict" || r.status === "failed" || r.status === "pending_review"),
  };
}
