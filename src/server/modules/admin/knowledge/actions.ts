"use server";
import { z } from "zod";
import { UserError } from "@/server/modules/_shared";
import type { ActionState } from "@/lib/utils";
import { staffAction } from "../guard";
import { FIQH_DECISION_AR, recordComparisonReview, recordFiqhReview, recordSourceReview, ReviewRefused } from "@/server/knowledge/review";
import { research, saveDossier } from "@/server/knowledge/fiqh/research";
import { maskPII } from "@/server/modules/ai/safety";
import { audit } from "@/server/lib/audit";
import { currentSessionToken } from "@/server/auth/session";

/**
 * Recording a human review of the knowledge base (owner's order 2026-11-06, §4). The reviewer's own session; the
 * permission of the source's field is checked in knowledge/review.ts and again by the database, and the audit entry is
 * written in the same transaction (the database refuses a review without it).
 */
const sourceSchema = z.object({
  sourceId: z.string().uuid(),
  chunkId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  decision: z.enum(["accepted", "rejected"]),
  note: z.string().trim().min(10, "اكتب ما قابلته وبماذا (عشرة أحرف على الأقل).").max(2000),
});
const runSchema = z.object({ runId: z.string().uuid(), unit: z.string().regex(/^م\d{1,4}$/, "حدّد المادة."), decision: z.enum(["accepted", "rejected"]), note: z.string().trim().min(10).max(2000) });

const refused = (e: unknown) => {
  if (e instanceof ReviewRefused) throw new UserError(e.message);
  throw e;
};

export async function recordKnowledgeReview(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = sourceSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? "البيانات غير صحيحة." };
  return staffAction("admin.access", async ({ auth, tx, ip, userAgent }) => {
    // the review is bound to this request's authenticated session: the database checks the token (security.sql)
    const sessionToken = (await currentSessionToken()) ?? "";
    const r = await recordSourceReview(tx, { userId: auth.user.id, sessionToken, ip, userAgent }, p.data).catch(refused);
    return { ok: true, message: `سُجلت المراجعة (${p.data.decision === "accepted" ? "قبول" : "رفض"}) في مجال ${r!.role}، وقُيدت في سجل التدقيق.` };
  }, "/admin/knowledge");
}

export async function recordComparisonDecision(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = runSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? "البيانات غير صحيحة." };
  return staffAction("admin.access", async ({ auth, tx, ip, userAgent }) => {
    const sessionToken = (await currentSessionToken()) ?? "";
    await recordComparisonReview(tx, { userId: auth.user.id, sessionToken, ip, userAgent }, p.data).catch(refused);
    return { ok: true, message: `سُجلت مراجعة المادة ${p.data.unit.slice(1)} وحدها في هذه المطابقة، وقُيدت في سجل التدقيق.` };
  }, "/admin/knowledge");
}

// ───────────────────────── fiqh research dossiers (owner's order 2026-11-07, §3, §7) ─────────────────────────

const researchSchema = z.object({
  question: z.string().trim().min(10, "اكتب المسألة (عشرة أحرف على الأقل).").max(1500),
  facts: z.string().trim().max(4000).optional().default(""),
  stage: z.enum(["research", "summary", "extraction", "comparison", "preliminary", "draft"]).default("preliminary"),
});

/**
 * A team member asks the engine to research a matter: the dossier is prepared from the knowledge base only (no model,
 * nothing sent outside) and queued for the sharia reviewer. Facts are one per line; a line starting «مفترض:» is an
 * assumption, not an established fact. Personal data is masked before anything is stored.
 */
export async function startFiqhResearch(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = researchSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? "البيانات غير صحيحة." };
  return staffAction("admin.access", async ({ auth, tx, ip, userAgent }) => {
    const facts = p.data.facts.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => /^مفترض\s*:/.test(l) ? { text: maskPII(l.replace(/^مفترض\s*:\s*/, "")), status: "assumed" as const } : { text: maskPII(l), status: "established" as const });
    const d = await research(tx, { question: maskPII(p.data.question), facts, asOf: new Date().toISOString().slice(0, 10), stage: p.data.stage });
    const saved = await saveDossier(tx, d, { createdBy: auth.user.id });
    await audit(tx, { actorUserId: auth.user.id, action: "knowledge.fiqh.research", entityType: "fiqh_dossier", entityId: saved.id, ip, userAgent, after: { stage: d.stage, sources: d.sources.length, statements: d.statements.length, weighing: d.weighing?.status ?? null } });
    return { ok: true, message: `أُعدّ الملف البحثي (${d.sources.length} نصًا، ${d.statements.length} قولًا) وأُدرج في قائمة المراجعة الشرعية. رقمه ${saved.id.slice(0, 8)}.` };
  }, "/admin/knowledge/fiqh");
}

const fiqhDecisionSchema = z.object({
  dossierId: z.string().uuid(),
  decision: z.enum(["approved", "modified", "rejected", "more_research"]),
  note: z.string().trim().min(10, "اكتب أسباب قرارك (عشرة أحرف على الأقل).").max(4000),
  position: z.string().trim().max(1000).optional().default(""),
  reasons: z.string().trim().max(4000).optional().default(""),
  statementIds: z.string().trim().max(400).optional().default(""),
});

/** The sharia reviewer's decision on a dossier (approve, modify the weighing, reject, ask for more research). */
export async function recordFiqhDecision(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = fiqhDecisionSchema.safeParse(Object.fromEntries([...fd.entries()].filter(([k]) => k !== "passages")));
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? "البيانات غير صحيحة." };
  const passages = fd.getAll("passages").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const d = p.data;
  return staffAction("admin.access", async ({ auth, tx, ip, userAgent }) => {
    const sessionToken = (await currentSessionToken()) ?? "";
    const replacement = d.decision === "modified" ? { position: d.position, reasons: d.reasons, statementIds: d.statementIds.split(/[\s,،]+/).filter(Boolean) } : null;
    const r = await recordFiqhReview(tx, { userId: auth.user.id, sessionToken, ip, userAgent }, { dossierId: d.dossierId, decision: d.decision, note: d.note, replacement, passages }).catch(refused);
    return { ok: true, message: `سُجّل قرارك «${FIQH_DECISION_AR[d.decision]}» باسمك في جلستك وقُيّد في سجل التدقيق${r!.passages.length ? `، وروجع ${r!.passages.length} من النصوص المستخدمة` : ""}.` };
  }, ["/admin/knowledge/fiqh", `/admin/knowledge/fiqh/${d.dossierId}`]);
}
