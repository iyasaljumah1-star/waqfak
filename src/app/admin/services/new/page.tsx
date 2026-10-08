import type { Metadata } from "next";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { serviceFormOptions } from "@/server/modules/admin/editors/services.queries";
import { saveService } from "@/server/modules/admin/editors/services.actions";
import { PageHeader, Panel } from "@/components/ui";
import { EditorForm } from "@/components/admin-editors/editor-form";
import { EditorPage } from "@/components/admin-editors/shell";
import { ServiceFields } from "@/components/admin-editors/service-fields";

export const metadata: Metadata = { title: "خدمة جديدة" };

export default async function NewService() {
  const auth = await requireStaff("admin.services");
  const { cats, wfs } = await read(auth, serviceFormOptions);
  return (
    <EditorPage>
      <PageHeader title="خدمة جديدة" crumbs={[{ href: "/admin/services", label: "الخدمات" }, { label: "جديدة" }]} />
      <Panel>
        <EditorForm action={saveService} submitLabel="أنشئ الخدمة">
          <ServiceFields s={null} cats={cats} wfs={wfs} />
        </EditorForm>
      </Panel>
    </EditorPage>
  );
}
