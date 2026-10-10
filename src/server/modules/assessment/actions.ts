"use server";

import { and, eq, inArray } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withContext } from "../../db";
import {
  actionPlans, assessmentAnswers, assessmentResults, assessments, axisScores, criticalFlags, needs, recommendations, reportShares, reports, tasks, waqfs,
} from "../../db/schema";
import { getAuth, loadWaqfAccess, requireAuth } from "../../authz/context";
import { randomToken, sha256 } from "../../lib/crypto";
import { audit, nextNumber } from "../../lib/audit";
import { enforceRateLimit } from "../../lib/rate-limit";
import { requestInfo } from "../../lib/request-info";
import { scoreAnswer } from "../../engines/assessment";
import { todayISO } from "../../engines/dates";
import { parseForm, toState, UserError, userAction } from "../_shared";
import type { ActionState } from "@/lib/utils";
import { ANON_DB, anonCookieName, isUuid, resolveAssessment, setAnonCookie } from "./access";
import { computeAndPersist } from "./compute";
import { isAnswered, isISODate, MATURITY_OPTIONS, prefillFromWaqf, STATUS_VIEW, waveDueDate } from "./facts";
import { activeBankVersionId, assessmentNumber, loadBank, parseReview } from "./queries";

const resultPath = (id: string, signedIn: boolean) => (signedIn ? `/app/assessments/${id}` : `/assessment/${id}/result`);

// ───────────── start ─────────────

const startSchema = z.object({
  kind: z.enum(["basic", "deep"], { message: "اختر نوع التقييم." }),
  waqf: z.string().optional().default(""),
  waqfLabel: z.string().trim().max(120, "الاسم طويل؛ اختصره إلى 120 حرفًا.").optional().default(""),
});

export async function startAssessment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  try {
    const r = parseForm(startSchema, fd);
    if ("state" in r) return r.state;
    const { kind, waqf, waqfLabel } = r.data;
    const auth = await getAuth();
    const signedIn = !!auth && !(auth.user.mfaEnabled && !auth.session.mfaVerified);
    const { ip, userAgent } = await requestInfo();
    if (kind === "deep" && !signedIn) throw new UserError("التقييم المعمّق يتطلب تسجيل الدخول لأن مختصًا سيراجعه. سجّل الدخول ثم ابدأ من جديد.");
    if (!signedIn) await enforceRateLimit(`asmt-start:${ip}`, 20, 3600);
    const waqfId = waqf && waqf !== "new" ? waqf : null;
    if (waqfId && (!signedIn || !isUuid(waqfId))) throw new UserError("اختر وقفًا من أوقافك أو «وقف غير مسجل هنا».");

    const token = signedIn ? null : randomToken(32);
    const id = await withContext(signedIn ? auth!.db : ANON_DB, async (tx) => {
      let prefill: Record<string, unknown> = {};
      if (waqfId) {
        const access = await loadWaqfAccess(tx, auth!, waqfId);
        if (!access || !access.perms.has("assessment.run")) throw new UserError("ليست لديك صلاحية إجراء تقييم لهذا الوقف.");
        prefill = prefillFromWaqf(access.waqf);
      }
      const bankVersionId = await activeBankVersionId(tx);
      if (!bankVersionId) throw new UserError("بنك الأسئلة غير منشور بعد. تواصل مع الدعم.");
      const [row] = await tx
        .insert(assessments)
        .values({
          waqfId, userId: signedIn ? auth!.user.id : null, anonTokenHash: token ? sha256(token) : null, kind, bankVersionId,
          waqfLabel: waqfId ? null : waqfLabel || null, status: "draft", currentAxis: "P",
        })
        .returning({ id: assessments.id });
      if (Object.keys(prefill).length) {
        const { questions } = await loadBank(tx, bankVersionId);
        const byCode = new Map(questions.map((q) => [q.code, q]));
        const rows = Object.entries(prefill)
          .filter(([code]) => byCode.has(code))
          .map(([code, value]) => {
            const s = scoreAnswer(byCode.get(code)!, { value });
            return { assessmentId: row.id, questionCode: code, waqfId, value: value as never, score: s.score === null ? null : String(s.score), isUnknown: s.unknown, isNa: s.na };
          });
        if (rows.length) await tx.insert(assessmentAnswers).values(rows);
      }
      await audit(tx, {
        actorUserId: signedIn ? auth!.user.id : null, actorLabel: signedIn ? null : "زائر (تقييم مجهول)", action: "assessment.start", entityType: "assessment",
        entityId: row.id, waqfId, ip, userAgent, after: { kind, waqfLinked: !!waqfId, prefilled: Object.keys(prefill).length },
      });
      return row.id;
    });
    if (token) await setAnonCookie(id, token);
    target = `/assessment/${id}`;
  } catch (e) {
    return toState(e);
  }
  redirect(target);
}

