/**
 * Draft builder: turns the data the platform holds about a request into a structured draft of a service output.
 * PURE (no DB): the context is collected by ./collect.ts. Every statement carries its provenance; judgment is left to
 * the specialist in explicit "specialist" blocks; missing inputs become gaps (blocking ones prevent approval).
 */
import { createHash } from "node:crypto";
import type { OutputBlock, OutputGap, OutputSection, OutputSource, Provenance } from "@/server/db/schema/operations";
import { PROFILE_REFS, TEMPLATES, type OutputDef, type SectionKind } from "./catalog";
import { draftDeed, draftWill } from "./drafting";

export type CtxDoc = { id: string; title: string; docType: string; typeLabel: string; number: string | null; issuedOn: string | null; expiresOn: string | null; scope: "request" | "waqf"; slot: string | null };
export type CtxField = { key: string; label: string; value: string };

export type OutputContext = {
  today: string;
  request: { id: string; number: string; status: string; submittedAt: string | null; priority: string };
  service: { code: string; nameAr: string; outputs: string | null; summary: string | null; workflow: string };
  requester: { name: string; capacity: string | null };
  answers: { title: string; rows: CtxField[] }[];
  /** Raw answers by field key (for clause mapping). */
  raw: Record<string, CtxField>;
  /** Stored values of visible scalar fields (option keys, numbers as text) — for drafting rules. */
  keys?: Record<string, string>;
  /** Rows of visible table fields (option keys as stored). */
  tables?: Record<string, Record<string, string>[]>;
  formSources: string[];
  /** Waqf documents not listed (other types or older copies). */
  omittedDocs?: number;
  formDocs: { key: string; label: string; required: boolean; attached: number }[];
  documents: CtxDoc[];
  waqf: null | {
    name: string; internalNumber: string; registrationCertNo: string | null; registrationExpiresOn: string | null; deedNo: string | null; deedIssuer: string | null;
    deedDate: string | null; nationalUnifiedNumber: string | null; sizeClass: string | null; legalType: string | null; status: string; fiscalYearEnd: string;
    nazirMode: string | null; waqfakRole: string; isDemo: boolean; assetsEstimatedValue: number | null;
  };
  conditions: { category: string; clauseRef: string | null; literal: string; interpretation: string | null; source: string | null }[];
  parties: { role: string; name: string; detail: string | null; prov: Provenance }[];
  beneficiaries: null | { active: number; total: number; abroad: number; classes: { name: string; share: string | null; tier: number | null }[] };
  assets: { title: string; category: string; status: string; bookValue: number | null; marketValue: number | null; lastValuationOn: string | null; annualIncome: number | null; ownershipDocNo: string | null }[];
  leases: { active: number; arrears: number; endingIn90: number };
  finance: null | { from: string; to: string; entries: number; revenue: number; expense: number; net: number; distributions: number; debit: number; credit: number; byAccount: { code: string; label: string; amount: number }[] };
  budget: null | { fiscalYear: number; status: string; totalRevenue: number | null; totalExpense: number | null; lines: { label: string; planned: number; actual: number | null }[] };
  distributions: { period: string; status: string; dueBy: string | null; paidOn: string | null; total: number | null }[];
  governance: null | { bodies: { kind: string; name: string }[]; policies: { type: string; label: string; status: "approved" | "draft" | "missing" }[]; meetingsHeld12m: number; resolutions12m: number };
  compliance: null | { overdue: number; dueSoon: number; done: number; overdueList: { title: string; dueOn: string | null }[] };
  beneficialOwners: null | { total: number; unverified: number; dueVerification: number };
  investment: null | { policy: null | { version: number; status: string; targetReturnPct: number | null; riskTolerance: string | null; prohibited: string | null; leverage: string | null }; portfolios: { manager: string | null; license: string | null; strategy: string | null; risk: string | null }[] };
  quote: null | { number: string; version: number; scope: string; deliverables: string | null; exclusions: string | null; assumptions: string | null };
  contract: null | { number: string; status: string; executedAt: string | null };
  stages: { name: string; status: string }[];
  nazara: null | { number: string; status: string; statusLabel: string; checklist: { label: string; status: string; required: boolean; source: string }[] };
  refs: { code: string; name: string; binding: string; verification: string }[];
  /** Delivery cycle of a continuous service (period the output covers). */
  cycle?: { label: string; from: string | null; to: string | null; due: string } | null;
};

