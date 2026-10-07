import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAuth } from "@/server/authz/context";
import { resolveAssessment } from "@/server/modules/assessment/access";
import { resultPageData } from "@/server/modules/assessment/page-data";
import { ResultView } from "@/components/assessment/result-view";

export const metadata: Metadata = { title: "نتيجة التقييم" };

export default async function AppAssessmentResult({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAuth({ next: `/app/assessments/${id}` });
  const v = await resolveAssessment(id);
  if (!v) notFound();
  if (v.row.status === "draft") {
    if (v.canEdit) redirect(`/assessment/${id}`);
    notFound();
  }
  const data = await resultPageData(v);
  if (!data) notFound();
  return (
    <div className="mx-auto max-w-6xl">
      <ResultView
        bundle={data.bundle}
        mode="full"
        signedIn
        canShare={v.canShare}
        canPlan={v.canPlan}
        canClaim={v.canClaim}
        claimWaqfs={data.claimWaqfs}
        shares={data.shares}
        crumbs={
          <nav aria-label="مسار التنقل" className="flex flex-wrap gap-1 text-sm text-muted">
            <Link href="/app/assessments" className="hover:text-ink hover:underline">تقييماتي</Link>
            {data.bundle.waqf ? (
              <>
                <span aria-hidden>/</span>
                <Link href={`/app/w/${data.bundle.waqf.id}/assessments`} className="hover:text-ink hover:underline">{data.bundle.waqf.name}</Link>
              </>
            ) : null}
          </nav>
        }
      />
    </div>
  );
}
