import "server-only";
import { and, asc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import type { Tx } from "@/server/db";
import {
  assets, beneficiaries, budgets, complaints, distributions, ledgerEntries, leases, maintenancePlans, meetings, nazaraEngagements,
  obligationInstances, obligations, policies, resolutions, riskRegister, tasks, users, waqfs,
} from "@/server/db/schema";
import { addDays, gregorian, hijri, todayISO } from "@/server/engines/dates";
import { summarize } from "@/server/modules/finance/pure";
import { POLICY_TYPES } from "@/server/modules/governance/pure";
import { ACCOUNTS } from "@/server/modules/waqf-file/labels";
import { AUTHORITY_AR, CHECK_STATUS_AR, END_REASON_AR, STATUS_AR, type EngagementStatus } from "./pure";

/**
 * Nazara outputs, built only from the waqf's recorded data at the moment of preparation (a snapshot is stored and
 * never recomputed). A periodic report is a draft until a holder of `nazara.approve` approves it.
 *
 * Sources: لائحة تنظيم أعمال النظارة م10/3 وم10/9 (إتاحة المعلومات للموقوف عليهم واطلاعهم على القوائم المالية)،
 * الدليل المختصر لمهمات الناظر (التقارير والإفصاح: دقيقة ومحدثة ومؤيدة بالمستندات)، مبادئ الحوكمة المبدأ3 رابعًا/2
 * (تقارير دورية للموقوف عليهم، استرشادي)، وم27/3 للتسليم.
 */

type Eng = typeof nazaraEngagements.$inferSelect;
type Waqf = typeof waqfs.$inferSelect;

export type PeriodicSnapshot = {
  kind: "nazara_periodic";
  title: string;
  generatedOn: string;
  period: { from: string; to: string };
  waqf: { name: string; internalNumber: string; registrationCertNo: string | null; sizeClass: string | null; isDemo: boolean; fiscalYearEnd: string };
  engagement: { number: string; status: string; startedOn: string | null; isPractice: boolean; decisionNo: string | null; decisionDate: string | null; authority: string | null };
  finance: { revenue: number; expense: number; net: number; distributions: number; entries: number; byAccount: { code: string; label: string; amount: number }[] };
  budget: null | { fiscalYear: number; status: string; lines: { label: string; kind: string; planned: number; actual: number | null }[] };
  distributionsInPeriod: { period: string; status: string; dueBy: string | null; paidOn: string | null }[];
  beneficiaries: { active: number; total: number };
  assets: { count: number; activeLeases: number; leasesEndingSoon: number; maintenanceDue: number };
  obligations: { done: number; overdue: number; upcoming: number; overdueList: { title: string; dueOn: string | null }[] };
  tasks: { doneInPeriod: number; open: number; overdue: number };
  governance: { meetingsHeld: number; resolutions: number };
  complaints: { received: number; answered: number; open: number };
  risks: { open: number; top: { title: string; score: number }[] };
  supporting: { type: string; label: string; status: "approved" | "draft" | "missing" }[];
};

export type RecordSnapshot = {
  kind: "nazara_takeover" | "nazara_handover";
  title: string;
  generatedOn: string;
  waqf: PeriodicSnapshot["waqf"];
  engagement: PeriodicSnapshot["engagement"] & { endReason: string | null; endedOn: string | null; successorName: string | null };
  items: { label: string; status: string; detail: string; note: string | null; source?: string }[];
  inventory: { assets: number; activeLeases: number; beneficiaries: number };
};

const ACCOUNT_LABEL = new Map(ACCOUNTS.map((a) => [a.code, a.label]));

function waqfPart(w: Waqf): PeriodicSnapshot["waqf"] {
  return { name: w.name, internalNumber: w.internalNumber, registrationCertNo: w.registrationCertNo, sizeClass: w.sizeClass, isDemo: w.isDemo, fiscalYearEnd: w.fiscalYearEnd };
}
function engPart(e: Eng): PeriodicSnapshot["engagement"] {
  return { number: e.number, status: e.status, startedOn: e.startedOn, isPractice: e.isPractice, decisionNo: e.appointmentDecisionNo, decisionDate: e.appointmentDecisionDate, authority: e.appointmentAuthority };
}

export async function buildPeriodicSnapshot(tx: Tx, e: Eng, w: Waqf, from: string, to: string): Promise<PeriodicSnapshot> {
  const id = w.id;
  const today = todayISO();
  const fromTs = new Date(`${from}T00:00:00Z`);
  const toTs = new Date(`${to}T23:59:59Z`);
  const [ledger, buds, dists, bens, ast, ls, mp, obl, tk, mts, res, cmp, rk, pol] = await Promise.all([
    tx.select({ accountCode: ledgerEntries.accountCode, debit: ledgerEntries.debit, credit: ledgerEntries.credit }).from(ledgerEntries).where(and(eq(ledgerEntries.waqfId, id), gte(ledgerEntries.entryDate, from), lte(ledgerEntries.entryDate, to))),
    tx.select().from(budgets).where(eq(budgets.waqfId, id)).orderBy(asc(budgets.fiscalYear)),
    tx.select({ period: distributions.period, status: distributions.status, dueBy: distributions.dueBy, paidOn: distributions.paidOn }).from(distributions).where(and(eq(distributions.waqfId, id), gte(distributions.dueBy, from), lte(distributions.dueBy, to))),
    tx.select({ status: beneficiaries.status }).from(beneficiaries).where(eq(beneficiaries.waqfId, id)),
    tx.select({ id: assets.id }).from(assets).where(eq(assets.waqfId, id)),
    tx.select({ endsOn: leases.endsOn }).from(leases).where(and(eq(leases.waqfId, id), eq(leases.status, "active"))),
    tx.select({ nextDueOn: maintenancePlans.nextDueOn }).from(maintenancePlans).where(and(eq(maintenancePlans.waqfId, id), ne(maintenancePlans.status, "done"))),
    tx.select({ status: obligationInstances.status, dueOn: obligationInstances.dueOn, title: obligations.titleAr }).from(obligationInstances).innerJoin(obligations, eq(obligations.id, obligationInstances.obligationId)).where(eq(obligationInstances.waqfId, id)),
    tx.select({ status: tasks.status, dueOn: tasks.dueOn, completedAt: tasks.completedAt }).from(tasks).where(eq(tasks.waqfId, id)),
    tx.select({ id: meetings.id }).from(meetings).where(and(eq(meetings.waqfId, id), eq(meetings.status, "held"), gte(meetings.scheduledAt, fromTs), lte(meetings.scheduledAt, toTs))),
    tx.select({ id: resolutions.id }).from(resolutions).where(and(eq(resolutions.waqfId, id), inArray(resolutions.status, ["approved", "executed", "reviewed"]), gte(resolutions.createdAt, fromTs), lte(resolutions.createdAt, toTs))),
    tx.select({ status: complaints.status, createdAt: complaints.createdAt, respondedAt: complaints.respondedAt }).from(complaints).where(eq(complaints.waqfId, id)),
    tx.select({ title: riskRegister.title, impact: riskRegister.impact, likelihood: riskRegister.likelihood }).from(riskRegister).where(and(eq(riskRegister.waqfId, id), eq(riskRegister.status, "open"))),
    tx.select({ type: policies.policyType, status: policies.status }).from(policies).where(eq(policies.waqfId, id)),
  ]);
  const fin = summarize(ledger);
  // Budget of the fiscal year the period ends in (if any), planned vs actual by account code from the same ledger rows.
  const fy = Number(to.slice(0, 4));
  const bud = buds.find((b) => b.fiscalYear === fy) ?? null;
  const actualBy = new Map(fin.byAccount.map((a) => [a.code, a.amount]));
  const in90 = addDays(today, 90);
  const in30 = addDays(today, 30);
  const inPeriod = (d: Date | null) => !!d && d >= fromTs && d <= toTs;
  return {
    kind: "nazara_periodic",
    title: "تقرير النظارة الدوري",
    generatedOn: today,
    period: { from, to },
    waqf: waqfPart(w),
    engagement: engPart(e),
    finance: { revenue: fin.revenue, expense: fin.expense, net: fin.net, distributions: fin.distributions, entries: ledger.length, byAccount: fin.byAccount.filter((a) => a.amount !== 0).map((a) => ({ ...a, label: ACCOUNT_LABEL.get(a.code) ?? a.code })) },
    budget: bud ? { fiscalYear: bud.fiscalYear, status: bud.status, lines: (bud.lines ?? []).map((l) => ({ label: l.label, kind: l.kind, planned: Number(l.amount), actual: actualBy.has(l.code) ? actualBy.get(l.code)! : null })) } : null,
    distributionsInPeriod: dists,
    beneficiaries: { active: bens.filter((b) => b.status === "active").length, total: bens.length },
    assets: { count: ast.length, activeLeases: ls.length, leasesEndingSoon: ls.filter((l) => l.endsOn && l.endsOn <= in90).length, maintenanceDue: mp.filter((m) => m.nextDueOn && m.nextDueOn <= in30).length },
    obligations: {
      done: obl.filter((o) => o.status === "done" && o.dueOn && o.dueOn >= from && o.dueOn <= to).length,
      overdue: obl.filter((o) => o.status === "overdue").length,
      upcoming: obl.filter((o) => (o.status === "upcoming" || o.status === "due_soon") && o.dueOn && o.dueOn <= in90).length,
      overdueList: obl.filter((o) => o.status === "overdue").slice(0, 10).map((o) => ({ title: o.title, dueOn: o.dueOn })),
    },
    tasks: {
      doneInPeriod: tk.filter((t) => t.status === "done" && inPeriod(t.completedAt)).length,
      open: tk.filter((t) => t.status === "todo" || t.status === "in_progress").length,
      overdue: tk.filter((t) => (t.status === "todo" || t.status === "in_progress") && t.dueOn && t.dueOn < today).length,
    },
    governance: { meetingsHeld: mts.length, resolutions: res.length },
    complaints: {
      received: cmp.filter((c) => inPeriod(c.createdAt)).length,
      answered: cmp.filter((c) => inPeriod(c.respondedAt)).length,
      open: cmp.filter((c) => c.status === "open" || c.status === "in_progress").length,
    },
    risks: { open: rk.length, top: rk.map((r) => ({ title: r.title, score: r.impact * r.likelihood })).sort((a, b) => b.score - a.score).slice(0, 5) },
    supporting: POLICY_TYPES.map(([type, label]) => {
      const rows = pol.filter((p) => p.type === type);
      return { type, label, status: rows.some((p) => p.status === "approved") ? "approved" : rows.some((p) => p.status === "draft") ? "draft" : "missing" };
    }),
  };
}

export async function buildRecordSnapshot(tx: Tx, e: Eng, w: Waqf, kind: "nazara_takeover" | "nazara_handover"): Promise<RecordSnapshot> {
  const [ast, ls, bens] = await Promise.all([
    tx.select({ id: assets.id }).from(assets).where(eq(assets.waqfId, w.id)),
    tx.select({ id: leases.id }).from(leases).where(and(eq(leases.waqfId, w.id), eq(leases.status, "active"))),
    tx.select({ id: beneficiaries.id }).from(beneficiaries).where(eq(beneficiaries.waqfId, w.id)),
  ]);
  const items =
    kind === "nazara_takeover"
      ? e.checklist.map((i) => ({ label: i.label, status: CHECK_STATUS_AR[i.status], detail: i.required ? "مطلوب" : "عند الانطباق", note: i.note ?? null, source: i.source }))
      : e.handover.map((h) => ({ label: h.label, status: h.status === "delivered" ? "سُلّم" : "قيد التسليم", detail: h.detail, note: h.note ?? null }));
  return {
    kind,
    title: kind === "nazara_takeover" ? "محضر استلام الوقف" : "محضر تسليم الوقف",
    generatedOn: todayISO(),
    waqf: waqfPart(w),
    engagement: { ...engPart(e), endReason: e.endReason, endedOn: e.endedOn, successorName: e.successorName },
    items,
    inventory: { assets: ast.length, activeLeases: ls.length, beneficiaries: bens.length },
  };
}

// ───────────── HTML (for the PDF renderer) ─────────────

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const both = (d: string | null | undefined) => (d ? `${esc(gregorian(d))} <span class="muted small">(${esc(hijri(d))})</span>` : "—");
const sar = (n: number) => `${new Intl.NumberFormat("ar-SA-u-nu-latn", { maximumFractionDigits: 2 }).format(n)} ر.س`;
const kv = (pairs: [string, string][]) => `<dl class="kv">${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;
const SIZE_AR: Record<string, string> = { large: "كبير", medium: "متوسط", small: "صغير", direct_benefit: "ذو انتفاع مباشر" };

type Meta = { number: string; verificationCode: string; generatedBy: string | null; status: string; approvedBy: string | null; approvedAt: Date | null };

function header(title: string, sub: string, w: PeriodicSnapshot["waqf"], e: PeriodicSnapshot["engagement"], meta: Meta) {
  const draft = meta.status === "draft";
  return `<div class="brandbar"></div>
  <div style="padding-top:14mm">
    <p class="muted">وقفك — الناظر الاعتباري على الوقف</p>
    <h1 style="font-size:22pt;margin-top:4mm">${esc(title)}</h1>
    <p class="naskh" style="font-size:15pt;color:var(--seal)">${esc(w.name)}</p>
    <p class="muted">${sub}</p>
    ${draft ? `<div class="box seal" style="margin-top:6mm"><strong>مسودة لم تُعتمد بعد.</strong> لا تُعامل نسخة نهائية حتى يعتمدها مسؤول النظارة.</div>` : ""}
    ${e.isPractice || w.isDemo ? `<div class="box seal" style="margin-top:4mm">بيانات تجريبية على وقف تجريبي — لا تمثل وقفًا حقيقيًا ولا نظارة فعلية.</div>` : ""}
    ${kv([
      ["رقم المستند", esc(meta.number)],
      ["رمز التحقق", `<span class="tabular">${esc(meta.verificationCode)}</span>`],
      ["أعدّه", esc(meta.generatedBy ?? "—")],
      ["الحالة", meta.status === "approved" ? `معتمد${meta.approvedBy ? ` — ${esc(meta.approvedBy)}` : ""}${meta.approvedAt ? ` في ${esc(gregorian(meta.approvedAt.toISOString().slice(0, 10)))}` : ""}` : meta.status === "draft" ? "مسودة" : "نهائي"],
      ["ملف النظارة", esc(e.number)],
      ["قرار التعيين", e.decisionNo ? `${esc(e.decisionNo)} — ${both(e.decisionDate)}${e.authority ? ` — ${esc(AUTHORITY_AR[e.authority] ?? e.authority)}` : ""}` : "—"],
      ["مباشرة النظارة", both(e.startedOn)],
    ])}
  </div>`;
}

export function periodicHtml(s: PeriodicSnapshot, meta: Meta) {
  const supportCounts = { approved: s.supporting.filter((x) => x.status === "approved").length, total: s.supporting.length };
  return `${header(s.title, `الفترة من ${both(s.period.from)} إلى ${both(s.period.to)} — أُعدّ في ${both(s.generatedOn)}`, s.waqf, s.engagement, meta)}
  <h2>١. هوية الوقف</h2>
  ${kv([
    ["الرقم الداخلي", esc(s.waqf.internalNumber)],
    ["رقم شهادة التسجيل", esc(s.waqf.registrationCertNo ?? "—")],
    ["فئة الحجم", esc(SIZE_AR[s.waqf.sizeClass ?? ""] ?? "غير محددة")],
    ["نهاية السنة المالية", esc(s.waqf.fiscalYearEnd)],
  ])}

  <h2>٢. المالية في الفترة</h2>
  <p class="small muted">من قيود دفتر الوقف المسجلة في المنصة (${s.finance.entries} قيدًا). لا تحل محل القوائم المالية المدققة أو البيان المالي السنوي (لائحة تنظيم أعمال النظارة م15/4–5).</p>
  ${kv([
    ["الإيرادات", sar(s.finance.revenue)],
    ["المصروفات", sar(s.finance.expense)],
    ["الصافي", sar(s.finance.net)],
    ["المصروف على المستفيدين", sar(s.finance.distributions)],
  ])}
  ${s.finance.byAccount.length ? `<table><thead><tr><th>الحساب</th><th>الرصيد في الفترة</th></tr></thead><tbody>${s.finance.byAccount.map((a) => `<tr><td>${esc(a.code)} — ${esc(a.label)}</td><td class="tabular">${sar(a.amount)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">لا قيود في هذه الفترة.</p>`}
  ${
    s.budget
      ? `<h3>الموازنة التقديرية ${s.budget.fiscalYear} (${s.budget.status === "approved" ? "معتمدة" : "مسودة"})</h3><table><thead><tr><th>البند</th><th>المقدّر</th><th>الفعلي في الفترة</th></tr></thead><tbody>${s.budget.lines
          .map((l) => `<tr><td>${esc(l.label)}</td><td class="tabular">${sar(l.planned)}</td><td class="tabular">${l.actual === null ? "—" : sar(l.actual)}</td></tr>`)
          .join("")}</tbody></table>`
      : `<p class="muted">لا توجد موازنة مسجلة للسنة المالية ${s.period.to.slice(0, 4)}.</p>`
  }

  <h2>٣. الصرف على المستفيدين</h2>
  ${kv([["المستفيدون النشطون", `${s.beneficiaries.active} من ${s.beneficiaries.total}`]])}
  ${s.distributionsInPeriod.length ? `<table><thead><tr><th>الدفعة</th><th>الحالة</th><th>الاستحقاق</th><th>الصرف</th></tr></thead><tbody>${s.distributionsInPeriod.map((d) => `<tr><td>${esc(d.period)}</td><td>${esc({ planned: "مخططة", approved: "معتمدة", paid: "مصروفة", partially_paid: "مصروفة جزئيًا" }[d.status] ?? d.status)}</td><td>${both(d.dueBy)}</td><td>${both(d.paidOn)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">لا دفعات صرف مستحقة في الفترة.</p>`}

  <h2>٤. الأصول والعقود</h2>
  ${kv([
    ["الأصول المسجلة", String(s.assets.count)],
    ["عقود الإيجار السارية", String(s.assets.activeLeases)],
    ["عقود تنتهي خلال 90 يومًا", String(s.assets.leasesEndingSoon)],
    ["صيانة مستحقة خلال 30 يومًا", String(s.assets.maintenanceDue)],
  ])}

  <h2>٥. الالتزامات والمهام</h2>
  ${kv([
    ["التزامات أُنجزت في الفترة", String(s.obligations.done)],
    ["التزامات متأخرة الآن", String(s.obligations.overdue)],
    ["التزامات خلال 90 يومًا", String(s.obligations.upcoming)],
    ["مهام أُنجزت في الفترة", String(s.tasks.doneInPeriod)],
    ["مهام مفتوحة / متأخرة", `${s.tasks.open} / ${s.tasks.overdue}`],
  ])}
  ${s.obligations.overdueList.length ? `<h3>الالتزامات المتأخرة</h3><table><thead><tr><th>الالتزام</th><th>الموعد</th></tr></thead><tbody>${s.obligations.overdueList.map((o) => `<tr><td>${esc(o.title)}</td><td>${both(o.dueOn)}</td></tr>`).join("")}</tbody></table>` : ""}

  <h2>٦. الحوكمة والمستفيدون والمخاطر</h2>
  ${kv([
    ["اجتماعات عُقدت في الفترة", String(s.governance.meetingsHeld)],
    ["قرارات معتمدة في الفترة", String(s.governance.resolutions)],
    ["استفسارات وشكاوى وردت / أُجيبت", `${s.complaints.received} / ${s.complaints.answered}`],
    ["شكاوى مفتوحة الآن", String(s.complaints.open)],
    ["مخاطر مفتوحة", String(s.risks.open)],
  ])}
  ${s.risks.top.length ? `<table><thead><tr><th>أعلى المخاطر</th><th>الدرجة (الأثر × الاحتمال)</th></tr></thead><tbody>${s.risks.top.map((r) => `<tr><td>${esc(r.title)}</td><td class="tabular">${r.score}</td></tr>`).join("")}</tbody></table>` : ""}

  <h2>٧. المتطلبات التنظيمية المساندة (${supportCounts.approved} من ${supportCounts.total} معتمدة)</h2>
  <p class="small muted">الدليل المختصر لمهمات ومسؤوليات ناظر الوقف، ص19 — بحسب حجم الوقف وطبيعته.</p>
  <table><thead><tr><th>المتطلب</th><th>الحالة</th></tr></thead><tbody>${s.supporting.map((x) => `<tr><td>${esc(x.label)}</td><td>${x.status === "approved" ? "معتمد" : x.status === "draft" ? "مسودة" : "غير موجود"}</td></tr>`).join("")}</tbody></table>
  `;
}

export function recordHtml(s: RecordSnapshot, meta: Meta) {
  const isHandover = s.kind === "nazara_handover";
  return `${header(s.title, `أُعدّ في ${both(s.generatedOn)}`, s.waqf, s.engagement, meta)}
  ${
    isHandover
      ? kv([
          ["سبب الانتهاء", esc(END_REASON_AR[s.engagement.endReason ?? ""] ?? "—")],
          ["الناظر البديل", esc(s.engagement.successorName ?? "—")],
          ["تاريخ الإقفال", both(s.engagement.endedOn)],
          ["حالة الملف", esc(STATUS_AR[s.engagement.status as EngagementStatus] ?? s.engagement.status)],
        ])
      : ""
  }
  <h2>${isHandover ? "بنود التسليم" : "بنود الاستلام"}</h2>
  <p class="small muted">${isHandover ? "لائحة تنظيم أعمال النظارة م27/3: الإفصاح عن كافة أصول الوقف ومستنداته وبياناته وتسليم جميع ما يتعلق به للناظر البديل، وتحديث شهادة التسجيل؛ ومعايير المستفيد الحقيقي م7/4: تسليم المستندات الأصلية فورًا." : "قائمة ما استلمه فريق النظارة من مستندات الوقف وبياناته قبل اعتماد القبول، مع مرجع كل بند."}</p>
  <table><thead><tr><th>البند</th><th>الحالة</th><th>${isHandover ? "التفصيل" : "النوع"}</th><th>ملاحظة</th></tr></thead><tbody>${s.items
    .map((i) => `<tr><td>${esc(i.label)}${i.source ? `<br><span class="muted small">${esc(i.source)}</span>` : ""}</td><td>${esc(i.status)}</td><td>${esc(i.detail)}</td><td>${esc(i.note ?? "")}</td></tr>`)
    .join("")}</tbody></table>
  <h2>حصر عند الإعداد</h2>
  ${kv([
    ["الأصول المسجلة", String(s.inventory.assets)],
    ["عقود الإيجار السارية", String(s.inventory.activeLeases)],
    ["المستفيدون المسجلون", String(s.inventory.beneficiaries)],
  ])}
  <h2>التوقيعات</h2>
  <table><thead><tr><th>${isHandover ? "المسلِّم (وقفك)" : "المستلِم (وقفك)"}</th><th>${isHandover ? "المستلِم (الناظر البديل)" : "المسلِّم"}</th></tr></thead><tbody><tr><td style="height:24mm"></td><td></td></tr></tbody></table>
  `;
}

export async function nameOf(tx: Tx, id: string | null) {
  if (!id) return null;
  const [u] = await tx.select({ n: users.fullName }).from(users).where(eq(users.id, id)).limit(1);
  return u?.n ?? null;
}


/** Builds the downloadable file of a stored nazara output (PDF; the periodic report also as CSV for spreadsheets). */
export function nazaraFile(row: { number: string; verificationCode: string; status: string; approvedAt: Date | null; snapshot: unknown }, names: { generatedBy: string | null; approvedBy: string | null }, format: "pdf" | "csv") {
  const s = row.snapshot as PeriodicSnapshot | RecordSnapshot;
  const meta: Meta = { number: row.number, verificationCode: row.verificationCode, generatedBy: names.generatedBy, status: row.status, approvedBy: names.approvedBy, approvedAt: row.approvedAt };
  if (format === "csv" && s.kind === "nazara_periodic") {
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines: unknown[][] = [
      ["تقرير النظارة الدوري", s.waqf.name, row.number, row.status === "draft" ? "مسودة" : "معتمد"],
      ["الفترة", s.period.from, s.period.to],
      [],
      ["المالية", "القيمة (ر.س)"],
      ["الإيرادات", s.finance.revenue], ["المصروفات", s.finance.expense], ["الصافي", s.finance.net], ["المصروف على المستفيدين", s.finance.distributions],
      [],
      ["رمز الحساب", "الحساب", "الرصيد في الفترة"],
      ...s.finance.byAccount.map((a) => [a.code, a.label, a.amount]),
      [],
      ["بند الموازنة", "النوع", "المقدّر", "الفعلي"],
      ...(s.budget?.lines ?? []).map((l) => [l.label, l.kind, l.planned, l.actual ?? ""]),
      [],
      ["المتطلب المساند", "الحالة"],
      ...s.supporting.map((x) => [x.label, x.status]),
    ];
    const csv = "﻿" + lines.map((l) => l.map(q).join(",")).join("\r\n");
    return { kind: "file" as const, body: Buffer.from(csv, "utf8"), type: "text/csv; charset=utf-8", name: `${row.number}-nazara-periodic.csv` };
  }
  const html = s.kind === "nazara_periodic" ? periodicHtml(s, meta) : recordHtml(s, meta);
  const suffix = s.kind === "nazara_periodic" ? (row.status === "draft" ? "periodic-draft" : "periodic") : s.kind === "nazara_takeover" ? "takeover" : "handover";
  return { kind: "pdf" as const, html, title: s.title, headerTitle: `${s.title} — ${row.number}${row.status === "draft" ? " — مسودة" : ""}`, name: `${row.number}-nazara-${suffix}.pdf` };
}
