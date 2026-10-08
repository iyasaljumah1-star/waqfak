import { ActionLink } from "@/components/portal/action-link";

export default function AdminNotFound() {
  return (
    <div className="mx-auto max-w-lg py-12 text-center">
      <h1 className="font-naskh text-2xl font-bold text-ink">لم نجد ما طلبته</h1>
      <p className="mt-3 text-muted">قد يكون السجل حُذف أو أن الرابط منقوص، أو أن صلاحياتك لا تشمله. ابدأ من لوحة الشركة.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <ActionLink href="/admin">لوحة الشركة</ActionLink>
      </div>
    </div>
  );
}
