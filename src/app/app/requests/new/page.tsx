import type { Metadata } from "next";
import Link from "next/link";
import { Briefcase, Landmark } from "lucide-react";
import { Alert, ButtonLink, EmptyState, PageHeader, Panel } from "@/components/ui";
import { NewRequestFields, NewRequestForm } from "@/components/requests/forms";
import { fmtSAR } from "@/lib/utils";
import { requireAuth } from "@/server/authz/context";
import { createRequest } from "@/server/modules/requests/actions";
import { loadServiceByCode, PRICE_UNKNOWN } from "@/server/modules/requests/catalog";
import { recommendationForPrefill, requestableWaqfs } from "@/server/modules/requests/queries";

export const metadata: Metadata = { title: "طلب خدمة" };

const CONFLICT_HINT: Record<string, string> = {
  blocked_if_waqfak_nazir: "حرصًا على الاستقلالية، تُقدَّم هذه الخدمة للأوقاف التي لا تتولى وقفك نظارتها. إن كانت وقفك ناظرًا لهذا الوقف يُحال الطلب إلى مدير التشغيل ليقرر فيه.",
  blocked_if_waqfak_controls_finance: "حرصًا على الاستقلالية، تُقدَّم هذه الخدمة للأوقاف التي لا تتولى وقفك نظارتها أو إدارتها أو مسك دفاترها. وفي غير ذلك يُحال الطلب إلى مدير التشغيل ليقرر فيه.",
  inside_nazara_only: "تُقدَّم هذه الخدمة للأوقاف التي تتولى وقفك نظارتها. وفي غير ذلك يُحال الطلب إلى مدير التشغيل ليقرر فيه.",
};

export default async function NewRequestPage({ searchParams }: { searchParams: Promise<{ service?: string; waqf?: string; rec?: string }> }) {
  const sp = await searchParams;
  const auth = await requireAuth({ next: "/app/requests/new" });
  const rec = sp.rec ? await recommendationForPrefill(auth, sp.rec) : null;
  const code = sp.service ?? rec?.serviceCodes[0];
  if (!code) {
    return (
      <div className="space-y-6">
        <PageHeader crumbs={[{ href: "/app/requests", label: "طلباتي" }, { label: "طلب جديد" }]} title="طلب خدمة" />
        <EmptyState icon={Briefcase} title="اختر الخدمة أولًا" action={<ButtonLink href="/app/services">تصفح الخدمات</ButtonLink>}>
          ابدأ من كتالوج الخدمات، ثم اضغط «اطلب» بجانب الخدمة التي تحتاجها.
        </EmptyState>
      </div>
    );
  }
  const svc = await loadServiceByCode(code);
  if (!svc) {
    return (
      <div className="space-y-6">
        <PageHeader crumbs={[{ href: "/app/requests", label: "طلباتي" }, { label: "طلب جديد" }]} title="طلب خدمة" />
        <Alert tone="warn" title="الخدمة غير موجودة" action={<ButtonLink href="/app/services" size="sm" variant="secondary">الخدمات</ButtonLink>}>تأكد من رمز الخدمة أو اخترها من الكتالوج.</Alert>
      </div>
    );
  }
  const { service: s, availability, price } = svc;
  const waqfs = await requestableWaqfs(auth);
  const allowNoWaqf = s.audiences.some((a) => a === "waqif" || a === "entity" || a === "beneficiary") || ["T", "W"].includes(svc.category?.code ?? "");
  const defaultWaqf = rec?.waqfId ?? (sp.waqf && waqfs.some((w) => w.id === sp.waqf) ? sp.waqf : undefined);
  const defaultDetails = rec ? `${rec.titleAr}\n${rec.reasonAr}${rec.reference ? `\nالمرجع: ${rec.reference}` : ""}` : undefined;

  return (
    <div className="space-y-6">
      <PageHeader crumbs={[{ href: "/app/services", label: "الخدمات" }, { href: `/app/services/${s.code}`, label: s.nameAr }, { label: "طلب جديد" }]} title={`طلب: ${s.nameAr}`} description={s.summary} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Panel>
          {!availability.available ? (
            <Alert tone="warn" title="الخدمة غير متاحة حاليًا">{availability.reason}</Alert>
          ) : !waqfs.length && !allowNoWaqf ? (
            <EmptyState icon={Landmark} title="هذه الخدمة تحتاج ملف وقف" action={<ButtonLink href="/app/waqfs/new">سجّل وقفًا قائمًا</ButtonLink>}>
              لا يوجد وقف تملك فيه صلاحية طلب الخدمات. سجّل الوقف أولًا، أو اطلب من ناظره دعوتك.
            </EmptyState>
          ) : (
            <NewRequestForm action={createRequest} service={s.code} rec={rec?.id}>
              {rec ? <Alert tone="info" title="من توصية التقييم">عبّأنا التفاصيل من التوصية. عدّلها إن شئت.</Alert> : null}
              <NewRequestFields waqfs={waqfs.map((w) => ({ id: w.id, name: w.name }))} defaultWaqf={defaultWaqf} allowNoWaqf={allowNoWaqf} defaultDetails={defaultDetails} />
            </NewRequestForm>
          )}
        </Panel>
        <aside className="space-y-4">
          <Panel title="ماذا يحدث بعد الإرسال؟">
            <ol className="list-decimal space-y-2 ps-5 text-[15px] leading-7 marker:text-muted">
              <li>يُسند الطلب لمختص ويُفرز خلال 5 أيام عمل.</li>
              <li>تصلك تفاصيل النطاق وعرض السعر.</li>
              <li>توقّع العقد إلكترونيًا برمز يصل جوالك، ثم تصدر الفاتورة.</li>
              <li>تتابع المراحل والمراسلات والمخرجات من صفحة الطلب.</li>
            </ol>
          </Panel>
          <Panel title="السعر">
            <p>{s.pricingModel === "free" ? "مجانية" : price === null ? PRICE_UNKNOWN : <span className="tabular">{fmtSAR(price)} قبل الضريبة</span>}</p>
          </Panel>
          {CONFLICT_HINT[s.conflictRule] ? <Alert tone="warn" title="قاعدة استقلال">{CONFLICT_HINT[s.conflictRule]}</Alert> : null}
          {s.requiredDocuments.length ? (
            <Panel title="جهّز هذه المستندات">
              <ul className="list-disc space-y-1 ps-5 text-[15px]">{s.requiredDocuments.map((d) => <li key={d.docType}>{d.label}{d.required ? "" : " (إن وجد)"}</li>)}</ul>
              <p className="mt-2 text-[13px] text-muted">ترفعها من صفحة الطلب بعد إرساله.</p>
            </Panel>
          ) : null}
          <p className="text-[13px] text-muted">تريد خدمة أخرى؟ <Link href="/app/services" className="text-ink underline">عُد إلى الكتالوج</Link>.</p>
        </aside>
      </div>
    </div>
  );
}
