"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withSystem } from "@/server/db";
import { screeningResults, suspicionReports, users, waqfs } from "@/server/db/schema";
import { normalizeSaudiMobile } from "@/server/auth/otp";
import { encryptString, decryptNullable } from "@/server/lib/crypto";
import { audit } from "@/server/lib/audit";
import { parseForm, UserError } from "@/server/modules/_shared";
import type { ActionState } from "@/lib/utils";
import { INDICATORS, mlroAction, readPayload, withMlro, writePayload, type SuspicionPayload } from "./shared";

const PATH = "/admin/mlro";

/**
 * The MLRO identifies a waqf by its exact internal number. MLRO holds no global waqf access, so this one lookup runs in
 * system context and returns only the id, number and name (kept inside the encrypted report).
 */
async function resolveWaqf(number: string) {
  const [w] = await withSystem((tx) => tx.select({ id: waqfs.id, number: waqfs.internalNumber, name: waqfs.name }).from(waqfs).where(eq(waqfs.internalNumber, number.trim().toUpperCase())).limit(1));
  return w ?? null;
}

const createSchema = z.object({
  waqfNumber: z.string().trim().min(3, "أدخل الرقم الداخلي للوقف."),
  summary: z.string().trim().min(30, "صِف الاشتباه ووقائعه في 30 حرفًا على الأقل.").max(5000),
});

export async function createSuspicionReport(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(createSchema, fd);
  if ("state" in r) return r.state;
  const indicators = fd.getAll("indicators").map(String).filter((k) => k in INDICATORS);
  let id = "";
  const res = await mlroAction(async ({ auth, ip, userAgent }) => {
    const w = await resolveWaqf(r.data.waqfNumber);
    if (!w) return { error: "راجع الحقول المظللة.", fieldErrors: { waqfNumber: "لا يوجد وقف بهذا الرقم." } };
    const now = new Date().toISOString();
    const payload: SuspicionPayload = {
      v: 2, summary: r.data.summary, waqfNumber: w.number, waqfName: w.name, indicators,
      timeline: [{ at: now, by: auth.user.id, byName: auth.user.fullName ?? "", text: "فُتح البلاغ للمراجعة الداخلية.", status: "internal_review" }],
    };
    id = await withMlro(
      auth,
      async (tx) => (await tx.insert(suspicionReports).values({ waqfId: w.id, createdBy: auth.user.id, summaryEnc: writePayload(payload) }).returning({ id: suspicionReports.id }))[0].id,
      (tx, newId) => audit(tx, { actorUserId: auth.user.id, action: "mlro.report_created", entityType: "suspicion_report", entityId: newId, ip, userAgent, after: { status: "internal_review", indicators } }),
    );
  });
  if (res.error) return res;
  redirect(`${PATH}/${id}?created=1`);
}

const updateSchema = z.object({
  id: z.string().uuid(),
  op: z.enum(["note", "report_fiu", "close", "reopen"]),
  text: z.string().trim().max(3000).optional(),
  fiuDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
  fiuReference: z.string().trim().max(120).optional(),
});

const NEXT: Record<string, string[]> = {
  note: ["internal_review", "reported", "closed_no_action"],
  report_fiu: ["internal_review"],
  close: ["internal_review"],
  reopen: ["closed_no_action"],
};

export async function updateSuspicionReport(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(updateSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  const text = d.text ?? "";
  if (d.op === "report_fiu") {
    const fe: Record<string, string> = {};
    if (!d.fiuDate) fe.fiuDate = "أدخل تاريخ الإبلاغ.";
    else if (d.fiuDate > new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date())) fe.fiuDate = "تاريخ الإبلاغ لا يكون في المستقبل.";
    if (!d.fiuReference) fe.fiuReference = "أدخل الرقم المرجعي للبلاغ.";
    if (Object.keys(fe).length) return { error: "راجع الحقول المظللة.", fieldErrors: fe };
  } else if (text.length < 10) {
    return { error: "راجع الحقول المظللة.", fieldErrors: { text: d.op === "close" ? "اذكر مسوغ الإغلاق دون إبلاغ." : d.op === "reopen" ? "اذكر سبب إعادة الفتح." : "اكتب الملاحظة." } };
  }
  const res = await mlroAction(async ({ auth, ip, userAgent }) => {
    await withMlro(
      auth,
      async (tx) => {
        const [row] = await tx.select().from(suspicionReports).where(eq(suspicionReports.id, d.id)).limit(1).for("update");
        if (!row) throw new UserError("البلاغ غير موجود.");
        if (!NEXT[d.op].includes(row.status)) throw new UserError("هذا الإجراء لا يناسب حالة البلاغ الحالية.");
        const p = readPayload(row.summaryEnc);
        const status = d.op === "report_fiu" ? "reported" : d.op === "close" ? "closed_no_action" : d.op === "reopen" ? "internal_review" : row.status;
        const entryText =
          d.op === "report_fiu" ? `أُبلغت الإدارة العامة للتحريات المالية بتاريخ ${d.fiuDate}.${text ? ` ${text}` : ""}` : d.op === "close" ? `أُغلق دون إبلاغ: ${text}` : d.op === "reopen" ? `أُعيد فتحه: ${text}` : text;
        p.timeline.push({ at: new Date().toISOString(), by: auth.user.id, byName: auth.user.fullName ?? "", text: entryText, status: status !== row.status ? status : undefined });
        await tx
          .update(suspicionReports)
          .set({
            summaryEnc: writePayload(p), status, updatedAt: new Date(),
            ...(d.op === "report_fiu" ? { reportedToFiuOn: d.fiuDate!, fiuReferenceEnc: encryptString(d.fiuReference!) } : {}),
          })
          .where(eq(suspicionReports.id, row.id));
        return { from: row.status, to: status };
      },
      (tx, t) => audit(tx, { actorUserId: auth.user.id, action: `mlro.report_${d.op}`, entityType: "suspicion_report", entityId: d.id, ip, userAgent, before: { status: t.from }, after: { status: t.to } }),
    );
    revalidatePath(`${PATH}/${d.id}`);
    return { ok: true, message: d.op === "note" ? "أُضيفت الملاحظة." : "حُدّثت حالة البلاغ." };
  });
  return res;
}

