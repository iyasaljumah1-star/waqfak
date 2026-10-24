import type { Metadata } from "next";
import Link from "next/link";
import { Landmark } from "lucide-react";
import { Badge, DataTable, EmptyState, PageHeader, Panel } from "@/components/ui";
import { fmtDate, fmtNumber, NAZIR_MODE_LABEL, SIZE_LABEL, STATUS_LABEL, TYPE_LABEL } from "@/lib/utils";
import { requireAdmin } from "@/server/modules/admin/guard";
import { listAllWaqfs, WAQF_STATES } from "@/server/modules/admin/waqfs/queries";

export const metadata: Metadata = { title: "الأوقاف" };

const sel = "h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-[15px]";

export default async function WaqfsPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string; size?: string; status?: string; demo?: string; state?: string }> }) {
  const auth = await requireAdmin("admin.waqfs.all");
  const sp = await searchParams;
  const state = WAQF_STATES.some((x) => x.key === sp.state) ? sp.state! : "complete";
  const rows = await listAllWaqfs(auth, { ...sp, state });
  return (
    <div>
      <PageHeader title="الأوقاف" description={`${WAQF_STATES.find((x) => x.key === state)?.label ?? ""} (${fmtNumber(rows.length)}${rows.length === 300 ? "+" : ""}). «الأوقاف المكتملة»: موثقة وصكها في الوثائق، بأصول ومصارف ونظارة مسجلة. طلبات الخدمات في «الطلبات».`} />
      <nav aria-label="حالة الملفات" className="mb-4 flex flex-wrap gap-2" data-testid="waqf-state-tabs">
        {WAQF_STATES.map((t) => (
          <Link key={t.key} href={`/admin/waqfs?state=${t.key}`} aria-current={state === t.key ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${state === t.key ? "border-ink bg-ink text-white" : "border-line bg-surface hover:border-ink/40"}`}>{t.label}</Link>
        ))}
      </nav>
      <form role="search" className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto]">
        <label htmlFor="q" className="sr-only">بحث</label>
        <input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="الاسم أو الرقم الداخلي أو الموحد" className={sel} />
        <label htmlFor="type" className="sr-only">النوع</label>
        <select id="type" name="type" defaultValue={sp.type ?? ""} className={sel}>
          <option value="">كل الأنواع</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label htmlFor="size" className="sr-only">الحجم</label>
        <select id="size" name="size" defaultValue={sp.size ?? ""} className={sel}>
          <option value="">كل الأحجام</option>
          {Object.entries(SIZE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label htmlFor="status" className="sr-only">الحالة</label>
        <select id="status" name="status" defaultValue={sp.status ?? ""} className={sel}>
          <option value="">كل الحالات</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label htmlFor="demo" className="sr-only">البيانات التجريبية</label>
        <select id="demo" name="demo" defaultValue={sp.demo ?? ""} className={sel}>
          <option value="">الحقيقي والتجريبي</option>
          <option value="no">الحقيقي فقط</option>
          <option value="yes">التجريبي فقط</option>
        </select>
        <input type="hidden" name="state" value={state} />
        <button className="h-10 rounded-md border border-line-strong bg-surface px-4 text-[15px] hover:bg-surface-2">عرض</button>
      </form>
      <Panel tight>
        <div className="px-3 md:px-2">
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            caption="قائمة الأوقاف"
            empty={<div className="p-4"><EmptyState icon={Landmark} title="لا أوقاف مطابقة">غيّر المرشحات.</EmptyState></div>}
            columns={[
              { key: "n", label: "الوقف", render: (r) => (
                <span>
                  <Link href={`/admin/waqfs/${r.id}`} className="font-medium text-ink hover:underline">{r.name}</Link>
                  <span className="block text-[13px] text-muted"><span dir="ltr" className="tabular">{r.number}</span>{r.isDemo ? " · تجريبي" : ""}</span>
                </span>
              ) },
              { key: "t", label: "النوع والحجم", render: (r) => <span className="text-[14px]">{r.legalType ? TYPE_LABEL[r.legalType] : "—"} · {r.sizeClass ? SIZE_LABEL[r.sizeClass] : "غير مصنف"}</span> },
              { key: "s", label: "الحالة", render: (r) => <Badge tone={r.status === "active" || r.status === "registered" ? "ok" : r.status === "suspended" ? "critical" : "neutral"} icon={false}>{STATUS_LABEL[r.status]}</Badge> },
              { key: "cp", label: "الاكتمال", render: (r) => r.completeness.complete
                ? <Badge tone="ok" icon={false}>مكتمل</Badge>
                : <span className="text-[13px]"><Badge tone="warn" icon={false}>قيد الاستكمال</Badge><span className="block text-muted">{r.completeness.missing.join("، ")}</span></span> },
              { key: "rv", label: "مراجعات", render: (r) => r.reviews ? <Badge tone="fine">{fmtNumber(r.reviews)}</Badge> : <span className="text-muted">—</span>, hideOnMobile: true },
              { key: "nz", label: "النظارة", render: (r) => <span className="text-[14px]">{r.nazirMode ? NAZIR_MODE_LABEL[r.nazirMode] : "—"}</span>, hideOnMobile: true },
              { key: "m", label: "الأعضاء", render: (r) => <span className="tabular">{fmtNumber(r.members)}</span>, hideOnMobile: true },
              { key: "r", label: "طلبات مفتوحة", render: (r) => <span className="tabular">{fmtNumber(r.openRequests)}</span> },
              { key: "o", label: "التزامات متأخرة", render: (r) => r.overdue ? <Badge tone="critical">{fmtNumber(r.overdue)}</Badge> : <span className="text-muted">لا يوجد</span> },
              { key: "c", label: "أُنشئ", render: (r) => <span className="text-[14px] text-muted">{fmtDate(r.createdAt)}</span>, hideOnMobile: true },
            ]}
          />
        </div>
      </Panel>
    </div>
  );
}
