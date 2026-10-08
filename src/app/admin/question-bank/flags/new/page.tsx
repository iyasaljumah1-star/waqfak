import type { Metadata } from "next";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { listPenalties } from "@/server/modules/admin/editors/compliance.queries";
import { saveFlagDef } from "@/server/modules/admin/editors/bank.actions";
import { PageHeader, Panel } from "@/components/ui";
import { EditorForm } from "@/components/admin-editors/editor-form";
import { EditorPage } from "@/components/admin-editors/shell";
import { FlagFields } from "@/components/admin-editors/flag-fields";

export const metadata: Metadata = { title: "إشارة حرجة جديدة" };

export default async function NewFlag() {
  const auth = await requireStaff("admin.rules");
  const penalties = await read(auth, listPenalties);
  return (
    <EditorPage>
      <PageHeader title="إشارة حرجة جديدة" crumbs={[{ href: "/admin/question-bank/flags", label: "الإشارات الحرجة" }, { label: "جديدة" }]} />
      <Panel>
        <EditorForm action={saveFlagDef} submitLabel="أنشئ الإشارة">
          <FlagFields f={null} penalties={penalties} />
        </EditorForm>
      </Panel>
    </EditorPage>
  );
}
