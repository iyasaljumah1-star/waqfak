"use server";

/**
 * New-waqf wizard (scenario 2). A draft is a real waqf row (status "idea" → "draft") owned by its founder; the wizard
 * answers live in the draft deed version's `structured` jsonb so the user can leave and resume at /app/establish/[id].
 * "Finish" turns the answers into the waqf file (classification, founder, assets, classes, conditions, nazara,
 * allocation) and stores the generated indicative deed text as version 1.
 */
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Tx } from "../../db";
import {
  assets, beneficiaryClasses, conditions, deedVersions, founders, revenueAllocations, successions, trustees, waqfClassifications, waqfDeeds,
  waqfExceptions, waqfKeys, waqfMemberships, waqfs, waqfTimelineEvents,
} from "../../db/schema";
import { audit, nextNumber } from "../../lib/audit";
import { newDataKey } from "../../lib/crypto";
import { loadWaqfAccess, type Auth } from "../../authz/context";
import { syncWaqfObligations } from "../compliance/events";
import { isFlagOn } from "../requests/catalog";
import { parseForm, UserError, userAction } from "../_shared";
import type { ActionState } from "@/lib/utils";
import { allocationTotal } from "../deed/pure";
import { suggestSizeClass } from "../assets/pure";
import { tierShareIssues } from "../beneficiaries/pure";
import { normalizeNumber, readRows, todayIso } from "../waqf-file/form";
import { isUuid } from "../waqf-file/guard";
import { buildDeedDraft, classify, emptyState, ESTABLISH_STEPS, missingItems, type EstablishState } from "./pure";
import { draftState } from "./queries";

