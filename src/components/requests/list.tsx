import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { ButtonLink, DataTable, EmptyState } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import type { RequestListRow } from "@/server/modules/requests/queries";
import { ConflictBadge, SlaBadge, StatusBadge } from "./bits";

/** Client-side request table (portal). */
export function ClientRequestTable({ rows, showWaqf = true, newHref = "/app/services" }: { rows: RequestListRow[]; showWaqf?: boolean; newHref?: string }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => r.id}
      caption="الطلبات"
      empty={
        <EmptyState icon={ClipboardList} title="لا طلبات بعد" action={<ButtonLink href={newHref}>اطلب خدمة</ButtonLink>}>
          اختر خدمة من الكتالوج وأرسل طلبك، وتابع مراحله من هنا.
        </EmptyState>
      }
      columns={[
        { key: "n", label: "الطلب", render: (r) => <Link href={`/app/requests/${r.id}`} className="tabular font-medium text-ink hover:underline" dir="ltr">{r.number}</Link> },
        { key: "s", label: "الخدمة", render: (r) => <span>{r.serviceName}</span> },
        ...(showWaqf ? [{ key: "w", label: "الوقف", render: (r: RequestListRow) => <span className={r.waqfName ? "" : "text-muted"}>{r.waqfName ?? "بلا وقف"}</span> }] : []),
        { key: "st", label: "الحالة", render: (r) => <span className="flex flex-wrap gap-1"><StatusBadge status={r.status} /><ConflictBadge value={r.conflictCheck} /></span> },
        { key: "sla", label: "المهلة", render: (r) => <SlaBadge due={r.slaDueAt} status={r.status} />, hideOnMobile: true },
        { key: "d", label: "أُرسل", render: (r) => <span className="text-sm text-muted">{fmtDate(r.submittedAt)}</span>, hideOnMobile: true },
      ]}
    />
  );
}
