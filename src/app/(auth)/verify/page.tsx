import type { Metadata } from "next";
import Link from "next/link";
import { getFlow } from "@/server/auth/flow-cookie";
import { maskPhone } from "@/server/auth/otp";
import { VerifyForm } from "../forms";

export const metadata: Metadata = { title: "رمز التحقق" };

export default async function VerifyPage() {
  const flow = await getFlow();
  if (!flow)
    return (
      <div className="space-y-3">
        <h1 className="font-naskh text-3xl font-bold text-ink">انتهت صلاحية الطلب</h1>
        <p className="text-muted">مرّت أكثر من 10 دقائق على الطلب. ابدأ من جديد.</p>
        <Link className="text-ink underline" href="/login">العودة إلى الدخول</Link>
      </div>
    );
  const titles = { signup: "تأكيد رقم الجوال", login: "رمز الدخول", recover: "استعادة الحساب", step_up: "التحقق بخطوتين" } as const;
  return (
    <>
      <h1 className="mb-4 font-naskh text-3xl font-bold text-ink">{titles[flow.purpose]}</h1>
      <VerifyForm maskedTarget={maskPhone(flow.target)} demoCode={flow.demoCode} />
    </>
  );
}
