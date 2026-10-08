import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, DefinitionList, PageHeader, Panel, ProgressBar } from "@/components/ui";
import { ChecklistAddForm, ChecklistToggle, CommentForm, EditTaskForm, StatusForm } from "@/components/tasks/forms";
import { cn, fmtBoth, fmtDateTime, relDays } from "@/lib/utils";
import { requireAuth, requireWaqf, waqfCan } from "@/server/authz/context";
import { todayISO } from "@/server/engines/dates";
import { read } from "@/server/modules/_shared";
import { isUuid } from "@/server/modules/waqf-core/queries";
import { isOverdue, sanitizeChecklist, TASK_PRIORITY_AR, TASK_SOURCE_AR, TASK_STATUS_AR, VISIBILITY_AR } from "@/server/modules/tasks/pure";
import { assignableMembers, taskDetail } from "@/server/modules/tasks/queries";

export const metadata: Metadata = { title: "مهمة" };

export default async function TaskPage({ params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  if (!isUuid(taskId)) notFound();
  const auth = await requireAuth({ next: `/app/w/${id}/tasks/${taskId}` });
  const access = await requireWaqf(auth, id, "waqf.view");
  const manage = waqfCan(access, "waqf.edit") || waqfCan(access, "governance.manage") || waqfCan(access, "compliance.manage");
  const me = { id: auth.user.id, isStaff: auth.isStaff };
  const { d, members } = await read(auth, async (tx) => ({ d: await taskDetail(tx, id, taskId, me), members: manage ? await assignableMembers(tx, id) : [] }));
  if (!d) notFound();
  const t = d.t;
  const today = todayISO();
  const list = sanitizeChecklist(t.checklist);
  const canWork = manage || t.assigneeUserId === me.id;
  const overdue = isOverdue(t.dueOn, t.status, today);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.title}
        crumbs={[{ href: `/app/w/${id}`, label: access.waqf.name }, { href: `/app/w/${id}/tasks`, label: "المهام" }, { label: "مهمة" }]}
        actions={
          <div className="flex flex-wrap gap-1">
            <Badge tone={t.status === "done" ? "ok" : t.status === "cancelled" ? "neutral" : overdue ? "critical" : "info"} icon={overdue}>{overdue ? "متأخرة" : TASK_STATUS_AR[t.status]}</Badge>
            <Badge icon={false}>{TASK_PRIORITY_AR[t.priority] ?? t.priority}</Badge>
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <Panel title="التفاصيل">
            {t.description ? <p className="mb-4 whitespace-pre-line leading-8">{t.description}</p> : null}
            <DefinitionList
              items={[
                { label: "المكلّف", value: d.assigneeName ?? "بلا مكلّف" },
                { label: "الموعد النهائي", value: t.dueOn ? <span className={cn(overdue && "font-semibold text-critical")}>{fmtBoth(t.dueOn)} — {relDays(t.dueOn)}</span> : "بلا موعد" },
                { label: "المصدر", value: d.source ? (d.source.href ? <Link className="text-ink hover:underline" href={d.source.href}>{d.source.label}</Link> : d.source.label) : TASK_SOURCE_AR[t.sourceType] },
                { label: "الظهور", value: VISIBILITY_AR[t.visibility] ?? t.visibility },
                { label: "أنشأها", value: d.creator ?? "—" },
                { label: "أُنجزت", value: t.completedAt ? fmtDateTime(t.completedAt) : "—" },
              ]}
            />
          </Panel>

          <Panel title="قائمة التحقق" description={list.length ? `${list.filter((i) => i.done).length} من ${list.length} منجزة` : undefined}>
            <div className="mb-3 flex items-center gap-2">
              <div className="flex-1"><ProgressBar value={t.progress} tone={t.status === "done" ? "ok" : overdue ? "critical" : "ink"} label="نسبة الإنجاز" /></div>
              <span className="tabular text-[13px] text-muted">{t.progress}%</span>
            </div>
            {list.length ? (
              <ul className="space-y-0.5">
                {list.map((i, idx) => <li key={idx}><ChecklistToggle taskId={t.id} index={idx} text={i.text} done={i.done} disabled={!canWork} /></li>)}
              </ul>
            ) : <p className="text-[14px] text-muted">لا بنود. أضف بنودًا ليُحسب التقدم تلقائيًا.</p>}
            {canWork ? <div className="mt-3"><ChecklistAddForm taskId={t.id} /></div> : null}
          </Panel>

          <Panel title={`التعليقات (${d.comments.length})`}>
            {d.comments.length ? (
              <ol className="mb-4 space-y-3">
                {d.comments.map((c) => (
                  <li key={c.id} className="rounded-md border border-line p-3">
                    <p className="text-[13px] text-muted">{c.author ?? "مستخدم"}{c.authorStaff ? " · فريق وقفك" : ""} · {fmtDateTime(c.createdAt)}</p>
                    <p className="mt-1 whitespace-pre-line">{c.body}</p>
                  </li>
                ))}
              </ol>
            ) : null}
            <CommentForm taskId={t.id} />
          </Panel>
        </div>

        <aside className="space-y-6">
          {canWork ? (
            <Panel title="الحالة">
              <StatusForm taskId={t.id} status={t.status} progress={t.progress} hasChecklist={list.length > 0} canCancel={manage} />
            </Panel>
          ) : null}
          {manage ? (
            <Panel title="التكليف والموعد">
              <EditTaskForm task={{ id: t.id, assigneeUserId: t.assigneeUserId, dueOn: t.dueOn, priority: t.priority, visibility: t.visibility }} staff={auth.isStaff}
                members={members.map((m) => ({ value: m.id, label: `${m.name} — ${m.roles.join("، ")}` }))} />
            </Panel>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
