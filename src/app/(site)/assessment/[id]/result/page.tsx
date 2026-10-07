import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { resolveAssessment } from "@/server/modules/assessment/access";
import { resultPageData } from "@/server/modules/assessment/page-data";
import { ResultView } from "@/components/assessment/result-view";

export const metadata: Metadata = { title: "نتيجة التقييم الوقفي", robots: { index: false } };

export default async function PublicResult({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await resolveAssessment(id);
  if (!v) notFound();
  if (v.row.status === "draft") redirect(`/assessment/${id}`);
  const data = await resultPageData(v);
  if (!data) notFound();
  return (
    <div className="bg-stone">
      <div className="mx-auto max-w-6xl px-4 py-6 md:py-10">
        <ResultView
          bundle={data.bundle}
          mode="full"
          signedIn={!!v.auth}
          canShare={v.canShare}
          canPlan={v.canPlan}
          canClaim={v.canClaim}
          claimWaqfs={data.claimWaqfs}
          shares={data.shares}
          crumbs={
            <nav aria-label="مسار التنقل" className="text-sm text-muted">
              <Link href="/assessment" className="hover:text-ink hover:underline">التقييم الوقفي</Link>
              {v.auth ? <> <span aria-hidden>/</span> <Link href="/app/assessments" className="hover:text-ink hover:underline">تقييماتي</Link></> : null}
            </nav>
          }
        />
      </div>
    </div>
  );
}
