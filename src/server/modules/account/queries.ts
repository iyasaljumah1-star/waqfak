import "server-only";
import { and, asc, desc, eq, gt, isNull, like, or } from "drizzle-orm";
import type { Auth } from "../../authz/context";
import {
  auditLogs, consents, dataSubjectRequests, notificationPreferences, notifications, notificationTemplates, serviceRequests, services, sessions,
  waqfMemberships, waqfs,
} from "../../db/schema";
import { decryptNullable } from "../../lib/crypto";
import { read } from "../_shared";

/** National ID is never shown raw: only its presence and last 4 digits. */
export function maskedNationalId(enc: string | null | undefined) {
  const raw = decryptNullable(enc);
  if (!raw) return null;
  return `••••••${raw.slice(-4)}`;
}

export async function securityData(auth: Auth) {
  const [active, events] = await Promise.all([
    read(auth, (tx) =>
      tx
        .select({ id: sessions.id, ip: sessions.ip, userAgent: sessions.userAgent, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, mfaVerified: sessions.mfaVerified })
        .from(sessions)
        .where(and(eq(sessions.userId, auth.user.id), isNull(sessions.revokedAt), gt(sessions.absoluteExpiresAt, new Date()), gt(sessions.idleExpiresAt, new Date())))
        .orderBy(desc(sessions.lastSeenAt)),
    ),
    read(auth, (tx) =>
      tx
        .select({ id: auditLogs.id, at: auditLogs.at, action: auditLogs.action, ip: auditLogs.ip, userAgent: auditLogs.userAgent })
        .from(auditLogs)
        .where(and(eq(auditLogs.actorUserId, auth.user.id), or(like(auditLogs.action, "auth.%"), like(auditLogs.action, "user.%"))))
        .orderBy(desc(auditLogs.id))
        .limit(15),
    ),
  ]);
  return { sessions: active, events };
}

export async function privacyData(auth: Auth) {
  const [cons, dsrs] = await Promise.all([
    read(auth, (tx) => tx.select().from(consents).where(eq(consents.userId, auth.user.id)).orderBy(desc(consents.at))),
    read(auth, (tx) => tx.select().from(dataSubjectRequests).where(eq(dataSubjectRequests.userId, auth.user.id)).orderBy(desc(dataSubjectRequests.requestedAt))),
  ]);
  const latest = new Map<string, (typeof cons)[number]>();
  for (const c of cons) if (!latest.has(c.kind)) latest.set(c.kind, c);
  return { consents: [...latest.values()], history: cons, dsrs };
}

export async function notificationsData(auth: Auth) {
  const [list, templates, prefs] = await Promise.all([
    read(auth, (tx) =>
      tx
        .select()
        .from(notifications)
        .where(eq(notifications.userId, auth.user.id))
        .orderBy(asc(notifications.readAt), desc(notifications.createdAt)) // NULLs (unread) sort last in ASC… handled below
        .limit(100),
    ),
    read(auth, (tx) => tx.select().from(notificationTemplates).orderBy(asc(notificationTemplates.key))),
    read(auth, (tx) => tx.select().from(notificationPreferences).where(eq(notificationPreferences.userId, auth.user.id))),
  ]);
  const unread = list.filter((n) => !n.readAt).sort((a, b) => +b.createdAt - +a.createdAt);
  const readList = list.filter((n) => n.readAt).sort((a, b) => +b.createdAt - +a.createdAt);
  return { unread, read: readList, templates, prefs };
}

/** Everything the platform holds about the signed-in user that the user may receive (PDPL right of access). */
export async function exportMyData(auth: Auth) {
  const u = auth.user;
  const [memberships, cons, notifs, reqs, dsrs, sess] = await Promise.all([
    read(auth, (tx) =>
      tx
        .select({ waqf: waqfs.name, internalNumber: waqfs.internalNumber, role: waqfMemberships.roleKey, status: waqfMemberships.status, startsAt: waqfMemberships.startsAt, endsAt: waqfMemberships.endsAt })
        .from(waqfMemberships)
        .leftJoin(waqfs, eq(waqfs.id, waqfMemberships.waqfId))
        .where(eq(waqfMemberships.userId, u.id)),
    ),
    read(auth, (tx) => tx.select({ kind: consents.kind, version: consents.version, granted: consents.granted, at: consents.at }).from(consents).where(eq(consents.userId, u.id)).orderBy(asc(consents.at))),
    read(auth, (tx) =>
      tx
        .select({ type: notifications.type, title: notifications.titleAr, body: notifications.bodyAr, createdAt: notifications.createdAt, readAt: notifications.readAt })
        .from(notifications)
        .where(eq(notifications.userId, u.id))
        .orderBy(desc(notifications.createdAt)),
    ),
    read(auth, (tx) =>
      tx
        .select({ number: serviceRequests.number, service: services.nameAr, status: serviceRequests.status, details: serviceRequests.details, createdAt: serviceRequests.createdAt, completedAt: serviceRequests.completedAt })
        .from(serviceRequests)
        .leftJoin(services, eq(services.id, serviceRequests.serviceId))
        .where(eq(serviceRequests.requesterUserId, u.id)),
    ),
    read(auth, (tx) =>
      tx
        .select({ kind: dataSubjectRequests.kind, status: dataSubjectRequests.status, details: dataSubjectRequests.details, requestedAt: dataSubjectRequests.requestedAt, completedAt: dataSubjectRequests.completedAt })
        .from(dataSubjectRequests)
        .where(eq(dataSubjectRequests.userId, u.id)),
    ),
    read(auth, (tx) =>
      tx.select({ createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, ip: sessions.ip, userAgent: sessions.userAgent, revokedAt: sessions.revokedAt }).from(sessions).where(eq(sessions.userId, u.id)).orderBy(desc(sessions.createdAt)).limit(50),
    ),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    notice:
      "نسخة من بياناتك الشخصية لدى منصة وقفك وفق نظام حماية البيانات الشخصية. لا تتضمن بيانات الأوقاف نفسها (وهي سجلات الوقف لا سجلاتك الشخصية)، ولا الأسرار الأمنية كبصمة كلمة المرور ومفاتيح التحقق.",
    profile: {
      fullName: u.fullName, phone: u.phone, email: u.email, idType: u.idType, nationalId: maskedNationalId(u.nationalIdEnc), birthDate: u.birthDate,
      locale: u.locale, calendarPref: u.calendarPref, numeralStyle: u.numeralStyle, status: u.status, mfaEnabled: u.mfaEnabled, phoneVerifiedAt: u.phoneVerifiedAt,
      emailVerifiedAt: u.emailVerifiedAt, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt, deletionRequestedAt: u.deletionRequestedAt, residesInKsa: u.residesInKsa,
    },
    memberships,
    consents: cons,
    notifications: notifs,
    serviceRequests: reqs,
    dataSubjectRequests: dsrs,
    sessions: sess,
  };
}