const fmt = (n: number | null | undefined) => (n == null ? "—" : `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ر.س`);
const has = (v: string | null | undefined) => !!v && v.trim() !== "" && v.trim() !== "—";
const section = (key: string, title: string, blocks: OutputBlock[], required = true): OutputSection => ({ key, title, required, blocks });

const POLICY_STATUS: Record<string, string> = { approved: "معتمدة", draft: "مسودة", missing: "غير موجودة" };
const SIZE: Record<string, string> = { micro: "متناهي الصغر", small: "صغير", medium: "متوسط", large: "كبير" };

type Built = { sections: OutputSection[]; gaps: OutputGap[] };

function build(kind: SectionKind, c: OutputContext, def: OutputDef): Built {
  const gaps: OutputGap[] = [];
  const out = (s: OutputSection | null): Built => ({ sections: s ? [s] : [], gaps });
  switch (kind) {
    case "meta":
      return out(section("meta", "بيانات المستند", [{
        type: "facts", rows: [
          { label: "الخدمة", value: `${c.service.code} — ${c.service.nameAr}`, prov: "system" },
          { label: "الطلب", value: c.request.number, prov: "system" },
          { label: "مقدّم الطلب", value: c.requester.name + (c.requester.capacity ? ` (${c.requester.capacity})` : ""), prov: "client" },
          { label: "الوقف", value: c.waqf ? c.waqf.name : "لا يوجد ملف وقف مرتبط", prov: "system" },
          { label: "تاريخ الإعداد", value: c.today, prov: "system" },
          ...(c.cycle ? [{ label: "الدورة", value: `${c.cycle.label}${c.cycle.from && c.cycle.to ? ` (${c.cycle.from} إلى ${c.cycle.to})` : ""} — تستحق ${c.cycle.due}`, prov: "system" as Provenance }] : []),
          ...(c.quote ? [{ label: "نطاق الخدمة", value: `العرض ${c.quote.number} (نسخة ${c.quote.version})`, prov: "system" as Provenance }] : []),
          ...(c.contract ? [{ label: "العقد", value: `${c.contract.number}${c.contract.executedAt ? " — نافذ" : ""}`, prov: "system" as Provenance }] : []),
        ],
      }]));
    case "request": {
      const rows = c.answers.flatMap((s) => s.rows.filter((r) => has(r.value)).map((r) => ({ label: r.label, value: r.value, prov: "client" as Provenance, ref: s.title })));
      if (!rows.length) gaps.push({ key: "answers", label: "لا إجابات في نموذج الطلب", severity: "blocking", hint: "يُستكمل النموذج من سجل النواقص." });
      const blocks: OutputBlock[] = rows.length ? [{ type: "facts", rows }] : [{ type: "para", text: "لم تُسجَّل إجابات في نموذج الطلب.", prov: "system" }];
      if (c.quote) {
        blocks.push({ type: "facts", rows: [
          { label: "النطاق المتفق عليه", value: c.quote.scope, prov: "system", ref: `العرض ${c.quote.number}` },
          ...(has(c.quote.deliverables) ? [{ label: "المخرجات المتفق عليها", value: c.quote.deliverables!, prov: "system" as Provenance, ref: `العرض ${c.quote.number}` }] : []),
          ...(has(c.quote.exclusions) ? [{ label: "المستثنى من النطاق", value: c.quote.exclusions!, prov: "system" as Provenance, ref: `العرض ${c.quote.number}` }] : []),
          ...(has(c.quote.assumptions) ? [{ label: "افتراضات العرض", value: c.quote.assumptions!, prov: "assumption" as Provenance, ref: `العرض ${c.quote.number}` }] : []),
        ] });
      }
      return out(section("request", "بيانات الطلب كما قدّمها العميل", blocks));
    }
    case "documents": {
      const rows = c.documents.map((d) => [d.title, d.typeLabel, d.number ?? "—", d.issuedOn ?? "—", d.scope === "request" ? "مرفق بالطلب" : "من ملف الوقف"]);
      for (const slot of c.formDocs.filter((s) => s.required && s.attached === 0))
        gaps.push({ key: `doc:${slot.key}`, label: `مستند مطلوب لم يُرفق: ${slot.label}`, severity: "blocking", hint: "اطلبه من العميل في سجل النواقص." });
      const expired = c.documents.filter((d) => d.expiresOn && d.expiresOn < c.today);
      for (const d of expired) gaps.push({ key: `expired:${d.id}`, label: `مستند منتهي الصلاحية: ${d.title} (${d.expiresOn})`, severity: "warning" });
      return out(section("documents", "المستندات التي بُني عليها المخرج", rows.length
        ? [{ type: "table", head: ["المستند", "النوع", "الرقم", "تاريخ الإصدار", "المصدر"], rows, prov: "document" },
          ...(c.omittedDocs ? [{ type: "para" as const, text: `وفي ملف الوقف ${c.omittedDocs} مستندًا آخر من أنواع أخرى أو نسخ أقدم، لم تُدرج هنا.`, prov: "system" as Provenance }] : []),
          { type: "para", text: "محتوى المستندات لا يُستخرج آليًا؛ ما يُنقل منها إلى المخرج يتحقق منه المختص بالرجوع إلى المستند نفسه.", prov: "unverified" }]
        : [{ type: "para", text: "لا مستندات مرفقة بالطلب أو بملف الوقف.", prov: "system" }]));
    }
    case "waqf": {
      if (!c.waqf) {
        gaps.push({ key: "waqf", label: "الطلب غير مرتبط بملف وقف", severity: def.profile === "will_text" || def.profile === "deed_draft" || def.profile === "sharia_memo" ? "warning" : "blocking", hint: "اربط الطلب بوقف العميل من صفحة الطلب، أو أنشئ ملف الوقف منه." });
        return out(section("waqf", "بيانات الوقف", [{ type: "para", text: "لا يوجد ملف وقف مرتبط بالطلب.", prov: "system" }]));
      }
      const w = c.waqf;
      if (!w.registrationCertNo && def.specialty !== "sharia") gaps.push({ key: "registration", label: "رقم شهادة التسجيل لدى الهيئة غير مسجل في ملف الوقف", severity: "warning" });
      if (w.registrationExpiresOn && w.registrationExpiresOn < c.today) gaps.push({ key: "registration_expired", label: `شهادة التسجيل منتهية (${w.registrationExpiresOn})`, severity: "warning" });
      return out(section("waqf", "بيانات الوقف من ملفه في المنصة", [{
        type: "facts", rows: [
          { label: "اسم الوقف", value: w.name, prov: "system" },
          { label: "الرقم الداخلي", value: w.internalNumber, prov: "system" },
          { label: "رقم الصك وجهته وتاريخه", value: [w.deedNo, w.deedIssuer, w.deedDate].filter(Boolean).join(" — ") || "غير مسجل", prov: w.deedNo ? "system" : "unverified" },
          { label: "شهادة التسجيل", value: w.registrationCertNo ? `${w.registrationCertNo}${w.registrationExpiresOn ? ` (تنتهي ${w.registrationExpiresOn})` : ""}` : "غير مسجلة", prov: w.registrationCertNo ? "system" : "unverified" },
          { label: "الرقم الموحد", value: w.nationalUnifiedNumber ?? "—", prov: "system" },
          { label: "حجم الوقف", value: w.sizeClass ? SIZE[w.sizeClass] ?? w.sizeClass : "غير محدد", prov: "computed" },
          { label: "نهاية السنة المالية", value: w.fiscalYearEnd, prov: "system" },
          ...(w.isDemo ? [{ label: "تنبيه", value: "وقف تجريبي: بياناته اصطناعية ولا تصلح لمخرج حقيقي", prov: "system" as Provenance }] : []),
        ],
      }]));
    }
    case "conditions": {
      if (!c.waqf) return out(null);
      if (!c.conditions.length) {
        gaps.push({ key: "conditions", label: "شروط الواقف غير مسجلة نصًا في ملف الوقف", severity: def.specialty === "sharia" ? "blocking" : "warning", hint: "تُنقل من صك الوقفية إلى «الوثيقة والشروط» قبل التحليل." });
        return out(section("conditions", "شروط الواقف (النص الأصلي)", [{ type: "para", text: "لم تُسجَّل شروط الواقف نصًا في ملف الوقف. يُرجع إلى صك الوقفية.", prov: "unverified" }]));
      }
      return out(section("conditions", "شروط الواقف (النص الأصلي كما في ملف الوقف)", [
        { type: "list", items: c.conditions.map((x) => ({ text: `«${x.literal}»${x.clauseRef ? ` — ${x.clauseRef}` : ""}`, prov: "document" as Provenance, ref: x.clauseRef ?? "صك الوقفية" })) },
        ...(c.conditions.some((x) => x.interpretation) ? [{ type: "list" as const, items: c.conditions.filter((x) => x.interpretation).map((x) => ({ text: `تفسير مسجل: ${x.interpretation}${x.source ? ` (المصدر: ${x.source})` : " (مصدره غير مسجل)"}`, prov: (x.source ? "document" : "unverified") as Provenance })) }] : []),
      ]));
    }
    case "parties":
      return out(section("parties", "الأطراف", c.parties.length
        ? [{ type: "table", head: ["الصفة", "الاسم", "بيان"], rows: c.parties.map((p) => [p.role, p.name, p.detail ?? "—"]), prov: "system" }]
        : [{ type: "para", text: "لا أطراف مسجلة غير مقدّم الطلب.", prov: "system" }]));
    case "beneficiaries":
      if (!c.beneficiaries) return out(null);
      if (!c.beneficiaries.total && !c.beneficiaries.classes.length) gaps.push({ key: "beneficiaries", label: "سجل المستفيدين فارغ", severity: "warning" });
      return out(section("beneficiaries", "المستفيدون", [
        { type: "facts", rows: [
          { label: "المستفيدون النشطون", value: String(c.beneficiaries.active), prov: "computed" },
          { label: "إجمالي المسجلين", value: String(c.beneficiaries.total), prov: "computed" },
          { label: "مقيمون خارج المملكة", value: String(c.beneficiaries.abroad), prov: "computed" },
        ] },
        ...(c.beneficiaries.classes.length ? [{ type: "table" as const, head: ["الفئة", "الطبقة", "النصيب"], rows: c.beneficiaries.classes.map((k) => [k.name, k.tier == null ? "—" : String(k.tier), k.share ?? "—"]), prov: "system" as Provenance }] : []),
      ]));
    case "assets": {
      if (!c.waqf) return out(null);
      if (!c.assets.length) gaps.push({ key: "assets", label: "سجل الأصول فارغ", severity: def.specialty === "investment" ? "blocking" : "warning" });
      const stale = c.assets.filter((a) => !a.lastValuationOn || a.lastValuationOn < String(Number(c.today.slice(0, 4)) - 1) + c.today.slice(4));
      if (c.assets.length && stale.length) gaps.push({ key: "valuation", label: `${stale.length} أصل بلا تقييم خلال آخر 12 شهرًا`, severity: "warning", hint: "القيمة السوقية المعروضة آخر قيمة مسجلة وليست تقييمًا حديثًا." });
      const book = c.assets.reduce((s, a) => s + (a.bookValue ?? 0), 0);
      const market = c.assets.reduce((s, a) => s + (a.marketValue ?? 0), 0);
      const income = c.assets.reduce((s, a) => s + (a.annualIncome ?? 0), 0);
      return out(section("assets", "سجل الأصول (فعلي من ملف الوقف)", c.assets.length ? [
        { type: "table", head: ["الأصل", "الفئة", "الحالة", "القيمة الدفترية", "القيمة السوقية", "آخر تقييم", "الدخل السنوي"],
          rows: c.assets.map((a) => [a.title, a.category, a.status, fmt(a.bookValue), fmt(a.marketValue), a.lastValuationOn ?? "لا تقييم", fmt(a.annualIncome)]),
          total: ["الإجمالي", "", "", fmt(book), fmt(market), "", fmt(income)], prov: "system" },
        { type: "facts", rows: [
          { label: "عقود الإيجار النشطة", value: String(c.leases.active), prov: "computed" },
          { label: "متأخرات الإيجار المسجلة", value: fmt(c.leases.arrears), prov: "computed" },
          { label: "عقود تنتهي خلال 90 يومًا", value: String(c.leases.endingIn90), prov: "computed" },
        ] },
      ] : [{ type: "para", text: "لا أصول مسجلة في ملف الوقف.", prov: "system" }]));
    }
    case "finance": {
      if (!c.waqf) return out(null);
      const f = c.finance;
      if (!f || !f.entries) {
        gaps.push({ key: "ledger", label: "لا قيود مالية مسجلة للفترة", severity: def.specialty === "finance" ? "blocking" : "warning", hint: "تُسجل القيود في «المالية والصرف» أو تُرفق كشوف الحساب." });
        return out(section("finance", "الملخص المالي", [{ type: "para", text: f ? `لا قيود مسجلة بين ${f.from} و${f.to}.` : "لا قيود مالية مسجلة.", prov: "system" }]));
      }
      if (Math.abs(f.debit - f.credit) > 0.009) gaps.push({ key: "unbalanced", label: `القيود غير متوازنة: مدين ${fmt(f.debit)} ودائن ${fmt(f.credit)}`, severity: "blocking", hint: "راجع القيود قبل الاعتماد." });
      return out(section("finance", `الملخص المالي من القيود (${f.from} إلى ${f.to})`, [
        { type: "facts", rows: [
          { label: "عدد القيود", value: String(f.entries), prov: "computed" },
          { label: "الإيرادات", value: fmt(f.revenue), prov: "computed" },
          { label: "المصروفات", value: fmt(f.expense), prov: "computed" },
          { label: "صافي الفترة", value: fmt(f.net), prov: "computed" },
          { label: "المصروف على المستحقين", value: fmt(f.distributions), prov: "computed" },
          { label: "مجموع المدين / الدائن", value: `${fmt(f.debit)} / ${fmt(f.credit)}`, prov: "computed" },
        ] },
        { type: "table", head: ["الحساب", "الرصيد في الفترة"], rows: f.byAccount.map((a) => [`${a.code} ${a.label}`, fmt(a.amount)]), prov: "computed" },
        { type: "para", text: "الأرقام محسوبة من القيود المسجلة في المنصة كما هي، ولم تُدقق. القوائم المدققة يعدّها مراجع خارجي.", prov: "unverified" },
      ]));
    }
    case "budget":
      if (!c.waqf) return out(null);
      if (!c.budget) {
        gaps.push({ key: "budget", label: "لا موازنة مسجلة", severity: "warning" });
        return out(null);
      }
      return out(section("budget", `الموازنة ${c.budget.fiscalYear} (${c.budget.status === "approved" ? "معتمدة" : "غير معتمدة"})`, [
        { type: "table", head: ["البند", "المقدّر", "الفعلي"], rows: c.budget.lines.map((l) => [l.label, fmt(l.planned), l.actual == null ? "—" : fmt(l.actual)]), total: ["الإجمالي", fmt((c.budget.totalRevenue ?? 0) - (c.budget.totalExpense ?? 0)), ""], prov: "system" },
      ], false));
    case "distributions":
      if (!c.waqf || !c.distributions.length) return out(null);
      return out(section("distributions", "دفعات الصرف على المستحقين", [
        { type: "table", head: ["الفترة", "الحالة", "موعد الاستحقاق", "تاريخ الصرف", "المبلغ"], rows: c.distributions.map((d) => [d.period, d.status, d.dueBy ?? "—", d.paidOn ?? "—", fmt(d.total)]), prov: "system" },
      ], false));
    case "governance": {
      if (!c.waqf || !c.governance) return out(null);
      const g = c.governance;
      const missing = g.policies.filter((p) => p.status !== "approved");
      if (missing.length) gaps.push({ key: "policies", label: `${missing.length} من المتطلبات التنظيمية المساندة الاثني عشر غير معتمدة`, severity: "warning", hint: "تُعالج في «النصوص المقترحة»." });
      return out(section("governance", "الحوكمة: الواقع المسجل", [
        { type: "facts", rows: [
          { label: "الهيئات المسجلة", value: g.bodies.length ? g.bodies.map((b) => b.name).join("، ") : "لا هيئات مسجلة", prov: "system" },
          { label: "اجتماعات منعقدة خلال 12 شهرًا", value: String(g.meetingsHeld12m), prov: "computed" },
          { label: "قرارات خلال 12 شهرًا", value: String(g.resolutions12m), prov: "computed" },
        ] },
        { type: "table", head: ["المتطلب التنظيمي المساند", "الحالة"], rows: g.policies.map((p) => [p.label, POLICY_STATUS[p.status]]), prov: "system", ref: "الدليل المختصر لمهمات ومسؤوليات ناظر الوقف" },
      ]));
    }
    case "compliance":
      if (!c.waqf || !c.compliance) return out(null);
      if (c.compliance.overdue) gaps.push({ key: "overdue", label: `${c.compliance.overdue} التزامًا نظاميًا متأخرًا`, severity: "warning" });
      return out(section("compliance", "الالتزامات النظامية", [
        { type: "facts", rows: [
          { label: "منجزة", value: String(c.compliance.done), prov: "computed" },
          { label: "متأخرة", value: String(c.compliance.overdue), prov: "computed" },
          { label: "تقترب خلال 30 يومًا", value: String(c.compliance.dueSoon), prov: "computed" },
        ] },
        ...(c.compliance.overdueList.length ? [{ type: "list" as const, items: c.compliance.overdueList.map((o) => ({ text: `${o.title}${o.dueOn ? ` — كان موعدها ${o.dueOn}` : ""}`, prov: "system" as Provenance })) }] : []),
      ], false));
    case "beneficial_owners":
      if (!c.waqf || !c.beneficialOwners) return out(null);
      if (!c.beneficialOwners.total) gaps.push({ key: "bo", label: "سجل المستفيد الحقيقي فارغ", severity: "blocking", hint: "معايير المستفيد الحقيقي م5: الحد الأدنى من المعلومات." });
      if (c.beneficialOwners.unverified) gaps.push({ key: "bo_verify", label: `${c.beneficialOwners.unverified} سجلًا لم يُتحقق منه`, severity: "warning", hint: "التحقق سنويًا والتحديث خلال 15 يومًا من أي تغيير (م6/1)." });
      return out(section("beneficial_owners", "سجل المستفيد الحقيقي", [{ type: "facts", rows: [
        { label: "المسجلون", value: String(c.beneficialOwners.total), prov: "computed" },
        { label: "لم يُتحقق منهم", value: String(c.beneficialOwners.unverified), prov: "computed" },
        { label: "يحين تحققهم خلال 30 يومًا", value: String(c.beneficialOwners.dueVerification), prov: "computed" },
      ] }]));
    case "investment": {
      if (!c.waqf || !c.investment) return out(null);
      const p = c.investment.policy;
      if (!p && def.profile === "investment_policy") gaps.push({ key: "inv_policy", label: "لا سياسة استثمار مسجلة؛ تُبنى من إجابات الطلب وشروط الواقف", severity: "warning" });
      return out(section("investment", "الاستثمار: الوضع المسجل", [
        { type: "facts", rows: p ? [
          { label: "سياسة الاستثمار", value: `الإصدار ${p.version} — ${p.status === "approved" ? "معتمدة" : "غير معتمدة"}`, prov: "system" },
          { label: "العائد المستهدف", value: p.targetReturnPct == null ? "غير محدد" : `${p.targetReturnPct}٪ (مستهدف لا مضمون)`, prov: "assumption" },
          { label: "تحمل المخاطر", value: p.riskTolerance ?? "غير محدد", prov: "system" },
          { label: "المحظورات", value: p.prohibited ?? "—", prov: "system" },
          { label: "الرفع المالي", value: p.leverage ?? "—", prov: "system" },
        ] : [{ label: "سياسة الاستثمار", value: "غير مسجلة", prov: "system" }] },
        ...(c.investment.portfolios.length ? [{ type: "table" as const, head: ["مدير المحفظة", "الترخيص", "الاستراتيجية", "المخاطر"], rows: c.investment.portfolios.map((x) => [x.manager ?? "—", x.license ?? "—", x.strategy ?? "—", x.risk ?? "—"]), prov: "system" as Provenance }] : []),
      ]));
    }
    case "deed_clauses":
    case "will_clauses": {
      const input = { keys: c.keys ?? {}, tables: c.tables ?? {}, attached: Object.fromEntries(c.formDocs.map((f) => [f.key, f.attached])), requesterName: c.requester.name };
      const dr = kind === "will_clauses" ? draftWill(input) : draftDeed(input);
      gaps.push(...dr.gaps);
      const sections: OutputSection[] = [
        section(kind, `${dr.title} (مسودة مولدة من بيانات النموذج)`, [
          { type: "para", text: "صيغت البنود من اختيارات العميل في نموذج الطلب وفق مبادئ الصياغة في المراجع المذكورة مع كل بند. ما بين معقوفين [يُستكمل: …] لم يُقدَّم بعد ولا يُفترض. البند الذي يعدّله المختص يبقى بنصه عند إعادة التوليد.", prov: "system" },
          ...dr.clauses,
          { type: "signatures", rows: dr.signatures },
        ]),
        section(`${kind}:checks`, "فحوص الصياغة", [{ type: "list", items: dr.checks.map((x) => ({ text: `${x.ok ? "✓" : "✗"} ${x.label}${x.detail ? ` — ${x.detail}` : ""}`, prov: "computed" as Provenance })) }], false),
      ];
      return { sections, gaps };
    }
    case "checklist": {
      const rows = c.formDocs.map((s) => [s.label, s.required ? "مطلوب" : "عند الحاجة", s.attached ? `مرفق (${s.attached})` : "لم يُرفق"]);
      return out(section("checklist", "قائمة المستندات والمتطلبات", rows.length
        ? [{ type: "table", head: ["المتطلب", "الإلزام", "الحالة"], rows, prov: "system" }]
        : [{ type: "para", text: "لا مستندات محددة في نموذج الخدمة.", prov: "system" }]));
    }
    case "stages":
      return out(section("stages", "مراحل التنفيذ", c.stages.length
        ? [{ type: "table", head: ["المرحلة", "الحالة"], rows: c.stages.map((s) => [s.name, s.status]), prov: "system" }]
        : [{ type: "para", text: "لا مراحل.", prov: "system" }], false));
    case "nazara": {
      if (!c.nazara) {
        gaps.push({ key: "nazara", label: "لا ملف نظارة مرتبط بالطلب", severity: "blocking" });
        return out(null);
      }
      const missing = c.nazara.checklist.filter((i) => i.required && i.status === "لم يُستلم");
      if (missing.length) gaps.push({ key: "nazara_checklist", label: `${missing.length} بندًا مطلوبًا في قائمة الاستلام لم يُستلم`, severity: "blocking" });
      return out(section("nazara", `ملف النظارة ${c.nazara.number} — ${c.nazara.statusLabel}`, [
        { type: "table", head: ["بند الاستلام", "الحالة", "المرجع"], rows: c.nazara.checklist.map((i) => [i.label + (i.required ? "" : " (عند الانطباق)"), i.status, i.source]), prov: "system" },
      ]));
    }
    case "scope":
    case "references":
      return out(null);
  }
}

