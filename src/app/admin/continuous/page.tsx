import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Repeat } from "lucide-react";
import { Badge, EmptyState, PageHeader, Panel, Stat } from "@/components/ui";
import { StatusBadge } from "@/components/requests/bits";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { continuousPortfolio } from "@/server/modules/operations/continuous";

export const metadata: Metadata = { title: "الخدمات المستمرة" };

const TONE: Record<string, "ok" | "fine" | "warn" | "neutral"> = { active: "ok", suspended: "fine", terminated: "warn", ended: "neutral" };

/** Every running continuous service the viewer may see: term, current and next cycle, late and done deliveries. */
export default async function ContinuousServices() {
  const auth = await requireStaff("admin.access");
  if (!auth.perms.has("staff.requests.assigned") && !auth.perms.has("admin.requests.all")) redirect("/admin?denied=1");
  const rows = await read(auth, (tx) => continuousPortfolio(tx, auth));
  const late = rows.reduce((s, r) => s + r.late, 0);
  const noTerm = rows.filter((r) => !r.term).length;
  const dueSoon = rows.filter((r) => r.open.length).length;
  return (
    <div className="space-y-6">
      <PageHeader title="الخدمات المستمرة" description={auth.perms.has("admin.requests.all") ? "كل الخدمات المستمرة القائمة: المدة، والدورة الحالية والتالية، والمتأخر." : "الخدمات المستمرة المسندة إليك."} />
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="خدمات قائمة" value={rows.length} />
        <Stat label="دورات متأخرة" value={late} tone={late ? "critical" : undefined} />
        <Stat label="خدمات فيها دورة مفتوحة" value={dueSoon} />
        <Stat label="بلا مدة محددة" value={noTerm} tone={noTerm ? "fine" : undefined} sub="تُحدد من صفحة الطلب" />
      </div>
      <Panel tight>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="continuous-portfolio">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="px-4 py-2.5 text-start font-medium">الطلب</th>
                  <th className="px-3 text-start font-medium">الخدمة والوقف</th>
                  <th className="px-3 text-start font-medium">المدة</th>
                  <th className="px-3 text-start font-medium">الدورة الحالية</th>
                  <th className="px-3 text-start font-medium">التالية</th>
                  <th className="px-3 text-start font-medium">التسليمات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.req.id}>
                    <td className="px-4 py-2.5"><Link href={`/admin/requests/${r.req.id}#service`} className="font-medium text-ink underline"><bdi dir="ltr" className="tabular">{r.req.number}</bdi></Link><div className="mt-1"><StatusBadge status={r.req.status} /></div></td>
                    <td className="px-3">{r.req.serviceCode} — {r.req.serviceName}<div className="text-muted">{r.req.waqfName ?? "بلا وقف"}</div></td>
                    <td className="px-3"><Badge tone={TONE[r.state ?? ""] ?? "neutral"} icon={false}>{r.stateLabel}</Badge>{r.term ? <div className="tabular text-muted">{r.term.startOn} إلى {r.term.terminatedOn ?? r.term.endOn}{r.cadence ? ` · ${r.cadence}` : ""}</div> : null}</td>
                    <td className="px-3">{r.open.length ? r.open.map((c) => <div key={c.id}>{c.label} <span className="tabular text-muted">({c.dueOn})</span></div>) : <span className="text-muted">لا دورة مفتوحة</span>}</td>
                    <td className="px-3">{r.next ? <>{r.next.label} <span className="tabular text-muted">({r.next.due})</span></> : <span className="text-muted">—</span>}</td>
                    <td className="px-3">{r.done} مكتملة{r.late ? <> · <Badge tone="critical" icon={false}>{r.late} متأخرة</Badge></> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState icon={Repeat} title="لا خدمات مستمرة قائمة">تظهر هنا طلبات الخدمات المستمرة بعد إرسالها.</EmptyState>}
      </Panel>
    </div>
  );
}
