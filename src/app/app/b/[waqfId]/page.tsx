import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { HandCoins, Inbox } from "lucide-react";
import { Alert, Badge, DataTable, DefinitionList, EmptyState, PageHeader, Panel, Stat, type Tone } from "@/components/ui";
import { ComplaintForm } from "@/components/complaints/complaint-form";
import { fmtBoth, fmtDate, fmtDateTime, fmtPct, fmtSAR, NAZIR_MODE_LABEL, STATUS_LABEL, TYPE_LABEL } from "@/lib/utils";
import { withContext } from "@/server/db";
import { loadWaqfAccess, requireAuth } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { beneficiaryView } from "@/server/modules/beneficiary-portal/queries";
import { COMPLAINT_KIND_AR, COMPLAINT_STATUS_AR } from "@/server/modules/complaints/pure";
import { isUuid } from "@/server/modules/waqf-core/queries";

export const metadata: Metadata = { title: "بوابة المستفيد" };

const SUB_TONE: Record<string, Tone> = { open: "info", in_progress: "warn", answered: "ok", closed: "neutral" };
const LINE_AR: Record<string, string> = { pending: "قيد الصرف", paid: "صُرف", failed: "تعذّر التحويل" };

export default async function BeneficiaryPortal({ params }: { params: Promise<{ waqfId: string }> }) {
  const { waqfId } = await params;
  if (!isUuid(waqfId)) redirect("/app?notfound=1");
  const auth = await requireAuth({ next: `/app/b/${waqfId}` });
  const access = await withContext(auth.db, (tx) => loadWaqfAccess(tx, auth, waqfId));
  if (!access) redirect("/app?notfound=1");
  // This view is for beneficiaries; managers and staff use the waqf file.
  if (!access.roles.includes("beneficiary")) redirect(`/app/w/${waqfId}`);
  const canSubmit = access.perms.has("complaints.create");
  const v = await read(auth, (tx) => beneficiaryView(tx, waqfId, auth.user.id));
  if (!v) redirect("/app?notfound=1");
  const w = v.waqf;
  const totalPaid = v.lines.filter((l) => l.status === "paid").reduce((s, l) => s + Number(l.amount), 0);
  const latest = v.entitlements[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title={w.name}
        description="بوابة المستفيد: استحقاقك ومبالغ الصرف الخاصة بك، وطلباتك إلى ناظر الوقف."
        crumbs={[{ href: "/app", label: "الرئيسية" }, { label: "بوابة المستفيد" }]}
      />

      <Panel title="عن الوقف">
        <DefinitionList
          cols={3}
          items={[
            { label: "الرقم لدى وقفك", value: <span dir="ltr" className="tabular">{w.internalNumber}</span> },
            { label: "نوع الوقف", value: w.legalType ? TYPE_LABEL[w.legalType] : "—" },
            { label: "النظارة", value: w.nazirMode ? NAZIR_MODE_LABEL[w.nazirMode] : "—" },
            { label: "الحالة", value: STATUS_LABEL[w.status] ?? w.status },
            { label: "المجال", value: w.fieldOfWork ?? "—" },
            { label: "التسجيل لدى الهيئة", value: w.registeredOn ? fmtBoth(w.registeredOn) : "—" },
          ]}
        />
      </Panel>

      {v.mine.length ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Stat label={latest ? `استحقاقك لعام ${latest.period}` : "الاستحقاق"} value={latest ? fmtSAR(latest.amount) : "—"} sub={latest?.expectedPayOn ? `الصرف المتوقع ${fmtDate(latest.expectedPayOn)}` : undefined} />
            <Stat label="ما صُرف لك" value={fmtSAR(totalPaid)} tone={totalPaid ? "ok" : undefined} />
            <Stat label="حصتك" value={v.mine[0].share ? fmtPct(Number(v.mine[0].share) * 100) : "—"} sub={v.mine[0].className ?? undefined} />
          </div>

          <Panel title="بياناتك في سجل المستفيدين">
            <ul className="space-y-3">
              {v.mine.map((b) => (
                <li key={b.id}>
                  <DefinitionList
                    items={[
                      { label: "الاسم", value: b.displayName },
                      { label: "الفئة", value: b.className ?? "—" },
                      { label: "الحالة", value: <Badge tone={b.status === "active" ? "ok" : "warn"} icon={false}>{b.status === "active" ? "مستحق" : b.status === "suspended" ? "موقوف مؤقتًا" : "منتهٍ"}</Badge> },
                      { label: "آخر تحقق من البيانات", value: b.lastVerifiedOn ? fmtDate(b.lastVerifiedOn) : "—" },
                    ]}
                  />
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="الاستحقاق حسب الفترة" tight>
            <DataTable
              rows={v.entitlements}
              rowKey={(e) => e.id}
              empty={<p className="p-5 text-muted">لم يُحتسب استحقاق بعد.</p>}
              columns={[
                { key: "p", label: "الفترة", render: (e) => <span className="tabular font-medium">{e.period}</span>, className: "w-24" },
                { key: "a", label: "المبلغ", render: (e) => <span className="tabular">{fmtSAR(e.amount)}</span> },
                { key: "b", label: "أساس الاحتساب", render: (e) => e.basis ?? "—" },
                { key: "d", label: "الصرف المتوقع", render: (e) => (e.expectedPayOn ? fmtDate(e.expectedPayOn) : "—") },
              ]}
            />
          </Panel>

          <Panel title="ما صُرف لك" tight>
            <DataTable
              rows={v.lines}
              rowKey={(l) => l.id}
              empty={<div className="p-4"><EmptyState icon={HandCoins} title="لا عمليات صرف مسجلة بعد">تظهر هنا كل دفعة تُصرف لك بمرجعها وتاريخها.</EmptyState></div>}
              columns={[
                { key: "p", label: "الفترة", render: (l) => <span className="tabular">{l.period}</span>, className: "w-24" },
                { key: "a", label: "المبلغ", render: (l) => <span className="tabular">{fmtSAR(l.amount)}</span> },
                { key: "s", label: "الحالة", render: (l) => <Badge tone={l.status === "paid" ? "ok" : l.status === "failed" ? "critical" : "info"} icon={false}>{LINE_AR[l.status] ?? l.status}</Badge> },
                { key: "d", label: "تاريخ الصرف", render: (l) => (l.paidOn ? fmtDate(l.paidOn) : "—") },
                { key: "r", label: "المرجع", render: (l) => <span dir="ltr" className="tabular text-[13px]">{l.referenceNo}</span>, hideOnMobile: true },
              ]}
            />
          </Panel>
        </>
      ) : (
        <Alert tone="warn" title="لم يُربط حسابك بسجل مستفيد بعد">
          أبلغ ناظر الوقف ليربط حسابك بسجلك في قائمة المستفيدين، أو أرسل له طلب اطلاع من النموذج أدناه.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {canSubmit ? (
          <Panel id="new" title="طلب جديد إلى الناظر" description="يلتزم الناظر بالرد على استفسارات المستفيدين وشكاواهم وطلبات الاطلاع خلال مهلة محددة بأيام العمل.">
            <ComplaintForm waqfId={waqfId} />
          </Panel>
        ) : null}
        <Panel id="submissions" title={`طلباتي (${v.submissions.length})`} tight>
          {v.submissions.length ? (
            <ul className="divide-y divide-line">
              {v.submissions.map((s) => (
                <li key={s.id} className="space-y-2 px-4 py-4 md:px-5" data-testid="submission">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[13px] text-muted"><span dir="ltr" className="tabular">{s.number}</span> · {COMPLAINT_KIND_AR[s.kind]} · {fmtDateTime(s.createdAt)}</p>
                      <p className="font-medium">{s.subject}</p>
                    </div>
                    <Badge tone={SUB_TONE[s.status] ?? "neutral"} icon={false}>{COMPLAINT_STATUS_AR[s.status] ?? s.status}</Badge>
                  </div>
                  {s.response ? (
                    <div className="rounded-md border border-ok/40 bg-ok-soft/40 px-3 py-2">
                      <p className="text-[13px] text-muted">رد الناظر · {fmtDateTime(s.respondedAt)}</p>
                      <p className="mt-1 whitespace-pre-line" data-testid="response">{s.response}</p>
                    </div>
                  ) : (
                    <p className="text-[13px] text-muted">الرد متوقع قبل {fmtDateTime(s.slaDueAt)}</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-4"><EmptyState icon={Inbox} title="لم ترسل طلبات بعد" /></div>
          )}
        </Panel>
      </div>
    </div>
  );
}
