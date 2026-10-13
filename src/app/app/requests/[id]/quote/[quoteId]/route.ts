import { quotePdf } from "@/server/modules/commerce/documents";

export const dynamic = "force-dynamic";

/** GET — quote PDF for the request's parties (unsent drafts: staff only). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string; quoteId: string }> }) {
  const { id, quoteId } = await params;
  return quotePdf(id, quoteId);
}
