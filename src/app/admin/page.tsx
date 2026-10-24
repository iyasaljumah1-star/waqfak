import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Alert, PageHeader, Panel } from "@/components/ui";
import { AdminIcon } from "@/components/admin/icons";
import { ADMIN_NAV } from "@/config/nav";
import { cn, fmtNumber, fmtSAR } from "@/lib/utils";
import { requireStaff } from "@/server/authz/context";
import { dashboardData } from "@/server/modules/admin/dashboard";
import { workQueues } from "@/server/modules/admin/work-queues";
import { WorkQueues } from "@/components/admin/work-queues";
import { STATUS_LABEL } from "@/server/modules/requests/workflow";

export const metadata: Metadata = { title: "لوحة الشركة" };

function Tile({ href, label, value, sub, tone }: { href?: string; label: string; value: ReactNode; sub?: ReactNode; tone?: "critical" | "fine" | "ok" }) {
  const body = (
    <>
      <p className="text-sm text-muted">{label}</p>
      <p className={cn("tabular mt-1 text-[24px] font-semibold sm:text-[28px] leading-tight", tone === "critical" ? "text-critical" : tone === "fine" ? "text-fine" : tone === "ok" ? "text-ok" : "text-text")}>{value}</p>
      {sub ? <p className="mt-0.5 text-[13px] text-muted">{sub}</p> : null}
    </>
  );
  return href ? (
    <Link href={href} className="group block rounded-lg border border-line bg-surface p-3 transition-colors hover:border-ink/40 sm:p-4">
      {body}
    </Link>
  ) : (
    <div className="rounded-lg border border-line bg-surface p-3 sm:p-4">{body}</div>
  );
}

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const auth = await requireStaff("admin.access");
  const sp = await searchParams;
  const [d, queues] = await Promise.all([dashboardData(auth), workQueues(auth)]);
  const max = Math.max(1, ...(d.requests?.byStatus.map((s) => s.n) ?? [1]));
  const shortcuts = ADMIN_NAV.filter((n) => n.href !== "/admin" && n.perm && auth.perms.has(n.perm));
  // Waqfs and service requests are separate sections with their own counters: a request is never counted as a waqf,
  // and «الأوقاف» counts complete waqfs only (waqf-core/completeness); drafts and files being completed are apart.
  const waqfTiles: ReactNode[] = [];
  if (d.waqfs) {
    waqfTiles.push(
      <Tile key="w" href="/admin/waqfs" label="الأوقاف المكتملة" value={fmtNumber(d.waqfs.complete)} sub="موثقة وصكها في الوثائق، بأصول ومصارف ونظارة" />,
      <Tile key="wp" href="/admin/waqfs?state=in_progress" label="ملفات قيد التأسيس أو الاستكمال" value={fmtNumber(d.waqfs.inProgress)} sub={`${fmtNumber(d.waqfs.demo)} تجريبي ضمن الكل`} />,
      <Tile key="wr" href="/admin/waqfs?state=reviews" label="تعديلات ملفات بانتظار المراجعة" value={fmtNumber(d.waqfs.reviews)} tone={d.waqfs.reviews ? "fine" : undefined} />,
    );
  }
  if (d.obligations)
    waqfTiles.push(<Tile key="o" href="/admin/waqfs" label="التزامات نظامية متأخرة" value={fmtNumber(d.obligations.overdue)} tone={d.obligations.overdue ? "critical" : "ok"} sub={`في ${fmtNumber(d.obligations.waqfsAffected)} وقف · ${fmtNumber(d.obligations.dueSoon)} تقترب`} />);
  const requestTiles: ReactNode[] = [];
  if (d.requests)
    requestTiles.push(
      <Tile key="r" href="/admin/requests" label={d.requests.scope === "all" ? "الطلبات المفتوحة" : "طلباتي المفتوحة"} value={fmtNumber(d.requests.open)} sub={`إجمالي الطلبات المقدّمة: ${fmtNumber(d.requests.total)}`} />,
      <Tile key="rw" href="/admin/requests" label="طلبات غير مرتبطة بوقف" value={fmtNumber(d.requests.withoutWaqf)} sub="مفتوحة" />,
      <Tile key="ru" href="/admin/requests?tab=unassigned" label="غير مسندة" value={d.requests.unassigned !== null ? fmtNumber(d.requests.unassigned) : "—"} />,
      <Tile key="sla" href="/admin/requests?tab=overdue" label="تجاوزت المهلة" value={fmtNumber(d.requests.slaBreaches)} tone={d.requests.slaBreaches ? "critical" : "ok"} sub="بلا انتظار للعميل" />,
    );
  const tiles: ReactNode[] = [];
  if (d.clients) tiles.push(<Tile key="c" href="/admin/clients" label="العملاء" value={fmtNumber(d.clients.total)} sub={`${fmtNumber(d.clients.new30)} جديد خلال 30 يومًا`} />);
  if (d.invoices) tiles.push(<Tile key="i" href="/admin/finance" label="فواتير غير مسددة" value={fmtSAR(d.invoices.amount)} tone={d.invoices.overdue ? "fine" : undefined} sub={`المتبقي على ${fmtNumber(d.invoices.outstanding)} فاتورة · ${fmtNumber(d.invoices.overdue)} متأخرة`} />);
  if (d.assessments) tiles.push(<Tile key="a" href="/admin/assessments" label="تقييمات بانتظار المراجعة" value={fmtNumber(d.assessments.awaitingReview)} tone={d.assessments.awaitingReview ? "fine" : undefined} />);
  if (d.contact) tiles.push(<Tile key="m" href="/admin/clients/messages" label="رسائل تواصل جديدة" value={fmtNumber(d.contact.new)} tone={d.contact.new ? "fine" : undefined} />);
  if (d.privacy) tiles.push(<Tile key="p" href="/admin/notifications/privacy" label="طلبات بيانات شخصية مفتوحة" value={fmtNumber(d.privacy.open)} tone={d.privacy.overdue ? "critical" : undefined} sub={d.privacy.overdue ? `${fmtNumber(d.privacy.overdue)} تجاوز المهلة النظامية` : "ضمن المهلة"} />);
  if (d.breakGlass) tiles.push(<Tile key="b" href="/admin/users/break-glass" label="وصول طارئ" value={fmtNumber(d.breakGlass.pending)} sub={`بانتظار الاعتماد · ${fmtNumber(d.breakGlass.active)} نشط الآن`} tone={d.breakGlass.pending ? "fine" : undefined} />);
  if (d.outbox && (d.outbox.failed || d.outbox.queued)) tiles.push(<Tile key="x" href="/admin/notifications/outbox" label="رسائل صادرة (7 أيام)" value={fmtNumber(d.outbox.queued)} sub={`في الانتظار · ${fmtNumber(d.outbox.failed)} فشل`} tone={d.outbox.failed ? "critical" : undefined} />);
  // With few KPIs (e.g. a content editor) the page offers the viewer's sections instead of empty space.
  const fewTiles = tiles.length + waqfTiles.length + requestTiles.length < 3;

  return (
    <div className="space-y-6">
      <PageHeader title="لوحة الشركة" description={`مرحبًا ${auth.user.fullName ?? ""}. تعرض اللوحة ما تتيحه صلاحياتك فقط.`} />
      {sp.denied === "1" ? (
        <Alert tone="info" title="تلك الصفحة خارج صلاحياتك">
          دورك في فريق وقفك لا يشمل الصفحة التي طلبتها، فأعدناك إلى اللوحة. إن كنت تحتاجها فاطلب من مسؤول النظام تعديل دورك.
        </Alert>
      ) : null}

      {waqfTiles.length ? (
        <section aria-labelledby="dash-waqfs" className="space-y-2" data-testid="dash-waqfs">
          <h2 id="dash-waqfs" className="text-lg font-semibold">الأوقاف</h2>
          <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">{waqfTiles}</div>
        </section>
      ) : null}
      {requestTiles.length ? (
        <section aria-labelledby="dash-requests" className="space-y-2" data-testid="dash-requests">
          <h2 id="dash-requests" className="text-lg font-semibold">الخدمات والطلبات</h2>
          <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">{requestTiles}</div>
        </section>
      ) : null}
      <WorkQueues queues={queues} />

      {tiles.length ? (
        <section aria-labelledby="dash-other" className="space-y-2">
          <h2 id="dash-other" className="text-lg font-semibold">مؤشرات أخرى</h2>
          <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">{tiles}</div>
        </section>
      ) : null}

      <div className={cn("grid gap-6", fewTiles && d.requests && "xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]", !fewTiles && "max-w-4xl")}>
        {d.requests ? (
          <Panel title={d.requests.scope === "all" ? "الطلبات المفتوحة حسب الحالة" : "طلباتي المفتوحة حسب الحالة"} actions={<Link href="/admin/requests" className="text-sm text-ink hover:underline">كل الطلبات</Link>}>
            {d.requests.byStatus.length ? (
              <ul className="space-y-2.5">
                {d.requests.byStatus.map((s) => (
                  <li key={s.status} className="grid grid-cols-[8.5rem_1fr_2.5rem] items-center gap-3 text-[15px] sm:grid-cols-[11rem_1fr_3rem]">
                    <span className="truncate">{STATUS_LABEL[s.status as keyof typeof STATUS_LABEL] ?? s.status}</span>
                    <span aria-hidden className="h-2.5 rounded-e-[4px] bg-ink/80" style={{ width: `${Math.max(3, (s.n / max) * 100)}%` }} />
                    <span className="tabular text-end font-medium">{fmtNumber(s.n)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">لا طلبات مفتوحة.</p>
            )}
          </Panel>
        ) : null}
        {fewTiles ? (
        <Panel title="أقسامك">
          {shortcuts.length ? (
            <ul className="divide-y divide-line">
              {shortcuts.map((s) => (
                <li key={s.href}>
                  <Link href={s.href} className="flex items-center gap-3 py-2.5 text-[15px] hover:text-ink">
                    <AdminIcon name={s.icon} className="size-[18px] shrink-0 text-muted" />
                    <span className="flex-1">{s.label}</span>
                    <ArrowLeft aria-hidden className="size-4 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">لا أقسام إضافية في صلاحياتك.</p>
          )}
        </Panel>
        ) : null}
      </div>
    </div>
  );
}
