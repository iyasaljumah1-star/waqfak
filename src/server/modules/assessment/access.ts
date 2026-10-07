import "server-only";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { withContext, type DbContext, type Tx } from "../../db";
import { assessments } from "../../db/schema";
import { getAuth, loadWaqfAccess, type Auth, type WaqfAccess } from "../../authz/context";
import { safeEqual, sha256 } from "../../lib/crypto";
import { cookieSecure } from "../../env";

/** Anonymous visitors carry a per-assessment token in an httpOnly cookie; only its SHA-256 is stored. */
export const anonCookieName = (id: string) => `wqf_asmt_${id}`;
export const ANON_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
/** Anonymous context: RLS only exposes rows whose waqf_id is null (not linked to any waqf). */
export const ANON_DB: DbContext = { userId: null, globalAccess: false };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID_RE.test(s);

export type AssessmentRow = typeof assessments.$inferSelect;

export type Viewer = {
  auth: Auth | null;
  db: DbContext;
  row: AssessmentRow;
  waqfAccess: WaqfAccess | null;
  isOwner: boolean;
  viaAnon: boolean;
  isReviewer: boolean;
  canView: boolean;
  /** Answers can still change (draft) and the viewer may change them. */
  canEdit: boolean;
  canShare: boolean;
  /** Can turn recommendations into an action plan (linked waqf + waqf.edit or assessment.run). */
  canPlan: boolean;
  /** Signed-in user holding the anonymous cookie of an unclaimed assessment. */
  canClaim: boolean;
};

export async function setAnonCookie(id: string, token: string) {
  const jar = await cookies();
  jar.set(anonCookieName(id), token, { httpOnly: true, sameSite: "lax", secure: cookieSecure, path: "/", maxAge: ANON_COOKIE_MAX_AGE });
}

async function verifiedAuth(): Promise<Auth | null> {
  const a = await getAuth();
  if (!a) return null;
  if (a.user.mfaEnabled && !a.session.mfaVerified) return null;
  return a;
}

/**
 * Resolves who may do what with one assessment. Returns null when the assessment does not exist
 * or the caller has no right to see it (callers answer 404 — never reveal existence).
 */
export async function resolveAssessment(id: string, tx?: Tx): Promise<Viewer | null> {
  if (!isUuid(id)) return null;
  const auth = await verifiedAuth();
  const db = auth?.db ?? ANON_DB;
  const jar = await cookies();
  const token = jar.get(anonCookieName(id))?.value ?? null;

  const load = async (t: Tx) => {
    const [row] = await t.select().from(assessments).where(eq(assessments.id, id)).limit(1);
    if (!row) return null;
    const waqfAccess = row.waqfId && auth ? await loadWaqfAccess(t, auth, row.waqfId) : null;
    return { row, waqfAccess };
  };
  const found = tx ? await load(tx) : await withContext(db, load);
  if (!found) return null;
  const { row, waqfAccess } = found;

  const isOwner = !!auth && row.userId === auth.user.id;
  const viaAnon = !!token && !!row.anonTokenHash && safeEqual(sha256(token), row.anonTokenHash);
  const isReviewer = !!auth && auth.isStaff && auth.perms.has("staff.assessment_review") && row.kind === "deep" && row.status !== "draft";
  const waqfView = !!waqfAccess && !waqfAccess.isBeneficiaryOnly && waqfAccess.perms.has("assessment.view");
  const waqfRun = !!waqfAccess && waqfAccess.perms.has("assessment.run");
  const canView = isOwner || viaAnon || waqfView || isReviewer;
  if (!canView) return null;
  return {
    auth,
    db,
    row,
    waqfAccess,
    isOwner,
    viaAnon,
    isReviewer,
    canView,
    canEdit: row.status === "draft" && (isOwner || viaAnon || waqfRun),
    canShare: !!auth && (isOwner || waqfRun),
    canPlan: !!row.waqfId && !!waqfAccess && (waqfAccess.perms.has("waqf.edit") || waqfRun),
    canClaim: !!auth && viaAnon && !row.userId,
  };
}
