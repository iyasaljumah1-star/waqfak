import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ClipboardList, Gauge, HeartHandshake, Landmark, ListChecks, Plus, ShieldAlert, Sprout } from "lucide-react";
import { Alert, Badge, PageHeader } from "@/components/ui";
import { ActionLink as ButtonLink } from "@/components/portal/action-link";
import { OBLIGATION_STATUS_TONE, STATUS_TONE } from "@/components/portal/labels";
import { StageMeter } from "@/components/portal/stage";
import { fmtBoth, NAZIR_MODE_LABEL, relDays, SIZE_LABEL, STATUS_LABEL, TYPE_LABEL } from "@/lib/utils";
import { requireAuth } from "@/server/authz/context";
import { roleName } from "@/server/authz/catalog";
import { dashboardData, myWaqfs } from "@/server/modules/portal/queries";

export const metadata: Metadata = { title: "الرئيسية" };

const STARTS = [
  { href: "/assessment", icon: Gauge, title: "قيّم وقفك", text: "أسئلة قصيرة تكشف وضع الوقف النظامي ومواطن الخطر، وتخرج بتوصيات مرتبة." },
  { href: "/app/establish", icon: Sprout, title: "أسّس وقفًا جديدًا", text: "معالج يرتب معك الأصل والمصارف والنظارة ويجهز مسودة الوثيقة للتوثيق." },
  { href: "/app/waqfs/new", icon: Landmark, title: "سجّل وقفًا قائمًا", text: "أدخل بيانات صك وقف موثّق، ونبني له ملفًا والتزامات بمواعيدها." },
] as const;

