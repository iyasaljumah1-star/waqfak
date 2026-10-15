"use server";

import { materializeSchedule } from "@/server/modules/billing/schedule";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { contracts, contractSignatures, contractTemplates, documents, quotes, serviceRequests, users, waqfMemberships } from "@/server/db/schema";
import type { ContractParty } from "@/server/db/schema/commerce";
import { ForbiddenError } from "@/server/authz/context";
import { issueOtp, maskPhone, otpErrorText, verifyOtp } from "@/server/auth/otp";
import { audit, nextNumber } from "@/server/lib/audit";
import { sha256 } from "@/server/lib/crypto";
import { notify } from "@/server/modules/notify";
import { checkMaker, approvalMode } from "@/server/modules/approvals/policy";
import { parseForm, userAction, UserError } from "@/server/modules/_shared";
import { fmtBoth, type ActionState } from "@/lib/utils";
import { todayISO } from "@/server/engines/dates";
import { contractState, loadRequestCtx, memberCan, userHasWaqfPerm, type RequestCtx } from "@/server/modules/requests/access";
import { logEvent } from "@/server/modules/requests/engine";
import { AUTHORITY_LABEL, contractCompanyGaps, validateParties } from "@/server/modules/commerce/pure";
import { companyProfile, signaturesOf, signingState } from "@/server/modules/commerce/state";
import { companyParty, renderContract, templateCodeFor } from "./render";

type Ctx = Parameters<Parameters<typeof userAction>[0]>[0];
const uuid = z.string().uuid("قيمة غير صالحة.");
const reval = (id: string) => [`/app/requests/${id}`, `/admin/requests/${id}`];
const LIVE = ["sent", "partially_signed"];

async function revalidated(res: ActionState, reqId: string) {
  if (reqId) {
    const { revalidatePath } = await import("next/cache");
    for (const p of reval(reqId)) revalidatePath(p);
  }
  return res;
}

// ───────────────────────── Prepare (draft) ─────────────────────────

type ClientPartyInput = {
  name: string; capacity: string; idLabel?: string; idNumber?: string; signerUserId: string; authorityType: ContractParty["authorityType"];
  authorityRef?: string; authorityDocumentId?: string;
};

/** Who may sign for the client side: the requester, or a waqf member holding contracts.sign on the request's waqf. */
async function eligibleSigners(c: Ctx, rc: RequestCtx) {
  const ids = new Set<string>([rc.req.requesterUserId]);
  if (rc.req.waqfId) {
    const ms = await c.tx.select({ userId: waqfMemberships.userId }).from(waqfMemberships).where(and(eq(waqfMemberships.waqfId, rc.req.waqfId), eq(waqfMemberships.status, "active")));
    for (const m of ms) if (await userHasWaqfPerm(c.tx, m.userId, rc.req.waqfId, "contracts.sign")) ids.add(m.userId);
  }
  return c.tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, [...ids]));
}

/**
 * Staff: builds the contract draft from the accepted quote (initial → the contract; amendment → an amendment to the
 * executed contract), the parties with their capacity and authority, and the company data. Re-preparing replaces the
 * open draft; once a contract is approved or sent it can only be voided (with a reason) and re-issued as a new version.
 */
