import type { Metadata } from "next";
import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { Badge, EmptyState, PageHeader, Panel, Stat, type Tone } from "@/components/ui";
import { RespondForm, StatusButton } from "@/components/complaints/respond-form";
import { cn, fmtDateTime, fmtNumber } from "@/lib/utils";
import { requireAuth, requireWaqf } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { COMPLAINT_KIND_AR, COMPLAINT_STATUS_AR, slaState } from "@/server/modules/complaints/pure";
import { waqfComplaints } from "@/server/modules/complaints/queries";

export const metadata: Metadata = { title: "الشكاوى والاستفسارات" };

const STATUS_TONE: Record<string, Tone> = { open: "info", in_progress: "warn", answered: "ok", closed: "neutral" };
const FILTERS = [["open", "غير المغلقة"], ["all", "الكل"], ["overdue", "المتأخرة"]] as const;

export default async function ComplaintsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ f?: string }> }) {
  const { id } = await params;
  const { f = "open" } = await searchParams;
  const auth = await requireAuth({ next: `/app/w/${id}/complaints` });
  const access = await requireWaqf(auth, id, "complaints.handle");
  const rows = await read(auth, (tx) => waqfComplaints(tx, id));
  const now = new Date();
  const isOpen = (s: string) => s === "open" || s === "in_progress";
  const overdue = rows.filter((r) => slaState(r.c.slaDueAt, r.c.status, now) === "overdue");
  const shown = f === "all" ? rows : f === "overdue" ? overdue : rows.filter((r) => r.c.status !== "closed");
  const answered = rows.filter((r) => r.c.respondedAt);
  const inSla = answered.filter((r) => r.c.respondedAt! <= r.c.slaDueAt).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="الشكاوى والاستفسارات"
        description="طلبات المستفيدين: استفسارات وشكاوى وطلبات اطلاع. لكل طلب مهلة رد بأيام العمل؛ ويُشعر مقدّم الطلب فور الرد."
        crumbs={[{ href: `/app/w/${id}`, label: access.waqf.name }, { label: "الشكاوى والاستفسارات" }]}
      />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="مفتوحة" value={fmtNumber(rows.filter((r) => isOpen(r.c.status)).length)} />
        <Stat label="تجاوزت المهلة" value={fmtNumber(overdue.length)} tone={overdue.length ? "critical" : undefined} />
        <Stat label="الرد في المهلة" value={answered.length ? `${Math.round((inSla / answered.length) * 100)}%` : "—"} sub={`${inSla} من ${answered.length}`} tone={answered.length && inSla === answered.length ? "ok" : undefined} />
      </div>
      <nav aria-label="تصفية" className="flex flex-wrap gap-1 text-[14px]">
        {FILTERS.map(([k, l]) => (
          <Link key={k} href={k === "open" ? `/app/w/${id}/complaints` : `/app/w/${id}/complaints?f=${k}`} aria-current={f === k ? "page" : undefined}
            className={cn("rounded-full border px-3 py-1.5", f === k ? "border-ink bg-ink text-white" : "border-line bg-surface hover:border-ink")}>{l}</Link>
        ))}
      </nav>
      <Panel tight>
        {shown.length ? (
          <ul className="divide-y divide-line">
            {shown.map(({ c, raisedBy, beneficiary, responder }) => {
              const sla = slaState(c.slaDueAt, c.status, now);
              return (
                <li key={c.id} id={c.number} className="space-y-3 px-4 py-4 md:px-5" data-testid="complaint">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-muted">
                        <span dir="ltr" className="tabular">{c.number}</span> · {COMPLAINT_KIND_AR[c.kind] ?? c.kind} · {beneficiary ?? raisedBy ?? "مستخدم"} · {fmtDateTime(c.createdAt)}
                      </p>
                      <p className="mt-1 font-semibold">{c.subject}</p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={STATUS_TONE[c.status] ?? "neutral"} icon={false}>{COMPLAINT_STATUS_AR[c.status] ?? c.status}</Badge>
                      {sla === "overdue" ? <Badge tone="critical">تجاوز المهلة</Badge> : sla === "due_soon" ? <Badge tone="warn">المهلة تقترب</Badge> : null}
                    </div>
                  </div>
                  <p className="whitespace-pre-line rounded-md bg-surface-2 px-3 py-2 leading-7">{c.body}</p>
                  <p className={cn("text-[13px]", sla === "overdue" ? "font-semibold text-critical" : "text-muted")}>الرد مطلوب قبل {fmtDateTime(c.slaDueAt)}</p>
                  {c.response ? (
                    <div className="rounded-md border border-ok/40 bg-ok-soft/40 px-3 py-2">
                      <p className="text-[13px] text-muted">رد {responder ?? "الناظر"} · {fmtDateTime(c.respondedAt)}{c.respondedAt && c.respondedAt > c.slaDueAt ? " · بعد المهلة" : ""}</p>
                      <p className="mt-1 whitespace-pre-line">{c.response}</p>
                    </div>
                  ) : null}
                  {c.status !== "closed" ? (
                    <div className="flex flex-wrap items-start gap-4">
                      <details className="min-w-0 flex-1" open={!c.response}>
                        <summary className="cursor-pointer text-[14px] text-ink">{c.response ? "عدّل الرد" : "ردّ"}</summary>
                        <div className="mt-3 max-w-2xl"><RespondForm waqfId={id} complaintId={c.id} number={c.number} existing={c.response} /></div>
                      </details>
                      {c.status === "open" ? <StatusButton waqfId={id} complaintId={c.id} status="in_progress" label="قيد المعالجة" /> : null}
                      {c.response ? <StatusButton waqfId={id} complaintId={c.id} status="closed" label="أغلق" /> : null}
                    </div>
                  ) : <StatusButton waqfId={id} complaintId={c.id} status="open" label="أعد الفتح" />}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="p-4"><EmptyState icon={MessagesSquare} title={f === "open" ? "لا طلبات مفتوحة" : "لا طلبات"}>يرسل المستفيدون طلباتهم من بوابة المستفيد، وتصلك إشعارات بها.</EmptyState></div>
        )}
      </Panel>
    </div>
  );
}
