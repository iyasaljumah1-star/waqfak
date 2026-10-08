import type { Metadata } from "next";
import { requireStaff } from "@/server/authz/context";
import { saveWorkflow } from "@/server/modules/admin/editors/services.actions";
import { PageHeader, Panel } from "@/components/ui";
import { Input } from "@/components/ui/form";
import { EditorForm, EField } from "@/components/admin-editors/editor-form";
import { EditorPage, FieldGrid } from "@/components/admin-editors/shell";
import { StagesField } from "@/components/admin-editors/stages-field";

export const metadata: Metadata = { title: "قالب سير عمل جديد" };

const STARTER = [
  { key: "intake", name: "استلام البيانات والمستندات", slaDays: 3, role: "account_manager" },
  { key: "work", name: "التنفيذ", slaDays: 7, role: "consultant" },
  { key: "qa", name: "مراجعة الجودة", slaDays: 2, role: "quality" },
  { key: "client_review", name: "اعتماد العميل", slaDays: 5, role: "client", clientApproval: true },
];

export default async function NewWorkflow() {
  await requireStaff("admin.services");
  return (
    <EditorPage>
      <PageHeader title="قالب سير عمل جديد" crumbs={[{ href: "/admin/services?tab=workflows", label: "قوالب سير العمل" }, { label: "جديد" }]} />
      <Panel>
        <EditorForm action={saveWorkflow} submitLabel="أنشئ القالب">
          <input type="hidden" name="isNew" value="1" />
          <FieldGrid>
            <EField label="الرمز" name="code" required><Input name="code" dir="ltr" /></EField>
            <EField label="الاسم" name="nameAr" required><Input name="nameAr" /></EField>
          </FieldGrid>
          <StagesField defaultValue={STARTER} />
        </EditorForm>
      </Panel>
    </EditorPage>
  );
}
