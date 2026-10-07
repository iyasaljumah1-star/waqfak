import type { Metadata } from "next";
import { Monitor, Smartphone } from "lucide-react";
import { Alert, Badge, EmptyState, PageHeader, Panel } from "@/components/ui";
import { AUDIT_ACTION_LABEL } from "@/components/portal/audit-labels";
import { fmtDateTime } from "@/lib/utils";
import { requireAuth } from "@/server/authz/context";
import { securityData } from "@/server/modules/account/queries";
import { MfaPanel, PasswordForm, RevokeOthersButton, RevokeSessionButton } from "./forms";

export const metadata: Metadata = { title: "الأمان والجلسات" };

function device(ua: string | null) {
  const s = ua ?? "";
  const mobile = /Mobile|Android|iPhone|iPad/i.test(s);
  const os = /iPhone|iPad|iOS/i.test(s) ? "iOS" : /Android/i.test(s) ? "Android" : /Windows/i.test(s) ? "Windows" : /Mac OS X|Macintosh/i.test(s) ? "macOS" : /Linux/i.test(s) ? "Linux" : null;
  const browser = /Edg\//.test(s) ? "Edge" : /Chrome\//.test(s) ? "Chrome" : /Firefox\//.test(s) ? "Firefox" : /Safari\//.test(s) ? "Safari" : null;
  return { mobile, label: [browser, os].filter(Boolean).join(" على ") || "جهاز غير معروف" };
}

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ enforce?: string; recovered?: string }> }) {
  const sp = await searchParams;
  const auth = await requireAuth({ next: "/app/security" });
  const { sessions, events } = await securityData(auth);
  const others = sessions.filter((s) => s.id !== auth.session.id).length;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="الأمان والجلسات" description="طرق الدخول إلى حسابك، والأجهزة المفتوحة عليه الآن، وآخر الأحداث الأمنية." />
      {sp.enforce === "staff" && !auth.user.mfaEnabled ? (
        <Alert tone="warn" title="فعّل التحقق بخطوتين قبل دخول لوحة الإدارة">
          لوحة الإدارة تصل إلى بيانات أوقاف العملاء، لذلك يلزم كل موظف تفعيل تطبيق المصادقة. فعّله أدناه ثم عد إلى لوحة الإدارة.
        </Alert>
      ) : null}
      {sp.recovered ? (
        <Alert tone="info" title="استعدت حسابك">أنهينا كل الجلسات السابقة. راجع طرق الدخول أدناه، وغيّر كلمة المرور إن كنت تشك في تسرّبها.</Alert>
      ) : null}

      <Panel title="التحقق بخطوتين" description="تطبيق مصادقة على جوالك يولّد رمزًا يتغير كل 30 ثانية.">
        <MfaPanel enabled={auth.user.mfaEnabled} isStaff={auth.isStaff} />
      </Panel>

      <Panel title="كلمة المرور" description={auth.user.passwordHash ? "للدخول بالبريد وكلمة المرور، ثم عامل ثانٍ." : "الدخول الآن برمز الجوال فقط. عيّن كلمة مرور إن أردت الدخول بالبريد أيضًا."}>
        <PasswordForm hasPassword={!!auth.user.passwordHash} hasEmail={!!auth.user.email} />
      </Panel>

      <Panel title="الجلسات المفتوحة" description="أنهِ أي جلسة لا تعرفها، ثم غيّر بيانات الدخول." actions={others ? <RevokeOthersButton /> : null} tight>
        {sessions.length ? (
          <ul className="divide-y divide-line">
            {sessions.map((s) => {
              const d = device(s.userAgent);
              const current = s.id === auth.session.id;
              const Icon = d.mobile ? Smartphone : Monitor;
              return (
                <li key={s.id} className="flex items-start gap-3 px-4 py-3 md:px-5">
                  <Icon aria-hidden className="mt-1 size-5 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {d.label}
                      {current ? <Badge tone="ok" icon={false}>هذا الجهاز</Badge> : null}
                    </p>
                    <p className="text-[13px] text-muted">
                      <span dir="ltr" className="tabular">{s.ip ?? "—"}</span> · آخر نشاط {fmtDateTime(s.lastSeenAt)} · بدأت {fmtDateTime(s.createdAt)}
                    </p>
                  </div>
                  {current ? null : <RevokeSessionButton sessionId={s.id} />}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="p-4"><EmptyState title="لا جلسات مفتوحة" /></div>
        )}
      </Panel>

      <Panel title="آخر الأحداث الأمنية" tight>
        {events.length ? (
          <ul className="divide-y divide-line">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2.5 md:px-5">
                <span className="font-medium">{AUDIT_ACTION_LABEL[e.action] ?? e.action}</span>
                <span className="text-[13px] text-muted">
                  {fmtDateTime(e.at)} · <span dir="ltr" className="tabular">{e.ip ?? "—"}</span> · {device(e.userAgent).label}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-4"><EmptyState title="لا أحداث أمنية مسجّلة بعد" /></div>
        )}
      </Panel>
    </div>
  );
}
