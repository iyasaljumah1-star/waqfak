/**
 * Waqf operations center (PURE): what the waqf file requires now, computed from its records — never assumed.
 * Each item says what is required, why (the record that shows it), what remains, who acts, where it is done, and what
 * it produces. «done» items are kept so the file shows what is complete as well as what is left.
 *
 * Nazara is shown as four distinct states — request, acceptance, readiness and actual practice — because accepting a
 * request is not appointment, and appointment is not practice (practice needs the appointment decision and licence).
 */
export type CenterState = "required" | "soon" | "done";
export type CenterItem = {
  key: string; area: string; title: string; state: CenterState; why: string; remaining?: string;
  owner: string; href: string; perm: string; output: string;
};
export type NazaraStage = { key: "request" | "acceptance" | "readiness" | "practice"; title: string; state: "done" | "current" | "pending" | "blocked"; detail?: string };

export type WaqfFacts = {
  today: string;
  waqfakIsNazir: boolean;
  deed: { no: string | null; date: string | null; docs: number; conditions: number };
  registration: { on: string | null; expiresOn: string | null };
  assets: { count: number; staleValuation: number };
  leases: { arrears: number; endingIn90: number };
  beneficiaries: { total: number; classes: number };
  finance: { entries90d: number; lastEntry: string | null };
  budget: { year: number | null; status: string | null; currentYear: number };
  distributions: { overdue: number };
  governance: { missingPolicies: number; totalPolicies: number; meetings12m: number };
  bo: { total: number; unverified: number; dueSoon: number };
  obligations: { overdue: { title: string; dueOn: string | null }[]; dueSoon: number };
  tasks: { open: number; overdue: number };
  requests: { id: string; number: string; service: string; status: string; waitingClient: boolean }[];
  nazara: null | {
    id: string; number: string; status: string; checklistMissing: number;
    appointmentComplete: boolean; appointmentMissing: string[]; isPractice: boolean; startedOn: string | null;
  };
};

const P = (id: string, seg: string) => `/app/w/${id}${seg ? `/${seg}` : ""}`;

