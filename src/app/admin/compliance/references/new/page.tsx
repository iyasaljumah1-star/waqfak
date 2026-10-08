import type { Metadata } from "next";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { referenceOptions } from "@/server/modules/admin/editors/compliance.queries";
import { saveReference } from "@/server/modules/admin/editors/compliance.actions";
import { PageHeader, Panel } from "@/components/ui";
import { EditorForm } from "@/components/admin-editors/editor-form";
import { ReferenceFields } from "@/components/admin-editors/compliance-fields";
import { EditorPage } from "@/components/admin-editors/shell";

export const metadata: Metadata = { title: "مصدر نظامي جديد" };

export default async function NewReference() {
  const auth = await requireStaff("admin.compliance");
  const refs = await read(auth, referenceOptions);
  return (
    <EditorPage>
      <PageHeader title="مصدر نظامي جديد" crumbs={[{ href: "/admin/compliance?tab=references", label: "المصادر النظامية" }, { label: "جديد" }]} />
      <Panel>
        <EditorForm action={saveReference} submitLabel="أنشئ المصدر">
          <ReferenceFields r={null} codes={refs.map((r) => r.code)} />
        </EditorForm>
      </Panel>
    </EditorPage>
  );
}