export async function prepareContract(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("id") ?? "");
  const quoteId = String(fd.get("quoteId") ?? "");
  if (!uuid.safeParse(id).success || !uuid.safeParse(quoteId).success) return { error: "بيانات غير صالحة." };
  let input: ClientPartyInput[] = [];
  try {
    input = JSON.parse(String(fd.get("parties") ?? "[]"));
  } catch {
    return { error: "بيانات الأطراف غير صالحة." };
  }
  return userAction(async (c) => {
    const rc = await loadRequestCtx(c.tx, c.auth, id, "staff");
    if (!rc.isAssignee && !rc.isOps) throw new ForbiddenError();
    const [q] = await c.tx.select().from(quotes).where(and(eq(quotes.id, quoteId), eq(quotes.requestId, id))).limit(1);
    if (!q || q.status !== "accepted") throw new UserError("يُبنى العقد على عرض قبله العميل.");
    const amendment = q.kind === "amendment";
    let parent: typeof contracts.$inferSelect | null = null;
    if (amendment) {
      const cs = await contractState(c.tx, id);
      if (!cs.executed || !cs.stage) throw new UserError("ملحق التعديل يأتي بعد نفاذ العقد الأصلي.");
      parent = cs.stage;
    } else if (rc.req.status !== "awaiting_contract") throw new UserError("يُعدّ العقد بعد قبول العميل عرض السعر.");

    const company = await companyProfile(c.tx);
    const gaps = contractCompanyGaps(company);
    if (gaps.length) throw new UserError(`بيانات الشركة ناقصة في الإعدادات، ولا يُعدّ عقد بدونها: ${gaps.join("، ")}.`);
    if (!Array.isArray(input) || !input.length || input.length > 4) throw new UserError("حدّد طرف العميل (حتى أربعة أطراف).");
    const signers = await eligibleSigners(c, rc);
    const reqDocs = new Set((await c.tx.select({ id: documents.id }).from(documents).where(eq(documents.requestId, id))).map((d) => d.id));
    const parties: ContractParty[] = [companyParty(company)];
    input.forEach((p, i) => {
      const signer = signers.find((s) => s.id === p.signerUserId);
      if (!signer) throw new UserError(`الموقّع عن الطرف ${i + 1} ليس مقدّم الطلب ولا عضوًا في الوقف.`);
      if (!Object.keys(AUTHORITY_LABEL).includes(p.authorityType) || p.authorityType === "company_signatory") throw new UserError("صفة التوقيع غير صالحة.");
      if (p.authorityDocumentId && !reqDocs.has(p.authorityDocumentId)) throw new UserError("سند الصفة ليس من وثائق الطلب.");
      parties.push({
        key: `client${i + 1}`, side: "client", name: String(p.name ?? "").trim().slice(0, 200), capacity: String(p.capacity ?? "").trim().slice(0, 120),
        idLabel: p.idLabel?.trim() || null, idNumber: p.idNumber?.trim() || null, signerName: signer.name ?? "—", signerUserId: signer.id,
        authorityType: p.authorityType, authorityRef: p.authorityRef?.trim() || null, authorityDocumentId: p.authorityDocumentId || null, required: true,
      });
    });
    for (const p of parties.filter((x) => x.side === "client")) if (!p.capacity) throw new UserError(`اذكر صفة «${p.name || "الطرف"}» في العقد.`);
    const errs = validateParties(parties);
    if (errs.length) throw new UserError(errs.join(" "));

    const code = templateCodeFor(rc.service, amendment);
    const [tpl] = await c.tx.select().from(contractTemplates).where(and(eq(contractTemplates.code, code), eq(contractTemplates.isActive, true))).orderBy(desc(contractTemplates.version)).limit(1);
    if (!tpl) throw new UserError(`لا يوجد قالب عقد مفعّل (${code}). تواصل مع مسؤول النظام.`);
    const existing = await c.tx.select().from(contracts).where(eq(contracts.quoteId, q.id)).orderBy(desc(contracts.createdAt));
    if (existing.some((k) => ["approved", ...LIVE, "signed"].includes(k.status))) throw new UserError("للعرض عقد معتمد أو مرسل. ألغه بسبب مكتوب أولًا لإصدار نسخة جديدة.");
    const draft = existing.find((k) => k.status === "draft");
    const number = draft?.number ?? (await nextNumber(c.tx, "CTR"));
    const version = draft?.version ?? existing.length + 1;
    const today = todayISO();
    const body = renderContract(tpl.body, {
      number, date: fmtBoth(today), parties, company, service: rc.service, requestNumber: rc.req.number, parentContract: parent?.number ?? null,
      quote: { ...q, lines: q.lines, paymentTerms: q.paymentTerms },
    }) + `\n\n---\nمرجع الطلب: ${rc.req.number} — العرض: ${q.number} (نسخة ${q.version}) — إصدار العقد: ${version}`;
    const contentHash = sha256(body);
    const values = {
      kind: tpl.kind, templateCode: tpl.code, templateVersion: tpl.version, requestId: id, waqfId: rc.req.waqfId, partyUserId: parties.find((p) => p.side === "client")!.signerUserId!,
      body, contentHash, amount: q.net, status: "draft", quoteId: q.id, parentContractId: parent?.id ?? null, version, parties, updatedBy: c.auth.user.id,
    };
    let rowId: string;
    if (draft) {
      await c.tx.update(contracts).set(values).where(and(eq(contracts.id, draft.id), eq(contracts.status, "draft")));
      rowId = draft.id;
    } else {
      const [row] = await c.tx.insert(contracts).values({ number, ...values, createdBy: c.auth.user.id }).returning({ id: contracts.id });
      rowId = row.id;
    }
    await audit(c.tx, { actorUserId: c.auth.user.id, action: draft ? "contracts.redraft" : "contracts.draft", entityType: "contract", entityId: rowId, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, after: { number, version, quote: `${q.number} v${q.version}`, contentHash, parties: parties.map((p) => ({ key: p.key, name: p.name, authority: p.authorityType })) } });
    return { ok: true, message: `${draft ? "حُدّثت" : "أُعدّت"} مسودة ${amendment ? "ملحق التعديل" : "العقد"} ${number}. تُعتمد داخليًا قبل إرسالها.` };
  }, { revalidate: reval(id) });
}