const screenSchema = z.object({
  subjectType: z.enum(["waqf", "user"]),
  subjectRef: z.string().trim().min(3, "أدخل رقم الوقف أو رقم جوال الشخص."),
  provider: z.string().trim().min(2, "اذكر مصدر الفحص.").max(80),
  status: z.enum(["clear", "potential_match", "confirmed_match", "error"]),
  notes: z.string().trim().max(2000).optional(),
});

export async function recordScreening(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(screenSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return mlroAction(async ({ auth, ip, userAgent }) => {
    let subjectId: string;
    let label: string;
    if (d.subjectType === "waqf") {
      const w = await resolveWaqf(d.subjectRef);
      if (!w) return { error: "راجع الحقول المظللة.", fieldErrors: { subjectRef: "لا يوجد وقف بهذا الرقم." } };
      subjectId = w.id;
      label = `${w.number} — ${w.name}`;
    } else {
      const phone = normalizeSaudiMobile(d.subjectRef);
      if (!phone) return { error: "راجع الحقول المظللة.", fieldErrors: { subjectRef: "أدخل رقم جوال سعودي صحيح." } };
      const [u] = await withSystem((tx) => tx.select({ id: users.id, name: users.fullName }).from(users).where(eq(users.phone, phone)).limit(1));
      if (!u) return { error: "راجع الحقول المظللة.", fieldErrors: { subjectRef: "لا يوجد حساب بهذا الرقم." } };
      subjectId = u.id;
      label = u.name ?? phone;
    }
    const details = encryptString(JSON.stringify({ label, notes: d.notes ?? "" }));
    await withMlro(
      auth,
      async (tx) =>
        (await tx
          .insert(screeningResults)
          .values({ subjectType: d.subjectType, subjectId, provider: d.provider, status: d.status, detailsEnc: details, reviewedBy: auth.user.id, decision: d.status === "clear" ? "cleared" : null })
          .returning({ id: screeningResults.id }))[0].id,
      (tx, id) => audit(tx, { actorUserId: auth.user.id, action: "mlro.screening_recorded", entityType: "screening_result", entityId: id, ip, userAgent, after: { status: d.status, subjectType: d.subjectType } }),
    );
    revalidatePath(PATH);
    return { ok: true, message: "سُجلت نتيجة الفحص." };
  });
}

const decideSchema = z.object({ id: z.string().uuid(), decision: z.enum(["cleared", "escalated", "false_positive"]), note: z.string().trim().max(1000).optional() });

export async function decideScreening(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(decideSchema, fd);
  if ("state" in r) return r.state;
  return mlroAction(async ({ auth, ip, userAgent }) => {
    await withMlro(
      auth,
      async (tx) => {
        const [s] = await tx.select().from(screeningResults).where(eq(screeningResults.id, r.data.id)).limit(1).for("update");
        if (!s) throw new UserError("النتيجة غير موجودة.");
        let details: { label?: string; notes?: string } = {};
        try {
          details = JSON.parse(decryptNullable(s.detailsEnc) ?? "{}");
        } catch {}
        if (r.data.note) details.notes = [details.notes, `[${new Date().toISOString().slice(0, 10)}] ${r.data.note}`].filter(Boolean).join("\n");
        await tx.update(screeningResults).set({ decision: r.data.decision, reviewedBy: auth.user.id, detailsEnc: encryptString(JSON.stringify(details)) }).where(eq(screeningResults.id, s.id));
        return s.decision;
      },
      (tx, before) => audit(tx, { actorUserId: auth.user.id, action: "mlro.screening_decided", entityType: "screening_result", entityId: r.data.id, ip, userAgent, before: { decision: before }, after: { decision: r.data.decision } }),
    );
    revalidatePath(PATH);
    return { ok: true, message: "سُجل القرار." };
  });
}
