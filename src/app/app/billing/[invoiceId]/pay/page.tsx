import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { Alert, PageHeader, Panel } from "@/components/ui";
import { SandboxPayForm } from "@/components/requests/forms";
import { fmtSAR } from "@/lib/utils";
import { requireAuth } from "@/server/authz/context";
import { SANDBOX_CARDS } from "@/server/adapters/payment";
import { confirmSandboxPayment } from "@/server/modules/billing/actions";
import { invoiceView } from "@/server/modules/billing/queries";

export const metadata: Metadata = { title: "الدفع (بيئة تجريبية)" };

export default async function SandboxCheckout({ params, searchParams }: { params: Promise<{ invoiceId: string }>; searchParams: Promise<{ payment?: string }> }) {
  const { invoiceId } = await params;
  const { payment } = await searchParams;
  const auth = await requireAuth({ next: `/app/billing/${invoiceId}` });
  const v = await invoiceView(auth, invoiceId);
  if (!v) notFound();
  if (v.inv.status === "paid") redirect(`/app/billing/${invoiceId}`);
  const p = v.payments.find((x) => x.id === payment && x.provider === "sandbox");
  if (!p || !v.canPay) redirect(`/app/billing/${invoiceId}`);

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <PageHeader crumbs={[{ href: "/app/billing", label: "الفواتير" }, { href: `/app/billing/${invoiceId}`, label: v.inv.number }, { label: "الدفع" }]} title="إتمام الدفع" />
      <div role="note" className="flex gap-3 rounded-lg border-2 border-dashed border-seal bg-seal-soft p-4">
        <FlaskConical aria-hidden className="mt-0.5 size-5 shrink-0 text-seal" />
        <div>
          <p className="font-semibold text-seal">بيئة تجريبية — لا تُخصم أي مبالغ</p>
          <p className="text-[15px]">لم تُربط بوابة دفع مرخصة بعد. استخدم بطاقة اختبار فقط، ولا تُدخل بيانات بطاقتك الحقيقية.</p>
        </div>
      </div>
      {p.status !== "initiated" ? (
        <Alert tone="warn" title="انتهت عملية الدفع هذه" action={<Link href={`/app/billing/${invoiceId}`} className="text-ink underline">عُد للفاتورة</Link>}>ابدأ عملية جديدة من صفحة الفاتورة.</Alert>
      ) : (
        <Panel title={`فاتورة ${v.inv.number}`} description={<span className="tabular">المبلغ: {fmtSAR(v.inv.total)}</span>}>
          <SandboxPayForm action={confirmSandboxPayment} invoiceId={invoiceId} paymentId={p.id}
            cards={[{ label: "بطاقة ناجحة (فيزا)", number: SANDBOX_CARDS.success }, { label: "بطاقة ناجحة (مدى)", number: SANDBOX_CARDS.mada }, { label: "بطاقة مرفوضة", number: SANDBOX_CARDS.declined }]} />
        </Panel>
      )}
    </div>
  );
}
