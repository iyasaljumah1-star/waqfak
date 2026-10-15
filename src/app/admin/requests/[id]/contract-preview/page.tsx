import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, PageHeader, Panel } from "@/components/ui";
import { ContractPaper } from "@/components/requests/bits";
import { requireStaff } from "@/server/authz/context";
import { contractPreview } from "@/server/modules/contracts/preview";

export const metadata: Metadata = { title: "معاينة مسودة العقد" };

/** The contract a quote will produce, previewed before its draft can be prepared. Nothing is stored. */
export default async function ContractPreviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ quoteId?: string }> }) {
  const { id } = await params;
  const { quoteId } = await searchParams;
  const auth = await requireStaff("admin.access");
  if (!quoteId || !/^[0-9a-f-]{36}$/i.test(quoteId)) notFound();
  const d = await contractPreview(auth, id, quoteId);
  if (!d) notFound();
  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ href: "/admin/requests", label: "الطلبات" }, { href: `/admin/requests/${id}#contract`, label: d.rc.req.number }, { label: "معاينة العقد" }]}
        title={`معاينة العقد من العرض ${d.q.number} (نسخة ${d.q.version})`}
        description="ما سيكون عليه نص العقد بالبيانات الحالية. ليست مسودة عقد: لا يُحفظ ولا يُرقَّم ولا يُرسل ولا يُوقَّع."
      />
      <div data-testid="contract-preview-banner"><Alert tone="info" title="معاينة غير محفوظة — ليست عقدًا">يظهر كل نقص في موضعه بين قوسين «[ناقص: …]»، ولا يُملأ بقيمة افتراضية. تُعدّ مسودة العقد من لوحة «العقد» في الطلب بعد استكمال ما يلزم.</Alert></div>
      {d.missing.length ? (
        <Panel title="ما ينقص قبل إعداد مسودة العقد">
          <ul className="list-disc space-y-1 ps-5 text-[15px]" data-testid="contract-preview-gaps">{d.missing.map((m) => <li key={m}>{m}</li>)}</ul>
        </Panel>
      ) : null}
      <Panel title="نص العقد كما سيُعدّ">
        {d.body ? <ContractPaper body={d.body} number="—" hash="لا بصمة: معاينة غير محفوظة" /> : <p className="text-muted">تعذر بناء المعاينة: {d.missing[0]}</p>}
      </Panel>
      <Link href={`/admin/requests/${id}#contract`} className="text-[14px] text-ink hover:underline">العودة إلى الطلب</Link>
    </div>
  );
}
