import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { ArrowLeft, LinkIcon } from "lucide-react";
import { withSystem } from "@/server/db";
import { assessments, reportShares, reports } from "@/server/db/schema";
import { sha256 } from "@/server/lib/crypto";
import { loadResultBundle } from "@/server/modules/assessment/queries";
import { ResultView } from "@/components/assessment/result-view";
import { Logo } from "@/components/brand";
import { ButtonLink, EmptyState } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "نتيجة تقييم وقفي مشتركة", robots: { index: false, follow: false } };

/**
 * Read-only shared result. The unguessable token is the capability: it is resolved with the system context
 * (the visitor has no account) and only the result of that one assessment is rendered — never its answers,
 * the waqf name or the reviewer identity.
 */
export default async function SharedReport({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = /^[A-Za-z0-9_-]{16,128}$/.test(token)
    ? await withSystem(async (tx) => {
        const [s] = await tx
          .select({ share: reportShares, assessmentId: reports.assessmentId })
          .from(reportShares)
          .innerJoin(reports, eq(reports.id, reportShares.reportId))
          .where(and(eq(reportShares.tokenHash, sha256(token)), isNull(reportShares.revokedAt), isNull(reports.revokedAt), gt(reportShares.expiresAt, new Date())))
          .limit(1);
        if (!s?.assessmentId) return null;
        const [row] = await tx.select().from(assessments).where(eq(assessments.id, s.assessmentId)).limit(1);
        if (!row || row.status === "draft") return null;
        const bundle = await loadResultBundle(tx, row);
        if (!bundle) return null;
        await tx.update(reportShares).set({ views: sql`${reportShares.views} + 1` }).where(eq(reportShares.id, s.share.id));
        return { bundle, expiresAt: s.share.expiresAt };
      })
    : null;

  return (
    <div className="min-h-dvh bg-stone">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Logo className="[&_svg]:size-8 [&_span]:text-[22px]" />
          <span className="ms-auto hidden items-center gap-1.5 text-[13px] text-muted sm:inline-flex">
            <LinkIcon aria-hidden className="size-3.5" />
            {data ? `رابط قراءة فقط، صالح حتى ${fmtDate(data.expiresAt)}` : "رابط مشاركة"}
          </span>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-6 md:py-10">
        {data ? (
          <div className="space-y-8">
            <ResultView bundle={data.bundle} mode="share" signedIn={false} />
            <section className="flex flex-col gap-4 rounded-xl bg-ink p-6 text-white sm:flex-row sm:items-center dark:bg-[#1d2638]">
              <div className="flex-1">
                <h2 className="font-naskh text-2xl font-bold">قيّم وقفك أنت</h2>
                <p className="mt-1 text-white/80">ربع ساعة تكفي لتعرف وضع وقفك في أحد عشر محورًا، مع توصيات مرتبة ومراجعها. مجانًا ودون تسجيل.</p>
              </div>
              <ButtonLink href="/assessment" variant="seal" size="lg">
                ابدأ تقييمك
                <ArrowLeft aria-hidden className="size-4" />
              </ButtonLink>
            </section>
          </div>
        ) : (
          <div className="mx-auto max-w-lg py-10">
            <EmptyState icon={LinkIcon} title="هذا الرابط لا يعمل" action={<ButtonLink href="/assessment">ابدأ تقييم وقفك</ButtonLink>}>
              قد يكون انتهت مدته أو ألغاه صاحبه. اطلب منه رابطًا جديدًا، أو <Link href="/" className="underline underline-offset-4">تعرّف على وقفك</Link>.
            </EmptyState>
          </div>
        )}
      </main>
    </div>
  );
}
