"use server";

import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { contracts, contractSignatures, contractTemplates, users } from "@/server/db/schema";
import { ForbiddenError } from "@/server/authz/context";
import { issueOtp, maskPhone, otpErrorText, verifyOtp } from "@/server/auth/otp";
import { audit, nextNumber } from "@/server/lib/audit";
import { sha256 } from "@/server/lib/crypto";
import { notify } from "@/server/modules/notify";
import { parseForm, userAction, UserError } from "@/server/modules/_shared";
import { fmtBoth, fmtSAR, type ActionState } from "@/lib/utils";
import { todayISO } from "@/server/engines/dates";
import { contractState, loadRequestCtx, memberCan } from "@/server/modules/requests/access";
import { readSetting } from "@/server/modules/requests/catalog";
import { logEvent } from "@/server/modules/requests/engine";
import { computeInvoice, fillTemplate } from "@/server/modules/billing/calc";

const uuid = z.string().uuid("قيمة غير صالحة.");
const reval = (id: string) => [`/app/requests/${id}`, `/admin/requests/${id}`];

type CompanyProfile = { nameAr?: string; crNumber?: string; vatNumber?: string };

/** Staff: renders the service contract from the active template and sends it to the client. */
export async function generateContract(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("id") ?? "");
  if (!uuid.safeParse(id).success) return { error: "طلب غير صالح." };
  return userAction(async (c) => {
    const rc = await loadRequestCtx(c.tx, c.auth, id, "staff");
    if (rc.req.status !== "awaiting_contract") throw new UserError("يُنشأ العقد بعد قبول العميل عرض السعر (حالة «بانتظار العقد»).");
    const cs = await contractState(c.tx, id);
    if (cs.clientSigned) throw new UserError("العقد موقّع، والعقود الموقّعة لا تُعدّل.");
    const amountStr = rc.req.agreedPrice ?? rc.req.quoteAmount;
    if (!amountStr) throw new UserError("حدّد مبلغ عرض السعر أولًا.");
    const [tpl] = await c.tx.select().from(contractTemplates)
      .where(and(eq(contractTemplates.code, "service_standard"), eq(contractTemplates.isActive, true))).orderBy(desc(contractTemplates.version)).limit(1);
    if (!tpl) throw new UserError("لا يوجد قالب عقد مفعّل (service_standard). تواصل مع مدير النظام.");
    const company = await readSetting<CompanyProfile>(c.tx, "company.profile", {});
    const vatRate = Number(await readSetting<number>(c.tx, "requests.default_vat_rate", 15)) || 15;
    const [client] = await c.tx.select({ name: users.fullName }).from(users).where(eq(users.id, rc.req.requesterUserId));
    const inv = computeInvoice(Number(amountStr), vatRate);
    const number = await nextNumber(c.tx, "CTR");
    const today = todayISO();
    const body =
      fillTemplate(tpl.body, {
        number,
        company_name: company.nameAr || "شركة وقفك",
        company_cr: company.crNumber || "(قيد الإضافة)",
        client_name: client?.name ?? "العميل",
        waqf_clause: rc.waqf ? `، بصفته ممثلًا عن «${rc.waqf.name}»` : "",
        service_name: rc.service.nameAr,
        service_code: rc.service.code,
        outputs: rc.service.outputs ?? rc.service.summary,
        sla_days: rc.service.slaDays ?? rc.stagesDef.reduce((s, x) => s + x.slaDays, 0),
        price_clause: `المقابل المالي ${fmtSAR(inv.net)} قبل الضريبة، وضريبة القيمة المضافة بنسبة ${vatRate}% قدرها ${fmtSAR(inv.vat)}، فيكون الإجمالي ${fmtSAR(inv.total)}، يُسدد بموجب فاتورة ضريبية تصدر عبر المنصة.`,
        restriction: rc.service.regulatoryRestrictions || "لا قيود نظامية إضافية على هذه الخدمة غير ما ورد في هذا العقد.",
        vat_rate: vatRate,
        request_number: rc.req.number,
        date: fmtBoth(today),
      }) + `\n\n---\nمرجع الطلب: ${rc.req.number} — تاريخ إصدار العقد: ${fmtBoth(today)}`;
    const contentHash = sha256(body);
    if (cs.contract) await c.tx.update(contracts).set({ status: "void", updatedBy: c.auth.user.id }).where(eq(contracts.id, cs.contract.id));
    const [row] = await c.tx.insert(contracts).values({
      number, kind: tpl.kind, templateCode: tpl.code, templateVersion: tpl.version, requestId: id, waqfId: rc.req.waqfId,
      partyUserId: rc.req.requesterUserId, body, contentHash, amount: inv.net.toFixed(2), status: "sent", createdBy: c.auth.user.id,
    }).returning({ id: contracts.id });
    await logEvent(c.tx, rc.req, c.auth.user.id, `صدر العقد ${number} وأُرسل للتوقيع${cs.contract ? ` (يحل محل ${cs.contract.number})` : ""}`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "contracts.generate", entityType: "contract", entityId: row.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, after: { number, contentHash, amount: inv.net, replaced: cs.contract?.number } });
    await notify(rc.req.requesterUserId, "request.awaiting_client", { number: rc.req.number, note: `العقد ${number} جاهز لتوقيعك` }, { waqfId: rc.req.waqfId, link: `/app/requests/${id}#contract`, tx: c.tx });
    return { ok: true, message: `صدر العقد ${number}.` };
  }, { perm: "staff.requests.assigned", revalidate: reval(id) });
}

