import type { Metadata } from "next";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { listFaqs } from "@/server/modules/admin/editors/content.queries";
import { saveFaq } from "@/server/modules/admin/editors/content.actions";
import { PageHeader, Panel } from "@/components/ui";
import { EditorForm } from "@/components/admin-editors/editor-form";
import { FaqFields } from "@/components/admin-editors/faq-glossary-fields";
import { EditorPage } from "@/components/admin-editors/shell";

export const metadata: Metadata = { title: "سؤال شائع جديد" };

export default async function NewFaq() {
  const auth = await requireStaff("admin.content");
  const topics = [...new Set((await read(auth, listFaqs)).map((f) => f.topic))];
  return (
    <EditorPage>
      <PageHeader title="سؤال شائع جديد" crumbs={[{ href: "/admin/content/faqs", label: "الأسئلة الشائعة" }, { label: "جديد" }]} />
      <Panel><EditorForm action={saveFaq} submitLabel="أضف السؤال"><FaqFields f={null} topics={topics} /></EditorForm></Panel>
    </EditorPage>
  );
}
