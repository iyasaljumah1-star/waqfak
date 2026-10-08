import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { listFaqs, loadFaq } from "@/server/modules/admin/editors/content.queries";
import { deleteFaq, saveFaq } from "@/server/modules/admin/editors/content.actions";
import { PageHeader, Panel } from "@/components/ui";
import { ActionButton, EditorForm } from "@/components/admin-editors/editor-form";
import { FaqFields } from "@/components/admin-editors/faq-glossary-fields";
import { EditorPage, Flash } from "@/components/admin-editors/shell";

export const metadata: Metadata = { title: "تعديل سؤال شائع" };

export default async function FaqEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const auth = await requireStaff("admin.content");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await read(auth, async (tx) => ({ f: await loadFaq(tx, id), topics: [...new Set((await listFaqs(tx)).map((x) => x.topic))] }));
  if (!data.f) notFound();
  return (
    <EditorPage>
      <PageHeader title="تعديل سؤال شائع" description={data.f.question} crumbs={[{ href: "/admin/content/faqs", label: "الأسئلة الشائعة" }, { label: "تعديل" }]} />
      <Flash sp={sp} />
      <Panel><EditorForm action={saveFaq} submitLabel="احفظ"><FaqFields f={data.f} topics={data.topics} /></EditorForm></Panel>
      <ActionButton action={deleteFaq} fields={{ id }} label="احذف السؤال" variant="ghost" confirmText="حذف هذا السؤال؟" />
    </EditorPage>
  );
}
