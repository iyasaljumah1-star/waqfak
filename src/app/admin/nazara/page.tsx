import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { Alert, Badge, DataTable, EmptyState, PageHeader, Panel, Stat } from "@/components/ui";
import { Select, SubmitButton } from "@/components/ui/form";
import { ActionForm } from "@/components/admin/action-form";
import { fmtDate, SIZE_LABEL } from "@/lib/utils";
import { requireAdmin } from "@/server/modules/admin/guard";
import { openEngagement } from "@/server/modules/nazara/actions";
import { checklistProgress, OPEN_STATUSES, RUNNING_STATUSES, STATUS_AR, STATUS_TONE, type EngagementStatus } from "@/server/modules/nazara/pure";
import { listEngagements, openableWaqfs } from "@/server/modules/nazara/queries";
import { licenceValid, NAZARA_LICENSE_KEY, type LicenceRecord } from "@/server/modules/nazara/licence";
import { readSetting } from "@/server/modules/requests/catalog";
import { withSystem } from "@/server/db";
import { todayISO } from "@/server/engines/dates";

export const metadata: Metadata = { title: "النظارة الاعتبارية" };

const FILTERS = [
  ["open", "الملفات المفتوحة"],
  ["all", "كل الملفات"],
  ["mine", "ملفاتي"],
] as const;

