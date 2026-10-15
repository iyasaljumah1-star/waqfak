import Link from "next/link";
import { Eye, FileDown, FileText, Link2 } from "lucide-react";
import { Badge, Panel } from "@/components/ui";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ActionForm } from "@/components/requests/forms";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { createExecTasks, taskAction } from "@/server/modules/operations/exec-actions";
import { createWaqfFromRequest, linkRequestToWaqf } from "@/server/modules/operations/link-actions";
import { EXEC_KIND_LABEL, TASK_EVENT_LABEL, type ExecKind } from "@/server/modules/operations/exec-pure";
import { approveOutput, generateOutput, returnOutput, reviseOutput, submitOutput } from "@/server/modules/outputs/actions";
import { DRAFT_STATUSES, OUTPUT_STATUS_LABEL, OUTPUT_STATUS_TONE } from "@/server/modules/outputs/pure";
import { TASK_STATUS_AR } from "@/server/modules/tasks/pure";
import { STATUS_AR as NAZARA_STATUS } from "@/server/modules/nazara/pure";
import type { requestOperations } from "@/server/modules/operations/queries";

type Ops = Awaited<ReturnType<typeof requestOperations>>;
const TASK_TONE: Record<string, "neutral" | "info" | "ok" | "fine"> = { todo: "neutral", in_progress: "info", done: "ok", cancelled: "fine" };
const WAQF_STATUS: Record<string, string> = { idea: "فكرة", draft: "مسودة", documenting: "قيد التوثيق", documented: "موثق", registered: "مسجل", active: "نشط", suspended: "موقوف", ended: "منتهٍ" };

