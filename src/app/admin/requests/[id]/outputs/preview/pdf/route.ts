import { previewPdf } from "@/server/modules/outputs/pdf";

export const dynamic = "force-dynamic";

/** GET — PDF of an output's live preview (no saved draft yet; team only; marked «unsaved preview»). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return previewPdf(id, new URL(req.url).searchParams.get("key") ?? "");
}