const cSchema = z.object({ contractId: uuid, note: z.string().trim().max(1000).optional().default("") });

async function loadContract(c: Ctx, contractId: string, side: "staff" | "client" | "any") {
  const [k] = await c.tx.select().from(contracts).where(eq(contracts.id, contractId)).limit(1);
  if (!k?.requestId) throw new UserError("العقد غير موجود.");
  const rc = await loadRequestCtx(c.tx, c.auth, k.requestId, side);
  return { k, rc };
}

/** Approved by a holder of admin.contracts.approve; its preparer only with direct approval (recorded), unless a written policy requires a second person. */
export async function approveContract(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(cSchema, fd);
  if ("state" in r) return r.state;
  let reqId = "";
  const res = await userAction(async (c) => {
    const { k, rc } = await loadContract(c, r.data.contractId, "staff");
    reqId = rc.req.id;
    if (k.status !== "draft") throw new UserError("تُعتمد المسودات فقط.");
    const mk = await checkMaker(c.tx, c.auth, "contract", k.createdBy === c.auth.user.id || k.updatedBy === c.auth.user.id, "مبدأ الفصل بين المهام: يعتمد العقد شخص غير من أعدّه أو عدّل مسودته.");
    if (!mk.ok) throw new UserError(mk.error);
    const gaps = contractCompanyGaps(await companyProfile(c.tx));
    if (gaps.length) throw new UserError(`بيانات الشركة ناقصة: ${gaps.join("، ")}.`);
    const errs = validateParties(k.parties);
    if (errs.length) throw new UserError(errs.join(" "));
    if (sha256(k.body) !== k.contentHash) throw new UserError("بصمة نص العقد لا تطابق المحفوظ. أعد إعداد المسودة.");
    await c.tx.update(contracts).set({ status: "approved", approvedBy: c.auth.user.id, approvedAt: new Date(), updatedBy: c.auth.user.id }).where(and(eq(contracts.id, k.id), eq(contracts.status, "draft")));
    await logEvent(c.tx, rc.req, c.auth.user.id, `اعتُمد ${k.parentContractId ? "ملحق التعديل" : "العقد"} ${k.number} (إصدار ${k.version}) داخليًا`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "contracts.approve", entityType: "contract", entityId: k.id, waqfId: k.waqfId, ip: c.ip, userAgent: c.userAgent, before: { status: "draft", createdBy: k.createdBy, updatedBy: k.updatedBy }, after: { number: k.number, version: k.version, status: "approved", request: rc.req.number, contentHash: k.contentHash, ...approvalMode(mk) } });
    return { ok: true, message: "اعتُمد العقد. أرسله للتوقيع." };
  }, { perm: "admin.contracts.approve" });
  return revalidated(res, reqId);
}