function sourcesOf(c: OutputContext, def: OutputDef): OutputSource[] {
  const out: OutputSource[] = c.formSources.map((s, i) => ({ code: `form-${i + 1}`, label: s, status: s.startsWith("تعريف الخدمة") ? "internal" : "verified", detail: "مصدر نموذج الخدمة" }));
  for (const code of PROFILE_REFS[def.profile]) {
    const r = c.refs.find((x) => x.code === code);
    if (!r) continue;
    out.push({ code, label: r.name, status: r.verification === "verified" ? "verified" : "pending_verification", detail: r.binding === "binding" ? "ملزم" : r.binding === "guidance" ? "استرشادي" : r.binding });
  }
  return out;
}

const SOURCE_STATUS: Record<OutputSource["status"], string> = { verified: "من ملفات المشروع", pending_verification: "بانتظار التحقق من صيغته", operational: "تشغيلي", internal: "تعريف داخلي" };

/** Builds the draft of an output from the collected context. */
export function buildDraft(c: OutputContext, def: OutputDef) {
  const t = TEMPLATES[def.profile];
  const sections: OutputSection[] = [];
  const gaps: OutputGap[] = [];
  for (const k of t.sections) {
    const b = build(k, c, def);
    sections.push(...b.sections);
    for (const g of b.gaps) if (!gaps.some((x) => x.key === g.key)) gaps.push(g);
  }
  for (const a of t.analysis) sections.push(section(`analysis:${a.key}`, a.title, [{ type: "specialist", prompt: a.prompt, text: "" }]));
  const sources = sourcesOf(c, def);
  sections.push(section("references", "المراجع", [
    { type: "list", items: sources.map((s) => ({ text: `${s.label} — ${SOURCE_STATUS[s.status]}${s.detail ? ` (${s.detail})` : ""}`, prov: s.status === "verified" ? "document" : "unverified" })) },
    ...(t.disclaimer ? [{ type: "para" as const, text: t.disclaimer, prov: "system" as Provenance }] : []),
  ]));
  if (c.waqf?.isDemo) gaps.push({ key: "demo", label: "الوقف تجريبي: المخرج للاختبار فقط", severity: "warning" });
  return { sections, gaps, sources, inputsHash: hashInputs(c) };
}

export function hashInputs(c: OutputContext) {
  return createHash("sha256").update(JSON.stringify({ ...c, today: null })).digest("hex").slice(0, 32);
}
