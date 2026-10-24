import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Alert, Badge, DataTable, DefinitionList, PageHeader, Panel } from "@/components/ui";
import { ActionLink } from "@/components/portal/action-link";
import { actionLabel } from "@/components/admin/labels";
import { fmtBoth, fmtDate, fmtDateTime, fmtSAR, NAZIR_MODE_LABEL, relDays, SIZE_LABEL, STATUS_LABEL, TYPE_LABEL, WAQFAK_ROLE_LABEL } from "@/lib/utils";
import { requireStaff } from "@/server/authz/context";
import { roleName } from "@/server/authz/catalog";
import { hasActiveBreakGlass, recordBreakGlassView } from "@/server/modules/admin/breakglass/queries";
import { waqfSummary } from "@/server/modules/admin/waqfs/queries";
import { STATUS_LABEL as REQ_STATUS } from "@/server/modules/requests/workflow";
import { STATUS_AR as NAZARA_STATUS } from "@/server/modules/nazara/pure";
import { read } from "@/server/modules/_shared";
import { waqfCenterData } from "@/server/modules/operations/waqf-center-server";
import { WaqfCenterPanel } from "@/components/operations/waqf-center";
import { fileReviews } from "@/server/modules/waqf-core/file-review";
import { completenessOf } from "@/server/modules/waqf-core/completeness";
import { FileReviews } from "@/components/waqf/file-reviews";

export const metadata: Metadata = { title: "ملف وقف" };

const OBL_TONE: Record<string, "critical" | "fine" | "neutral"> = { overdue: "critical", due_soon: "fine", upcoming: "neutral" };
const OBL_LABEL: Record<string, string> = { overdue: "متأخر", due_soon: "يقترب", upcoming: "قادم" };

