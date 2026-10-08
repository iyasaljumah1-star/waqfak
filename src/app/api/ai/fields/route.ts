import { z } from "zod";
import { decideSuggestion } from "@/server/modules/ai/doc-assist";
import { errorResponse, guard, jsonError, ok } from "@/server/modules/ai/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ waqfId: z.uuid(), fieldId: z.uuid(), decision: z.enum(["approve", "reject"]) });

/** POST /api/ai/fields {waqfId, fieldId, decision} — human confirmation of an extracted field (documents.upload). */
export async function POST(req: Request) {
  const g = await guard(req);
  if (g instanceof Response) return g;
  const p = schema.safeParse(g.body);
  if (!p.success) return jsonError(400, "طلب غير صالح.");
  try {
    return ok(await decideSuggestion(g.auth, p.data.waqfId, p.data.fieldId, p.data.decision, g.meta));
  } catch (e) {
    return errorResponse(e);
  }
}
