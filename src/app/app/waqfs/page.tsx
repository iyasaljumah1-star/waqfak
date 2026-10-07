import type { Metadata } from "next";
import Link from "next/link";
import { Landmark, Plus } from "lucide-react";
import { Badge, DataTable, EmptyState, PageHeader } from "@/components/ui";
import { ActionLink } from "@/components/portal/action-link";
import { STATUS_TONE } from "@/components/portal/labels";
import { StageMeter } from "@/components/portal/stage";
import { SIZE_LABEL, STATUS_LABEL, TYPE_LABEL } from "@/lib/utils";
import { requireAuth } from "@/server/authz/context";
import { roleName } from "@/server/authz/catalog";
import { myWaqfs } from "@/server/modules/portal/queries";

export const metadata: Metadata = { title: "أوقافي" };

export default async function WaqfsPage() {
  const auth = await requireAuth({ next: "/app/waqfs" });
  const waqfs = await myWaqfs(auth);
  return (
    <>
      <PageHeader
        title="أوقافي"
        description="كل وقف يرتبط به حسابك، ودورك فيه. تحدد أدوارك ما تراه وما تستطيع فعله في ملف كل وقف."
        actions={<ActionLink href="/app/waqfs/new" size="sm"><Plus aria-hidden className="size-4" />سجّل وقفًا قائمًا</ActionLink>}
      />
      <div className="rounded-lg border border-line bg-surface px-2 md:px-3">
        <DataTable
          caption="أوقافي"
          rows={waqfs}
          rowKey={(w) => w.id}
          columns={[
            {
              key: "name",
              label: "الوقف",
              render: (w) => (
                <div className="min-w-0">
                  <Link href={w.beneficiaryOnly ? `/app/b/${w.id}` : `/app/w/${w.id}`} className="font-semibold text-ink hover:underline">{w.name}</Link>
                  <p dir="ltr" className="tabular text-end text-[13px] text-muted md:text-start">{w.internalNumber}</p>
                </div>
              ),
            },
            {
              key: "roles",
              label: "دوري",
              render: (w) => (
                <div className="flex flex-wrap gap-1">
                  {w.roles.map((r) => (
                    <Badge key={r} tone={r === "beneficiary" ? "seal" : "ink"} icon={false}>{roleName(r)}</Badge>
                  ))}
                </div>
              ),
            },
            {
              key: "status",
              label: "الحالة",
              render: (w) => (
                <div className="flex flex-wrap gap-1">
                  <Badge tone={STATUS_TONE[w.status] ?? "neutral"} icon={false}>{STATUS_LABEL[w.status] ?? w.status}</Badge>
                  {w.legalType ? <Badge icon={false}>{TYPE_LABEL[w.legalType]}</Badge> : null}
                  {w.sizeClass ? <Badge icon={false}>{SIZE_LABEL[w.sizeClass]}</Badge> : null}
                </div>
              ),
            },
            { key: "stage", label: "المرحلة", hideOnMobile: true, render: (w) => <StageMeter stage={w.stage} /> },
          ]}
          empty={
            <div className="py-4">
              <EmptyState
                icon={Landmark}
                title="لا يرتبط حسابك بأي وقف بعد"
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <ActionLink href="/app/waqfs/new" size="sm">سجّل وقفًا قائمًا</ActionLink>
                    <ActionLink href="/app/establish" size="sm" variant="secondary">أسّس وقفًا جديدًا</ActionLink>
                  </div>
                }
              >
                سجّل وقفًا موثّقًا تديره أو أسّس وقفًا جديدًا. إن دعاك ناظر إلى وقف فسيظهر هنا بعد قبول الدعوة.
              </EmptyState>
            </div>
          }
        />
      </div>
    </>
  );
}
