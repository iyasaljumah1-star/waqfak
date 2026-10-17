import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import type { Tx } from "@/server/db";
import {
  assets, beneficialOwners, beneficiaryClasses, budgets, conditions, distributions, documents, financialStatements, ledgerEntries,
  outputs, performanceReviews, serviceRequests, services, trustees, waqfs,
} from "@/server/db/schema";
import { addDays, todayISO } from "@/server/engines/dates";
import { fmtNumber, fmtSAR, NAZIR_MODE_LABEL, SIZE_LABEL, STATUS_LABEL, TYPE_LABEL } from "@/lib/utils";
import { assetGaps, ASSET_TYPES, isAssetCategory } from "@/server/modules/assets/types";
import { DOC_TYPE_LABEL } from "@/server/modules/documents/labels";
import { governanceReport } from "@/server/modules/governance/report";
import { MEETING_STATUS_AR, RESOLUTION_STATUS_AR } from "@/server/modules/governance/pure";
import { blockStatus, CONTEXT_TITLE_AR, type ContextBlock, type ContextKey, type ContextParams, type ContextRow } from "./types";

/**
 * Reads the waqf-file context blocks a service needs, from their sources of record, for the request's period. Runs in
 * the caller's database context, so row-level security limits it to what the viewer may read. Nothing is estimated:
 * a block with no records is «missing» and says what is needed.
 */
export async function resolveContext(tx: Tx, waqfId: string, keys: ContextKey[], p: ContextParams, opts: { serviceCode?: string; requestId?: string } = {}): Promise<ContextBlock[]> {
  if (!keys.length) return [];
  const [w] = await tx.select().from(waqfs).where(eq(waqfs.id, waqfId)).limit(1);
  if (!w) return [];
  const today = todayISO();
  const needGov = keys.some((k) => k.startsWith("board.") || k.startsWith("governance.") || k === "compliance.obligations" || k === "risks.register");
  const gov = needGov ? await governanceReport(tx, waqfId, p.from, p.to) : null;
  const out: ContextBlock[] = [];
  for (const key of keys) {
    const b = await one(tx, key, w, gov, p, today, opts);
    if (b) out.push(b);
  }
  return out;
}

type Gov = NonNullable<Awaited<ReturnType<typeof governanceReport>>>;
type W = typeof waqfs.$inferSelect;
const d = (x: string | Date | null | undefined) => (x ? String(x instanceof Date ? x.toISOString() : x).slice(0, 10) : null);
const latest = (...xs: (string | Date | null | undefined)[]) => xs.map((x) => (x ? (x instanceof Date ? x.toISOString() : String(x)) : "")).filter(Boolean).sort().at(-1) ?? null;
const n = (x: number) => fmtNumber(x);
const sar = (x: number) => fmtSAR(Math.round(x));

function make(key: ContextKey, source: string, path: string | null, present: boolean, rows: ContextRow[], gaps: string[], facts: ContextBlock["facts"], asOf: string | null, table?: ContextBlock["table"]): ContextBlock {
  const fingerprint = createHash("sha256").update(JSON.stringify({ rows: rows.map((r) => [r.label, r.value]), table })).digest("hex").slice(0, 32);
  return { key, title: CONTEXT_TITLE_AR[key], source, path, asOf, status: blockStatus(present, rows, gaps), rows, table, gaps, facts, fingerprint };
}

