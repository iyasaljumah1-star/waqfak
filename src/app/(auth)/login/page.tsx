import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/authz/context";
import { LoginForms } from "../forms";

export const metadata: Metadata = { title: "تسجيل الدخول" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const auth = await getAuth();
  if (auth && (!auth.user.mfaEnabled || auth.session.mfaVerified)) redirect(next ?? (auth.isStaff ? "/admin" : "/app"));
  return (
    <>
      <h1 className="font-naskh text-3xl font-bold text-ink">تسجيل الدخول</h1>
      <p className="mb-6 mt-2 text-muted">ادخل إلى ملفات أوقافك وطلباتك والتزاماتك.</p>
      <LoginForms next={next} />
    </>
  );
}
