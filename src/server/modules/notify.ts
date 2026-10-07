import "server-only";
import { and, eq } from "drizzle-orm";
import type { Tx } from "../db";
import { withSystem } from "../db";
import { notificationPreferences, notifications, notificationTemplates, users } from "../db/schema";
import { sendEmail, sendSms } from "../adapters/messaging";

function fill(t: string, vars: Record<string, string | number | null | undefined>) {
  return t.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

/**
 * Sends a templated notification to a user through the channels configured for the template,
 * respecting user preferences (critical/security templates cannot be switched off).
 * SMS/email never carry sensitive data: only the title and a link to the platform.
 */
export async function notify(userId: string, key: string, vars: Record<string, string | number | null | undefined>, opts: { waqfId?: string | null; link?: string; tx?: Tx } = {}) {
  const run = async (tx: Tx) => {
    const [tpl] = await tx.select().from(notificationTemplates).where(eq(notificationTemplates.key, key)).limit(1);
    const title = fill(tpl?.titleAr ?? key, vars);
    const body = fill(tpl?.bodyAr ?? "", vars);
    const severity = tpl?.severity ?? "info";
    const channels = new Set(tpl?.channels ?? ["in_app"]);
    const [pref] = await tx.select().from(notificationPreferences).where(and(eq(notificationPreferences.userId, userId), eq(notificationPreferences.type, key))).limit(1);
    if (pref && !tpl?.locked) {
      if (!pref.email) channels.delete("email");
      if (!pref.sms) channels.delete("sms");
    }
    await tx.insert(notifications).values({ userId, waqfId: opts.waqfId ?? null, type: key, severity, titleAr: title, bodyAr: body, link: opts.link ?? null });
    const [u] = await tx.select({ phone: users.phone, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    return { title, channels, u };
  };
  const { title, channels, u } = opts.tx ? await run(opts.tx) : await withSystem(run);
  const link = opts.link ? `${process.env.APP_URL ?? ""}${opts.link}` : process.env.APP_URL ?? "";
  if (u?.email && channels.has("email")) await sendEmail(u.email, title, `${title}\n\nللاطلاع على التفاصيل: ${link}\n\n— وقفك`);
  if (u?.phone && channels.has("sms")) await sendSms(u.phone, `وقفك: ${title}. التفاصيل في المنصة.`);
}
