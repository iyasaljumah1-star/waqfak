import { PRACTICE_GATED_LICENSES } from "@/server/modules/nazara/licence";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { Alert, Badge, ButtonLink, DefinitionList, PageHeader, Panel } from "@/components/ui";
import { fmtSAR } from "@/lib/utils";
import { requireAuth } from "@/server/authz/context";
import { AUDIENCE_LABEL, loadServiceByCode, PRICE_UNKNOWN, PRICING_LABEL, STAGE_LABEL } from "@/server/modules/requests/catalog";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const r = await loadServiceByCode(code);
  return { title: r?.service.nameAr ?? "خدمة" };
}

const CONFLICT_TEXT: Record<string, string> = {
  blocked_if_waqfak_nazir: "حرصًا على استقلال التقييم، تُقدَّم هذه الخدمة للأوقاف التي لا تتولى وقفك نظارتها.",
  blocked_if_waqfak_controls_finance: "حرصًا على استقلال المراجعة، تُقدَّم هذه الخدمة للأوقاف التي لا تتولى وقفك نظارتها أو إدارتها أو مسك دفاترها.",
  inside_nazara_only: "تُقدَّم للأوقاف التي تتولى وقفك نظارتها، ضمن أجر النظارة.",
};

export default async function ServiceDetail({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ waqf?: string }> }) {
  const { code } = await params;
  await requireAuth({ next: `/app/services/${code}` });
  const { waqf } = await searchParams;
  const r = await loadServiceByCode(code);
  if (!r) notFound();
  const { service: s, category, workflow, availability, price } = r;
  const off = !availability.available;

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ href: "/app/services", label: "الخدمات" }, ...(category ? [{ href: `/app/services#cat-${category.code}`, label: category.nameAr }] : []), { label: s.code }]}
        title={s.nameAr}
        description={s.summary}
        actions={
          off ? (
            <Badge tone="neutral"><Lock aria-hidden className="size-3" />غير متاحة حاليًا</Badge>
          ) : (
            <ButtonLink href={`/app/requests/new?service=${s.code}${waqf ? `&waqf=${encodeURIComponent(waqf)}` : ""}`} size="md">اطلب الخدمة</ButtonLink>
          )
        }
      />
      {off ? <Alert tone="warn" title="الخدمة غير متاحة حاليًا">{availability.reason}</Alert> : null}
      {s.requiresLicenseKey && PRACTICE_GATED_LICENSES.has(s.requiresLicenseKey) ? (
        <Alert tone="info" title="كيف تسير خدمة تولي النظارة">
          نستلم ملف الوقف ومستنداته وندرسه، ثم يُعتمد قبول النظارة، ثم تبدأ «وقفك» النظارة بقرار التعيين الموثّق لدى الجهة المختصة؛ ومباشرتها مشروطة بسريان ترخيص الهيئة العامة للأوقاف للناظر الاعتباري (لائحة تنظيم أعمال النظارة م4 وم5/2).
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Panel title="ما تحصل عليه">
            <DefinitionList
              items={[
                { label: "المخرجات", value: s.outputs ?? "—" },
                { label: "المستفيدون من الخدمة", value: s.audiences.map((a) => AUDIENCE_LABEL[a] ?? a).join("، ") || "—" },
                { label: "مرحلة الوقف", value: s.stage ? `${s.stage}. ${STAGE_LABEL[s.stage] ?? ""}` : "—" },
                { label: "المدة المعيارية", value: s.slaDays ? `${s.slaDays} يومًا من اكتمال المستندات` : "حسب النطاق" },
              ]}
            />
            {s.description ? <p className="mt-4 leading-8">{s.description}</p> : null}
          </Panel>
          {s.requiredDocuments.length ? (
            <Panel title="المستندات المطلوبة">
              <ul className="space-y-1.5">
                {s.requiredDocuments.map((d) => (
                  <li key={d.docType} className="flex items-center gap-2">
                    <span>{d.label}</span>
                    <Badge tone={d.required ? "warn" : "neutral"} icon={false}>{d.required ? "مطلوب" : "إن وجد"}</Badge>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
          {s.regulatoryRestrictions || s.conflictRule !== "none" ? (
            <Panel title="حدود الخدمة">
              <ul className="list-disc space-y-1.5 ps-5 leading-7">
                {s.regulatoryRestrictions ? <li>{s.regulatoryRestrictions}</li> : null}
                {CONFLICT_TEXT[s.conflictRule] ? <li>{CONFLICT_TEXT[s.conflictRule]}</li> : null}
              </ul>
            </Panel>
          ) : null}
        </div>

        <div className="space-y-4">
          <Panel title="السعر">
            <p className="text-lg">
              {s.pricingModel === "free" ? <span className="font-semibold text-ok">مجانية</span> : price === null ? <span className="text-muted">{PRICE_UNKNOWN}</span> : <span className="tabular font-semibold">{fmtSAR(price)}</span>}
            </p>
            <p className="text-sm text-muted">{PRICING_LABEL[s.pricingModel]}. تضاف ضريبة القيمة المضافة. يبدأ العمل بعد موافقتك على عرض السعر وتوقيع العقد.</p>
          </Panel>
          <Panel title="مراحل العمل">
            {workflow?.stages.length ? (
              <ol className="list-decimal space-y-2 ps-5 marker:text-muted">
                {workflow.stages.map((st) => (
                  <li key={st.key}>
                    <span className="block">{st.name}</span>
                    <span className="text-[13px] text-muted">{st.slaDays} أيام عمل{st.clientApproval ? " · تحتاج اعتمادك" : ""}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted">تُحدد المراحل بعد دراسة الطلب.</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
