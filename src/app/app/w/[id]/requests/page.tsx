import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ButtonLink, PageHeader, Panel } from "@/components/ui";
import { ClientRequestTable } from "@/components/requests/list";
import { requireAuth, requireWaqf, waqfCan } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { memberCan } from "@/server/modules/requests/access";
import { listClientRequests } from "@/server/modules/requests/queries";

export const metadata: Metadata = { title: "الخدمات والطلبات" };

export default async function WaqfRequests({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuth({ next: `/app/w/${id}/requests` });
  const access = await requireWaqf(auth, id, "requests.view");
  const isMember = await read(auth, (tx) => memberCan(tx, auth, id, "requests.view"));
  // Members see the waqf's requests. Assigned staff (non-members) see only their own requests here; the
  // staff workbench is the place for the rest.
  const rows = isMember ? await listClientRequests(auth, { waqfId: id }) : [];
  const canCreate = waqfCan(access, "requests.create") && access.roles.length > 0;
  return (
    <div className="space-y-6">
      <PageHeader
        title="الخدمات والطلبات"
        description="طلبات الخدمات المقدمة لهذا الوقف ومراحلها."
        actions={canCreate ? <ButtonLink href={`/app/services?waqf=${id}`} size="sm"><Plus aria-hidden className="size-4" />اطلب خدمة لهذا الوقف</ButtonLink> : null}
      />
      {!isMember ? (
        <Panel>
          <p className="text-[15px]">أنت تطّلع على هذا الوقف بصفتك موظفًا مكلفًا. تجد الطلبات المسندة إليك في <Link className="text-ink underline" href="/admin/requests">لوحة الطلبات</Link>.</p>
        </Panel>
      ) : (
        <Panel tight>
          <div className="px-3 md:px-2"><ClientRequestTable rows={rows} showWaqf={false} newHref={`/app/services?waqf=${id}`} /></div>
        </Panel>
      )}
    </div>
  );
}
