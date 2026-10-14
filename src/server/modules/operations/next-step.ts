/**
 * The request's execution plan (PURE): one ordered list of steps from receipt to closing, each with its state, owner,
 * blockers (with links to where they are fixed), the output it produces, and the single action that moves it.
 *
 * The plan never moves anything by itself: a «run» action names an existing server action (assign/verify/accept,
 * quote, contract, invoice, transition, output generate/submit/approve, stage advance) that keeps all its own
 * permission and guard checks. A «link» action points to the place where a human must enter or decide something.
 */
import type { RequestStatus } from "@/server/modules/requests/workflow";

export type Who = "client" | "team" | "ops" | "reviewer" | "specialist" | "finance" | "external" | "none";
export const WHO_AR: Record<Who, string> = {
  client: "العميل", team: "المختص المسند", ops: "مدير التشغيل", reviewer: "مراجع مستقل", specialist: "المختص",
  finance: "المالية", external: "جهة خارجية", none: "—",
};

export type RunKey =
  | "start_triage" | "verify_intake" | "accept" | "approve_quote" | "send_quote" | "approve_contract" | "send_contract"
  | "issue_invoice" | "approve_invoice" | "send_invoice" | "start_work" | "generate_output" | "submit_output" | "approve_output" | "complete_stage"
  | "to_quality" | "pass_quality" | "close" | "resume";

export type StepAction =
  | { kind: "run"; key: RunKey; label: string; args?: Record<string, string> }
  | { kind: "link"; href: string; label: string };
export type Blocker = { text: string; href?: string; who: Who };
export type StepState = "done" | "current" | "waiting" | "blocked" | "pending" | "skipped";
export type Step = {
  key: string; title: string; state: StepState; owner: Who; output?: string; detail?: string;
  blockers: Blocker[]; action?: StepAction;
};

export type OutputSnap = {
  key: string; title: string; specialty: string; id: string | null; status: "draft" | "in_review" | "returned" | "approved" | null;
  blocking: { label: string; fix?: string }[]; unwritten: string[]; returnedNote?: string | null;
  /** The viewer may approve under the output's policy (computed with approvalCheck). */
  viewerCanApprove: boolean; approveBlockedReason?: string; needsSignature: boolean;
  /** Approved, but the client (or quality review) sent the work back: a new review round must be opened. */
  needsRevision: boolean;
};

export type Snapshot = {
  id: string;
  status: RequestStatus;
  resumeTo: RequestStatus | null;
  holdParty: string | null;
  holdLabel: string | null;
  paid: boolean;
  conflictBlocked: boolean;
  assigneeName: string | null;
  viewer: { id: string; isOps: boolean; isAssignee: boolean; canDeliver: boolean; canQA: boolean; canApproveQuote: boolean; canApproveContract: boolean; isDeliverer: boolean; canApproveInvoice?: boolean };
  intake: { legacy: boolean; invalidFields: string[]; missingDocs: string[]; unverifiedDocs: string[]; verified: boolean; accepted: boolean };
  items: { clientOpen: number; awaitingReview: number; internalOpen: number };
  quote: { id: string; status: string; preparedByViewer: boolean; expired: boolean } | null;
  contract: { id: string; status: string; byViewer: boolean; pendingClient: string[]; companyPending: boolean; executed: boolean; clientSigned: boolean } | null;
  /** Before-start installments of the accepted quote. */
  prestart: { quoteId: string; key: string; label: string; invoiced: boolean; paid: boolean; invoiceId?: string | null; invoiceStatus?: string | null; sendError?: string | null }[];
  stages: { key: string; name: string; status: string }[];
  canAdvanceStage: boolean;
  outputs: OutputSnap[];
  deliverables: { submitted: number; unsignedOpinion: number };
  opinion: boolean;
  selfQA: boolean;
  waqf: { linked: boolean; name: string | null };
  /** Acceptance decided elsewhere (corporate nazara: the nazara file's acceptance decision accepts the request). */
  acceptVia?: { href: string; label: string; who: Who } | null;
};