export default async function NazaraDashboard({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const auth = await requireAdmin("nazara.view");
  const sp = await searchParams;
  const f = sp.f === "mine" ? "mine" : sp.f === "all" ? "all" : "open";
  const { rows, ops } = await listEngagements(auth, { status: f === "open" ? "open" : undefined, mine: f === "mine" });
  const canManage = auth.perms.has("nazara.manage");
  const openable = canManage ? await openableWaqfs(auth) : [];
  const licence = await withSystem((tx) => readSetting<LicenceRecord[]>(tx, "company.licenses", [])).then((l) => l.find((x) => x.key === NAZARA_LICENSE_KEY));
  const licensed = licenceValid(licence, todayISO());

  const running = rows.filter((r) => (RUNNING_STATUSES as string[]).includes(r.e.status));
  const intake = rows.filter((r) => ["intake", "under_review", "pending_completion", "accepted"].includes(r.e.status));
  const sum = (m: Map<string, number>) => running.reduce((n, r) => n + (m.get(r.e.waqfId) ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="النظارة الاعتبارية"
        description="الأوقاف التي تتولى «وقفك» نظارتها بصفتها ناظرًا اعتباريًا، وطلبات النظارة قيد الاستلام والدراسة. الأرقام محسوبة لحظيًا من سجلات كل وقف."
      />
      {!licensed ? (
        <Alert tone="info" className="mb-6" title="ترخيص الناظر الاعتباري غير مفعّل">
          تُستقبل طلبات النظارة وتُدرس ملفاتها، ولا تُباشَر النظارة على وقف حقيقي قبل تفعيل ترخيص الهيئة العامة للأوقاف في «الإعدادات والتراخيص» (لائحة تنظيم أعمال النظارة م5/2). الأوقاف التجريبية تُباشَر نظارتها تجريبيًا لاختبار المنظومة.
        </Alert>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="نظارات قائمة" value={running.length} sub={running.some((r) => r.e.isPractice) ? `منها ${running.filter((r) => r.e.isPractice).length} تجريبية` : "على أوقاف حقيقية"} />
        <Stat label="طلبات قيد الاستلام والدراسة" value={intake.length} />
        <Stat label="مهام متأخرة في الأوقاف القائمة" value={sum(ops.overdueTasks)} tone={sum(ops.overdueTasks) ? "critical" : undefined} sub={`من ${sum(ops.openTasks)} مهمة مفتوحة`} />
        <Stat label="التزامات متأخرة / خلال 30 يومًا" value={`${sum(ops.obligationsOverdue)} / ${sum(ops.obligationsDue)}`} tone={sum(ops.obligationsOverdue) ? "critical" : undefined} />
      </div>

      <nav aria-label="تصفية الملفات" className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map(([k, label]) => {
          const active = k === f;
          return (
            <Link key={k} href={k === "open" ? "/admin/nazara" : `/admin/nazara?f=${k}`} aria-current={active ? "true" : undefined} className={`rounded-full border px-3.5 py-1.5 text-[14px] font-medium ${active ? "border-ink bg-ink text-white dark:text-[#0f141c]" : "border-line-strong bg-surface hover:border-ink"}`}>
              {label}
            </Link>
          );
        })}
      </nav>

      <Panel tight>
        <div className="px-3 md:px-2">
          <DataTable
            rows={rows}
            rowKey={(r) => r.e.id}
            caption="ملفات النظارة"
            empty={<div className="p-4"><EmptyState icon={KeyRound} title="لا ملفات نظارة هنا">تُفتح الملفات تلقائيًا عند طلب خدمة تولي النظارة (N01)، أو يدويًا من الأسفل.</EmptyState></div>}
            columns={[
              {
                key: "w", label: "الوقف والملف", render: (r) => (
                  <span>
                    <Link href={`/admin/nazara/${r.e.id}`} className="font-medium text-ink hover:underline">{r.waqfName}</Link>
                    <span className="block text-[13px] text-muted"><span dir="ltr" className="tabular">{r.e.number}</span> · {r.sizeClass ? SIZE_LABEL[r.sizeClass] : "حجم غير محدد"}{r.isDemo ? " · وقف تجريبي" : ""}</span>
                  </span>
                ),
              },
              {
                key: "s", label: "الحالة", render: (r) => (
                  <span className="flex flex-wrap gap-1">
                    <Badge tone={STATUS_TONE[r.e.status as EngagementStatus] ?? "neutral"} icon={false}>{STATUS_AR[r.e.status as EngagementStatus] ?? r.e.status}</Badge>
                    {r.e.isPractice ? <Badge tone="seal" icon={false}>تجريبية</Badge> : null}
                  </span>
                ),
              },
              { key: "l", label: "المسؤول", render: (r) => r.lead ?? <span className="text-muted">لم يُعيَّن</span>, hideOnMobile: true },
              {
                key: "o", label: "المتابعة", render: (r) => {
                  if (!(RUNNING_STATUSES as string[]).includes(r.e.status)) {
                    if (!(OPEN_STATUSES as string[]).includes(r.e.status)) return <span className="text-[13px] text-muted">{fmtDate(r.e.updatedAt)}</span>;
                    const p = checklistProgress(r.e.checklist);
                    return <span className="text-[14px]">الاستلام: <span className="tabular">{p.done}/{p.total}</span>{p.requiredOpen.length ? <span className="text-muted"> · {p.requiredOpen.length} مطلوب ناقص</span> : null}</span>;
                  }
                  const w = r.e.waqfId;
                  const items = [
                    ["مهام متأخرة", ops.overdueTasks.get(w) ?? 0, "critical"],
                    ["التزامات متأخرة", ops.obligationsOverdue.get(w) ?? 0, "critical"],
                    ["التزامات قريبة", ops.obligationsDue.get(w) ?? 0, "fine"],
                    ["بانتظار اعتماد", ops.approvalsPending.get(w) ?? 0, "info"],
                    ["عقود تنتهي", ops.leasesEnding.get(w) ?? 0, "fine"],
                    ["شكاوى مفتوحة", ops.complaintsOpen.get(w) ?? 0, "warn"],
                    ["مخاطر مفتوحة", ops.risksOpen.get(w) ?? 0, "neutral"],
                    ["مخالفات", ops.violationsOpen.get(w) ?? 0, "critical"],
                  ] as const;
                  const shown = items.filter(([, n]) => n > 0);
                  return shown.length ? (
                    <span className="flex flex-wrap gap-1">{shown.map(([l, n, t]) => <Badge key={l} tone={t} icon={false}>{l}: <span className="tabular">{n}</span></Badge>)}</span>
                  ) : (
                    <span className="text-[13px] text-ok">لا متابعات عاجلة</span>
                  );
                },
              },
            ]}
          />
        </div>
      </Panel>

      {canManage && openable.length ? (
        <Panel title="فتح ملف نظارة لوقف" description="لوقف مسجل في المنصة بلا طلب N01 (مثل تعيين بقرار من الجهة المختصة). يبدأ الملف بمرحلة الاستلام." className="mt-6">
          <ActionForm action={openEngagement}>
            <div className="flex flex-wrap gap-2">
              <div className="min-w-[240px] flex-1">
                <label htmlFor="waqfId" className="sr-only">الوقف</label>
                <Select id="waqfId" name="waqfId" options={openable.map((w) => ({ value: w.id, label: `${w.name} — ${w.number}${w.isDemo ? " (تجريبي)" : ""}` }))} placeholder="اختر الوقف" required />
              </div>
              <SubmitButton pendingText="جارٍ الفتح…">افتح ملف النظارة</SubmitButton>
            </div>
          </ActionForm>
        </Panel>
      ) : null}
    </div>
  );
}
