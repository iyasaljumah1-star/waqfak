import { z } from "zod";
import { saveFeedback } from "@/server/modules/ai/engine";
import { errorResponse, guard, jsonError, ok } from "@/server/modules/ai/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ id: z.uuid(), value: z.enum(["helpful", "not_helpful"]) });

/** POST /api/ai/feedback {id, value} — only on the caller's own interaction. */
export async function POST(req: Request) {
  const g = await guard(req);
  if (g instanceof Response) return g;
  const p = schema.safeParse(g.body);
  if (!p.success) return jsonError(400, "تقييم غير صالح.");
  try {
    await saveFeedback(g.auth, p.data.id, p.data.value, g.meta);
    return ok({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
