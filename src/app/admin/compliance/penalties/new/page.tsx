import type { Metadata } from "next";
import { requireStaff } from "@/server/authz/context";
import { savePenalty } from "@/server/modules/admin/editors/compliance.actions";
import { PageHeader, Panel } from "@/components/ui";
import { EditorForm } from "@/components/admin-editors/editor-form";
import { PenaltyFields } from "@/components/admin-editors/compliance-fields";
import { EditorPage } from "@/components/admin-editors/shell";

export const metadata: Metadata = { title: "بند مخالفة جديد" };

export default async function NewPenalty() {
  await requireStaff("admin.compliance");
  return (
    <EditorPage>
      <PageHeader title="بند مخالفة جديد" crumbs={[{ href: "/admin/compliance?tab=penalties", label: "جدول المخالفات" }, { label: "جديد" }]} />
      <Panel>
        <EditorForm action={savePenalty} submitLabel="أنشئ البند">
          <PenaltyFields p={null} />
        </EditorForm>
      </Panel>
    </EditorPage>
  );
}