export default async function Dashboard() {
  const auth = await requireAuth({ next: "/app" });
  const waqfs = await myWaqfs(auth);
  const managed = waqfs.filter((w) => !w.beneficiaryOnly);
  const benef = waqfs.filter((w) => w.beneficiaryOnly);
  const data = await dashboardData(auth, managed.map((w) => w.id));
  const firstName = (auth.user.fullName ?? "").trim().split(/\s+/)[0] || "";

  return (
    <div className="space-y-8">
      <PageHeader
        title={firstName ? `أهلًا ${firstName}` : "أهلًا بك"}
        description={managed.length ? "ما يستحق انتباهك في أوقافك، مرتبًا بالأقرب موعدًا." : "حسابك جاهز. اختر من أين تبدأ."}
        actions={
          managed.length ? (
            <>
              <ButtonLink href="/app/services" variant="primary" size="sm"><ClipboardList aria-hidden className="size-4" />اطلب خدمة</ButtonLink>
              <ButtonLink href="/assessment" variant="secondary" size="sm">قيّم وقفك</ButtonLink>
              <ButtonLink href="/app/establish" variant="secondary" size="sm">أسّس وقفًا جديدًا</ButtonLink>
              <ButtonLink href="/app/waqfs/new" variant="secondary" size="sm"><Plus aria-hidden className="size-4" />سجّل وقفًا قائمًا</ButtonLink>
            </>
          ) : null
        }
      />

      {auth.isStaff ? (
        <Alert tone="ink" title="أنت موظف في وقفك" action={<ButtonLink href="/admin" size="sm" variant="primary"><ShieldAlert aria-hidden className="size-4" />لوحة الإدارة</ButtonLink>}>
          طلبات العملاء المسندة إليك وأدوات التشغيل في لوحة الإدارة.
        </Alert>
      ) : null}

      {managed.length ? (
        <section aria-labelledby="my-waqfs" className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="my-waqfs" className="text-lg font-semibold">أوقافك</h2>
            <Link href="/app/waqfs" className="text-sm text-ink hover:underline">عرض الكل</Link>
          </div>
          <ul className="space-y-3">
            {managed.map((w) => {
              const obl = data.obligations.get(w.id) ?? [];
              const overdue = data.overdue.get(w.id) ?? 0;
              const reqs = data.requests.get(w.id) ?? 0;
              const tsk = data.tasks.get(w.id) ?? 0;
              return (
                <li key={w.id} className="rounded-lg border border-line bg-surface">
                  <div className="flex flex-col gap-3 border-b border-line px-4 py-4 md:flex-row md:items-start md:justify-between md:px-5">
                    <div className="min-w-0">
                      <Link href={`/app/w/${w.id}`} className="font-naskh text-xl font-bold text-ink hover:underline">{w.name}</Link>
                      <p className="mt-0.5 text-[13px] text-muted">
                        <span dir="ltr" className="tabular">{w.internalNumber}</span> · بصفتك {w.roles.map(roleName).join("، ")}
                        {w.nazirMode ? <> · النظارة: {NAZIR_MODE_LABEL[w.nazirMode]}</> : null}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge tone={STATUS_TONE[w.status] ?? "neutral"} icon={false}>{STATUS_LABEL[w.status] ?? w.status}</Badge>
                        {w.legalType ? <Badge icon={false}>{TYPE_LABEL[w.legalType]}</Badge> : null}
                        {w.sizeClass ? <Badge icon={false}>{SIZE_LABEL[w.sizeClass]}</Badge> : null}
                      </div>
                    </div>
                    <StageMeter stage={w.stage} className="shrink-0" />
                  </div>
                  <div className="grid gap-4 px-4 py-4 md:grid-cols-[1fr_auto] md:px-5">
                    <div className="min-w-0">
                      <h3 className="mb-2 text-[13px] font-medium text-muted">الالتزامات القادمة</h3>
                      {obl.length ? (
                        <ul className="space-y-3">
                          {obl.map((o) => (
                            <li key={o.id} className="flex items-start justify-between gap-3">
                              <span className="min-w-0">
                                <span className="block font-medium">{o.title}</span>
                                {o.dueOn ? <span className="block text-[13px] text-muted">{fmtBoth(o.dueOn)}</span> : null}
                              </span>
                              {o.status === "overdue" || o.status === "due_soon" ? (
                                <span className="shrink-0"><Badge tone={OBLIGATION_STATUS_TONE[o.status]}>{relDays(o.dueOn)}</Badge></span>
                              ) : (
                                <span className="shrink-0 text-sm">{o.dueImmediately && !o.dueOn ? "فوري" : relDays(o.dueOn)}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-muted">لا التزامات مفتوحة مسجّلة لهذا الوقف حتى الآن.</p>
                      )}
                      <Link href={`/app/w/${w.id}/compliance`} className="mt-2 inline-flex items-center gap-1 text-sm text-ink hover:underline">
                        كل الالتزامات <ArrowLeft aria-hidden className="size-3.5" />
                      </Link>
                    </div>
                    <dl className="flex gap-6 md:flex-col md:gap-2 md:border-s md:border-line md:ps-5">
                      {overdue ? (
                        <div>
                          <dt className="text-[13px] text-muted">متأخرة</dt>
                          <dd className="tabular text-xl font-semibold text-critical">{overdue}</dd>
                        </div>
                      ) : null}
                      <div>
                        <dt className="text-[13px] text-muted">طلبات مفتوحة</dt>
                        <dd className="tabular text-xl font-semibold"><Link href={`/app/w/${w.id}/requests`} className="hover:underline">{reqs}</Link></dd>
                      </div>
                      <div>
                        <dt className="text-[13px] text-muted">مهام مفتوحة</dt>
                        <dd className="tabular text-xl font-semibold"><Link href={`/app/w/${w.id}/tasks`} className="hover:underline">{tsk}</Link></dd>
                      </div>
                    </dl>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {benef.length ? (
        <section aria-labelledby="my-entitlements" className="space-y-3">
          <h2 id="my-entitlements" className="text-lg font-semibold">استحقاقاتك</h2>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {benef.map((w) => (
              <li key={w.id}>
                <Link href={`/app/b/${w.id}`} className="flex items-center gap-3 px-4 py-4 hover:bg-surface-2 md:px-5">
                  <HeartHandshake aria-hidden className="size-5 shrink-0 text-olive" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{w.name}</span>
                    <span className="block text-sm text-muted">نصيبك من الريع وكشوف الصرف وطلباتك إلى الناظر</span>
                  </span>
                  <ArrowLeft aria-hidden className="size-4 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!managed.length ? (
        <section aria-labelledby="start-paths" className="space-y-3">
          <h2 id="start-paths" className="text-lg font-semibold">{benef.length ? "تريد إدارة وقف أو تأسيسه؟" : "من أين تبدأ؟"}</h2>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {STARTS.map((s) => (
              <li key={s.href}>
                <Link href={s.href} className="group flex items-start gap-4 px-4 py-5 hover:bg-surface-2 md:px-6">
                  <s.icon aria-hidden className="mt-1 size-6 shrink-0 text-ink" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[17px] font-semibold text-ink group-hover:underline">{s.title}</span>
                    <span className="block text-[15px] text-muted">{s.text}</span>
                  </span>
                  <ArrowLeft aria-hidden className="mt-1.5 size-4 shrink-0 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">
            دعاك ناظر إلى وقف؟ افتح رابط الدعوة الذي وصلك برسالة نصية وأنت مسجّل الدخول بالرقم نفسه. تحتاج مساعدة متخصصة؟{" "}
            <Link href="/app/services" className="text-ink underline-offset-4 hover:underline">اطلب خدمة</Link>.
          </p>
        </section>
      ) : null}

      {managed.length ? (
        <p className="text-sm text-muted">
          <ListChecks aria-hidden className="me-1.5 inline size-4 align-[-3px]" />
          مهامك عبر كل الأوقاف في <Link href="/app/tasks" className="text-ink hover:underline">مهامي</Link>، ومواعيدها في{" "}
          <Link href="/app/calendar" className="text-ink hover:underline">التقويم</Link>.
        </p>
      ) : null}
    </div>
  );
}
