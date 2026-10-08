import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { loadPackage, serviceOptions } from "@/server/modules/admin/editors/services.queries";
import { savePackage } from "@/server/modules/admin/editors/services.actions";
import { Badge, PageHeader, Panel } from "@/components/ui";
import { EditorForm } from "@/components/admin-editors/editor-form";
import { ChangeList, EditorPage, Flash } from "@/components/admin-editors/shell";
import { PackageFields } from "@/components/admin-editors/package-fields";
import { fmtDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "تعديل باقة" };
const FIELD_AR: Record<string, string> = { monthlyPrice: "السعر الشهري", annualPrice: "السعر السنوي" };

export default async function PackageEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const auth = await requireStaff("admin.services");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await read(auth, async (tx) => ({ pkg: await loadPackage(tx, id), services: await serviceOptions(tx) }));
  if (!data.pkg) notFound();
  const { p, items, log } = data.pkg;
  return (
    <EditorPage>
      <PageHeader
        title={p.nameAr}
        description={<span className="flex items-center gap-2"><span dir="ltr">{p.code}</span>{p.isActive ? <Badge tone="ok">مفعّلة</Badge> : <Badge tone="neutral">موقوفة</Badge>}{p.isClosed ? <Badge tone="seal" icon={false}>مغلقة</Badge> : null}</span>}
        crumbs={[{ href: "/admin/services?tab=packages", label: "الباقات" }, { label: p.nameAr }]}
      />
      <Flash sp={sp} />
      <Panel>
        <EditorForm action={savePackage} submitLabel="احفظ الباقة">
          <PackageFields p={p} services={data.services} items={items} />
        </EditorForm>
      </Panel>
      <Panel title="سجل تغييرات الأسعار">
        <ChangeList items={log.map((l) => ({ key: l.l.id, at: fmtDateTime(l.l.at), who: l.actor, text: <span>{FIELD_AR[l.l.field] ?? l.l.field}: <span className="text-muted">{l.l.oldValue ?? "—"}</span> ← <strong>{l.l.newValue ?? "—"}</strong></span> }))} />
      </Panel>
    </EditorPage>
  );
}
