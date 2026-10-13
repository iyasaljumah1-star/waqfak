import { contractPdf } from "@/server/modules/commerce/documents";

export const dynamic = "force-dynamic";

/** GET — contract PDF with its electronic-signature record (unsent drafts: staff only). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string; contractId: string }> }) {
  const { id, contractId } = await params;
  return contractPdf(id, contractId);
}
