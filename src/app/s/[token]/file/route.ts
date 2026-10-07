import { requestInfo } from "@/server/lib/request-info";
import { rateLimit } from "@/server/lib/rate-limit";
import { consumeShare } from "@/server/modules/documents/share";
import { fileResponse } from "@/server/modules/documents/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /s/[token]/file — downloads the shared document (counts one use). */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const { ip } = await requestInfo();
  if (!(await rateLimit(`share:${ip}`, 30, 600))) return new Response("محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.", { status: 429, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  try {
    const r = await consumeShare(token, ip);
    if (!r.file) {
      // back to the page, which explains why the link no longer works
      return new Response(null, { status: 303, headers: { Location: `/s/${encodeURIComponent(token)}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
    }
    return fileResponse(r.file.data, r.file.mime, r.file.name, false);
  } catch (e) {
    console.error("[share.download]", e);
    return new Response("تعذر تنزيل الملف. أعد المحاولة لاحقًا.", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
