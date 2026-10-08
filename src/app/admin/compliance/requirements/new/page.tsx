import type { Metadata } from "next";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { listRequirements, referenceOptions } from "@/server/modules/admin/editors/compliance.queries";
import { saveRequirement } from "@/server/modules/admin/editors/compliance.actions";
import { nextReqCode } from "@/server/modules/admin/editors/pure";
import { PageHeader, Panel } from "@/components/ui";
import { EditorForm } from "@/components/admin-editors/editor-form";
import { RequirementFields } from "@/components/admin-editors/compliance-fields";
import { EditorPage } from "@/components/admin-editors/shell";

export const metadata: Metadata = { title: "متطلب نظامي جديد" };

export default async function NewRequirement() {
  const auth = await requireStaff("admin.compliance");
  const { refs, codes } = await read(auth, async (tx) => ({ refs: await referenceOptions(tx), codes: (await listRequirements(tx)).map((r) => r.r.code) }));
  return (
    <EditorPage>
      <PageHeader title="متطلب نظامي جديد" description="المتطلب هو بند من مصدر نظامي، ويُربط بما ينفّذه في المنصة ليظهر في سجل التتبع." crumbs={[{ href: "/admin/compliance?tab=requirements", label: "المتطلبات" }, { label: "جديد" }]} />
      <Panel>
        <EditorForm action={saveRequirement} submitLabel="أنشئ المتطلب">
          <RequirementFields r={null} refs={refs} suggestedCode={nextReqCode(codes)} />
        </EditorForm>
      </Panel>
    </EditorPage>
  );
}
