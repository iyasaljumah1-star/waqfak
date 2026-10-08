import "server-only";
import { ForbiddenError, getAuth, type Auth } from "@/server/authz/context";
import { env } from "@/server/env";
import { requestInfo } from "@/server/lib/request-info";
import { RateLimitError } from "@/server/lib/rate-limit";
import { jsonError, sameOrigin } from "../documents/http";
import { UserError } from "../_shared";
import { RateLimitedError } from "./engine";

export { jsonError };

/** Shared guard for /api/ai/* JSON endpoints: same-origin, signed-in (MFA satisfied), JSON body within limits. */
export async function guard(req: Request, maxBytes = 8_192): Promise<{ auth: Auth; body: Record<string, unknown>; meta: { ip: string; userAgent: string } } | Response> {
  if (!sameOrigin(req, env.APP_URL)) return jsonError(403, "طلب من مصدر غير موثوق.");
  const auth = await getAuth();
  if (!auth || (auth.user.mfaEnabled && !auth.session.mfaVerified)) return jsonError(401, "سجّل الدخول أولًا ثم أعد المحاولة.");
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes) return jsonError(413, "الطلب أكبر من المسموح.");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "صيغة الطلب غير صحيحة.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "صيغة الطلب غير صحيحة.");
  return { auth, body: body as Record<string, unknown>, meta: await requestInfo() };
}

export function errorResponse(e: unknown): Response {
  if (e instanceof ForbiddenError) return jsonError(403, e.message);
  if (e instanceof RateLimitedError || e instanceof RateLimitError) return jsonError(429, e.message);
  if (e instanceof UserError) return jsonError(400, e.message);
  console.error("[ai]", e);
  return jsonError(500, "تعذر إكمال الطلب. أعد المحاولة، وإن تكررت المشكلة تواصل مع الدعم.");
}

export const ok = (data: unknown) => Response.json(data, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
