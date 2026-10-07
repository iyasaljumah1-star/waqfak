import type { Metadata } from "next";
import Link from "next/link";
import { Badge, DefinitionList, PageHeader, Panel } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { maskPhone } from "@/server/auth/otp";
import { requireAuth } from "@/server/authz/context";
import { maskedNationalId } from "@/server/modules/account/queries";
import { ProfileForm } from "./form";

export const metadata: Metadata = { title: "ملفي الشخصي" };

const ID_TYPE: Record<string, string> = { national_id: "هوية وطنية", iqama: "إقامة", passport: "جواز سفر", gcc_id: "هوية خليجية", cr: "سجل تجاري", other: "أخرى" };

export default async function ProfilePage() {
  const auth = await requireAuth({ next: "/app/profile" });
  const u = auth.user;
  const nid = maskedNationalId(u.nationalIdEnc);
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="ملفي الشخصي" description="بياناتك الأساسية وطريقة عرض التواريخ والأرقام." />
      <Panel title="الهوية والتواصل">
        <DefinitionList
          items={[
            {
              label: "رقم الجوال",
              value: (
                <span className="flex flex-wrap items-center gap-2">
                  <span dir="ltr" className="tabular">{maskPhone(u.phone)}</span>
                  {u.phoneVerifiedAt ? <Badge tone="ok">موثّق</Badge> : null}
                </span>
              ),
              hint: "رقم الجوال هو وسيلة دخولك. لتغييره تواصل مع الدعم للتحقق من هويتك.",
            },
            {
              label: "رقم الهوية",
              value: nid ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span dir="ltr" className="tabular">{nid}</span>
                  <span className="text-sm text-muted">{u.idType ? ID_TYPE[u.idType] : ""}</span>
                </span>
              ) : (
                "لم يُسجَّل"
              ),
              hint: nid ? "محفوظ مشفّرًا ولا يُعرض كاملًا." : "يُطلب عند ربط وقف أو توقيع عقد خدمة.",
            },
            { label: "عضو منذ", value: fmtDate(u.createdAt) },
            { label: "آخر دخول", value: fmtDate(u.lastLoginAt) },
          ]}
        />
      </Panel>
      <Panel title="بياناتي وتفضيلاتي">
        <ProfileForm fullName={u.fullName ?? ""} email={u.email ?? ""} calendarPref={u.calendarPref} numeralStyle={u.numeralStyle} />
      </Panel>
      <p className="text-sm text-muted">
        لطلب نسخة من بياناتك أو تصحيحها أو حذفها انتقل إلى <Link href="/app/privacy" className="text-ink hover:underline">خصوصيتي وبياناتي</Link>.
      </p>
    </div>
  );
}
