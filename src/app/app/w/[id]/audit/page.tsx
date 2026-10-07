import Link from "next/link";
import { History } from "lucide-react";
import { DataTable, EmptyState, PageHeader, Panel } from "@/components/ui";
import { buttonClass } from "@/components/ui";
import { AUDIT_PREFIX_LABEL, ENTITY_LABEL, auditActionLabel } from "@/components/portal/audit-labels";
import { cn, fmtDateTime, fmtNumber } from "@/lib/utils";
import { requireAuth } from "@/server/authz/context";
import { AUDIT_PAGE_SIZE, waqfAccess, waqfAuditPage } from "@/server/modules/waqf-core/queries";

export const metadata = { title: "سجل العمليات" };

const REDACTED = "[redacted]";
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

function short(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "نعم" : "لا";
  if (typeof v === "string") return v.length > 60 ? `${v.slice(0, 60)}…` : v;
  if (typeof v === "number") return String(v);
  const s = JSON.stringify(v);
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

/** Field-level summary of a change. Redacted values are never displayed, only named as protected. */
function Changes({ before, after }: { before: unknown; after: unknown }) {
  const b = before && typeof before === "object" && !Array.isArray(before) ? (before as Record<string, unknown>) : {};
  const a = after && typeof after === "object" && !Array.isArray(after) ? (after as Record<string, unknown>) : {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].slice(0, 8);
  if (!keys.length) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-[13px] text-muted">
      {keys.map((k) => {
        const protectedVal = b[k] === REDACTED || a[k] === REDACTED;
        return (
          <li key={k} className="break-words">
            <span dir="ltr" className="font-mono text-[12px]">{k}</span>:{" "}
            {protectedVal ? (
              <span className="italic">قيمة محمية لا تُعرض</span>
            ) : k in b && k in a ? (
              <>
                <span className="line-through decoration-line-strong">{short(b[k])}</span> ← <span className="text-text">{short(a[k])}</span>
              </>
            ) : (
              <span className="text-text">{short(k in a ? a[k] : b[k])}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default async function WaqfAudit({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const auth = await requireAuth({ next: `/app/w/${id}/audit` });
  await waqfAccess(auth, id, "audit.view_waqf");
  const page = Math.max(1, Math.min(10_000, Number.parseInt(sp.page ?? "1", 10) || 1));
  const prefix = sp.prefix && /^[a-z_]{1,40}$/.test(sp.prefix) ? sp.prefix : undefined;
  const from = isDate(sp.from) ? sp.from : undefined;
  const to = isDate(sp.to) ? sp.to : undefined;
  const { rows, total, prefixes } = await waqfAuditPage(auth, id, { page, prefix: prefix ? `${prefix}.` : undefined, from, to });
  const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const qs = (p: number) => {
    const q = new URLSearchParams();
    if (prefix) q.set("prefix", prefix);
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return `/app/w/${id}/audit${s ? `?${s}` : ""}`;
  };
  const filtered = !!(prefix || from || to);

  return (
    <div className="space-y-6">
      <PageHeader title="سجل العمليات" description="كل إجراء على ملف هذا الوقف: من قام به ومتى وما الذي تغيّر. السجل متسلسل ولا يقبل التعديل أو الحذف." />
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
        <div className="space-y-1">
          <label htmlFor="prefix" className="block text-sm font-medium">نوع العملية</label>
          <select id="prefix" name="prefix" defaultValue={prefix ?? ""} className="h-10 rounded-md border border-line-strong bg-surface px-2 text-[15px]">
            <option value="">الكل</option>
            {prefixes.map((p) => (
              <option key={p} value={p}>{AUDIT_PREFIX_LABEL[p] ?? p}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="from" className="block text-sm font-medium">من تاريخ</label>
          <input id="from" name="from" type="date" defaultValue={from} className="h-10 rounded-md border border-line-strong bg-surface px-2" />
        </div>
        <div className="space-y-1">
          <label htmlFor="to" className="block text-sm font-medium">إلى تاريخ</label>
          <input id="to" name="to" type="date" defaultValue={to} className="h-10 rounded-md border border-line-strong bg-surface px-2" />
        </div>
        <button type="submit" className={buttonClass("primary", "sm", "h-10")}>تصفية</button>
        {filtered ? <Link href={`/app/w/${id}/audit`} className="h-10 content-center text-sm text-muted hover:underline">مسح التصفية</Link> : null}
      </form>

      <Panel title={`${fmtNumber(total)} عملية${filtered ? " مطابقة" : ""}`} tight>
        <div className="px-2 md:px-3">
          <DataTable
            caption="سجل العمليات"
            rows={rows}
            rowKey={(r) => String(r.id)}
            empty={
              <div className="p-4">
                <EmptyState icon={History} title={filtered ? "لا عمليات تطابق التصفية" : "لا عمليات مسجّلة بعد"}>
                  {filtered ? "وسّع نطاق التاريخ أو اختر «الكل»." : "تظهر هنا كل التغييرات على ملف الوقف فور حدوثها."}
                </EmptyState>
              </div>
            }
            columns={[
              { key: "at", label: "الوقت", className: "whitespace-nowrap", render: (r) => <time dateTime={r.at.toISOString()} className="text-sm">{fmtDateTime(r.at)}</time> },
              { key: "actor", label: "المنفّذ", render: (r) => r.actorName ?? r.actorLabel ?? "النظام" },
              {
                key: "action",
                label: "العملية",
                render: (r) => {
                  const label = auditActionLabel(r.action);
                  return (
                    <div className="min-w-0">
                      <p className="font-medium">{label ?? <span dir="ltr" className="font-mono text-sm">{r.action}</span>}</p>
                      {label ? <p dir="ltr" className="text-end font-mono text-[12px] text-muted md:text-start">{r.action}</p> : null}
                      <Changes before={r.before} after={r.after} />
                    </div>
                  );
                },
              },
              {
                key: "entity",
                label: "السجل",
                hideOnMobile: true,
                render: (r) => (
                  <span className="text-sm">
                    {ENTITY_LABEL[r.entityType] ?? r.entityType}
                    {r.entityId ? <span dir="ltr" className="block font-mono text-[12px] text-muted">{r.entityId.slice(0, 8)}</span> : null}
                  </span>
                ),
              },
            ]}
          />
        </div>
        {pages > 1 ? (
          <nav aria-label="صفحات السجل" className="flex items-center justify-between gap-2 border-t border-line px-4 py-3 text-sm">
            <Link aria-disabled={page <= 1} href={qs(page - 1)} className={cn("text-ink hover:underline", page <= 1 && "pointer-events-none text-muted")}>السابق</Link>
            <span className="tabular text-muted">صفحة {page} من {pages}</span>
            <Link aria-disabled={page >= pages} href={qs(page + 1)} className={cn("text-ink hover:underline", page >= pages && "pointer-events-none text-muted")}>التالي</Link>
          </nav>
        ) : null}
      </Panel>
    </div>
  );
}
