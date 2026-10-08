import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { listDiscounts, listPackages, listServices, listWorkflows } from "@/server/modules/admin/editors/services.queries";
import { CONFLICT_RULES, PRICING_MODELS } from "@/server/modules/admin/editors/pure";
import { Badge, ButtonLink, DataTable, PageHeader, Panel } from "@/components/ui";
import { EditorPage, Flash, TabNav } from "@/components/admin-editors/shell";
import { fmtDate, fmtSAR } from "@/lib/utils";

export const metadata: Metadata = { title: "الخدمات والباقات والأسعار" };

const TABS = ["services", "packages", "discounts", "workflows"] as const;
type Tab = (typeof TABS)[number];
const label = (list: { value: string; label: string }[], v: string) => list.find((x) => x.value === v)?.label ?? v;

export default async function ServicesAdmin({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireStaff("admin.services");
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(String(sp.tab)) ? (sp.tab as Tab) : "services";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const canPrice = auth.perms.has("admin.pricing");
  const data = await read(auth, async (tx) => ({
    services: await listServices(tx),
    packages: await listPackages(tx),
    discounts: await listDiscounts(tx),
    workflows: await listWorkflows(tx),
  }));
  const services = q ? data.services.filter((r) => r.s.code.includes(q.toUpperCase()) || r.s.nameAr.includes(q)) : data.services;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <EditorPage>
      <PageHeader
        title="الخدمات والباقات والأسعار"
        description="كتالوج الخدمات قابل للتعديل بالكامل: الفئة والجمهور وقواعد التعارض والترخيص وسير العمل والأسعار. كل حفظ يُسجل في سجل العمليات، وكل تغيير سعر في سجل الأسعار."
        actions={
          tab === "services" ? <ButtonLink href="/admin/services/new"><Plus aria-hidden className="size-4" /> خدمة جديدة</ButtonLink>
          : tab === "packages" ? <ButtonLink href="/admin/services/packages/new"><Plus aria-hidden className="size-4" /> باقة جديدة</ButtonLink>
          : tab === "discounts" && canPrice ? <ButtonLink href="/admin/services/discounts/new"><Plus aria-hidden className="size-4" /> خصم جديد</ButtonLink>
          : tab === "workflows" ? <ButtonLink href="/admin/services/workflows/new"><Plus aria-hidden className="size-4" /> قالب جديد</ButtonLink>
          : null
        }
      />
      <Flash sp={sp} />
      <TabNav
        label="أقسام الكتالوج"
        current={tab}
        tabs={[
          { key: "services", label: "الخدمات", href: "/admin/services", count: data.services.length },
          { key: "packages", label: "الباقات", href: "/admin/services?tab=packages", count: data.packages.length },
          { key: "discounts", label: "الخصومات", href: "/admin/services?tab=discounts", count: data.discounts.length },
          { key: "workflows", label: "قوالب سير العمل", href: "/admin/services?tab=workflows", count: data.workflows.length },
        ]}
      />

      {tab === "services" ? (
        <Panel tight>
          <form className="flex flex-wrap gap-2 border-b border-line p-3" role="search">
            <label htmlFor="q" className="sr-only">ابحث في الخدمات</label>
            <input id="q" name="q" defaultValue={q} placeholder="ابحث بالرمز أو الاسم" className="h-10 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-3" />
            <button className="h-10 rounded-md border border-line-strong px-4">بحث</button>
          </form>
          <div className="px-3 md:px-2">
            <DataTable
              rows={services}
              rowKey={(r) => r.s.id}
              caption="الخدمات"
              columns={[
                { key: "code", label: "الرمز", render: (r) => <Link href={`/admin/services/${r.s.id}`} className="tabular font-medium text-ink hover:underline" dir="ltr">{r.s.code}</Link> },
                { key: "name", label: "الخدمة", render: (r) => <Link href={`/admin/services/${r.s.id}`} className="hover:underline">{r.s.nameAr}</Link> },
                { key: "cat", label: "الفئة", render: (r) => r.cat, hideOnMobile: true },
                { key: "price", label: "التسعير", render: (r) => <span>{label(PRICING_MODELS, r.s.pricingModel)}{r.s.basePrice ? ` · ${fmtSAR(r.s.basePrice)}` : ""}</span> },
                { key: "conf", label: "التعارض", render: (r) => (r.s.conflictRule === "none" ? <span className="text-muted">—</span> : <Badge tone="warn" icon={false}>{label(CONFLICT_RULES, r.s.conflictRule)}</Badge>), hideOnMobile: true },
                { key: "st", label: "الحالة", render: (r) => (r.s.isActive ? <Badge tone="ok">مفعّلة</Badge> : <Badge tone="neutral">موقوفة</Badge>) },
              ]}
            />
          </div>
        </Panel>
      ) : null}

      {tab === "packages" ? (
        <Panel tight>
          <div className="px-3 md:px-2">
            <DataTable
              rows={data.packages}
              rowKey={(r) => r.p.id}
              caption="الباقات"
              columns={[
                { key: "n", label: "الباقة", render: (r) => <Link href={`/admin/services/packages/${r.p.id}`} className="font-medium text-ink hover:underline">{r.p.nameAr}</Link> },
                { key: "c", label: "الرمز", render: (r) => <span dir="ltr" className="tabular">{r.p.code}</span>, hideOnMobile: true },
                { key: "pr", label: "السعر", render: (r) => <span>{r.p.monthlyPrice ? `${fmtSAR(r.p.monthlyPrice)} شهريًا` : ""}{r.p.monthlyPrice && r.p.annualPrice ? " · " : ""}{r.p.annualPrice ? `${fmtSAR(r.p.annualPrice)} سنويًا` : ""}{!r.p.monthlyPrice && !r.p.annualPrice ? "عرض سعر" : ""}</span> },
                { key: "s", label: "الخدمات", render: (r) => <span className="text-[13px]" dir="ltr">{r.services.join(", ") || "—"}</span> },
                { key: "st", label: "الحالة", render: (r) => (r.p.isActive ? <Badge tone="ok">مفعّلة</Badge> : <Badge tone="neutral">موقوفة</Badge>) },
              ]}
            />
          </div>
        </Panel>
      ) : null}

      {tab === "discounts" ? (
        <Panel tight>
          {!canPrice ? <p className="p-4 text-[14px] text-muted">إدارة الخصومات تحتاج صلاحية «إدارة الأسعار والخصومات».</p> : null}
          <div className="px-3 md:px-2">
            <DataTable
              rows={data.discounts}
              rowKey={(r) => r.id}
              caption="الخصومات"
              empty={<p className="p-6 text-center text-muted">لا خصومات بعد.</p>}
              columns={[
                { key: "c", label: "الرمز", render: (r) => (canPrice ? <Link href={`/admin/services/discounts/${r.id}`} className="tabular font-medium text-ink hover:underline" dir="ltr">{r.code}</Link> : <span dir="ltr">{r.code}</span>) },
                { key: "v", label: "القيمة", render: (r) => (r.kind === "percent" ? `${Number(r.value)}%` : fmtSAR(r.value)) },
                { key: "p", label: "الصلاحية", render: (r) => `${r.validFrom ? fmtDate(r.validFrom) : "من الآن"} — ${r.validTo ? fmtDate(r.validTo) : "مفتوح"}` },
                { key: "u", label: "الاستخدام", render: (r) => <span className="tabular">{r.uses}{r.maxUses ? ` / ${r.maxUses}` : ""}</span> },
                {
                  key: "s", label: "الحالة",
                  render: (r) => !r.isActive ? <Badge tone="neutral">موقوف</Badge> : r.validTo && r.validTo < today ? <Badge tone="warn">منتهٍ</Badge> : r.maxUses && r.uses >= r.maxUses ? <Badge tone="warn">استُنفد</Badge> : <Badge tone="ok">ساري</Badge>,
                },
              ]}
            />
          </div>
        </Panel>
      ) : null}

      {tab === "workflows" ? (
        <Panel tight>
          <div className="px-3 md:px-2">
            <DataTable
              rows={data.workflows}
              rowKey={(r) => r.w.id}
              caption="قوالب سير العمل"
              columns={[
                { key: "n", label: "القالب", render: (r) => <Link href={`/admin/services/workflows/${r.w.code}`} className="font-medium text-ink hover:underline">{r.w.nameAr}</Link> },
                { key: "c", label: "الرمز", render: (r) => <span dir="ltr">{r.w.code}</span> },
                { key: "s", label: "المراحل", render: (r) => <span className="text-[13px]">{r.w.stages.map((s) => s.name).join(" ← ")}</span> },
                { key: "u", label: "الخدمات", render: (r) => <span className="tabular">{r.services}</span> },
              ]}
            />
          </div>
        </Panel>
      ) : null}
    </EditorPage>
  );
}