/** Tasks of the request: who is responsible, who executed, and the actions the viewer may take (rights enforced by the server). */
export function TasksPanel({ ops, requestId, staff, today, status, canWork }: { ops: Ops; requestId: string; staff: { id: string; name: string }[]; today: string; status: string; canWork: boolean }) {
  const missingExec = canWork && ["in_progress", "quality_review", "awaiting_client_approval"].includes(status) && !ops.tasks.some((t) => t.kind && t.kind !== "intake");
  const name = (id: string | null | undefined) => (id ? ops.people.get(id) ?? "—" : null);
  return (
    <Panel id="tasks" title="المهام والإجراءات" description="تُنشأ من مسار الطلب: مراجعة الاكتمال، ومراحل العمل، وإعداد كل مخرج ومراجعته. ينفذها المكلّف، أو مدير مخوّل مباشرة دون إسناد.">
      {ops.tasks.length ? (
        <ol className="space-y-2">
          {ops.tasks.map((t) => {
            const overdue = t.dueOn && t.dueOn < today && (t.status === "todo" || t.status === "in_progress");
            return (
              <li key={t.id} id={`task-${t.id}`} className="rounded-lg border border-line p-3" data-testid={`task-${t.kind}${t.stageKey ? `-${t.stageKey}` : ""}${t.outputKey ? `-${t.outputKey}` : ""}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{t.title}</p>
                  <span className="flex flex-wrap gap-1">
                    <Badge tone="neutral" icon={false}>{EXEC_KIND_LABEL[(t.kind ?? "stage") as ExecKind] ?? t.kind}</Badge>
                    <Badge tone={TASK_TONE[t.status] ?? "neutral"} icon={false}>{TASK_STATUS_AR[t.status] ?? t.status}</Badge>
                    {overdue ? <Badge tone="critical" icon={false}>متأخرة</Badge> : null}
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-muted">
                  المسؤول: {name(t.assigneeUserId) ?? "غير مسندة"}
                  {t.dueOn ? ` · الموعد ${fmtDate(t.dueOn)}` : ""}
                  {t.completedBy ? ` · أنجزها ${name(t.completedBy)}${t.completedBy !== t.assigneeUserId ? " (تنفيذ مباشر)" : ""}` : t.startedBy ? ` · بدأها ${name(t.startedBy)}` : ""}
                </p>
                {t.actions.length ? (
                  <div className="mt-2 flex flex-wrap items-start gap-2">
                    {t.actions.includes("start") ? <ActionForm action={taskAction} hidden={{ taskId: t.id, requestId, action: "start" }} submit="ابدأ التنفيذ" size="sm" variant="secondary" inline /> : null}
                    {t.actions.includes("complete") ? <ActionForm action={taskAction} hidden={{ taskId: t.id, requestId, action: "complete" }} submit={t.right.direct ? "أكملها بنفسي" : "أكمل المهمة"} size="sm" inline /> : null}
                    {t.actions.includes("reopen") ? <ActionForm action={taskAction} hidden={{ taskId: t.id, requestId, action: "reopen" }} submit="أعد فتحها" size="sm" variant="secondary" inline /> : null}
                    {t.actions.includes("return") ? (
                      <details className="w-full sm:w-auto">
                        <summary className="cursor-pointer text-[14px] text-ink">أعدها للاستكمال</summary>
                        <div className="mt-2"><ActionForm action={taskAction} hidden={{ taskId: t.id, requestId, action: "return" }} submit="أعد المهمة" size="sm" variant="secondary">
                          <Field label="السبب" name={`return-${t.id}`} required><Textarea id={`return-${t.id}`} name="note" required minLength={5} className="min-h-16" /></Field>
                        </ActionForm></div>
                      </details>
                    ) : null}
                    {t.actions.includes("assign") ? (
                      <details className="w-full sm:w-auto">
                        <summary className="cursor-pointer text-[14px] text-ink">{t.assigneeUserId ? "أعد الإسناد" : "أسند"}</summary>
                        <div className="mt-2"><ActionForm action={taskAction} hidden={{ taskId: t.id, requestId, action: "assign" }} submit="أسند" size="sm" variant="secondary">
                          <Field label="أسند المهمة إلى" name={`assign-${t.id}`} required><Select id={`assign-${t.id}`} name="userId" required defaultValue={t.assigneeUserId ?? ""} placeholder="اختر الموظف" options={staff.map((s) => ({ value: s.id, label: s.name }))} /></Field>
                        </ActionForm></div>
                      </details>
                    ) : null}
                    {t.actions.includes("cancel") ? (
                      <details className="w-full sm:w-auto">
                        <summary className="cursor-pointer text-[14px] text-critical">ألغِ المهمة</summary>
                        <div className="mt-2"><ActionForm action={taskAction} hidden={{ taskId: t.id, requestId, action: "cancel" }} submit="ألغِ المهمة" size="sm" variant="danger">
                          <Field label="السبب" name={`cancel-${t.id}`} required><Textarea id={`cancel-${t.id}`} name="note" required minLength={5} className="min-h-16" /></Field>
                        </ActionForm></div>
                      </details>
                    ) : null}
                  </div>
                ) : t.kind === "review_output" && t.status !== "done" ? <p className="mt-1 text-[13px] text-muted">تكتمل باعتماد المخرج من لوحة «المخرجات».</p> : null}
                {t.events.length ? (
                  <details className="mt-2 text-[13px] text-muted">
                    <summary className="cursor-pointer">سجل التنفيذ ({t.events.length})</summary>
                    <ul className="mt-1 space-y-0.5">
                      {t.events.map((e) => (
                        <li key={e.id}>
                          {fmtDateTime(e.at)} — {TASK_EVENT_LABEL[e.action] ?? e.action} — {name(e.actorUserId) ?? "النظام"}
                          {e.direct && e.actorUserId ? <span className="text-seal"> (نيابة عن المسؤول{e.ownerUserId ? `: ${name(e.ownerUserId)}` : ""})</span> : null}
                          {e.note ? `: ${e.note}` : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : <p className="text-sm text-muted">لا مهام بعد. تُنشأ مهمة المراجعة عند الإرسال، ومهام التنفيذ عند بدء العمل.</p>}
      {missingExec ? (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-2 text-[13px] text-muted">بدأ تنفيذ هذا الطلب قبل إضافة المهام إلى المنصة.</p>
          <ActionForm action={createExecTasks} hidden={{ requestId }} submit="أنشئ مهام التنفيذ من مسار الطلب" size="sm" variant="secondary" />
        </div>
      ) : null}
    </Panel>
  );
}

/** Platform outputs of the service: draft generated from the data, edited, reviewed and approved per its policy. */
export function OutputsPanel({ ops, requestId, status, canDeliver, canReview, isManager, opinion }: {
  ops: Ops; requestId: string; status: string; canDeliver: boolean; canReview: boolean; isManager: boolean; me: string; opinion: boolean;
}) {
  const working = DRAFT_STATUSES.includes(status);
  if (!ops.outputs.length) return null;
  return (
    <div className="space-y-3" data-testid="outputs">
      {ops.outputs.map(({ def, o, version, blocking, unwritten, warnings, specialtyLabel, reviewLabel, formatLabel, delivered, approve }) => (
        <div key={def.key} className="rounded-lg border border-line p-3" data-testid={`output-${def.key}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 font-medium"><FileText aria-hidden className="size-4 text-muted" />{def.title}</p>
            <span className="flex flex-wrap gap-1">
              <Badge tone="neutral" icon={false}>{formatLabel}</Badge>
              <Badge tone="neutral" icon={false}>{specialtyLabel}</Badge>
              <Badge tone={delivered ? "ok" : o ? OUTPUT_STATUS_TONE[o.status] : "neutral"} icon={false}>{delivered ? "مُسلَّم للعميل" : o ? OUTPUT_STATUS_LABEL[o.status] : "لم تُحفظ مسودة"}</Badge>
              {o && (blocking || unwritten) && o.status !== "approved" ? <Badge tone="fine" icon={false}>مسودة غير مكتملة</Badge> : null}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-muted">
            {o ? <><span dir="ltr" className="tabular">{o.number}</span> · النسخة {o.currentVersion}{version ? ` (${fmtDate(version.at)})` : ""}{o.approvedVersion ? ` · المعتمدة ${o.approvedVersion}${o.selfApproved ? " (اعتماد ذاتي)" : ""}` : ""} · </> : null}
            {reviewLabel}
          </p>
          {o && version ? (
            <p className="mt-1 text-[13px]">
              {blocking ? <span className="text-critical">{blocking} نقص جوهري · </span> : null}
              {unwritten ? <span className="text-critical">{unwritten} جزء يكتبه المختص · </span> : null}
              {warnings ? <span className="text-fine">{warnings} تنبيه</span> : null}
              {!blocking && !unwritten && !warnings ? <span className="text-ok">لا نواقص</span> : null}
            </p>
          ) : null}
          {o?.reviewNote && o.status === "returned" ? <p className="mt-1 text-[13px] text-fine">ملاحظة المراجع: {o.reviewNote}</p> : null}
          <div className="mt-2 flex flex-wrap items-start gap-2">
            {o ? (
              <>
                <Link href={`/admin/requests/${requestId}/outputs/${o.id}`} className="inline-flex h-8 items-center gap-1 rounded-md border border-line px-3 text-sm text-ink hover:bg-ink-soft" data-testid={`preview-${def.key}`}><Eye aria-hidden className="size-4" />معاينة{(o.status === "draft" || o.status === "returned") && canDeliver ? " وتحرير" : ""}</Link>
                {o.currentVersion ? <a href={`/admin/requests/${requestId}/outputs/${o.id}/pdf?v=${o.currentVersion}`} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm text-ink hover:bg-ink-soft"><FileDown aria-hidden className="size-4" />PDF النسخة {o.currentVersion}</a> : null}
              </>
            ) : (
              <Link href={`/admin/requests/${requestId}/outputs/preview?key=${encodeURIComponent(def.key)}`} className="inline-flex h-8 items-center gap-1 rounded-md border border-line px-3 text-sm text-ink hover:bg-ink-soft" data-testid={`preview-${def.key}`}><Eye aria-hidden className="size-4" />معاينة من البيانات الحالية</Link>
            )}
            {!o && canDeliver && working ? <ActionForm action={generateOutput} hidden={{ id: requestId, outputKey: def.key }} submit="احفظ مسودة من بيانات الطلب" size="sm" variant="secondary" inline /> : null}
            {o && (o.status === "draft" || o.status === "returned") && canDeliver ? <ActionForm action={submitOutput} hidden={{ outputId: o.id, requestId }} submit="أرسلها للمراجعة" size="sm" variant="secondary" inline /> : null}
            {o && o.status === "in_review" && (canReview || isManager) ? (
              <details className="w-full">
                <summary className="cursor-pointer text-[14px] text-ink">راجع واعتمد{approve?.ok && approve.self ? " — سيُسجَّل اعتمادًا ذاتيًا" : ""}</summary>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {approve?.ok ? (
                    <ActionForm action={approveOutput} hidden={{ outputId: o.id, requestId }} submit="اعتمد المخرج" size="sm" variant="seal">
                      {opinion || def.specialty === "sharia" ? <Field label="التوقيع: اسم المستشار وصفته" name={`sign-${o.id}`} required><Input id={`sign-${o.id}`} name="signedBy" required minLength={5} /></Field> : null}
                    </ActionForm>
                  ) : <p className="text-[13px] text-muted">{approve?.reason ?? "يعتمده من يملك صلاحية المراجعة."}</p>}
                  <ActionForm action={returnOutput} hidden={{ outputId: o.id, requestId }} submit="أعده للتعديل" size="sm" variant="secondary">
                    <Field label="ما يلزم تعديله" name={`ret-${o.id}`} required><Textarea id={`ret-${o.id}`} name="note" required minLength={5} className="min-h-16" /></Field>
                  </ActionForm>
                </div>
              </details>
            ) : null}
            {o && o.status === "approved" && canDeliver && status === "in_progress" ? <ActionForm action={reviseOutput} hidden={{ outputId: o.id, requestId }} submit="افتح مراجعة جديدة" size="sm" variant="secondary" inline /> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Records linked to the request (both ways), and linking a request sent «with no waqf». */
export function LinksPanel({ ops, requestId, waqf, canLink, suggestedName }: {
  ops: Ops; requestId: string; waqf: { id: string; name: string } | null; canLink: boolean; suggestedName: string;
}) {
  return (
    <Panel title="السجلات المرتبطة" description="ما نشأ عن الطلب أو يتعلق به. حالة كل سجل من مصدره، ولا تختلط بحالة الطلب.">
      <ul className="space-y-2 text-[15px]" data-testid="request-links">
        {waqf ? (
          <li className="flex flex-wrap items-center gap-2">
            <Link2 aria-hidden className="size-4 text-muted" />
            ملف الوقف: <Link className="text-ink hover:underline" href={`/admin/waqfs/${waqf.id}`}>{waqf.name}</Link>
            {ops.links.some((l) => l.entityType === "waqf" && l.relation === "origin") ? <Badge tone="seal" icon={false}>نشأ عن هذا الطلب</Badge> : null}
          </li>
        ) : null}
        {ops.links.filter((l) => l.entityType !== "waqf").map((l) => (
          <li key={l.entityId} className="flex flex-wrap items-center gap-2">
            <Link2 aria-hidden className="size-4 text-muted" />
            <Link className="text-ink hover:underline" href={l.adminHref}>{l.label}</Link>
            <Badge tone="neutral" icon={false}>{l.entityType === "nazara_engagement" ? NAZARA_STATUS[l.status as keyof typeof NAZARA_STATUS] ?? l.status : WAQF_STATUS[l.status ?? ""] ?? l.status}</Badge>
            <span className="text-[13px] text-muted">{l.relation === "origin" ? "فتحه هذا الطلب" : "مرتبط بملف قائم"}</span>
          </li>
        ))}
        {!waqf && !ops.links.length ? <li className="text-muted">الطلب غير مرتبط بملف وقف.</li> : null}
      </ul>
      {!waqf && canLink ? (
        <div className="mt-4 space-y-4 border-t border-line pt-4">
          {ops.requesterWaqfs.length ? (
            <ActionForm action={linkRequestToWaqf} hidden={{ id: requestId }} submit="اربط بالوقف" size="sm" variant="secondary">
              <Field label="وقف قائم لمقدّم الطلب" name="waqfId" required>
                <Select name="waqfId" required placeholder="اختر الوقف" options={ops.requesterWaqfs.map((w) => ({ value: w.id, label: w.name }))} />
              </Field>
            </ActionForm>
          ) : null}
          <ActionForm action={createWaqfFromRequest} hidden={{ id: requestId }} submit="افتح ملف الوقف من الطلب" size="sm" variant="secondary">
            <Field label="اسم الوقف" name="wname" required hint="يُفتح الملف مرة واحدة ويرتبط بالطلب، ويأخذ مقدّم الطلب صفته فيه (واقف أو ناظر).">
              <Input id="wname" name="name" required minLength={3} defaultValue={suggestedName} />
            </Field>
          </ActionForm>
        </div>
      ) : null}
    </Panel>
  );
}
