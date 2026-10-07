import { withContext } from "@/server/db";
import { getAuth } from "@/server/authz/context";
import { calendarItems, myComplianceWaqfs } from "@/server/modules/compliance/queries";
import { STATUS_AR, buildIcs } from "@/server/modules/compliance/pure";

export const dynamic = "force-dynamic";

/** GET /app/calendar/ics — the signed-in user's open obligations (all their waqfs) as an iCalendar file. */
export async function GET() {
  const auth = await getAuth();
  if (!auth || (auth.user.mfaEnabled && !auth.session.mfaVerified)) return new Response("سجّل الدخول ثم أعد المحاولة.", { status: 401 });
  const items = await withContext(auth.db, async (tx) => {
    const ws = await myComplianceWaqfs(tx, auth.user.id);
    return calendarItems(tx, ws.map((w) => w.id));
  });
  const app = process.env.APP_URL ?? "";
  const ics = buildIcs(
    items
      .filter((i) => i.dueOn && ["upcoming", "due_soon", "overdue"].includes(i.status))
      .map((i) => ({
        uid: i.id,
        date: i.dueOn!,
        title: `${i.title} — ${i.waqfName}`,
        description: `${STATUS_AR[i.status] ?? i.status}. المرجع: ${i.referenceText}`,
        url: `${app}/app/w/${i.waqfId}/compliance#i-${i.id}`,
      })),
  );
  return new Response(ics, {
    headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'attachment; filename="waqfak-obligations.ics"', "cache-control": "private, no-store" },
  });
}
