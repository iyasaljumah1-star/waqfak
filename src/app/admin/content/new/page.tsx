import type { Metadata } from "next";
import { requireStaff } from "@/server/authz/context";
import { saveContent } from "@/server/modules/admin/editors/content.actions";
import { PageHeader, Panel } from "@/components/ui";
import { EditorForm } from "@/components/admin-editors/editor-form";
import { ContentFields } from "@/components/admin-editors/content-fields";
import { EditorPage } from "@/components/admin-editors/shell";

export const metadata: Metadata = { title: "محتوى جديد" };

export default async function NewContent() {
  await requireStaff("admin.content");
  return (
    <EditorPage wide>
      <PageHeader title="محتوى جديد" description="يُنشأ مسودة. أرسله للمراجعة ثم انشره من صفحته." crumbs={[{ href: "/admin/content", label: "المحتوى" }, { label: "جديد" }]} />
      <Panel>
        <EditorForm action={saveContent} submitLabel="احفظ المسودة">
          <ContentFields c={null} />
        </EditorForm>
      </Panel>
    </EditorPage>
  );
}
