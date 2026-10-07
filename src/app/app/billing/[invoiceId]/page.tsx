import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, PageHeader } from "@/components/ui";
import { ActionForm, PrintButton } from "@/components/requests/forms";
import { fmtBoth, fmtDate, fmtDateTime, fmtSAR } from "@/lib/utils";
import { requireAuth } from "@/server/authz/context";
import { startCheckout } from "@/server/modules/billing/actions";
import { INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE, PAYMENT_STATUS_LABEL, PROVIDER_LABEL } from "@/server/modules/billing/access";
import { invoiceView } from "@/server/modules/billing/queries";

export const metadata: Metadata = { title: "فاتورة" };

const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 14mm; }
  .invoice-sheet { border: 0 !important; box-shadow: none !important; padding: 0 !important; }
  .invoice-sheet table th, .invoice-sheet table td { border-color: #999 !important; }
  main, #main { padding: 0 !important; }
}`;

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ invoiceId: string }>; searchParams: Promise<{ paid?: string }> }) {
  const { invoiceId } = await params;
  const { paid } = await searchParams;
  const auth = await requireAuth({ next: `/app/billing/${invoiceId}` });
  const v = await invoiceView(auth, invoiceId);
  if (!v) notFound();
  const { inv, company } = v;
  const credit = inv.status === "credit_note";
  const payable = (v.status === "issued" || v.status === "overdue") && v.canPay;

  return (
    <div className="space-y-6">
      <style>{PRINT_CSS}</style>
      <div className="no-print">
        <PageHeader
          crumbs={[{ href: "/app/billing", label: "الفواتير" }, { label: inv.number }]}
          title={credit ? "إشعار دائن" : "فاتورة ضريبية"}
          description={<span className="flex flex-wrap items-center gap-2"><span dir="ltr" className="tabular">{inv.number}</span><Badge tone={INVOICE_STATUS_TONE[v.status] ?? "neutral"} icon={false}>{INVOICE_STATUS_LABEL[v.status] ?? v.status}</Badge></span>}
          actions={
            <>
              <PrintButton label="اطبع أو احفظ PDF" />
              {v.request ? <Link href={`/app/requests/${v.request.id}`} className="inline-flex h-8 items-center rounded-md px-3 text-sm text-ink hover:bg-ink-soft">الطلب {v.request.number}</Link> : null}
            </>
          }
        />
        {paid ? <Alert tone="ok" title="تم السداد" className="mb-4">سُجلت الدفعة وأصبحت الفاتورة مدفوعة. شكرًا لك.</Alert> : null}
        {payable ? (
          <div className="mb-4 flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">المستحق: <span className="tabular">{fmtSAR(inv.total)}</span></p>
              <p className="text-sm text-muted">تاريخ الاستحقاق {fmtBoth(inv.dueOn)}. {v.liveOn ? "" : "الدفع الإلكتروني في وضع تجريبي حاليًا."}</p>
            </div>
            <ActionForm action={startCheckout} hidden={{ invoiceId: inv.id }} submit="ادفع الآن" pendingText="جارٍ التحويل…" inline />
          </div>
        ) : null}
      </div>

      <article className="invoice-sheet mx-auto max-w-3xl rounded-lg border border-line bg-surface p-5 text-[15px] md:p-8" aria-label={`فاتورة ${inv.number}`}>
        <header className="flex flex-col gap-4 border-b border-line pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="font-naskh text-2xl font-bold text-ink">{v.sellerName}</p>
            <p className="text-[13px] text-muted">{company.legalForm ?? ""}</p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
              <dt className="text-muted">الرقم الضريبي</dt><dd className="tabular" dir={v.vatNumber ? "ltr" : undefined}>{v.vatNumber || "قيد التسجيل"}</dd>
              <dt className="text-muted">السجل التجاري</dt><dd className="tabular">{company.crNumber || "—"}</dd>
              {company.nationalAddress ? <><dt className="text-muted">العنوان</dt><dd>{company.nationalAddress}</dd></> : null}
            </dl>
          </div>
          <div className="text-start sm:text-end">
            <p className="text-lg font-semibold">{credit ? "إشعار دائن" : "فاتورة ضريبية مبسطة"}</p>
            <p className="text-[13px] text-muted">Simplified Tax Invoice</p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px] sm:justify-end">
              <dt className="text-muted">الرقم</dt><dd className="tabular" dir="ltr">{inv.number}</dd>
              <dt className="text-muted">تاريخ الإصدار</dt><dd>{fmtDate(inv.issuedOn)}</dd>
              {inv.dueOn ? <><dt className="text-muted">الاستحقاق</dt><dd>{fmtDate(inv.dueOn)}</dd></> : null}
            </dl>
          </div>
        </header>

        <section className="grid gap-4 border-b border-line py-4 sm:grid-cols-[1fr_auto]">
          <div>
            <p className="text-[13px] text-muted">العميل</p>
            <p className="font-medium">{inv.billedToName}</p>
            {v.waqfName && v.waqfName !== inv.billedToName ? <p className="text-[13px] text-muted">{v.waqfName}</p> : null}
            {v.request ? <p className="text-[13px] text-muted">مرجع الطلب: <span dir="ltr" className="tabular">{v.request.number}</span></p> : null}
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={v.qr} alt="رمز الاستجابة السريعة للفاتورة الضريبية (بيانات البائع والضريبة والإجمالي)" width={132} height={132} className="size-[132px] justify-self-start rounded border border-line bg-white p-1 sm:justify-self-end" />
        </section>

        <div className="overflow-x-auto">
          <table className="mt-4 w-full border-collapse text-[14px]">
            <caption className="sr-only">بنود الفاتورة</caption>
            <thead>
              <tr className="border-b border-line-strong text-[13px] text-muted">
                <th scope="col" className="py-2 text-start font-medium">البيان</th>
                <th scope="col" className="w-14 py-2 text-center font-medium">الكمية</th>
                <th scope="col" className="w-28 py-2 text-end font-medium">سعر الوحدة</th>
                <th scope="col" className="w-28 py-2 text-end font-medium">المبلغ</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l, i) => (
                <tr key={i} className="border-b border-line align-top">
                  <td className="py-2 pe-2">{l.description}</td>
                  <td className="tabular py-2 text-center">{l.qty}</td>
                  <td className="tabular py-2 text-end">{fmtSAR(l.unit)}</td>
                  <td className="tabular py-2 text-end">{fmtSAR(l.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="ms-auto mt-4 grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1">
          <dt className="text-muted">المجموع قبل الضريبة</dt><dd className="tabular text-end">{fmtSAR(Number(inv.subtotal) - Number(inv.discount))}</dd>
          {Number(inv.discount) ? <><dt className="text-muted">الخصم</dt><dd className="tabular text-end">{fmtSAR(inv.discount)}</dd></> : null}
          <dt className="text-muted">ضريبة القيمة المضافة ({Number(inv.vatRate)}%)</dt><dd className="tabular text-end">{fmtSAR(inv.vat)}</dd>
          <dt className="border-t border-line-strong pt-1 font-semibold">الإجمالي شامل الضريبة</dt><dd className="tabular border-t border-line-strong pt-1 text-end font-semibold">{fmtSAR(inv.total)}</dd>
        </dl>

        <footer className="mt-6 space-y-1 border-t border-line pt-3 text-[12px] text-muted">
          {inv.einvoiceStatus === "not_submitted" ? (
            <p>لم تُرسل هذه الفاتورة إلى منصة الفوترة الإلكترونية (فاتورة) بعد؛ الربط مع هيئة الزكاة والضريبة والجمارك بانتظار استكمال التسجيل.</p>
          ) : <p>حالة الفوترة الإلكترونية: {inv.einvoiceStatus}</p>}
          {!v.vatNumber ? <p>الرقم الضريبي للشركة قيد التسجيل.</p> : null}
          {inv.status === "paid" ? <p>سُددت بتاريخ {fmtDate(inv.paidOn)}.</p> : null}
        </footer>
      </article>

      {v.payments.length ? (
        <section className="no-print mx-auto max-w-3xl">
          <h2 className="mb-2 font-semibold">عمليات السداد</h2>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {v.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-[15px]">
                <span>{PROVIDER_LABEL[p.provider] ?? p.provider}{p.providerRef ? <span dir="ltr" className="ms-2 text-[12px] text-muted">{p.providerRef}</span> : null}</span>
                <span className="tabular">{fmtSAR(p.amount)}</span>
                <Badge tone={p.status === "paid" ? "ok" : p.status === "failed" ? "critical" : "neutral"} icon={false}>{PAYMENT_STATUS_LABEL[p.status] ?? p.status}</Badge>
                <span className="text-[13px] text-muted">{fmtDateTime(p.paidAt ?? p.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
