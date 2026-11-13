import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "../db";
import { withSystem } from "../db";
import { notificationPreferences, users } from "../db/schema";
import { sendEmail, sendSms } from "../adapters/messaging";

/**
 * Sends a templated notification to a user through the channels configured for the template,
 * respecting user preferences (critical/security templates cannot be switched off).
 * SMS/email never carry sensitive data: only the title and a link to the platform.
 */
export async function notify(userId: string, key: string, vars: Record<string, string | number | null | undefined>, opts: { waqfId?: string | null; link?: string; tx?: Tx } = {}) {
  // stage 11.1 (S11-9): through the database's app_notify — the template's own title, text and severity, a link inside
  // the platform, a recipient related to the sender (oneself, the team, a person of the same waqf); anything else is
  // not written (and the application role cannot write another person's notification directly)
  const run = async (tx: Tx) => {
    const r = await tx.execute<{ title: string; channels: string[] | null; locked: boolean }>(
      sql`select * from app_notify(${userId}::uuid, ${key}, ${JSON.stringify(Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v == null ? "" : String(v)])))}::jsonb, ${opts.waqfId ?? null}::uuid, ${opts.link || null})`,
    );
    const row = r.rows[0];
    if (!row) {
      console.warn(`[notify] "${key}" not written (no template, or the recipient is not related to the sender)`);
      return null;
    }
    return { title: row.title, channels: new Set(row.channels ?? ["in_app"]), locked: !!row.locked };
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