export default async function AdminWaqfPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff("admin.access");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const all = auth.perms.has("admin.waqfs.all");
  const grant = all ? null : await hasActiveBreakGlass(auth, id);
  if (!all && !grant) redirect("/admin?denied=1");
  const d = await waqfSummary(auth, id);
  if (!d) notFound();
  if (grant) await recordBreakGlassView(auth, id, grant.id, `/admin/waqfs/${id}`);
  const w = d.waqf;
  const overdue = d.obligations.filter((o) => o.status === "overdue").length;
  const center = await read(auth, (tx) => waqfCenterData(tx, id));
  const editor = auth.perms.has("admin.waqfs.edit");
  const [reviews, comp] = await read(auth, (tx) => Promise.all([all ? fileReviews(tx, id, { limit: 20 }) : Promise.resolve([]), completenessOf(tx, [id])]));
  const fileState = comp.get(id);

  return (
    <div>
      <PageHeader
        title={w.name}
        crumbs={[{ href: all ? "/admin/waqfs" : "/admin/users/break-glass", label: all ? "الأوقاف" : "الوصول الطارئ" }, { label: w.internalNumber }]}
        description={
          <span className="flex flex-wrap items-center gap-1.5 pt-1">
            <span dir="ltr" className="tabular text-[14px]">{w.internalNumber}</span>
            <Badge tone={w.status === "active" || w.status === "registered" ? "ok" : "neutral"} icon={false}>{STATUS_LABEL[w.status]}</Badge>
            {w.legalType ? <Badge tone="neutral" icon={false}>{TYPE_LABEL[w.legalType]}</Badge> : null}
            {w.sizeClass ? <Badge tone="neutral" icon={false}>{SIZE_LABEL[w.sizeClass]}</Badge> : null}
            {w.isDemo ? <Badge tone="seal" icon={false}>تجريبي</Badge> : null}
            {overdue ? <Badge tone="critical">{overdue} التزام متأخر</Badge> : null}
          </span>
        }
        actions={all ? <ActionLink href={`/app/w/${w.id}`} variant={editor ? "primary" : "secondary"} data-testid="open-file"><ExternalLink aria-hidden className="size-4" />{editor ? "استكمال ملف الوقف وتعديله" : "فتح ملف الوقف الكامل"}</ActionLink> : undefined}
      />
      {grant ? (
        <Alert tone="critical" title="تطلع عبر وصول طارئ" className="mb-6">
          ينتهي {fmtDateTime(grant.expiresAt)}. كل اطلاع هنا يُسجل في سجل العمليات وسجل الوقف، ويراه ناظر الوقف.
        </Alert>
      ) : null}

      {fileState ? (
        <Alert tone={fileState.complete ? "ok" : "warn"} title={fileState.complete ? "ملف وقف مكتمل" : "ملف قيد الاستكمال"} className="mb-6">
          {fileState.complete ? "موثق وصكه في الوثائق، ومسجلة أصوله ومصارفه ونظارته." : `لا يُعد ضمن الأوقاف المكتملة: ${fileState.missing.join("، ")}.`}
        </Alert>
      ) : null}
      <div className="mb-6"><FileReviews reviews={reviews} waqfId={id} canReview={editor} viewerId={auth.user.id} staffView /></div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          {center ? <WaqfCenterPanel items={center.items} nazara={center.nazara} counts={center.counts} requestHref={(rid) => `/admin/requests/${rid}`} nazaraHref={center.facts.nazara && auth.perms.has("nazara.view") ? `/admin/nazara/${center.facts.nazara.id}` : null} /> : null}
          <Panel title="الالتزامات النظامية القادمة والمتأخرة" tight>
            {d.obligations.length ? (
              <ul className="divide-y divide-line">
                {d.obligations.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <span className="min-w-0 text-[15px]">{o.title}</span>
                    <span className="flex items-center gap-2 text-[13px] text-muted">
                      {o.dueOn ? `${fmtBoth(o.dueOn)} · ${relDays(o.dueOn)}` : "فوري"}
                      <Badge tone={OBL_TONE[o.status] ?? "neutral"} icon={false}>{OBL_LABEL[o.status] ?? o.status}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-muted">لا التزامات قائمة.</p>
            )}
          </Panel>
          {d.engagements.length ? (
            <Panel title="ملفات النظارة الاعتبارية">
              <ul className="space-y-1 text-[15px]">
                {d.engagements.map((e) => <li key={e.id}><Link className="text-ink hover:underline" href={`/admin/nazara/${e.id}`}><span dir="ltr" className="tabular">{e.number}</span></Link> — {NAZARA_STATUS[e.status as keyof typeof NAZARA_STATUS] ?? e.status}</li>)}
              </ul>
            </Panel>
          ) : null}
          <Panel title="الطلبات" tight>
            <div className="px-3 md:px-2">
              <DataTable
                rows={d.requests}
                rowKey={(r) => r.id}
                empty={<p className="p-4 text-muted">لا طلبات.</p>}
                columns={[
                  { key: "n", label: "الطلب", render: (r) => <Link href={`/admin/requests/${r.id}`} dir="ltr" className="tabular text-ink hover:underline">{r.number}</Link> },
                  { key: "s", label: "الخدمة", render: (r) => <>{r.service ?? "—"}{r.origin ? <Badge tone="seal" icon={false} className="ms-1">فتح الملف</Badge> : null}{r.engagement ? <span className="ms-1 text-[12px] text-muted">ملف النظارة {r.engagement}</span> : null}</> },
                  { key: "st", label: "الحالة", render: (r) => <Badge tone="neutral" icon={false}>{REQ_STATUS[r.status as keyof typeof REQ_STATUS] ?? r.status}</Badge> },
                  { key: "a", label: "المسند إليه", render: (r) => r.assignee ?? <span className="text-muted">غير مسند</span>, hideOnMobile: true },
                ]}
              />
            </div>
          </Panel>
          <Panel title="آخر العمليات على الملف" tight actions={auth.perms.has("admin.audit") ? <Link href={`/admin/audit?waqf=${w.id}`} className="text-sm text-ink hover:underline">السجل الكامل</Link> : undefined}>
            {d.recent.length ? (
              <ul className="divide-y divide-line">
                {d.recent.map((e) => (
                  <li key={e.id} className="flex flex-wrap justify-between gap-2 px-4 py-2 text-[15px]">
                    <span>{actionLabel(e.action) ?? e.action}</span>
                    <span className="text-[13px] text-muted">{fmtDateTime(e.at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-muted">لا عمليات.</p>
            )}
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="البيانات الأساسية">
            <DefinitionList
              cols={1}
              items={[
                { label: "الرقم الوطني الموحد", value: w.nationalUnifiedNumber ? <span dir="ltr" className="tabular">{w.nationalUnifiedNumber}</span> : "—" },
                { label: "صك الوقف", value: w.deedNo ? `${w.deedNo}${w.deedIssuer ? ` — ${w.deedIssuer}` : ""}` : "—" },
                { label: "تاريخ التسجيل", value: w.registeredOn ? fmtBoth(w.registeredOn) : "—" },
                { label: "النظارة", value: w.nazirMode ? NAZIR_MODE_LABEL[w.nazirMode] : "—" },
                { label: "دور وقفك", value: WAQFAK_ROLE_LABEL[w.waqfakRole] ?? w.waqfakRole },
                { label: "مرحلة الرحلة", value: <span className="tabular">{w.stage} / 5</span> },
                { label: "القيمة التقديرية للأصول", value: w.assetsEstimatedValue ? fmtSAR(w.assetsEstimatedValue) : "—" },
                { label: "أُنشئ في المنصة", value: fmtDate(w.createdAt) },
              ]}
            />
          </Panel>
          <Panel title={`الأطراف (${d.members.length})`}>
            <ul className="space-y-1.5 text-[15px]">
              {d.members.map((m, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2">
                  {auth.perms.has("admin.users") ? <Link href={`/admin/clients/${m.userId}`} className="hover:underline">{m.name ?? "—"}</Link> : <span>{m.name ?? "—"}</span>}
                  <span className="flex gap-1">
                    <Badge tone="ink" icon={false}>{roleName(m.roleKey)}</Badge>
                    {m.isIndependent ? <Badge tone="neutral" icon={false}>مستقل</Badge> : null}
                    {m.status !== "active" ? <Badge tone="neutral" icon={false}>منتهية</Badge> : null}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="الفواتير">
            {d.invoices.length ? (
              <ul className="space-y-1.5 text-[15px]">
                {d.invoices.map((i) => (
                  <li key={i.id} className="flex justify-between gap-2">
                    <Link href={`/admin/finance/${i.id}`} dir="ltr" className="tabular text-ink hover:underline">{i.number}</Link>
                    <span>{fmtSAR(i.total)} <span className="text-[13px] text-muted">· {i.status === "paid" ? "مسددة" : i.status === "void" ? "ملغاة" : "مستحقة"}</span></span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">لا فواتير على الوقف.</p>
            )}
          </Panel>
          {d.assessments.length ? (
            <Panel title="التقييمات">
              <ul className="space-y-1.5 text-[15px]">
                {d.assessments.map((a) => (
                  <li key={a.id} className="flex justify-between gap-2">
                    <span>{a.kind === "deep" ? "تقييم معمّق" : "تقييم أساسي"}</span>
                    <span className="text-[13px] text-muted">{a.completedAt ? fmtDate(a.completedAt) : "لم يكتمل"}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
