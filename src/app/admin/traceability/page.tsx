import type { Metadata } from "next";
import Link from "next/link";
import { Download, Printer } from "lucide-react";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { loadRtm } from "@/server/modules/admin/editors/compliance.queries";
import { filterRtm, IMPL_KIND_AR, IMPL_KINDS, LINK_STATUS_AR, REQ_STATUS_AR, type RtmRow } from "@/server/modules/admin/editors/pure";
import { Badge, ButtonLink, PageHeader, Panel, Stat } from "@/components/ui";
import { EditorPage } from "@/components/admin-editors/shell";
import { PrintButton } from "@/components/admin-editors/print-button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "سجل تتبع المتطلبات" };

const LINK_TONE = { ok: "ok", missing: "critical", inactive: "warn", text: "neutral" } as const;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function Traceability({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireStaff("admin.compliance");
  const sp = await searchParams;
  const f = { q: one(sp.q), source: one(sp.source), status: one(sp.status), area: one(sp.area), kind: one(sp.kind), gaps: sp.gaps === "1" };
  const print = sp.print === "1";
  const all = await read(auth, loadRtm);
  const rows = filterRtm(all, f);
  const sources = [...new Map(all.filter((r) => r.sourceCode).map((r) => [r.sourceCode!, r.sourceName!])).entries()].sort();
  const areas = [...new Set(all.map((r) => r.featureArea).filter(Boolean) as string[])].sort();
  const qs = new URLSearchParams(Object.entries({ ...f, gaps: f.gaps ? "1" : "" }).filter(([, v]) => v) as [string, string][]).toString();
  const links = all.flatMap((r) => r.links);
  const stats = {
    reqs: all.length,
    implemented: all.filter((r) => r.status === "implemented").length,
    pending: all.filter((r) => r.status === "pending_verification" || r.verificationStatus === "pending_verification").length,
    broken: links.filter((l) => l.linkStatus === "missing" || l.linkStatus === "inactive").length,
    noImpl: all.filter((r) => !r.links.length && r.status !== "excluded").length,
  };

  return (
    <EditorPage wide>
      <PageHeader
        title="سجل تتبع المتطلبات"
        description="من المصدر النظامي إلى المتطلب إلى ما ينفّذه في المنصة (التزام، قاعدة، إشارة، حقل، صفحة) وحالته. يُشتق آليًا من سجل المتطلبات والالتزامات ومراجع القواعد؛ الروابط المستنتجة معلّمة."
        crumbs={[{ href: "/admin/compliance", label: "محرك الامتثال" }, { label: "سجل التتبع" }]}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <ButtonLink href={`/admin/traceability/export${qs ? `?${qs}` : ""}`} variant="secondary" prefetch={false}><Download aria-hidden className="size-4" /> تصدير CSV</ButtonLink>
            {print ? <PrintButton /> : <ButtonLink href={`/admin/traceability?${qs ? `${qs}&` : ""}print=1`} variant="secondary"><Printer aria-hidden className="size-4" /> عرض للطباعة</ButtonLink>}
          </div>
        }
      />
      {!print ? (
        <>
          <section aria-label="ملخص" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="المتطلبات" value={stats.reqs} />
            <Stat label="منفّذة" value={stats.implemented} tone="ok" />
            <Stat label="بانتظار التحقق" value={stats.pending} tone={stats.pending ? "fine" : undefined} />
            <Stat label="روابط معطلة" value={stats.broken} tone={stats.broken ? "critical" : undefined} sub="مرجع مفقود أو غير منشور" />
            <Stat label="بلا تنفيذ" value={stats.noImpl} tone={stats.noImpl ? "critical" : undefined} />
          </section>
          <form className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-3" role="search" aria-label="تصفية سجل التتبع">
            <div className="min-w-0 flex-1 basis-48">
              <label htmlFor="q" className="mb-0.5 block text-[12px] text-muted">بحث</label>
              <input id="q" name="q" defaultValue={f.q} placeholder="REQ-001، OB-REG-01، م8/1…" className="h-10 w-full rounded-md border border-line-strong bg-surface px-3" />
            </div>
            {[
              { id: "source", label: "المصدر", value: f.source, options: sources.map(([c, n]) => ({ value: c, label: n })) },
              { id: "status", label: "الحالة", value: f.status, options: Object.entries(REQ_STATUS_AR).map(([value, label]) => ({ value, label })) },
              { id: "area", label: "المجال", value: f.area, options: areas.map((a) => ({ value: a, label: a })) },
              { id: "kind", label: "نوع التنفيذ", value: f.kind, options: IMPL_KINDS.map((k) => ({ value: k, label: IMPL_KIND_AR[k] })) },
            ].map((s) => (
              <div key={s.id} className="basis-36">
                <label htmlFor={s.id} className="mb-0.5 block text-[12px] text-muted">{s.label}</label>
                <select id={s.id} name={s.id} defaultValue={s.value} className="h-10 w-full rounded-md border border-line-strong bg-surface px-2">
                  <option value="">الكل</option>
                  {s.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            ))}
            <label className="flex h-10 items-center gap-2 text-[14px]"><input type="checkbox" name="gaps" value="1" defaultChecked={f.gaps} className="size-4 accent-[var(--ink)]" /> الفجوات فقط</label>
            <button className="h-10 rounded-md bg-ink px-4 text-white dark:text-[#0f141c]">تصفية</button>
            {qs ? <Link href="/admin/traceability" className="h-10 px-2 leading-10 text-[14px] text-ink underline">مسح</Link> : null}
          </form>
        </>
      ) : (
        <p className="text-[14px] text-muted">{rows.length} متطلبًا{qs ? " (مُصفّى)" : ""} — طُبع في {new Date().toLocaleDateString("ar-SA-u-nu-latn")}</p>
      )}
      <Panel tight className={print ? "border-0" : ""}>
        <RtmTable rows={rows} print={print} />
      </Panel>
    </EditorPage>
  );
}

function RtmTable({ rows, print }: { rows: RtmRow[]; print: boolean }) {
  if (!rows.length) return <p className="p-6 text-center text-muted">لا متطلبات تطابق التصفية.</p>;
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-collapse", print ? "text-[11px]" : "text-[14px]")}>
        <caption className="sr-only">مصفوفة تتبع المتطلبات</caption>
        <thead className={print ? "" : "hidden md:table-header-group"}>
          <tr className="border-b border-line text-[13px] text-muted">
            {["المصدر", "المتطلب", "التنفيذ في المنصة", "الصفحة / API / قاعدة البيانات", "الحالة"].map((h) => <th key={h} scope="col" className="px-3 py-2 text-start font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.reqId} className={cn("border-b border-line align-top", !print && "block py-2 md:table-row md:py-0")} data-testid="rtm-row" data-req={r.reqCode}>
              <td className={cn("px-3 py-2", !print && "block md:table-cell")}>
                <span className="font-medium">{r.sourceName ?? "قرار داخلي"}</span>
                {r.article ? <span className="block text-muted">{r.article}</span> : null}
                {r.sourceVerification === "pending_verification" ? <Badge tone="warn" icon={false} className="mt-1">المصدر بانتظار التحقق</Badge> : null}
              </td>
              <td className={cn("px-3 py-2", !print && "block md:table-cell")}>
                {print ? <span dir="ltr" className="font-semibold">{r.reqCode}</span> : <Link href={`/admin/compliance/requirements/${r.reqId}`} dir="ltr" className="font-semibold text-ink hover:underline">{r.reqCode}</Link>}
                <span className="block">{r.title}</span>
                {r.featureArea ? <span className="text-[12px] text-muted">{r.featureArea}</span> : null}
              </td>
              <td className={cn("px-3 py-2", !print && "block md:table-cell")}>
                {r.links.length ? (
                  <ul className="space-y-1.5">
                    {r.links.map((l) => (
                      <li key={`${l.kind}:${l.ref}`} className="flex flex-wrap items-baseline gap-1.5">
                        <Badge tone={LINK_TONE[l.linkStatus]} icon={false}>{IMPL_KIND_AR[l.kind] ?? l.kind}</Badge>
                        {l.page && !print && !l.page.includes("[") ? <Link href={l.page} className="text-ink hover:underline">{l.ref}</Link> : <span>{l.ref}</span>}
                        {l.label !== l.ref ? <span className="text-muted">— {l.label}</span> : null}
                        {l.derived ? <span className="text-[11px] text-muted">(مستنتج)</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : <Badge tone="critical">لا يوجد تنفيذ</Badge>}
              </td>
              <td className={cn("px-3 py-2 text-[12px] text-muted", !print && "block md:table-cell")} dir="ltr">
                <ul className="space-y-1.5 text-start">
                  {r.links.map((l) => <li key={`${l.kind}:${l.ref}`} className="break-all">{[l.page, l.api, l.db].filter(Boolean).join(" · ") || "—"}</li>)}
                </ul>
              </td>
              <td className={cn("px-3 py-2", !print && "block md:table-cell")}>
                <span className="flex flex-wrap gap-1">
                  <Badge tone={r.status === "implemented" ? "ok" : r.status === "excluded" ? "neutral" : "warn"}>{REQ_STATUS_AR[r.status] ?? r.status}</Badge>
                  {r.verificationStatus !== "verified" ? <Badge tone="warn" icon={false}>{REQ_STATUS_AR[r.verificationStatus]}</Badge> : null}
                  {r.links.some((l) => l.linkStatus === "missing") ? <Badge tone="critical" icon={false}>{LINK_STATUS_AR.missing}</Badge> : null}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
