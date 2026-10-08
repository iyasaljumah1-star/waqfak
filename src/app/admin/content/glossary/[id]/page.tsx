import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { loadTerm } from "@/server/modules/admin/editors/content.queries";
import { deleteTerm, saveTerm } from "@/server/modules/admin/editors/content.actions";
import { PageHeader, Panel } from "@/components/ui";
import { ActionButton, EditorForm } from "@/components/admin-editors/editor-form";
import { TermFields } from "@/components/admin-editors/faq-glossary-fields";
import { EditorPage, Flash } from "@/components/admin-editors/shell";

export const metadata: Metadata = { title: "تعديل مصطلح" };

export default async function TermEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const auth = await requireStaff("admin.content");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const t = await read(auth, (tx) => loadTerm(tx, id));
  if (!t) notFound();
  return (
    <EditorPage>
      <PageHeader title={t.term} crumbs={[{ href: "/admin/content/glossary", label: "المصطلحات" }, { label: t.term }]} />
      <Flash sp={sp} />
      <Panel><EditorForm action={saveTerm} submitLabel="احفظ"><TermFields t={t} /></EditorForm></Panel>
      <ActionButton action={deleteTerm} fields={{ id }} label="احذف المصطلح" variant="ghost" confirmText="حذف هذا المصطلح؟" />
    </EditorPage>
  );
}
