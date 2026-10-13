import Link from "next/link";
import { ArrowLeft, ClipboardList, Gauge, History, Users } from "lucide-react";
import { Alert, Badge, DefinitionList, EmptyState, Panel, Steps } from "@/components/ui";
import { ActionLink } from "@/components/portal/action-link";
import { JOURNEY_STAGES, OBLIGATION_STATUS_LABEL, REQUEST_STATUS_LABEL, RESULT_STATUS_LABEL, RESULT_STATUS_TONE } from "@/components/portal/labels";
import { WaqfProfileForm } from "@/components/portal/waqf-profile-form";
import { cn, fmtBoth, fmtDate, fmtNumber, relDays, SIZE_LABEL } from "@/lib/utils";
import { requireAuth, waqfCan } from "@/server/authz/context";
import { roleName } from "@/server/authz/catalog";
import { waqfAccess, waqfOverview } from "@/server/modules/waqf-core/queries";
import { currentEngagement } from "@/server/modules/nazara/queries";
import { STATUS_AR as NAZARA_STATUS_AR } from "@/server/modules/nazara/pure";
import { read } from "@/server/modules/_shared";
import { waqfCenterData } from "@/server/modules/operations/waqf-center-server";
import { WaqfCenterPanel } from "@/components/operations/waqf-center";

export const metadata = { title: "نظرة عامة" };

const OBL_ORDER = ["overdue", "due_soon", "upcoming", "done", "waived"] as const;
const CONFIDENCE: Record<string, string> = { low: "منخفضة", medium: "متوسطة", high: "عالية" };

function SectionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-sm text-ink hover:underline">
      {children}
      <ArrowLeft aria-hidden className="size-3.5" />
    </Link>
  );
}