// ───────────── answering (autosave) ─────────────

export type SaveResult = { ok: boolean; error?: string };

function validateValue(q: { answerType: string; options?: { value: string }[] | null }, value: unknown): unknown {
  if (value === null || value === undefined || value === "") return null;
  switch (q.answerType) {
    case "maturity":
      if (typeof value === "string" && MATURITY_OPTIONS.some((o) => o.value === value)) return value;
      break;
    case "date":
      if (value === "unknown" || isISODate(value)) return value;
      break;
    case "number":
      if (value === "unknown") return value;
      if (typeof value === "string" || typeof value === "number") {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 0) return n;
      }
      break;
    case "text":
      if (typeof value === "string") return value.slice(0, 2000);
      break;
    case "multiselect":
      if (Array.isArray(value) && value.every((v) => typeof v === "string" && q.options?.some((o) => o.value === v))) return [...new Set(value)];
      break;
    default:
      if (typeof value === "string" && q.options?.some((o) => o.value === value)) return value;
  }
  throw new UserError("قيمة الإجابة غير صالحة لهذا السؤال.");
}

/** Saves one answer (upsert). Called on every change from the runner; returns a small result instead of throwing. */
export async function saveAnswer(assessmentId: string, questionCode: string, value: unknown): Promise<SaveResult> {
  try {
    const v = await resolveAssessment(assessmentId);
    if (!v || !v.canEdit) throw new UserError("اكتمل هذا التقييم أو انتهت صلاحية رابطه، فلم تعد إجاباته قابلة للتعديل. ابدأ تقييمًا جديدًا إن احتجت.");
    await withContext(v.db, async (tx) => {
      const { questions } = await loadBank(tx, v.row.bankVersionId);
      const q = questions.find((x) => x.code === questionCode);
      if (!q) throw new UserError("السؤال غير موجود في هذا الإصدار.");
      const clean = validateValue(q, value);
      if (!isAnswered(clean)) {
        await tx.delete(assessmentAnswers).where(and(eq(assessmentAnswers.assessmentId, assessmentId), eq(assessmentAnswers.questionCode, questionCode)));
        return;
      }
      const s = scoreAnswer(q, { value: clean });
      const vals = { value: clean as never, score: s.score === null ? null : String(s.score), isUnknown: s.unknown, isNa: s.na, answeredAt: new Date() };
      await tx
        .insert(assessmentAnswers)
        .values({ assessmentId, questionCode, waqfId: v.row.waqfId, ...vals })
        .onConflictDoUpdate({ target: [assessmentAnswers.assessmentId, assessmentAnswers.questionCode], set: vals });
    });
    return { ok: true };
  } catch (e) {
    const st = toState(e);
    return { ok: false, error: st.error };
  }
}

