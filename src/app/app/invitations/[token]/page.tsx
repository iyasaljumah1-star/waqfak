import type { Metadata } from "next";
import Link from "next/link";
import { Seal } from "@/components/brand";
import { Alert } from "@/components/ui";
import { ActionLink } from "@/components/portal/action-link";
import { fmtBoth, fmtDate } from "@/lib/utils";
import { maskPhone } from "@/server/auth/otp";
import { getAuth } from "@/server/authz/context";
import { roleName } from "@/server/authz/catalog";
import { logout } from "@/server/modules/auth.actions";
import { invitationByToken } from "@/server/modules/waqf-core/queries";
import { InvitationActions } from "./forms";

export const metadata: Metadata = { title: "دعوة إلى ملف وقف", robots: { index: false } };

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl">
      <div className="deed-paper rounded-lg border border-line px-5 py-8 md:px-10">
        <Seal className="mb-4 size-12 text-seal" />
        {children}
      </div>
    </div>
  );
}

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await invitationByToken(token);
  const auth = await getAuth();
  const here = `/app/invitations/${token}`;

  if (!inv)
    return (
      <Frame>
        <h1 className="font-naskh text-2xl font-bold text-ink">رابط الدعوة غير صحيح</h1>
        <p className="mt-2 text-muted">تأكد من نسخ الرابط كاملًا من الرسالة. إن استمرت المشكلة فاطلب من ناظر الوقف دعوة جديدة.</p>
      </Frame>
    );

  const declined = !!(inv.scope && "declinedAt" in inv.scope);
  const closed = inv.acceptedAt
    ? { title: "استُخدمت هذه الدعوة", text: `قُبلت في ${fmtDate(inv.acceptedAt)}. إن كنت صاحبها فستجد الوقف في «أوقافي».` }
    : inv.revokedAt
      ? { title: declined ? "اعتذرت عن هذه الدعوة" : "أُلغيت هذه الدعوة", text: "اطلب من ناظر الوقف دعوة جديدة إن احتجت الوصول." }
      : inv.expiresAt < new Date()
        ? { title: "انتهت صلاحية الدعوة", text: `انتهت في ${fmtDate(inv.expiresAt)}. الدعوات صالحة 7 أيام؛ اطلب من ناظر الوقف إرسال دعوة جديدة.` }
        : null;

  const agentTerms = inv.roleKey === "agent" ? (inv.scope as { validFrom?: string; validTo?: string; poaNo?: string } | null) : null;

  return (
    <Frame>
      <p className="text-sm text-muted">دعوة للانضمام إلى ملف وقف</p>
      <h1 className="mt-1 font-naskh text-[1.75rem] font-bold leading-snug text-ink">{inv.waqfName}</h1>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-[13px] text-muted">بصفة</dt>
          <dd className="font-semibold">{roleName(inv.roleKey)}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-muted">من</dt>
          <dd>{inv.inviter ?? "ناظر الوقف"}</dd>
        </div>
        {agentTerms?.validTo ? (
          <div className="sm:col-span-2">
            <dt className="text-[13px] text-muted">الوكالة</dt>
            <dd>
              رقم <span dir="ltr" className="tabular">{agentTerms.poaNo}</span>، من {fmtBoth(agentTerms.validFrom)} إلى {fmtBoth(agentTerms.validTo)}
            </dd>
          </div>
        ) : null}
      </dl>
      {inv.note ? <blockquote className="naskh mt-4 border-s-2 border-seal ps-3 text-muted">{inv.note}</blockquote> : null}

      <div className="mt-6 border-t border-line pt-5">
        {closed ? (
          <Alert tone="info" title={closed.title}>{closed.text}</Alert>
        ) : !auth ? (
          <div className="space-y-3">
            <p>الدعوة مرسلة إلى الرقم <span dir="ltr" className="tabular font-medium">{maskPhone(inv.phone)}</span>. ادخل بهذا الرقم لقبولها، أو أنشئ حسابًا به إن لم يكن لديك حساب.</p>
            <div className="flex flex-wrap gap-2">
              <ActionLink href={`/login?next=${encodeURIComponent(here)}`}>سجّل الدخول</ActionLink>
              <ActionLink variant="secondary" href={`/signup?next=${encodeURIComponent(here)}`}>أنشئ حسابًا</ActionLink>
            </div>
          </div>
        ) : auth.user.mfaEnabled && !auth.session.mfaVerified ? (
          <ActionLink href={`/login/mfa?next=${encodeURIComponent(here)}`}>أكمل التحقق بخطوتين للمتابعة</ActionLink>
        ) : auth.user.phone !== inv.phone ? (
          <Alert tone="warn" title="الدعوة لرقم آخر">
            <p>
              أنت داخل بالرقم <span dir="ltr" className="tabular">{maskPhone(auth.user.phone)}</span>، والدعوة مرسلة إلى <span dir="ltr" className="tabular">{maskPhone(inv.phone)}</span>. اخرج ثم ادخل بالرقم المدعو.
            </p>
            <form action={logout} className="mt-2">
              <button type="submit" className="text-ink underline-offset-4 hover:underline">الخروج من هذا الحساب</button>
            </form>
          </Alert>
        ) : (
          <div className="space-y-3">
            <p className="text-[15px] text-muted">
              بالقبول يُفتح لك ملف الوقف بصلاحيات دور «{roleName(inv.roleKey)}». يُسجَّل القبول في سجل عمليات الوقف، ويمكن للناظر إنهاء العضوية لاحقًا.
            </p>
            <InvitationActions token={token} />
          </div>
        )}
      </div>
      {auth ? (
        <p className="mt-6 text-sm"><Link href="/app" className="text-muted hover:underline">العودة إلى الرئيسية</Link></p>
      ) : null}
    </Frame>
  );
}
