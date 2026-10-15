import { viewerMakerRules } from "@/server/modules/approvals/policy";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, FileText } from "lucide-react";
import { Alert, Badge, buttonClass, DefinitionList, PageHeader, Panel } from "@/components/ui";
import { Field, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { ActionForm } from "@/components/admin/action-form";
import { ReasonAction } from "@/components/admin/reason-action";
import { actionLabel } from "@/components/admin/labels";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { requireAdmin } from "@/server/modules/admin/guard";
import { withSystem } from "@/server/db";
import { todayISO } from "@/server/engines/dates";
import {
  acceptEngagement, activateEngagement, addEngagementTask, addTeamMember, approveNazaraReport, endEngagement, generateNazaraReport,
  rejectEngagement, removeTeamMember, requestCompletion, resumeEngagement, saveAppointment, saveIntakeNotes, startEnding, startReview,
  suspendEngagement, updateChecklistItem, updateHandoverItem,
} from "@/server/modules/nazara/actions";
import { activationGate, NAZARA_LICENSE_KEY, type LicenceRecord } from "@/server/modules/nazara/licence";
import {
  AUTHORITY_AR, CHECK_STATUS_AR, checklistProgress, END_REASON_AR, END_REASONS, RUNNING_STATUSES, STATUS_AR, STATUS_TONE, type EngagementStatus,
} from "@/server/modules/nazara/pure";
import { engagementDetail, teamCandidates } from "@/server/modules/nazara/queries";
import { readSetting } from "@/server/modules/requests/catalog";
import { STATUS_LABEL as REQ_STATUS } from "@/server/modules/requests/workflow";

export const metadata: Metadata = { title: "ملف نظارة" };

const UUID = /^[0-9a-f-]{36}$/i;
const NAZARA_ACTION_AR: Record<string, string> = {
  open: "فتح الملف", start_review: "بدء الدراسة", request_completion: "طلب استكمال", accept: "اعتماد القبول", reject: "رفض", activate: "مباشرة النظارة",
  suspend: "إيقاف مؤقت", resume: "استئناف", start_ending: "بدء الإنهاء", end: "إقفال النظارة", team_add: "إضافة إلى الفريق", team_remove: "إخراج من الفريق",
};
const REPORT_KIND_AR: Record<string, string> = { nazara_periodic: "تقرير النظارة الدوري", nazara_takeover: "محضر الاستلام", nazara_handover: "محضر التسليم" };

export default async function EngagementPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin("nazara.view");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const d = await engagementDetail(auth, id);
  if (!d) notFound();
  const { e, w, ops } = d;
  const status = e.status as EngagementStatus;
  const canManage = auth.perms.has("nazara.manage");
  const canApprove = auth.perms.has("nazara.approve");
  const maker = await viewerMakerRules(auth);
  const running = (RUNNING_STATUSES as string[]).includes(status);
  const closed = status === "ended" || status === "rejected";
  const intakeEditable = ["intake", "under_review", "pending_completion"].includes(status);
  const progress = checklistProgress(e.checklist);
  const candidates = canManage && !closed ? await teamCandidates(auth) : [];
  const teamIds = new Set(d.team.map((t) => t.t.userId));
  const licence = await withSystem((tx) => readSetting<LicenceRecord[]>(tx, "company.licenses", [])).then((l) => l.find((x) => x.key === NAZARA_LICENSE_KEY));
  const gate = activationGate({ licence, today: todayISO(), waqfIsDemo: w.isDemo });
  const file = `/app/w/${w.id}`;
  const docOptions = d.docs.map((x) => ({ value: x.id, label: x.title }));
  const lead = d.team.find((t) => t.t.teamRole === "lead");

  return (
    <div>
      <PageHeader
        title={w.name}
        crumbs={[{ href: "/admin/nazara", label: "النظارة الاعتبارية" }, { label: e.number }]}
        description={
          <span className="flex flex-wrap items-center gap-1.5 pt-1">
            <Badge tone={STATUS_TONE[status] ?? "neutral"} icon={false}>{STATUS_AR[status] ?? status}</Badge>
            <Badge tone="neutral" icon={false}><span dir="ltr" className="tabular">{e.number}</span></Badge>
            {e.isPractice ? <Badge tone="seal" icon={false}>نظارة تجريبية</Badge> : null}
            {w.isDemo ? <Badge tone="seal" icon={false}>وقف تجريبي</Badge> : null}
            {d.requests.map((rq) => (
              <Link key={rq.id} href={`/admin/requests/${rq.id}`} className="text-[14px] text-ink hover:underline" data-testid="nazara-request-link">
                الطلب <span dir="ltr" className="tabular">{rq.number}</span> ({REQ_STATUS[rq.status as keyof typeof REQ_STATUS] ?? rq.status}{rq.relation === "origin" ? "، فتح الملف" : "، مرتبط"})
              </Link>
            ))}
          </span>
        }
        actions={
          running ? (
            <Link href={file} className={buttonClass("primary", "md")}>
              افتح ملف الوقف للتشغيل <ExternalLink aria-hidden className="size-4" />
            </Link>
          ) : null
        }
      />

      {e.isPractice ? (
        <Alert tone="info" className="mb-6" title="نظارة تجريبية">
          بدأت على وقف تجريبي لاختبار المنظومة دون ترخيص. لا تمثل نظارة فعلية، وتحمل مخرجاتها علامة «تجريبي».
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-6">
          {/* ───── next step ───── */}
          <Panel title="الخطوة التالية" description={nextStepText(status, progress.requiredOpen.length, !!lead)}>
            <div className="space-y-2">
              {status === "intake" || status === "pending_completion" ? (
                canManage ? (
                  <ReasonAction id="review" title={status === "intake" ? "بدء الدراسة" : "استئناف الدراسة بعد الاستكمال"} description={lead ? "ينقل الملف إلى «قيد الدراسة»." : "عيّن مسؤول الملف أولًا من لوحة الفريق."} action={startReview} hidden={{ id: e.id }} submit="ابدأ الدراسة" variant="primary" reasonName="note" reasonLabel="ملاحظة (اختيارية)" optional />
                ) : null
              ) : null}
              {status === "under_review" && canManage ? (
                <ReasonAction id="completion" title="طلب استكمال المستندات" description="يبقى الملف معلقًا حتى تصل النواقص." action={requestCompletion} hidden={{ id: e.id }} submit="سجّل طلب الاستكمال" reasonName="note" reasonLabel="ما المطلوب استكماله" />
              ) : null}
              {status === "under_review" && canApprove ? (
                <ReasonAction
                  id="accept"
                  title="اعتماد قبول النظارة"
                  description={progress.requiredOpen.length ? `لا يُعتمد قبل استلام ${progress.requiredOpen.length} بند مطلوب.` : "كل البنود المطلوبة مستلمة."}
                  action={acceptEngagement}
                  hidden={{ id: e.id }}
                  submit="اعتمد القبول"
                  variant="primary"
                  reasonName="note"
                  reasonLabel="مسوغات القبول (اختيارية)" optional
                />
              ) : null}
              {["intake", "under_review", "pending_completion"].includes(status) && canApprove ? (
                <ReasonAction id="reject" title="رفض الطلب" description="يُنهي وصول الفريق إلى الوقف." action={rejectEngagement} hidden={{ id: e.id }} submit="ارفض الطلب" variant="danger" reasonName="note" reasonLabel="سبب الرفض" />
              ) : null}
              {status === "accepted" ? (
                <>
                  {!gate.allowed ? <Alert tone="warn" title="المباشرة متوقفة على الترخيص">{gate.reason}</Alert> : gate.practice ? <Alert tone="info">تُباشَر هذه النظارة تجريبيًا لأن الوقف تجريبي والترخيص غير مفعّل.</Alert> : null}
                  {canApprove && gate.allowed ? (
                    <ReasonAction id="activate" title={gate.practice ? "مباشرة النظارة (تجريبية)" : "مباشرة النظارة"} description="تصبح «وقفك» ناظر الوقف: يُسجَّل الناظر وقرار تعيينه، ويتحول وصول الفريق إلى صلاحيات الناظر، وتُفتح مهام ما بعد التعيين." action={activateEngagement} hidden={{ id: e.id }} submit="باشر النظارة" variant="primary" reasonName="note" reasonLabel="ملاحظة (اختيارية)" optional />
                  ) : null}
                </>
              ) : null}
              {status === "active" && canApprove ? (
                <ReasonAction id="suspend" title="إيقاف النظارة مؤقتًا" description="مثل قرار إيقاف من الهيئة (لائحة تنظيم أعمال النظارة م24/1ج)." action={suspendEngagement} hidden={{ id: e.id }} submit="أوقف النظارة" variant="danger" reasonName="note" reasonLabel="السبب والمرجع" />
              ) : null}
              {status === "suspended" && canApprove ? (
                <ReasonAction id="resume" title="استئناف النظارة" action={resumeEngagement} hidden={{ id: e.id }} submit="استأنف" variant="primary" reasonName="note" reasonLabel="ملاحظة (اختيارية)" optional />
              ) : null}
              {(status === "active" || status === "suspended") && canApprove ? (
                <details className="group rounded-lg border border-line open:bg-surface-2/50">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                    <span><span className="block font-medium">بدء إنهاء النظارة والتسليم</span><span className="block text-[13px] text-muted">تُعدّ قائمة التسليم من سجلات الوقف (م27/3).</span></span>
                  </summary>
                  <div className="border-t border-line p-4">
                    <ActionForm action={startEnding} hidden={{ id: e.id }}>
                      <Field label="سبب الانتهاء" name="endReason" required>
                        <Select id="endReason" name="endReason" options={END_REASONS.map(([k, v]) => ({ value: k, label: v }))} placeholder="اختر" required />
                      </Field>
                      <Field label="التفاصيل والمرجع" name="endNote" required>
                        <Textarea id="endNote" name="endNote" rows={3} required />
                      </Field>
                      <Field label="الناظر البديل (إن عُرف)" name="successorName">
                        <Input id="successorName" name="successorName" />
                      </Field>
                      <SubmitButton variant="danger">ابدأ الإنهاء</SubmitButton>
                    </ActionForm>
                  </div>
                </details>
              ) : null}
              {status === "ending" && canApprove ? (
                <ReasonAction id="end" title="إقفال النظارة" description="بعد تسليم كل البنود: تنتهي صفة «وقفك» ناظرًا، ويُنهى وصول الفريق." action={endEngagement} hidden={{ id: e.id }} submit="أقفل النظارة" variant="danger" reasonName="note" reasonLabel="ملاحظة (اختيارية)" optional />
              ) : null}
              {closed ? (
                <p className="text-[15px] text-muted">
                  {status === "rejected" ? `رُفض الطلب: ${e.decisionReason ?? "—"}` : `انتهت النظارة في ${fmtDate(e.endedOn)} — ${END_REASON_AR[e.endReason ?? ""] ?? "—"}${e.successorName ? `، وسُلّم الوقف إلى ${e.successorName}` : ""}.`}
                </p>
              ) : null}
              {!canManage && !canApprove ? <p className="text-[14px] text-muted">صلاحيتك اطلاع فقط.</p> : null}
            </div>
          </Panel>

          {/* ───── operations ───── */}
          {ops ? (
            <Panel title="متابعة التشغيل" description="من سجلات الوقف الآن. كل بند يفتح موضعه في ملف الوقف.">
              <div className="grid gap-5 md:grid-cols-2">
                <OpsList title={`مهام متأخرة (${ops.overdueTasks.length} من ${ops.openTasks} مفتوحة)`} href={`${file}/tasks`} empty="لا مهام متأخرة." items={ops.overdueTasks.map((t) => ({ k: t.id, main: t.title, sub: `${fmtDate(t.dueOn)}${t.assignee ? ` · ${t.assignee}` : ""}`, tone: "critical" as const }))} />
                <OpsList title="التزامات متأخرة أو خلال 30 يومًا" href={`${file}/compliance`} empty="لا التزامات قريبة." items={ops.obligations.map((o) => ({ k: o.id, main: o.title, sub: fmtDate(o.dueOn), tone: o.status === "overdue" ? ("critical" as const) : ("fine" as const) }))} />
                <OpsList title="بانتظار اعتماد" href={file} empty="لا بنود بانتظار الاعتماد." items={ops.approvalsPending.map((a) => ({ k: a.kind, main: `${a.label}: ${a.count}`, href: a.href, tone: "info" as const }))} />
                <OpsList title="عقود تنتهي خلال 90 يومًا" href={`${file}/assets`} empty="لا عقود قريبة الانتهاء." items={ops.leasesEnding.map((l) => ({ k: l.id, main: l.tenant, sub: fmtDate(l.endsOn), tone: "fine" as const }))} />
                <OpsList title="صيانة مستحقة خلال 30 يومًا" href={`${file}/assets`} empty="لا صيانة مستحقة." items={ops.maintenanceDue.map((m) => ({ k: m.id, main: m.item, sub: fmtDate(m.nextDueOn), tone: "fine" as const }))} />
                <OpsList title={`مخاطر مفتوحة (${ops.risksOpen.length})`} href={`${file}/risks`} empty="لا مخاطر مفتوحة." items={ops.risksOpen.map((r) => ({ k: r.id, main: r.title, sub: `الدرجة ${r.score}`, tone: r.score >= 6 ? ("critical" as const) : ("neutral" as const) }))} />
              </div>
              <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4 text-[14px]">
                <Link href={`${file}/complaints`} className="rounded-full border border-line-strong px-3 py-1 hover:border-ink">شكاوى واستفسارات مفتوحة: <span className="tabular">{ops.complaintsOpen}</span></Link>
                <Link href={`${file}/compliance`} className="rounded-full border border-line-strong px-3 py-1 hover:border-ink">مخالفات قائمة: <span className="tabular">{ops.violationsOpen}</span></Link>
                <Link href={`${file}/audit`} className="rounded-full border border-line-strong px-3 py-1 hover:border-ink">سجل عمليات الوقف</Link>
              </div>
              {ops.recent.length ? (
                <div className="mt-5">
                  <h3 className="mb-2 text-[15px] font-semibold">أحدث العمليات (30 يومًا)</h3>
                  <ul className="space-y-1 text-[14px]">
                    {ops.recent.map((r) => (
                      <li key={String(r.id)} className="flex flex-wrap justify-between gap-2">
                        <span>{actionLabel(r.action) ?? r.action}</span>
                        <span className="text-muted">{r.actor ?? "النظام"} · {fmtDateTime(r.at)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Panel>
          ) : null}

          {/* ───── intake checklist ───── */}
          <Panel
            title={`قائمة الاستلام (${progress.done} من ${progress.total})`}
            description={intakeEditable ? "ما يُستلم من مستندات الوقف وبياناته قبل اعتماد القبول. اربط كل بند بوثيقته من «الوثائق» في ملف الوقف." : "سجل ما استُلم قبل القبول."}
          >
            {intakeEditable && !d.docs.length ? <Alert tone="info" className="mb-4">لا وثائق في ملف الوقف بعد. تُرفع من «الوثائق» في ملف الوقف ثم تُربط هنا.</Alert> : null}
            <ul className="space-y-3">
              {e.checklist.map((i) => (
                <li key={i.key} className="rounded-md border border-line p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{i.label}{i.required ? <span className="text-critical" aria-label="مطلوب"> *</span> : null}</p>
                      <p className="text-[12.5px] text-muted">{i.source}</p>
                    </div>
                    <Badge tone={i.status === "received" ? "ok" : i.status === "not_applicable" ? "neutral" : i.required ? "warn" : "neutral"} icon={false}>{CHECK_STATUS_AR[i.status]}</Badge>
                  </div>
                  {i.documentId ? <p className="mt-1 text-[13px]"><FileText aria-hidden className="inline size-3.5" /> {d.docs.find((x) => x.id === i.documentId)?.title ?? "وثيقة مرتبطة"}</p> : null}
                  {i.note ? <p className="mt-1 text-[13px] text-muted">{i.note}</p> : null}
                  {intakeEditable && canManage ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[14px] text-ink">تحديث البند</summary>
                      <ActionForm action={updateChecklistItem} hidden={{ id: e.id, key: i.key }} className="mt-2 space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label="الحالة" name={`status-${i.key}`}>
                            <Select id={`status-${i.key}`} name="status" defaultValue={i.status} options={[{ value: "missing", label: "لم يُستلم" }, { value: "received", label: "استُلم" }, { value: "not_applicable", label: "لا ينطبق" }]} />
                          </Field>
                          <Field label="الوثيقة" name={`doc-${i.key}`}>
                            <Select id={`doc-${i.key}`} name="documentId" defaultValue={i.documentId ?? ""} options={docOptions} placeholder="بلا وثيقة" />
                          </Field>
                        </div>
                        <Field label="ملاحظة" name={`note-${i.key}`}>
                          <Input id={`note-${i.key}`} name="note" defaultValue={i.note ?? ""} />
                        </Field>
                        <SubmitButton size="sm" variant="secondary">احفظ البند</SubmitButton>
                      </ActionForm>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          </Panel>

          {/* ───── appointment ───── */}
          {status !== "intake" && status !== "rejected" ? (
            <Panel title="قرار التعيين" description="يتضمن قرار تسمية الناظر صلاحياته وأتعابه ومسؤولياته (لائحة تنظيم أعمال النظارة م4/6).">
              {["under_review", "accepted"].includes(status) && canManage ? (
                <ActionForm action={saveAppointment} hidden={{ id: e.id }}>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="رقم القرار" name="appointmentDecisionNo" required><Input id="appointmentDecisionNo" name="appointmentDecisionNo" defaultValue={e.appointmentDecisionNo ?? ""} dir="ltr" /></Field>
                    <Field label="تاريخه" name="appointmentDecisionDate" required><Input id="appointmentDecisionDate" name="appointmentDecisionDate" type="date" dir="ltr" defaultValue={e.appointmentDecisionDate ?? ""} /></Field>
                    <Field label="جهة القرار" name="appointmentAuthority" required>
                      <Select id="appointmentAuthority" name="appointmentAuthority" defaultValue={e.appointmentAuthority ?? ""} placeholder="اختر" options={["competent_authority", "court", "notary", "gaa", "internal"].map((k) => ({ value: k, label: AUTHORITY_AR[k] }))} />
                    </Field>
                  </div>
                  <Field label="وثيقة القرار" name="appointmentDocumentId"><Select id="appointmentDocumentId" name="appointmentDocumentId" defaultValue={e.appointmentDocumentId ?? ""} options={docOptions} placeholder="بلا وثيقة" /></Field>
                  <Field label="الصلاحيات" name="powers" required><Textarea id="powers" name="powers" rows={3} defaultValue={e.powers ?? ""} /></Field>
                  <Field label="الأتعاب" name="feeTerms" required hint="كما في شرط الواقف أو قرار الجهة المختصة (م11/1)."><Textarea id="feeTerms" name="feeTerms" rows={2} defaultValue={e.feeTerms ?? ""} /></Field>
                  <Field label="المسؤوليات" name="responsibilities" required><Textarea id="responsibilities" name="responsibilities" rows={3} defaultValue={e.responsibilities ?? ""} /></Field>
                  <SubmitButton variant="secondary">احفظ قرار التعيين</SubmitButton>
                </ActionForm>
              ) : (
                <DefinitionList
                  items={[
                    { label: "رقم القرار", value: e.appointmentDecisionNo ?? "—" },
                    { label: "التاريخ", value: fmtDate(e.appointmentDecisionDate) },
                    { label: "الجهة", value: e.appointmentAuthority ? AUTHORITY_AR[e.appointmentAuthority] : "—" },
                    { label: "مباشرة النظارة", value: fmtDate(e.startedOn) },
                    { label: "الصلاحيات", value: <span className="whitespace-pre-line">{e.powers ?? "—"}</span> },
                    { label: "الأتعاب", value: <span className="whitespace-pre-line">{e.feeTerms ?? "—"}</span> },
                    { label: "المسؤوليات", value: <span className="whitespace-pre-line">{e.responsibilities ?? "—"}</span> },
                  ]}
                />
              )}
            </Panel>
          ) : null}

          {/* ───── handover ───── */}
          {e.handover.length ? (
            <Panel title={`التسليم (${e.handover.filter((h) => h.status === "delivered").length} من ${e.handover.length})`} description="لائحة تنظيم أعمال النظارة م27/3؛ معايير المستفيد الحقيقي م7/4.">
              <ul className="space-y-3">
                {e.handover.map((h) => (
                  <li key={h.key} className="rounded-md border border-line p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0"><p className="font-medium">{h.label}</p><p className="text-[13px] text-muted">{h.detail}</p></div>
                      <Badge tone={h.status === "delivered" ? "ok" : "warn"} icon={false}>{h.status === "delivered" ? "سُلّم" : "قيد التسليم"}</Badge>
                    </div>
                    {h.note ? <p className="mt-1 text-[13px] text-muted">{h.note}</p> : null}
                    {status === "ending" && canManage ? (
                      <ActionForm action={updateHandoverItem} hidden={{ id: e.id, key: h.key, status: h.status === "delivered" ? "pending" : "delivered" }} className="mt-2 flex flex-wrap items-end gap-2 space-y-0">
                        <div className="min-w-[200px] flex-1"><label htmlFor={`hn-${h.key}`} className="sr-only">ملاحظة</label><Input id={`hn-${h.key}`} name="note" defaultValue={h.note ?? ""} placeholder="ملاحظة (اختيارية)" /></div>
                        <SubmitButton size="sm" variant={h.status === "delivered" ? "ghost" : "secondary"}>{h.status === "delivered" ? "إلغاء التسليم" : "سُلّم"}</SubmitButton>
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          {/* ───── outputs ───── */}
          {!["intake", "under_review", "pending_completion", "rejected"].includes(status) ? (
            <Panel title="مخرجات النظارة" description="تُبنى من سجلات الوقف لحظة الإعداد وتُحفظ برقم ورمز تحقق. التقرير الدوري مسودة حتى يعتمده مسؤول نظارة غير معدّه.">
              {canManage ? (
                <div className="mb-5 grid gap-4 lg:grid-cols-2">
                  {running ? (
                    <ActionForm action={generateNazaraReport} hidden={{ id: e.id, kind: "nazara_periodic" }} className="rounded-md border border-line p-3">
                      <p className="font-medium">تقرير النظارة الدوري</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Field label="من" name="from"><Input id="from" name="from" type="date" dir="ltr" defaultValue={e.startedOn ?? ""} /></Field>
                        <Field label="إلى" name="to"><Input id="to" name="to" type="date" dir="ltr" defaultValue={d.today} /></Field>
                      </div>
                      <SubmitButton size="sm" variant="secondary">أعدّ المسودة</SubmitButton>
                    </ActionForm>
                  ) : null}
                  <div className="space-y-2 rounded-md border border-line p-3">
                    <p className="font-medium">المحاضر</p>
                    <ActionForm action={generateNazaraReport} hidden={{ id: e.id, kind: "nazara_takeover" }} className="space-y-1"><SubmitButton size="sm" variant="secondary">أعدّ محضر الاستلام</SubmitButton></ActionForm>
                    {status === "ending" || status === "ended" ? (
                      <ActionForm action={generateNazaraReport} hidden={{ id: e.id, kind: "nazara_handover" }} className="space-y-1"><SubmitButton size="sm" variant="secondary">أعدّ محضر التسليم</SubmitButton></ActionForm>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {d.reports.length ? (
                <ul className="divide-y divide-line">
                  {d.reports.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="font-medium">{REPORT_KIND_AR[r.kind] ?? r.title}</p>
                        <p className="text-[13px] text-muted">
                          <span dir="ltr" className="tabular">{r.number}</span> · {fmtDateTime(r.generatedAt)}
                          {r.kind === "nazara_periodic" ? ` · ${(r.snapshot as { period?: { from: string; to: string } })?.period ? `${(r.snapshot as { period: { from: string; to: string } }).period.from} → ${(r.snapshot as { period: { from: string; to: string } }).period.to}` : ""}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={r.status === "draft" ? "warn" : "ok"} icon={false}>{r.status === "draft" ? "مسودة" : r.status === "approved" ? "معتمد" : "نهائي"}</Badge>
                        <a className={buttonClass("secondary", "sm")} href={`/admin/nazara/${e.id}/reports/${r.id}`} download>PDF</a>
                        {r.kind === "nazara_periodic" ? <a className={buttonClass("secondary", "sm")} href={`/admin/nazara/${e.id}/reports/${r.id}?format=csv`} download>CSV</a> : null}
                        {(() => {
                          if (r.status !== "draft" || !canApprove) return null;
                          const mk = maker.check("nazara_report", r.generatedBy === auth.user.id, "أعددتَ هذا التقرير: يعتمده مسؤول نظارة آخر.");
                          return mk.ok
                            ? <ActionForm action={approveNazaraReport} hidden={{ id: e.id, reportId: r.id }} className="space-y-1"><SubmitButton size="sm">{mk.self ? "اعتمد (اعتماد مباشر مسجّل)" : "اعتمد"}</SubmitButton></ActionForm>
                            : <span className="text-[13px] text-muted">{mk.error}</span>;
                        })()}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">لم تُعدّ مخرجات بعد.</p>
              )}
            </Panel>
          ) : null}
        </div>

        <div className="space-y-6">
          <Panel title="فريق النظارة" description="يصل كل عضو إلى هذا الوقف وحده: قبل المباشرة اطلاعًا للدراسة، وبعدها بصلاحيات الناظر (المسؤول) أو المدير التنفيذي (الأعضاء).">
            {d.team.length ? (
              <ul className="mb-4 divide-y divide-line rounded-md border border-line">
                {d.team.map((t) => (
                  <li key={t.t.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block font-medium">{t.name ?? "موظف"}</span>
                      <span className="block text-[13px] text-muted">{t.t.teamRole === "lead" ? "مسؤول الملف" : "عضو الفريق"} · منذ {fmtDate(t.t.addedAt)}</span>
                    </span>
                    {canManage && !closed ? (
                      <ActionForm action={removeTeamMember} hidden={{ id: e.id, teamId: t.t.id }} className="space-y-1">
                        <SubmitButton variant="ghost" size="sm" pendingText="…" aria-label={`إخراج ${t.name ?? "العضو"} من الفريق`}>إخراج</SubmitButton>
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-4 text-muted">لم يُشكَّل الفريق بعد.</p>
            )}
            {canManage && !closed ? (
              candidates.filter((c) => !teamIds.has(c.id)).length ? (
                <ActionForm action={addTeamMember} hidden={{ id: e.id }}>
                  <Field label="الموظف" name="userId"><Select id="userId" name="userId" options={candidates.filter((c) => !teamIds.has(c.id)).map((c) => ({ value: c.id, label: c.name ?? "موظف" }))} placeholder="اختر" /></Field>
                  <Field label="الدور" name="teamRole">
                    <Select id="teamRole" name="teamRole" defaultValue={lead ? "member" : "lead"} options={[{ value: "lead", label: "مسؤول الملف" }, { value: "member", label: "عضو الفريق" }]} />
                  </Field>
                  <SubmitButton variant="secondary">أضف إلى الفريق</SubmitButton>
                </ActionForm>
              ) : (
                <p className="text-[13px] text-muted">لا موظفين آخرين بدور في النظارة. يُمنح دور «موظف النظارة» من «المستخدمون والأدوار».</p>
              )
            ) : null}
          </Panel>

          {canManage && !closed ? (
            <Panel title="مهمة متابعة" description="لنقص في الاستلام أو إجراء على الوقف؛ تظهر في «المهام» بملف الوقف.">
              <ActionForm action={addEngagementTask} hidden={{ id: e.id }} resetOnSuccess>
                <Field label="المهمة" name="title" required><Input id="title" name="title" /></Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="الموعد" name="dueOn"><Input id="dueOn" name="dueOn" type="date" dir="ltr" /></Field>
                  <Field label="المسؤول" name="assigneeUserId"><Select id="assigneeUserId" name="assigneeUserId" options={d.team.map((t) => ({ value: t.t.userId, label: t.name ?? "موظف" }))} placeholder="مسؤول الملف" /></Field>
                </div>
                <SubmitButton variant="secondary">أنشئ المهمة</SubmitButton>
              </ActionForm>
            </Panel>
          ) : null}

          <Panel title="ملاحظات الدراسة">
            {canManage && !closed ? (
              <ActionForm action={saveIntakeNotes} hidden={{ id: e.id }}>
                <label htmlFor="intakeNotes" className="sr-only">ملاحظات الدراسة</label>
                <Textarea id="intakeNotes" name="intakeNotes" rows={5} defaultValue={e.intakeNotes ?? ""} placeholder="الملاحظات والنواقص والمخاطر الأولية…" />
                <SubmitButton size="sm" variant="secondary">احفظ</SubmitButton>
              </ActionForm>
            ) : (
              <p className="whitespace-pre-line text-[15px]">{e.intakeNotes || "—"}</p>
            )}
          </Panel>

          <Panel title="سجل الملف">
            <ol className="space-y-3">
              {d.events.map(({ ev, name }) => (
                <li key={ev.id} className="text-[14px]">
                  <p className="font-medium">{NAZARA_ACTION_AR[ev.action] ?? ev.action}{ev.toStatus && ev.toStatus !== ev.fromStatus ? ` ← ${STATUS_AR[ev.toStatus as EngagementStatus] ?? ev.toStatus}` : ""}</p>
                  {ev.note ? <p className="text-muted">{ev.note}</p> : null}
                  <p className="text-[12.5px] text-muted">{name ?? "النظام"} · {fmtDateTime(ev.at)}</p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function nextStepText(status: EngagementStatus, requiredOpen: number, hasLead: boolean) {
  switch (status) {
    case "intake":
      return hasLead ? "ابدأ دراسة الملف واستلام مستنداته." : "عيّن مسؤول الملف، ثم ابدأ الدراسة.";
    case "under_review":
      return requiredOpen ? `استكمل قائمة الاستلام (${requiredOpen} بند مطلوب)، وسجّل قرار التعيين إن صدر، ثم اعتمد القبول.` : "قائمة الاستلام مكتملة. اعتمد القبول أو اطلب استكمال ما يلزم.";
    case "pending_completion":
      return "بانتظار استكمال المستندات من صاحب الطلب.";
    case "accepted":
      return "سجّل قرار التعيين كاملًا، ثم باشر النظارة.";
    case "active":
      return "النظارة قائمة: يدير الفريق الوقف من ملفه، وتُتابع المستحقات من هنا.";
    case "suspended":
      return "النظارة موقوفة مؤقتًا.";
    case "ending":
      return "أكمل بنود التسليم ثم أقفل النظارة.";
    default:
      return "الملف مقفل.";
  }
}

function OpsList({ title, href, items, empty }: { title: string; href: string; empty: string; items: { k: string; main: string; sub?: string; href?: string; tone: "critical" | "fine" | "info" | "neutral" }[] }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center justify-between gap-2 text-[15px] font-semibold">
        <span>{title}</span>
        <Link href={href} className="text-[13px] font-normal text-ink hover:underline">فتح</Link>
      </h3>
      {items.length ? (
        <ul className="space-y-1.5">
          {items.map((i) => (
            <li key={i.k} className="flex items-start justify-between gap-2 text-[14px]">
              {i.href ? <Link href={i.href} className="min-w-0 text-ink hover:underline">{i.main}</Link> : <span className="min-w-0">{i.main}</span>}
              {i.sub ? <Badge tone={i.tone} icon={false}>{i.sub}</Badge> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[14px] text-muted">{empty}</p>
      )}
    </section>
  );
}
