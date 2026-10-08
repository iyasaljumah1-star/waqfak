import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { listFlagDefs, loadBankVersion, loadQuestion } from "@/server/modules/admin/editors/bank.queries";
import { deleteQuestion, saveQuestion } from "@/server/modules/admin/editors/bank.actions";
import { Alert, PageHeader, Panel } from "@/components/ui";
import { ActionButton, EditorForm } from "@/components/admin-editors/editor-form";
import { EditorPage, Flash } from "@/components/admin-editors/shell";
import { QuestionFields } from "@/components/admin-editors/question-fields";

export const metadata: Metadata = { title: "تعديل سؤال" };
const BASE_FACTS = ["size_class", "computed_type", "nazir_kind", "waqf_state", "waqfak_role"];

export default async function QuestionEditor({ params, searchParams }: { params: Promise<{ versionId: string; qid: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { versionId, qid } = await params;
  const sp = await searchParams;
  const auth = await requireStaff("admin.rules");
  if (!/^[0-9a-f-]{36}$/.test(versionId) || !/^[0-9a-f-]{36}$/.test(qid)) notFound();
  const data = await read(auth, async (tx) => ({ b: await loadBankVersion(tx, versionId), q: await loadQuestion(tx, qid), flags: await listFlagDefs(tx) }));
  if (!data.b || !data.q || data.q.bankVersionId !== versionId) notFound();
  const editable = data.b.v.status === "draft";
  const factKeys = [...BASE_FACTS, ...(data.b.questions.map((q) => q.factKey).filter(Boolean) as string[])];
  return (
    <EditorPage>
      <PageHeader
        title={<span><span dir="ltr">{data.q.code}</span> — سؤال</span>}
        description={data.q.textAr}
        crumbs={[{ href: "/admin/question-bank", label: "بنك الأسئلة" }, { href: `/admin/question-bank/${versionId}`, label: `الإصدار ${data.b.v.version}` }, { label: data.q.code }]}
      />
      <Flash sp={sp} />
      {!editable ? <Alert tone="info" title="سؤال في نسخة منشورة — للقراءة فقط. أنشئ نسخة جديدة لتعديله." /> : null}
      <Panel>
        <EditorForm action={saveQuestion} submitLabel="احفظ السؤال" hideMain={!editable}>
          <QuestionFields q={data.q} versionId={versionId} axes={data.b.axes} flags={data.flags} factKeys={factKeys} readOnly={!editable} />
        </EditorForm>
      </Panel>
      {editable ? <ActionButton action={deleteQuestion} fields={{ versionId, questionId: qid }} label="احذف السؤال" variant="danger" confirmText={`حذف السؤال ${data.q.code} من المسودة؟`} /> : null}
    </EditorPage>
  );
}
