import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader, Panel } from "@/components/ui";
import { ActionLink } from "@/components/portal/action-link";
import { DeedPaper, DeedText, Muted } from "@/components/waqf/bits";
import { WillPlanner } from "@/components/waqf/will-planner";
import { loadWaqfAccess, requireAuth } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { saveWill } from "@/server/modules/wills/actions";
import { buildWillDraft } from "@/server/modules/wills/pure";
import { willPlan } from "@/server/modules/wills/queries";
import { todayIso } from "@/server/modules/waqf-file/form";
import { isUuid } from "@/server/modules/waqf-file/guard";

export const metadata: Metadata = { title: "مخطط الوصية بالوقف" };

export default async function WillPage({ params }: { params: Promise<{ willId: string }> }) {
  const { willId } = await params;
  if (!isUuid(willId)) redirect("/app/wills");
  const auth = await requireAuth({ next: `/app/wills/${willId}` });
  const data = await read(auth, async (tx) => {
    const access = await loadWaqfAccess(tx, auth, willId);
    if (!access || !access.roles.includes("founder") || access.waqf.createdBy !== auth.user.id || access.waqf.creationMode !== "bequest") return null;
    const p = await willPlan(tx, willId);
    return p ? { waqf: access.waqf, plan: p.plan } : null;
  });
  if (!data) redirect("/app/wills");
  const text = data.plan.draftText ?? buildWillDraft(data.plan, todayIso());

  return (
    <div className="space-y-6">
      <PageHeader title={data.waqf.name} description="خطّط وصيتك بالوقف وتحقق من حد الثلث، ثم اطلب صياغتها وتوثيقها." crumbs={[{ href: "/app/wills", label: "الوصايا" }, { label: data.waqf.internalNumber }]} />
      <Panel title="المخطط">
        <WillPlanner action={saveWill} willId={willId} plan={data.plan} />
      </Panel>
      <DeedPaper title="وصية بوقف" label="مسودة أولية للمراجعة الشرعية والقانونية قبل التوثيق" testId="will-draft">
        <DeedText text={text} />
      </DeedPaper>
      <Panel title="الخطوة التالية">
        <Muted>الوصية الجامعة الواحدة تلغي ما سبقها صراحة. اطلب صياغتها من مختص، ثم توثيقها عبر ناجز أو بوكالة «إثبات وصية».</Muted>
        <div className="mt-3 flex flex-wrap gap-2">
          <ActionLink href={`/app/requests/new?service=W01&waqf=${willId}`} variant="primary">اطلب صياغة الوصية</ActionLink>
          <ActionLink href={`/app/requests/new?service=W02&waqf=${willId}`} variant="secondary">توثيق الوصية</ActionLink>
        </div>
      </Panel>
    </div>
  );
}