/** Remembers the screen the user is on so "resume later" opens at the same axis. */
export async function saveStep(assessmentId: string, axis: string): Promise<SaveResult> {
  try {
    if (!/^(P|A\d{1,2}|review)$/.test(axis)) return { ok: false };
    const v = await resolveAssessment(assessmentId);
    if (!v || !v.canEdit) return { ok: false };
    await withContext(v.db, (tx) => tx.update(assessments).set({ currentAxis: axis }).where(eq(assessments.id, assessmentId)));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Computes the result and opens it. */
export async function submitAssessment(assessmentId: string): Promise<SaveResult> {
  let target = "";
  try {
    const v = await resolveAssessment(assessmentId);
    if (!v || !v.canEdit) throw new UserError("أُرسل هذا التقييم من قبل؛ افتح نتيجته لمتابعتها.");
    const { ip, userAgent } = await requestInfo();
    await withContext(v.db, (tx) => computeAndPersist(tx, assessmentId, { userId: v.auth?.user.id ?? null, ip, userAgent }));
    target = resultPath(assessmentId, !!v.auth);
  } catch (e) {
    const st = toState(e);
    return { ok: false, error: st.error };
  }
  redirect(target);
}

// ───────────── claim an anonymous assessment after signup/login ─────────────

export async function claimAssessment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  try {
    const id = String(fd.get("id") ?? "");
    const waqfId = String(fd.get("waqf") ?? "") || null;
    const auth = await requireAuth();
    const v = await resolveAssessment(id);
    if (!v || !v.canClaim) throw new UserError("يُحفظ التقييم في حسابك من المتصفح نفسه الذي أجريته فيه. افتحه من هناك ثم أعد المحاولة.");
    const { ip, userAgent } = await requestInfo();
    await withContext(auth.db, async (tx) => {
      if (waqfId) {
        if (!isUuid(waqfId)) throw new UserError("الوقف المختار غير صالح.");
        const access = await loadWaqfAccess(tx, auth, waqfId);
        if (!access || !access.perms.has("assessment.run")) throw new UserError("ليست لديك صلاحية ربط تقييم بهذا الوقف.");
      }
      await tx.update(assessments).set({ userId: auth.user.id, waqfId, anonTokenHash: null }).where(eq(assessments.id, id));
      if (waqfId) {
        for (const t of [assessmentAnswers, assessmentResults, axisScores, criticalFlags, recommendations] as const) {
          await tx.update(t).set({ waqfId }).where(eq(t.assessmentId, id));
        }
      }
      await audit(tx, { actorUserId: auth.user.id, action: "assessment.claim", entityType: "assessment", entityId: id, waqfId, ip, userAgent, after: { waqfId } });
      // Recompute with the waqf profile (licenses, Waqfak role, open requests) when it is now linked.
      if (waqfId && v.row.status !== "draft") await computeAndPersist(tx, id, { userId: auth.user.id, ip, userAgent });
    });
    (await cookies()).delete(anonCookieName(id));
    target = v.row.status === "draft" ? `/assessment/${id}` : `/app/assessments/${id}`;
  } catch (e) {
    return toState(e);
  }
  redirect(target);
}

// ───────────── action plan ─────────────

export async function createActionPlan(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const id = String(fd.get("id") ?? "");
    const v = await resolveAssessment(id);
    if (!v || !v.auth) throw new UserError("سجّل الدخول لإنشاء خطة عمل.");
    if (!v.canPlan || !v.row.waqfId) throw new UserError("خطة العمل متاحة للتقييم المرتبط بوقف، ولمن يملك صلاحية تعديل الوقف أو إجراء التقييم.");
    const auth = v.auth;
    const { ip, userAgent } = await requestInfo();
    const count = await withContext(auth.db, async (tx) => {
      const [existing] = await tx.select({ id: actionPlans.id }).from(actionPlans).where(eq(actionPlans.assessmentId, id)).limit(1);
      if (existing) throw new UserError("أنشأت خطة عمل لهذا التقييم من قبل. تجدها في «المهام».");
      const recs = await tx.select().from(recommendations).where(and(eq(recommendations.assessmentId, id), inArray(recommendations.status, ["open", "accepted"])));
      if (!recs.length) throw new UserError("لا توجد توصيات مفتوحة لتحويلها إلى مهام.");
      const needRows = await tx.select().from(needs).where(inArray(needs.code, [...new Set(recs.map((r) => r.needCode))]));
      const title = new Map(needRows.map((n) => [n.code, n.titleAr]));
      const pkg = String(fd.get("package") ?? "") || null;
      const summary = [1, 2, 3].map((w) => ({ wave: w, count: recs.filter((r) => r.wave === w).length }));
      const [plan] = await tx.insert(actionPlans).values({ assessmentId: id, waqfId: v.row.waqfId, summary, suggestedPackageCode: pkg }).returning({ id: actionPlans.id });
      const today = todayISO();
      recs.sort((a, b) => a.wave - b.wave || Number(b.priority) - Number(a.priority));
      await tx.insert(tasks).values(recs.map((r) => ({
        waqfId: v.row.waqfId, sourceType: "assessment", sourceId: r.id, title: title.get(r.needCode) ?? r.titleAr,
        description: [r.reasonAr, r.whyItMattersAr, r.reference ? `المرجع: ${r.reference}` : null, `من التقييم ${assessmentNumber(id)}`].filter(Boolean).join("\n"),
        dueOn: waveDueDate(r.wave, today), priority: r.severity === "critical" ? "urgent" : r.wave === 1 ? "high" : r.wave === 2 ? "normal" : "low",
        status: "todo" as const, assigneeUserId: auth.user.id, visibility: "shared", createdBy: auth.user.id,
      })));
      await audit(tx, { actorUserId: auth.user.id, action: "assessment.action_plan", entityType: "action_plan", entityId: plan.id, waqfId: v.row.waqfId, ip, userAgent, after: { assessmentId: id, tasks: recs.length, summary } });
      return recs.length;
    });
    revalidatePath(`/app/assessments/${id}`);
    return { ok: true, message: `أنشأنا خطة عمل من ${count} مهمة بمواعيد حسب الموجات. تابعها في «المهام».` };
  } catch (e) {
    return toState(e);
  }
}

