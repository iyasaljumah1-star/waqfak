import type { Metadata } from "next";
import Link from "next/link";
import { count, inArray } from "drizzle-orm";
import { ListChecks } from "lucide-react";
import { EmptyState, PageHeader, Panel, Stat } from "@/components/ui";
import { NewTaskForm } from "@/components/tasks/forms";
import { TaskCard } from "@/components/tasks/task-card";
import { cn, fmtNumber } from "@/lib/utils";
import { requireAuth, requireWaqf, waqfCan } from "@/server/authz/context";
import { taskComments } from "@/server/db/schema";
import { todayISO } from "@/server/engines/dates";
import { read } from "@/server/modules/_shared";
import { isOverdue, TASK_STATUS_AR } from "@/server/modules/tasks/pure";
import { assignableMembers, waqfTasks } from "@/server/modules/tasks/queries";

export const metadata: Metadata = { title: "المهام" };

const FILTERS = [["all", "الكل"], ["mine", "المسندة إليّ"], ["overdue", "المتأخرة"]] as const;

export default async function WaqfTasksPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ f?: string }> }) {
  const { id } = await params;
  const { f = "all" } = await searchParams;
  const auth = await requireAuth({ next: `/app/w/${id}/tasks` });
  const access = await requireWaqf(auth, id, "waqf.view");
  const manage = waqfCan(access, "waqf.edit") || waqfCan(access, "governance.manage") || waqfCan(access, "compliance.manage");
  const me = { id: auth.user.id, isStaff: auth.isStaff };
  const today = todayISO();
  const { rows, members, comments } = await read(auth, async (tx) => {
    const rows = await waqfTasks(tx, id, me);
    const comments = rows.length
      ? await tx.select({ taskId: taskComments.taskId, n: count() }).from(taskComments).where(inArray(taskComments.taskId, rows.map((r) => r.t.id))).groupBy(taskComments.taskId)
      : [];
    return { rows, members: manage ? await assignableMembers(tx, id) : [], comments };
  });
  const cmap = new Map(comments.map((c) => [c.taskId, Number(c.n)]));
  const filtered = rows.filter((r) => (f === "mine" ? r.t.assigneeUserId === me.id : f === "overdue" ? isOverdue(r.t.dueOn, r.t.status, today) : true));
  const cols = (["todo", "in_progress", "done"] as const).map((s) => ({ s, items: filtered.filter((r) => r.t.status === s) }));
  const cancelled = filtered.filter((r) => r.t.status === "cancelled");
  const overdue = rows.filter((r) => isOverdue(r.t.dueOn, r.t.status, today)).length;
  const open = rows.filter((r) => r.t.status === "todo" || r.t.status === "in_progress").length;
  const card = (r: (typeof rows)[number]) => (
    <TaskCard key={r.t.id} today={today} t={{ ...r.t, assigneeName: r.assigneeName, comments: cmap.get(r.t.id) ?? 0 }} />
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="المهام"
        description="مهام تشغيل الوقف وتنفيذ قرارات المجلس وخطط التقييم، بمكلّفيها ومواعيدها."
        crumbs={[{ href: `/app/w/${id}`, label: access.waqf.name }, { label: "المهام" }]}
        actions={manage ? <a href="#new-task" className="inline-flex h-11 items-center rounded-md bg-ink px-4 text-[15px] font-medium text-white hover:bg-ink-hover">مهمة جديدة</a> : null}
      />

      <div className="grid grid-cols-3 gap-3">
        <Stat label="مفتوحة" value={fmtNumber(open)} />
        <Stat label="متأخرة" value={fmtNumber(overdue)} tone={overdue ? "critical" : undefined} />
        <Stat label="منجزة" value={fmtNumber(rows.filter((r) => r.t.status === "done").length)} tone="ok" />
      </div>

      <nav aria-label="تصفية المهام" className="flex flex-wrap gap-1 text-[14px]">
        {FILTERS.map(([k, l]) => (
          <Link key={k} href={k === "all" ? `/app/w/${id}/tasks` : `/app/w/${id}/tasks?f=${k}`} aria-current={f === k ? "page" : undefined}
            className={cn("rounded-full border px-3 py-1.5", f === k ? "border-ink bg-ink text-white" : "border-line bg-surface hover:border-ink")}>{l}</Link>
        ))}
      </nav>

      {rows.length ? (
        <div className="grid gap-4 md:grid-cols-3">
          {cols.map(({ s, items }) => (
            <section key={s} aria-labelledby={`col-${s}`} className="rounded-lg bg-surface-2/60 p-2 ring-1 ring-line">
              <h2 id={`col-${s}`} className="flex items-center justify-between px-1 pb-2 pt-1 text-[15px] font-semibold">
                {TASK_STATUS_AR[s]}
                <span className="tabular rounded-full bg-surface px-2 text-[13px] font-medium text-muted ring-1 ring-line">{items.length}</span>
              </h2>
              <div className="space-y-2">
                {items.length ? items.map(card) : <p className="px-1 py-4 text-center text-[13px] text-muted">لا مهام</p>}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState icon={ListChecks} title="لا مهام بعد">
          تُنشأ المهام يدويًا، أو من قرارات المجلس، أو من خطة عمل التقييم.
        </EmptyState>
      )}

      {cancelled.length ? (
        <details>
          <summary className="cursor-pointer text-[14px] text-ink">المهام الملغاة ({cancelled.length})</summary>
          <div className="mt-2 grid gap-2 md:grid-cols-3">{cancelled.map(card)}</div>
        </details>
      ) : null}

      {manage ? (
        <Panel id="new-task" title="مهمة جديدة">
          <NewTaskForm waqfId={id} staff={auth.isStaff} members={members.map((m) => ({ value: m.id, label: `${m.name} — ${m.roles.join("، ")}` }))} />
        </Panel>
      ) : null}
    </div>
  );
}
