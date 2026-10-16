/**
 * The establishment journey of a waqf file (PURE), read from what is saved — never from a button press.
 *
 * One file, one journey: the wizard draft (before it is approved) and the waqf file (after) are the same record, so the
 * journey reads the wizard's saved answers while it is open, and the file's own records afterwards. Each step says what
 * it needs, whether it is met, who acts (the client, the «وقفك» team, or the competent authority) and where it is done.
 *
 * Official steps (documentation, registration) are met only with the instrument itself in the documents vault: an
 * entered number or date is the owner's statement, not proof.
 */

export type Owner = "client" | "team" | "authority";
export const OWNER_AR: Record<Owner, string> = { client: "مطلوب منك", team: "لدى فريق «وقفك»", authority: "لدى الجهة المختصة" };

export type StepState = "done" | "current" | "pending" | "blocked" | "na";
export type Gap = { key: string; text: string; href: string; owner: Owner };
export type JourneyStep = {
  key: "data" | "assets" | "terms" | "nazara" | "approve" | "drafting" | "documentation" | "registration" | "operations";
  title: string;
  /** What the step produces / why it matters. */
  purpose: string;
  state: StepState;
  owner: Owner;
  detail: string;
  href: string;
  gaps: Gap[];
};

export type JourneyStatusKey =
  | "draft" | "awaiting_client" | "data_complete" | "in_review" | "returned" | "ready_next" | "documenting" | "ready_ops" | "operating" | "sustained" | "ended";
export const JOURNEY_STATUS_AR: Record<JourneyStatusKey, string> = {
  draft: "مسودة", awaiting_client: "بانتظار استكمال العميل", data_complete: "مكتمل البيانات", in_review: "قيد المراجعة",
  returned: "معاد لاستكمال النواقص", ready_next: "جاهز للمرحلة التالية", documenting: "قيد التوثيق أو التسجيل",
  ready_ops: "جاهز للتشغيل", operating: "قيد التشغيل", sustained: "مستدام التشغيل", ended: "ملغى",
};

export type EstablishRequest = { id: string; number: string; code: string; status: string };
export type AssetGap = { id: string | null; title: string; missing: string[]; index?: number };

export type JourneyFacts = {
  today: string;
  waqf: {
    id: string; status: string; updatedAt: string; deedNo: string | null; deedDate: string | null; documentedOn: string | null;
    registeredOn: string | null; nazirMode: string | null;
  };
  /** The establishment wizard's saved state, when the file started there. */
  wizard: null | {
    finished: boolean; step: number; completed: number[]; missing: { step: number; text: string }[]; updatedAt: string;
    nazaraMode: string; assets: AssetGap[]; assetCount: number; boardMembers: number; boardChair: boolean;
  };
  file: {
    assets: number; assetGaps: AssetGap[]; ownershipDocs: number; needsOwnershipDocs: boolean; classes: number; conditions: number;
    trustees: number; board: null | { members: number; chair: boolean };
  };
  docs: { deed: number; registration: number };
  /** Establishment service requests on this file (T01–T09), newest first. */
  requests: EstablishRequest[];
  ops: { bo: number; budgetCurrent: boolean; policiesApproved: number; policiesTotal: number; meetings12m: number };
};

const OPEN_TEAM = ["submitted", "triage", "quote", "awaiting_contract", "in_progress", "quality_review", "on_hold"];
const WAITING_CLIENT = ["awaiting_client", "awaiting_client_approval"];
const DONE_REQ = ["completed", "closed"];

const W = (id: string, step: number, anchor = "") => `/app/establish/${id}?step=${step}${anchor ? `#${anchor}` : ""}`;
const F = (id: string, seg: string) => `/app/w/${id}${seg}`;

/** The establishment service request that drives drafting (T03), or documentation preparation (T06). */
const latest = (rs: EstablishRequest[], code: string) => rs.find((r) => r.code === code && r.status !== "cancelled" && r.status !== "rejected") ?? null;

