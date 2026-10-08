import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { loadWorkflow } from "@/server/modules/admin/editors/services.queries";
import { saveWorkflow } from "@/server/modules/admin/editors/services.actions";
import { PageHeader, Panel } from "@/components/ui";
import { Input } from "@/components/ui/form";
import { EditorForm, EField } from "@/components/admin-editors/editor-form";
import { EditorPage, Flash } from "@/components/admin-editors/shell";
import { StagesField } from "@/components/admin-editors/stages-field";

export const metadata: Metadata = { title: "قالب سير العمل" };

export default async function WorkflowEditor({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { code } = await params;
  const sp = await searchParams;
  const auth = await requireStaff("admin.services");
  const data = await read(auth, (tx) => loadWorkflow(tx, decodeURIComponent(code)));
  if (!data) notFound();
  const { w, services } = data;
  return (
    <EditorPage>
      <PageHeader title={w.nameAr} description={<span dir="ltr">{w.code}</span>} crumbs={[{ href: "/admin/services?tab=workflows", label: "قوالب سير العمل" }, { label: w.nameAr }]} />
      <Flash sp={sp} />
      <Panel description="تعديل المراحل يسري على الطلبات الجديدة؛ الطلبات القائمة تحتفظ بالمراحل التي أُنشئت بها.">
        <EditorForm action={saveWorkflow} submitLabel="احفظ القالب">
          <input type="hidden" name="code" value={w.code} />
          <EField label="الاسم" name="nameAr" required><Input name="nameAr" defaultValue={w.nameAr} /></EField>
          <StagesField defaultValue={w.stages} />
        </EditorForm>
      </Panel>
      <Panel title={`الخدمات التي تستخدمه (${services.length})`}>
        {services.length ? (
          <ul className="flex flex-wrap gap-2">
            {services.map((s) => <li key={s.id}><Link href={`/admin/services/${s.id}`} className="rounded-full border border-line px-3 py-1 text-[14px] hover:bg-surface-2"><span dir="ltr">{s.code}</span> {s.nameAr}</Link></li>)}
          </ul>
        ) : <p className="text-[14px] text-muted">لا خدمات تستخدم هذا القالب.</p>}
      </Panel>
    </EditorPage>
  );
}