export function waqfCenter(waqfId: string, f: WaqfFacts): { items: CenterItem[]; nazara: NazaraStage[] | null; counts: Record<CenterState, number> } {
  const nazir = f.waqfakIsNazir ? "فريق «وقفك» بصفته الناظر" : "ناظر الوقف";
  const items: CenterItem[] = [];
  const add = (i: CenterItem) => items.push(i);

  // Deed and conditions
  add({
    key: "deed", area: "الوثيقة والشروط", title: "بيانات صك الوقف", state: f.deed.no && f.deed.date ? "done" : "required",
    why: f.deed.no ? (f.deed.date ? `الصك ${f.deed.no}` : "تاريخ الصك غير مسجل") : "رقم الصك غير مسجل في الملف",
    owner: nazir, href: `${P(waqfId, "")}?edit=1#profile`, perm: "waqf.view", output: "ملف وقف بهويته النظامية",
  });
  add({
    key: "deed_doc", area: "الوثيقة والشروط", title: "صورة صك الوقفية في الوثائق", state: f.deed.docs ? "done" : "required",
    why: f.deed.docs ? `${f.deed.docs} مستند من نوع صك الوقفية` : "لا مستند من نوع «صك الوقفية»", owner: nazir, href: P(waqfId, "documents"), perm: "documents.view", output: "مرجع الشروط الأصلي",
  });
  add({
    key: "conditions", area: "الوثيقة والشروط", title: "شروط الواقف نصًا", state: f.deed.conditions ? "done" : "required",
    why: f.deed.conditions ? `${f.deed.conditions} شرطًا مسجلًا` : "لم تُنقل شروط الواقف نصًا من الصك", owner: nazir, href: P(waqfId, "deed"), perm: "deed.view", output: "شروط يُبنى عليها الصرف والاستثمار والمخرجات",
  });

  // Registration
  const regExpired = !!f.registration.expiresOn && f.registration.expiresOn < f.today;
  add({
    key: "registration", area: "التسجيل", title: f.registration.on ? "سريان شهادة التسجيل" : "تسجيل الوقف لدى الهيئة",
    state: !f.registration.on || regExpired ? "required" : "done",
    why: !f.registration.on ? "لا تاريخ تسجيل في الملف" : regExpired ? `الشهادة منتهية منذ ${f.registration.expiresOn}` : `مسجل في ${f.registration.on}`,
    remaining: !f.registration.on || regExpired ? "يتم لدى الهيئة العامة للأوقاف ثم يُحدَّث الملف" : undefined,
    owner: nazir, href: P(waqfId, "identity"), perm: "waqf.view", output: "شهادة تسجيل سارية",
  });

  // Assets and leases
  add({
    key: "assets", area: "الأصول", title: "سجل الأصول", state: !f.assets.count ? "required" : f.assets.staleValuation ? "soon" : "done",
    why: !f.assets.count ? "لا أصول مسجلة" : f.assets.staleValuation ? `${f.assets.staleValuation} من ${f.assets.count} أصلًا بلا تقييم خلال 12 شهرًا` : `${f.assets.count} أصلًا بتقييمات حديثة`,
    owner: nazir, href: P(waqfId, "assets"), perm: "assets.view", output: "أصول بقيم محدثة",
  });
  if (f.leases.arrears > 0 || f.leases.endingIn90 > 0) add({
    key: "leases", area: "الأصول", title: "الإيجارات", state: f.leases.arrears > 0 ? "required" : "soon",
    why: [f.leases.arrears > 0 ? `متأخرات مسجلة ${f.leases.arrears.toLocaleString("en-US")} ر.س` : "", f.leases.endingIn90 ? `${f.leases.endingIn90} عقدًا ينتهي خلال 90 يومًا` : ""].filter(Boolean).join("، "),
    owner: nazir, href: P(waqfId, "assets"), perm: "assets.view", output: "تحصيل المتأخرات وقرار التجديد",
  });

  // Beneficiaries
  add({
    key: "beneficiaries", area: "المستحقون", title: "سجل المستفيدين وفئاتهم", state: f.beneficiaries.total || f.beneficiaries.classes ? "done" : "required",
    why: f.beneficiaries.total || f.beneficiaries.classes ? `${f.beneficiaries.total} مستفيدًا و${f.beneficiaries.classes} فئة` : "السجل فارغ",
    owner: nazir, href: P(waqfId, "beneficiaries"), perm: "beneficiaries.view", output: "أساس الصرف على المستحقين",
  });
  if (f.distributions.overdue) add({
    key: "distributions", area: "المستحقون", title: "دفعات صرف فات موعدها", state: "required", why: `${f.distributions.overdue} دفعة لم تُصرف في موعدها`,
    owner: nazir, href: P(waqfId, "finance"), perm: "finance.view", output: "صرف موثق بالمستندات",
  });

  // Finance
  add({
    key: "ledger", area: "المالية", title: "قيود الفترة الجارية", state: f.finance.entries90d ? "done" : "required",
    why: f.finance.entries90d ? `${f.finance.entries90d} قيدًا خلال 90 يومًا` : f.finance.lastEntry ? `آخر قيد في ${f.finance.lastEntry}` : "لا قيود مالية مسجلة",
    owner: nazir, href: P(waqfId, "finance"), perm: "finance.view", output: "دفاتر يُبنى عليها البيان المالي",
  });
  const budgetOk = f.budget.year === f.budget.currentYear && f.budget.status === "approved";
  add({
    key: "budget", area: "المالية", title: `موازنة ${f.budget.currentYear}`, state: budgetOk ? "done" : "soon",
    why: f.budget.year === f.budget.currentYear ? (f.budget.status === "approved" ? "معتمدة" : "مسودة غير معتمدة") : "لا موازنة للسنة الجارية",
    owner: nazir, href: P(waqfId, "finance"), perm: "finance.view", output: "موازنة معتمدة",
  });

  // Governance
  add({
    key: "policies", area: "الحوكمة", title: "المتطلبات التنظيمية المساندة", state: f.governance.missingPolicies ? "soon" : "done",
    why: f.governance.missingPolicies ? `${f.governance.missingPolicies} من ${f.governance.totalPolicies} غير معتمدة` : "معتمدة كلها",
    owner: nazir, href: P(waqfId, "governance"), perm: "governance.view", output: "سياسات معتمدة",
  });

  // Beneficial owner
  add({
    key: "bo", area: "الامتثال", title: "سجل المستفيد الحقيقي", state: !f.bo.total || f.bo.unverified ? "required" : f.bo.dueSoon ? "soon" : "done",
    why: !f.bo.total ? "السجل فارغ" : f.bo.unverified ? `${f.bo.unverified} سجلًا لم يُتحقق منه` : f.bo.dueSoon ? `${f.bo.dueSoon} يحين تحققه خلال 30 يومًا` : "متحقق منه",
    owner: nazir, href: P(waqfId, "compliance"), perm: "bo.view", output: "سجل محدث (معايير المستفيد الحقيقي)",
  });

  // Obligations
  add({
    key: "obligations", area: "الامتثال", title: "الالتزامات النظامية", state: f.obligations.overdue.length ? "required" : f.obligations.dueSoon ? "soon" : "done",
    why: f.obligations.overdue.length ? `متأخر: ${f.obligations.overdue.slice(0, 3).map((o) => o.title).join("، ")}${f.obligations.overdue.length > 3 ? "…" : ""}` : f.obligations.dueSoon ? `${f.obligations.dueSoon} تستحق خلال 30 يومًا` : "لا متأخر ولا قريب",
    owner: nazir, href: P(waqfId, "compliance"), perm: "compliance.view", output: "إفصاحات وتقارير في مواعيدها",
  });

  // Tasks
  if (f.tasks.open) add({
    key: "tasks", area: "التشغيل", title: "المهام المفتوحة", state: f.tasks.overdue ? "required" : "soon",
    why: `${f.tasks.open} مهمة مفتوحة${f.tasks.overdue ? `، منها ${f.tasks.overdue} متأخرة` : ""}`, owner: nazir, href: P(waqfId, "tasks"), perm: "waqf.view", output: "مهام منجزة بمرفقاتها",
  });

  // Requests (two-way link with the waqf file)
  for (const r of f.requests) add({
    key: `req:${r.id}`, area: "الطلبات", title: `${r.service} — ${r.number}`, state: r.waitingClient ? "required" : "soon",
    why: r.waitingClient ? "بانتظار إجراء منك" : "قيد العمل لدى فريق «وقفك»", owner: r.waitingClient ? "مقدّم الطلب أو الناظر" : "فريق «وقفك»",
    href: `/app/requests/${r.id}`, perm: "requests.view", output: "مخرجات الخدمة في ملف الوقف",
  });

  // Nazara: request → acceptance → readiness → practice
  let nazara: NazaraStage[] | null = null;
  if (f.nazara) {
    const s = f.nazara.status;
    const reqDone = !["intake", "under_review", "pending_completion"].includes(s);
    const accepted = ["accepted", "active", "suspended", "ending", "ended"].includes(s);
    const practicing = ["active", "suspended", "ending"].includes(s) || s === "ended";
    nazara = [
      { key: "request", title: "طلب تولي النظارة ودراسته", state: s === "rejected" ? "blocked" : reqDone ? "done" : "current", detail: s === "pending_completion" ? `بانتظار استكمال ${f.nazara.checklistMissing} من بنود الاستلام` : s === "rejected" ? "رُفض الطلب" : f.nazara.checklistMissing ? `${f.nazara.checklistMissing} بندًا مطلوبًا لم يُستلم` : undefined },
      { key: "acceptance", title: "قرار القبول (داخلي)", state: accepted ? "done" : s === "rejected" ? "blocked" : "pending", detail: accepted ? "قبول الطلب ليس تعيينًا" : undefined },
      { key: "readiness", title: "الجاهزية للمباشرة: قرار التعيين والترخيص", state: practicing ? "done" : accepted ? (f.nazara.appointmentComplete ? "current" : "blocked") : "pending", detail: accepted && !practicing ? (f.nazara.appointmentComplete ? "قرار التعيين مكتمل؛ المباشرة تشترط ترخيص النظارة الساري" : `ينقص: ${f.nazara.appointmentMissing.join("، ")}`) : undefined },
      { key: "practice", title: "مباشرة النظارة فعليًا", state: practicing ? (s === "suspended" ? "blocked" : "done") : "pending", detail: practicing ? `${s === "suspended" ? "موقوفة" : s === "ended" ? "منتهية" : "قائمة"}${f.nazara.startedOn ? ` منذ ${f.nazara.startedOn}` : ""}${f.nazara.isPractice ? " (تجريبية على وقف تجريبي)" : ""}` : undefined },
    ];
  }
  const order: Record<CenterState, number> = { required: 0, soon: 1, done: 2 };
  items.sort((a, b) => order[a.state] - order[b.state]);
  const counts = { required: items.filter((i) => i.state === "required").length, soon: items.filter((i) => i.state === "soon").length, done: items.filter((i) => i.state === "done").length };
  return { items, nazara, counts };
}
