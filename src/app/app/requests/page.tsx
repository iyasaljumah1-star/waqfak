import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { ButtonLink, PageHeader, Panel } from "@/components/ui";
import { ClientRequestTable } from "@/components/requests/list";
import { requireAuth } from "@/server/authz/context";
import { listClientRequests } from "@/server/modules/requests/queries";

export const metadata: Metadata = { title: "طلباتي" };

export default async function MyRequests() {
  const auth = await requireAuth({ next: "/app/requests" });
  const rows = await listClientRequests(auth);
  const open = rows.filter((r) => !["completed", "closed", "cancelled", "rejected"].includes(r.status));
  const done = rows.filter((r) => ["completed", "closed", "cancelled", "rejected"].includes(r.status));
  const waiting = open.filter((r) => ["awaiting_client", "quote", "awaiting_contract", "awaiting_client_approval"].includes(r.status)).length;
  return (
    <div className="space-y-6">
      <PageHeader
        title="طلباتي"
        description={waiting ? `${waiting} من طلباتك بانتظار إجراء منك.` : "طلباتك وطلبات الأوقاف التي تتابعها."}
        actions={<ButtonLink href="/app/services" size="sm"><Plus aria-hidden className="size-4" />طلب جديد</ButtonLink>}
      />
      <Panel title="طلبات مفتوحة" tight>
        <div className="px-3 md:px-2"><ClientRequestTable rows={open} /></div>
      </Panel>
      {done.length ? (
        <Panel title="طلبات منتهية" tight>
          <div className="px-3 md:px-2"><ClientRequestTable rows={done} /></div>
        </Panel>
      ) : null}
    </div>
  );
}
