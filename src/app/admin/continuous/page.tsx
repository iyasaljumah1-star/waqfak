import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Repeat } from "lucide-react";
import { Badge, EmptyState, PageHeader, Panel, Stat } from "@/components/ui";
import { StatusBadge } from "@/components/requests/bits";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { continuousPortfolio } from "@/server/modules/operations/continuous";
import { CONTINUOUS, CONTINUOUS_CODES } from "@/server/modules/operations/continuous-pure";
import { saveResponseReminderDays } from "@/server/modules/operations/continuous-actions";
import { ActionForm } from "@/components/requests/forms";
import { Field, Input } from "@/components/ui/form";
import { settings } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export const metadata: Metadata = { title: "الخدمات المستمرة" };

const TONE: Record<string, "ok" | "fine" | "warn" | "neutral"> = { active: "ok", suspended: "fine", terminated: "warn", ended: "neutral" };

/** Every running continuous service the viewer may see: term, current and next cycle, late and done deliveries. */
export default async function ContinuousServices() {
  const auth = await requireStaff("admin.access");
  if (!auth.perms.has("staff.requests.assigned") && !auth.perms.has("admin.requests.all")) redirect("/admin?denied=1");
  const rows = await read(auth, (tx) => continuousPortfolio(tx, auth));
  const remind = await read(auth, async (tx) => Number(((await tx.select({ v: settings.value }).from(settings).where(eq(settings.key, "delivery.response_reminder_days")).limit(1))[0]?.v as { days?: number } | undefined)?.days ?? 7));
  const late = rows.reduce((s, r) => s + r.late, 0);
  const noTerm = rows.filter((r) => !r.term).length;
  const unset = rows.filter((r) => r.cadenceUnset);
  const unsetServices = CONTINUOUS_CODES.filter((c) => !CONTINUOUS[c].cadence);
  const dueSoon = rows.filter((r) => r.open.length).length;
  return (
    <div className="space-y-6">
      <PageHeader title="الخدمات المستمرة" description={auth.perms.has("admin.requests.all") ? "كل الخدمات المستمرة القائمة: المدة، والدورة الحالية والتالية، والمتأخر." : "الخدمات المستمرة المسندة إليك."} />
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="خدمات قائمة" value={rows.length} />
        <Stat label="دورات متأخرة" value={late} tone={late ? "critical" : undefined} />
        <Stat label="خدمات فيها دورة مفتوحة" value={dueSoon} />
        <Stat label="بلا مدة مفعّلة" value={noTerm} tone={noTerm ? "fine" : undefined} sub={`منها ${unset.length} دوريتها غير محددة`} />
      </div>
      <Panel title="الخدمات التي لا دورية افتراضية لها" description="لا تحدد ملفات المشروع ولا الكتالوج دورية تسليماتها: تُحدد لكل عقد (في العرض أو عند تفعيل المدة)، ولا تُنشأ لها مواعيد قبل ذلك.">
        <ul className="flex flex-wrap gap-2" data-testid="unset-cadence-services">
          {unsetServices.map((c) => <li key={c}><Badge tone="fine" icon={false}>{c}</Badge></li>)}
        </ul>
        {unset.length ? <p className="mt-3 text-sm">طلبات قائمة تنتظر تحديد الدورية: {unset.map((r, i) => <span key={r.req.id}>{i ? "، " : ""}<Link href={`/admin/requests/${r.req.id}#service`} className="tabular text-ink underline" dir="ltr">{r.req.number}</Link></span>)}</p> : null}
      </Panel>
      {auth.perms.has("admin.requests.all") ? (
        <Panel title="تذكير العميل بالتسليمات بانتظار رده" description="لا يُعد سكوت العميل اعتمادًا، ولا يُقفل تسليم بمرور الوقت. يصل التذكير داخل المنصة للعميل والمختص.">
          <ActionForm action={saveResponseReminderDays} submit="احفظ" size="sm" variant="secondary">
            <Field label="التذكير بعد (أيام) ثم كل مثلها" name="days" required><Input type="number" name="days" min={1} max={60} required defaultValue={String(remind)} dir="ltr" /></Field>
          </ActionForm>
        </Panel>
      ) : null}
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
                    <td className="px-3">{r.done} مقفلة{r.awaitingClient ? ` · ${r.awaitingClient} بانتظار العميل` : ""}{r.late ? <> · <Badge tone="critical" icon={false}>{r.late} متأخرة</Badge></> : null}</td>
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
