import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { loadPenalty } from "@/server/modules/admin/editors/compliance.queries";
import { savePenalty } from "@/server/modules/admin/editors/compliance.actions";
import { PageHeader, Panel } from "@/components/ui";
import { EditorForm } from "@/components/admin-editors/editor-form";
import { PenaltyFields } from "@/components/admin-editors/compliance-fields";
import { EditorPage, Flash } from "@/components/admin-editors/shell";

export const metadata: Metadata = { title: "بند مخالفة" };

export default async function PenaltyEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const auth = await requireStaff("admin.compliance");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await read(auth, (tx) => loadPenalty(tx, id));
  if (!data) notFound();
  return (
    <EditorPage>
      <PageHeader title={<span>البند <span dir="ltr">{data.p.code}</span></span>} description={data.p.titleAr} crumbs={[{ href: "/admin/compliance?tab=penalties", label: "جدول المخالفات" }, { label: data.p.code }]} />
      <Flash sp={sp} />
      <Panel>
        <EditorForm action={savePenalty} submitLabel="احفظ البند">
          <PenaltyFields p={data.p} />
        </EditorForm>
      </Panel>
      <Panel title="التزامات تشير إليه">
        {data.linked.length ? <ul className="space-y-1">{data.linked.map((o) => <li key={o.id}><Link className="text-ink hover:underline" href={`/admin/compliance/obligations/${o.id}`}><span dir="ltr">{o.code}</span> — {o.titleAr}</Link></li>)}</ul> : <p className="text-[14px] text-muted">لا التزامات مرتبطة.</p>}
      </Panel>
    </EditorPage>
  );
}
