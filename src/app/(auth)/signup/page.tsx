import type { Metadata } from "next";
import { SignupForm } from "../forms";

export const metadata: Metadata = { title: "إنشاء حساب" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <>
      <h1 className="font-naskh text-3xl font-bold text-ink">إنشاء حساب</h1>
      <p className="mb-6 mt-2 text-muted">نكتفي الآن بما يلزم للدخول، ونطلب بيانات الهوية لاحقًا عند ربط وقف أو طلب خدمة.</p>
      <SignupForm next={next} />
    </>
  );
}
