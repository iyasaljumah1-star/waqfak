import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { Badge, ButtonLink, DataTable, EmptyState, PageHeader, Panel, Stat } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtSAR } from "@/lib/utils";
import { requireAuth } from "@/server/authz/context";
import { INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE, PAYMENT_STATUS_LABEL, PROVIDER_LABEL } from "@/server/modules/billing/access";
import { myInvoices } from "@/server/modules/billing/queries";

export const metadata: Metadata = { title: "الفواتير والمدفوعات" };

export default async function BillingPage() {
  const auth = await requireAuth({ next: "/app/billing" });
  const { invoices, payments, numbers } = await myInvoices(auth);
  const payable = (i: (typeof invoices)[number]) => ["tax_invoice", "non_tax_invoice"].includes(i.inv.kind);
  const due = invoices.filter((i) => payable(i) && ["issued", "overdue", "partially_paid"].includes(i.status));
  const paidOn = (id: string) => payments.filter((p) => p.invoiceId === id && p.status === "paid").reduce((s, p) => s + Number(p.amount), 0);
  const dueTotal = due.reduce((s, i) => s + Number(i.inv.total) - paidOn(i.inv.id), 0);
  const paidTotal = invoices.filter((i) => i.status === "paid").reduce((s, i) => s + Number(i.inv.total), 0);

  return (
    <div className="space-y-6">
      <PageHeader title="الفواتير والمدفوعات" description="فواتيرك الضريبية وسجل السداد. الفاتورة تصدر بعد توقيع العقد." />
      <div className="grid grid-cols-2 gap-3 md:max-w-xl">
        <Stat label="مستحق السداد" value={fmtSAR(dueTotal)} sub={`${due.length} فاتورة`} tone={due.some((i) => i.status === "overdue") ? "critical" : undefined} />
        <Stat label="مدفوع" value={fmtSAR(paidTotal)} />
      </div>
      <Panel title="الفواتير" tight>
        <div className="px-3 md:px-2">
          <DataTable
            rows={invoices}
            rowKey={(r) => r.inv.id}
            caption="الفواتير"
            empty={<div className="p-4"><EmptyState icon={Receipt} title="لا فواتير بعد">تصدر الفاتورة بعد قبول عرض السعر وتوقيع العقد.</EmptyState></div>}
            columns={[
              { key: "n", label: "الفاتورة", render: (r) => <Link href={`/app/billing/${r.inv.id}`} className="tabular font-medium text-ink hover:underline" dir="ltr">{r.inv.number}</Link> },
              { key: "for", label: "عن", render: (r) => <span>{r.inv.lines[0]?.description ?? "—"}{r.waqfName ? <span className="block text-[13px] text-muted">{r.waqfName}</span> : null}</span> },
              { key: "t", label: "الإجمالي", render: (r) => <span className="tabular">{fmtSAR(r.inv.total)}</span> },
              { key: "s", label: "الحالة", render: (r) => <Badge tone={INVOICE_STATUS_TONE[r.status] ?? "neutral"} icon={false}>{INVOICE_STATUS_LABEL[r.status] ?? r.status}</Badge> },
              { key: "d", label: "الاستحقاق", render: (r) => <span className="text-sm text-muted">{fmtDate(r.inv.dueOn ?? r.inv.issuedOn)}</span>, hideOnMobile: true },
              { key: "a", label: "", render: (r) => (payable(r) && ["issued", "overdue", "partially_paid"].includes(r.status) ? <ButtonLink href={`/app/billing/${r.inv.id}`} size="sm">ادفع</ButtonLink> : null) },
            ]}
          />
        </div>
      </Panel>
      <Panel title="المدفوعات" tight>
        <div className="px-3 md:px-2">
          <DataTable
            rows={payments}
            rowKey={(p) => p.id}
            caption="المدفوعات"
            empty={<p className="p-4 text-sm text-muted">لا مدفوعات مسجلة.</p>}
            columns={[
              { key: "i", label: "الفاتورة", render: (p) => <Link href={`/app/billing/${p.invoiceId}`} className="tabular text-ink hover:underline" dir="ltr">{numbers.get(p.invoiceId)}</Link> },
              { key: "a", label: "المبلغ", render: (p) => <span className="tabular">{fmtSAR(p.amount)}</span> },
              { key: "m", label: "الوسيلة", render: (p) => PROVIDER_LABEL[p.provider] ?? p.provider },
              { key: "s", label: "الحالة", render: (p) => <Badge tone={p.status === "paid" ? "ok" : p.status === "failed" ? "critical" : "neutral"} icon={false}>{PAYMENT_STATUS_LABEL[p.status] ?? p.status}</Badge> },
              { key: "d", label: "التاريخ", render: (p) => <span className="text-sm text-muted">{fmtDateTime(p.paidAt ?? p.createdAt)}</span>, hideOnMobile: true },
            ]}
          />
        </div>
      </Panel>
    </div>
  );
}
