import type { Metadata } from "next";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { obligationFormOptions } from "@/server/modules/admin/editors/compliance.queries";
import { previewObligation, saveObligation } from "@/server/modules/admin/editors/compliance.actions";
import { PageHeader, Panel } from "@/components/ui";
import { ObligationForm } from "@/components/admin-editors/obligation-form";
import { ObligationFields } from "@/components/admin-editors/obligation-fields";
import { EditorPage } from "@/components/admin-editors/shell";

export const metadata: Metadata = { title: "التزام جديد" };

export default async function NewObligation() {
  const auth = await requireStaff("admin.compliance");
  const { reqs, pens } = await read(auth, obligationFormOptions);
  return (
    <EditorPage>
      <PageHeader
        title="التزام جديد"
        description="عرّف الالتزام وشروط انطباقه، وعاين الأوقاف التي سينطبق عليها، ثم احفظ. يُعاد حساب التزامات جميع الأوقاف فور الحفظ."
        crumbs={[{ href: "/admin/compliance", label: "محرك الامتثال" }, { label: "التزام جديد" }]}
      />
      <Panel>
        <ObligationForm save={saveObligation} preview={previewObligation} isNew>
          <ObligationFields o={null} reqs={reqs} pens={pens} />
        </ObligationForm>
      </Panel>
    </EditorPage>
  );
}
