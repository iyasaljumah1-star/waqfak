import { z } from "zod";
import { ask, MAX_QUESTION } from "@/server/modules/ai/engine";
import { errorResponse, guard, jsonError, ok } from "@/server/modules/ai/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ waqfId: z.uuid(), question: z.string().trim().min(2).max(MAX_QUESTION) });

/** POST /api/ai/ask {waqfId, question} → AskResult. Auth required; `ai.use` on the waqf is checked under RLS. */
export async function POST(req: Request) {
  const g = await guard(req);
  if (g instanceof Response) return g;
  const p = schema.safeParse(g.body);
  if (!p.success) return jsonError(400, p.error.issues.some((i) => i.path[0] === "question") ? `اكتب سؤالًا من حرفين إلى ${MAX_QUESTION} حرف.` : "الوقف غير محدد.");
  try {
    return ok(await ask(g.auth, p.data.waqfId, p.data.question, g.meta));
  } catch (e) {
    return errorResponse(e);
  }
}
