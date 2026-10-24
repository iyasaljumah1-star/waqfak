/**
 * Waqf file: which changes go to review, and when a waqf counts as complete (PURE).
 */

/** The section of the file an audited change belongs to, or null when the change is not of the file's substance. */
export function reviewSection(action: string): string | null {
  if (/^deed\.(condition_(added|updated)|exception_(added|removed)|allocation_saved|version_added|created|updated)$/.test(action)) return "الوثيقة والشروط";
  if (/^beneficiaries\.(class_(added|updated|deleted)|added|updated)$/.test(action)) return "المصارف والمستحقون";
  if (/^waqf\.(trustee_(appointed|updated|ended)|succession_(added|removed)|body_(added|member_added|member_updated|member_ended)|founder_(added|updated))$/.test(action)) return "الأطراف والنظارة";
  if (/^assets\.(added|updated|archived|substituted|property_saved)$/.test(action)) return "الأصول الموقوفة";
  if (/^waqf\.(identity_updated|classified|profile_updated|registration_(created|updated))$/.test(action)) return "الهوية والتسجيل";
  return null;
}

export type ReviewTrigger = "documented" | "approved_output";

export function reviewReason(t: ReviewTrigger, outputs: string[] = []): string {
  return t === "approved_output"
    ? `بيانات هذا الوقف استُخدمت في مخرج معتمد: ${outputs.join("، ")}. لم يتغير المخرج المعتمد؛ يراجع الفريق أثر التعديل ويقرر هل يلزم إصدار جديد.`
    : "الوقف موثق، وتعديل بياناته الجوهرية يراجعه الفريق قبل الاعتماد عليه.";
}

/**
 * When a waqf file counts as complete (shown in «الأوقاف»), from its records — never from its creation alone or from a
 * service requested for it:
 *  - documented: status documented / registered / active / suspended, AND its deed is in the vault (no status without
 *    evidence: a waqf registered by hand without its deed is not counted);
 *  - its substance recorded: at least one asset, one beneficiary class (masraf), and a nazara (an active nazir or an
 *    active board member).
 * Anything else — establishment drafts, will plans, files opened from a request, files missing any of the above — is a
 * file being completed, listed apart with what it lacks.
 */
export type CompletenessFacts = {
  status: string; archived: boolean; deedInVault: boolean; assets: number; classes: number; trustees: number; boardMembers: number;
};
export const COMPLETE_STATUSES = ["documented", "registered", "active", "suspended"] as const;

export function completeness(f: CompletenessFacts): { complete: boolean; missing: string[] } {
  const missing: string[] = [];
  if (f.archived || f.status === "ended") return { complete: false, missing: ["الملف مؤرشف أو الوقف منتهٍ"] };
  if (!(COMPLETE_STATUSES as readonly string[]).includes(f.status)) missing.push("لم يُوثَّق الوقف بعد");
  else if (!f.deedInVault) missing.push("صك الوقف غير مرفوع في الوثائق");
  if (!f.assets) missing.push("لا أصول موقوفة مسجلة");
  if (!f.classes) missing.push("لا مصارف أو مستحقين مسجلين");
  if (!f.trustees && !f.boardMembers) missing.push("لا ناظر أو مجلس نظارة مسجل");
  return { complete: missing.length === 0, missing };
}