// ───────────── sharing ─────────────

export async function createShare(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const id = String(fd.get("id") ?? "");
    const days = Number(fd.get("days") ?? 7);
    if (![7, 30].includes(days)) throw new UserError("اختر مدة 7 أيام أو 30 يومًا.");
    const v = await resolveAssessment(id);
    if (!v || !v.auth) throw new UserError("سجّل الدخول لمشاركة النتيجة.");
    if (!v.canShare) throw new UserError("ليست لديك صلاحية مشاركة هذا التقييم.");
    if (v.row.status === "draft") throw new UserError("أكمل التقييم أولًا ثم شاركه.");
    const auth = v.auth;
    const { ip, userAgent } = await requestInfo();
    const token = randomToken(24);
    const expiresAt = new Date(Date.now() + days * 86_400_000);
    await withContext(auth.db, async (tx) => {
      let [rep] = await tx.select({ id: reports.id }).from(reports).where(and(eq(reports.assessmentId, id), eq(reports.kind, "assessment"))).limit(1);
      if (!rep) {
        const [res] = await tx.select().from(assessmentResults).where(eq(assessmentResults.assessmentId, id)).limit(1);
        [rep] = await tx
          .insert(reports)
          .values({
            number: await nextNumber(tx, "RPT"), waqfId: v.row.waqfId, kind: "assessment", title: `تقرير التقييم الوقفي ${assessmentNumber(id)}`, assessmentId: id,
            verificationCode: randomToken(9), snapshot: res ? { overall: res.overallScore, status: res.status, computedAt: res.computedAt } : null, generatedBy: auth.user.id,
          })
          .returning({ id: reports.id });
      }
      const [share] = await tx.insert(reportShares).values({ reportId: rep.id, waqfId: v.row.waqfId, tokenHash: sha256(token), createdBy: auth.user.id, expiresAt }).returning({ id: reportShares.id });
      await audit(tx, { actorUserId: auth.user.id, action: "assessment.share", entityType: "report_share", entityId: share.id, waqfId: v.row.waqfId, ip, userAgent, after: { assessmentId: id, days } });
    });
    revalidatePath(`/app/assessments/${id}`);
    return { ok: true, message: "أنشأنا رابط مشاركة للقراءة فقط. انسخه الآن؛ فهو يظهر هذه المرة فقط.", data: { url: `/r/${token}`, expiresAt: expiresAt.toISOString() } };
  } catch (e) {
    return toState(e);
  }
}

