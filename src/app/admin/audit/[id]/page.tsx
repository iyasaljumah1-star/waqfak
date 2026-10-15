import { roleName } from "@/server/authz/catalog";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, DefinitionList, PageHeader, Panel } from "@/components/ui";
import { ADMIN_ENTITY_LABEL, actionLabel } from "@/components/admin/labels";
import { diffRows, show } from "@/components/admin/diff";
import { cn, fmtDateTime } from "@/lib/utils";
import { requireAdmin } from "@/server/modules/admin/guard";
import { auditEntry } from "@/server/modules/admin/audit/queries";

export const metadata: Metadata = { title: "سجل عملية" };

const CHANGE: Record<string, { label: string; cls: string }> = {
  added: { label: "أُضيف", cls: "bg-ok-soft" },
  removed: { label: "أُزيل", cls: "bg-critical-soft" },
  changed: { label: "تغيّر", cls: "bg-warn-soft" },
  same: { label: "", cls: "" },
};

export default async function AuditEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin("admin.audit");
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const e = await auditEntry(auth, Number(id));
  if (!e) notFound();
  const r = e.row;
  const rows = diffRows(r.before, r.after);
  const changed = rows.filter((x) => x.change !== "same");
  const same = rows.filter((x) => x.change === "same");

  return (
    <div>
      <PageHeader
        title={actionLabel(r.action) ?? r.action}
        crumbs={[{ href: "/admin/audit", label: "سجل العمليات" }, { label: `#${r.id}` }]}
        actions={
          <div className="flex gap-2">
            {e.nextId ? <Link href={`/admin/audit/${e.nextId}`} className="rounded-md border border-line-strong bg-surface px-3 py-2 text-[15px] hover:bg-surface-2">الأحدث ←</Link> : null}
            {e.prevId ? <Link href={`/admin/audit/${e.prevId}`} className="rounded-md border border-line-strong bg-surface px-3 py-2 text-[15px] hover:bg-surface-2">→ الأقدم</Link> : null}
          </div>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Panel title="التفاصيل">
          <DefinitionList
            cols={1}
            items={[
              { label: "الرمز", value: <span dir="ltr" className="font-mono text-[14px]">{r.action}</span> },
              { label: "الوقت", value: fmtDateTime(r.at) },
              { label: "المنفّذ", value: r.actorUserId ? <Link href={`/admin/audit?actor=${r.actorUserId}`} className="text-ink hover:underline">{e.actor ?? "—"}</Link> : r.actorLabel ?? "النظام" },
              { label: "أدواره وقت التنفيذ", value: r.actorRoles?.length ? r.actorRoles.map((k) => roleName(k)).join("، ") : r.actorUserId ? "لم تُسجَّل (قيد سابق لتسجيل الأدوار)" : "—" },
              { label: "السجل", value: <span>{ADMIN_ENTITY_LABEL[r.entityType] ?? r.entityType}{r.entityId ? <span dir="ltr" className="ms-2 break-all font-mono text-[13px] text-muted">{r.entityId}</span> : null}</span> },
              { label: "الوقف", value: r.waqfId ? <Link href={`/admin/waqfs/${r.waqfId}`} className="text-ink hover:underline">{e.waqf ? `${e.waqf.name} (${e.waqf.number})` : r.waqfId}</Link> : "—" },
              { label: "العنوان والجهاز", value: <span dir="ltr" className="break-all text-[13px]">{[r.ip, r.userAgent].filter(Boolean).join(" · ") || "—"}</span> },
              { label: "بصمة السجل", value: <span dir="ltr" className="break-all font-mono text-[12px]">{r.hash}</span> },
              { label: "بصمة السابق", value: <span dir="ltr" className="break-all font-mono text-[12px]">{r.prevHash}</span> },
            ]}
          />
        </Panel>
        <Panel title="قبل وبعد" description={changed.length ? `${changed.length} حقل تغيّر.` : rows.length ? "لا فروق بين القيمتين." : "لا بيانات مرفقة بهذه العملية."} tight>
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="border-b border-line text-[13px] text-muted">
                    <th scope="col" className="px-3 py-2 text-start font-medium">الحقل</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">قبل</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">بعد</th>
                  </tr>
                </thead>
                <tbody>
                  {[...changed, ...same].map((x) => (
                    <tr key={x.path} className={cn("border-b border-line align-top", CHANGE[x.change].cls)}>
                      <th scope="row" className="px-3 py-2 text-start font-normal">
                        <span dir="ltr" className="font-mono text-[13px]">{x.path}</span>
                        {x.change !== "same" ? <Badge tone="neutral" icon={false} className="ms-2">{CHANGE[x.change].label}</Badge> : null}
                      </th>
                      <td className={cn("max-w-xs break-words px-3 py-2", x.change === "changed" || x.change === "removed" ? "line-through decoration-critical/60" : "text-muted")}>{show(x.before)}</td>
                      <td className="max-w-xs break-words px-3 py-2">{show(x.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-4 text-muted">—</p>
          )}
          <p className="px-3 py-2 text-[12px] text-muted">الحقول الحساسة (كلمات المرور والرموز والهويات والحسابات البنكية والعناوين) تُحجب قبل كتابة السجل.</p>
        </Panel>
      </div>
    </div>
  );
}
