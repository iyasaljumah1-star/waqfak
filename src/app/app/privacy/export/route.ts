import { withContext } from "@/server/db";
import { getAuth } from "@/server/authz/context";
import { audit } from "@/server/lib/audit";
import { requestInfo } from "@/server/lib/request-info";
import { enforceRateLimit, RateLimitError } from "@/server/lib/rate-limit";
import { exportMyData } from "@/server/modules/account/queries";

export const dynamic = "force-dynamic";

/** GET /app/privacy/export — downloads the signed-in user's personal data as JSON (audited). */
export async function GET() {
  const auth = await getAuth();
  if (!auth || (auth.user.mfaEnabled && !auth.session.mfaVerified))
    return Response.json({ error: "سجّل الدخول أولًا." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    await enforceRateLimit(`export:${auth.user.id}`, 10, 3600);
  } catch (e) {
    if (e instanceof RateLimitError) return Response.json({ error: e.message }, { status: 429 });
    throw e;
  }
  const data = await exportMyData(auth);
  const { ip, userAgent } = await requestInfo();
  await withContext(auth.db, (tx) =>
    audit(tx, { actorUserId: auth.user.id, action: "privacy.export_downloaded", entityType: "user", entityId: auth.user.id, ip, userAgent }),
  );
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="waqfak-my-data-${date}.json"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