const RANK: Record<string, number> = {
  draft: 0, submitted: 1, triage: 2, awaiting_client: 2, quote: 3, awaiting_contract: 4, in_progress: 5, quality_review: 6,
  awaiting_client_approval: 7, completed: 8, closed: 9,
};

const anchor = (id: string, a: string) => `/admin/requests/${id}#${a}`;

/** Builds the plan. `current` = the first step not done; `primary` = its action when the viewer may perform it. */
export function planRequest(s: Snapshot): { steps: Step[]; current: Step | null; primary: StepAction | null; terminal: boolean; held: Blocker | null } {
  const terminal = ["closed", "cancelled", "rejected"].includes(s.status);
  const eff = s.status === "on_hold" ? (s.resumeTo ?? "triage") : s.status;
  const rank = RANK[eff] ?? 0;
  const worker = s.viewer.isAssignee || s.viewer.isOps;
  const steps: Step[] = [];
  const add = (st: Step) => steps.push(st);

  // 1) Receipt and triage (a manager starts it directly; assignment is not a precondition)
  {
    const st: Step = { key: "receive", title: "استلام الطلب وبدء الفرز", owner: "ops", blockers: [], output: "طلب قيد الفرز", state: rank >= 2 ? "done" : "current" };
    if (rank < 2) {
      if (s.conflictBlocked) { st.state = "blocked"; st.blockers.push({ text: "تعارض استقلال: يقرر مدير التشغيل الاستثناء المسبب أو الرفض", who: "ops" }); }
      else if (worker) st.action = { kind: "run", key: "start_triage", label: "ابدأ الفرز" };
    }
    add(st);
  }

  // 2) Completeness and verification
  {
    const b: Blocker[] = [];
    if (s.conflictBlocked) b.push({ text: "تعارض استقلال قائم", who: "ops" });
    if (s.intake.invalidFields.length) b.push({ text: `حقول ناقصة أو غير صحيحة في النموذج: ${s.intake.invalidFields.slice(0, 4).join("، ")}${s.intake.invalidFields.length > 4 ? "…" : ""}`, who: "client", href: anchor(s.id, "items") });
    if (s.intake.missingDocs.length) b.push({ text: `مستندات مطلوبة لم تُرفق: ${s.intake.missingDocs.join("، ")}`, who: "client", href: anchor(s.id, "items") });
    if (s.items.clientOpen) b.push({ text: `${s.items.clientOpen} من النواقص بانتظار العميل`, who: "client", href: anchor(s.id, "items") });
    if (s.items.awaitingReview) b.push({ text: `${s.items.awaitingReview} مما استكمله العميل بانتظار مراجعتك`, who: "team", href: anchor(s.id, "items") });
    if (s.intake.unverifiedDocs.length) b.push({ text: `مستندات مرفوعة لم يُتحقق منها: ${s.intake.unverifiedDocs.join("، ")}`, who: "team", href: anchor(s.id, "doc-review") });
    const done = s.intake.verified || rank >= 5; // work started (legacy requests and operations packages predate the check)
    const st: Step = { key: "verify", title: "اكتمال البيانات والتحقق من المستندات", owner: "team", blockers: done ? [] : b, output: "بيانات ومستندات متحقق منها", state: done ? "done" : rank < 2 ? "pending" : "current" };
    if (!done && rank >= 2) {
      const clientOnly = b.length > 0 && b.every((x) => x.who === "client");
      if (clientOnly) { st.state = "waiting"; st.owner = "client"; }
      else if (b.length) { st.state = "blocked"; const first = b.find((x) => x.who === "team" && x.href); if (first && worker) st.action = { kind: "link", href: first.href!, label: first.who === "team" && first.href?.endsWith("doc-review") ? "راجع المستندات" : "راجع ما استكمله العميل" }; }
      else if (worker) st.action = { kind: "run", key: "verify_intake", label: "سجّل التحقق من البيانات والمستندات" };
    }
    add(st);
  }

  // 3) Acceptance
  add({
    key: "accept", title: "قبول الطلب للخدمة", owner: "team", blockers: [], output: "طلب مقبول للخدمة",
    state: s.intake.accepted || rank >= 5 ? "done" : s.intake.verified && rank >= 2 ? "current" : "pending",
    ...(!s.intake.accepted && s.intake.verified && worker && eff === "triage" ? { action: s.acceptVia ? { kind: "link" as const, href: s.acceptVia.href, label: s.acceptVia.label } : { kind: "run" as const, key: "accept" as const, label: "اقبل الطلب للخدمة" } } : {}),
    ...(s.acceptVia ? { owner: s.acceptVia.who, detail: "يُقبل طلب النظارة بقرار قبول ملف النظارة، لا من صفحة الطلب" } : {}),
  });

  // 4–6) Commercial path for paid services
  if (s.paid) {
    const q = s.quote;
    const quoteDone = !!q && q.status === "accepted";
    const startedWithout = rank >= 5 && !quoteDone; // started as an operations package, with no quote (allowed by the workflow)
    const qs: Step = { key: "quote", title: "نطاق العمل وعرض السعر", owner: "team", blockers: [], output: "عرض سعر مقبول", state: quoteDone ? "done" : startedWithout ? "skipped" : s.intake.accepted ? "current" : "pending" };
    if (startedWithout) qs.detail = "بدأ التنفيذ دون عرض سعر (اتفاق تشغيلي أو باقة)";
    if (!quoteDone && !startedWithout && s.intake.accepted) {
      if (!q || ["withdrawn", "rejected", "expired", "superseded"].includes(q.status) || q.expired && q.status === "sent") {
        qs.blockers.push({ text: q ? "لا عرض سارٍ: أعدّ نسخة جديدة" : "لم يُعدّ نطاق العمل وعرض السعر (يحدده المختص: البنود والمبالغ وشروط الدفع)", who: "team", href: anchor(s.id, "quote") });
        qs.state = "blocked";
        if (worker) qs.action = { kind: "link", href: anchor(s.id, "quote"), label: "أعدّ عرض السعر" };
      } else if (q.status === "draft") {
        if (s.viewer.canApproveQuote && !q.preparedByViewer) qs.action = { kind: "run", key: "approve_quote", label: "اعتمد عرض السعر", args: { quoteId: q.id } };
        else { qs.state = "waiting"; qs.owner = "ops"; qs.blockers.push({ text: "يعتمد العرضَ زميلٌ يملك صلاحية اعتماد العروض (غير من أعدّه)", who: "ops" }); }
      } else if (q.status === "approved") {
        if (worker) qs.action = { kind: "run", key: "send_quote", label: "أرسل العرض للعميل", args: { quoteId: q.id } };
      } else if (q.status === "sent") {
        qs.state = "waiting"; qs.owner = "client"; qs.blockers.push({ text: "بانتظار رد العميل على العرض", who: "client" });
      } else if (q.status === "change_requested") {
        qs.state = "blocked"; qs.blockers.push({ text: "طلب العميل تعديل العرض", who: "team", href: anchor(s.id, "quote") });
        if (worker) qs.action = { kind: "link", href: anchor(s.id, "quote"), label: "أعدّ نسخة معدلة من العرض" };
      }
    }
    add(qs);

    const k = s.contract;
    const kDone = !!k?.executed;
    const ks: Step = { key: "contract", title: "العقد وتوقيعه", owner: "team", blockers: [], output: "عقد نافذ موقّع من الأطراف", state: kDone ? "done" : startedWithout ? "skipped" : quoteDone ? "current" : "pending" };
    if (!kDone && quoteDone && rank < 5) {
      if (!k) {
        ks.state = "blocked"; ks.blockers.push({ text: "لم يُعدّ العقد: حدّد الأطراف وصفاتهم ومستندات التفويض", who: "team", href: anchor(s.id, "contract") });
        if (worker) ks.action = { kind: "link", href: anchor(s.id, "contract"), label: "أعدّ العقد" };
      } else if (k.status === "draft") {
        if (s.viewer.canApproveContract && !k.byViewer) ks.action = { kind: "run", key: "approve_contract", label: "اعتمد العقد", args: { contractId: k.id } };
        else { ks.state = "waiting"; ks.owner = "ops"; ks.blockers.push({ text: "يعتمد العقدَ زميلٌ يملك صلاحية اعتماد العقود (غير من أعدّه)", who: "ops" }); }
      } else if (k.status === "approved") {
        if (worker) ks.action = { kind: "run", key: "send_contract", label: "أرسل العقد للتوقيع", args: { contractId: k.id } };
      } else {
        if (k.pendingClient.length) ks.blockers.push({ text: `بانتظار توقيع: ${k.pendingClient.join("، ")}`, who: "client" });
        if (k.companyPending) ks.blockers.push({ text: "بانتظار توقيع المفوّض عن «وقفك» برمز التحقق", who: "ops", href: anchor(s.id, "contract") });
        const companyOnly = ks.blockers.length > 0 && ks.blockers.every((x) => x.who === "ops");
        ks.state = companyOnly && s.viewer.canApproveContract ? "current" : "waiting";
        ks.owner = companyOnly ? "ops" : "client";
        if (companyOnly && s.viewer.canApproveContract) ks.action = { kind: "link", href: anchor(s.id, "contract"), label: "وقّع عن الشركة" };
      }
    }
    add(ks);

    if (s.prestart.length) {
      const unpaid = s.prestart.filter((t) => !t.paid);
      const ps: Step = { key: "prestart", title: "الدفعة المشروطة قبل البدء", owner: "finance", blockers: [], output: "سداد الدفعة المقدمة", state: !unpaid.length ? "done" : kDone ? "current" : "pending" };
      if (unpaid.length && kDone) {
        const toIssue = unpaid.find((t) => !t.invoiced);
        const draft = unpaid.find((t) => t.invoiceStatus === "draft");
        const approved = unpaid.find((t) => t.invoiceStatus === "approved");
        if (toIssue) { if (worker) ps.action = { kind: "run", key: "issue_invoice", label: `أعدّ مسودة فاتورة «${toIssue.label}»`, args: { quoteId: toIssue.quoteId, termKey: toIssue.key } }; ps.owner = "team"; }
        else if (draft) {
          ps.owner = "finance";
          ps.detail = "المسودة لا يراها العميل. عاينها ثم تُعتمد.";
          if (s.viewer.canApproveInvoice) ps.action = { kind: "run", key: "approve_invoice", label: `اعتمد فاتورة «${draft.label}»`, args: { invoiceId: draft.invoiceId! } };
          else { ps.state = "waiting"; ps.blockers.push({ text: `مسودة فاتورة «${draft.label}» بانتظار اعتماد المالية`, who: "finance", href: anchor(s.id, "billing") }); }
        } else if (approved) {
          ps.owner = "team";
          if (approved.sendError) ps.blockers.push({ text: `فشلت محاولة إرسال سابقة: ${approved.sendError}`, who: "team", href: anchor(s.id, "billing") });
          if (worker || s.viewer.canApproveInvoice) ps.action = { kind: "run", key: "send_invoice", label: `أرسل فاتورة «${approved.label}» للعميل`, args: { invoiceId: approved.invoiceId! } };
        } else { ps.state = "waiting"; ps.owner = "client"; ps.blockers.push({ text: `بانتظار سداد: ${unpaid.map((t) => t.label).join("، ")}`, who: "client", href: anchor(s.id, "billing") }); }
      }
      add(ps);
    }
  }

  // 7) Start of execution
  {
    const ready = (s.intake.accepted || rank >= 5) && (!s.paid || (s.contract?.executed && s.prestart.every((t) => t.paid)));
    const started = rank >= 5;
    add({
      key: "start", title: "بدء التنفيذ", owner: "team", blockers: [], output: "مهام التنفيذ ومراحله",
      state: started ? "done" : ready ? "current" : "pending",
      ...(!started && ready && worker && ["triage", "awaiting_client", "awaiting_contract"].includes(eff) ? { action: { kind: "run" as const, key: "start_work" as const, label: "ابدأ التنفيذ" } } : {}),
    });
  }

  // 8) Outputs (platform-generated) or an uploaded deliverable
  const executing = eff === "in_progress";
  if (s.outputs.length) {
    for (const o of s.outputs) {
      const prepDone = (o.status === "in_review" || o.status === "approved") && !(executing && o.needsRevision);
      const prep: Step = { key: `prep:${o.key}`, title: `إعداد مسودة: ${o.title}`, owner: "specialist", detail: `تخصص المخرج: ${o.specialty}`, blockers: [], output: `مسودة «${o.title}» من بيانات الطلب والوقف`, state: prepDone || rank >= 6 ? "done" : executing ? "current" : "pending" };
      if (!prepDone && executing) {
        if (o.status === "approved" && o.needsRevision) {
          prep.blockers.push({ text: "أُعيد العمل للتعديل بعد اعتماد المخرج: افتح مراجعة جديدة ثم عدّل المسودة", who: "specialist", href: `/admin/requests/${s.id}/outputs/${o.id}` });
          prep.state = "blocked";
          prep.action = { kind: "link", href: `/admin/requests/${s.id}/outputs/${o.id}`, label: "افتح مراجعة جديدة للمخرج" };
        } else if (!o.id || !o.status) {
          if (s.viewer.canDeliver && worker) prep.action = { kind: "run", key: "generate_output", label: `أنشئ مسودة «${o.title}»`, args: { outputKey: o.key } };
        } else {
          for (const g of o.blocking) prep.blockers.push({ text: g.fix ? `${g.label} — ${g.fix}` : g.label, who: "client", href: anchor(s.id, "items") });
          for (const u of o.unwritten) prep.blockers.push({ text: `يكتبه المختص: ${u}`, who: "specialist", href: `/admin/requests/${s.id}/outputs/${o.id}` });
          if (o.status === "returned" && o.returnedNote) prep.blockers.unshift({ text: `أعاده المراجع: ${o.returnedNote}`, who: "specialist", href: `/admin/requests/${s.id}/outputs/${o.id}` });
          if (prep.blockers.length) {
            prep.state = "blocked";
            prep.action = { kind: "link", href: `/admin/requests/${s.id}/outputs/${o.id}`, label: "افتح المسودة وأكملها" };
          } else if (s.viewer.canDeliver && worker) prep.action = { kind: "run", key: "submit_output", label: "أرسل المسودة للمراجعة", args: { outputId: o.id } };
        }
      }
      add(prep);
      const appr: Step = { key: `approve:${o.key}`, title: `مراجعة واعتماد: ${o.title}`, owner: "reviewer", blockers: [], output: `«${o.title}» معتمد بنسخته`, state: (o.status === "approved" && !(executing && o.needsRevision)) || rank >= 6 ? "done" : o.status === "in_review" ? "current" : "pending" };
      if (o.status === "in_review") {
        if (o.viewerCanApprove) {
          appr.action = o.needsSignature
            ? { kind: "link", href: `/admin/requests/${s.id}/outputs/${o.id}`, label: "راجع واعتمد (يلزم توقيع المستشار)" }
            : { kind: "run", key: "approve_output", label: `اعتمد «${o.title}»`, args: { outputId: o.id! } };
        } else { appr.state = "waiting"; appr.blockers.push({ text: o.approveBlockedReason ?? "يعتمده مراجع مستقل", who: "reviewer" }); }
      }
      add(appr);
    }
  } else {
    const has = s.deliverables.submitted > 0;
    add({
      key: "deliverable", title: "إعداد المخرج وتسجيله", owner: "specialist", output: "مخرج مسجّل للتسليم", blockers: has || !executing ? [] : [{ text: "لا قالب توليد لهذه الخدمة: يُرفع المخرج المعدّ ويُسجَّل", who: "specialist", href: anchor(s.id, "outputs") }],
      state: has || rank >= 6 ? "done" : executing ? "blocked" : "pending",
      ...(!has && executing && s.viewer.canDeliver ? { action: { kind: "link" as const, href: anchor(s.id, "outputs"), label: "ارفع المخرج وسجّله" } } : {}),
    });
  }

  // 9) Work stages
  {
    const active = s.stages.find((x) => x.status === "active");
    const outputsDone = s.outputs.every((o) => o.status === "approved" && !o.needsRevision) && (s.outputs.length > 0 || s.deliverables.submitted > 0);
    let state: StepState;
    if (rank >= 6) state = "done";
    else if (!executing) state = "pending";
    else if (!s.canAdvanceStage) state = "done"; // the active stage is the last work stage
    else state = outputsDone ? "current" : "pending";
    const st: Step = { key: "stages", title: "مراحل العمل", owner: "team", blockers: [], output: s.stages.map((x) => x.name).join(" ← ") || undefined, detail: active ? `المرحلة الحالية: ${active.name}` : undefined, state };
    if (state === "current" && active && worker) st.action = { kind: "run", key: "complete_stage", label: `أنجزت مرحلة «${active.name}»` };
    if (s.stages.length) add(st);
  }

  // 10) Quality review
  {
    const qr: Step = { key: "quality", title: "مراجعة الجودة والإفراج للعميل", owner: "reviewer", blockers: [], output: "مخرجات مفرج عنها للعميل بصيغة PDF", state: rank >= 7 ? "done" : "pending" };
    if (executing) {
      const unfinished = s.outputs.filter((o) => o.status !== "approved" || o.needsRevision);
      if (!unfinished.length && (s.outputs.length || s.deliverables.submitted) && !s.canAdvanceStage) {
        qr.state = "current"; qr.owner = "team";
        if (worker) qr.action = { kind: "run", key: "to_quality", label: "أرسل لمراجعة الجودة" };
      }
    } else if (eff === "quality_review") {
      qr.state = "current";
      if (s.opinion && s.deliverables.unsignedOpinion) qr.blockers.push({ text: "الرأي المتخصص غير موقّع باسم المستشار وصفته", who: "specialist", href: anchor(s.id, "outputs") });
      const canPass = s.viewer.canQA && (!s.viewer.isDeliverer || s.selfQA);
      if (qr.blockers.length) qr.state = "blocked";
      else if (canPass) qr.action = { kind: "run", key: "pass_quality", label: s.viewer.isDeliverer ? "اعتمد الجودة (اعتماد ذاتي وفق سياسة المخرج) وأرسل للعميل" : "اعتمد الجودة وأرسل للعميل" };
      else { qr.state = "waiting"; qr.blockers.push({ text: s.viewer.isDeliverer ? "مبدأ العينين الأربع: يراجع الجودةَ زميلٌ غير من أعدّ العمل" : "يراجعه من يملك صلاحية مراجعة الجودة", who: "reviewer" }); }
    }
    add(qr);
  }

  // 11) Client approval
  add({
    key: "client_approval", title: "اعتماد العميل للمخرجات", owner: "client", blockers: eff === "awaiting_client_approval" ? [{ text: "بانتظار اعتماد العميل أو طلبه تعديلات", who: "client" }] : [], output: "مخرجات معتمدة من العميل",
    state: rank >= 8 ? "done" : eff === "awaiting_client_approval" ? "waiting" : "pending",
  });

  // 12) Closing
  add({
    key: "close", title: "إغلاق الطلب وأرشفة المخرجات", owner: "team", blockers: [], output: "ملف طلب مغلق ومخرجات محفوظة في الملف",
    state: rank >= 9 ? "done" : eff === "completed" ? "current" : "pending",
    ...(eff === "completed" && worker ? { action: { kind: "run" as const, key: "close" as const, label: "أغلق الطلب" } } : {}),
  });

  // Hold and terminal states override the action.
  let held: Blocker | null = null;
  if (s.status === "on_hold") held = { text: `الطلب معلّق — بانتظار ${s.holdLabel ?? "طرف آخر"}`, who: s.holdParty === "client" ? "client" : "external" };
  const current = terminal ? null : steps.find((x) => x.state !== "done" && x.state !== "skipped") ?? null;
  let primary: StepAction | null = null;
  if (!terminal) {
    if (held) primary = worker && s.resumeTo ? { kind: "run", key: "resume", label: "استأنف الطلب" } : null;
    else primary = current?.action ?? null;
  }
  if (terminal) for (const st of steps) if (st.state !== "done") st.state = "skipped";
  return { steps, current, primary, terminal, held };
}
