import Link from "next/link";
import { Eye, FileDown } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, Badge, DefinitionList, Panel, Stat } from "@/components/ui";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ActionForm } from "@/components/requests/forms";
import { fmtDate } from "@/lib/utils";
import type { ActionState } from "@/lib/utils";
import { ACCEPTANCE_AR, CADENCE_AR, PHASE_AR, type Cadence } from "@/server/modules/operations/continuous-pure";
import { PaymentScheduleTable, type ScheduleRow } from "@/components/billing/payment-schedule";
import type { continuousView } from "@/server/modules/operations/continuous";
import { CONTRACT_STATUS_LABEL } from "@/server/modules/commerce/pure";

type Act = (s: ActionState, fd: FormData) => Promise<ActionState>;
type View = NonNullable<Awaited<ReturnType<typeof continuousView>>>;
type Actions = {
  setupTerm: Act; extendTerm: Act; terminateService: Act; openCycle: Act; toggleCycleCheck: Act; linkCycleMeeting: Act;
  rescheduleCycle: Act; sendCycle: Act; closeCycle: Act; skipCycle: Act; raiseItem: Act; changeAcceptance: Act;
};

const PHASE_TONE: Record<string, "ok" | "info" | "warn" | "fine" | "neutral" | "critical" | "ink"> = {
  preparing: "info", returned: "fine", in_review: "warn", approved: "ink", client_review: "warn", client_revision: "fine", client_approved: "ok",
  followup: "info", closed: "neutral", skipped: "neutral",
};
const TERM_TONE: Record<string, "ok" | "fine" | "neutral" | "warn"> = { active: "ok", suspended: "fine", terminated: "warn", ended: "neutral" };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex flex-wrap items-baseline justify-between gap-2 py-1.5"><span className="text-sm text-muted">{label}</span><span className="text-sm">{children}</span></div>;
}

/**
 * The continuous-service dashboard of a request: term and contract, current and next cycle, counts (done, late,
 * pending), what awaits review/approval/sending, deficiencies and tasks, cycle history, and — kept apart — the
 * financial due cycle of the contract's installments.
 */
