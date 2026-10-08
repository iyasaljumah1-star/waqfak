"use client";

import Link from "next/link";
import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { buttonClass } from "@/components/ui";

export default function AdminError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-lg py-12 text-center">
      <h1 className="font-naskh text-2xl font-bold text-ink">تعذّر عرض هذه الصفحة</h1>
      <p className="mt-3 text-muted">
        حدث خطأ غير متوقع أثناء تحميل البيانات، ولم يُحفظ أي تغيير جزئي. أعد المحاولة، وإن تكرر الخطأ فأبلغ فريق التقنية مع رمز المرجع.
      </p>
      {error.digest ? (
        <p className="mt-2 text-sm text-muted">
          رمز المرجع: <span dir="ltr" className="tabular">{error.digest}</span>
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={() => retry()} className={buttonClass("primary")}>
          <RotateCcw aria-hidden className="size-4" />
          أعد المحاولة
        </button>
        <Link href="/admin" className={buttonClass("secondary")}>لوحة الشركة</Link>
      </div>
    </div>
  );
}