export async function revokeShare(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const id = String(fd.get("id") ?? "");
    const shareId = String(fd.get("share") ?? "");
    if (!isUuid(shareId)) throw new UserError("الرابط غير موجود.");
    const v = await resolveAssessment(id);
    if (!v || !v.auth || !v.canShare) throw new UserError("ليست لديك صلاحية إلغاء هذا الرابط.");
    const auth = v.auth;
    const { ip, userAgent } = await requestInfo();
    await withContext(auth.db, async (tx) => {
      const [s] = await tx
        .select({ id: reportShares.id })
        .from(reportShares)
        .innerJoin(reports, eq(reports.id, reportShares.reportId))
        .where(and(eq(reportShares.id, shareId), eq(reports.assessmentId, id)))
        .limit(1);
      if (!s) throw new UserError("الرابط غير موجود.");
      await tx.update(reportShares).set({ revokedAt: new Date() }).where(eq(reportShares.id, shareId));
      await audit(tx, { actorUserId: auth.user.id, action: "assessment.share_revoke", entityType: "report_share", entityId: shareId, waqfId: v.row.waqfId, ip, userAgent });
    });
    revalidatePath(`/app/assessments/${id}`);
    return { ok: true, message: "ألغينا الرابط؛ لم يعد يفتح لأحد." };
  } catch (e) {
    return toState(e);
  }
}

// ───────────── staff review of deep assessments ─────────────

async function reviewTarget(id: string) {
  if (!isUuid(id)) throw new UserError("التقييم غير موجود.");
  const v = await resolveAssessment(id);
  if (!v || !v.isReviewer) throw new UserError("التقييم غير متاح للمراجعة. تحقق من إسناده أو صلاحية الوصول إلى الوقف.");
  return v;
}

const notesSchema = z.object({ id: z.string(), summary: z.string().trim().max(4000, "الملاحظة طويلة جدًا.").optional().default("") });

export async function saveReviewNotes(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return userAction(async ({ auth, tx, ip, userAgent }) => {
    const r = parseForm(notesSchema, fd);
    if ("state" in r) return r.state;
    const v = await reviewTarget(r.data.id);
    const axes: Record<string, string> = {};
    for (const [k, val] of fd.entries()) {
      const m = /^axis_(A\d{1,2})$/.exec(k);
      if (m && typeof val === "string" && val.trim()) axes[m[1]] = val.trim().slice(0, 2000);
    }
    const before = parseReview(v.row.reviewNotes);
    const next = { summary: r.data.summary || undefined, axes };
    await tx.update(assessments).set({ reviewNotes: JSON.stringify(next) }).where(eq(assessments.id, v.row.id));
    await audit(tx, { actorUserId: auth.user.id, action: "assessment.review_notes", entityType: "assessment", entityId: v.row.id, waqfId: v.row.waqfId, ip, userAgent, before, after: next });
    return { ok: true, message: "حفظنا ملاحظات المراجعة." };
  }, { perm: "staff.assessment_review", revalidate: [`/admin/assessments/${String(fd.get("id"))}`] });
}

const dismissSchema = z.object({ id: z.string(), rec: z.string().uuid("التوصية غير صالحة."), reason: z.string().trim().min(5, "اكتب سبب الاستبعاد (5 أحرف على الأقل).").max(500) });

