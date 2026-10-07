import type { Metadata } from "next";
import { cookies } from "next/headers";
import { inArray } from "drizzle-orm";
import { Gauge, Plus } from "lucide-react";
import { requireAuth } from "@/server/authz/context";
import { assessments } from "@/server/db/schema";
import { safeEqual, sha256 } from "@/server/lib/crypto";
import { read } from "@/server/modules/_shared";
import { isUuid } from "@/server/modules/assessment/access";
import { assessmentNumber, listMyAssessments, myWaqfsWith, type AssessmentListItem } from "@/server/modules/assessment/queries";
import { AssessmentTable } from "@/components/assessment/list";
import { Alert, ButtonLink, EmptyState, PageHeader, Panel } from "@/components/ui";

export const metadata: Metadata = { title: "تقييماتي" };

export default async function MyAssessments() {
  const auth = await requireAuth({ next: "/app/assessments" });
  const viewWaqfs = await myWaqfsWith(auth, "assessment.view");
  const rows = await listMyAssessments(auth, viewWaqfs.map((w) => w.id));

  // Assessments taken in this browser before signing in (anonymous cookie), not yet saved to the account.
  const jar = await cookies();
  const anon = jar.getAll().filter((c) => c.name.startsWith("wqf_asmt_")).map((c) => ({ id: c.name.slice(9), token: c.value })).filter((c) => isUuid(c.id));
  const unclaimed: AssessmentListItem[] = anon.length
    ? (await read(auth, (tx) => tx.select().from(assessments).where(inArray(assessments.id, anon.map((a) => a.id)))))
        .filter((r) => !r.userId && r.anonTokenHash && anon.some((a) => a.id === r.id && safeEqual(sha256(a.token), r.anonTokenHash!)))
        .map((r) => ({
          id: r.id, number: assessmentNumber(r.id), kind: r.kind, status: r.status, waqfId: null, waqfName: null, waqfLabel: r.waqfLabel,
          startedAt: r.startedAt, completedAt: r.completedAt, reviewedAt: r.reviewedAt, overallScore: null, resultStatus: null, maturityLevel: null, userId: null,
        }))
    : [];

  const byWaqf = rows.filter((r) => r.waqfId);
  const personal = rows.filter((r) => !r.waqfId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="تقييماتي"
        description="كل تقييم أجريته، وتقييمات الأوقاف التي تملك فيها صلاحية الاطلاع على التقييمات."
        actions={<ButtonLink href="/assessment"><Plus aria-hidden className="size-4" />تقييم جديد</ButtonLink>}
      />
      {unclaimed.length ? (
        <Alert tone="info" title="تقييمات أجريتها قبل تسجيل الدخول">
          <p className="mb-2">افتح التقييم واختر «احفظ النتيجة في حسابي» ليبقى في سجلك.</p>
          <AssessmentTable rows={unclaimed} showWaqf={false} base="/assessment" />
        </Alert>
      ) : null}
      {rows.length === 0 && !unclaimed.length ? (
        <EmptyState icon={Gauge} title="لم تُجرِ أي تقييم بعد" action={<ButtonLink href="/assessment">ابدأ التقييم الوقفي</ButtonLink>}>
          ربع ساعة تكفي لتعرف وضع وقفك في أحد عشر محورًا، مع توصيات مرتبة وخطة عمل.
        </EmptyState>
      ) : null}
      {byWaqf.length ? (
        <Panel title="تقييمات أوقافي" tight>
          <div className="px-3 md:px-2"><AssessmentTable rows={byWaqf} /></div>
        </Panel>
      ) : null}
      {personal.length ? (
        <Panel title="تقييمات غير مرتبطة بوقف" description="أجريتها لوقف غير مسجل في المنصة. يمكنك إعادة التقييم من ملف الوقف بعد إضافته." tight>
          <div className="px-3 md:px-2"><AssessmentTable rows={personal} showWaqf /></div>
        </Panel>
      ) : null}
    </div>
  );
}
