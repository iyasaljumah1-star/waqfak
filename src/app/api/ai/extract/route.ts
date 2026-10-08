import { z } from "zod";
import { runExtraction } from "@/server/modules/ai/doc-assist";
import { errorResponse, guard, jsonError, ok } from "@/server/modules/ai/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ waqfId: z.uuid(), documentId: z.uuid() });

/** POST /api/ai/extract {waqfId, documentId} → suggested fields (stored as "suggested", never auto-applied). */
export async function POST(req: Request) {
  const g = await guard(req);
  if (g instanceof Response) return g;
  const p = schema.safeParse(g.body);
  if (!p.success) return jsonError(400, "اختر وثيقة أولًا.");
  try {
    return ok(await runExtraction(g.auth, p.data.waqfId, p.data.documentId, g.meta));
  } catch (e) {
    return errorResponse(e);
  }
}
