import Link from "next/link";
import { Seal } from "@/components/brand";
import { buttonClass } from "@/components/ui";

/** 404 body: a blank deed. Used by the global and the site not-found pages. */
export function NotFoundBody() {
  return (
    <div className="bg-stone">
      <div className="mx-auto grid max-w-3xl gap-8 px-4 py-16 md:py-24">
        <div className="deed-paper relative rounded-sm border border-line-strong px-6 py-[35px] shadow-card sm:px-10">
          <p className="text-[14px] leading-[35px] text-muted">خطأ 404</p>
          <h1 className="font-naskh text-[1.9rem] font-bold leading-[70px] text-ink md:text-[2.3rem]">لم نجد هذه الصفحة</h1>
          <p className="max-w-lg text-[16px] leading-[35px]">ربما تغيّر عنوانها أو نُقلت، أو في الرابط خطأ إملائي. جرّب إحدى هذه الوجهات:</p>
          <ul className="mt-[35px] text-[16px] leading-[35px]">
            <li><Link href="/" className="font-medium text-ink underline underline-offset-4">الصفحة الرئيسية</Link></li>
            <li><Link href="/services" className="font-medium text-ink underline underline-offset-4">الخدمات</Link></li>
            <li><Link href="/library" className="font-medium text-ink underline underline-offset-4">المكتبة</Link></li>
            <li><Link href="/contact" className="font-medium text-ink underline underline-offset-4">أخبرنا بالرابط المعطوب</Link></li>
          </ul>
          <Seal className="absolute -bottom-6 end-6 size-20 rotate-[-8deg] text-line-strong" />
        </div>
        <div>
          <Link href="/assessment" className={buttonClass("primary", "md")}>قيّم وقفك مجانًا</Link>
        </div>
      </div>
    </div>
  );
}
