import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or } from "drizzle-orm";
import type { Tx } from "@/server/db";
import {
  assets, beneficialOwners, beneficiaries, beneficiaryClasses, bodies, budgets, conditions, contracts, distributions, documents, founders,
  investmentPolicies, ledgerEntries, leases, meetings, nazaraEngagements, obligationInstances, obligations, policies, portfolios, quotes,
  regulatoryReferences, requestLinks, requestStages, resolutions, trustees, users, waqfs,
} from "@/server/db/schema";
import { addDays, todayISO } from "@/server/engines/dates";
import { summarize as summarizeLedger } from "@/server/modules/finance/pure";
import { POLICY_TYPES } from "@/server/modules/governance/pure";
import { ACCOUNTS } from "@/server/modules/waqf-file/labels";
import { docTypeLabel } from "@/server/modules/documents/labels";
import { CHECK_STATUS_AR, STATUS_AR } from "@/server/modules/nazara/pure";
import type { RequestCtx } from "@/server/modules/requests/access";
import { docRequired, findField, sanitizeAnswers, summarize, tableRows, visibleDocs, visibleFields, visibleSteps } from "@/server/modules/requests/intake/engine";
import { intakeOf, serviceForm } from "@/server/modules/requests/intake/server";
import type { OutputContext } from "./build";
import { fiscalPeriodOfYear, lastFiscalPeriod } from "./fiscal";

const ACCOUNT_LABEL = new Map(ACCOUNTS.map((a) => [a.code, a.label]));
const STAGE_STATUS: Record<string, string> = { pending: "لم تبدأ", active: "جارية", done: "منجزة", skipped: "متجاوزة" };
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

/**
 * Reads everything an output draft may rest on, inside the caller's transaction (RLS applies: the staff member reads
 * only what their access allows). Nothing is inferred: absent data stays absent and becomes a gap in the draft.
 */