export function ContinuousPanel({ v, requestId, status, worker, ops, canDeliver, nextAction, a, defaults, schedule }: {
  v: View; requestId: string; status: string; worker: boolean; ops: boolean; canDeliver: boolean; nextAction: string | null; a: Actions;
  defaults: { startOn: string; endOn: string; cadence: Cadence | null; customDates: string; clientPreference: Cadence | null };
  schedule: ScheduleRow[];
}) {
  const t = v.term;
  const running = status === "in_progress";
  const active = v.cycles.filter((c) => c.status === "open" || c.status === "sent");
  const history = v.cycles.filter((c) => c.status === "closed" || c.status === "skipped").reverse();
  const awaiting = v.cycles.filter((c) => c.phase === "in_review" || c.phase === "approved" || c.phase === "client_review" || c.phase === "client_revision");
  const spec = v.spec;
  const cadence = (t?.cadence ?? defaults.cadence) as Cadence | null;
  const eventCadence = cadence === "event";
  return (
    <div className="space-y-4" data-testid="continuous-panel">
      <Panel title="الخدمة المستمرة" description={`${spec.delivery.title} — ${cadence ? `دورية ${CADENCE_AR[cadence]}` : "الدورية غير محددة بعد"}. يبقى الطلب مفتوحًا طوال مدة الخدمة، ولا يُغلقه اعتماد تسليم أو إتاحته.`}>
        {!t && v.cadenceUnset ? (
          <Alert tone="fine" title="الدورية غير محددة" className="mb-4">
            لا تحدد ملفات المشروع ولا العرض المقبول دورية تسليمات هذه الخدمة. تُحدد ضمن نطاق العقد عند تفعيل المدة أدناه، ولا تُنشأ أي دورة أو موعد قبل ذلك.
          </Alert>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="مدة الخدمة" value={v.termLabel ?? "لم تُحدد"} sub={t ? `${t.startOn} إلى ${v.effectiveEnd}` : "تُحدد من العقد"} tone={v.termState === "suspended" ? "fine" : undefined} />
          <Stat label="تسليمات مكتملة" value={v.counts.done} sub={v.counts.skipped ? `${v.counts.skipped} متجاوزة بسبب` : undefined} tone="ok" />
          <Stat label="متأخرة" value={v.counts.late} tone={v.counts.late ? "critical" : undefined} sub={v.termState === "suspended" ? "لا يُحسب التأخر أثناء التعليق" : undefined} />
          <Stat label="قيد العمل" value={v.counts.pending} sub={`${v.counts.awaitingReview} بانتظار الاعتماد الداخلي · ${v.counts.awaitingSend} بانتظار الإتاحة · ${v.counts.awaitingClient} بانتظار العميل`} />
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="divide-y divide-line rounded-md border border-line px-3" data-testid="continuous-status">
            <Row label="حالة الطلب">{status === "in_progress" ? "قيد التنفيذ (مستمر)" : status === "on_hold" ? "معلّق" : status === "completed" ? "مكتمل" : status}</Row>
            <Row label="حالة المدة"><Badge tone={TERM_TONE[v.termState ?? "neutral"] ?? "neutral"} icon={false}>{v.termLabel ?? "لم تُحدد"}</Badge></Row>
            <Row label="العقد">{v.contract ? <><bdi dir="ltr" className="tabular">{v.contract.number}</bdi> — {CONTRACT_STATUS_LABEL[v.contract.status as keyof typeof CONTRACT_STATUS_LABEL] ?? v.contract.status}{v.contract.executedAt ? ` (نافذ ${fmtDate(v.contract.executedAt)})` : ""}</> : "لا عقد مسجل (اتفاق تشغيلي)"}</Row>
            <Row label="اعتماد العميل للتسليمات">{ACCEPTANCE_AR[v.acceptance]}</Row>
            {v.quote ? <Row label="النطاق المتفق عليه">العرض <bdi dir="ltr" className="tabular">{v.quote.number}</bdi>{v.quote.durationDays ? ` · ${v.quote.durationDays} يومًا` : ""}</Row> : null}
            {t?.status === "terminated" ? <Row label="الإنهاء">{t.terminationReason} — نافذ {t.terminatedOn} (المرجع: {t.terminationRef})</Row> : null}
            {t?.status === "suspended" ? <Row label="التعليق">{t.suspendReason ?? "—"}</Row> : null}
          </div>
          <div className="divide-y divide-line rounded-md border border-line px-3" data-testid="continuous-next">
            <Row label="الدورة الحالية">{v.current ? <>{v.current.label} — تستحق {v.current.dueOn} {v.current.late ? <Badge tone="critical" icon={false}>متأخرة</Badge> : null}</> : "لا دورة مفتوحة"}</Row>
            <Row label="الدورة التالية">{v.next ? <>{v.next.label} — تستحق {v.next.due}</> : eventCadence ? "تُفتح عند الحدث (اجتماع أو دفعة)" : "لا فترات متبقية"}</Row>
            <Row label="النواقص">{v.items.clientOpen} بانتظار العميل · {v.items.internalOpen} داخلية</Row>
            <Row label="المهام المفتوحة">{v.openTasks}</Row>
            <Row label="الإجراء التالي">{nextAction ?? "—"}</Row>
          </div>
        </div>
        {awaiting.length ? (
          <Alert tone="info" title="مخرجات تنتظر إجراء" className="mt-4">
            <ul className="list-disc ps-5">{awaiting.map((c) => <li key={c.id}>{c.label}: {PHASE_AR[c.phase]}{c.output ? <> — <Link className="underline" href={`/admin/requests/${requestId}/outputs/${c.output.id}`}>افتح المخرج</Link></> : null}</li>)}</ul>
          </Alert>
        ) : null}
        {v.endBlockers.length && (v.termState === "ended" || v.termState === "terminated") ? (
          <Alert tone="fine" title="قبل إنهاء الخدمة" className="mt-4"><ul className="list-disc ps-5">{v.endBlockers.map((b) => <li key={b}>{b}</li>)}</ul></Alert>
        ) : null}
      </Panel>

      {!t ? (
        worker && ["in_progress", "on_hold"].includes(status) ? (
          <Panel title="حدّد مدة الخدمة ودوريتها" description={spec.basis}>
            <ActionForm action={a.setupTerm} hidden={{ id: requestId }} submit="فعّل مدة الخدمة وجدول التسليمات">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="بداية الخدمة" name="startOn" required><Input type="date" name="startOn" required defaultValue={defaults.startOn} /></Field>
                <Field label="نهاية الخدمة" name="endOn" required hint="من مدة العقد أو العرض"><Input type="date" name="endOn" required defaultValue={defaults.endOn} /></Field>
                <Field label="دورية التسليم كما في العقد" name="cadence" required
                  hint={v.quoteCadence?.cadence ? "من العرض المقبول" : spec.cadence ? `محددة: ${spec.cadenceSource}` : `غير محددة: اخترها من العقد.${defaults.clientPreference ? ` طلب العميل في النموذج: ${CADENCE_AR[defaults.clientPreference]}.` : ""}`}>
                  <Select name="cadence" required defaultValue={defaults.cadence ?? ""} placeholder="اختر الدورية المتفق عليها" options={spec.allowed.map((c) => ({ value: c, label: CADENCE_AR[c] }))} />
                </Field>
                <Field label="أيام الاستحقاق بعد نهاية الفترة" name="dueOffsetDays" required><Input type="number" name="dueOffsetDays" min={0} max={90} required defaultValue={String(spec.dueOffsetDays)} /></Field>
              </div>
              <Field label="تواريخ التسليم أو مراحله (للدورية «تواريخ أو مراحل تعاقدية»)" name="customDates" hint="سطر لكل تسليم: التاريخ | الوصف. مثل: 2026-12-31 | تقرير اعتماد الخطة">
                <Textarea name="customDates" rows={3} defaultValue={defaults.customDates} dir="auto" />
              </Field>
              <Field label="اعتماد العميل للتسليمات" name="clientAcceptance" hint={spec.acceptance.fixed ? "ثابت لهذه الخدمة" : "يُضبط بخلاف الأصل بقرار مدير التشغيل وسبب مكتوب"}>
                <Select name="clientAcceptance" defaultValue={spec.acceptance.mode} disabled={spec.acceptance.fixed || !ops} options={(["required", "info"] as const).map((m) => ({ value: m, label: ACCEPTANCE_AR[m] }))} />
              </Field>
              <Field label="ملاحظة ومرجع العقد" name="note"><Input name="note" maxLength={1000} /></Field>
            </ActionForm>
          </Panel>
        ) : <Alert tone="info">تُحدد مدة الخدمة بعد بدء التنفيذ.</Alert>
      ) : null}

      {active.map((c) => (
        <Panel key={c.id} id={`cycle-${c.seq}`} title={`${c.kind === "closing" ? "تسليم نهاية الخدمة" : "دورة"} ${c.seq}: ${c.label}`}
          description={`تستحق ${c.dueOn}${c.periodStart && c.periodEnd && c.periodStart !== c.periodEnd ? ` · الفترة ${c.periodStart} إلى ${c.periodEnd}` : ""} · المسؤول: ${c.assignee ?? "—"}`}
          actions={<span className="flex gap-2"><Badge tone={PHASE_TONE[c.phase]} icon={false}>{PHASE_AR[c.phase]}</Badge>{c.late ? <Badge tone="critical" icon={false}>متأخرة</Badge> : null}</span>}>
          <div className="space-y-4" data-testid={`cycle-${c.seq}`}>
            <DefinitionList cols={3} items={[
              { label: "المخرج المتوقع", value: c.kind === "closing" ? spec.closing?.title ?? "—" : spec.delivery.title },
              { label: "حالة المراجعة والاعتماد", value: c.output ? `${PHASE_AR[c.phase]}${c.output.approvedVersion ? ` (اعتُمدت النسخة ${c.output.approvedVersion}${c.output.approvedBy ? ` من ${c.output.approvedBy}` : ""})` : ""}` : spec.delivery.kind === "followup" ? "متابعة بلا مستند" : spec.delivery.kind === "minutes" ? "محضر يعتمده المجلس" : "لم تُعدّ مسودة" },
              { label: "تاريخ التسليم الفعلي", value: c.deliveredOn ?? "لم يُسلَّم" },
            ]} />
            {c.returnedNote ? <Alert tone="fine" title="أعاده المراجع للتعديل">{c.returnedNote}</Alert> : null}
            {c.blocking.length || c.unwritten.length ? (
              <Alert tone="fine" title="نواقص المسودة">
                <ul className="list-disc ps-5">{c.blocking.map((b) => <li key={b}>{b}</li>)}{c.unwritten.map((u) => <li key={u}>يكتبه المختص: {u}</li>)}</ul>
              </Alert>
            ) : null}
            {c.inputs.length ? (
              <div>
                <p className="mb-1 text-sm font-medium">المعلومات والمستندات اللازمة</p>
                <ul className="space-y-1.5" data-testid={`cycle-${c.seq}-inputs`}>
                  {c.inputs.map((i) => (
                    <li key={i.key} className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge tone={i.ok ? "ok" : "fine"} icon={false}>{i.ok ? "متوفر" : "ناقص"}</Badge>{i.label}: <span className="text-muted">{i.detail}</span>
                      {!i.ok && worker && running ? (
                        <ActionForm action={a.raiseItem} inline size="sm" variant="ghost" submit="اطلب استكماله من العميل"
                          hidden={{ id: requestId, kind: "data", title: `استكمال لدورة «${c.label}»: ${i.label}`, body: `${i.detail}. مطلوب لإعداد تسليم الدورة المستحق في ${c.dueOn}.`, visibility: "client" }} />
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div>
              <p className="mb-1 text-sm font-medium">مهام الدورة</p>
              <ul className="space-y-1" data-testid={`cycle-${c.seq}-checklist`}>
                {(c.checklist ?? []).map((x) => (
                  <li key={x.key} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className={x.done ? "text-muted line-through" : ""}>{x.label}</span>
                    {worker && running ? (
                      <ActionForm action={a.toggleCycleCheck} inline size="sm" variant={x.done ? "ghost" : "secondary"} hidden={{ cycleId: c.id, key: x.key, done: x.done ? "" : "on" }} submit={x.done ? "أعد فتحه" : `أنجزت: ${x.label}`} />
                    ) : <Badge tone={x.done ? "ok" : "neutral"} icon={false}>{x.done ? "منجز" : "لم يُنجز"}</Badge>}
                  </li>
                ))}
              </ul>
            </div>
            {spec.inputs.some((i) => i.check === "meeting_linked") && c.status === "open" && worker && running ? (
              <ActionForm action={a.linkCycleMeeting} hidden={{ cycleId: c.id }} submit={c.meeting ? "غيّر الاجتماع" : "اربط الاجتماع"} size="sm" variant="secondary">
                <Field label="اجتماع المجلس" name={`mtg-${c.id}`} required hint={c.meeting ? `المرتبط: ${c.meeting.title}` : "من اجتماعات الوقف في وحدة الحوكمة"}>
                  <Select id={`mtg-${c.id}`} name="meetingId" required defaultValue={c.meetingId ?? ""} placeholder="اختر الاجتماع" options={v.waqfMeetings.map((m) => ({ value: m.id, label: `${m.title} — ${fmtDate(m.at)}` }))} />
                </Field>
              </ActionForm>
            ) : null}
            <div className="rounded-md border border-line px-3" data-testid={`cycle-${c.seq}-approvals`}>
              <Row label="الاعتماد المهني الداخلي">{c.output?.approvedVersion ? `النسخة ${c.output.approvedVersion} — ${c.output.approvedBy ?? "—"}${c.output.approvedAt ? ` (${fmtDate(c.output.approvedAt)})` : ""}` : spec.delivery.kind === "output" || c.kind === "closing" ? "لم يُعتمد" : "لا ينطبق"}</Row>
              <Row label="الإتاحة للعميل في المنصة">{c.sentAt ? `أُتيح ${fmtDate(c.sentAt)}${c.sentByName ? ` — ${c.sentByName}` : ""}` : "لم يُتح"}</Row>
              <Row label="اطلاع العميل">{c.viewedAt ? `اطّلع عليه ${fmtDate(c.viewedAt)}` : c.sentAt ? "لم يُسجَّل اطلاع" : "—"}</Row>
              <Row label="اعتماد العميل للاستلام">{c.clientDecision === "approved" ? `اعتمده ${c.clientDecisionByName ?? "—"} في ${fmtDate(c.clientDecisionAt!)} (النسخة ${c.clientApprovedVersion ?? "—"})` : c.clientDecision === "revision_requested" ? `طلب تعديلًا: ${c.clientDecisionNote}` : c.sentAt ? (v.acceptance === "required" ? "بانتظار رده — لا يُعد سكوته اعتمادًا" : "للإحاطة: لم يرد") : "—"}</Row>
              {c.record ? <Row label="محضر التسليم">{c.record.status === "approved" ? `معتمد — ${c.record.approvedBy ?? "—"}` : c.record.outputId ? PHASE_AR[(c.record.status === "in_review" ? "in_review" : "preparing")] : "لم يُعدّ"}{c.record.outputId ? <> · <Link className="underline" href={`/admin/requests/${requestId}/outputs/${c.record.outputId}`}>معاينته</Link></> : c.status === "sent" ? <> · <Link className="underline" href={`/admin/requests/${requestId}/outputs/preview?key=${encodeURIComponent(c.record.key)}`}>معاينته من البيانات الحالية</Link></> : null}</Row> : null}
              <Row label="الاعتماد المالي والرسمي">مستقلان: الفواتير في دورة الاستحقاق المالي، ولا إجراء رسمي خارجي مسجل لهذا التسليم</Row>
            </div>
            {c.files?.length ? (
              <ul className="space-y-1 text-sm" data-testid={`cycle-${c.seq}-files`}>
                {c.files.map((f) => (
                  <li key={f.id}>{f.title} — الإصدار {f.version} — أُتيح {f.releasedAt ? fmtDate(f.releasedAt) : "—"}{f.status === "revision_requested" ? ` — طلب العميل تعديله: ${f.revisionNote ?? ""}` : f.status === "approved" ? " — اعتمده العميل" : ""}
                    {f.documentId ? <> · <a href={`/api/files/${f.documentId}?disposition=inline`} target="_blank" rel="noopener" className="text-ink underline">معاينة</a> · <a href={`/api/files/${f.documentId}`} className="text-ink underline">تنزيل</a></> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {c.closeBlockers?.length && c.status !== "closed" ? (
              <p className="text-[13px] text-muted">قبل الإقفال: {c.closeBlockers.join(" ")}</p>
            ) : null}
            <div className="flex flex-wrap items-start gap-3 border-t border-line pt-3">
              {c.output ? (
                <>
                  <Link href={`/admin/requests/${requestId}/outputs/${c.output.id}`} className="inline-flex items-center gap-1 text-sm text-ink underline" data-testid={`cycle-${c.seq}-preview`}><Eye aria-hidden className="size-4" />معاينة مخرج الدورة (نسخة {c.output.version})</Link>
                  <a href={`/admin/requests/${requestId}/outputs/${c.output.id}/pdf?v=${c.output.version}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-sm text-ink underline"><FileDown aria-hidden className="size-4" />PDF</a>
                </>
              ) : c.outputKey && c.status === "open" ? (
                <Link href={`/admin/requests/${requestId}/outputs/preview?key=${encodeURIComponent(c.outputKey)}`} className="inline-flex items-center gap-1 text-sm text-ink underline" data-testid={`cycle-${c.seq}-preview`}><Eye aria-hidden className="size-4" />معاينة مخرج الدورة من البيانات الحالية</Link>
              ) : null}
              {worker && running && c.status === "open" && (c.phase === "approved" || (spec.delivery.kind === "minutes" && c.kind !== "closing")) ? (
                <ActionForm action={a.sendCycle} hidden={{ cycleId: c.id }} submit={spec.delivery.kind === "minutes" && c.kind !== "closing" ? "سجّل إتاحة المحضر المعتمد" : "أتح التسليم للعميل في المنصة"} size="sm" />
              ) : null}
              {worker && running && (c.status === "sent" || (c.phase === "followup" && spec.delivery.kind === "followup")) ? (
                <ActionForm action={a.closeCycle} hidden={{ cycleId: c.id }} submit="أقفل الدورة (يبقى الطلب مفتوحًا)" size="sm" variant="secondary">
                  <Field label={c.phase === "followup" ? "ملاحظة المتابعة" : "ملاحظة الإقفال"} name={`close-${c.id}`} required={c.phase === "followup"}>
                    <Textarea id={`close-${c.id}`} name="note" rows={2} maxLength={2000} minLength={c.phase === "followup" ? 10 : undefined} required={c.phase === "followup"} />
                  </Field>
                </ActionForm>
              ) : null}
            </div>
            {ops && c.status === "open" ? (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted">تغيير الموعد أو تجاوز الدورة</summary>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <ActionForm action={a.rescheduleCycle} hidden={{ cycleId: c.id }} submit="غيّر الموعد" size="sm" variant="secondary">
                    <Field label="الاستحقاق الجديد" name={`due-${c.id}`} required><Input id={`due-${c.id}`} type="date" name="dueOn" required defaultValue={c.dueOn} /></Field>
                    <Field label="السبب" name={`resched-${c.id}`} required><Input id={`resched-${c.id}`} name="reason" required minLength={5} /></Field>
                  </ActionForm>
                  <ActionForm action={a.skipCycle} hidden={{ cycleId: c.id }} submit="تجاوز الدورة" size="sm" variant="danger">
                    <Field label="سبب عدم التسليم" name={`skip-${c.id}`} required hint="يُسجل ويظهر للعميل في سجل الطلب"><Textarea id={`skip-${c.id}`} name="reason" rows={2} required minLength={10} /></Field>
                  </ActionForm>
                </div>
                {c.dueChanges?.length ? <ul className="mt-2 list-disc ps-5 text-muted">{c.dueChanges.map((x) => <li key={x.at}>{x.from} ← {x.to}: {x.reason}</li>)}</ul> : null}
              </details>
            ) : null}
          </div>
        </Panel>
      ))}

      {t && worker && running ? (
        <Panel title="فتح دورة" description={eventCadence ? "دورة لحدث: اجتماع مجلس أو دفعة صرف، داخل مدة الخدمة." : v.next ? `التالية: ${v.next.label}، تستحق ${v.next.due}.` : "لا فترات متبقية في المدة."}>
          {eventCadence && v.termState !== "ended" ? (
            <ActionForm action={a.openCycle} hidden={{ id: requestId, kind: "event" }} submit="افتح دورة للحدث" size="sm">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="الوصف" name="label" required><Input name="label" required minLength={3} placeholder="مثل: الاجتماع الدوري للمجلس" /></Field>
                <Field label="تاريخ الحدث" name="eventOn" required><Input type="date" name="eventOn" required /></Field>
                {v.waqfMeetings.length ? <Field label="الاجتماع (اختياري)" name="meetingId"><Select name="meetingId" defaultValue="" placeholder="بلا ربط الآن" options={v.waqfMeetings.map((m) => ({ value: m.id, label: `${m.title} — ${fmtDate(m.at)}` }))} /></Field> : null}
              </div>
            </ActionForm>
          ) : v.canOpenNext ? (
            <ActionForm action={a.openCycle} hidden={{ id: requestId, kind: "periodic" }} submit={`افتح دورة «${v.next!.label}»`} size="sm" />
          ) : v.next ? <p className="text-sm text-muted">تُفتح الدورة التالية عند بدء فترتها.</p> : null}
          {v.closingDue ? <div className="mt-3"><ActionForm action={a.openCycle} hidden={{ id: requestId, kind: "closing" }} submit={`افتح «${spec.closing!.title}»`} size="sm" variant="secondary" /></div> : null}
          {!canDeliver ? <p className="mt-2 text-[13px] text-muted">إعداد مسودات الدورات يتطلب صلاحية التسليم.</p> : null}
        </Panel>
      ) : null}

      <Panel title="سجل الدورات السابقة" description="ما سُلّم واعتُمد في كل دورة. السجل والمراسلات والمرفقات ونسخ المخرجات محفوظة.">
        {history.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="cycle-history">
              <thead><tr className="text-start text-muted"><th className="py-2 text-start font-medium">الدورة</th><th className="text-start font-medium">الاستحقاق</th><th className="text-start font-medium">التسليم</th><th className="text-start font-medium">الاعتماد</th><th className="text-start font-medium">الحالة</th></tr></thead>
              <tbody className="divide-y divide-line">
                {history.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2">{c.seq}. {c.label}</td>
                    <td className="tabular">{c.dueOn}</td>
                    <td>{c.deliveredOn ?? "—"}{c.deliverable?.documentId ? <> · <a className="underline" href={`/api/files/${c.deliverable.documentId}?disposition=inline`} target="_blank" rel="noopener">الملف</a></> : null}</td>
                    <td>{c.output?.approvedVersion ? `النسخة ${c.output.approvedVersion}${c.output.approvedBy ? ` — ${c.output.approvedBy}` : ""}` : c.closeNote ? "متابعة موثقة" : "—"}</td>
                    <td><Badge tone={c.status === "closed" ? "ok" : "neutral"} icon={false}>{c.status === "closed" ? "مقفلة" : "متجاوزة"}</Badge>{c.skippedReason ? <span className="ms-2 text-muted">{c.skippedReason}</span> : null}{c.closeNote ? <span className="ms-2 text-muted">{c.closeNote}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-muted">لا دورات مقفلة بعد.</p>}
      </Panel>

      <Panel title="دورة الاستحقاق المالي" description="منفصلة عن دورات التسليم: تُنشأ الفواتير وفق دفعات العقد من قسم الفوترة، ولا تُنشئ دورات التسليم فواتير." id="financial-cycle">
        {schedule.length ? <PaymentScheduleTable rows={schedule} staff /> : v.installments.length ? (
          <p className="text-sm text-muted">يُنشأ جدول الدفعات بتواريخها عند نفاذ العقد. الدفعات في العرض المقبول: {v.installments.map((i) => `${i.label} (${i.percent}٪)`).join("، ")}.</p>
        ) : <p className="text-sm text-muted">لا دفعات تعاقدية مسجلة (لا عرض مقبول).</p>}
        <p className="mt-3 text-[13px] text-muted">الفوترة الإلكترونية لدى هيئة الزكاة والضريبة والجمارك لم تُربط بعد: الفواتير الضريبية «بانتظار الربط»، ولا يُدّعى إرسالها إلى الهيئة.</p>
      </Panel>

      {t && (ops || worker) && ["in_progress", "on_hold"].includes(status) ? (
        <Panel title="المدة والإنهاء" description="التعليق من «سير العمل» (تعليق الطلب) ويعلّق الخدمة. التمديد والإنهاء لمدير التشغيل بمرجع مكتوب.">
          {ops ? (
            <div className="grid gap-4 md:grid-cols-2">
              {!spec.acceptance.fixed && t.status !== "terminated" ? (
                <ActionForm action={a.changeAcceptance} hidden={{ id: requestId }} submit="اضبط اعتماد العميل" size="sm" variant="secondary">
                  <Field label="اعتماد العميل للتسليمات" name="clientAcceptance" required><Select name="clientAcceptance" required defaultValue={t.clientAcceptance} options={(["required", "info"] as const).map((m) => ({ value: m, label: ACCEPTANCE_AR[m] }))} /></Field>
                  <Field label="السبب ومرجعه في العقد" name="reason" required><Input name="reason" required minLength={10} /></Field>
                </ActionForm>
              ) : null}
              {t.status !== "terminated" ? (
                <ActionForm action={a.extendTerm} hidden={{ id: requestId }} submit="مدّد المدة" size="sm" variant="secondary">
                  <Field label="النهاية الجديدة" name="endOn" required><Input type="date" name="endOn" required /></Field>
                  <Field label="السبب" name="reason" required><Input name="reason" required minLength={5} /></Field>
                  <Field label="مرجع الاتفاق المكتوب" name="reference" required><Input name="reference" required minLength={3} /></Field>
                </ActionForm>
              ) : null}
              {t.status !== "terminated" ? (
                <ActionForm action={a.terminateService} hidden={{ id: requestId }} submit="سجّل إنهاء العقد" size="sm" variant="danger">
                  <Field label="تاريخ النفاذ" name="effectiveOn" required><Input type="date" name="effectiveOn" required /></Field>
                  <Field label="بطلب من" name="initiatedBy" required><Select name="initiatedBy" required options={[{ value: "client", label: "العميل" }, { value: "company", label: "وقفك" }, { value: "mutual", label: "الطرفين" }]} /></Field>
                  <Field label="السبب" name="reason" required><Textarea name="reason" rows={2} required minLength={10} /></Field>
                  <Field label="المرجع المكتوب" name="reference" required><Input name="reference" required minLength={3} /></Field>
                </ActionForm>
              ) : null}
            </div>
          ) : <p className="text-sm text-muted">التمديد والإنهاء لمدير التشغيل.</p>}
          {t.history?.length ? (
            <ul className="mt-3 list-disc ps-5 text-[13px] text-muted">{t.history.map((h) => <li key={h.at}>{h.at.slice(0, 10)} — {({ setup: "تحديد المدة", extend: "تمديد", suspend: "تعليق", resume: "استئناف", terminate: "إنهاء", edit: "تعديل" } as Record<string, string>)[h.kind]}{h.note ? `: ${h.note}` : ""}</li>)}</ul>
          ) : null}
        </Panel>
      ) : null}
    </div>
  );
}