/** Sends an approved contract to its signers. */
export async function sendContract(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(cSchema, fd);
  if ("state" in r) return r.state;
  let reqId = "";
  const res = await userAction(async (c) => {
    const { k, rc } = await loadContract(c, r.data.contractId, "staff");
    reqId = rc.req.id;
    if (!rc.isAssignee && !rc.isOps) throw new ForbiddenError();
    if (k.status !== "approved") throw new UserError("يُرسل العقد بعد اعتماده.");
    await c.tx.update(contracts).set({ status: "sent", sentAt: new Date(), updatedBy: c.auth.user.id }).where(and(eq(contracts.id, k.id), eq(contracts.status, "approved")));
    await logEvent(c.tx, rc.req, c.auth.user.id, `أُرسل ${k.parentContractId ? "ملحق التعديل" : "العقد"} ${k.number} للتوقيع`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "contracts.send", entityType: "contract", entityId: k.id, waqfId: k.waqfId, ip: c.ip, userAgent: c.userAgent });
    for (const p of k.parties.filter((x) => x.side === "client" && x.signerUserId))
      await notify(p.signerUserId!, "contract.sign", { number: k.number, note: `${k.parentContractId ? "ملحق التعديل" : "العقد"} للطلب ${rc.req.number} جاهز لتوقيعك بصفتك ${AUTHORITY_LABEL[p.authorityType]} عن «${p.name}».` }, { waqfId: k.waqfId, link: `/app/requests/${rc.req.id}#contract`, tx: c.tx });
    return { ok: true, message: "أُرسل العقد للتوقيع." };
  });
  return revalidated(res, reqId);
}

const voidSchema = z.object({ contractId: uuid, reason: z.string().trim().min(5, "اكتب سبب الإلغاء.").max(1000) });

/** Voids a contract that is not executed yet (signatures already given lapse with it). Executed contracts change only by amendment. */
export async function voidContract(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(voidSchema, fd);
  if ("state" in r) return r.state;
  let reqId = "";
  const res = await userAction(async (c) => {
    const { k, rc } = await loadContract(c, r.data.contractId, "staff");
    reqId = rc.req.id;
    if (!rc.isAssignee && !rc.isOps) throw new ForbiddenError();
    if (!["draft", "approved", ...LIVE].includes(k.status)) throw new UserError(k.status === "signed" ? "العقد نافذ؛ يُعدّل بملحق تعديل يوقّعه الأطراف." : "العقد ملغى مسبقًا.");
    if (k.status !== "draft" && !rc.isOps) throw new ForbiddenError("إلغاء عقد معتمد أو مرسل لمدير التشغيل.");
    await c.tx.update(contracts).set({ status: "void", voidReason: r.data.reason, updatedBy: c.auth.user.id }).where(eq(contracts.id, k.id));
    await logEvent(c.tx, rc.req, c.auth.user.id, `أُلغي ${k.parentContractId ? "ملحق التعديل" : "العقد"} ${k.number} (إصدار ${k.version}): ${r.data.reason}`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "contracts.void", entityType: "contract", entityId: k.id, waqfId: k.waqfId, ip: c.ip, userAgent: c.userAgent, before: { status: k.status }, after: { reason: r.data.reason } });
    if (LIVE.includes(k.status))
      for (const p of k.parties.filter((x) => x.signerUserId))
        await notify(p.signerUserId!, "request.status", { number: rc.req.number, status: `أُلغي العقد ${k.number} قبل نفاذه: ${r.data.reason}` }, { waqfId: k.waqfId, link: `/app/requests/${rc.req.id}#contract`, tx: c.tx });
    return { ok: true, message: "أُلغي العقد." };
  });
  return revalidated(res, reqId);
}

