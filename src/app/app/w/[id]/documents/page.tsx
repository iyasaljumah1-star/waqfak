import type { Metadata } from "next";
import Link from "next/link";
import { FolderLock, Search } from "lucide-react";
import { requireAuth, requireWaqf, waqfCan } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { listWaqfDocuments, parseFilters } from "@/server/modules/documents/queries";
import { CONF_OPTIONS, DOC_TYPES, DOC_TYPE_OPTIONS, EXPIRING_SOON_DAYS, docTypeLabel } from "@/server/modules/documents/labels";
import { Badge, ButtonLink, DataTable, EmptyState, PageHeader, Panel, buttonClass } from "@/components/ui";
import { ANCHOR_PRIMARY_FIX, ApprovalBadge, ConfBadge, DocumentUploader, Expiry, Issued, RequiredDocuments } from "@/components/documents";
import { daysUntil } from "@/lib/utils";

export const metadata: Metadata = { title: "الوثائق" };

const control =
  "block h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-[15px] focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/20";

export default async function DocumentsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const auth = await requireAuth({ next: `/app/w/${id}/documents` });
  const access = await requireWaqf(auth, id, "documents.view");
  const sp = await searchParams;
  const f = parseFilters(sp);
  const uploadType = typeof sp.upload === "string" && (DOC_TYPES as readonly string[]).includes(sp.upload) ? sp.upload : undefined;
  const docs = await read(auth, (tx) => listWaqfDocuments(tx, id, { userId: auth.user.id, perms: access.perms }, f));
  const canUpload = waqfCan(access, "documents.upload");
  const filtered = !!(f.type || f.conf || f.expiring || f.q || f.archived);

  const groups = DOC_TYPES.map((t) => ({ type: t, rows: docs.filter((d) => d.docType === t) })).filter((g) => g.rows.length);
  const other = docs.filter((d) => !(DOC_TYPES as readonly string[]).includes(d.docType));
  if (other.length) groups.push({ type: "other", rows: [...(groups.find((g) => g.type === "other")?.rows ?? []), ...other] });

  const expiring = docs.filter((d) => {
    const n = daysUntil(d.expiresOn);
    return n !== null && n <= EXPIRING_SOON_DAYS;
  }).length;
  const pending = docs.filter((d) => d.approvalStatus === "in_review").length;
  const base = `/app/w/${id}/documents`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="الوثائق"
        description="وثائق الوقف محفوظة مشفّرة، ويطّلع عليها كل عضو بحسب درجة سريتها."
        crumbs={[{ href: `/app/w/${id}`, label: access.waqf.name }, { label: "الوثائق" }]}
        actions={canUpload ? <a href="#upload" className={buttonClass("primary", "md", `2xl:hidden ${ANCHOR_PRIMARY_FIX}`)}>رفع وثيقة</a> : undefined}
      />

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <form method="get" role="search" aria-label="تصفية الوثائق" className="space-y-3 rounded-lg border border-line bg-surface p-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_1fr_1fr]">
              <label className="relative block sm:col-span-2 xl:col-span-1">
                <span className="sr-only">ابحث بالعنوان أو الرقم</span>
                <Search aria-hidden className="pointer-events-none absolute start-3 top-3 size-5 text-muted" />
                <input name="q" type="search" defaultValue={f.q ?? ""} placeholder="ابحث بالعنوان أو الرقم أو الجهة" className={`${control} ps-10`} />
              </label>
              <label className="block">
                <span className="sr-only">النوع</span>
                <select name="type" defaultValue={f.type ?? ""} className={control}>
                  <option value="">كل الأنواع</option>
                  {DOC_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="sr-only">درجة السرية</span>
                <select name="conf" defaultValue={f.conf ?? ""} className={control}>
                  <option value="">كل درجات السرية</option>
                  {CONF_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <label className="flex items-center gap-2 text-[15px]">
                <input type="checkbox" name="expiring" value="1" defaultChecked={f.expiring} className="size-4 accent-[var(--ink)]" />
                تنتهي خلال {EXPIRING_SOON_DAYS} يومًا أو منتهية
              </label>
              <label className="flex items-center gap-2 text-[15px]">
                <input type="checkbox" name="archived" value="1" defaultChecked={f.archived} className="size-4 accent-[var(--ink)]" />
                المؤرشفة فقط
              </label>
              <div className="ms-auto flex gap-2">
                {filtered ? <Link href={base} className={buttonClass("ghost", "sm")}>امسح التصفية</Link> : null}
                <button type="submit" className={buttonClass("secondary", "sm")}>طبّق</button>
              </div>
            </div>
          </form>

          {!filtered ? <RequiredDocuments waqfId={id} /> : null}

          {!filtered && docs.length ? (
            <p className="flex flex-wrap items-center gap-2 text-[15px] text-muted">
              <span>{docs.length} وثيقة</span>
              {expiring ? <Link href={`${base}?expiring=1`}><Badge tone="warn">{expiring} تقترب من الانتهاء أو انتهت</Badge></Link> : null}
              {pending ? <Badge tone="info" icon={false}>{pending} بانتظار الاعتماد</Badge> : null}
            </p>
          ) : null}

          {groups.length ? (
            groups.map((g) => (
              <Panel key={g.type} title={`${docTypeLabel(g.type)} (${g.rows.length})`} tight>
                <div className="px-3 md:px-1">
                  <DataTable
                    caption={docTypeLabel(g.type)}
                    rows={g.rows}
                    rowKey={(r) => r.id}
                    columns={[
                      {
                        key: "title",
                        label: "الوثيقة",
                        render: (r) => (
                          <span className="block min-w-0">
                            <Link href={`${base}/${r.id}`} className="font-medium text-ink hover:underline">{r.title}</Link>
                            {r.number ? <span className="block text-[13px] text-muted">رقم <bdi dir="auto">{r.number}</bdi></span> : null}
                            {r.status !== "active" && r.status !== "archived" ? <Badge tone={r.status === "rejected" ? "critical" : "warn"} className="mt-1">{r.status === "rejected" ? "رُفض في الفحص" : "قيد الفحص"}</Badge> : null}
                          </span>
                        ),
                      },
                      { key: "issuer", label: "الجهة المصدرة", hideOnMobile: true, render: (r) => r.issuer ?? <span className="text-muted">—</span> },
                      { key: "issued", label: "الإصدار", hideOnMobile: true, render: (r) => <Issued on={r.issuedOn} hijri={r.issuedOnHijri} /> },
                      { key: "expires", label: "الانتهاء", render: (r) => <Expiry on={r.expiresOn} /> },
                      { key: "ver", label: "النسخة", className: "tabular w-16", render: (r) => r.currentVersion },
                      {
                        key: "state",
                        label: "الحالة",
                        render: (r) => (
                          <span className="flex flex-wrap gap-1">
                            <ApprovalBadge s={r.approvalStatus} />
                            <ConfBadge c={r.confidentiality} />
                          </span>
                        ),
                      },
                    ]}
                  />
                </div>
              </Panel>
            ))
          ) : (
            <EmptyState icon={FolderLock} title={filtered ? "لا وثائق تطابق التصفية" : "لا توجد وثائق بعد"}
              action={filtered ? <ButtonLink href={base} variant="secondary" size="sm">امسح التصفية</ButtonLink> : undefined}>
              {filtered ? "غيّر معايير البحث أو امسحها لعرض كل الوثائق." : canUpload ? "ابدأ برفع صك الوقف وشهادة التسجيل وصكوك الأصول." : "لم تُرفع وثائق يمكنك الاطلاع عليها."}
            </EmptyState>
          )}
        </div>

        {canUpload ? (
          <aside id="upload" className="scroll-mt-20">
            <div className="2xl:sticky 2xl:top-20">
              <Panel title="رفع وثيقة" description="يُفحص الملف ويُشفّر قبل حفظه.">
                <DocumentUploader waqfId={id} defaultDocType={uploadType} />
              </Panel>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