const CATS = ["real_estate", "movable", "usufruct", "intellectual_property", "cash", "shares", "fund_units", "portfolio", "sukuk"];
const COND_CATS = ["asset", "revenue", "masraf", "nazara", "founder_self", "governance_finance"];
const s = (v: FormDataEntryValue | null, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Loads a draft the current user may edit: they created it, hold the founder role, and it is still a draft. */
async function loadDraft(tx: Tx, auth: Auth, draftId: string) {
  if (!isUuid(draftId)) throw new UserError("المسودة غير موجودة.");
  const access = await loadWaqfAccess(tx, auth, draftId);
  if (!access || !access.roles.includes("founder") || access.waqf.createdBy !== auth.user.id) throw new UserError("هذه المسودة ليست لك أو لم تعد متاحة.");
  if (!["idea", "draft"].includes(access.waqf.status)) throw new UserError("خرج هذا الوقف من مرحلة المسودة؛ عدّل بياناته من ملف الوقف.");
  const d = await draftState(tx, draftId);
  if (!d) throw new UserError("هذه ليست مسودة تأسيس.");
  return { waqf: access.waqf, ...d };
}

// ───────────── Start ─────────────
export async function startEstablishDraft(_: ActionState, _fd: FormData): Promise<ActionState> {
  void _fd;
  const res = await userAction(async ({ auth, tx, ip, userAgent }) => {
    const internalNumber = await nextNumber(tx, "WQF");
    const founderName = auth.user.fullName ?? "";
    const [w] = await tx
      .insert(waqfs)
      .values({ internalNumber, name: `مسودة وقف — ${founderName || internalNumber}`, status: "idea", creationMode: "inter_vivos", stage: 1, founderAlive: true, createdBy: auth.user.id, updatedBy: auth.user.id })
      .returning({ id: waqfs.id });
    await tx.insert(waqfKeys).values({ waqfId: w.id, wrappedKey: newDataKey().wrapped });
    await tx.insert(waqfMemberships).values({ waqfId: w.id, userId: auth.user.id, roleKey: "founder", createdBy: auth.user.id });
    const [deed] = await tx.insert(waqfDeeds).values({ waqfId: w.id, status: "draft", currentVersion: 1, createdBy: auth.user.id }).returning({ id: waqfDeeds.id });
    await tx.insert(deedVersions).values({ deedId: deed.id, waqfId: w.id, version: 1, structured: emptyState(founderName) as unknown as Record<string, unknown>, changeNote: "مسودة معالج التأسيس", createdBy: auth.user.id });
    await tx.insert(waqfTimelineEvents).values({ waqfId: w.id, type: "establish", occurredOn: todayIso(), title: "بدء تأسيس وقف جديد في منصة وقفك", stage: 1, createdBy: auth.user.id });
    await audit(tx, { actorUserId: auth.user.id, action: "establish.started", entityType: "waqf", entityId: w.id, waqfId: w.id, ip, userAgent, after: { internalNumber } });
    return { ok: true, data: { id: w.id } };
  }, { revalidate: ["/app/establish", "/app/waqfs"] });
  if (res.ok && typeof res.data?.id === "string") redirect(`/app/establish/${res.data.id}?step=1`);
  return res;
}

// ───────────── Save a step ─────────────
type StepResult = { state: EstablishState; errors: Record<string, string> };

function applyStep(state: EstablishState, step: number, fd: FormData, temporaryAllowed: boolean): StepResult {
  const st: EstablishState = structuredClone(state);
  const e: Record<string, string> = {};
  if (step === 1) {
    const c = st.classification;
    c.beneficiaryKind = s(fd.get("beneficiaryKind"), 20);
    c.charitableQualifier = s(fd.get("charitableQualifier"), 5);
    c.thenToCharity = s(fd.get("thenToCharity"), 5);
    c.duration = temporaryAllowed && s(fd.get("duration")) === "temporary" ? "temporary" : "perpetual";
    c.durationYears = s(fd.get("durationYears"), 4);
    c.fieldOfWork = s(fd.get("fieldOfWork"), 120);
    c.geographicScope = s(fd.get("geographicScope"), 120);
    const t = classify(c);
    c.computedType = t.type;
    c.reason = t.reason;
    if (!["public", "private", "both"].includes(c.beneficiaryKind)) e.beneficiaryKind = "اختر على من تُصرف غلة الوقف.";
    if (c.duration === "temporary" && !(Number(c.durationYears) > 0)) e.durationYears = "حدّد مدة الوقف المؤقت بالسنوات.";
  } else if (step === 2) {
    const f = st.founder;
    f.name = s(fd.get("name"), 200);
    f.nationality = s(fd.get("nationality"), 60);
    f.isSelf = fd.get("isSelf") === "on" ? "on" : "off";
    f.powers = fd.getAll("powers").map((x) => s(x, 60)).filter(Boolean).slice(0, 6);
    f.selfBenefit = ["none", "usufruct", "yield"].includes(s(fd.get("selfBenefit"))) ? s(fd.get("selfBenefit")) : "none";
    f.selfBenefitNote = s(fd.get("selfBenefitNote"), 300);
    if (f.name.length < 3) e.name = "اكتب اسم الواقف كاملًا.";
  } else if (step === 3) {
    st.assets = readRows(fd, "a", ["category", "title", "ownershipDocNo", "value", "inFounderName", "sharePct"])
      .filter((r) => r.title || r.value || r.ownershipDocNo)
      .slice(0, 30)
      .map((r) => ({ category: r.category, title: r.title.slice(0, 200), ownershipDocNo: r.ownershipDocNo.slice(0, 80), value: normalizeNumber(r.value) ?? "", inFounderName: r.inFounderName === "on" ? "on" : "off", sharePct: normalizeNumber(r.sharePct) ?? "" }));
    if (!st.assets.length) e.assets = "أضف أصلًا واحدًا على الأقل تريد وقفه.";
    st.assets.forEach((a, i) => {
      if (!CATS.includes(a.category)) e[`assets.${i}`] = `اختر نوع الأصل ${i + 1}.`;
      else if (!a.title) e[`assets.${i}`] = `صف الأصل ${i + 1} بما يميزه.`;
      else if (a.value && !(Number(a.value) >= 0)) e[`assets.${i}`] = `قيمة الأصل ${i + 1} غير صحيحة.`;
      else if (a.sharePct && !(Number(a.sharePct) > 0 && Number(a.sharePct) <= 100)) e[`assets.${i}`] = `الحصة المشاعة للأصل ${i + 1} بين 1 و100.`;
    });
  } else if (step === 4) {
    st.classes = readRows(fd, "c", ["name", "kind", "tier", "relation", "sharePct", "divisionRule", "substitutionRule"])
      .filter((r) => r.name)
      .slice(0, 20)
      .map((r) => ({ name: r.name.slice(0, 200), kind: r.kind === "public" ? "public" : "private", tier: String(Math.max(1, Math.min(30, Number(r.tier) || 1))), relation: r.relation === "and" ? "and" : "then", sharePct: normalizeNumber(r.sharePct) ?? "", divisionRule: ["equal", "male_double"].includes(r.divisionRule) ? r.divisionRule : "", substitutionRule: ["tier_blocking", "branch_replaces"].includes(r.substitutionRule) ? r.substitutionRule : "" }));
    st.finalDestination = s(fd.get("finalDestination"), 300);
    st.conditions = readRows(fd, "k", ["category", "text"]).filter((r) => r.text).slice(0, 30).map((r) => ({ category: COND_CATS.includes(r.category) ? r.category : "masraf", text: r.text.slice(0, 1000) }));
    if (!st.classes.length) e.classes = "أضف مصرفًا واحدًا على الأقل.";
    const issue = tierShareIssues(st.classes.map((c) => ({ tier: Number(c.tier), relation: c.relation, sharePct: c.sharePct || null, name: c.name }))).find((x) => x.includes("يتجاوز"));
    if (issue) e.classes = issue;
    if (st.classification.beneficiaryKind !== "public" && !st.finalDestination) e.finalDestination = "حدّد جهة بر دائمة تؤول إليها الغلة إذا انقطع المستحقون.";
  } else if (step === 5) {
    const n = st.nazara;
    n.mode = ["founder", "individual", "board", "legal_entity"].includes(s(fd.get("mode"))) ? s(fd.get("mode")) : "";
    n.nazirName = s(fd.get("nazirName"), 500);
    n.boardSize = s(fd.get("boardSize"), 3);
    n.successionRule = s(fd.get("successionRule"), 500);
    n.feePct = normalizeNumber(s(fd.get("feePct"), 10)) ?? "";
    n.feeFixed = normalizeNumber(s(fd.get("feeFixed"), 20)) ?? "";
    n.duties = s(fd.get("duties"), 1500);
    if (!n.mode) e.mode = "اختر صيغة النظارة.";
    if (n.mode && n.mode !== "founder" && n.nazirName.length < 3) e.nazirName = "اكتب اسم الناظر أو أسماء أعضاء المجلس أو الجهة.";
    if (n.mode === "board" && !(Number(n.boardSize) >= 3)) e.boardSize = "مجلس النظارة ثلاثة أعضاء فأكثر.";
    if (n.feePct && !(Number(n.feePct) >= 0 && Number(n.feePct) <= 100)) e.feePct = "النسبة بين 0 و100.";
    if (!st.allocation.nazirFeePct && n.feePct) st.allocation.nazirFeePct = n.feePct;
  } else if (step === 6) {
    const a = st.allocation;
    for (const k of ["maintenancePct", "developmentPct", "reinvestPct", "reservePct", "nazirFeePct", "adminPct"] as const) {
      a[k] = normalizeNumber(s(fd.get(k), 10)) ?? "";
      if (a[k] && !(Number(a[k]) >= 0 && Number(a[k]) <= 100)) e[k] = "النسبة بين 0 و100.";
    }
    a.notes = s(fd.get("notes"), 1000);
    if (allocationTotal(a) > 100) e._ = `مجموع النسب ${allocationTotal(a)}% يتجاوز 100%.`;
  } else if (step === 7) {
    st.waqfName = s(fd.get("waqfName"), 200);
    if (st.waqfName.length < 5) e.waqfName = "اختر اسمًا للوقف (خمسة أحرف فأكثر).";
  }
  return { state: st, errors: e };
}

export async function saveEstablishStep(_: ActionState, fd: FormData): Promise<ActionState> {
  const draftId = String(fd.get("draftId") ?? "");
  const step = Number(fd.get("step"));
  const intent = String(fd.get("intent") ?? "next");
  if (!Number.isInteger(step) || step < 1 || step > ESTABLISH_STEPS.length) return { error: "خطوة غير معروفة." };
  let target = "";
  const res = await userAction(async ({ auth, tx, ip, userAgent }) => {
    const d = await loadDraft(tx, auth, draftId);
    if (d.state.finishedAt) throw new UserError("اعتُمدت هذه المسودة ونُقلت إلى ملف الوقف؛ عدّل من هناك.");
    const temporaryAllowed = await isFlagOn(tx, "waqf.temporary_waqf");
    const { state, errors } = applyStep(d.state, step, fd, temporaryAllowed);
    const advancing = intent === "next";
    const valid = !Object.keys(errors).length;
    state.step = advancing && valid ? Math.min(ESTABLISH_STEPS.length, step + 1) : intent === "back" ? Math.max(1, step - 1) : step;
    if (valid && !state.completed.includes(step)) state.completed = [...state.completed, step].sort((a, b) => a - b);
    if (!valid) state.completed = state.completed.filter((x) => x !== step);
    await tx.update(deedVersions).set({ structured: state as unknown as Record<string, unknown>, updatedBy: auth.user.id }).where(eq(deedVersions.id, d.versionId));
    const patch: Partial<typeof waqfs.$inferInsert> = { updatedBy: auth.user.id };
    if (step === 1 && state.classification.computedType) Object.assign(patch, { legalType: state.classification.computedType, computedType: state.classification.computedType, computedTypeReason: state.classification.reason, fieldOfWork: state.classification.fieldOfWork || null, geographicScope: state.classification.geographicScope || null });
    if (step === 7 && state.waqfName.length >= 5) patch.name = state.waqfName;
    await tx.update(waqfs).set(patch).where(eq(waqfs.id, d.waqf.id));
    await audit(tx, { actorUserId: auth.user.id, action: "establish.step_saved", entityType: "waqf", entityId: d.waqf.id, waqfId: d.waqf.id, ip, userAgent, after: { step, intent, valid } });
    if (advancing && !valid) {
      const first = Object.values(errors)[0];
      return { error: Object.keys(errors).length > 1 ? `${first} (و${Object.keys(errors).length - 1} ملاحظة أخرى)` : first, fieldErrors: errors };
    }
    target = intent === "save" ? `/app/establish?saved=${d.waqf.id}` : `/app/establish/${d.waqf.id}?step=${state.step}`;
    return { ok: true, message: "حُفظت المسودة." };
  }, { revalidate: ["/app/establish", `/app/establish/${draftId}`] });
  if (res.ok && target) redirect(target);
  return res;
}

// ───────────── Finish: materialize the waqf file ─────────────
export async function finishEstablish(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(z.object({ draftId: z.uuid() }), fd);
  if ("state" in r) return r.state;
  const draftId = r.data.draftId;
  const res = await userAction(async ({ auth, tx, ip, userAgent }) => {
    const d = await loadDraft(tx, auth, draftId);
    const st = d.state;
    if (st.finishedAt) throw new UserError("اعتُمدت المسودة مسبقًا.");
    const missing = missingItems(st);
    if (missing.length) return { error: `أكمل قبل الاعتماد: ${missing.map((m) => m.text).join(" ")}` };
    const w = d.waqf;
    const uid = auth.user.id;
    const t = todayIso();
    const type = classify(st.classification);
    const total = st.assets.reduce((sum, a) => sum + (Number(a.value) || 0), 0);
    const sizeClass = total > 0 ? suggestSizeClass(total, false) : null;
    const nazirMode = st.nazara.mode as "founder" | "individual" | "board" | "legal_entity";

    await tx.update(waqfs).set({
      name: st.waqfName, status: "draft", legalType: type.type, computedType: type.type, computedTypeReason: type.reason, nazirMode, sizeClass,
      assetsEstimatedValue: total ? total.toFixed(2) : null, fieldOfWork: st.classification.fieldOfWork || null, geographicScope: st.classification.geographicScope || null,
      founderAlive: true, updatedBy: uid,
    }).where(eq(waqfs.id, w.id));
    if (type.type) await tx.insert(waqfClassifications).values({ waqfId: w.id, legalType: type.type, computedType: type.type, reason: type.reason, effectiveFrom: t, decidedBy: uid });
    const powers = { canInterpret: st.founder.powers.includes("تفسير شروطه"), canAmendNazara: st.founder.powers.includes("تعديل النظارة"), canDismissNazir: st.founder.powers.includes("عزل الناظر"), canAddAssets: st.founder.powers.includes("إضافة أصول إلى الوقف") };
    await tx.insert(founders).values({ waqfId: w.id, displayName: st.founder.name, nationality: st.founder.nationality || null, isAlive: true, powers, userId: st.founder.isSelf === "on" ? uid : null, createdBy: uid });
    if (st.assets.length)
      await tx.insert(assets).values(st.assets.map((a) => ({
        waqfId: w.id, category: a.category as (typeof assets.$inferInsert)["category"], title: a.title, ownershipDocNo: a.ownershipDocNo || null,
        marketValue: a.value ? Number(a.value).toFixed(2) : null, sharePct: a.sharePct ? Number(a.sharePct).toFixed(2) : null, inWaqfName: false,
        status: "income" as const, notes: a.inFounderName === "on" ? "مستند الملكية باسم الواقف (قبل الوقف)" : "يلزم إثبات ملكية الواقف قبل التوثيق", createdBy: uid,
      })));
    const classRows = st.classes.map((c, i) => ({
      waqfId: w.id, name: c.name, kind: c.kind, tier: Number(c.tier) || 1, position: i, relation: c.relation, sharePct: c.sharePct ? Number(c.sharePct).toFixed(2) : null,
      divisionRule: c.divisionRule || null, substitutionRule: c.substitutionRule || null, isFinalDestination: false, createdBy: uid,
    }));
    if (st.finalDestination) {
      const maxTier = Math.max(1, ...classRows.map((c) => c.tier));
      classRows.push({ waqfId: w.id, name: st.finalDestination, kind: "public", tier: maxTier + 1, position: classRows.length, relation: "then", sharePct: null, divisionRule: null, substitutionRule: null, isFinalDestination: true, createdBy: uid });
    }
    if (classRows.length) await tx.insert(beneficiaryClasses).values(classRows);
    if (st.conditions.length)
      await tx.insert(conditions).values(st.conditions.map((c, i) => ({ waqfId: w.id, category: c.category as (typeof conditions.$inferInsert)["category"], literalText: c.text, position: i + 1, createdBy: uid })));
    if (st.founder.selfBenefit !== "none")
      await tx.insert(waqfExceptions).values({ waqfId: w.id, beneficiaryName: st.founder.name, kind: st.founder.selfBenefit === "usufruct" ? "usufruct" : "yield", duration: "life", afterwards: "يعود إلى مصارف الوقف", quantity: st.founder.selfBenefitNote || null, createdBy: uid });
    const a = st.allocation;
    const pct = (v: string) => (v ? Number(v).toFixed(2) : null);
    await tx.insert(revenueAllocations).values({
      waqfId: w.id, maintenancePct: pct(a.maintenancePct), developmentPct: pct(a.developmentPct), reinvestPct: pct(a.reinvestPct), reservePct: pct(a.reservePct),
      nazirFeePct: pct(a.nazirFeePct || st.nazara.feePct), nazirFeeFixed: st.nazara.feeFixed ? Number(st.nazara.feeFixed).toFixed(2) : null, adminPct: pct(a.adminPct), notes: a.notes || null, createdBy: uid,
    }).onConflictDoNothing();
    const nazirName = nazirMode === "founder" ? st.founder.name : st.nazara.nazirName;
    await tx.insert(trustees).values({ waqfId: w.id, kind: nazirMode === "founder" ? "founder" : nazirMode === "board" ? "board_member" : nazirMode, displayName: nazirName, userId: nazirMode === "founder" && st.founder.isSelf === "on" ? uid : null, status: "active", createdBy: uid });
    if (st.nazara.successionRule) await tx.insert(successions).values({ waqfId: w.id, ruleText: st.nazara.successionRule, position: 1, createdBy: uid });
    if (nazirMode === "founder" && st.founder.isSelf === "on") {
      const [has] = await tx.select({ id: waqfMemberships.id }).from(waqfMemberships).where(and(eq(waqfMemberships.waqfId, w.id), eq(waqfMemberships.userId, uid), eq(waqfMemberships.roleKey, "nazir"))).limit(1);
      if (!has) await tx.insert(waqfMemberships).values({ waqfId: w.id, userId: uid, roleKey: "nazir", createdBy: uid });
    }
    const text = buildDeedDraft(st, t);
    const finished = { ...st, finishedAt: new Date().toISOString(), deedText: text };
    await tx.update(deedVersions).set({ body: text, structured: finished as unknown as Record<string, unknown>, changeNote: "مسودة استرشادية مولّدة من معالج التأسيس — تتطلب مراجعة قانونية وشرعية", updatedBy: uid }).where(eq(deedVersions.id, d.versionId));
    await tx.insert(waqfTimelineEvents).values({ waqfId: w.id, type: "establish", occurredOn: t, title: "إعداد مسودة وثيقة الوقف", details: "مسودة استرشادية تتطلب مراجعة قانونية وشرعية قبل التوثيق.", stage: 1, createdBy: uid });
    await audit(tx, { actorUserId: uid, action: "establish.finished", entityType: "waqf", entityId: w.id, waqfId: w.id, ip, userAgent, after: { name: st.waqfName, legalType: type.type, nazirMode, sizeClass, assets: st.assets.length, classes: classRows.length, conditions: st.conditions.length } });
    await syncWaqfObligations(tx, w.id);
    return { ok: true };
  }, { revalidate: ["/app/establish", `/app/establish/${draftId}`, "/app/waqfs", "/app"] });
  if (res.ok) redirect(`/app/establish/${draftId}?step=7&done=1`);
  return res;
}

export async function discardEstablishDraft(_: ActionState, fd: FormData): Promise<ActionState> {
  const draftId = String(fd.get("draftId") ?? "");
  const res = await userAction(async ({ auth, tx, ip, userAgent }) => {
    const d = await loadDraft(tx, auth, draftId);
    if (d.state.finishedAt) throw new UserError("المسودة المعتمدة لا تُحذف من هنا.");
    // Regulated records are archived, not deleted: the draft leaves the list and its membership ends.
    await tx.update(waqfs).set({ status: "ended", archivedAt: new Date(), archiveReason: "مسودة تأسيس ألغاها صاحبها", updatedBy: auth.user.id }).where(eq(waqfs.id, d.waqf.id));
    await audit(tx, { actorUserId: auth.user.id, action: "establish.discarded", entityType: "waqf", entityId: d.waqf.id, waqfId: d.waqf.id, ip, userAgent });
    return { ok: true, message: "أُلغيت المسودة." };
  }, { revalidate: ["/app/establish", "/app/waqfs"] });
  if (res.ok) redirect("/app/establish");
  return res;
}