async function one(tx: Tx, key: ContextKey, w: W, gov: Gov | null, p: ContextParams, today: string, opts: { serviceCode?: string; requestId?: string }): Promise<ContextBlock | null> {
  switch (key) {
    case "waqf.identity": {
      const expired = !!w.registrationExpiresOn && w.registrationExpiresOn < today;
      const rows: ContextRow[] = [
        { label: "اسم الوقف", value: w.name },
        { label: "حالة الوقف", value: STATUS_LABEL[w.status] ?? w.status },
        { label: "نوع الوقف", value: w.legalType ? TYPE_LABEL[w.legalType] ?? w.legalType : "غير مسجل", status: w.legalType ? "ok" : "missing" },
        { label: "حجم الوقف", value: w.sizeClass ? SIZE_LABEL[w.sizeClass] ?? w.sizeClass : "غير مسجل", status: w.sizeClass ? "ok" : "missing" },
        { label: "رقم الصك وتاريخه", value: w.deedNo ? `${w.deedNo}${w.deedDate ? ` — ${w.deedDate}` : ""}` : "غير مسجل", status: w.deedNo ? "ok" : "missing" },
        { label: "التسجيل لدى الهيئة", value: w.registeredOn ? `${w.registrationCertNo ?? "بلا رقم شهادة"} — ${w.registeredOn}` : "غير مسجل", status: w.registeredOn ? "ok" : "missing" },
        { label: "انتهاء شهادة التسجيل", value: w.registrationExpiresOn ?? "غير مسجل", status: expired ? "stale" : w.registrationExpiresOn ? "ok" : w.registeredOn ? "missing" : undefined },
        { label: "الرقم الوطني الموحد", value: w.nationalUnifiedNumber ?? "غير مسجل", status: w.nationalUnifiedNumber ? "ok" : w.registeredOn ? "missing" : undefined },
        { label: "نهاية السنة المالية", value: w.fiscalYearEnd ?? "غير مسجلة", status: w.fiscalYearEnd ? "ok" : "missing" },
      ];
      const gaps = [
        ...(expired ? [`انتهت شهادة التسجيل في ${w.registrationExpiresOn}`] : []),
        ...(!w.deedNo ? ["رقم صك الوقف غير مسجل في الملف"] : []),
        ...(!w.sizeClass ? ["حجم الوقف غير محدد"] : []),
      ];
      return make(key, "ملف الوقف — الهوية والتسجيل", "?edit=1#profile", true, rows, gaps,
        { status: w.status, sizeClass: w.sizeClass, legalType: w.legalType, registered: !!w.registeredOn, registrationExpired: expired, nazirMode: w.nazirMode, fiscalYearEnd: w.fiscalYearEnd },
        latest(w.updatedAt, w.registeredOn, w.documentedOn));
    }
    case "waqf.terms": {
      const [conds, classes] = await Promise.all([
        tx.select({ category: conditions.category, text: conditions.literalText, review: conditions.shariaReview }).from(conditions).where(eq(conditions.waqfId, w.id)).orderBy(conditions.position),
        tx.select({ name: beneficiaryClasses.name, tier: beneficiaryClasses.tier, share: beneficiaryClasses.sharePct, final: beneficiaryClasses.isFinalDestination }).from(beneficiaryClasses).where(eq(beneficiaryClasses.waqfId, w.id)).orderBy(beneficiaryClasses.tier, beneficiaryClasses.position),
      ]);
      const unreviewed = conds.filter((c) => c.review === "not_reviewed").length;
      const rows: ContextRow[] = [
        { label: "شروط الواقف المسجلة", value: conds.length ? `${n(conds.length)} شرطًا` : "لا شروط مسجلة", status: conds.length ? "ok" : "missing" },
        { label: "المصارف (فئات المستحقين)", value: classes.length ? classes.map((c) => `${c.name}${c.share ? ` (${c.share}٪)` : ""}`).join("، ") : "لا مصارف مسجلة", status: classes.length ? "ok" : "missing" },
        { label: "المآل عند انقطاع المصارف", value: classes.find((c) => c.final)?.name ?? "غير مسجل", status: classes.some((c) => c.final) ? "ok" : "warn" },
        { label: "شروط لم تُراجع شرعيًا", value: n(unreviewed), status: unreviewed ? "warn" : "ok" },
      ];
      const gaps = [...(!conds.length ? ["لم تُسجل شروط الواقف في الملف"] : []), ...(!classes.length ? ["لم تُسجل المصارف في الملف"] : [])];
      return make(key, "ملف الوقف — الوثيقة والشروط والمستفيدون", "/deed#conditions", conds.length + classes.length > 0, rows, gaps,
        { conditions: conds.length, classes: classes.length, unreviewedConditions: unreviewed, hasFinalDestination: classes.some((c) => c.final) }, null,
        conds.length ? { columns: ["الفئة", "نص الشرط"], rows: conds.slice(0, 20).map((c) => [c.category, c.text.length > 160 ? `${c.text.slice(0, 160)}…` : c.text]) } : undefined);
    }
    case "waqf.nazara": {
      const ts = await tx.select({ name: trustees.displayName, kind: trustees.kind, chair: trustees.isChair, independent: trustees.isIndependent, licenseExpiresOn: trustees.licenseExpiresOn, startsOn: trustees.startsOn, endsOn: trustees.endsOn, status: trustees.status, updatedAt: trustees.updatedAt })
        .from(trustees).where(and(eq(trustees.waqfId, w.id), eq(trustees.status, "active")));
      const expiredLicense = ts.filter((t) => t.licenseExpiresOn && t.licenseExpiresOn < today);
      const rows: ContextRow[] = [
        { label: "صيغة النظارة", value: w.nazirMode ? NAZIR_MODE_LABEL[w.nazirMode] ?? w.nazirMode : "غير محددة", status: w.nazirMode && w.nazirMode !== "vacant" ? "ok" : "missing" },
        ...ts.map((t) => ({ label: t.chair ? "الناظر / الرئيس" : "ناظر", value: `${t.name}${t.startsOn ? ` — منذ ${t.startsOn}` : ""}${t.endsOn ? ` حتى ${t.endsOn}` : ""}`, status: (t.licenseExpiresOn && t.licenseExpiresOn < today ? "stale" : "ok") as ContextRow["status"] })),
      ];
      const gaps = [...(!ts.length ? ["لا ناظر مسجل في ملف الوقف"] : []), ...expiredLicense.map((t) => `انتهى ترخيص ${t.name} في ${t.licenseExpiresOn}`)];
      return make(key, "ملف الوقف — الأطراف والنظارة", "/parties#trustees", ts.length > 0, rows, gaps,
        { trustees: ts.length, nazirMode: w.nazirMode, expiredLicenses: expiredLicense.length }, latest(...ts.map((t) => t.updatedAt)));
    }
    case "board.composition": {
      const b = gov!.board;
      const ending = b.members.filter((m) => m.endsOn && m.endsOn <= addDays(today, 60));
      const rows: ContextRow[] = [
        { label: "الأعضاء القائمون", value: n(b.members.length), status: b.members.length >= 3 ? "ok" : b.members.length ? "warn" : "missing" },
        { label: "المستقلون", value: n(b.independent), status: b.members.length && !b.independent ? "warn" : "ok" },
        { label: "أصحاب حق التصويت", value: n(b.voting) },
        { label: "رئيس المجلس", value: b.members.find((m) => m.role === "chair")?.name ?? "غير محدد", status: b.members.some((m) => m.role === "chair") ? "ok" : b.members.length ? "missing" : undefined },
        { label: "بلا حساب في المنصة", value: n(b.withoutAccount), status: b.withoutAccount ? "warn" : "ok" },
        ...(ending.length ? [{ label: "عضويات تنتهي خلال 60 يومًا", value: ending.map((m) => `${m.name} (${m.endsOn})`).join("، "), status: "stale" as const }] : []),
      ];
      const gaps = [
        ...(!b.members.length ? ["لا أعضاء مسجلون في مجلس النظارة"] : []),
        ...(b.members.length && b.members.length < 3 ? [`أعضاء المجلس المسجلون ${n(b.members.length)} فقط`] : []),
        ...(b.members.length && !b.members.some((m) => m.role === "chair") ? ["لم يُحدد رئيس المجلس"] : []),
        ...b.members.filter((m) => !m.capacity).slice(0, 5).map((m) => `صفة العضو ${m.name} غير مسجلة`),
      ];
      return make(key, "سجل مجلس النظارة في ملف الوقف", "/parties#bodies", b.members.length > 0, rows, gaps,
        { members: b.members.length, independent: b.independent, voting: b.voting, withoutAccount: b.withoutAccount, ended: b.ended, endingSoon: ending.length, hasChair: b.members.some((m) => m.role === "chair") }, null,
        b.members.length ? { columns: ["العضو", "الدور", "الصفة", "مستقل", "المدة"], rows: b.members.map((m) => [m.name, roleAr(m.role), m.capacity ?? "—", m.independent ? "نعم" : "لا", `${m.startsOn ?? "—"} — ${m.endsOn ?? "مفتوحة"}`]) } : undefined);
    }
    case "governance.rules": {
      const r = gov!.rules;
      const rows: ContextRow[] = r ? [
        { label: "النصاب", value: QUORUM_AR[r.quorumRule] ?? r.quorumRule },
        { label: "آلية التصويت", value: MAJORITY_AR[r.majorityRule] ?? r.majorityRule },
        { label: "الاجتماعات المستهدفة سنويًا", value: n(r.meetingsPerYear) },
        { label: "صلاحيات التوقيع", value: r.signingRules ? "مسجلة" : "غير مسجلة", status: r.signingRules ? "ok" : "warn" },
        { label: "حدود التفويض", value: r.delegationLimits ? "مسجلة" : "غير مسجلة", status: r.delegationLimits ? "ok" : "warn" },
        { label: "المصدر", value: r.source ?? "غير مذكور", status: r.source ? "ok" : "missing" },
      ] : [];
      const gaps = !r ? ["لم تُسجل قواعد الإدارة والصلاحيات"] : !r.source ? ["قواعد الإدارة مسجلة بلا مصدر (وثيقة أو لائحة أو قرار)"] : [];
      return make(key, "الحوكمة — الصلاحيات وآلية الإدارة", "/governance#rules", !!r, rows, gaps,
        { meetingsPerYear: r?.meetingsPerYear ?? null, hasSource: !!r?.source, hasSigning: !!r?.signingRules }, r ? latest(r.updatedAt) : null);
    }
    case "board.meetings": {
      const m = gov!.meetings;
      const held = m.held;
      const target = m.perYearTarget;
      const rows: ContextRow[] = [
        { label: "الفترة", value: `${p.from} — ${p.to}` },
        { label: "اجتماعات منعقدة", value: n(held), status: target != null && held < target ? "warn" : held ? "ok" : "missing" },
        { label: "المستهدف سنويًا", value: target != null ? n(target) : "غير محدد" },
        { label: "محاضر مقفلة بالتوقيع", value: `${n(m.lockedMinutes)} من ${n(held)}`, status: held && m.lockedMinutes < held ? "warn" : "ok" },
        { label: "ملغاة / مجدولة", value: `${n(m.cancelled)} / ${n(m.scheduled)}` },
      ];
      const noQuorum = m.list.filter((x) => x.status === "held" && !x.quorumMet).length;
      const gaps = [
        ...(!m.list.length ? ["لا اجتماعات مسجلة في الفترة"] : []),
        ...(held && m.lockedMinutes < held ? [`${n(held - m.lockedMinutes)} اجتماعًا منعقدًا بلا محضر مقفل بالتوقيع`] : []),
        ...(target != null && held < target ? [`عُقد ${n(held)} من ${n(target)} اجتماعات مستهدفة`] : []),
      ];
      return make(key, "سجل الاجتماعات والمحاضر", "/governance#meetings", m.list.length > 0, rows, gaps,
        { held, target, lockedMinutes: m.lockedMinutes, cancelled: m.cancelled, scheduled: m.scheduled, noQuorum }, latest(...m.list.map((x) => x.at)),
        m.list.length ? { columns: ["الاجتماع", "الموعد", "الحالة", "النصاب", "المحضر"], rows: m.list.slice(0, 20).map((x) => [x.title, d(x.at) ?? "—", MEETING_STATUS_AR[x.status] ?? x.status, x.status === "held" ? (x.quorumMet ? "مكتمل" : "غير مكتمل") : "—", x.minutes === "locked" ? "مقفل" : x.minutes ? "لم يُقفل" : "لا محضر"]) } : undefined);
    }
    case "board.resolutions": {
      const rs = gov!.resolutions;
      const tasks = rs.flatMap((r) => r.tasks);
      const overdue = rs.reduce((s, r) => s + r.overdue, 0);
      const done = rs.reduce((s, r) => s + r.done, 0);
      const approvedNoTask = rs.filter((r) => r.status === "approved" && !r.tasks.length).length;
      const rows: ContextRow[] = [
        { label: "قرارات الفترة", value: n(rs.length), status: rs.length ? "ok" : "missing" },
        { label: "مهام التنفيذ", value: `${n(done)} منجزة من ${n(tasks.length)}` },
        { label: "مهام متأخرة", value: n(overdue), status: overdue ? "warn" : "ok" },
        { label: "قرارات معتمدة بلا مهمة تنفيذ", value: n(approvedNoTask), status: approvedNoTask ? "warn" : "ok" },
      ];
      const gaps = [...(!rs.length ? ["لا قرارات مسجلة في الفترة"] : []), ...(overdue ? [`${n(overdue)} مهمة تنفيذ متأخرة`] : []), ...(approvedNoTask ? [`${n(approvedNoTask)} قرارًا معتمدًا بلا مهمة تنفيذ مسندة`] : [])];
      return make(key, "سجل القرارات ومهام تنفيذها", "/governance#resolutions", rs.length > 0, rows, gaps,
        { resolutions: rs.length, tasks: tasks.length, done, overdue, approvedNoTask }, latest(...rs.map((r) => r.decidedAt)),
        rs.length ? { columns: ["القرار", "الحالة", "التنفيذ"], rows: rs.slice(0, 20).map((r) => [`${r.number} — ${r.text.length > 90 ? `${r.text.slice(0, 90)}…` : r.text}`, RESOLUTION_STATUS_AR[r.status] ?? r.status, r.tasks.length ? `${r.done}/${r.tasks.length}${r.overdue ? ` (${r.overdue} متأخرة)` : ""}` : "—"]) } : undefined);
    }
    case "governance.policies": {
      const ps = gov!.policies;
      const approved = ps.filter((x) => x.status === "approved");
      const overdue = ps.filter((x) => x.reviewOverdue);
      const rows: ContextRow[] = ps.map((x) => ({ label: x.label, value: x.status === "approved" ? `معتمدة${x.approvedOn ? ` ${x.approvedOn}` : ""}` : x.status === "missing" ? "غير موجودة" : x.status === "draft" ? "مسودة" : x.status, status: x.reviewOverdue ? "stale" : x.status === "approved" ? "ok" : "missing" }));
      const gaps = [...(overdue.length ? [`فات موعد مراجعة: ${overdue.map((x) => x.label).join("، ")}`] : [])];
      return make(key, "الحوكمة — اللوائح والسياسات", "/governance#policies", approved.length > 0, rows, gaps,
        { approved: approved.length, total: ps.length, reviewOverdue: overdue.length }, null);
    }
    case "governance.evaluations": {
      const rv = await tx.select({ subjectType: performanceReviews.subjectType, subject: performanceReviews.subjectName, year: performanceReviews.year, score: performanceReviews.score, updatedAt: performanceReviews.updatedAt })
        .from(performanceReviews).where(eq(performanceReviews.waqfId, w.id)).orderBy(desc(performanceReviews.year)).limit(20);
      const rows: ContextRow[] = rv.length ? [{ label: "آخر تقييم", value: `${rv[0].year} — ${rv[0].subject}` }, { label: "عدد التقييمات المسجلة", value: n(rv.length) }] : [];
      return make(key, "الحوكمة — تقييمات الأداء", "/governance#reviews", rv.length > 0, rows, rv.length ? [] : ["لا تقييمات أداء سابقة مسجلة"],
        { evaluations: rv.length, lastYear: rv[0]?.year ?? null }, latest(...rv.map((x) => x.updatedAt)),
        rv.length ? { columns: ["السنة", "المُقيَّم", "الدرجة"], rows: rv.map((x) => [String(x.year), `${x.subject} (${SUBJ_AR[x.subjectType] ?? x.subjectType})`, x.score ?? "—"]) } : undefined);
    }
    case "assets.register": {
      const as = await tx.select().from(assets).where(and(eq(assets.waqfId, w.id), isNull(assets.archivedAt)));
      const yearAgo = addDays(today, -365);
      const stale = as.filter((a) => a.marketValue != null && (!a.lastValuationOn || a.lastValuationOn < yearAgo));
      const incomplete = as.filter((a) => assetGaps({ ...a, details: (a.details ?? {}) as Record<string, string> }).length);
      const total = as.reduce((s, a) => s + (a.marketValue == null ? 0 : Number(a.marketValue)), 0);
      const income = as.reduce((s, a) => s + (a.annualIncome == null ? 0 : Number(a.annualIncome)), 0);
      const rows: ContextRow[] = [
        { label: "عدد الأصول", value: n(as.length), status: as.length ? "ok" : "missing" },
        { label: "القيمة المسجلة", value: as.some((a) => a.marketValue != null) ? sar(total) : "لا قيم مسجلة", status: as.some((a) => a.marketValue != null) ? "ok" : "warn" },
        { label: "الدخل السنوي المسجل", value: as.some((a) => a.annualIncome != null) ? sar(income) : "غير مسجل", status: as.some((a) => a.annualIncome != null) ? "ok" : "warn" },
        { label: "أصول بلا تقييم خلال 12 شهرًا", value: n(stale.length), status: stale.length ? "stale" : "ok" },
        { label: "أصول بيانات نوعها ناقصة", value: n(incomplete.length), status: incomplete.length ? "warn" : "ok" },
      ];
      const gaps = [...(!as.length ? ["لا أصول مسجلة في ملف الوقف"] : []), ...(stale.length ? [`${n(stale.length)} أصلًا قيمته أقدم من 12 شهرًا`] : []), ...(incomplete.length ? [`${n(incomplete.length)} أصلًا بيانات نوعه ناقصة`] : [])];
      return make(key, "سجل الأصول في ملف الوقف", "/assets", as.length > 0, rows, gaps,
        { assets: as.length, valued: as.filter((a) => a.marketValue != null).length, totalValue: total, annualIncome: income, staleValuations: stale.length, incomplete: incomplete.length, realEstate: as.filter((a) => a.category === "real_estate").length }, latest(...as.map((a) => a.updatedAt)),
        as.length ? { columns: ["الأصل", "النوع", "القيمة المسجلة", "آخر تقييم"], rows: as.slice(0, 30).map((a) => [a.title, isAssetCategory(a.category) ? ASSET_TYPES[a.category].label : a.category, a.marketValue != null ? sar(Number(a.marketValue)) : "—", a.lastValuationOn ?? "—"]) } : undefined);
    }
    case "finance.records": {
      const year = p.year ?? Number(p.to.slice(0, 4));
      const [bud, stmts, led, dist, docs] = await Promise.all([
        tx.select({ year: budgets.fiscalYear, status: budgets.status, revenue: budgets.totalRevenue, expense: budgets.totalExpense, updatedAt: budgets.updatedAt }).from(budgets).where(eq(budgets.waqfId, w.id)).orderBy(desc(budgets.fiscalYear)).limit(5),
        tx.select({ year: financialStatements.fiscalYear, kind: financialStatements.kind, status: financialStatements.status, revenue: financialStatements.totalRevenue, expense: financialStatements.totalExpense, auditor: financialStatements.auditorName, submitted: financialStatements.submittedToGaaOn, updatedAt: financialStatements.updatedAt }).from(financialStatements).where(eq(financialStatements.waqfId, w.id)).orderBy(desc(financialStatements.fiscalYear)).limit(5),
        tx.select({ entries: sql<number>`count(*)::int`, debit: sql<string>`coalesce(sum(${ledgerEntries.debit}),0)::text`, credit: sql<string>`coalesce(sum(${ledgerEntries.credit}),0)::text`, last: sql<string | null>`max(${ledgerEntries.entryDate})::text` }).from(ledgerEntries).where(and(eq(ledgerEntries.waqfId, w.id), gte(ledgerEntries.entryDate, p.from), lte(ledgerEntries.entryDate, p.to))),
        tx.select({ count: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(${distributions.totalAmount}),0)::text` }).from(distributions).where(and(eq(distributions.waqfId, w.id), ne(distributions.status, "planned"), gte(distributions.dueBy, p.from), lte(distributions.dueBy, p.to))),
        tx.select({ type: documents.docType, issuedOn: documents.issuedOn, title: documents.title }).from(documents).where(and(eq(documents.waqfId, w.id), isNull(documents.archivedAt), inArray(documents.docType, ["financial_statement", "bank_statement"]))).orderBy(desc(documents.issuedOn)),
      ]);
      const b = bud.find((x) => x.year === year);
      const s = stmts.find((x) => x.year === year) ?? stmts.find((x) => x.year === year - 1);
      const bankInPeriod = docs.filter((x) => x.type === "bank_statement" && x.issuedOn && x.issuedOn >= p.from && x.issuedOn <= addDays(p.to, 60));
      const l = led[0];
      const rows: ContextRow[] = [
        { label: `موازنة ${year}`, value: b ? `${b.status === "approved" ? "معتمدة" : "مسودة"}${b.revenue ? ` — إيرادات ${sar(Number(b.revenue))}` : ""}${b.expense ? `، مصروفات ${sar(Number(b.expense))}` : ""}` : "غير مسجلة", status: b ? (b.status === "approved" ? "ok" : "warn") : "missing" },
        { label: "آخر قوائم أو بيان مالي", value: s ? `${s.year} — ${s.kind === "audited" ? "مدققة" : "بيان مبسط"} (${s.status === "final" ? "نهائية" : s.status === "submitted" ? "مرفوعة للهيئة" : "مسودة"})` : "غير مسجلة", status: s ? (s.year >= year - 1 ? "ok" : "stale") : "missing" },
        { label: "القيود المحاسبية في الفترة", value: l?.entries ? `${n(l.entries)} قيدًا — مدين ${sar(Number(l.debit))}، دائن ${sar(Number(l.credit))}` : "لا قيود مسجلة", status: l?.entries ? "ok" : "missing" },
        { label: "الصرف للمستحقين في الفترة", value: dist[0]?.count ? `${n(dist[0].count)} دفعة — ${sar(Number(dist[0].total))}` : "لا صرف مسجل", status: dist[0]?.count ? "ok" : "warn" },
        { label: "كشوف الحساب البنكي في الفترة", value: n(bankInPeriod.length), status: bankInPeriod.length ? "ok" : "missing" },
      ];
      const gaps = [
        ...(!b ? [`لا موازنة مسجلة لسنة ${year}`] : []),
        ...(!s ? ["لا قوائم أو بيان مالي مسجل"] : s.year < year - 1 ? [`آخر قوائم مالية لسنة ${s.year}`] : []),
        ...(!l?.entries ? ["لا قيود محاسبية مسجلة في الفترة"] : []),
        ...(!bankInPeriod.length ? ["لا كشوف حساب بنكي مرفوعة للفترة"] : []),
      ];
      return make(key, "المالية والصرف في ملف الوقف", "/finance", !!(b || s || l?.entries || dist[0]?.count || docs.length), rows, gaps,
        { year, budget: b ? b.status : null, statementYear: s?.year ?? null, statementKind: s?.kind ?? null, ledgerEntries: l?.entries ?? 0, distributions: dist[0]?.count ?? 0, distributed: Number(dist[0]?.total ?? 0), bankStatements: bankInPeriod.length, lastEntry: l?.last ?? null },
        latest(b?.updatedAt, s?.updatedAt, l?.last));
    }
    case "beneficiaries.register": {
      const [cls, bo] = await Promise.all([
        tx.select({ c: sql<number>`count(*)::int` }).from(beneficiaryClasses).where(eq(beneficiaryClasses.waqfId, w.id)),
        tx.select({ c: sql<number>`count(*)::int`, lastVerified: sql<string | null>`max(${beneficialOwners.verifiedOn})::text`, overdue: sql<number>`count(*) filter (where ${beneficialOwners.nextVerificationDue} < ${today})::int` }).from(beneficialOwners).where(eq(beneficialOwners.waqfId, w.id)),
      ]);
      const c = cls[0]?.c ?? 0;
      const b = bo[0];
      const rows: ContextRow[] = [
        { label: "فئات المستحقين", value: n(c), status: c ? "ok" : "missing" },
        { label: "سجل المستفيد الحقيقي", value: b?.c ? `${n(b.c)} سجلًا` : "لا سجلات", status: b?.c ? "ok" : "missing" },
        { label: "آخر تحقق من المستفيد الحقيقي", value: b?.lastVerified ?? "لم يُسجل", status: b?.lastVerified ? "ok" : b?.c ? "missing" : undefined },
        { label: "سجلات فات موعد تحققها", value: n(b?.overdue ?? 0), status: b?.overdue ? "stale" : "ok" },
      ];
      const gaps = [...(!c ? ["لا فئات مستحقين مسجلة"] : []), ...(!b?.c ? ["سجل المستفيد الحقيقي فارغ"] : []), ...(b?.overdue ? [`${n(b.overdue)} سجلًا فات موعد التحقق منه`] : [])];
      return make(key, "المستفيدون والمستفيد الحقيقي في ملف الوقف", "/beneficiaries", c + (b?.c ?? 0) > 0, rows, gaps,
        { classes: c, boRecords: b?.c ?? 0, boOverdue: b?.overdue ?? 0, boLastVerified: b?.lastVerified ?? null }, b?.lastVerified ?? null);
    }
    case "documents.key": {
      const types = ["waqf_deed", "registration_certificate", "nazara_deed", "ownership_deed", "financial_statement", "policy", "resolution", "minutes"] as const;
      const docs = await tx.select({ type: documents.docType, title: documents.title, issuedOn: documents.issuedOn, expiresOn: documents.expiresOn, createdAt: documents.createdAt })
        .from(documents).where(and(eq(documents.waqfId, w.id), isNull(documents.archivedAt), inArray(documents.docType, [...types]))).orderBy(desc(documents.issuedOn));
      const rows: ContextRow[] = types.map((t) => {
        const xs = docs.filter((x) => x.type === t);
        const x = xs[0];
        const expired = !!x?.expiresOn && x.expiresOn < today;
        return { label: DOC_TYPE_LABEL[t as keyof typeof DOC_TYPE_LABEL] ?? t, value: x ? `${n(xs.length)}${x.issuedOn ? ` — أحدثها ${x.issuedOn}` : ""}${x.expiresOn ? `، ينتهي ${x.expiresOn}` : ""}` : "غير مرفوعة", status: (expired ? "stale" : x ? "ok" : "missing") as ContextRow["status"] };
      });
      const core = ["waqf_deed", "registration_certificate"];
      const gaps = [
        ...core.filter((t) => !docs.some((x) => x.type === t)).map((t) => `${DOC_TYPE_LABEL[t as keyof typeof DOC_TYPE_LABEL]} غير مرفوع في الوثائق`),
        ...docs.filter((x) => x.expiresOn && x.expiresOn < today).slice(0, 5).map((x) => `«${x.title}» منتهية في ${x.expiresOn}`),
      ];
      return make(key, "خزانة الوثائق في ملف الوقف", "/documents", docs.length > 0, rows, gaps,
        Object.fromEntries(types.map((t) => [t, docs.filter((x) => x.type === t).length])), latest(...docs.map((x) => x.createdAt)));
    }
    case "compliance.obligations": {
      const o = gov!.obligations;
      const rows: ContextRow[] = [
        { label: "التزامات متأخرة", value: n(o.overdue.length), status: o.overdue.length ? "stale" : "ok" },
        { label: "مستحقة خلال 30 يومًا", value: n(o.dueSoon.length), status: o.dueSoon.length ? "warn" : "ok" },
        { label: "منجزة", value: n(o.done) },
      ];
      return make(key, "الالتزامات النظامية للوقف", "/compliance", o.overdue.length + o.dueSoon.length + o.done > 0, rows, o.overdue.slice(0, 6).map((x) => `متأخر: ${x.title}${x.dueOn ? ` (${x.dueOn})` : ""}`),
        { overdue: o.overdue.length, dueSoon: o.dueSoon.length, done: o.done }, null,
        o.overdue.length + o.dueSoon.length ? { columns: ["الالتزام", "الموعد", "الحالة"], rows: [...o.overdue.map((x) => [x.title, x.dueOn ?? "—", "متأخر"]), ...o.dueSoon.map((x) => [x.title, x.dueOn ?? "—", "قريب"])] } : undefined);
    }
    case "risks.register": {
      const r = gov!.risks;
      const high = r.list.filter((x) => x.impact * x.likelihood >= 12);
      const rows: ContextRow[] = [{ label: "مخاطر مفتوحة", value: n(r.list.length) }, { label: "مخاطر عالية (الأثر × الاحتمال ≥ 12)", value: n(high.length), status: high.length ? "warn" : "ok" }, { label: "مغلقة", value: n(r.closed) }];
      return make(key, "سجل المخاطر في ملف الوقف", "/risks", r.list.length + r.closed > 0, rows, r.list.length + r.closed ? [] : ["لا مخاطر مسجلة في سجل المخاطر"],
        { open: r.list.length, high: high.length, closed: r.closed }, null,
        r.list.length ? { columns: ["الخطر", "الأثر × الاحتمال", "المعالجة"], rows: r.list.slice(0, 15).map((x) => [x.title, `${x.impact} × ${x.likelihood}`, x.treatment ?? "—"]) } : undefined);
    }
    case "history.requests": {
      if (!opts.serviceCode) return null;
      const rs = await tx.select({ id: serviceRequests.id, number: serviceRequests.number, status: serviceRequests.status, createdAt: serviceRequests.createdAt })
        .from(serviceRequests).innerJoin(services, eq(services.id, serviceRequests.serviceId))
        .where(and(eq(serviceRequests.waqfId, w.id), eq(services.code, opts.serviceCode), ...(opts.requestId ? [ne(serviceRequests.id, opts.requestId)] : []))).orderBy(desc(serviceRequests.createdAt)).limit(10);
      const outs = rs.length ? await tx.select({ requestId: outputs.requestId, number: outputs.number, title: outputs.title, approvedAt: outputs.approvedAt }).from(outputs).where(and(inArray(outputs.requestId, rs.map((r) => r.id)), eq(outputs.status, "approved"))) : [];
      const rows: ContextRow[] = rs.length ? [{ label: "طلبات سابقة", value: n(rs.length) }, { label: "مخرجات معتمدة منها", value: n(outs.length) }] : [];
      return make(key, "طلبات «وقفك» السابقة لهذا الوقف", null, rs.length > 0, rows, [],
        { previous: rs.length, approvedOutputs: outs.length }, latest(...rs.map((r) => r.createdAt)),
        rs.length ? { columns: ["الطلب", "التاريخ", "المخرجات المعتمدة"], rows: rs.map((r) => [r.number, d(r.createdAt) ?? "—", outs.filter((o) => o.requestId === r.id).map((o) => `${o.number} ${o.title}`).join("، ") || "—"]) } : undefined);
    }
  }
}

const QUORUM_AR: Record<string, string> = { majority: "الأغلبية", two_thirds: "الثلثان", all: "جميع الأعضاء" };
const MAJORITY_AR: Record<string, string> = { simple: "أغلبية بسيطة للحاضرين", absolute: "أغلبية مطلقة", two_thirds: "أغلبية الثلثين" };
const SUBJ_AR: Record<string, string> = { nazir: "الناظر", board: "المجلس", member: "عضو" };
const ROLE_AR: Record<string, string> = { chair: "رئيس", vice_chair: "نائب الرئيس", member: "عضو", secretary: "أمين السر", observer: "مراقب" };
const roleAr = (r: string) => ROLE_AR[r] ?? r;