async function loadSignable(c: Parameters<Parameters<typeof userAction>[0]>[0], contractId: string) {
  const [k] = await c.tx.select().from(contracts).where(eq(contracts.id, contractId)).limit(1);
  if (!k || !k.requestId) throw new UserError("العقد غير موجود.");
  const rc = await loadRequestCtx(c.tx, c.auth, k.requestId, "client");
  const may = k.partyUserId === c.auth.user.id || (k.waqfId ? await memberCan(c.tx, c.auth, k.waqfId, "contracts.sign") : false);
  if (!may) throw new ForbiddenError("لا تملك صلاحية توقيع هذا العقد.");
  if (k.status !== "sent") throw new UserError(k.status === "signed" ? "العقد موقّع مسبقًا." : "العقد لم يعد ساريًا.");
  return { k, rc };
}

/** Client: sends a signing OTP to the signer's registered phone. */
export async function requestSignOtp(_: ActionState, fd: FormData): Promise<ActionState> {
  const contractId = String(fd.get("contractId") ?? "");
  if (!uuid.safeParse(contractId).success) return { error: "عقد غير صالح." };
  return userAction(async (c) => {
    const { k } = await loadSignable(c, contractId);
    const issued = await issueOtp(c.auth.user.phone, "sign_contract", c.ip, { contractId: k.id, userId: c.auth.user.id, contentHash: k.contentHash });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "contracts.sign_otp_sent", entityType: "contract", entityId: k.id, waqfId: k.waqfId, ip: c.ip, userAgent: c.userAgent });
    return { ok: true, message: "أرسلنا رمز التوقيع إلى جوالك.", data: { challengeId: issued.challengeId, demoCode: issued.demoCode ?? null, masked: maskPhone(c.auth.user.phone) } };
  });
}

const signSchema = z.object({
  contractId: uuid,
  challengeId: uuid,
  code: z.string().regex(/^\d{6}$/, "أدخل الرمز المكوّن من 6 أرقام."),
  consent: z.literal("on", { message: "أكّد أنك قرأت العقد وتوافق عليه." }),
});

