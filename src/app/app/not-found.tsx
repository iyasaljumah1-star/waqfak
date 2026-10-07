import Link from "next/link";
import { buttonClass } from "@/components/ui";

export default function PortalNotFound() {
  return (
    <div className="mx-auto max-w-lg py-12 text-center">
      <h1 className="font-naskh text-2xl font-bold text-ink">الصفحة غير موجودة</h1>
      <p className="mt-3 text-muted">قد يكون الرابط قديمًا أو منقوصًا. ابدأ من الرئيسية أو من قائمة أوقافك.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link href="/app" className={buttonClass("primary")}>الرئيسية</Link>
        <Link href="/app/waqfs" className={buttonClass("secondary")}>أوقافي</Link>
      </div>
    </div>
  );
}
