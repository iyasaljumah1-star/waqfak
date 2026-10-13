import { receiptPdf } from "@/server/modules/commerce/documents";

export const dynamic = "force-dynamic";

/** GET — payment receipt PDF. */
export async function GET(_: Request, { params }: { params: Promise<{ invoiceId: string; paymentId: string }> }) {
  const { invoiceId, paymentId } = await params;
  return receiptPdf(invoiceId, paymentId);
}
