import type { Metadata } from "next";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { listPackages, serviceOptions } from "@/server/modules/admin/editors/services.queries";
import { saveDiscount } from "@/server/modules/admin/editors/services.actions";
import { PageHeader, Panel } from "@/components/ui";
import { EditorForm } from "@/components/admin-editors/editor-form";
import { EditorPage } from "@/components/admin-editors/shell";
import { DiscountFields } from "@/components/admin-editors/discount-fields";

export const metadata: Metadata = { title: "خصم جديد" };

export default async function NewDiscount() {
  const auth = await requireStaff("admin.pricing");
  const { services, packages } = await read(auth, async (tx) => ({ services: await serviceOptions(tx), packages: (await listPackages(tx)).map((p) => p.p) }));
  return (
    <EditorPage>
      <PageHeader title="خصم جديد" crumbs={[{ href: "/admin/services?tab=discounts", label: "الخصومات" }, { label: "جديد" }]} />
      <Panel>
        <EditorForm action={saveDiscount} submitLabel="أنشئ الخصم">
          <DiscountFields d={null} services={services} packages={packages} />
        </EditorForm>
      </Panel>
    </EditorPage>
  );
}
