"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ShieldCheck, ShieldX } from "lucide-react";
import { SubmitButton } from "@/components/ui/form";
import { fmtNumber } from "@/lib/utils";
import { verifyAuditChain } from "@/server/modules/admin/audit/actions";

type Report = { total: number; verified: number; unverifiable: number; forks: number; brokenCount: number; ms: number; firstBroken: { id: number; at: string; action: string; kind: "link" | "content" } | null };

export function AuditVerify() {
  const [s, action] = useActionState(verifyAuditChain, {});
  const r = s.data as Report | undefined;
  return (
    <form action={action} className="space-y-3">
      <SubmitButton variant="secondary" pendingText="جارٍ إعادة حساب السلسلة…">
        <ShieldCheck aria-hidden className="size-4" />
        تحقق من سلامة السجل
      </SubmitButton>
      {r ? (
        <div role="status" className={r.firstBroken ? "rounded-lg bg-critical-soft p-4 text-critical" : "rounded-lg bg-ok-soft p-4 text-ok"}>
          <p className="flex items-center gap-2 font-semibold">
            {r.firstBroken ? <ShieldX aria-hidden className="size-5" /> : <ShieldCheck aria-hidden className="size-5" />}
            {r.firstBroken ? "السلسلة مكسورة" : "السجل سليم: لا روابط مقطوعة ولا محتوى معدّل"}
          </p>
          {r.firstBroken ? (
            <p className="mt-1 text-text">
              أول خلل عند{" "}
              <Link href={`/admin/audit/${r.firstBroken.id}`} className="font-semibold underline">السجل رقم {r.firstBroken.id}</Link>
              {" — "}
              {r.firstBroken.kind === "link" ? "يشير إلى سجل سابق غير موجود (حُذف سجل أو عُدّل)." : "محتواه لا يطابق بصمته (عُدّل بعد كتابته)."}
              {r.brokenCount > 1 ? ` وعدد السجلات المختلة ${fmtNumber(r.brokenCount)}.` : ""}
            </p>
          ) : null}
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[14px] text-text sm:grid-cols-4">
            <div><dt className="text-muted">السجلات المفحوصة</dt><dd className="tabular font-medium">{fmtNumber(r.total)}</dd></div>
            <div><dt className="text-muted">تطابقت بصمتها</dt><dd className="tabular font-medium">{fmtNumber(r.verified)}</dd></div>
            <div><dt className="text-muted">ترابطها سليم ومحتواها غير قابل لإعادة الحساب</dt><dd className="tabular font-medium">{fmtNumber(r.unverifiable)}</dd></div>
            <div><dt className="text-muted">المدة</dt><dd className="tabular font-medium">{fmtNumber(r.ms)} ملي ثانية</dd></div>
          </dl>
          {r.unverifiable || r.forks ? (
            <p className="mt-2 text-[13px] text-muted">
              {r.unverifiable ? `${fmtNumber(r.unverifiable)} سجلًا يحوي كائنات لا تحفظ قاعدة البيانات ترتيب مفاتيحها، فيُتحقق من ترابطها لا من بصمة محتواها. ` : ""}
              {r.forks ? `${fmtNumber(r.forks)} سجلًا يرتبط بسجل أقدم من سابقه المباشر بسبب عزل البيانات بين الأوقاف؛ هذا ترابط صحيح وليس خللًا.` : ""}
            </p>
          ) : null}
        </div>
      ) : s.error ? (
        <p role="alert" className="text-critical">{s.error}</p>
      ) : null}
    </form>
  );
}
