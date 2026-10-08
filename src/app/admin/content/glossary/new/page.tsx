import type { Metadata } from "next";
import { requireStaff } from "@/server/authz/context";
import { saveTerm } from "@/server/modules/admin/editors/content.actions";
import { PageHeader, Panel } from "@/components/ui";
import { EditorForm } from "@/components/admin-editors/editor-form";
import { TermFields } from "@/components/admin-editors/faq-glossary-fields";
import { EditorPage } from "@/components/admin-editors/shell";

export const metadata: Metadata = { title: "مصطلح جديد" };

export default async function NewTerm() {
  await requireStaff("admin.content");
  return (
    <EditorPage>
      <PageHeader title="مصطلح جديد" crumbs={[{ href: "/admin/content/glossary", label: "المصطلحات" }, { label: "جديد" }]} />
      <Panel><EditorForm action={saveTerm} submitLabel="أضف المصطلح"><TermFields t={null} /></EditorForm></Panel>
    </EditorPage>
  );
}
