import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

/**
 * What an assessment's owner sees until its result is approved (owner's decision of 2026-11-01, item 1): that the
 * answers were received, under which number, and that the result appears here once approved — no score, no flag, no
 * recommendation before then.
 */
export function AssessmentPending({ number, signedIn }: { number: string; signedIn: boolean }) {
  return (
    <section className="mx-auto max-w-2xl rounded-lg border border-line bg-surface p-6" data-testid="assessment-pending">
      <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
        <CheckCircle2 aria-hidden className="size-6 text-ok" />
        تم استلام تقييمك بنجاح
      </h1>
      <p className="mt-3 text-[15px] text-ink">رقم التقييم: <span dir="ltr" className="font-medium">{number}</span></p>
      <p className="mt-2 text-[15px] text-muted">نتيجة التقييم قيد المراجعة والاعتماد النهائي. تظهر هنا بعد اعتمادها{signedIn ? "، ونشعرك بذلك." : "."}</p>
      {!signedIn ? <p className="mt-2 text-[14px] text-muted">احتفظ برابط هذه الصفحة، أو <Link href="/signup" className="underline">أنشئ حسابًا</Link> لتجد التقييم في حسابك.</p> : null}
      <p className="mt-4 text-[14px] text-muted">للتعرف على محاور التقييم ومعاييره دون انتظار النتيجة، اطّلع على <Link href="/library" className="underline">المكتبة</Link>.</p>
    </section>
  );
}
