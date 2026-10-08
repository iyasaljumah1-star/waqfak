import Link from "next/link";
import { CalendarClock, EyeOff, MessageSquare, UserRound } from "lucide-react";
import { Badge, ProgressBar } from "@/components/ui";
import { cn, fmtDate, relDays } from "@/lib/utils";
import { isOverdue, sanitizeChecklist, TASK_PRIORITY_AR, TASK_SOURCE_AR, TASK_STATUS_AR } from "@/server/modules/tasks/pure";

export type TaskCardData = {
  id: string; waqfId: string | null; title: string; status: string; priority: string; dueOn: string | null; progress: number; checklist: unknown;
  visibility: string; sourceType: string; assigneeName: string | null; waqfName?: string | null; comments?: number;
};

export function TaskCard({ t, today, showWaqf }: { t: TaskCardData; today: string; showWaqf?: boolean }) {
  const overdue = isOverdue(t.dueOn, t.status, today);
  const list = sanitizeChecklist(t.checklist);
  const href = t.waqfId ? `/app/w/${t.waqfId}/tasks/${t.id}` : `/app/tasks#${t.id}`;
  return (
    <article id={t.id} className={cn("rounded-lg border bg-surface p-3", overdue ? "border-critical/60" : "border-line", (t.status === "done" || t.status === "cancelled") && "opacity-75")} data-testid="task-card">
      <div className="flex items-start justify-between gap-2">
        <Link href={href} className="min-w-0 font-medium text-ink hover:underline">{t.title}</Link>
        {t.priority === "urgent" || t.priority === "high" ? <Badge tone={t.priority === "urgent" ? "critical" : "fine"} icon={false} className="shrink-0">{TASK_PRIORITY_AR[t.priority]}</Badge> : null}
      </div>
      {showWaqf && t.waqfName ? <p className="mt-0.5 text-[13px] text-muted">{t.waqfName}</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
        <span className="inline-flex items-center gap-1"><UserRound aria-hidden className="size-3.5" />{t.assigneeName ?? "بلا مكلّف"}</span>
        {t.dueOn ? (
          <span className={cn("inline-flex items-center gap-1", overdue && "font-semibold text-critical")}>
            <CalendarClock aria-hidden className="size-3.5" />
            {fmtDate(t.dueOn)}{t.status === "todo" || t.status === "in_progress" ? ` — ${relDays(t.dueOn)}` : ""}
          </span>
        ) : null}
        {t.visibility === "internal" ? <span className="inline-flex items-center gap-1"><EyeOff aria-hidden className="size-3.5" />داخلية</span> : null}
        {t.comments ? <span className="inline-flex items-center gap-1"><MessageSquare aria-hidden className="size-3.5" />{t.comments}</span> : null}
        {t.sourceType !== "manual" ? <span>{TASK_SOURCE_AR[t.sourceType] ?? t.sourceType}</span> : null}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1"><ProgressBar value={t.progress} tone={t.status === "done" ? "ok" : overdue ? "critical" : "ink"} label={`نسبة الإنجاز ${t.progress}%`} /></div>
        <span className="tabular w-10 text-end text-[12px] text-muted">{t.progress}%</span>
      </div>
      {list.length ? <p className="mt-1 text-[12px] text-muted">قائمة التحقق: {list.filter((i) => i.done).length} من {list.length}</p> : null}
      <p className="sr-only">الحالة: {TASK_STATUS_AR[t.status]}</p>
    </article>
  );
}
