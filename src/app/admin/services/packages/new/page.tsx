import type { Metadata } from "next";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { serviceOptions } from "@/server/modules/admin/editors/services.queries";
import { savePackage } from "@/server/modules/admin/editors/services.actions";
import { PageHeader, Panel } from "@/components/ui";
import { EditorForm } from "@/components/admin-editors/editor-form";
import { EditorPage } from "@/components/admin-editors/shell";
import { PackageFields } from "@/components/admin-editors/package-fields";

export const metadata: Metadata = { title: "باقة جديدة" };

export default async function NewPackage() {
  const auth = await requireStaff("admin.services");
  const services = await read(auth, serviceOptions);
  return (
    <EditorPage>
      <PageHeader title="باقة جديدة" crumbs={[{ href: "/admin/services?tab=packages", label: "الباقات" }, { label: "جديدة" }]} />
      <Panel>
        <EditorForm action={savePackage} submitLabel="أنشئ الباقة">
          <PackageFields p={null} services={services} items={[]} />
        </EditorForm>
      </Panel>
    </EditorPage>
  );
}