export default async function WaqfOverview({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string; saved?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const auth = await requireAuth({ next: `/app/w/${id}` });
  const access = await waqfAccess(auth, id);
  const w = access.waqf;
  const base = `/app/w/${id}`;
  const data = await waqfOverview(auth, id);
  const nazara = await currentEngagement(auth, id);
  const can = (p: Parameters<typeof waqfCan>[1]) => waqfCan(access, p);
  const stage = Math.min(5, Math.max(1, w.stage || 1));
  const flags = [
    w.collectsDonations && "يجمع تبرعات",
    w.hasForeignParty && "له طرف أجنبي",
    w.hasBeneficiariesAbroad && "مستفيدون خارج المملكة",
    w.hasActiveLitigation && "دعوى قضائية قائمة",
  ].filter(Boolean) as string[];
  // People listed as beneficiaries are only shown to roles that may see the beneficiary register.
  const members = data.members.filter((m) => m.roleKey !== "beneficiary" || can("beneficiaries.view"));
  const totalObl = OBL_ORDER.reduce((n, k) => n + (data.oblCounts[k] ?? 0), 0);
  const editing = sp.edit === "1" && can("waqf.edit");
  const showCenter = can("compliance.view") || can("waqf.edit");
  const center = showCenter ? await read(auth, (tx) => waqfCenterData(tx, id)) : null;
  const centerItems = center ? center.items.filter((i) => can(i.perm as Parameters<typeof waqfCan>[1])) : [];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());

  return (
    <div className="space-y-6">
      {sp.saved === "1" ? (
        <Alert tone="ok" title="حُفظ ملف الوقف">أعدنا حساب الالتزامات النظامية ومواعيدها وفق البيانات الجديدة، وسُجّل التعديل في سجل العمليات.</Alert>
      ) : null}
      {nazara ? (
        <Alert tone={nazara.status === "active" ? "ok" : nazara.status === "suspended" ? "warn" : "info"} title={`نظارة «وقفك» على الوقف: ${NAZARA_STATUS_AR[nazara.status as keyof typeof NAZARA_STATUS_AR] ?? nazara.status}${nazara.isPractice ? " (تجريبية)" : ""}`}>
          {nazara.status === "active"
            ? `تتولى «وقفك» نظارة هذا الوقف بصفتها ناظرًا اعتباريًا منذ ${fmtDate(nazara.startedOn)}. تجد تقاريرها المعتمدة في «التقارير».`
            : ["intake", "under_review", "pending_completion", "accepted"].includes(nazara.status)
              ? "طلب تولي النظارة قيد الاستلام والدراسة لدى فريق «وقفك»."
              : null}
          {auth.perms.has("nazara.view") ? <div className="mt-1"><SectionLink href={`/admin/nazara/${nazara.id}`}>ملف النظارة في لوحة الفريق</SectionLink></div> : null}
        </Alert>
      ) : null}
      {data.overdue.length ? (
        <Alert tone="critical" title={`${fmtNumber(data.overdue.length)} التزام نظامي فات موعده`}>
          <ul className="mt-1 space-y-1">
            {data.overdue.slice(0, 3).map((o) => (
              <li key={o.id}>
                <span className="font-medium">{o.title}</span> — {relDays(o.dueOn)}، كان الموعد {fmtBoth(o.dueOn)}
              </li>
            ))}
          </ul>
          {can("compliance.view") ? <div className="mt-2"><SectionLink href={`${base}/compliance`}>عالجها من الامتثال والمواعيد</SectionLink></div> : null}
        </Alert>
      ) : null}

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          {editing ? (
            <Panel id="profile" title="تعديل ملف الوقف" description="ما تحفظه هنا يحدد الالتزامات النظامية ومواعيدها، ويُسجَّل في سجل العمليات.">
              <WaqfProfileForm
                waqfId={id}
                today={today}
                cancelHref={base}
                sizeLabel={w.sizeClass ? SIZE_LABEL[w.sizeClass] : "غير محددة"}
                sizeLocked={w.sizeClassLocked}
                values={{
                  name: w.name, deedNo: w.deedNo, deedDate: w.deedDate, deedDateHijri: w.deedDateHijri, documentedOn: w.documentedOn, registeredOn: w.registeredOn,
                  registrationExpiresOn: w.registrationExpiresOn, nationalUnifiedNumber: w.nationalUnifiedNumber, legalType: w.legalType, nazirMode: w.nazirMode,
                  fiscalYearEnd: w.fiscalYearEnd, collectsDonations: w.collectsDonations, hasForeignParty: w.hasForeignParty,
                  hasBeneficiariesAbroad: w.hasBeneficiariesAbroad, hasActiveLitigation: w.hasActiveLitigation,
                }}
              />
            </Panel>
          ) : (
          <Panel
            id="profile"
            title="بيانات أساسية"
            actions={
              <>
                {can("deed.view") ? <SectionLink href={`${base}/deed`}>الوثيقة والشروط</SectionLink> : null}
                {can("waqf.edit") ? <ActionLink href={`${base}?edit=1#profile`} variant="secondary" size="sm">تعديل</ActionLink> : null}
              </>
            }
          >
            <DefinitionList
              items={[
                { label: "الرقم الداخلي", value: <span dir="ltr" className="tabular">{w.internalNumber}</span> },
                { label: "الرقم الوطني الموحد", value: w.nationalUnifiedNumber ? <span dir="ltr" className="tabular">{w.nationalUnifiedNumber}</span> : "لم يُدخل" },
                { label: "رقم الصك", value: w.deedNo ? <span dir="ltr" className="tabular">{w.deedNo}</span> : "لم يُدخل" },
                { label: "تاريخ الصك", value: w.deedDate ? fmtBoth(w.deedDate) : w.deedDateHijri ?? "لم يُدخل" },
                { label: "تاريخ التوثيق", value: w.documentedOn ? fmtBoth(w.documentedOn) : "لم يُدخل" },
                { label: "تاريخ التسجيل لدى الهيئة", value: w.registeredOn ? fmtBoth(w.registeredOn) : "غير مسجّل بعد" },
                ...(w.registrationExpiresOn ? [{ label: "انتهاء شهادة التسجيل", value: fmtBoth(w.registrationExpiresOn) }] : []),
                { label: "نهاية السنة المالية", value: <span dir="ltr" className="tabular">{w.fiscalYearEnd}</span>, hint: "الشهر-اليوم" },
                { label: "أوضاع تترتب عليها التزامات", value: flags.length ? flags.join("، ") : "لا شيء مما يلزم الإفصاح عنه" },
                ...(w.computedTypeReason ? [{ label: "سبب التصنيف", value: w.computedTypeReason }] : []),
              ]}
            />
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3">
              <SectionLink href={`${base}/identity`}>الهوية والتسجيل</SectionLink>
              <SectionLink href={`${base}/parties`}>الأطراف والنظارة</SectionLink>
              {can("documents.view") ? <SectionLink href={`${base}/documents`}>الوثائق</SectionLink> : null}
              {can("assets.view") ? <SectionLink href={`${base}/assets`}>الأصول</SectionLink> : null}
              {can("governance.view") ? <SectionLink href={`${base}/governance`}>الحوكمة</SectionLink> : null}
              {can("waqf.members.manage") ? <SectionLink href={`${base}/settings`}>الأعضاء والإعدادات</SectionLink> : null}
            </div>
          </Panel>
          )}

          {center ? (
            <WaqfCenterPanel items={centerItems} nazara={center.nazara} counts={{ required: centerItems.filter((i) => i.state === "required").length, soon: centerItems.filter((i) => i.state === "soon").length, done: centerItems.filter((i) => i.state === "done").length }}
              nazaraHref={auth.perms.has("nazara.view") && center.facts.nazara ? `/admin/nazara/${center.facts.nazara.id}` : null} />
          ) : null}

          {can("compliance.view") ? (
            <Panel title="الامتثال" description="حالة الالتزامات النظامية المترتبة على هذا الوقف." actions={<SectionLink href={`${base}/compliance`}>كل الالتزامات</SectionLink>}>
              {totalObl ? (
                <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-5 [&>div:last-child]:col-span-2 sm:[&>div:last-child]:col-span-1">
                  {OBL_ORDER.map((k) => {
                    const n = data.oblCounts[k] ?? 0;
                    const hot = k === "overdue" && n > 0;
                    return (
                      <div key={k} className={cn("bg-surface px-3 py-2.5", hot && "bg-critical-soft")}>
                        <dt className={cn("text-[13px]", hot ? "font-semibold text-critical" : "text-muted")}>{OBLIGATION_STATUS_LABEL[k]}</dt>
                        <dd className={cn("tabular text-xl font-semibold", hot ? "text-critical" : n ? "text-text" : "text-muted")}>{fmtNumber(n)}</dd>
                      </div>
                    );
                  })}
                </dl>
              ) : (
                <p className="text-sm text-muted">
                  لا التزامات محسوبة لهذا الوقف بعد. تُحسب تلقائيًا من تواريخ التوثيق والتسجيل وفئة الوقف؛ أكمل هذه البيانات إن كانت ناقصة.
                </p>
              )}
            </Panel>
          ) : null}

          {can("requests.view") ? (
            <Panel
              title="طلبات مفتوحة"
              actions={
                <>
                  <SectionLink href={`${base}/requests`}>كل الطلبات</SectionLink>
                  {can("requests.create") ? <ActionLink size="sm" href={`/app/requests/new?waqf=${id}`}>اطلب خدمة</ActionLink> : null}
                </>
              }
              tight
            >
              {data.openReqs.length ? (
                <ul className="divide-y divide-line">
                  {data.openReqs.map((r) => (
                    <li key={r.id}>
                      <Link href={`/app/requests/${r.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-surface-2 md:px-5">
                        <span className="min-w-0 flex-1 font-medium">{r.service}</span>
                        <span dir="ltr" className="tabular text-[13px] text-muted">{r.number}</span>
                        <Badge tone={r.status === "awaiting_client" || r.status === "awaiting_client_approval" ? "warn" : "info"} icon={false}>
                          {REQUEST_STATUS_LABEL[r.status] ?? r.status}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="p-4 md:p-5">
                  <EmptyState icon={ClipboardList} title="لا طلبات مفتوحة">
                    اطلب خدمة متخصصة لهذا الوقف من كتالوج الخدمات، وتابع مراحلها هنا.
                  </EmptyState>
                </div>
              )}
            </Panel>
          ) : null}

          <Panel title="آخر الأحداث" actions={can("audit.view_waqf") ? <SectionLink href={`${base}/audit`}>سجل العمليات</SectionLink> : null}>
            {data.timeline.length ? (
              <ol className="space-y-3">
                {data.timeline.map((e) => (
                  <li key={e.id} className="grid gap-x-4 sm:grid-cols-[9rem_1fr]">
                    <time dateTime={e.occurredOn} className="text-[13px] text-muted">{fmtDate(e.occurredOn)}</time>
                    <div>
                      <p className="font-medium">{e.title}</p>
                      {e.details ? <p className="text-sm text-muted">{e.details}</p> : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState icon={History} title="لا أحداث مسجّلة بعد">التوثيق والتسجيل والقرارات المهمة تظهر هنا بترتيب زمني.</EmptyState>
            )}
          </Panel>
        </div>

        <div className="min-w-0 space-y-6">
          <Panel title="مسار الوقف">
            <Steps
              steps={JOURNEY_STAGES.map((label, i) => ({
                label,
                status: i + 1 < stage ? "done" : i + 1 === stage ? "active" : "pending",
                meta: i + 1 === stage ? "المرحلة الحالية" : undefined,
              }))}
            />
          </Panel>

          {can("assessment.view") ? (
            <Panel title="آخر تقييم" actions={<SectionLink href={`${base}/assessments`}>التقييمات</SectionLink>}>
              {data.latest ? (
                <div className="space-y-2">
                  <p className="flex items-baseline gap-2">
                    <span className="tabular text-3xl font-semibold text-ink">{fmtNumber(data.latest.overallScore)}</span>
                    <span className="text-sm text-muted">من 100</span>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={RESULT_STATUS_TONE[data.latest.status] ?? "neutral"}>{RESULT_STATUS_LABEL[data.latest.status] ?? data.latest.status}</Badge>
                    <Badge icon={false}>النضج: {data.latest.maturityLevel}</Badge>
                  </div>
                  <p className="text-[13px] text-muted">
                    {data.latest.kind === "deep" ? "تقييم معمّق" : "تقييم أساسي"} · ثقة {CONFIDENCE[data.latest.confidence] ?? data.latest.confidence} · {fmtDate(data.latest.computedAt)}
                  </p>
                </div>
              ) : (
                <EmptyState icon={Gauge} title="لم يُقيَّم الوقف بعد" action={can("assessment.run") ? <ActionLink size="sm" variant="secondary" href={`/assessment?waqf=${id}`}>ابدأ التقييم</ActionLink> : undefined}>
                  التقييم يكشف الفجوات النظامية ويقترح ما يعالجها.
                </EmptyState>
              )}
            </Panel>
          ) : null}

          <Panel title="الأطراف في المنصة" actions={can("waqf.members.manage") ? <SectionLink href={`${base}/settings`}>إدارة الأعضاء</SectionLink> : null} tight>
            {members.length ? (
              <ul className="divide-y divide-line">
                {members.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5 md:px-5">
                    <span className="min-w-0 truncate">{m.name ?? "—"}{m.userId === auth.user.id ? <span className="text-muted"> (أنت)</span> : null}</span>
                    <span className="shrink-0 text-[13px] text-muted">{roleName(m.roleKey)}{m.isIndependent ? " · مستقل" : ""}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-4"><EmptyState icon={Users} title="لا أعضاء نشطون" /></div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
