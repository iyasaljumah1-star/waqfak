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
    if (!tpl) {
      console.warn(`[notify] template "${key}" not found — notification skipped`);
      return null;
    }
    const title = fill(tpl.titleAr, vars);
    const body = fill(tpl.bodyAr ?? "", vars);
    const severity = tpl?.severity ?? "info";
    const channels = new Set(tpl?.channels ?? ["in_app"]);
    await tx.insert(notifications).values({ userId, waqfId: opts.waqfId ?? null, type: key, severity, titleAr: title, bodyAr: body, link: opts.link ?? null });
    return { title, channels, locked: !!tpl?.locked };
  };
  const res = opts.tx ? await run(opts.tx) : await withSystem(run);
  if (!res) return;
  const { title, channels, locked } = res;
  // stage 11: the recipient's preferences and contact are theirs (and the system's), not the sender's — read on the
  // system login (N10-10: the application role does not read another person's phone or e-mail)
  if (channels.has("email") || channels.has("sms")) {
    const { pref, u } = await withSystem(async (stx) => {
      const [pref] = await stx.select().from(notificationPreferences).where(and(eq(notificationPreferences.userId, userId), eq(notificationPreferences.type, key))).limit(1);
      const [u] = await stx.select({ phone: users.phone, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
      return { pref, u };
    });
    if (pref && !locked) {
      if (!pref.email) channels.delete("email");
      if (!pref.sms) channels.delete("sms");
    }
    return deliver(title, channels, u, opts.link);
  }
}

async function deliver(title: string, channels: Set<string>, u: { phone: string; email: string | null } | undefined, linkPath?: string) {
  const link = linkPath ? `${process.env.APP_URL ?? ""}${linkPath}` : process.env.APP_URL ?? "";
  if (u?.email && channels.has("email")) await sendEmail(u.email, title, `${title}\n\nللاطلاع على التفاصيل: ${link}\n\n— وقفك`);
  if (u?.phone && channels.has("sms")) await sendSms(u.phone, `وقفك: ${title}. التفاصيل في المنصة.`);
}
