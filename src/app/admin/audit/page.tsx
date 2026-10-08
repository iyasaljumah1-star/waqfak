import type { Metadata } from "next";
import Link from "next/link";
import { History } from "lucide-react";
import { DataTable, EmptyState, PageHeader, Panel } from "@/components/ui";
import { ActionLink } from "@/components/portal/action-link";
import { AuditVerify } from "@/components/admin/audit-verify";
import { ADMIN_ENTITY_LABEL, actionLabel } from "@/components/admin/labels";
import { AUDIT_PREFIX_LABEL } from "@/components/portal/audit-labels";
import { fmtDateTime } from "@/lib/utils";
import { requireAdmin } from "@/server/modules/admin/guard";
import { auditFacets, auditPage, type AuditFilter } from "@/server/modules/admin/audit/queries";

export const metadata: Metadata = { title: "سجل العمليات" };

const inp = "h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-[15px]";
const PREFIX_EXTRA: Record<string, string> = { admin: "الإدارة", breakglass: "الوصول الطارئ", mlro: "الامتثال الداخلي", privacy: "الخصوصية", account: "الحساب", contracts: "العقود" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<AuditFilter> }) {
  const auth = await requireAdmin("admin.audit");
  const f = await searchParams;
  const [page, facets] = await Promise.all([auditPage(auth, f), auditFacets(auth)]);
  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, ...extra })) if (v) p.set(k, String(v));
    return `/admin/audit?${p.toString()}`;
  };
  const last = page.rows[page.rows.length - 1];
  const filtered = Object.entries(f).some(([k, v]) => k !== "before" && v);

  return (
    <div>
      <PageHeader title="سجل العمليات" description="سجل إلحاقي مترابط بالبصمات: لا يُعدّل ولا يُحذف من التطبيق، وكل سجل يحمل بصمة السجل الذي قبله." />
      <Panel className="mb-6" title="سلامة السجل" description="يعيد حساب بصمة كل سجل ويتحقق من ترابطه بما قبله، ويحدد أول موضع خلل إن وُجد.">
        <AuditVerify />
      </Panel>
      <form role="search" className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="actor" className="mb-1 block text-[13px] text-muted">المنفّذ</label>
          <input id="actor" name="actor" defaultValue={f.actor ?? ""} placeholder="الاسم أو البريد، أو system" className={inp} />
        </div>
        <div>
          <label htmlFor="action" className="mb-1 block text-[13px] text-muted">العملية</label>
          <input id="action" name="action" list="action-list" defaultValue={f.action ?? ""} placeholder="مثل admin. أو user.login" dir="ltr" className={inp} />
          <datalist id="action-list">
            {facets.prefixes.map((p) => <option key={p} value={`${p}.`}>{AUDIT_PREFIX_LABEL[p] ?? PREFIX_EXTRA[p] ?? p}</option>)}
            {facets.actions.map((a) => <option key={a} value={a}>{actionLabel(a) ?? a}</option>)}
          </datalist>
        </div>
        <div>
          <label htmlFor="entity" className="mb-1 block text-[13px] text-muted">نوع السجل</label>
          <select id="entity" name="entity" defaultValue={f.entity ?? ""} className={inp}>
            <option value="">الكل</option>
            {facets.entities.map((e) => <option key={e} value={e}>{ADMIN_ENTITY_LABEL[e] ?? e}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="entityId" className="mb-1 block text-[13px] text-muted">معرّف السجل</label>
          <input id="entityId" name="entityId" defaultValue={f.entityId ?? ""} dir="ltr" className={inp} />
        </div>
        <div>
          <label htmlFor="waqf" className="mb-1 block text-[13px] text-muted">الوقف</label>
          <input id="waqf" name="waqf" defaultValue={f.waqf ?? ""} placeholder="الاسم أو الرقم الداخلي" className={inp} />
        </div>
        <div>
          <label htmlFor="from" className="mb-1 block text-[13px] text-muted">من تاريخ</label>
          <input id="from" name="from" type="date" defaultValue={f.from ?? ""} dir="ltr" className={inp} />
        </div>
        <div>
          <label htmlFor="to" className="mb-1 block text-[13px] text-muted">إلى تاريخ</label>
          <input id="to" name="to" type="date" defaultValue={f.to ?? ""} dir="ltr" className={inp} />
        </div>
        <div className="flex items-end gap-2">
          <button className="h-10 flex-1 rounded-md bg-ink px-4 text-[15px] text-white hover:bg-ink-hover dark:text-[#0f141c]">تصفية</button>
          {filtered ? <Link href="/admin/audit" className="flex h-10 items-center rounded-md border border-line-strong bg-surface px-3 text-[15px] hover:bg-surface-2">مسح</Link> : null}
        </div>
      </form>
      <Panel tight>
        <div className="px-3 md:px-2">
          <DataTable
            rows={page.rows}
            rowKey={(r) => String(r.id)}
            caption="سجل العمليات"
            empty={<div className="p-4"><EmptyState icon={History} title="لا سجلات مطابقة">وسّع نطاق التصفية.</EmptyState></div>}
            columns={[
              { key: "id", label: "#", render: (r) => <Link href={`/admin/audit/${r.id}`} className="tabular text-ink hover:underline">{r.id}</Link>, className: "w-16" },
              { key: "t", label: "الوقت", render: (r) => <span className="text-[14px]">{fmtDateTime(r.at)}</span> },
              { key: "a", label: "العملية", render: (r) => (
                <Link href={`/admin/audit/${r.id}`} className="hover:underline">
                  {actionLabel(r.action) ?? <span dir="ltr">{r.action}</span>}
                </Link>
              ) },
              { key: "u", label: "المنفّذ", render: (r) => (r.actorUserId ? <Link href={qs({ actor: r.actorUserId, before: "" })} className="hover:underline">{page.names.get(r.actorUserId) ?? "—"}</Link> : <span className="text-muted">{r.actorLabel ?? "النظام"}</span>) },
              { key: "e", label: "السجل", render: (r) => <span className="text-[14px]">{ADMIN_ENTITY_LABEL[r.entityType] ?? r.entityType}</span>, hideOnMobile: true },
              { key: "w", label: "الوقف", render: (r) => (r.waqfId ? <Link href={qs({ waqf: r.waqfId, before: "" })} className="text-[14px] hover:underline">{page.waqfNames.get(r.waqfId)?.name ?? "—"}</Link> : <span className="text-muted">—</span>), hideOnMobile: true },
              { key: "ip", label: "العنوان", render: (r) => <span dir="ltr" className="tabular text-[13px] text-muted">{r.ip ?? ""}</span>, hideOnMobile: true },
            ]}
          />
        </div>
      </Panel>
      <div className="mt-4 flex flex-wrap gap-2">
        {f.before ? <ActionLink href={qs({ before: "" })} variant="secondary">الأحدث</ActionLink> : null}
        {page.hasMore && last ? <ActionLink href={qs({ before: String(last.id) })} variant="secondary">الأقدم</ActionLink> : null}
      </div>
    </div>
  );
}
