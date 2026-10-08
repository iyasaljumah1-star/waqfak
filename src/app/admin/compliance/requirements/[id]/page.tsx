import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { loadRequirement, referenceOptions } from "@/server/modules/admin/editors/compliance.queries";
import { deleteRequirement, saveRequirement } from "@/server/modules/admin/editors/compliance.actions";
import { PageHeader, Panel } from "@/components/ui";
import { ActionButton, EditorForm } from "@/components/admin-editors/editor-form";
import { RequirementFields } from "@/components/admin-editors/compliance-fields";
import { ChangeList, EditorPage, Flash } from "@/components/admin-editors/shell";
import { fmtDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "متطلب نظامي" };

export default async function RequirementEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const auth = await requireStaff("admin.compliance");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await read(auth, async (tx) => ({ req: await loadRequirement(tx, id), refs: await referenceOptions(tx) }));
  if (!data.req) notFound();
  const { r, linked, log } = data.req;
  return (
    <EditorPage>
      <PageHeader title={<span><span dir="ltr">{r.code}</span> — متطلب</span>} description={r.title} crumbs={[{ href: "/admin/compliance?tab=requirements", label: "المتطلبات" }, { label: r.code }]} actions={<Link href={`/admin/traceability?q=${r.code}`} className="text-[14px] text-ink underline">في سجل التتبع</Link>} />
      <Flash sp={sp} />
      <Panel>
        <EditorForm action={saveRequirement} submitLabel="احفظ المتطلب">
          <RequirementFields r={r} refs={data.refs} suggestedCode={r.code} />
        </EditorForm>
      </Panel>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="التزامات مرتبطة">
          {linked.length ? <ul className="space-y-1">{linked.map((o) => <li key={o.id}><Link className="text-ink hover:underline" href={`/admin/compliance/obligations/${o.id}`}><span dir="ltr">{o.code}</span> — {o.titleAr}</Link></li>)}</ul> : <p className="text-[14px] text-muted">لا التزامات تشير إلى هذا المتطلب.</p>}
          {!linked.length ? <div className="mt-4"><ActionButton action={deleteRequirement} fields={{ id: r.id }} label="احذف المتطلب" variant="ghost" confirmText={`حذف ${r.code}؟ يبقى في سجل التغييرات.`} /></div> : null}
        </Panel>
        <Panel title="سجل التغييرات">
          <ChangeList items={log.map((l) => ({ key: l.l.id, at: fmtDateTime(l.l.at), who: l.actor, text: <span>{String(l.l.change.action ?? "")} <span className="text-[12px] text-muted" dir="ltr">{((l.l.change.diff as { field: string }[] | undefined) ?? []).map((d) => d.field).join(", ")}</span></span> }))} />
        </Panel>
      </div>
    </EditorPage>
  );
}
