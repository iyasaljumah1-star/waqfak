import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { listPackages, loadDiscount, serviceOptions } from "@/server/modules/admin/editors/services.queries";
import { saveDiscount } from "@/server/modules/admin/editors/services.actions";
import { PageHeader, Panel } from "@/components/ui";
import { EditorForm } from "@/components/admin-editors/editor-form";
import { ChangeList, EditorPage, Flash } from "@/components/admin-editors/shell";
import { DiscountFields } from "@/components/admin-editors/discount-fields";
import { fmtDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "تعديل خصم" };
const FIELD_AR: Record<string, string> = { kind: "النوع", value: "القيمة", validFrom: "يسري من", validTo: "حتى", maxUses: "الحد الأقصى", isActive: "مفعّل" };

export default async function DiscountEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const auth = await requireStaff("admin.pricing");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await read(auth, async (tx) => ({ disc: await loadDiscount(tx, id), services: await serviceOptions(tx), packages: (await listPackages(tx)).map((p) => p.p) }));
  if (!data.disc) notFound();
  const { d, log } = data.disc;
  return (
    <EditorPage>
      <PageHeader title={`الخصم ${d.code}`} crumbs={[{ href: "/admin/services?tab=discounts", label: "الخصومات" }, { label: d.code }]} />
      <Flash sp={sp} />
      <Panel>
        <EditorForm action={saveDiscount} submitLabel="احفظ الخصم">
          <DiscountFields d={d} services={data.services} packages={data.packages} />
        </EditorForm>
      </Panel>
      <Panel title="سجل التغييرات">
        <ChangeList items={log.map((l) => ({ key: l.l.id, at: fmtDateTime(l.l.at), who: l.actor, text: <span>{FIELD_AR[l.l.field] ?? l.l.field}: <span className="text-muted">{l.l.oldValue ?? "—"}</span> ← <strong>{l.l.newValue ?? "—"}</strong></span> }))} />
      </Panel>
    </EditorPage>
  );
}