// ───────────────────────── Signing (OTP, per party) ─────────────────────────

/**
 * Who may sign which party. Client parties: only the named signer account. The company party: a staff member holding
 * admin.contracts.approve (the actual signer's name and the signatory named in the contract are both recorded).
 */
async function signableParty(c: Ctx, k: typeof contracts.$inferSelect, partyKey: string) {
  if (!k.parties.length) {
    // legacy contract (before parties): the client party (requester or a member with contracts.sign)
    const may = k.partyUserId === c.auth.user.id || (k.waqfId ? await memberCan(c.tx, c.auth, k.waqfId, "contracts.sign") : false);
    if (!may) throw new ForbiddenError("لا تملك صلاحية توقيع هذا العقد.");
    return null;
  }
  const p = k.parties.find((x) => x.key === partyKey);
  if (!p) throw new UserError("الطرف غير موجود في العقد.");
  if (p.side === "client" && p.signerUserId !== c.auth.user.id) throw new ForbiddenError("التوقيع عن هذا الطرف لصاحب الحساب المسمّى في العقد فقط.");
  if (p.side === "company" && !(c.auth.isStaff && c.auth.perms.has("admin.contracts.approve"))) throw new ForbiddenError("التوقيع عن الشركة لمن يملك صلاحية اعتماد العقود.");
  return p;
}

async function loadSignable(c: Ctx, contractId: string, partyKey: string) {
  const [k] = await c.tx.select().from(contracts).where(eq(contracts.id, contractId)).limit(1);
  if (!k || !k.requestId) throw new UserError("العقد غير موجود.");
  const party = await signableParty(c, k, partyKey);
  const rc = await loadRequestCtx(c.tx, c.auth, k.requestId, party?.side === "company" ? "staff" : "client");
  if (!LIVE.includes(k.status) && !(k.status === "sent")) throw new UserError(k.status === "signed" ? "العقد موقّع من جميع أطرافه." : "العقد غير مرسل للتوقيع.");
  const sigs = await signaturesOf(c.tx, [k.id]);
  if (party && sigs.some((s) => s.partyKey === party.key)) throw new UserError("وُقّع عن هذا الطرف مسبقًا.");
  if (!party && sigs.some((s) => s.method === "otp")) throw new UserError("العقد موقّع مسبقًا.");
  return { k, rc, party, sigs };
}

/** Sends a signing OTP to the signer's registered phone, bound to the contract text hash and the party. */
export async function requestSignOtp(_: ActionState, fd: FormData): Promise<ActionState> {
  const contractId = String(fd.get("contractId") ?? "");
  const partyKey = String(fd.get("partyKey") ?? "");
  if (!uuid.safeParse(contractId).success) return { error: "عقد غير صالح." };
  return userAction(async (c) => {
    const { k, party } = await loadSignable(c, contractId, partyKey);
    if (!c.auth.user.phone) throw new UserError("لا يوجد رقم جوال في حسابك لإرسال رمز التوقيع.");
    const issued = await issueOtp(c.auth.user.phone, "sign_contract", c.ip, { contractId: k.id, userId: c.auth.user.id, contentHash: k.contentHash, partyKey: party?.key ?? "" });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "contracts.sign_otp_sent", entityType: "contract", entityId: k.id, waqfId: k.waqfId, ip: c.ip, userAgent: c.userAgent, after: { partyKey: party?.key } });
    return { ok: true, message: "أرسلنا رمز التوقيع إلى جوالك.", data: { challengeId: issued.challengeId, demoCode: issued.demoCode ?? null, masked: maskPhone(c.auth.user.phone) } };
  });
}

