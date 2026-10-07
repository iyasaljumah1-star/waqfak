import type { Metadata } from "next";
import { RecoverForm } from "../forms";

export const metadata: Metadata = { title: "استعادة الحساب" };

export default function RecoverPage() {
  return (
    <>
      <h1 className="font-naskh text-3xl font-bold text-ink">استعادة الحساب</h1>
      <p className="mb-6 mt-2 text-muted">أدخل رقم جوالك المسجّل، وسنرسل إليك رمزًا لاستعادة الدخول.</p>
      <RecoverForm />
    </>
  );
}
