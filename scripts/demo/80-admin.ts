/**
 * Demo data for the admin panel (fictional, marked "(تجريبي)"): contact messages, a pending data-subject request,
 * one suspicion report and two screening results in the restricted schema.
 * Idempotent: skips rows that already exist (matched by marker text).
 */
import { and, eq, like, sql } from "drizzle-orm";
import type { Tx } from "../../src/server/db";
import * as s from "../../src/server/db/schema";
import { encryptString } from "../../src/server/lib/crypto";
import type { DemoCtx } from "../seed-demo";

const MARK = "(تجريبي)";

export default async function adminDemo(tx: Tx, ctx: DemoCtx) {
  const existing = await tx.select({ id: s.contactMessages.id }).from(s.contactMessages).where(like(s.contactMessages.name, `%${MARK}%`)).limit(1);
  if (!existing.length) {
    await tx.insert(s.contactMessages).values([
      { name: `منيرة السبيعي ${MARK}`, email: "munira@example.test", topic: "استفسار عن تأسيس وقف", body: "أرغب في وقف عقار سكني على أولادي ثم على جهة خيرية. ما الخطوات والمدة المتوقعة؟", status: "new" },
      { name: `جمعية البر ${MARK}`, phone: "+966555009001", topic: "خدمات المنشآت", body: "نحتاج مراجعة حوكمة الأوقاف التي نديرها (ثلاثة أوقاف). هل لديكم باقة للجهات؟", status: "new" },
      { name: `ناصر الدوسري ${MARK}`, email: "nasser@example.test", topic: "مشكلة في الدخول", body: "لا يصلني رمز التحقق على جوالي.", status: "handled", handledBy: ctx.users.ops },
    ]);
  }

  const dsr = await tx.select({ id: s.dataSubjectRequests.id }).from(s.dataSubjectRequests).where(and(eq(s.dataSubjectRequests.userId, ctx.users.outsider), eq(s.dataSubjectRequests.kind, "correct"))).limit(1);
  if (!dsr.length) {
    await tx.insert(s.dataSubjectRequests).values({
      userId: ctx.users.outsider, kind: "correct", details: `اسمي مكتوب خطأ في الحساب ${MARK}. الصحيح: «عبدالرحمن» لا «عبد الرحمن».`,
      requestedAt: new Date(Date.now() - 26 * 86_400_000), dueAt: new Date(Date.now() + 4 * 86_400_000),
    });
  }

  const [wc] = await tx.select({ number: s.waqfs.internalNumber, name: s.waqfs.name }).from(s.waqfs).where(eq(s.waqfs.id, ctx.waqfs.C)).limit(1);
  const [wa] = await tx.select({ number: s.waqfs.internalNumber, name: s.waqfs.name }).from(s.waqfs).where(eq(s.waqfs.id, ctx.waqfs.A)).limit(1);
  // Restricted schema: only role waqfak_mlro holds grants on it.
  await tx.execute(sql`set local role waqfak_mlro`);
  const [has] = await tx.select({ id: s.suspicionReports.id }).from(s.suspicionReports).limit(1);
  if (!has) {
    await tx.insert(s.suspicionReports).values({
      waqfId: ctx.waqfs.C,
      createdBy: ctx.users.mlro,
      summaryEnc: encryptString(JSON.stringify({
        v: 2,
        summary: `${MARK} تبرعات نقدية متكررة بمبالغ متقاربة دون حد الإفصاح خلال شهر واحد، من مصدر لم يُتحقق منه، ثم طلب صرف عاجل لجهة خارج المملكة.`,
        waqfNumber: wc?.number ?? null, waqfName: wc?.name ?? null,
        indicators: ["structuring", "foreign_party"],
        timeline: [{ at: new Date().toISOString(), by: ctx.users.mlro, byName: "مسؤول الالتزام (تجريبي)", text: "فُتح البلاغ للمراجعة الداخلية.", status: "internal_review" }],
      })),
    });
    await tx.insert(s.screeningResults).values([
      { subjectType: "waqf", subjectId: ctx.waqfs.A, provider: "فحص يدوي لقوائم العقوبات", status: "clear", detailsEnc: encryptString(JSON.stringify({ label: wa ? `${wa.number} — ${wa.name}` : "الوقف أ", notes: MARK })), reviewedBy: ctx.users.mlro, decision: "cleared" },
      { subjectType: "user", subjectId: ctx.users.member2, provider: "فحص يدوي لقوائم العقوبات", status: "potential_match", detailsEnc: encryptString(JSON.stringify({ label: "عضو مستقل تجريبي — خالد", notes: `تشابه اسم جزئي ${MARK}` })) },
    ]);
  }
  await tx.execute(sql`reset role`);
}
