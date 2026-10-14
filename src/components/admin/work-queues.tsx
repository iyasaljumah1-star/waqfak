import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui";
import { cn, fmtDate, fmtNumber } from "@/lib/utils";
import type { Queue } from "@/server/modules/admin/work-queues";

/** The operations board: one card per queue, each line opens the record itself. Empty queues stay visible (as zero). */
export function WorkQueues({ queues }: { queues: Queue[] }) {
  if (!queues.length) return null;
  const active = queues.filter((q) => q.count);
  const empty = queues.filter((q) => !q.count);
  return (
    <section aria-label="قوائم العمل" className="space-y-3">
      <h2 className="text-[19px] font-semibold">ما ينتظر الإجراء</h2>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {active.map((q) => (
          <article key={q.key} className="min-w-0 rounded-lg border border-line bg-surface" data-testid={`queue-${q.key}`}>
            <header className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
              <div className="min-w-0">
                <h3 className="text-[16px] font-semibold">{q.title}</h3>
                <p className="text-[13px] text-muted">{q.defines}</p>
              </div>
              <span className="tabular rounded-full bg-ink px-2 py-0.5 text-[13px] font-semibold text-white">{fmtNumber(q.count)}</span>
            </header>
            <ul className="divide-y divide-line">
              {q.items.map((i) => (
                <li key={i.id}>
                  <Link href={i.href} className="flex items-center gap-2 px-4 py-2 hover:bg-ink-soft/40">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px]">{i.title}</span>
                      {i.meta ? <span className="block truncate text-[13px] text-muted">{i.meta}</span> : null}
                    </span>
                    {i.due ? <span className={cn("shrink-0 text-[12px]", i.overdue ? "font-semibold text-critical" : "text-muted")}>{fmtDate(i.due)}</span> : null}
                    <ArrowLeft aria-hidden className="size-4 shrink-0 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
            {q.count > q.items.length && q.more ? <Link href={q.more} className="block px-4 py-2 text-[14px] text-ink hover:underline">عرض الكل ({fmtNumber(q.count)})</Link> : null}
          </article>
        ))}
      </div>
      {empty.length ? (
        <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
          لا شيء في: {empty.map((q) => <Badge key={q.key} tone="neutral" icon={false}>{q.title}</Badge>)}
        </p>
      ) : null}
    </section>
  );
}
