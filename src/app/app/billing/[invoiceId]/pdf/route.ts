import { invoicePdf } from "@/server/modules/commerce/documents";

export const dynamic = "force-dynamic";

/** GET — invoice / proforma / credit note PDF, rendered from the data frozen on the invoice. */
export async function GET(_: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  return invoicePdf(invoiceId);
}
