import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { listFlagDefs, loadBankVersion } from "@/server/modules/admin/editors/bank.queries";
import { saveQuestion } from "@/server/modules/admin/editors/bank.actions";
import { PageHeader, Panel } from "@/components/ui";
import { EditorForm } from "@/components/admin-editors/editor-form";
import { EditorPage } from "@/components/admin-editors/shell";
import { QuestionFields } from "@/components/admin-editors/question-fields";

export const metadata: Metadata = { title: "سؤال جديد" };
const BASE_FACTS = ["size_class", "computed_type", "nazir_kind", "waqf_state", "waqfak_role"];

export default async function NewQuestion({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  const auth = await requireStaff("admin.rules");
  if (!/^[0-9a-f-]{36}$/.test(versionId)) notFound();
  const data = await read(auth, async (tx) => ({ b: await loadBankVersion(tx, versionId), flags: await listFlagDefs(tx) }));
  if (!data.b) notFound();
  if (data.b.v.status !== "draft") redirect(`/admin/question-bank/${versionId}`);
  const factKeys = [...BASE_FACTS, ...(data.b.questions.map((q) => q.factKey).filter(Boolean) as string[])];
  return (
    <EditorPage>
      <PageHeader title="سؤال جديد" crumbs={[{ href: "/admin/question-bank", label: "بنك الأسئلة" }, { href: `/admin/question-bank/${versionId}`, label: `الإصدار ${data.b.v.version}` }, { label: "سؤال جديد" }]} />
      <Panel>
        <EditorForm action={saveQuestion} submitLabel="أضف السؤال">
          <QuestionFields q={null} versionId={versionId} axes={data.b.axes} flags={data.flags} factKeys={factKeys} />
        </EditorForm>
      </Panel>
    </EditorPage>
  );
}