/** Client: verifies the OTP and records an e-signature bound to the contract's content hash. */
export async function signContract(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(signSchema, fd);
  if ("state" in r) return { ...r.state, data: { challengeId: fd.get("challengeId") } };
  const d = r.data;
  let reqId = "";
  const res = await userAction(async (c) => {
    const { k, rc } = await loadSignable(c, d.contractId);
    reqId = rc.req.id;
    const v = await verifyOtp(d.challengeId, c.auth.user.phone, "sign_contract", d.code);
    if (!v.ok) throw new UserError(otpErrorText(v.reason));
    if (v.context?.contractId !== k.id || v.context?.userId !== c.auth.user.id) throw new UserError("الرمز لا يخص هذا العقد. اطلب رمزًا جديدًا.");
    if (sha256(k.body) !== k.contentHash || v.context?.contentHash !== k.contentHash) throw new UserError("تغيّر نص العقد بعد إرسال الرمز. أعد تحميل الصفحة واطلب رمزًا جديدًا.");
    const now = new Date();
    await c.tx.insert(contractSignatures).values({ contractId: k.id, userId: c.auth.user.id, signedAt: now, method: "otp", otpChallengeId: d.challengeId, ip: c.ip, userAgent: c.userAgent, contentHash: k.contentHash });
    await c.tx.update(contracts).set({ status: "signed", signedAt: now, updatedBy: c.auth.user.id }).where(and(eq(contracts.id, k.id), eq(contracts.status, "sent")));
    await logEvent(c.tx, rc.req, c.auth.user.id, `وقّع العميل العقد ${k.number} إلكترونيًا برمز التحقق`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "contracts.sign", entityType: "contract", entityId: k.id, waqfId: k.waqfId, ip: c.ip, userAgent: c.userAgent, after: { method: "otp", contentHash: k.contentHash, challengeId: d.challengeId } });
    if (rc.req.assignedToUserId) await notify(rc.req.assignedToUserId, "request.status", { number: rc.req.number, status: `وقّع العميل العقد ${k.number}` }, { waqfId: rc.req.waqfId, link: `/admin/requests/${rc.req.id}`, tx: c.tx });
    return { ok: true, message: "تم توقيع العقد. ستصلك نسخة الفاتورة بعد اعتماد الشركة." };
  });
  if (reqId) {
    const { revalidatePath } = await import("next/cache");
    for (const p of reval(reqId)) revalidatePath(p);
  }
  if (res.ok && reqId) redirect(`/app/requests/${reqId}?signed=1#contract`);
  return res;
}

/** Ops: company counter-signature (after the client signed). */
export async function countersignContract(_: ActionState, fd: FormData): Promise<ActionState> {
  const contractId = String(fd.get("contractId") ?? "");
  if (!uuid.safeParse(contractId).success) return { error: "عقد غير صالح." };
  let reqId = "";
  const res = await userAction(async (c) => {
    const [k] = await c.tx.select().from(contracts).where(eq(contracts.id, contractId)).limit(1);
    if (!k?.requestId) throw new UserError("العقد غير موجود.");
    const rc = await loadRequestCtx(c.tx, c.auth, k.requestId, "staff");
    reqId = rc.req.id;
    if (!rc.isOps) throw new ForbiddenError("توقيع الشركة لمدير التشغيل أو من يملك صلاحية كل الطلبات.");
    const cs = await contractState(c.tx, k.requestId);
    if (cs.contract?.id !== k.id || !cs.clientSigned) throw new UserError("يوقّع العميل أولًا ثم توقّع الشركة.");
    if (cs.companySigned) throw new UserError("وقّعت الشركة هذا العقد مسبقًا.");
    if (sha256(k.body) !== k.contentHash) throw new UserError("بصمة نص العقد لا تطابق المحفوظ. أوقف الإجراء وأبلغ مسؤول النظام.");
    await c.tx.insert(contractSignatures).values({ contractId: k.id, userId: c.auth.user.id, method: "company_countersign", ip: c.ip, userAgent: c.userAgent, contentHash: k.contentHash });
    await logEvent(c.tx, rc.req, c.auth.user.id, `وقّعت الشركة العقد ${k.number}`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "contracts.countersign", entityType: "contract", entityId: k.id, waqfId: k.waqfId, ip: c.ip, userAgent: c.userAgent, after: { contentHash: k.contentHash } });
    await notify(rc.req.requesterUserId, "request.status", { number: rc.req.number, status: `اكتمل توقيع العقد ${k.number} من الطرفين` }, { waqfId: rc.req.waqfId, link: `/app/requests/${rc.req.id}#contract`, tx: c.tx });
    return { ok: true, message: "تم توقيع الشركة." };
  }, { perm: "admin.requests.all" });
  if (reqId) {
    const { revalidatePath } = await import("next/cache");
    for (const p of reval(reqId)) revalidatePath(p);
  }
  return res;
}