export async function collectContext(tx: Tx, rc: RequestCtx, opts: { cycle?: { label: string; from: string | null; to: string | null; due: string } } = {}): Promise<OutputContext> {
  const today = todayISO();
  const req = rc.req;
  const form = serviceForm(rc.service);
  const intake = intakeOf(req);
  const answers = intake.answers ?? {};
  const docMap = intake.docs ?? {};
  const sum = summarize(form, answers);
  const raw: OutputContext["raw"] = {};
  for (const s of sum) for (const r of s.rows) raw[r.key] = { key: r.key, label: r.label, value: r.value };
  const keys: Record<string, string> = {};
  const tables: Record<string, Record<string, string>[]> = {};
  const clean = sanitizeAnswers(form, answers);
  for (const st of visibleSteps(form, clean)) for (const f of visibleFields(st, clean)) {
    const v = clean[f.key];
    if (v === undefined || v === null || v === "") continue;
    if (f.type === "table") tables[f.key] = tableRows(v);
    else keys[f.key] = Array.isArray(v) ? v.join(",") : String(v);
  }
  const capField = findField(form, "capacity");
  const capacity = capField && typeof answers.capacity === "string" ? capField.field.options?.find(([k]) => k === answers.capacity)?.[1] ?? null : null;

  const [requester] = await tx.select({ name: users.fullName }).from(users).where(eq(users.id, req.requesterUserId)).limit(1);
  const docScope = req.waqfId ? or(eq(documents.requestId, req.id), eq(documents.waqfId, req.waqfId))! : eq(documents.requestId, req.id);
  const docRows = await tx.select().from(documents).where(and(docScope, isNull(documents.archivedAt), eq(documents.status, "active"))).orderBy(desc(documents.createdAt)).limit(200);
  const slotOf = new Map<string, string>();
  for (const [k, ids] of Object.entries(docMap)) for (const d of ids) slotOf.set(d, k);
  // inputs: every document of the request; from the waqf file, the reference types only (latest of each title), capped
  const KEY_TYPES = new Set(["waqf_deed", "nazara_deed", "registration_certificate", "ownership_deed", "financial_statement", "bank_statement", "valuation", "policy", "regulation", "lease", "contract", "resolution", "minutes", "permission", "judgment", "official_letter"]);
  const reqDocs = docRows.filter((d) => d.requestId === req.id && d.docType !== "deliverable");
  const seen = new Set<string>();
  const waqfDocs = docRows.filter((d) => d.requestId !== req.id && KEY_TYPES.has(d.docType) && !seen.has(`${d.docType}:${d.title}`) && seen.add(`${d.docType}:${d.title}`));
  const docsList = [...reqDocs, ...waqfDocs.slice(0, 25)];
  const omitted = Math.max(0, docRows.filter((d) => d.requestId !== req.id).length - Math.min(25, waqfDocs.length));

  const [quote] = await tx.select().from(quotes).where(and(eq(quotes.requestId, req.id), eq(quotes.kind, "initial"), eq(quotes.status, "accepted"))).orderBy(desc(quotes.version)).limit(1);
  const [contract] = await tx.select({ number: contracts.number, status: contracts.status, executedAt: contracts.executedAt }).from(contracts).where(and(eq(contracts.requestId, req.id), ne(contracts.status, "void"))).orderBy(desc(contracts.createdAt)).limit(1);
  const stageRows = await tx.select().from(requestStages).where(eq(requestStages.requestId, req.id)).orderBy(asc(requestStages.position));
  const refs = await tx.select({ code: regulatoryReferences.code, name: regulatoryReferences.sourceName, binding: regulatoryReferences.bindingLevel, verification: regulatoryReferences.verificationStatus }).from(regulatoryReferences);

  const ctx: OutputContext = {
    today,
    request: { id: req.id, number: req.number, status: req.status, submittedAt: req.submittedAt?.toISOString().slice(0, 10) ?? null, priority: req.priority },
    service: { code: rc.service.code, nameAr: rc.service.nameAr, outputs: rc.service.outputs, summary: rc.service.summary, workflow: rc.workflowCode },
    requester: { name: requester?.name ?? "مقدّم الطلب", capacity },
    answers: sum.map((s) => ({ title: s.title, rows: s.rows.map((r) => ({ key: r.key, label: r.label, value: r.value })) })),
    raw,
    keys,
    tables,
    formSources: form.sources,
    omittedDocs: omitted,
    formDocs: visibleDocs(form, answers).filter((d) => !["poa", "authorization"].includes(d.key) || docRequired(d, answers)).map((d) => ({ key: d.key, label: d.label, required: docRequired(d, answers), attached: docMap[d.key]?.length ?? 0 })),
    documents: docsList.map((d) => ({ id: d.id, title: d.title, docType: d.docType, typeLabel: docTypeLabel(d.docType), number: d.number, issuedOn: d.issuedOn, expiresOn: d.expiresOn, scope: d.requestId === req.id ? "request" : "waqf", slot: slotOf.get(d.id) ?? null })),
    waqf: null, conditions: [], parties: [], beneficiaries: null, assets: [], leases: { active: 0, arrears: 0, endingIn90: 0 },
    finance: null, budget: null, distributions: [], governance: null, compliance: null, beneficialOwners: null, investment: null,
    quote: quote ? { number: quote.number, version: quote.version, scope: quote.scope, deliverables: quote.deliverables, exclusions: quote.exclusions, assumptions: quote.assumptions } : null,
    contract: contract ? { number: contract.number, status: contract.status, executedAt: contract.executedAt?.toISOString().slice(0, 10) ?? null } : null,
    stages: stageRows.map((s) => ({ name: s.name, status: STAGE_STATUS[s.status] ?? s.status })),
    nazara: null,
    cycle: opts.cycle ?? null,
    refs: refs.map((r) => ({ code: r.code, name: r.name, binding: r.binding, verification: r.verification })),
  };
  ctx.parties.push({ role: "مقدّم الطلب", name: ctx.requester.name, detail: capacity, prov: "client" });

  const wid = req.waqfId;
  if (!wid) return ctx;
  const [w] = await tx.select().from(waqfs).where(eq(waqfs.id, wid)).limit(1);
  if (!w) return ctx;
  ctx.waqf = {
    name: w.name, internalNumber: w.internalNumber, registrationCertNo: w.registrationCertNo, registrationExpiresOn: w.registrationExpiresOn, deedNo: w.deedNo, deedIssuer: w.deedIssuer,
    deedDate: w.deedDate ?? w.deedDateHijri, nationalUnifiedNumber: w.nationalUnifiedNumber, sizeClass: w.sizeClass, legalType: w.legalType, status: w.status, fiscalYearEnd: w.fiscalYearEnd,
    nazirMode: w.nazirMode, waqfakRole: w.waqfakRole, isDemo: w.isDemo, assetsEstimatedValue: num(w.assetsEstimatedValue),
  };
  // The year the client asked about when the form has one; otherwise the last ended fiscal year.
  const askedYear = Number(keys.fiscalYear ?? keys.year);
  // A delivery cycle of a continuous service reads its own period.
  const period = opts.cycle?.from && opts.cycle.to ? { from: opts.cycle.from, to: opts.cycle.to } : Number.isInteger(askedYear) && askedYear > 1990 ? fiscalPeriodOfYear(w.fiscalYearEnd, askedYear) : lastFiscalPeriod(w.fiscalYearEnd, today);
  const yearAgo = new Date(Date.now() - 365 * 86_400_000);
  const [cond, trs, fnd, bens, cls, ast, ls, led, buds, dists, bds, pols, mts, res, obl, bo, ip, pf, eng] = await Promise.all([
    tx.select().from(conditions).where(eq(conditions.waqfId, wid)).orderBy(asc(conditions.position)),
    tx.select().from(trustees).where(and(eq(trustees.waqfId, wid), eq(trustees.status, "active"))),
    tx.select().from(founders).where(eq(founders.waqfId, wid)),
    tx.select({ status: beneficiaries.status, abroad: beneficiaries.residesAbroad }).from(beneficiaries).where(and(eq(beneficiaries.waqfId, wid), isNull(beneficiaries.archivedAt))),
    tx.select().from(beneficiaryClasses).where(eq(beneficiaryClasses.waqfId, wid)).orderBy(asc(beneficiaryClasses.position)),
    tx.select().from(assets).where(and(eq(assets.waqfId, wid), isNull(assets.archivedAt))),
    tx.select({ status: leases.status, arrears: leases.arrears, endsOn: leases.endsOn }).from(leases).where(eq(leases.waqfId, wid)),
    tx.select({ accountCode: ledgerEntries.accountCode, debit: ledgerEntries.debit, credit: ledgerEntries.credit }).from(ledgerEntries).where(and(eq(ledgerEntries.waqfId, wid), gte(ledgerEntries.entryDate, period.from), lte(ledgerEntries.entryDate, period.to))),
    tx.select().from(budgets).where(eq(budgets.waqfId, wid)).orderBy(desc(budgets.fiscalYear)).limit(1),
    tx.select().from(distributions).where(eq(distributions.waqfId, wid)).orderBy(desc(distributions.dueBy)).limit(12),
    tx.select({ kind: bodies.kind, name: bodies.name }).from(bodies).where(eq(bodies.waqfId, wid)),
    tx.select({ type: policies.policyType, status: policies.status }).from(policies).where(eq(policies.waqfId, wid)),
    tx.select({ id: meetings.id }).from(meetings).where(and(eq(meetings.waqfId, wid), eq(meetings.status, "held"), gte(meetings.scheduledAt, yearAgo))),
    tx.select({ id: resolutions.id }).from(resolutions).where(and(eq(resolutions.waqfId, wid), gte(resolutions.createdAt, yearAgo))),
    tx.select({ status: obligationInstances.status, dueOn: obligationInstances.dueOn, title: obligations.titleAr }).from(obligationInstances).innerJoin(obligations, eq(obligations.id, obligationInstances.obligationId)).where(eq(obligationInstances.waqfId, wid)),
    tx.select({ verifiedOn: beneficialOwners.verifiedOn, next: beneficialOwners.nextVerificationDue }).from(beneficialOwners).where(and(eq(beneficialOwners.waqfId, wid), isNull(beneficialOwners.archivedAt))),
    tx.select().from(investmentPolicies).where(eq(investmentPolicies.waqfId, wid)).orderBy(desc(investmentPolicies.version)).limit(1),
    tx.select().from(portfolios).where(eq(portfolios.waqfId, wid)),
    linkedEngagement(tx, req.id, wid),
  ]);
  ctx.conditions = cond.map((x) => ({ category: x.category, clauseRef: x.clauseRef, literal: x.literalText, interpretation: x.interpretation, source: x.interpretationSource }));
  for (const f of fnd) ctx.parties.push({ role: "الواقف", name: f.displayName, detail: f.isAlive === false ? "متوفى" : null, prov: "system" });
  for (const t of trs) ctx.parties.push({ role: t.isChair ? "ناظر (رئيس المجلس)" : "ناظر", name: t.displayName, detail: [t.kind === "legal_entity" ? "شخص اعتباري" : null, t.isIndependent ? "مستقل" : null, t.specialty].filter(Boolean).join("، ") || null, prov: "system" });
  ctx.beneficiaries = {
    active: bens.filter((b) => b.status === "active").length, total: bens.length, abroad: bens.filter((b) => b.abroad).length,
    classes: cls.map((k) => ({ name: k.name, share: k.sharePct == null ? null : `${k.sharePct}٪`, tier: k.tier })),
  };
  ctx.assets = ast.map((a) => ({ title: a.title, category: a.category, status: a.status, bookValue: num(a.bookValue), marketValue: num(a.marketValue), lastValuationOn: a.lastValuationOn, annualIncome: num(a.annualIncome), ownershipDocNo: a.ownershipDocNo }));
  const in90 = addDays(today, 90);
  ctx.leases = {
    active: ls.filter((l) => l.status === "active").length,
    arrears: ls.reduce((s, l) => s + (num(l.arrears) ?? 0), 0),
    endingIn90: ls.filter((l) => l.status === "active" && l.endsOn && l.endsOn >= today && l.endsOn <= in90).length,
  };
  const s = summarizeLedger(led);
  ctx.finance = {
    ...period, entries: led.length, revenue: s.revenue, expense: s.expense, net: s.net, distributions: s.distributions,
    debit: led.reduce((t, r) => t + Number(r.debit), 0), credit: led.reduce((t, r) => t + Number(r.credit), 0),
    byAccount: s.byAccount.map((a) => ({ code: a.code, label: ACCOUNT_LABEL.get(a.code) ?? a.code, amount: a.amount })),
  };
  const b = buds[0];
  ctx.budget = b ? {
    fiscalYear: b.fiscalYear, status: b.status, totalRevenue: num(b.totalRevenue), totalExpense: num(b.totalExpense),
    lines: ((b.lines ?? []) as { label?: string; planned?: number | string; actual?: number | string | null }[]).map((l) => ({ label: String(l.label ?? "—"), planned: Number(l.planned ?? 0), actual: l.actual == null ? null : Number(l.actual) })),
  } : null;
  ctx.distributions = dists.map((d) => ({ period: d.period, status: d.status, dueBy: d.dueBy, paidOn: d.paidOn, total: num(d.totalAmount) }));
  const polByType = new Map(pols.map((p) => [p.type, p.status]));
  ctx.governance = {
    bodies: bds, meetingsHeld12m: mts.length, resolutions12m: res.length,
    policies: POLICY_TYPES.map(([type, label]) => ({ type, label, status: polByType.get(type) === "approved" ? "approved" : polByType.has(type) ? "draft" : "missing" })),
  };
  const soon = addDays(today, 30);
  ctx.compliance = {
    done: obl.filter((o) => o.status === "done").length,
    overdue: obl.filter((o) => o.status === "overdue").length,
    dueSoon: obl.filter((o) => o.status !== "done" && o.dueOn && o.dueOn >= today && o.dueOn <= soon).length,
    overdueList: obl.filter((o) => o.status === "overdue").slice(0, 10).map((o) => ({ title: o.title, dueOn: o.dueOn })),
  };
  ctx.beneficialOwners = { total: bo.length, unverified: bo.filter((x) => !x.verifiedOn).length, dueVerification: bo.filter((x) => x.next && x.next <= soon).length };
  const p = ip[0];
  ctx.investment = {
    policy: p ? { version: p.version, status: p.status, targetReturnPct: num(p.targetReturnPct), riskTolerance: p.riskTolerance, prohibited: p.prohibited, leverage: p.leveragePolicy } : null,
    portfolios: pf.map((x) => ({ manager: x.managerName, license: x.managerCmaLicense, strategy: x.strategy, risk: x.riskLevel })),
  };
  if (eng) {
    ctx.nazara = {
      number: eng.number, status: eng.status, statusLabel: STATUS_AR[eng.status as keyof typeof STATUS_AR] ?? eng.status,
      checklist: (eng.checklist ?? []).map((i) => ({ label: i.label, status: CHECK_STATUS_AR[i.status], required: i.required, source: i.source })),
    };
  }
  return ctx;
}

/** The nazara engagement a request is linked to (explicit link first, then the legacy request_id column). */
async function linkedEngagement(tx: Tx, requestId: string, waqfId: string) {
  const [l] = await tx.select({ id: requestLinks.entityId }).from(requestLinks).where(and(eq(requestLinks.requestId, requestId), eq(requestLinks.entityType, "nazara_engagement"))).limit(1);
  const ids = l ? [l.id] : [];
  const [e] = ids.length
    ? await tx.select().from(nazaraEngagements).where(inArray(nazaraEngagements.id, ids)).limit(1)
    : await tx.select().from(nazaraEngagements).where(and(eq(nazaraEngagements.requestId, requestId), eq(nazaraEngagements.waqfId, waqfId))).limit(1);
  return e ?? null;
}
