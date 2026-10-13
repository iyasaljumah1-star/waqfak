import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, ButtonLink, DefinitionList, PageHeader, Panel } from "@/components/ui";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ActionForm } from "@/components/requests/forms";
import { fmtBoth, fmtDate, fmtDateTime, fmtSAR } from "@/lib/utils";
import { requireStaff } from "@/server/authz/context";
import { todayISO } from "@/server/engines/dates";
import { cancelInvoice, recordPayment } from "@/server/modules/billing/actions";
import { INVOICE_KIND_LABEL } from "@/server/modules/commerce/pure";
import { EINVOICE_STATUS_LABEL, INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE, PAYMENT_STATUS_LABEL, PROVIDER_LABEL } from "@/server/modules/billing/access";
import { invoiceView } from "@/server/modules/billing/queries";

export const metadata: Metadata = { title: "فاتورة — المالية" };

export default async function AdminInvoice({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const auth = await requireStaff("admin.finance");
  const v = await invoiceView(auth, invoiceId);
  if (!v) notFound();
  const { inv } = v;
  const payableKind = ["tax_invoice", "non_tax_invoice"].includes(inv.kind);
  const unpaid = payableKind && ["issued", "partially_paid"].includes(inv.status) && v.balance > 0;
  const cancellable = ["issued", "partially_paid", "paid"].includes(inv.status) && inv.kind !== "credit_note";
  const hasPaid = v.paid > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ href: "/admin/finance", label: "الفواتير والمدفوعات" }, { label: inv.number }]}
        title={`${INVOICE_KIND_LABEL[inv.kind as keyof typeof INVOICE_KIND_LABEL] ?? "فاتورة"} ${inv.number}`}
        description={<span className="flex flex-wrap items-center gap-2"><Badge tone={INVOICE_STATUS_TONE[v.status] ?? "neutral"} icon={false}>{INVOICE_STATUS_LABEL[v.status] ?? v.status}</Badge><span>{inv.billedToName}</span></span>}
        actions={<ButtonLink href={`/app/billing/${inv.id}`} variant="secondary" size="sm">نسخة العميل للطباعة</ButtonLink>}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <Panel title="البيانات">
            <DefinitionList items={[
              { label: "المجموع قبل الضريبة", value: <span className="tabular">{fmtSAR(Number(inv.subtotal) - Number(inv.discount))}</span> },
              { label: `الضريبة (${Number(inv.vatRate)}%)`, value: <span className="tabular">{fmtSAR(inv.vat)}</span> },
              { label: "الإجمالي", value: <span className="tabular font-semibold">{fmtSAR(inv.total)}</span> },
              { label: "المدفوع", value: <span className="tabular">{fmtSAR(v.paid)}</span> },
              { label: "المتبقي", value: <span className="tabular">{fmtSAR(v.balance)}</span> },
              { label: "الدفعة", value: inv.installmentLabel ?? "—" },
              { label: "تاريخ الإصدار", value: fmtBoth(inv.issuedOn) },
              { label: "الاستحقاق", value: inv.dueOn ? fmtBoth(inv.dueOn) : "—" },
              { label: "السداد", value: inv.paidOn ? fmtDate(inv.paidOn) : "—" },
              { label: "الطلب", value: v.request ? <Link className="tabular text-ink hover:underline" dir="ltr" href={`/admin/requests/${v.request.id}`}>{v.request.number}</Link> : "—" },
              { label: "الوقف", value: v.waqfName ?? "—" },
              { label: "الفوترة الإلكترونية", value: EINVOICE_STATUS_LABEL[inv.einvoiceStatus] ?? inv.einvoiceStatus },
            ]} />
            <ul className="mt-4 divide-y divide-line border-t border-line text-[15px]">
              {inv.lines.map((l, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2 py-2"><span>{l.description}</span><span className="tabular">{l.qty} × {fmtSAR(l.unit)}</span></li>
              ))}
            </ul>
          </Panel>
          <Panel title="عمليات السداد">
            {v.payments.length ? (
              <ul className="divide-y divide-line">
                {v.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[15px]">
                    <span>{PROVIDER_LABEL[p.provider] ?? p.provider}{p.providerRef ? <span dir="ltr" className="ms-2 text-[12px] text-muted">{p.providerRef}</span> : null}</span>
                    <span className="tabular">{fmtSAR(p.amount)}</span>
                    <Badge tone={p.status === "paid" ? "ok" : p.status === "failed" ? "critical" : "neutral"} icon={false}>{PAYMENT_STATUS_LABEL[p.status] ?? p.status}</Badge>
                    <span className="text-[13px] text-muted">{fmtDateTime(p.paidAt ?? p.createdAt)}</span>
                    {p.receiptNumber ? <a href={`/app/billing/${inv.id}/receipt/${p.id}`} className="text-[13px] text-ink hover:underline">الإيصال <span dir="ltr" className="tabular">{p.receiptNumber}</span></a> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">لا عمليات سداد.</p>}
          </Panel>
        </div>
        <aside className="min-w-0 space-y-4">
          {unpaid ? (
            <Panel title="تسجيل سداد" description="بعد التحقق من وصول المبلغ. يُقبل السداد الجزئي، ويصدر إيصال لكل دفعة.">
              <ActionForm action={recordPayment} hidden={{ invoiceId: inv.id }} submit="سجّل السداد" size="md">
                <Field label="المبلغ (ر.س)" name="amount" required hint={`الرصيد المستحق ${fmtSAR(v.balance)}`}>
                  <Input name="amount" type="number" step="0.01" min="0.01" max={v.balance} required defaultValue={v.balance.toFixed(2)} dir="ltr" className="tabular text-start" />
                </Field>
                <Field label="الطريقة" name="method" required>
                  <Select name="method" defaultValue="transfer" options={[{ value: "transfer", label: "تحويل بنكي" }, { value: "cheque", label: "شيك" }, { value: "cash", label: "نقدًا" }]} />
                </Field>
                <Field label="المرجع" name="reference" required hint="رقم التحويل أو الشيك أو سند القبض.">
                  <Input name="reference" required minLength={4} dir="ltr" className="text-start" />
                </Field>
                <Field label="تاريخ السداد" name="paidOn" required>
                  <Input name="paidOn" type="date" required dir="ltr" max={todayISO()} defaultValue={todayISO()} />
                </Field>
              </ActionForm>
            </Panel>
          ) : null}
          {cancellable ? (
            <Panel title="إلغاء الفاتورة" description={hasPaid ? "على الفاتورة دفعات: تُلغى بإشعار دائن فقط، ويُسجّل رد المبلغ خارج المنصة." : inv.kind === "proforma" ? "الفاتورة الأولية تُلغى مباشرة." : "إلغاء مباشر لفاتورة لم يُسدد منها شيء، أو بإشعار دائن."}>
              <ActionForm action={cancelInvoice} hidden={{ invoiceId: inv.id }} submit="ألغِ الفاتورة" variant="danger" size="md">
                <Field label="الطريقة" name="mode" required>
                  <Select name="mode" required defaultValue={hasPaid ? "credit" : "void"}
                    options={hasPaid ? [{ value: "credit", label: "إشعار دائن" }] : inv.kind === "proforma" ? [{ value: "void", label: "إلغاء مباشر" }] : [{ value: "void", label: "إلغاء مباشر" }, { value: "credit", label: "إشعار دائن" }]} />
                </Field>
                <Field label="السبب" name="reason" required hint="يُسجل في سجل العمليات.">
                  <Textarea name="reason" required minLength={5} className="min-h-20" />
                </Field>
              </ActionForm>
            </Panel>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
