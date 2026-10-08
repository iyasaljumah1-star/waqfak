import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { loadService, serviceFormOptions } from "@/server/modules/admin/editors/services.queries";
import { deletePrice, savePrice, saveService } from "@/server/modules/admin/editors/services.actions";
import { SIZE_OPTIONS } from "@/server/modules/admin/editors/pure";
import { Badge, DataTable, PageHeader, Panel } from "@/components/ui";
import { Input, Select } from "@/components/ui/form";
import { ActionButton, EditorForm, EField } from "@/components/admin-editors/editor-form";
import { ChangeList, EditorPage, FieldGrid, Flash } from "@/components/admin-editors/shell";
import { ServiceFields } from "@/components/admin-editors/service-fields";
import { fmtDate, fmtDateTime, fmtSAR } from "@/lib/utils";

export const metadata: Metadata = { title: "تعديل خدمة" };

const FIELD_AR: Record<string, string> = { pricingModel: "نموذج التسعير", basePrice: "السعر الأساسي", price: "السعر", sizeClass: "الفئة", validFrom: "يسري من", validTo: "حتى", deleted: "حذف سعر" };
const sizeLabel = (v: string | null) => SIZE_OPTIONS.find((s) => s.value === v)?.label ?? "كل الفئات";

function PriceFields({ p }: { p?: { id: string; sizeClass: string | null; price: string; validFrom: string | null; validTo: string | null } }) {
  return (
    <FieldGrid cols={3}>
      <EField label="فئة الوقف" name="sizeClass"><Select name="sizeClass" defaultValue={p?.sizeClass ?? ""} options={[{ value: "", label: "كل الفئات" }, ...SIZE_OPTIONS]} /></EField>
      <EField label="السعر (ر.س)" name="price" required><Input name="price" type="number" step="0.01" min={0} defaultValue={p?.price ?? ""} /></EField>
      <div className="grid grid-cols-2 gap-2">
        <EField label="يسري من" name="validFrom"><Input name="validFrom" type="date" defaultValue={p?.validFrom ?? ""} /></EField>
        <EField label="حتى" name="validTo"><Input name="validTo" type="date" defaultValue={p?.validTo ?? ""} /></EField>
      </div>
    </FieldGrid>
  );
}

export default async function ServiceEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const auth = await requireStaff("admin.services");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await read(auth, async (tx) => ({ svc: await loadService(tx, id), opts: await serviceFormOptions(tx) }));
  if (!data.svc) notFound();
  const { s, prices, log, requests, inPackages } = data.svc;
  const canPrice = auth.perms.has("admin.pricing");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <EditorPage>
      <PageHeader
        title={s.nameAr}
        description={<span className="flex flex-wrap items-center gap-2"><span dir="ltr" className="tabular">{s.code}</span>{s.isActive ? <Badge tone="ok">مفعّلة</Badge> : <Badge tone="neutral">موقوفة</Badge>}<span>{requests} طلبًا</span></span>}
        crumbs={[{ href: "/admin/services", label: "الخدمات" }, { label: s.code }]}
        actions={<Link href={`/services/${s.code}`} className="text-[14px] text-ink underline">صفحة الخدمة العامة</Link>}
      />
      <Flash sp={sp} />
      <Panel title="بيانات الخدمة">
        <EditorForm action={saveService} submitLabel="احفظ الخدمة">
          <ServiceFields s={s} cats={data.opts.cats} wfs={data.opts.wfs} />
        </EditorForm>
      </Panel>

      <Panel title="الأسعار حسب الفئة والفترة" description="لكل فئة وقف سعر واحد ساري في أي تاريخ؛ الفترات المتداخلة تُرفض. السعر الأساسي أعلاه يُستخدم حين لا يوجد سعر ساري للفئة.">
        <div className="space-y-4">
          <DataTable
            rows={prices}
            rowKey={(p) => p.id}
            caption="أسعار الخدمة"
            empty={<p className="py-4 text-muted">لا أسعار خاصة بعد؛ يُستخدم السعر الأساسي أو عرض السعر.</p>}
            columns={[
              { key: "c", label: "الفئة", render: (p) => sizeLabel(p.sizeClass) },
              { key: "p", label: "السعر", render: (p) => <span className="tabular">{fmtSAR(p.price)}</span> },
              { key: "v", label: "الفترة", render: (p) => `${p.validFrom ? fmtDate(p.validFrom) : "مفتوحة"} — ${p.validTo ? fmtDate(p.validTo) : "مفتوحة"}` },
              {
                key: "s", label: "الحالة",
                render: (p) => (p.validTo && p.validTo < today ? <Badge tone="neutral">منتهٍ</Badge> : p.validFrom && p.validFrom > today ? <Badge tone="info">قادم</Badge> : <Badge tone="ok">ساري</Badge>),
              },
              {
                key: "a", label: "إجراء",
                render: (p) =>
                  canPrice ? (
                    <div className="flex flex-col gap-2">
                      <details>
                        <summary className="cursor-pointer text-[14px] text-ink">تعديل</summary>
                        <div className="mt-2 rounded-md border border-line p-3">
                          <EditorForm action={savePrice} submitLabel="احفظ السعر" idPrefix={`p${p.id.slice(0, 8)}`}>
                            <input type="hidden" name="serviceId" value={s.id} />
                            <input type="hidden" name="priceId" value={p.id} />
                            <PriceFields p={p} />
                          </EditorForm>
                        </div>
                      </details>
                      <ActionButton action={deletePrice} fields={{ priceId: p.id, serviceId: s.id }} label="حذف" variant="ghost" confirmText="حذف هذا السعر؟ يبقى في سجل تغييرات الأسعار." />
                    </div>
                  ) : null,
              },
            ]}
          />
          {canPrice ? (
            <div className="rounded-md border border-dashed border-line-strong p-4">
              <h3 className="mb-3 font-semibold">إضافة سعر</h3>
              <EditorForm action={savePrice} submitLabel="أضف السعر">
                <input type="hidden" name="serviceId" value={s.id} />
                <PriceFields />
              </EditorForm>
            </div>
          ) : (
            <p className="text-[14px] text-muted">تعديل الأسعار يحتاج صلاحية «إدارة الأسعار والخصومات».</p>
          )}
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="سجل تغييرات الأسعار">
          <ChangeList
            items={log.map((l) => ({
              key: l.l.id,
              at: fmtDateTime(l.l.at),
              who: l.actor,
              text: <span>{FIELD_AR[l.l.field] ?? l.l.field}: <span className="text-muted">{l.l.oldValue ?? "—"}</span> ← <strong>{l.l.newValue ?? "—"}</strong></span>,
            }))}
          />
        </Panel>
        <Panel title="ضمن الباقات">
          {inPackages.length ? (
            <ul className="space-y-1">{inPackages.map((p) => <li key={p.id}><Link href={`/admin/services/packages/${p.id}`} className="text-ink hover:underline">{p.nameAr}</Link></li>)}</ul>
          ) : <p className="text-[14px] text-muted">ليست ضمن أي باقة.</p>}
        </Panel>
      </div>
    </EditorPage>
  );
}
