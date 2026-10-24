import Link from "next/link";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { Badge } from "@/components/ui";
import { StatusBadge } from "@/components/requests/bits";
import { fmtDate } from "@/lib/utils";
import type { HomeRequest } from "@/server/modules/requests/queries";

const OWNER_AR = { client: "عليك أنت", team: "على فريق «وقفك»", manager: "على فريق «وقفك»", none: "" } as const;

/**
 * Requests of the «الخدمات والطلبات» section: each one is a service request (linked to a waqf or not), never a waqf. It
 * shows the service, the date, its status, the waqf it serves if any, the next step and who acts, what waits on the
 * client and the outputs delivered.
 */
export function HomeRequestList({ rows }: { rows: HomeRequest[] }) {
  if (!rows.length)
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-4 py-6 text-center">
        <ClipboardList aria-hidden className="mx-auto size-6 text-muted" />
        <p className="mt-2 text-muted">لا طلبات خدمات بعد. اختر خدمة من الكتالوج، مرتبطة بوقف أو مستقلة.</p>
        <Link href="/app/services" className="mt-2 inline-block text-sm text-ink hover:underline">تصفح الخدمات</Link>
      </div>
    );
  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-surface" data-testid="home-requests">
      {rows.map((r) => (
        <li key={r.id} className="px-4 py-3 md:px-5" data-testid={`home-request-${r.number}`}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={`/app/requests/${r.id}`} className="font-medium text-ink hover:underline">{r.serviceName}</Link>
            <span dir="ltr" className="tabular text-[13px] text-muted">{r.number}</span>
            <StatusBadge status={r.status} />
            {r.openClientItems ? <Badge tone="fine" icon={false}>{r.openClientItems} بانتظار ردك</Badge> : null}
          </div>
          <p className="mt-0.5 text-[13px] text-muted">
            {r.waqfName ? <>الوقف: <Link href={`/app/w/${r.waqfId}`} className="hover:underline">{r.waqfName}</Link></> : "غير مرتبط بوقف"}
            {" · "}
            {r.submittedAt ? `قُدّم ${fmtDate(r.submittedAt)}` : `آخر تحديث ${fmtDate(r.updatedAt)}`}
            {r.outputs.total ? ` · المخرجات: ${r.outputs.delivered} مسلّمة من ${r.outputs.total}` : ""}
          </p>
          {r.open ? (
            <p className="mt-1 text-[14px]">
              <span className="text-muted">الخطوة التالية: </span>{r.phase.next}
              {OWNER_AR[r.phase.owner] ? <span className="text-muted"> ({OWNER_AR[r.phase.owner]})</span> : null}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function SectionHead({ id, title, count, href, hrefLabel }: { id: string; title: string; count?: string; href?: string; hrefLabel?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id={id} className="text-lg font-semibold">
        {title}
        {count ? <span className="tabular ms-2 text-[15px] font-normal text-muted" data-testid={`${id}-count`}>{count}</span> : null}
      </h2>
      {href ? <Link href={href} className="inline-flex items-center gap-1 text-sm text-ink hover:underline">{hrefLabel}<ArrowLeft aria-hidden className="size-3.5" /></Link> : null}
    </div>
  );
}