const signSchema = z.object({
  contractId: uuid,
  partyKey: z.string().max(40).optional().default(""),
  challengeId: uuid,
  code: z.string().regex(/^\d{6}$/, "أدخل الرمز المكوّن من 6 أرقام."),
  consent: z.literal("on", { message: "أكّد أنك قرأت العقد وتوافق عليه." }),
});

/** Verifies the OTP and records the signature of one party; the contract is executed when every required party signed. */
export async function signContract(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(signSchema, fd);
  if ("state" in r) return { ...r.state, data: { challengeId: fd.get("challengeId") } };
  const d = r.data;
  let reqId = "";
  let staffSide = false;
  const res = await userAction(async (c) => {
    const { k, rc, party, sigs } = await loadSignable(c, d.contractId, d.partyKey);
    reqId = rc.req.id;
    staffSide = party?.side === "company";
    const v = await verifyOtp(d.challengeId, c.auth.user.phone, "sign_contract", d.code);
    if (!v.ok) throw new UserError(otpErrorText(v.reason));
    if (v.context?.contractId !== k.id || v.context?.userId !== c.auth.user.id || (v.context?.partyKey ?? "") !== (party?.key ?? "")) throw new UserError("الرمز لا يخص هذا العقد أو هذا الطرف. اطلب رمزًا جديدًا.");
    if (sha256(k.body) !== k.contentHash || v.context?.contentHash !== k.contentHash) throw new UserError("تغيّر نص العقد بعد إرسال الرمز. أعد تحميل الصفحة واطلب رمزًا جديدًا.");
    const now = new Date();
    const [me] = await c.tx.select({ name: users.fullName }).from(users).where(eq(users.id, c.auth.user.id));
    const signerName = me?.name ?? "—";
    const capacity = party ? `${AUTHORITY_LABEL[party.authorityType]} عن «${party.name}»${party.side === "company" && party.signerName !== signerName ? ` (المفوّض المسمّى: ${party.signerName})` : ""}` : "العميل";
    await c.tx.insert(contractSignatures).values({
      contractId: k.id, userId: c.auth.user.id, signedAt: now, method: party?.side === "company" ? "company_otp" : "otp", otpChallengeId: d.challengeId,
      ip: c.ip, userAgent: c.userAgent, contentHash: k.contentHash, partyKey: party?.key ?? null, signerName, capacity,
    });
    const after = signingState(k, [...sigs, { contractId: k.id, partyKey: party?.key ?? null, method: party?.side === "company" ? "company_otp" : "otp" } as typeof sigs[number]]);
    const executed = after.executed;
    await c.tx.update(contracts).set({ status: executed ? "signed" : "partially_signed", signedAt: executed ? now : null, executedAt: executed ? now : null, updatedBy: c.auth.user.id }).where(eq(contracts.id, k.id));
    await logEvent(c.tx, rc.req, c.auth.user.id, `وقّع ${signerName} ${capacity} ${k.parentContractId ? "ملحق التعديل" : "العقد"} ${k.number} برمز تحقق${executed ? " — نفذ العقد بتوقيع جميع الأطراف" : ""}`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "contracts.sign", entityType: "contract", entityId: k.id, waqfId: k.waqfId, ip: c.ip, userAgent: c.userAgent, after: { partyKey: party?.key, method: "otp", contentHash: k.contentHash, challengeId: d.challengeId, executed } });
    if (executed) {
      // The contract's payment schedule, with the due dates it fixes (dated installments, or the signing date).
      await materializeSchedule(c.tx, rc.req.id, c.auth.user.id);
      if (k.parentContractId && k.quoteId) {
        // An executed amendment adds its net amount to the agreed price.
        const [q] = await c.tx.select({ net: quotes.net }).from(quotes).where(eq(quotes.id, k.quoteId));
        if (q) await c.tx.update(serviceRequests).set({ agreedPrice: (Number(rc.req.agreedPrice ?? 0) + Number(q.net)).toFixed(2) }).where(eq(serviceRequests.id, rc.req.id));
      }
      const recipients = new Set<string>([rc.req.requesterUserId, ...k.parties.map((p) => p.signerUserId).filter((x): x is string => !!x), ...(rc.req.assignedToUserId ? [rc.req.assignedToUserId] : [])]);
      for (const u of recipients) await notify(u, "contract.executed", { number: k.number, request: rc.req.number }, { waqfId: k.waqfId, link: u === rc.req.assignedToUserId ? `/admin/requests/${rc.req.id}#contract` : `/app/requests/${rc.req.id}#contract`, tx: c.tx });
    } else if (rc.req.assignedToUserId && rc.req.assignedToUserId !== c.auth.user.id) {
      await notify(rc.req.assignedToUserId, "request.status", { number: rc.req.number, status: `وقّع ${signerName} العقد ${k.number}؛ بانتظار بقية الأطراف` }, { waqfId: rc.req.waqfId, link: `/admin/requests/${rc.req.id}#contract`, tx: c.tx });
    }
    return { ok: true, message: executed ? "تم التوقيع ونفذ العقد بتوقيع جميع الأطراف." : "تم توقيعك. بانتظار توقيع بقية الأطراف." };
  });
  await revalidated(res, reqId);
  if (res.ok && reqId) redirect(staffSide ? `/admin/requests/${reqId}?signed=1#contract` : `/app/requests/${reqId}?signed=1#contract`);
  return res;
}

