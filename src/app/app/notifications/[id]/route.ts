import { and, eq, isNull } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { withContext } from "@/server/db";
import { notifications } from "@/server/db/schema";
import { getAuth } from "@/server/authz/context";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Only same-site relative paths are followed (no open redirect through a stored link). */
const safePath = (s: string | null | undefined) => (s && s.startsWith("/") && !s.startsWith("//") && !s.includes("\\") ? s : null);

/** GET /app/notifications/[id] — marks my notification read, then opens its link. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuth();
  const back = new URL("/app/notifications", req.url);
  if (!auth || (auth.user.mfaEnabled && !auth.session.mfaVerified)) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/app/notifications")}`, req.url));
  }
  if (!UUID.test(id)) return NextResponse.redirect(back);
  const row = await withContext(auth.db, async (tx) => {
    const [n] = await tx
      .select({ link: notifications.link, readAt: notifications.readAt })
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, auth.user.id)))
      .limit(1);
    if (n && !n.readAt)
      await tx.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, id), eq(notifications.userId, auth.user.id), isNull(notifications.readAt)));
    return n ?? null;
  });
  const dest = safePath(row?.link);
  return NextResponse.redirect(dest ? new URL(dest, req.url) : back);
}
