import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/authz/context";
import { MfaForm } from "../../forms";

export const metadata: Metadata = { title: "التحقق بخطوتين" };

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!auth.user.mfaEnabled || auth.session.mfaVerified) redirect(next ?? "/app");
  return (
    <>
      <h1 className="font-naskh text-3xl font-bold text-ink">التحقق بخطوتين</h1>
      <p className="mb-6 mt-2 text-muted">افتح تطبيق المصادقة على جوالك وأدخل الرمز الظاهر لحساب وقفك.</p>
      <MfaForm next={next} />
    </>
  );
}