/** Legacy contracts (issued before parties existed): company counter-signature after the client signed. */
export async function countersignContract(_: ActionState, fd: FormData): Promise<ActionState> {
  const contractId = String(fd.get("contractId") ?? "");
  if (!uuid.safeParse(contractId).success) return { error: "عقد غير صالح." };
  let reqId = "";
  const res = await userAction(async (c) => {
    const { k, rc } = await loadContract(c, contractId, "staff");
    reqId = rc.req.id;
    if (k.parties.length) throw new UserError("العقود الجديدة يوقّعها المفوّض عن الشركة برمز تحقق من لوحة العقد.");
    if (!rc.isOps) throw new ForbiddenError("توقيع الشركة لمدير التشغيل أو من يملك صلاحية كل الطلبات.");
    const cs = await contractState(c.tx, k.requestId!);
    if (cs.contract?.id !== k.id || !cs.clientSigned) throw new UserError("يوقّع العميل أولًا ثم توقّع الشركة.");
    if (cs.companySigned) throw new UserError("وقّعت الشركة هذا العقد مسبقًا.");
    if (sha256(k.body) !== k.contentHash) throw new UserError("بصمة نص العقد لا تطابق المحفوظ. أوقف الإجراء وأبلغ مسؤول النظام.");
    await c.tx.insert(contractSignatures).values({ contractId: k.id, userId: c.auth.user.id, method: "company_countersign", ip: c.ip, userAgent: c.userAgent, contentHash: k.contentHash });
    await logEvent(c.tx, rc.req, c.auth.user.id, `وقّعت الشركة العقد ${k.number}`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "contracts.countersign", entityType: "contract", entityId: k.id, waqfId: k.waqfId, ip: c.ip, userAgent: c.userAgent, after: { contentHash: k.contentHash } });
    await notify(rc.req.requesterUserId, "request.status", { number: rc.req.number, status: `اكتمل توقيع العقد ${k.number} من الطرفين` }, { waqfId: rc.req.waqfId, link: `/app/requests/${rc.req.id}#contract`, tx: c.tx });
    return { ok: true, message: "تم توقيع الشركة." };
  }, { perm: "admin.requests.all" });
  return revalidated(res, reqId);
}
