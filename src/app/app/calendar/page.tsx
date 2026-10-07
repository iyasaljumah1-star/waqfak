import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, CalendarDays, ChevronLeft, ChevronRight, Download, List } from "lucide-react";
import { Badge, EmptyState, PageHeader, Panel, buttonClass } from "@/components/ui";
import { cn, fmtDate, fmtHijri, relDays } from "@/lib/utils";
import { requireAuth } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { calendarItems, myComplianceWaqfs, type CalendarItem } from "@/server/modules/compliance/queries";
import { CATEGORY_AR, STATUS_AR, STATUS_TONE, monthWeeks, shiftMonth } from "@/server/modules/compliance/pure";
import { todayISO } from "@/server/engines/dates";

export const metadata: Metadata = { title: "التقويم والالتزامات" };

const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const OPEN = ["overdue", "due_soon", "upcoming"];
const DOT: Record<string, string> = { overdue: "bg-critical", due_soon: "bg-fine", upcoming: "bg-ink", done: "bg-ok", waived: "bg-line-strong", not_applicable: "bg-line-strong" };

const noon = (iso: string) => new Date(`${iso}T12:00:00Z`);
const hijriDay = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", { day: "numeric", timeZone: "UTC" });
const hijriMonth = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", { month: "long", year: "numeric", timeZone: "UTC" });
const gregMonth = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { month: "long", year: "numeric", timeZone: "UTC" });

