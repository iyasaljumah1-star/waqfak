import { outputPdf } from "@/server/modules/outputs/pdf";

export const dynamic = "force-dynamic";

/** GET — PDF of a version of a service output (team only; drafts carry a «not approved» banner). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; outputId: string }> }) {
  const { id, outputId } = await params;
  const v = Number(new URL(req.url).searchParams.get("v")) || null;
  return outputPdf(id, outputId, v);
}
