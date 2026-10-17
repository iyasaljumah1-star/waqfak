import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Alert, PageHeader, Panel } from "@/components/ui";
import { IntakeWizard } from "@/components/requests/intake-wizard";
import { requireAuth } from "@/server/authz/context";
import { attachIntakeDoc, discardDraft, saveIntake, submitIntake } from "@/server/modules/requests/intake/actions";
import { intakePageData } from "@/server/modules/requests/queries";

export const metadata: Metadata = { title: "نموذج الطلب" };

export default async function IntakePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuth({ next: `/app/requests/${id}/intake` });
  const d = await intakePageData(auth, id);
  if (!d) notFound();
  const r = d.rc.req;
  if (r.status !== "draft") redirect(`/app/requests/${id}`);
  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ href: "/app/requests", label: "طلباتي" }, { href: `/app/requests/${id}`, label: r.number }, { label: "نموذج الطلب" }]}
        title={`طلب: ${d.rc.service.nameAr}`}
        description={<span>مسودة <span dir="ltr" className="tabular">{r.number}</span>{d.rc.waqf ? ` — ${d.rc.waqf.name}` : " — بلا وقف"}</span>}
      />
      {!d.canEdit ? (
        <Alert tone="warn" title="للاطلاع فقط">هذه المسودة أنشأها عضو آخر في الوقف، ولا تملك صلاحية تعديلها.</Alert>
      ) : (
        <Panel>
          <IntakeWizard
            requestId={id}
            form={d.form}
            initialAnswers={d.answers}
            docMap={d.docMap}
            docOptions={d.options}
            waqfId={r.waqfId}
            save={saveIntake}
            attach={attachIntakeDoc}
            submit={submitIntake}
            discard={discardDraft}
            contextBlocks={d.blocks}
          />
        </Panel>
      )}
    </div>
  );
}