function ItemRow({ i, showWaqf }: { i: CalendarItem; showWaqf: boolean }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-3">
      <div className="min-w-0 flex-1">
        <Link href={`/app/w/${i.waqfId}/compliance#i-${i.id}`} className="font-medium text-ink underline-offset-4 hover:underline">{i.title}</Link>
        <p className="text-[13px] text-muted">
          {showWaqf ? <>{i.waqfName} · </> : null}
          {CATEGORY_AR[i.category] ?? i.category} · <span dir="ltr" className="tabular">{i.code}</span>
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 text-end">
        <Badge tone={STATUS_TONE[i.status] ?? "neutral"}>{STATUS_AR[i.status] ?? i.status}</Badge>
        {i.dueOn ? (
          <span className="text-[13px] text-muted">
            {fmtDate(i.dueOn)} · {fmtHijri(i.dueOn)}
            {OPEN.includes(i.status) ? <> ({relDays(i.dueOn)})</> : null}
          </span>
        ) : null}
      </div>
    </li>
  );
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const auth = await requireAuth({ next: "/app/calendar" });
  const today = todayISO();
  const month = typeof sp.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const view = sp.view === "list" ? "list" : "month";

  const { waqfs, items } = await read(auth, async (tx) => {
    const waqfs = await myComplianceWaqfs(tx, auth.user.id);
    const sel = typeof sp.waqf === "string" && waqfs.some((w) => w.id === sp.waqf) ? [sp.waqf] : waqfs.map((w) => w.id);
    return { waqfs, items: await calendarItems(tx, sel) };
  });
  const waqfFilter = typeof sp.waqf === "string" && waqfs.some((w) => w.id === sp.waqf) ? sp.waqf : null;
  const dated = items.filter((i) => i.dueOn && i.status !== "not_applicable");
  const href = (o: { month?: string; view?: string; waqf?: string | null }) => {
    const p = new URLSearchParams();
    p.set("view", o.view ?? view);
    if ((o.view ?? view) === "month") p.set("month", o.month ?? month);
    const w = o.waqf === undefined ? waqfFilter : o.waqf;
    if (w) p.set("waqf", w);
    return `/app/calendar?${p}`;
  };

  const weeks = monthWeeks(month);
  const inMonth = dated.filter((i) => i.dueOn!.startsWith(month));
  const byDay = new Map<string, CalendarItem[]>();
  for (const i of inMonth) byDay.set(i.dueOn!, [...(byDay.get(i.dueOn!) ?? []), i]);
  const firstDay = `${month}-01`;
  const lastDay = weeks.at(-1)!.days.filter((d) => d.startsWith(month)).at(-1)!;
  const hijriSpan = [...new Set([hijriMonth.format(noon(firstDay)), hijriMonth.format(noon(lastDay))])].join(" — ");

  const overdue = dated.filter((i) => i.status === "overdue");
  const openUpcoming = dated.filter((i) => i.status === "due_soon" || i.status === "upcoming");
  const multi = waqfs.length > 1 && !waqfFilter;

  return (
    <div className="space-y-6">
      <PageHeader
        title="التقويم والالتزامات"
        description="مواعيد الالتزامات النظامية لكل الأوقاف التي تتابع امتثالها، بالتاريخين الميلادي والهجري."
        actions={
          <a href="/app/calendar/ics" className={buttonClass("secondary")} download>
            <Download aria-hidden className="size-4" /> أضفها إلى تقويمك (ICS)
          </a>
        }
      />

      {!waqfs.length ? (
        <EmptyState icon={CalendarClock} title="لا توجد التزامات تتابعها">
          يظهر هنا تقويم الالتزامات عندما تكون ناظرًا أو عضوًا بصلاحية الامتثال في وقف على المنصة.
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-line bg-surface p-1" role="list" aria-label="طريقة العرض">
              <Link role="listitem" href={href({ view: "month" })} aria-current={view === "month" ? "page" : undefined} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[14px]", view === "month" ? "bg-ink text-white dark:text-[#0f141c]" : "text-muted hover:text-text")}>
                <CalendarDays aria-hidden className="size-4" /> شهري
              </Link>
              <Link role="listitem" href={href({ view: "list" })} aria-current={view === "list" ? "page" : undefined} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[14px]", view === "list" ? "bg-ink text-white dark:text-[#0f141c]" : "text-muted hover:text-text")}>
                <List aria-hidden className="size-4" /> قائمة
              </Link>
            </div>
            {waqfs.length > 1 ? (
              <form method="get" className="flex items-center gap-2">
                <input type="hidden" name="view" value={view} />
                {view === "month" ? <input type="hidden" name="month" value={month} /> : null}
                <label htmlFor="waqf" className="sr-only">الوقف</label>
                <select id="waqf" name="waqf" defaultValue={waqfFilter ?? ""} className="h-10 rounded-md border border-line-strong bg-surface px-3 text-[14px]">
                  <option value="">كل الأوقاف</option>
                  {waqfs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                <button type="submit" className={buttonClass("secondary", "sm")}>اعرض</button>
              </form>
            ) : null}
          </div>

          {view === "month" ? (
            <Panel
              title={<span>{gregMonth.format(noon(firstDay))} <span className="text-[14px] font-normal text-muted">· {hijriSpan}</span></span>}
              actions={
                <div className="flex items-center gap-1">
                  <Link href={href({ month: shiftMonth(month, -1) })} className={buttonClass("ghost", "sm")} aria-label="الشهر السابق"><ChevronRight aria-hidden className="size-4" /></Link>
                  <Link href={href({ month: today.slice(0, 7) })} className={buttonClass("ghost", "sm")}>اليوم</Link>
                  <Link href={href({ month: shiftMonth(month, 1) })} className={buttonClass("ghost", "sm")} aria-label="الشهر التالي"><ChevronLeft aria-hidden className="size-4" /></Link>
                </div>
              }
              tight
            >
              <table className="w-full table-fixed border-collapse text-[13px]" aria-label="تقويم الشهر">
                <thead>
                  <tr>
                    {WEEKDAYS.map((d) => (
                      <th key={d} scope="col" className="border-b border-line py-2 text-center font-medium text-muted">
                        <span className="hidden sm:inline">{d}</span>
                        <span className="sm:hidden" aria-hidden>{d.replace("ال", "").slice(0, 2)}</span>
                        <span className="sr-only sm:hidden">{d}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((w) => (
                    <tr key={w.start}>
                      {w.days.map((d) => {
                        const list = byDay.get(d) ?? [];
                        const outside = !d.startsWith(month);
                        return (
                          <td key={d} className={cn("h-16 border border-line p-1 align-top sm:h-24", outside && "bg-surface-2/60 text-muted", d === today && "ring-2 ring-inset ring-ink")}>
                            <div className="flex items-baseline justify-between gap-1">
                              <span className={cn("tabular font-semibold", d === today && "text-ink")}>{Number(d.slice(8))}</span>
                              <span className="tabular text-[11px] text-muted">{hijriDay.format(noon(d))}</span>
                            </div>
                            {list.length ? (
                              <>
                                <ul className="mt-1 hidden space-y-0.5 sm:block">
                                  {list.slice(0, 2).map((i) => (
                                    <li key={i.id} className="flex items-center gap-1 truncate">
                                      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[i.status])} />
                                      <Link href={`/app/w/${i.waqfId}/compliance#i-${i.id}`} className="truncate hover:underline" title={i.title}>{i.title}</Link>
                                    </li>
                                  ))}
                                  {list.length > 2 ? <li className="text-muted">+{list.length - 2}</li> : null}
                                </ul>
                                <p className="mt-1 flex flex-wrap gap-0.5 sm:hidden" aria-label={`${list.length} التزام`}>
                                  {list.slice(0, 4).map((i) => <span key={i.id} aria-hidden className={cn("size-2 rounded-full", DOT[i.status])} />)}
                                </p>
                              </>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t border-line px-4 md:px-5">
                <h2 className="pt-3 text-[15px] font-semibold">مواعيد هذا الشهر ({inMonth.length})</h2>
                {inMonth.length ? (
                  <ul className="divide-y divide-line">{inMonth.map((i) => <ItemRow key={i.id} i={i} showWaqf={multi} />)}</ul>
                ) : (
                  <p className="py-4 text-[14px] text-muted">لا مواعيد في هذا الشهر.</p>
                )}
              </div>
            </Panel>
          ) : (
            <div className="space-y-6">
              <Panel title={`متأخرة (${overdue.length})`} tight>
                <div className="px-4 md:px-5">
                  {overdue.length ? <ul className="divide-y divide-line">{overdue.map((i) => <ItemRow key={i.id} i={i} showWaqf={multi} />)}</ul> : <p className="py-4 text-[14px] text-muted">لا شيء متأخر.</p>}
                </div>
              </Panel>
              <Panel title={`القادمة (${openUpcoming.length})`} tight>
                <div className="px-4 md:px-5">
                  {openUpcoming.length ? <ul className="divide-y divide-line">{openUpcoming.map((i) => <ItemRow key={i.id} i={i} showWaqf={multi} />)}</ul> : <p className="py-4 text-[14px] text-muted">لا مواعيد قادمة.</p>}
                </div>
              </Panel>
            </div>
          )}
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted" aria-label="دليل الألوان">
            {(["overdue", "due_soon", "upcoming", "done"] as const).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5"><span aria-hidden className={cn("size-2 rounded-full", DOT[s])} />{STATUS_AR[s]}</span>
            ))}
          </p>
        </>
      )}
    </div>
  );
}