export function journey(f: JourneyFacts) {
  const id = f.waqf.id;
  const wz = f.wizard;
  const open = !!wz && !wz.finished;
  const steps: JourneyStep[] = [];
  const add = (s: JourneyStep) => steps.push(s);
  const wizardGaps = (stepNos: number[], owner: Owner = "client") => (wz?.missing ?? []).filter((m) => stepNos.includes(m.step)).map((m, i) => ({ key: `wz:${m.step}:${i}`, text: m.text, href: W(id, m.step), owner }));

  // 1 — basic data (classification, founder, masarif, name)
  if (wz) {
    const need = [1, 2, 4, 7];
    const gaps = wizardGaps(need);
    const done = wz.finished || (need.every((n) => wz.completed.includes(n)) && !gaps.length);
    add({ key: "data", title: "بيانات الوقف الأساسية", purpose: "نوع الوقف والواقف والمصارف واسم الوقف", state: done ? "done" : "current", owner: "client",
      detail: done ? "محفوظة ومتحقق من اكتمالها" : `${gaps.length || need.filter((n) => !wz.completed.includes(n)).length} من البنود لم تُستكمل`, href: W(id, gaps[0] ? Number(gaps[0].href.match(/step=(\d+)/)?.[1]) : 1), gaps });
  } else {
    const done = f.file.classes > 0;
    add({ key: "data", title: "بيانات الوقف الأساسية", purpose: "نوع الوقف والواقف والمصارف", state: done ? "done" : "current", owner: "client", detail: done ? "مسجلة في ملف الوقف" : "المصارف غير مسجلة",
      href: F(id, "/beneficiaries#classes"), gaps: done ? [] : [{ key: "classes", text: "سجّل مصارف الوقف وفئات المستحقين", href: F(id, "/beneficiaries#classes"), owner: "client" }] });
  }

  // 2 — assets with what their type requires, and ownership documents
  {
    const gaps: Gap[] = [];
    if (open) {
      if (!wz!.assetCount) gaps.push({ key: "assets:none", text: "أضف أصلًا موقوفًا واحدًا على الأقل", href: W(id, 3, "assets"), owner: "client" });
      for (const a of wz!.assets) gaps.push({ key: `assets:wz:${a.index}`, text: `الأصل «${a.title || `رقم ${(a.index ?? 0) + 1}`}»: ${a.missing.join("، ")}`, href: W(id, 3, `asset-${a.index}`), owner: "client" });
    } else {
      if (!f.file.assets) gaps.push({ key: "assets:none", text: "لا أصول في ملف الوقف", href: F(id, "/assets?add=1#add-asset"), owner: "client" });
      for (const a of f.file.assetGaps) gaps.push({ key: `assets:${a.id}`, text: `الأصل «${a.title}»: ${a.missing.join("، ")}`, href: F(id, `/assets/${a.id}?edit=1#edit`), owner: "client" });
      if (f.file.needsOwnershipDocs && !f.file.ownershipDocs) gaps.push({ key: "assets:docs", text: "ارفع مستند ملكية الأصل (صك الملكية)", href: F(id, "/documents?upload=ownership_deed#upload"), owner: "client" });
    }
    add({ key: "assets", title: "الأصول ومستندات ملكيتها", purpose: "ما يُوقف، ببيانات تناسب نوعه، وما يثبت ملكية الواقف له", state: gaps.length ? (open && !wz!.completed.includes(3) ? "pending" : "current") : "done",
      owner: "client", detail: gaps.length ? `${gaps.length} من النواقص` : `${open ? wz!.assetCount : f.file.assets} أصل مكتمل البيانات`, href: open ? W(id, 3) : F(id, "/assets"), gaps });
  }

  // 3 — masarif, conditions, allocation
  {
    const gaps = open ? wizardGaps([4, 6]) : f.file.classes ? [] : [{ key: "classes", text: "لا مصارف في ملف الوقف", href: F(id, "/beneficiaries#classes"), owner: "client" as Owner }];
    const touched = open ? wz!.completed.includes(4) && wz!.completed.includes(6) : true;
    add({ key: "terms", title: "المصارف والشروط وتوزيع الغلة", purpose: "على من تُصرف الغلة، وشروط الواقف، وما يُقتطع قبل الصرف", state: gaps.length || !touched ? (open ? "pending" : "current") : "done",
      owner: "client", detail: gaps.length ? `${gaps.length} من النواقص` : !touched ? "لم تُحفظ بعد" : `${open ? "" : `${f.file.conditions} شرطًا مسجلًا`}`.trim() || "محفوظة",
      href: open ? W(id, 4, "conditions") : F(id, "/deed#conditions"), gaps: gaps.length || touched ? gaps : [{ key: "terms:open", text: "احفظ خطوتي المصارف وتوزيع الغلة", href: W(id, !wz!.completed.includes(4) ? 4 : 6), owner: "client" }] });
  }

  // 4 — nazara (a board needs its members and chair)
  {
    const gaps: Gap[] = [];
    const board = open ? wz!.nazaraMode === "board" : f.waqf.nazirMode === "board";
    if (open) {
      gaps.push(...wizardGaps([5]));
      if (!wz!.completed.includes(5) && !gaps.length) gaps.push({ key: "nazara:open", text: "حدّد صيغة النظارة والناظر", href: W(id, 5, "nazara"), owner: "client" });
      if (board && wz!.boardMembers < 3) gaps.push({ key: "board:members", text: `أعضاء مجلس النظارة: ${wz!.boardMembers} من 3 على الأقل`, href: W(id, 5, "board"), owner: "client" });
      if (board && wz!.boardMembers && !wz!.boardChair) gaps.push({ key: "board:chair", text: "حدّد رئيس مجلس النظارة", href: W(id, 5, "board"), owner: "client" });
    } else {
      if (!f.file.trustees && !f.file.board?.members) gaps.push({ key: "nazir", text: "لا ناظر مسجل في الملف", href: F(id, "/parties#trustees"), owner: "client" });
      if (board && (f.file.board?.members ?? 0) < 3) gaps.push({ key: "board:members", text: `أعضاء مجلس النظارة المسجلون: ${f.file.board?.members ?? 0} من 3 على الأقل`, href: F(id, "/parties#bodies"), owner: "client" });
      if (board && f.file.board && f.file.board.members && !f.file.board.chair) gaps.push({ key: "board:chair", text: "لم يُحدد رئيس مجلس النظارة", href: F(id, "/parties#bodies"), owner: "client" });
    }
    add({ key: "nazara", title: "النظارة", purpose: board ? "الناظر أو مجلس النظارة بأعضائه ورئيسه" : "من يتولى الوقف ومن يخلفه", state: gaps.length ? (open && !wz!.completed.includes(5) ? "pending" : "current") : "done",
      owner: "client", detail: gaps.length ? `${gaps.length} من النواقص` : board ? "مجلس مكتمل الأعضاء" : "محددة", href: open ? W(id, 5, "nazara") : F(id, "/parties"), gaps });
  }

  // 5 — approving the draft into the file (wizard only)
  if (wz) {
    const ready = steps.every((s) => s.state === "done");
    add({ key: "approve", title: "اعتماد المسودة وإنشاء ملف الوقف", purpose: "نقل البيانات المحفوظة إلى ملف الوقف ونص مسودة الوثيقة", state: wz.finished ? "done" : ready ? "current" : "pending", owner: "client",
      detail: wz.finished ? "اعتُمدت المسودة" : ready ? "البيانات مكتملة: راجع المسودة واعتمدها" : "تُعتمد بعد اكتمال الخطوات السابقة", href: W(id, 7, "approve"),
      gaps: !wz.finished && ready ? [{ key: "approve", text: "راجع مسودة الوثيقة واعتمدها", href: W(id, 7, "approve"), owner: "client" }] : [] });
  }

  const before = steps.every((s) => s.state === "done");
  const documentedEvidence = f.docs.deed > 0 && !!f.waqf.deedNo && !!(f.waqf.documentedOn || f.waqf.deedDate);
  const registeredEvidence = f.docs.registration > 0 && !!f.waqf.registeredOn;

  // 6 — drafting the deed with legal and sharia review (T03), unless the waqf is already documented
  const t03 = latest(f.requests, "T03");
  {
    let state: StepState, owner: Owner, detail: string, href: string;
    const gaps: Gap[] = [];
    if (documentedEvidence) { state = "na"; owner = "authority"; detail = "الوقف موثق"; href = F(id, "/deed"); }
    else if (!t03) {
      state = before ? "current" : "pending"; owner = "client"; detail = "لم يُطلب بعد"; href = `/app/requests/new?service=T03&waqf=${id}`;
      if (before) gaps.push({ key: "t03", text: "اطلب صياغة الوثيقة ومراجعتها الشرعية والقانونية، أو ارفع صك الوقف إن وُثّق", href, owner: "client" });
    } else if (t03.status === "draft") { state = "current"; owner = "client"; detail = `طلب ${t03.number} مسودة لم تُرسل`; href = `/app/requests/${t03.id}/intake`; gaps.push({ key: "t03:draft", text: `أكمل نموذج طلب الصياغة ${t03.number} وأرسله`, href, owner: "client" }); }
    else if (WAITING_CLIENT.includes(t03.status)) { state = "current"; owner = "client"; detail = `طلب ${t03.number} بانتظارك`; href = `/app/requests/${t03.id}`; gaps.push({ key: "t03:client", text: `استكمل ما طلبه الفريق في ${t03.number}`, href, owner: "client" }); }
    else if (DONE_REQ.includes(t03.status)) { state = "done"; owner = "team"; detail = `أُنجز في ${t03.number}`; href = `/app/requests/${t03.id}`; }
    else { state = "current"; owner = "team"; detail = `${t03.number} قيد العمل`; href = `/app/requests/${t03.id}`; }
    add({ key: "drafting", title: "صياغة الوثيقة ومراجعتها", purpose: "نص نهائي للوثيقة بمراجعة شرعية وقانونية قبل التوثيق", state, owner, detail, href, gaps });
  }

  // 7 — documentation with the competent authority: only with the instrument
  {
    const gaps: Gap[] = [];
    const ready = documentedEvidence;
    if (!ready) {
      if (!f.docs.deed) gaps.push({ key: "doc:deed", text: "ارفع صك الوقف بعد صدوره من الجهة المختصة", href: F(id, "/documents?upload=waqf_deed#upload"), owner: "authority" });
      if (!f.waqf.deedNo || !(f.waqf.documentedOn || f.waqf.deedDate)) gaps.push({ key: "deed:data", text: "سجّل رقم صك الوقف وتاريخ توثيقه", href: F(id, "?edit=1#profile"), owner: "client" });
    }
    const drafted = steps.find((s) => s.key === "drafting")!.state;
    add({ key: "documentation", title: "التوثيق لدى الجهة المختصة", purpose: "صك الوقف الصادر من الجهة المختصة (عبر ناجز)", state: ready ? "done" : drafted === "done" || drafted === "na" || f.waqf.status === "documenting" ? "current" : "pending",
      owner: ready ? "authority" : f.docs.deed ? "client" : "authority", detail: ready ? `الصك ${f.waqf.deedNo}` : f.waqf.deedNo && !f.docs.deed ? "رقم الصك مُدخل ولم يُرفع الصك: لا يُعد الوقف موثقًا" : "لم يُوثّق بعد",
      href: F(id, "/documents?upload=waqf_deed#upload"), gaps: ready ? [] : gaps });
  }

  // 8 — registration with the authority
  {
    const gaps: Gap[] = [];
    if (!registeredEvidence) {
      if (!f.docs.registration) gaps.push({ key: "doc:reg", text: "ارفع شهادة تسجيل الوقف لدى الهيئة بعد صدورها", href: F(id, "/documents?upload=registration_certificate#upload"), owner: "authority" });
      if (!f.waqf.registeredOn) gaps.push({ key: "reg:data", text: "سجّل تاريخ التسجيل لدى الهيئة", href: F(id, "?edit=1#profile"), owner: "client" });
    }
    const docDone = steps.find((s) => s.key === "documentation")!.state === "done";
    add({ key: "registration", title: "التسجيل لدى الهيئة العامة للأوقاف", purpose: "شهادة تسجيل سارية (خلال 30 يوم عمل من التوثيق)", state: registeredEvidence ? "done" : docDone ? "current" : "pending",
      owner: registeredEvidence ? "authority" : "authority", detail: registeredEvidence ? `مسجل في ${f.waqf.registeredOn}` : f.waqf.registeredOn && !f.docs.registration ? "تاريخ التسجيل مُدخل ولم تُرفع الشهادة: لا يُعد مسجلًا" : "لم يُسجّل بعد",
      href: F(id, "/documents?upload=registration_certificate#upload"), gaps: registeredEvidence ? [] : gaps });
  }

  // 9 — ready to operate
  {
    const gaps: Gap[] = [];
    if (!f.ops.bo) gaps.push({ key: "bo", text: "سجل المستفيد الحقيقي", href: F(id, "/beneficiaries#bo"), owner: "client" });
    if (!f.ops.budgetCurrent) gaps.push({ key: "budget", text: "موازنة السنة الجارية", href: F(id, "/finance#budget"), owner: "client" });
    if (!f.ops.policiesApproved) gaps.push({ key: "policies", text: "اعتماد أول سياسة حوكمة (مثل تعارض المصالح)", href: F(id, "/governance#policies"), owner: "client" });
    const regDone = registeredEvidence;
    add({ key: "operations", title: "تجهيز التشغيل والإدارة", purpose: "سجل المستفيد الحقيقي، والموازنة، والسياسات الأساسية", state: gaps.length ? (regDone ? "current" : "pending") : "done", owner: "client",
      detail: gaps.length ? `${gaps.length} من المتطلبات` : "جاهز", href: F(id, "/governance"), gaps: regDone ? gaps : [] });
  }

  // status, owner of the next action, and why it stops
  const t06 = latest(f.requests, "T06");
  const firstOpen = steps.find((s) => s.state === "current") ?? steps.find((s) => s.state === "pending") ?? null;
  const operationsReady = steps.find((s) => s.key === "operations")!.state === "done";
  const sustained = operationsReady && f.ops.policiesApproved >= f.ops.policiesTotal && f.ops.meetings12m > 0;
  let status: JourneyStatusKey;
  if (f.waqf.status === "ended") status = "ended";
  else if (open && wz!.completed.length <= 1 && wz!.step <= 1) status = "draft";
  else if (!before) status = "awaiting_client";
  else if (registeredEvidence) status = sustained ? "sustained" : operationsReady ? "operating" : "ready_ops";
  else if (documentedEvidence || f.waqf.status === "documenting" || (t06 && !DONE_REQ.includes(t06.status) && t06.status !== "draft") || f.docs.deed || f.docs.registration) status = "documenting";
  else if (t03 && WAITING_CLIENT.includes(t03.status)) status = "returned";
  else if (t03 && OPEN_TEAM.includes(t03.status)) status = "in_review";
  else if (t03 && DONE_REQ.includes(t03.status)) status = "ready_next";
  else status = "data_complete";

  // the five journey stages shown across the platform (تأسيس، توثيق وتسجيل، تشغيل، مأسسة، استدامة)
  const stage = !before ? 1 : !registeredEvidence ? 2 : !operationsReady ? 3 : !sustained ? 4 : 5;
  const applicable = steps.filter((s) => s.state !== "na");
  const done = applicable.filter((s) => s.state === "done").length;
  const gaps = steps.flatMap((s) => s.gaps);
  const resume = open
    ? { href: W(id, firstIncompleteWizardStep(wz!)), label: "استكمال تأسيس الوقف" }
    : firstOpen && firstOpen.state !== "done" ? { href: firstOpen.gaps[0]?.href ?? firstOpen.href, label: firstOpen.key === "documentation" || firstOpen.key === "registration" ? "تابع التوثيق والتسجيل" : "استكمال تأسيس الوقف" } : null;
  const reason = status === "awaiting_client" ? `بانتظار: ${gaps.filter((g) => g.owner === "client").slice(0, 2).map((g) => g.text).join("؛ ") || firstOpen?.title}`
    : status === "in_review" ? `طلب الصياغة ${t03?.number} لدى فريق «وقفك»`
    : status === "returned" ? `أعاد الفريق طلب ${t03?.number} لاستكمال نواقص`
    : status === "documenting" || status === "ready_next" ? "التوثيق والتسجيل يتمّان لدى الجهة المختصة، ثم يُرفع ما يثبتهما"
    : status === "data_complete" ? "اكتملت البيانات: الخطوة التالية صياغة الوثيقة أو رفع صك الوقف إن وُثّق"
    : null;
  return {
    status, statusLabel: JOURNEY_STATUS_AR[status], stage, steps, gaps, current: firstOpen,
    next: firstOpen ? steps[steps.indexOf(firstOpen) + 1] ?? null : null,
    owner: firstOpen?.owner ?? null, reason, resume,
    progress: { done, total: applicable.length, pct: applicable.length ? Math.round((done / applicable.length) * 100) : 0 },
    documented: documentedEvidence, registered: registeredEvidence,
  };
}

/** The first wizard step not yet completed (or the review step when all are). */
export function firstIncompleteWizardStep(wz: { completed: number[]; missing: { step: number }[] }) {
  const firstMissing = wz.missing.map((m) => m.step).sort((a, b) => a - b)[0];
  for (let i = 1; i <= 7; i++) if (!wz.completed.includes(i)) return Math.min(i, firstMissing ?? i);
  return firstMissing ?? 7;
}

export type Journey = ReturnType<typeof journey>;
