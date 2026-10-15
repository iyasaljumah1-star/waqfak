/**
 * Drafting checks (PURE). A check never shows success because an answer exists: each result says what was proven,
 * from which data, under which rule, and whether the result is automatic or needs a professional.
 *
 *  verified         — proven by the platform from data it can rely on, with a stated rule (e.g. arithmetic).
 *  specialist       — needs a sharia/legal judgment or a supporting document reviewed by a specialist.
 *  client_attested  — rests on the client's own answer alone (not verified by the platform).
 *  incomplete       — the data needed for the check is missing.
 *  na               — the check does not apply to this case (and why).
 *  failed           — a contradiction or a result against the rule.
 */

export type CheckStatus = "verified" | "specialist" | "client_attested" | "incomplete" | "na" | "failed";

export type CheckResult = {
  key: string;
  label: string;
  status: CheckStatus;
  /** Why this result (what was found). */
  reason: string;
  /** Which data the result rests on (fields, tables, documents). */
  source: string;
  /** The rule applied (stated in words, with its reference when it has one). */
  rule: string;
  /** Citation key (see citations.ts) behind the rule, when there is one. */
  ref?: string;
  /** automatic (computed by the platform) or professional (needs/has a specialist's finding). */
  mode: "auto" | "professional";
};

export const CHECK_STATUS_AR: Record<CheckStatus, string> = {
  verified: "متحقق آليًا",
  specialist: "بحاجة إلى تحقق من مختص",
  client_attested: "إقرار من العميل",
  incomplete: "غير مكتمل",
  na: "غير منطبق",
  failed: "فشل التحقق",
};

export const CHECK_STATUS_TONE: Record<CheckStatus, "ok" | "seal" | "info" | "fine" | "neutral" | "critical"> = {
  verified: "ok", specialist: "seal", client_attested: "info", incomplete: "fine", na: "neutral", failed: "critical",
};

/** A specialist's finding on a check that needs one (latest wins). */
export type CheckReview = { key: string; status: "verified" | "failed" | "na"; note: string; by: string; at: string; version: number };

export const REVIEW_STATUS_AR: Record<CheckReview["status"], string> = { verified: "تحقق منه المختص", failed: "رأى المختص عدم استيفائه", na: "رأى المختص عدم انطباقه" };

/** The effective state of a check once a specialist's finding exists (the automatic result is kept alongside). */
export function effectiveCheck(c: CheckResult, review: CheckReview | undefined) {
  if (!review || (c.status !== "specialist" && c.status !== "client_attested")) return { ...c, finding: null as CheckReview | null, effective: c.status };
  const effective: CheckStatus = review.status === "verified" ? "verified" : review.status === "na" ? "na" : "failed";
  return { ...c, finding: review, effective };
}

/**
 * What a set of checks blocks. Failed checks block sending for review and approval. Checks needing a specialist block
 * approval until the reviewer records a finding (sending for review stays possible: the review is where it happens).
 */
export function checkBlockers(checks: CheckResult[], reviews: CheckReview[] = []) {
  const byKey = new Map(reviews.map((r) => [r.key, r]));
  const eff = checks.map((c) => effectiveCheck(c, byKey.get(c.key)));
  return {
    failed: eff.filter((c) => c.effective === "failed"),
    pendingSpecialist: eff.filter((c) => c.effective === "specialist"),
    all: eff,
  };
}