export async function dismissRecommendation(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return userAction(async ({ auth, tx, ip, userAgent }) => {
    const r = parseForm(dismissSchema, fd);
    if ("state" in r) return r.state;
    const v = await reviewTarget(r.data.id);
    const [rec] = await tx.select().from(recommendations).where(and(eq(recommendations.id, r.data.rec), eq(recommendations.assessmentId, v.row.id))).limit(1);
    if (!rec) throw new UserError("التوصية غير موجودة.");
    await tx.update(recommendations).set({ status: "dismissed", dismissReason: r.data.reason }).where(eq(recommendations.id, rec.id));
    await audit(tx, { actorUserId: auth.user.id, action: "assessment.rec_dismiss", entityType: "recommendation", entityId: rec.id, waqfId: v.row.waqfId, ip, userAgent, before: { status: rec.status }, after: { status: "dismissed", reason: r.data.reason } });
    return { ok: true, message: "استبعدنا التوصية وسجّلنا السبب." };
  }, { perm: "staff.assessment_review", revalidate: [`/admin/assessments/${String(fd.get("id"))}`] });
}

export async function restoreRecommendation(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return userAction(async ({ auth, tx, ip, userAgent }) => {
    const id = String(fd.get("id") ?? "");
    const recId = String(fd.get("rec") ?? "");
    const v = await reviewTarget(id);
    if (!isUuid(recId)) throw new UserError("التوصية غير صالحة.");
    await tx.update(recommendations).set({ status: "open", dismissReason: null }).where(and(eq(recommendations.id, recId), eq(recommendations.assessmentId, v.row.id)));
    await audit(tx, { actorUserId: auth.user.id, action: "assessment.rec_restore", entityType: "recommendation", entityId: recId, waqfId: v.row.waqfId, ip, userAgent });
    return { ok: true, message: "أعدنا التوصية." };
  }, { perm: "staff.assessment_review", revalidate: [`/admin/assessments/${String(fd.get("id"))}`] });
}

const manualSchema = z.object({
  id: z.string(),
  title: z.string().trim().min(4, "اكتب عنوان التوصية.").max(200),
  reason: z.string().trim().min(5, "اكتب سبب التوصية.").max(1500),
  reference: z.string().trim().max(300).optional().default(""),
  wave: z.coerce.number().int().min(1).max(3),
  severity: z.enum(["critical", "high", "medium", "low"]),
  service: z.string().trim().max(10).optional().default(""),
});

export async function addManualRecommendation(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return userAction(async ({ auth, tx, ip, userAgent }) => {
    const r = parseForm(manualSchema, fd);
    if ("state" in r) return r.state;
    const v = await reviewTarget(r.data.id);
    const d = r.data;
    const [rec] = await tx
      .insert(recommendations)
      .values({
        assessmentId: v.row.id, waqfId: v.row.waqfId, ruleId: auth.user.id, ruleCode: "MANUAL", ruleVersion: 0, needCode: "NEED.MANUAL", severity: d.severity,
        priority: String({ critical: 30, high: 12, medium: 3, low: 1 }[d.severity]), wave: d.wave, titleAr: d.title, reasonAr: d.reason,
        reference: d.reference || null, serviceCodes: d.service ? [d.service.toUpperCase()] : [], status: "open",
      })
      .returning({ id: recommendations.id });
    await audit(tx, { actorUserId: auth.user.id, action: "assessment.rec_add", entityType: "recommendation", entityId: rec.id, waqfId: v.row.waqfId, ip, userAgent, after: d });
    return { ok: true, message: "أضفنا التوصية اليدوية." };
  }, { perm: "staff.assessment_review", revalidate: [`/admin/assessments/${String(fd.get("id"))}`] });
}

