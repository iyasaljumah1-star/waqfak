import type { Metadata } from "next";
import { ListChecks } from "lucide-react";
import { EmptyState, PageHeader, Stat } from "@/components/ui";
import { StatusForm } from "@/components/tasks/forms";
import { TaskCard } from "@/components/tasks/task-card";
import { fmtNumber } from "@/lib/utils";
import { requireAuth } from "@/server/authz/context";
import { todayISO } from "@/server/engines/dates";
import { read } from "@/server/modules/_shared";
import { BUCKET_AR, dueBucket, type DueBucket } from "@/server/modules/tasks/pure";
import { myTasks } from "@/server/modules/tasks/queries";

export const metadata: Metadata = { title: "مهامي" };

const ORDER: DueBucket[] = ["overdue", "week", "later", "none", "closed"];

export default async function MyTasksPage() {
  const auth = await requireAuth({ next: "/app/tasks" });
  const rows = await read(auth, (tx) => myTasks(tx, { id: auth.user.id, isStaff: auth.isStaff }));
  const today = todayISO();
  const groups = ORDER.map((b) => ({ b, items: rows.filter((r) => dueBucket(r.t.dueOn, r.t.status, today) === b) }));
  const n = (b: DueBucket) => groups.find((g) => g.b === b)!.items.length;

  return (
    <div className="space-y-6">
      <PageHeader title="مهامي" description={auth.isStaff ? "المهام المسندة إليك في الأوقاف التي تعمل عليها." : "المهام المسندة إليك في كل أوقافك، مرتبة حسب مواعيدها."} />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="متأخرة" value={fmtNumber(n("overdue"))} tone={n("overdue") ? "critical" : undefined} />
        <Stat label="خلال 7 أيام" value={fmtNumber(n("week"))} />
        <Stat label="مفتوحة" value={fmtNumber(rows.length - n("closed"))} />
      </div>
      {rows.length ? (
        groups.filter((g) => g.items.length).map((g) => (
          <section key={g.b} aria-labelledby={`b-${g.b}`} className="space-y-2">
            <h2 id={`b-${g.b}`} className={g.b === "overdue" ? "font-semibold text-critical" : "font-semibold"}>{BUCKET_AR[g.b]} ({g.items.length})</h2>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {(g.b === "closed" ? g.items.slice(0, 12) : g.items).map((r) => (
                <div key={r.t.id} className="space-y-2">
                  <TaskCard t={{ ...r.t, assigneeName: r.assigneeName, waqfName: r.waqfName }} today={today} showWaqf />
                  {!r.t.waqfId && g.b !== "closed" ? <StatusForm taskId={r.t.id} status={r.t.status} progress={r.t.progress} hasChecklist={false} canCancel /> : null}
                </div>
              ))}
            </div>
          </section>
        ))
      ) : (
        <EmptyState icon={ListChecks} title="لا مهام مسندة إليك">تظهر هنا المهام التي يكلّفك بها الناظر أو المجلس، ومهام خطة عمل التقييم.</EmptyState>
      )}
    </div>
  );
}
