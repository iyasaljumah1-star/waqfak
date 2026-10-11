/**
 * Corporate nazara: statuses, transitions, intake checklist and handover list (pure, client-safe).
 *
 * Every item below cites the project reference it rests on. Items marked `derived: true` are operational support
 * derived from a broader provision (not a form the references prescribe); they are kept separate in the docs.
 */
import type { NazaraChecklistItem, NazaraHandoverItem } from "@/server/db/schema/nazara";

export const ENGAGEMENT_STATUSES = [
  "intake", "under_review", "pending_completion", "accepted", "rejected", "active", "suspended", "ending", "ended",
] as const;
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];

export const STATUS_AR: Record<EngagementStatus, string> = {
  intake: "استلام الطلب",
  under_review: "قيد الدراسة",
  pending_completion: "بانتظار استكمال المستندات",
  accepted: "مقبولة، بانتظار المباشرة",
  rejected: "مرفوضة",
  active: "نظارة قائمة",
  suspended: "موقوفة",
  ending: "قيد الإنهاء والتسليم",
  ended: "منتهية",
};

export const STATUS_TONE: Record<EngagementStatus, "neutral" | "info" | "warn" | "ok" | "critical" | "ink" | "fine"> = {
  intake: "info",
  under_review: "info",
  pending_completion: "warn",
  accepted: "ink",
  rejected: "neutral",
  active: "ok",
  suspended: "critical",
  ending: "fine",
  ended: "neutral",
};

/** Allowed transitions and the permission each needs (manage = run the file; approve = decide). */
export const TRANSITIONS: Record<string, { from: EngagementStatus[]; to: EngagementStatus; perm: "nazara.manage" | "nazara.approve"; label: string }> = {
  start_review: { from: ["intake", "pending_completion"], to: "under_review", perm: "nazara.manage", label: "بدء الدراسة" },
  request_completion: { from: ["under_review"], to: "pending_completion", perm: "nazara.manage", label: "طلب استكمال المستندات" },
  accept: { from: ["under_review"], to: "accepted", perm: "nazara.approve", label: "اعتماد قبول النظارة" },
  reject: { from: ["intake", "under_review", "pending_completion"], to: "rejected", perm: "nazara.approve", label: "رفض الطلب" },
  activate: { from: ["accepted"], to: "active", perm: "nazara.approve", label: "مباشرة النظارة" },
  suspend: { from: ["active"], to: "suspended", perm: "nazara.approve", label: "إيقاف النظارة مؤقتًا" },
  resume: { from: ["suspended"], to: "active", perm: "nazara.approve", label: "استئناف النظارة" },
  start_ending: { from: ["active", "suspended"], to: "ending", perm: "nazara.approve", label: "بدء إنهاء النظارة والتسليم" },
  end: { from: ["ending"], to: "ended", perm: "nazara.approve", label: "إقفال النظارة" },
};

export function canTransition(status: string, action: keyof typeof TRANSITIONS) {
  return (TRANSITIONS[action].from as string[]).includes(status);
}

export const OPEN_STATUSES: EngagementStatus[] = ["intake", "under_review", "pending_completion", "accepted", "active", "suspended", "ending"];
/** Statuses in which the team runs the waqf as its nazir (operational access as nazir/executive). */
export const RUNNING_STATUSES: EngagementStatus[] = ["active", "suspended", "ending"];

/** Ending cases (لائحة تنظيم أعمال النظارة م7، وم24/2 للعزل). */
export const END_REASONS = [
  ["resignation", "استقالة مقبولة من الجهة المختصة (م7/1)"],
  ["dismissal", "قرار أو حكم نهائي بالعزل (م7/2، م24/2)"],
  ["lost_condition", "فقد شرط من شروط التعيين (م7/3، م5)"],
  ["deed_term", "انتهاء النظارة وفق وثيقة الوقف أو لوائحه الداخلية (م7/5)"],
  ["other", "سبب آخر موثّق لدى الجهة المختصة"],
] as const;
export const END_REASON_AR: Record<string, string> = Object.fromEntries(END_REASONS);

export const AUTHORITY_AR: Record<string, string> = {
  competent_authority: "الجهة المختصة",
  gaa: "الهيئة العامة للأوقاف",
  court: "المحكمة",
  notary: "كتابة العدل",
  internal: "قرار داخلي",
  cma: "هيئة السوق المالية",
  fiu: "الإدارة العامة للتحريات المالية",
};

/**
 * Intake checklist: what the team gathers before accepting the nazara of a waqf. Editable per engagement
 * (items may be marked not applicable with a note). Admins can extend the default via the setting
 * `nazara.intake_checklist` (same shape).
 */
