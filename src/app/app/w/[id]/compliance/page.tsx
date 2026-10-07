import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, CalendarPlus, FileBarChart, Gavel, ListChecks } from "lucide-react";
import { Alert, Badge, ButtonLink, EmptyState, PageHeader, Panel, ProgressBar, Stat, buttonClass } from "@/components/ui";
import { cn, fmtBoth } from "@/lib/utils";
import { requireAuth, requireWaqf, waqfCan } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { waqfFacts } from "@/server/modules/compliance/engine";
import { evidenceCandidates, listViolations, listWaqfInstances, summarize, type InstanceView } from "@/server/modules/compliance/queries";
import { CATEGORY_AR } from "@/server/modules/compliance/pure";
import { ObligationItem } from "./item";
import { ManualForm } from "./forms";

export const metadata: Metadata = { title: "الامتثال والمواعيد" };

const VIEWS = [
  { key: "open", label: "المفتوحة" },
  { key: "done", label: "المنجزة" },
  { key: "closed", label: "المعفاة وغير المنطبقة" },
  { key: "all", label: "الكل" },
] as const;
type View = (typeof VIEWS)[number]["key"];

const inView = (i: InstanceView, v: View) =>
  v === "all" ? true : v === "open" ? ["overdue", "due_soon", "upcoming"].includes(i.status) : v === "done" ? i.status === "done" : ["waived", "not_applicable"].includes(i.status);

const STATUS_ORDER: Record<string, number> = { overdue: 0, due_soon: 1, upcoming: 2, done: 3, waived: 4, not_applicable: 5 };
const CATEGORY_ORDER = ["registration", "update", "notification", "financial", "disclosure", "distribution", "governance", "response", "retention", "manual", "other"];

