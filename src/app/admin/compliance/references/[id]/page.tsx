import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { loadReference, referenceOptions } from "@/server/modules/admin/editors/compliance.queries";
import { deleteReference, saveReference } from "@/server/modules/admin/editors/compliance.actions";
import { PageHeader, Panel } from "@/components/ui";
import { ActionButton, EditorForm } from "@/components/admin-editors/editor-form";
import { ReferenceFields } from "@/components/admin-editors/compliance-fields";
import { EditorPage, Flash } from "@/components/admin-editors/shell";

export const metadata: Metadata = { title: "مصدر نظامي" };

export default async function ReferenceEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const auth = await requireStaff("admin.compliance");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await read(auth, async (tx) => ({ ref: await loadReference(tx, id), all: await referenceOptions(tx) }));
  if (!data.ref) notFound();
  const { r, reqs } = data.ref;
  return (
    <EditorPage>
      <PageHeader title={r.sourceName} description={<span dir="ltr">{r.code}</span>} crumbs={[{ href: "/admin/compliance?tab=references", label: "المصادر النظامية" }, { label: r.code }]} />
      <Flash sp={sp} />
      <Panel>
        <EditorForm action={saveReference} submitLabel="احفظ المصدر">
          <ReferenceFields r={r} codes={data.all.map((x) => x.code)} />
        </EditorForm>
      </Panel>
      <Panel title={`المتطلبات المستخرجة منه (${reqs.length})`}>
        {reqs.length ? <ul className="space-y-1">{reqs.map((q) => <li key={q.id}><Link className="text-ink hover:underline" href={`/admin/compliance/requirements/${q.id}`}><span dir="ltr">{q.code}</span> — {q.title}</Link></li>)}</ul> : (
          <div className="space-y-3"><p className="text-[14px] text-muted">لا متطلبات مرتبطة.</p><ActionButton action={deleteReference} fields={{ id: r.id }} label="احذف المصدر" variant="ghost" confirmText="حذف هذا المصدر؟" /></div>
        )}
      </Panel>
    </EditorPage>
  );
}
