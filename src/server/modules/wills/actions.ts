"use server";

/** Waqf bequest (وصية بالوقف) planner: create, save the plan (estate, one-third check), generate the indicative will text. */
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { deedVersions, waqfDeeds, waqfKeys, waqfMemberships, waqfs, waqfTimelineEvents } from "../../db/schema";
import { audit, nextNumber } from "../../lib/audit";
import { newDataKey } from "../../lib/crypto";
import { loadWaqfAccess } from "../../authz/context";
import { UserError, userAction } from "../_shared";
import type { ActionState } from "@/lib/utils";
import { normalizeNumber, readRows, todayIso } from "../waqf-file/form";
import { isUuid } from "../waqf-file/guard";
import { bequestCheck, buildWillDraft, emptyPlan, ESTATE_KIND_LABEL, type WillPlan } from "./pure";
import { willPlan } from "./queries";

export async function startWill(_: ActionState, _fd: FormData): Promise<ActionState> {
  void _fd;
  const res = await userAction(async ({ auth, tx, ip, userAgent }) => {
    const internalNumber = await nextNumber(tx, "WQF");
    const name = `وصية بوقف — ${auth.user.fullName ?? internalNumber}`;
    const [w] = await tx.insert(waqfs).values({ internalNumber, name, status: "idea", creationMode: "bequest", stage: 1, founderAlive: true, createdBy: auth.user.id, updatedBy: auth.user.id }).returning({ id: waqfs.id });
    await tx.insert(waqfKeys).values({ waqfId: w.id, wrappedKey: newDataKey().wrapped });
    await tx.insert(waqfMemberships).values({ waqfId: w.id, userId: auth.user.id, roleKey: "founder", createdBy: auth.user.id });
    const [deed] = await tx.insert(waqfDeeds).values({ waqfId: w.id, status: "draft", currentVersion: 1, createdBy: auth.user.id }).returning({ id: waqfDeeds.id });
    await tx.insert(deedVersions).values({ deedId: deed.id, waqfId: w.id, version: 1, structured: emptyPlan(auth.user.fullName ?? "") as unknown as Record<string, unknown>, changeNote: "مخطط الوصية بالوقف", createdBy: auth.user.id });
    await tx.insert(waqfTimelineEvents).values({ waqfId: w.id, type: "establish", occurredOn: todayIso(), title: "بدء التخطيط لوصية بوقف", stage: 1, createdBy: auth.user.id });
    await audit(tx, { actorUserId: auth.user.id, action: "wills.started", entityType: "waqf", entityId: w.id, waqfId: w.id, ip, userAgent, after: { internalNumber } });
    return { ok: true, data: { id: w.id } };
  }, { revalidate: ["/app/wills"] });
  if (res.ok && typeof res.data?.id === "string") redirect(`/app/wills/${res.data.id}`);
  return res;
}

const t = (v: FormDataEntryValue | null, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function saveWill(_: ActionState, fd: FormData): Promise<ActionState> {
  const willId = String(fd.get("willId") ?? "");
  if (!isUuid(willId)) return { error: "المخطط غير موجود." };
  return userAction(async ({ auth, tx, ip, userAgent }) => {
    const access = await loadWaqfAccess(tx, auth, willId);
    if (!access || !access.roles.includes("founder") || access.waqf.createdBy !== auth.user.id || access.waqf.creationMode !== "bequest") throw new UserError("هذا المخطط ليس لك.");
    const cur = await willPlan(tx, willId);
    if (!cur) throw new UserError("هذا ليس مخطط وصية.");
    const estate = readRows(fd, "e", ["kind", "description", "value"]).slice(0, 40).map((r) => ({ kind: r.kind in ESTATE_KIND_LABEL ? r.kind : "other", description: r.description.slice(0, 200), value: normalizeNumber(r.value) ?? "" }));
    const fe: Record<string, string> = {};
    estate.forEach((e, i) => {
      if (e.value && !(Number(e.value) >= 0)) fe[`e${i}`] = `قيمة البند ${i + 1} غير صحيحة.`;
    });
    const plan: WillPlan = {
      ...cur.plan,
      testatorName: t(fd.get("testatorName"), 200),
      estate,
      debts: normalizeNumber(t(fd.get("debts"), 20)) ?? "",
      bequestMode: fd.get("bequestMode") === "amount" ? "amount" : "pct",
      bequestPct: normalizeNumber(t(fd.get("bequestPct"), 10)) ?? "",
      bequestAmount: normalizeNumber(t(fd.get("bequestAmount"), 20)) ?? "",
      bequestToHeir: fd.get("bequestToHeir") === "on" ? "on" : "off",
      heirsCount: t(fd.get("heirsCount"), 3),
      heirsConsentNote: t(fd.get("heirsConsentNote"), 500),
      masraf: t(fd.get("masraf"), 300),
      nazirName: t(fd.get("nazirName"), 200),
      executorName: t(fd.get("executorName"), 200),
      conditions: t(fd.get("conditions"), 1500),
    };
    if (plan.testatorName.length < 3) fe.testatorName = "اكتب اسم الموصي كاملًا.";
    if (plan.bequestMode === "pct" && plan.bequestPct && !(Number(plan.bequestPct) > 0 && Number(plan.bequestPct) <= 100)) fe.bequestPct = "النسبة بين 0 و100.";
    if (plan.debts && !(Number(plan.debts) >= 0)) fe.debts = "مبلغ الديون غير صحيح.";
    if (Object.keys(fe).length) return { error: Object.values(fe)[0], fieldErrors: fe };
    const check = bequestCheck(plan);
    plan.draftText = buildWillDraft(plan, todayIso());
    await tx.update(deedVersions).set({ structured: plan as unknown as Record<string, unknown>, body: plan.draftText, updatedBy: auth.user.id }).where(eq(deedVersions.id, cur.versionId));
    await tx.update(waqfs).set({ name: plan.masraf ? `وصية بوقف على ${plan.masraf}`.slice(0, 200) : access.waqf.name, updatedBy: auth.user.id }).where(eq(waqfs.id, willId));
    // Estate values are personal financial data: the audit keeps totals and the one-third result, not the itemized estate.
    await audit(tx, { actorUserId: auth.user.id, action: "wills.saved", entityType: "waqf", entityId: willId, waqfId: willId, ip, userAgent, after: { items: estate.length, net: check.net, bequest: check.bequest, exceedsThird: check.exceedsThird, needsHeirConsent: check.needsHeirConsent } });
    return { ok: true, message: check.needsHeirConsent ? "حُفظ المخطط. الوصية بصيغتها الحالية تحتاج إجازة الورثة — راجع الملاحظات." : "حُفظ المخطط. الوصية في حدود الثلث." };
  }, { revalidate: [`/app/wills/${willId}`, "/app/wills"] });
}