export default async function CompliancePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const auth = await requireAuth({ next: `/app/w/${id}/compliance` });
  const access = await requireWaqf(auth, id, "compliance.view");
  const canManage = waqfCan(access, "compliance.manage");
  const canUpload = waqfCan(access, "documents.upload");
  const view: View = (VIEWS.find((v) => v.key === sp.view)?.key ?? "open") as View;
  const cat = typeof sp.cat === "string" && sp.cat in CATEGORY_AR ? sp.cat : null;

  const { items, docs, violationsOpen } = await read(auth, async (tx) => {
    const facts = await waqfFacts(tx, id);
    const items = await listWaqfInstances(tx, id, { perms: access.perms, facts });
    const docs = canManage ? await evidenceCandidates(tx, id, access.perms) : [];
    const v = await listViolations(tx, id);
    return { items, docs, violationsOpen: v.filter((x) => x.v.status !== "closed").length };
  });

  const { counts, readiness } = summarize(items);
  const shown = items
    .filter((i) => inView(i, view) && (!cat || i.category === cat))
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"));
  const catRank = (c: string) => (CATEGORY_ORDER.includes(c) ? CATEGORY_ORDER.indexOf(c) : 99);
  const cats = [...new Set(shown.map((i) => i.category))].sort((a, b) => catRank(a) - catRank(b));
  const presentCats = [...new Set(items.filter((i) => inView(i, view)).map((i) => i.category))];
  const base = `/app/w/${id}/compliance`;
  const qs = (v: View, c: string | null) => `${base}?view=${v}${c ? `&cat=${c}` : ""}`;
  const nextDue = items.find((i) => ["overdue", "due_soon", "upcoming"].includes(i.status) && i.dueOn);
  const pct = readiness.pct;

  return (
    <div className="space-y-6">
      <PageHeader
        title="الامتثال والمواعيد"
        description="الالتزامات النظامية لهذا الوقف تُحسب آليًا من بياناته ومن الأحداث المسجلة، مع المرجع والموعد بالتقويمين والجزاء المحتمل عند التأخر."
        crumbs={[{ href: `/app/w/${id}`, label: access.waqf.name }, { label: "الامتثال" }]}
        actions={
          <>
            <ButtonLink href={`/app/calendar?waqf=${id}`} variant="secondary"><CalendarDays aria-hidden className="size-4" /> التقويم</ButtonLink>
            <ButtonLink href={`${base}/violations`} variant="secondary"><Gavel aria-hidden className="size-4" /> المخالفات{violationsOpen ? ` (${violationsOpen})` : ""}</ButtonLink>
            {waqfCan(access, "reports.generate") ? <ButtonLink href={`/app/w/${id}/reports`} variant="secondary"><FileBarChart aria-hidden className="size-4" /> حزم التصدير</ButtonLink> : null}
          </>
        }
      />

      <section aria-label="ملخص الامتثال" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-line bg-surface p-4 sm:col-span-2 lg:col-span-1">
          <p className="text-sm text-muted">الجاهزية</p>
          <p className={cn("tabular mt-1 text-2xl font-semibold", pct === null ? "text-muted" : pct >= 90 ? "text-ok" : pct >= 70 ? "text-fine" : "text-critical")}>{pct === null ? "—" : `${pct}%`}</p>
          <div className="mt-2"><ProgressBar value={pct ?? 0} tone={pct === null ? "ink" : pct >= 90 ? "ok" : pct >= 70 ? "fine" : "critical"} label="نسبة الجاهزية" /></div>
          <p className="mt-1 text-[13px] text-muted">{readiness.due ? `${readiness.onTime} من ${readiness.due} أُنجزت في موعدها` : "لا التزامات حان موعدها بعد"}</p>
        </div>
        <Stat label="متأخرة" value={counts.overdue} tone={counts.overdue ? "critical" : undefined} sub={counts.overdue ? "أنجزها أولًا لتجنّب الجزاء" : "لا شيء متأخر"} />
        <Stat label="تحين خلال 14 يومًا" value={counts.due_soon} tone={counts.due_soon ? "fine" : undefined} sub={nextDue?.dueOn ? `الأقرب: ${fmtBoth(nextDue.dueOn)}` : undefined} />
        <Stat label="منجزة" value={counts.done} tone="ok" sub={`قادمة: ${counts.upcoming}`} />
      </section>

      {sp.ok === "completed" ? <Alert tone="ok" title="سُجّل الالتزام منجزًا مع الدليل.">الدليل مرتبط بالالتزام ويظهر في سجله أدناه.</Alert> : null}
      {sp.ok === "waived" ? <Alert tone="ok" title="سُجّل الإعفاء مع سببه في سجل العمليات." /> : null}

      {counts.overdue ? (
        <Alert tone="critical" title={`لديك ${counts.overdue} التزام متأخر`}>
          التأخر في الإبلاغ والتحديث مخالفة في جدول المخالفات قد تترتب عليها غرامة أو إنذار. أرفق الدليل وسجّل الإنجاز فور التنفيذ.
        </Alert>
      ) : null}

      <nav aria-label="تصفية الالتزامات" className="space-y-3">
        <div className="flex flex-wrap gap-1 rounded-lg border border-line bg-surface p-1" role="list">
          {VIEWS.map((v) => {
            const n = items.filter((i) => inView(i, v.key)).length;
            return (
              <Link
                key={v.key}
                role="listitem"
                href={qs(v.key, null)}
                aria-current={view === v.key ? "page" : undefined}
                className={cn("rounded-md px-3 py-2 text-[14px] font-medium", view === v.key ? "bg-ink text-white dark:text-[#0f141c]" : "text-muted hover:bg-surface-2 hover:text-text")}
              >
                {v.label} <span className="tabular opacity-80">({n})</span>
              </Link>
            );
          })}
        </div>
        {presentCats.length > 1 ? (
          <div className="flex flex-wrap gap-1.5 text-[13px]">
            <Link href={qs(view, null)} aria-current={!cat ? "true" : undefined} className={cn("rounded-full border px-3 py-1", !cat ? "border-ink bg-ink-soft text-ink" : "border-line text-muted hover:text-text")}>كل الفئات</Link>
            {presentCats.map((c) => (
              <Link key={c} href={qs(view, c)} aria-current={cat === c ? "true" : undefined} className={cn("rounded-full border px-3 py-1", cat === c ? "border-ink bg-ink-soft text-ink" : "border-line text-muted hover:text-text")}>
                {CATEGORY_AR[c] ?? c}
              </Link>
            ))}
          </div>
        ) : null}
      </nav>

      {shown.length ? (
        <div className="space-y-8">
          {cats.map((c) => {
            const rows = shown.filter((i) => i.category === c);
            return (
              <section key={c} aria-labelledby={`cat-${c}`} className="space-y-3">
                <h2 id={`cat-${c}`} className="flex items-center gap-2 text-[17px] font-semibold text-text">
                  {CATEGORY_AR[c] ?? c}
                  <Badge icon={false}>{rows.length}</Badge>
                </h2>
                {rows.map((i) => (
                  <ObligationItem key={i.id} item={i} waqfId={id} canManage={canManage} canUpload={canUpload} docs={docs} />
                ))}
              </section>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={ListChecks} title={view === "open" ? "لا التزامات مفتوحة" : "لا توجد التزامات في هذا العرض"}>
          {view === "open"
            ? "كل الالتزامات المستحقة منجزة. تظهر الالتزامات الجديدة هنا تلقائيًا عند تسجيل حدث نظامي أو حلول موعد سنوي."
            : "جرّب عرضًا آخر أو أزل تصفية الفئة."}
        </EmptyState>
      )}

      {canManage ? (
        <Panel id="manual" title={<span className="inline-flex items-center gap-2"><CalendarPlus aria-hidden className="size-5 text-ink" /> أضف التزامًا يدويًا</span>} description="لموعد ورد في خطاب من الهيئة أو جهة مختصة ولا يحسبه المحرك آليًا.">
          <ManualForm waqfId={id} />
        </Panel>
      ) : null}

      <p className="text-[13px] text-muted">
        المراجع المعلّمة «بانتظار التحقق» والجزاءات المعروضة تقديرية حتى مطابقتها مع النص الرسمي لجدول المخالفات.{" "}
        <a className="text-ink underline-offset-4 hover:underline" href="/app/calendar/ics">نزّل مواعيدك بصيغة التقويم (ICS)</a>
        {" · "}
        <Link className={buttonClass("ghost", "sm", "inline-flex px-1")} href="/regulations">المراجع النظامية</Link>
      </p>
    </div>
  );
}
