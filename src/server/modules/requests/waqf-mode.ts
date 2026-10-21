/**
 * Which waqf a request concerns (PURE): a waqf registered in the platform, a waqf that exists but is not registered in
 * «وقفك», or no waqf yet (establishment or a preliminary step). Each service accepts only the choices its nature allows;
 * the rule is derived from the service's own definition (the waqf-file records it reads, its category) plus the real
 * constraint of services that run on the platform's waqf file.
 */
import { contextFor } from "./context/map";

export type WaqfMode = "registered" | "unregistered" | "none";

export const WAQF_MODE_AR: Record<WaqfMode, string> = {
  registered: "وقف مسجل في منصة «وقفك»",
  unregistered: "وقف قائم غير مسجل في منصة «وقفك»",
  none: "لا يوجد وقف قائم بعد",
};

/**
 * Services that can start before a waqf exists: designing and establishing a waqf (T), wills (W), the waqif's financial
 * analysis of his conditions (F01), the basic assessment (C01) and general sharia or legal questions (C07, C08).
 */
const NONE_OK = new Set(["T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08", "T09", "W01", "W02", "W03", "W04", "W05", "F01", "C01", "C07", "C08"]);

/**
 * Services executed on the waqf's file in the platform: taking over the nazara (N01 opens the nazara file of the waqf)
 * and the continuous services, whose cycles read and write the waqf's records (ledger, distributions, meetings,
 * beneficiaries, assets). They need the waqf registered first — a separate, explicit procedure.
 */
export const REGISTERED_ONLY = new Set(["N01", "N02", "N03", "N04", "N05", "N06", "N07", "F03", "F08", "I07", "I09", "C06"]);

export const REGISTERED_ONLY_REASON = "تُنفَّذ هذه الخدمة على ملف الوقف في المنصة (سجلاته ودوراته وتقاريره)، فتحتاج أن يكون الوقف مسجلًا فيها. سجّل الوقف أولًا بإجراء مستقل، ثم اطلب الخدمة له.";
export const NEEDS_WAQF_REASON = "تتعلق هذه الخدمة بوقف قائم، فلا تُطلب قبل وجوده.";

export type WaqfModes = { registered: boolean; unregistered: boolean; none: boolean; reasons: Partial<Record<WaqfMode, string>> };

export function waqfModesFor(code: string): WaqfModes {
  const none = NONE_OK.has(code);
  const readsWaqf = contextFor(code).length > 0;
  const unregistered = readsWaqf && !REGISTERED_ONLY.has(code);
  return {
    registered: true,
    unregistered,
    none,
    reasons: {
      ...(unregistered ? {} : readsWaqf ? { unregistered: REGISTERED_ONLY_REASON } : {}),
      ...(none ? {} : { none: NEEDS_WAQF_REASON }),
    },
  };
}

/** The mode of a stored request: registered when linked to a waqf; otherwise as recorded at its start («none» for older requests). */
export function waqfModeOf(req: { waqfId: string | null; intake: unknown }): WaqfMode {
  if (req.waqfId) return "registered";
  const m = (req.intake as { waqfMode?: string } | null)?.waqfMode;
  return m === "unregistered" ? "unregistered" : "none";
}