export const DEFAULT_CHECKLIST: Omit<NazaraChecklistItem, "status">[] = [
  { key: "deed", label: "وثيقة الوقف الصادرة من الجهة المختصة متضمنة شرط الواقف", required: true, source: "لائحة تنظيم أعمال النظارة م1 (تعريف وثيقة الوقف)، م9/1–3" },
  { key: "appointment_consent", label: "موافقة «وقفك» المكتوبة على تولي النظارة قبل تعيينها", required: true, source: "لائحة تنظيم أعمال النظارة م4/4" },
  { key: "appointment_terms", label: "مسودة قرار التسمية: صلاحيات الناظر وأتعابه ومسؤولياته", required: true, source: "لائحة تنظيم أعمال النظارة م4/6، م11/1" },
  { key: "registration", label: "شهادة تسجيل الوقف لدى الهيئة، أو ما يثبت أنه لم يُسجَّل بعد", required: true, source: "لائحة تنظيم أعمال النظارة م8/1–2" },
  { key: "asset_titles", label: "صكوك الأصول الموقوفة ووثائق ملكيتها أو حيازتها", required: true, source: "الدليل المختصر لمهمات الناظر، حماية أصول الوقف (حماية الصكوك والوثائق)" },
  { key: "contracts", label: "العقود القائمة على أصول الوقف (الإيجار والتشغيل والصيانة وغيرها)", required: true, source: "الدليل المختصر لمهمات الناظر، حماية أصول الوقف (متابعة العقود)" },
  { key: "bank_accounts", label: "بيان الحسابات البنكية باسم الوقف", required: true, source: "لائحة تنظيم أعمال النظارة م15/1" },
  { key: "financials", label: "آخر قوائم مالية مدققة أو بيان مالي سنوي، وسجل الإيرادات والمصروفات", required: true, source: "لائحة تنظيم أعمال النظارة م15/2، م15/4–5" },
  { key: "beneficiaries", label: "سجل المستفيدين وبيانات المستفيدين الحقيقيين", required: true, source: "لائحة تنظيم أعمال النظارة م10/8؛ معايير المستفيد الحقيقي" },
  { key: "bylaws", label: "اللوائح والسياسات الداخلية القائمة (للأوقاف الكبيرة والمتوسطة)", required: false, source: "لائحة تنظيم أعمال النظارة م9/4، م14/1" },
  { key: "previous_nazir", label: "ما يثبت انتهاء نظارة الناظر السابق وتسليمه ما يتعلق بالوقف (عند الحلول محل ناظر)", required: false, source: "لائحة تنظيم أعمال النظارة م7، م27/3" },
  { key: "litigation", label: "بيان الدعاوى والمطالبات والالتزامات القائمة على الوقف", required: false, source: "الدليل المختصر لمهمات الناظر، متطلبات تنظيمية مساندة (سجل للقرارات والعقود والدعاوى)" },
  { key: "approvals", label: "الأذونات السابقة من الجهة المختصة (استبدال، رهن، مخالفة شرط) إن وجدت", required: false, source: "لائحة تنظيم أعمال النظارة م9/3، م9/5، م12/3، م19" },
];

export function freshChecklist(extra: Omit<NazaraChecklistItem, "status">[] = []): NazaraChecklistItem[] {
  const seen = new Set<string>();
  return [...DEFAULT_CHECKLIST, ...extra]
    .filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)))
    .map((i) => ({ ...i, status: "missing" as const, documentId: null, note: null }));
}

export function checklistProgress(items: NazaraChecklistItem[]) {
  const required = items.filter((i) => i.required);
  const done = (i: NazaraChecklistItem) => i.status === "received" || i.status === "not_applicable";
  return {
    total: items.length,
    done: items.filter(done).length,
    requiredTotal: required.length,
    requiredOpen: required.filter((i) => !done(i)),
  };
}

export const CHECK_STATUS_AR: Record<NazaraChecklistItem["status"], string> = { missing: "لم يُستلم", received: "استُلم", not_applicable: "لا ينطبق" };

/**
 * Handover list on ending (لائحة تنظيم أعمال النظارة م27/3: الإفصاح عن كافة أصول الوقف ومستنداته وبياناته وتسليم
 * جميع ما يتعلق بالوقف للناظر البديل، وتحديث شهادة التسجيل). `detail` is filled from the waqf records.
 */
export const HANDOVER_KEYS = [
  ["assets", "الأصول الموقوفة وصكوكها"],
  ["contracts", "العقود والإيجارات القائمة"],
  ["bank", "الحسابات البنكية وإلغاء تفويض تشغيلها"],
  ["finance", "السجلات المالية والقوائم والموازنات"],
  ["beneficiaries", "سجل المستفيدين وبيانات المستفيدين الحقيقيين ومستنداتها الأصلية (تُسلَّم فورًا — معايير المستفيد الحقيقي م7/4)"],
  ["documents", "وثائق الوقف ومراسلاته"],
  ["decisions", "القرارات والمحاضر والأذونات"],
  ["obligations", "الالتزامات والمواعيد القائمة"],
  ["registration", "إشعار الهيئة وتحديث شهادة تسجيل الوقف باسم الناظر البديل"],
] as const;

export function freshHandover(details: Partial<Record<(typeof HANDOVER_KEYS)[number][0], string>>): NazaraHandoverItem[] {
  return HANDOVER_KEYS.map(([key, label]) => ({ key, label, detail: details[key] ?? "—", status: "pending" as const, note: null }));
}

/**
 * Follow-up tasks opened when Waqfak starts the nazara of a waqf. Each rests on a duty triggered by the change of
 * nazir; `businessDays`/`days` give the deadline stated in the source (null when the source states none).
 */
export const ACTIVATION_TASKS: { key: string; title: string; source: string; businessDays?: number; days?: number }[] = [
  {
    key: "gaa_update",
    title: "تحديث بيانات الوقف لدى الهيئة بتغيّر النظارة (عبر بوابة الهيئة)",
    source: "لائحة تنظيم أعمال النظارة م8/2(ب): خلال 15 يوم عمل من التغير الجوهري على النظارة",
    businessDays: 15,
  },
  {
    key: "bo_update",
    title: "تحديث سجل المستفيد الحقيقي بملاك «وقفك» ومديريها وأعضاء مجلس إدارتها بصفتها الناظر الاعتباري",
    source: "معايير المستفيد الحقيقي م4/2 وم5/2؛ والتحديث خلال 15 يومًا من التغيير (م6/1)",
    days: 15,
  },
  {
    key: "bank_mandate",
    title: "التحقق من الحساب البنكي باسم الوقف وتحديث المفوَّضين بتشغيله",
    source: "لائحة تنظيم أعمال النظارة م15/1 (حساب باسم الوقف)؛ والمهلة هنا تشغيلية لم تحددها المصادر",
    days: 30,
  },
];
