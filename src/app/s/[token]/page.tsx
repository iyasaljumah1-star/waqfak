import type { Metadata } from "next";
import { Download, FileText, LinkIcon } from "lucide-react";
import { Logo } from "@/components/brand";
import { buttonClass } from "@/components/ui";
import { ANCHOR_PRIMARY_FIX } from "@/components/documents/bits";
import { fmtDateTime } from "@/lib/utils";
import { viewShare, type ShareState } from "@/server/modules/documents/share";
import { docTypeLabel, fmtBytes } from "@/server/modules/documents/labels";

export const metadata: Metadata = {
  title: "وثيقة مشاركة | وقفك",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const REASON: Record<Exclude<ShareState, "ok">, string> = {
  not_found: "الرابط غير صحيح. تأكد من نسخه كاملًا، أو اطلب رابطًا جديدًا من مرسله.",
  revoked: "أُلغي هذا الرابط. اطلب رابطًا جديدًا من مرسله إن كنت ما زلت تحتاج الوثيقة.",
  expired: "انتهت صلاحية هذا الرابط. اطلب رابطًا جديدًا من مرسله.",
  used_up: "استُنفد عدد مرات التنزيل المسموح بها لهذا الرابط. اطلب رابطًا جديدًا من مرسله.",
  unavailable: "الوثيقة لم تعد متاحة للمشاركة. تواصل مع مرسل الرابط.",
};

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { state, info } = await viewShare(token);

  return (
    <div className="flex min-h-dvh flex-col bg-stone">
      <header className="border-b border-line bg-surface px-4 py-3 md:px-8">
        <Logo href="/" className="[&_svg]:size-8 [&_span]:text-[22px]" />
      </header>
      <main id="main" className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-10">
        <section className="rounded-lg border border-line bg-surface p-6 md:p-8">
          {info ? (
            <>
              <p className="flex items-center gap-2 text-sm text-muted">
                <LinkIcon aria-hidden className="size-4" /> وثيقة شاركها معك أحد مستخدمي وقفك
              </p>
              <div className="mt-4 flex items-start gap-3">
                <FileText aria-hidden className="mt-1 size-7 shrink-0 text-ink" />
                <div className="min-w-0">
                  <h1 className="font-naskh text-2xl font-bold leading-snug text-ink">{info.title}</h1>
                  <p className="mt-1 text-[15px] text-muted">{docTypeLabel(info.docType)} · {fmtBytes(info.sizeBytes)}</p>
                </div>
              </div>
              <a href={`/s/${encodeURIComponent(token)}/file`} rel="noreferrer" className={buttonClass("primary", "lg", `mt-6 w-full ${ANCHOR_PRIMARY_FIX}`)}>
                <Download aria-hidden className="size-5" /> نزّل الوثيقة
              </a>
              <p className="mt-4 text-[13px] leading-6 text-muted">
                يعمل الرابط حتى {fmtDateTime(info.expiresAt)}، ويتبقى {info.remaining} {info.remaining === 1 ? "تنزيل" : "تنزيلات"}. كل تنزيل يُسجَّل.
              </p>
            </>
          ) : (
            <>
              <h1 className="font-naskh text-2xl font-bold text-ink">الرابط لا يعمل</h1>
              <p className="mt-3 text-[15px] leading-7 text-muted">{REASON[state as Exclude<ShareState, "ok">]}</p>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
