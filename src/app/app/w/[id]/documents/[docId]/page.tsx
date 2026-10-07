import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, ExternalLink, FileText, Link2 } from "lucide-react";
import { requireAuth, requireWaqf, waqfCan } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { documentDetail, getDocument, userName } from "@/server/modules/documents/queries";
import { canSeeDocumentSync } from "@/server/modules/documents/service";
import { ACCESS_ACTION_LABEL, ENTITY_LABEL, SCAN_LABEL, STATUS_LABEL, docTypeLabel, fmtBytes } from "@/server/modules/documents/labels";
import { Alert, Badge, DataTable, DefinitionList, PageHeader, Panel, buttonClass } from "@/components/ui";
import { DocumentUploader } from "@/components/documents/uploader";
import { ApprovalBadge, ConfBadge, Expiry, Issued } from "@/components/documents/bits";
import { DocumentPreview } from "@/components/documents/preview";
import { ApproveForm, ArchiveForm, MetaForm, RevokeShareForm, ShareForm } from "@/components/documents/forms";
import { fmtDate, fmtDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "وثيقة" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function entityHref(waqfId: string, type: string, id: string): string | null {
  const w = `/app/w/${waqfId}`;
  switch (type) {
    case "request": return `/app/requests/${id}`;
    case "meeting": return `${w}/governance/meetings/${id}`;
    case "waqf": return w;
    case "asset": case "property": case "lease": case "valuation": return `${w}/assets`;
    case "resolution": case "minutes": return `${w}/governance`;
    case "obligation": case "obligation_instance": case "violation": return `${w}/compliance`;
    case "complaint": return `${w}/complaints`;
    case "task": return `${w}/tasks`;
    case "beneficiary": return `${w}/beneficiaries`;
    case "distribution": case "financial_statement": return `${w}/finance`;
    case "assessment": return `${w}/assessments`;
    default: return null;
  }
}

export default async function DocumentDetailPage({ params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  if (!UUID.test(docId)) notFound();
  const auth = await requireAuth({ next: `/app/w/${id}/documents/${docId}` });
  const access = await requireWaqf(auth, id, "documents.view");
  const data = await read(auth, async (tx) => {
    const doc = await getDocument(tx, docId);
    if (!doc || doc.waqfId !== id || !canSeeDocumentSync({ userId: auth.user.id, perms: access.perms }, doc)) return null;
    const detail = await documentDetail(tx, docId);
    const owner = await userName(tx, doc.ownerUserId);
    return { doc, owner, ...detail };
  });
  if (!data) notFound();
  const { doc, versions, log, shares, links, owner } = data;
  const current = versions.find((v) => v.v.version === doc.currentVersion)?.v ?? null;
  const servable = current?.scanStatus === "clean";
  const can = (p: Parameters<typeof waqfCan>[1]) => waqfCan(access, p);
  const canEdit = can("documents.upload") && !doc.archivedAt && doc.approvalStatus !== "locked";
  const isUploader = doc.ownerUserId === auth.user.id || current?.uploadedBy === auth.user.id;
  const canSeeLog = can("documents.approve") || can("audit.view_waqf");
  const base = `/app/w/${id}/documents`;
  const fileUrl = (v?: string, inline = false) => `/api/files/${doc.id}?${v ? `v=${v}&` : ""}disposition=${inline ? "inline" : "attachment"}`;
  const now = Date.now();
  const kind = current?.mimeType ?? "";
  const previewable = servable && (kind === "application/pdf" || kind.startsWith("image/") || kind === "text/plain");

  type LogRow = (typeof log)[number];
  const logColumns: { key: string; label: string; render: (r: LogRow) => ReactNode; className?: string; hideOnMobile?: boolean }[] = [
    { key: "who", label: "المستخدم", render: (r) => r.userId ? r.name ?? "مستخدم" : <span className="text-muted">زائر عبر رابط مشاركة</span> },
    { key: "what", label: "العملية", render: (r) => <Badge tone={r.action === "denied" ? "critical" : "neutral"} icon={r.action === "denied"}>{ACCESS_ACTION_LABEL[r.action] ?? r.action}</Badge> },
    { key: "when", label: "الوقت", render: (r) => <span className="tabular whitespace-nowrap text-[14px]">{fmtDateTime(r.at)}</span> },
    { key: "ip", label: "العنوان", hideOnMobile: true, render: (r) => <bdi dir="ltr" className="text-[13px] text-muted">{r.ip ?? "—"}</bdi> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={doc.title}
        crumbs={[{ href: `/app/w/${id}`, label: access.waqf.name }, { href: base, label: "الوثائق" }, { label: docTypeLabel(doc.docType) }]}
        description={
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <Badge tone="ink" icon={false}>{docTypeLabel(doc.docType)}</Badge>
            <ApprovalBadge s={doc.approvalStatus} />
            <ConfBadge c={doc.confidentiality} />
            {doc.status !== "active" ? <Badge tone={doc.status === "rejected" ? "critical" : doc.status === "archived" ? "neutral" : "warn"}>{STATUS_LABEL[doc.status]}</Badge> : null}
          </span>
        }
        actions={
          servable ? (
            <>
              <a href={fileUrl(undefined, true)} target="_blank" rel="noopener" className={buttonClass("secondary")}>
                <ExternalLink aria-hidden className="size-4" /> افتح
              </a>
              <a href={fileUrl()} className={buttonClass("primary")}>
                <Download aria-hidden className="size-4" /> نزّل
              </a>
            </>
          ) : undefined
        }
      />

      {doc.status === "rejected" ? (
        <Alert tone="critical" title="رُفض الملف في الفحص الأمني">
          {current?.scanDetail?.split(": ").slice(1).join(": ") || "الملف يحتوي على محتوى غير آمن."} ارفع نسخة نظيفة من الملف لتفعيل الوثيقة.
        </Alert>
      ) : doc.archivedAt ? (
        <Alert tone="info" title="الوثيقة مؤرشفة">أُرشفت في {fmtDate(doc.archivedAt)}. تبقى محفوظة ويمكن استعادتها.</Alert>
      ) : doc.approvalStatus === "in_review" ? (
        <Alert tone="info" title="بانتظار الاعتماد">تغيّرت الوثيقة بعد اعتمادها، وتحتاج اعتمادًا جديدًا.</Alert>
      ) : null}

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <Panel title="معاينة" description={current ? `${current.originalName} · ${fmtBytes(current.sizeBytes)}` : undefined} tight>
            {previewable && current ? (
              <div>
                <DocumentPreview src={fileUrl(current.id, true)} kind={kind === "application/pdf" ? "pdf" : kind === "text/plain" ? "text" : "image"} title={doc.title} />
                <p className="border-t border-line px-4 py-2 text-[13px] text-muted">
                  إن لم تظهر المعاينة على جهازك، <a href={fileUrl(current.id, true)} target="_blank" rel="noopener" className="text-ink underline">افتح الملف في نافذة جديدة</a>.
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-muted">
                <FileText aria-hidden className="size-8" />
                <p>{servable ? "لا تتوفر معاينة لهذا النوع من الملفات. نزّل الملف لفتحه." : "لا يمكن عرض الملف لأنه لم يجتز الفحص."}</p>
              </div>
            )}
          </Panel>

          <Panel title="النسخ" description="كل نسخة محفوظة مشفّرة ولا تُحذف." tight>
            <div className="px-3 md:px-1">
              <DataTable
                caption="سجل النسخ"
                rows={versions}
                rowKey={(r) => r.v.id}
                columns={[
                  { key: "n", label: "النسخة", className: "tabular w-16", render: (r) => <span className="font-medium">{r.v.version}{r.v.version === doc.currentVersion ? <span className="ms-1 text-[12px] text-ok">(الحالية)</span> : null}</span> },
                  { key: "file", label: "الملف", render: (r) => <span className="block min-w-0 break-all"><bdi>{r.v.originalName}</bdi><span className="block text-[13px] text-muted">{fmtBytes(r.v.sizeBytes)}{r.v.changeNote ? ` · ${r.v.changeNote}` : ""}</span></span> },
                  { key: "by", label: "رفعها", hideOnMobile: true, render: (r) => <span className="text-[14px]">{r.uploader ?? "—"}<span className="block text-[13px] text-muted">{fmtDateTime(r.v.uploadedAt)}</span></span> },
                  { key: "scan", label: "الفحص", render: (r) => <Badge tone={r.v.scanStatus === "clean" ? "ok" : r.v.scanStatus === "pending" ? "warn" : "critical"}>{SCAN_LABEL[r.v.scanStatus]}</Badge> },
                  { key: "dl", label: "تنزيل", render: (r) => r.v.scanStatus === "clean" ? <a href={fileUrl(r.v.id)} className="inline-flex items-center gap-1 text-sm text-ink hover:underline"><Download aria-hidden className="size-4" />نزّل</a> : <span className="text-muted">—</span> },
                ]}
              />
            </div>
            {canEdit ? (
              <div className="border-t border-line p-4 md:p-5">
                <h3 className="mb-3 font-semibold">رفع نسخة جديدة</h3>
                <DocumentUploader documentId={doc.id} waqfId={id} />
                {doc.approvalStatus === "approved" ? <p className="mt-2 text-[13px] text-muted">رفع نسخة جديدة يعيد الوثيقة إلى المراجعة لاعتمادها من جديد.</p> : null}
              </div>
            ) : null}
          </Panel>

        </div>

        <div className="min-w-0 space-y-6">
          <Panel title="بيانات الوثيقة">
            {canEdit ? (
              <MetaForm
                waqfId={id}
                docId={doc.id}
                canLower={can("documents.approve")}
                doc={{ title: doc.title, docType: doc.docType, number: doc.number, issuer: doc.issuer, issuedOn: doc.issuedOn, issuedOnHijri: doc.issuedOnHijri, expiresOn: doc.expiresOn, retentionUntil: doc.retentionUntil, confidentiality: doc.confidentiality }}
              />
            ) : (
              <DefinitionList
                cols={1}
                items={[
                  { label: "الرقم", value: doc.number ? <bdi dir="auto">{doc.number}</bdi> : "—" },
                  { label: "جهة الإصدار", value: doc.issuer ?? "—" },
                  { label: "تاريخ الإصدار", value: <Issued on={doc.issuedOn} hijri={doc.issuedOnHijri} /> },
                  { label: "تاريخ الانتهاء", value: <Expiry on={doc.expiresOn} /> },
                  { label: "الحفظ حتى", value: doc.retentionUntil ? fmtDate(doc.retentionUntil) : "—" },
                ]}
              />
            )}
            <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4 text-[14px]">
              <div><dt className="text-muted">رفعها</dt><dd>{owner ?? "—"}</dd></div>
              <div><dt className="text-muted">أُنشئت</dt><dd>{fmtDate(doc.createdAt)}</dd></div>
              {canEdit ? <div className="col-span-2"><dt className="text-muted">الانتهاء</dt><dd><Expiry on={doc.expiresOn} /></dd></div> : null}
            </dl>
          </Panel>

          {can("documents.approve") && doc.status === "active" && !doc.archivedAt && doc.approvalStatus !== "approved" && doc.approvalStatus !== "locked" ? (
            <Panel title="الاعتماد">
              {isUploader ? (
                <p className="text-[15px] text-muted">لا يمكنك اعتماد وثيقة رفعتها بنفسك. يعتمدها عضو آخر يملك صلاحية الاعتماد.</p>
              ) : (
                <>
                  <p className="mb-3 text-[15px] text-muted">راجع النسخة الحالية ({doc.currentVersion}) قبل اعتمادها.</p>
                  <ApproveForm waqfId={id} docId={doc.id} />
                </>
              )}
            </Panel>
          ) : null}

          {can("documents.share") && doc.status === "active" && !doc.archivedAt ? (
            <Panel title="روابط المشاركة" description="رابط مؤقت يتيح تنزيل النسخة الحالية دون تسجيل دخول.">
              {doc.confidentiality === "secret" ? (
                <p className="text-[15px] text-muted">الوثائق «السرية جدًا» لا تُشارك بروابط عامة.</p>
              ) : (
                <ShareForm waqfId={id} docId={doc.id} />
              )}
              {shares.length ? (
                <ul className="mt-4 divide-y divide-line border-t border-line">
                  {shares.map(({ s, by }) => {
                    const expired = s.expiresAt.getTime() < now;
                    const used = s.uses >= s.maxUses;
                    const active = !s.revokedAt && !expired && !used;
                    return (
                      <li key={s.id} className="flex flex-wrap items-center gap-2 py-2.5 text-[14px]">
                        <Link2 aria-hidden className="size-4 text-muted" />
                        <span className="min-w-0 flex-1">
                          {by ?? "—"} · {fmtDateTime(s.createdAt)}
                          <span className="block text-[13px] text-muted">
                            استُخدم {s.uses} من {s.maxUses} · ينتهي {fmtDateTime(s.expiresAt)}
                          </span>
                        </span>
                        {active ? (
                          <RevokeShareForm waqfId={id} docId={doc.id} shareId={s.id} />
                        ) : (
                          <Badge tone="neutral" icon={false}>{s.revokedAt ? "ملغى" : expired ? "منتهٍ" : "استُنفد"}</Badge>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </Panel>
          ) : null}

          <Panel title="مرتبطة بـ">
            {links.length ? (
              <ul className="space-y-2">
                {links.map((l) => {
                  const href = entityHref(id, l.entityType, l.entityId);
                  const label = ENTITY_LABEL[l.entityType] ?? l.entityType;
                  return (
                    <li key={`${l.entityType}:${l.entityId}`} className="text-[15px]">
                      {href ? <Link href={href} className="text-ink hover:underline">{label}</Link> : label}
                      <span className="ms-2 text-[12px] text-muted" dir="ltr">{l.entityId.slice(0, 8)}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[15px] text-muted">{doc.requestId ? <Link href={`/app/requests/${doc.requestId}`} className="text-ink hover:underline">طلب الخدمة المرتبط</Link> : "غير مرتبطة بسجلات أخرى."}</p>
            )}
          </Panel>

          {can("documents.approve") && doc.approvalStatus !== "locked" ? (
            <Panel title={doc.archivedAt ? "استعادة" : "الأرشفة"}>
              <p className="mb-3 text-[14px] text-muted">
                {doc.archivedAt ? "تعيد الوثيقة إلى القائمة." : "لا تُحذف الوثائق النظامية. الأرشفة تخفيها من القائمة وتلغي روابط المشاركة."}
                {doc.retentionUntil ? ` تُحفظ حتى ${fmtDate(doc.retentionUntil)}.` : ""}
              </p>
              <ArchiveForm waqfId={id} docId={doc.id} archived={!!doc.archivedAt} />
            </Panel>
          ) : null}
        </div>
      </div>

      {canSeeLog ? (
        <Panel title="سجل الاطلاع" description="من اطّلع على الوثيقة أو نزّلها أو عدّلها، ومتى." tight>
          <div className="px-3 md:px-1">
            <DataTable
              caption="سجل الاطلاع"
              rows={log.slice(0, 20)}
              rowKey={(r) => r.id}
              empty={<p className="px-4 py-6 text-center text-muted">لا توجد عمليات بعد.</p>}
              columns={logColumns}
            />
          </div>
          {log.length > 20 ? (
            <details className="border-t border-line">
              <summary className="cursor-pointer px-4 py-3 text-sm text-ink">اعرض {log.length - 20} عملية أقدم</summary>
              <div className="px-3 md:px-1">
                <DataTable caption="عمليات أقدم" rows={log.slice(20)} rowKey={(r) => r.id} columns={logColumns} />
              </div>
            </details>
          ) : null}
        </Panel>
      ) : null}
    </div>
  );
}