export async function markReviewed(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return userAction(async ({ auth, tx, ip, userAgent }) => {
    const v = await reviewTarget(String(fd.get("id") ?? ""));
    if (v.row.status === "draft") throw new UserError("لم يكتمل التقييم بعد.");
    const now = new Date();
    await tx.update(assessments).set({ status: "published", reviewedBy: auth.user.id, reviewedAt: now }).where(eq(assessments.id, v.row.id));
    await audit(tx, { actorUserId: auth.user.id, action: "assessment.reviewed", entityType: "assessment", entityId: v.row.id, waqfId: v.row.waqfId, ip, userAgent, before: { status: v.row.status }, after: { status: "published", reviewedAt: now } });
    if (v.row.userId) {
      const { notify } = await import("../notify");
      const [res] = await tx.select({ overall: assessmentResults.overallScore, status: assessmentResults.status }).from(assessmentResults).where(eq(assessmentResults.assessmentId, v.row.id)).limit(1);
      const [w] = v.row.waqfId ? await tx.select({ name: waqfs.name }).from(waqfs).where(eq(waqfs.id, v.row.waqfId)).limit(1) : [];
      await notify(v.row.userId, "assessment.ready", {
        waqf: `${w?.name ?? v.row.waqfLabel ?? "تقييمك المعمّق"} (روجع من مختص)`,
        score: res ? Math.round(Number(res.overall)) : "—",
        status: res ? STATUS_VIEW[res.status]?.label ?? res.status : "—",
      }, { waqfId: v.row.waqfId, link: `/app/assessments/${v.row.id}`, tx });
    }
    return { ok: true, message: "اعتمدنا المراجعة؛ تظهر النتيجة الآن للعميل بعلامة «روجع من مختص»." };
  }, { perm: "staff.assessment_review", revalidate: ["/admin/assessments", `/admin/assessments/${String(fd.get("id"))}`] });
}

const EVIDENCE = ["declared", "document", "verified"] as const;

/**
 * Reviewer adjustment: records the evidence level of each answer (declared / backed by a document / verified
 * by the reviewer) and recomputes. Evidence raises the result's confidence; answers themselves stay as the
 * client gave them. Dismissals and manual recommendations survive the recompute.
 */
export async function saveEvidence(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return userAction(async ({ auth, tx, ip, userAgent }) => {
    const v = await reviewTarget(String(fd.get("id") ?? ""));
    const current = await tx.select({ code: assessmentAnswers.questionCode, ev: assessmentAnswers.evidenceLevel }).from(assessmentAnswers).where(eq(assessmentAnswers.assessmentId, v.row.id));
    const was = new Map(current.map((c) => [c.code, c.ev]));
    const changes: Record<string, { from: string; to: string }> = {};
    for (const [k, val] of fd.entries()) {
      const m = /^ev_(.+)$/.exec(k);
      if (!m || typeof val !== "string" || !(EVIDENCE as readonly string[]).includes(val)) continue;
      const prev = was.get(m[1]);
      if (!prev || prev === val) continue;
      changes[m[1]] = { from: prev, to: val };
      await tx
        .update(assessmentAnswers)
        .set({ evidenceLevel: val as (typeof EVIDENCE)[number], verifiedBy: val === "declared" ? null : auth.user.id })
        .where(and(eq(assessmentAnswers.assessmentId, v.row.id), eq(assessmentAnswers.questionCode, m[1])));
    }
    if (!Object.keys(changes).length) return { ok: true, message: "لم تتغير درجة الإثبات لأي إجابة." };
    await audit(tx, { actorUserId: auth.user.id, action: "assessment.evidence", entityType: "assessment", entityId: v.row.id, waqfId: v.row.waqfId, ip, userAgent, after: changes });
    const r = await computeAndPersist(tx, v.row.id, { userId: auth.user.id, ip, userAgent });
    return { ok: true, message: `حدّثنا الإثبات لـ${Object.keys(changes).length} إجابة وأعدنا الحساب: الدرجة ${Math.round(r.overallScore)}.` };
  }, { perm: "staff.assessment_review", revalidate: [`/admin/assessments/${String(fd.get("id"))}`] });
}

/** Recomputes with the current bank, rules, licenses and waqf profile (e.g. after a license or profile change). */
export async function recomputeAssessment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return userAction(async ({ auth, tx, ip, userAgent }) => {
    const v = await reviewTarget(String(fd.get("id") ?? ""));
    const r = await computeAndPersist(tx, v.row.id, { userId: auth.user.id, ip, userAgent });
    return { ok: true, message: `أعدنا الحساب: الدرجة ${Math.round(r.overallScore)}، ${r.flags} علامة، ${r.recommendations} توصية.` };
  }, { perm: "staff.assessment_review", revalidate: [`/admin/assessments/${String(fd.get("id"))}`] });
}
