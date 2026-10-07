import { ActionLink } from "@/components/portal/action-link";

export default function PortalNotFound() {
  return (
    <div className="mx-auto max-w-lg py-12 text-center">
      <h1 className="font-naskh text-2xl font-bold text-ink">الصفحة غير موجودة</h1>
      <p className="mt-3 text-muted">قد يكون الرابط قديمًا أو منقوصًا. ابدأ من الرئيسية أو من قائمة أوقافك.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <ActionLink href="/app">الرئيسية</ActionLink>
        <ActionLink href="/app/waqfs" variant="secondary">أوقافي</ActionLink>
      </div>
    </div>
  );
}
