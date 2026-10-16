import type { Metadata } from "next";
import Link from "next/link";
import { Badge, DataTable, PageHeader, Panel } from "@/components/ui";
import { PrintButton } from "@/components/admin-editors/print-button";
import { fmtDate, fmtDateTime, fmtNumber, fmtSAR } from "@/lib/utils";
import { requireAuth, requireWaqf } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { addDays, todayISO } from "@/server/engines/dates";
import { governanceReport } from "@/server/modules/governance/report";
import { MEETING_STATUS_AR, RESOLUTION_STATUS_AR } from "@/server/modules/governance/pure";

export const metadata: Metadata = { title: "تقرير الحوكمة" };

const ROLE: Record<string, string> = { chair: "رئيس", vice_chair: "نائب الرئيس", member: "عضو", secretary: "أمين السر", observer: "مراقب" };
const POL: Record<string, string> = { approved: "معتمدة", draft: "مسودة", superseded: "مستبدلة", missing: "غير موجودة" };
const RISK_CAT: Record<string, string> = { legal: "نظامية", market: "سوقية", liquidity: "سيولة", operational: "تشغيلية", governance: "حوكمة", reputational: "سمعة", asset: "أصول" };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Governance report from the waqf's records for a period (default: the last 12 months). Nothing is estimated. */
export default async function GovernanceReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const auth = await requireAuth({ next: `/app/w/${id}/reports/governance` });
  const access = await requireWaqf(auth, id, "governance.view");
  const to = sp.to && DATE.test(sp.to) ? sp.to : todayISO();
  const from = sp.from && DATE.test(sp.from) && sp.from <= to ? sp.from : addDays(to, -365);
  const r = await read(auth, (tx) => governanceReport(tx, id, from, to));
  if (!r) return null;
  const isBoard = access.waqf.nazirMode === "board";
  const empty = (t: string) => <p className="text-[15px] text-muted">{t}</p>;

  return (
    <div className="space-y-6 print:space-y-4" data-testid="governance-report">
      <PageHeader
        title={`تقرير الحوكمة — ${r.waqf.name}`}
        description={`الفترة من ${fmtDate(from)} إلى ${fmtDate(to)}. أُعدّ في ${fmtDate(r.generatedOn)} من سجلات الوقف في المنصة كما هي؛ ما لا سجل له يُذكر أنه غير مسجل.`}
        crumbs={[{ href: `/app/w/${id}`, label: access.waqf.name }, { href: `/app/w/${id}/governance`, label: "الحوكمة" }, { label: "تقرير الحوكمة" }]}
        actions={<PrintButton />}
      />
      <form method="get" className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="text-[14px]">من<input type="date" name="from" defaultValue={from} className="mt-1 block h-10 rounded-md border border-line-strong bg-surface px-2" /></label>
        <label className="text-[14px]">إلى<input type="date" name="to" defaultValue={to} className="mt-1 block h-10 rounded-md border border-line-strong bg-surface px-2" /></label>
        <button type="submit" className="h-10 rounded-md border border-line px-3 text-[14px] hover:bg-surface-2">حدّث الفترة</button>
      </form>

      <Panel title={isBoard ? "تشكيل مجلس النظارة" : "النظارة والأجهزة"} tight>
        <div className="p-4">
          {r.board.members.length ? (
            <>
              <p className="mb-2 text-[14px] text-muted">{fmtNumber(r.board.members.length)} عضوًا قائمًا · {fmtNumber(r.board.voting)} يصوّتون · {fmtNumber(r.board.independent)} مستقلون{r.board.withoutAccount ? ` · ${fmtNumber(r.board.withoutAccount)} بلا حساب في المنصة` : ""}{r.board.ended ? ` · ${fmtNumber(r.board.ended)} عضوية منتهية` : ""}</p>
              <DataTable rows={r.board.members} rowKey={(m) => `${m.body}-${m.name}-${m.role}`} columns={[
                { key: "n", label: "العضو", render: (m) => <span>{m.name}{m.capacity ? <span className="text-muted"> — {m.capacity}</span> : null}</span> },
                { key: "b", label: "الجهاز", render: (m) => m.body },
                { key: "r", label: "الدور", render: (m) => [ROLE[m.role] ?? m.role, m.exec ? "تنفيذي" : "", m.sign ? "مفوّض بالتوقيع" : ""].filter(Boolean).join("، ") },
                { key: "i", label: "مستقل", render: (m) => (m.independent ? "نعم" : "لا") },
                { key: "t", label: "المدة", render: (m) => `${fmtDate(m.startsOn)} — ${m.endsOn ? fmtDate(m.endsOn) : "مفتوحة"}` },
              ]} />
            </>
          ) : empty("لا أعضاء مسجلون في مجالس الوقف أو لجانه.")}
        </div>
      </Panel>

      <Panel title="قواعد الإدارة والصلاحيات">
        {r.rules?.source ? (
          <dl className="grid gap-2 text-[15px] sm:grid-cols-2">
            <div><dt className="text-muted">المصدر</dt><dd>{r.rules.source}</dd></div>
            <div><dt className="text-muted">الاجتماعات المستهدفة سنويًا</dt><dd>{r.rules.meetingsPerYear}</dd></div>
            {r.rules.signingRules ? <div className="sm:col-span-2"><dt className="text-muted">صلاحيات التوقيع</dt><dd className="whitespace-pre-line">{r.rules.signingRules}</dd></div> : null}
            {r.rules.delegationLimits ? <div className="sm:col-span-2"><dt className="text-muted">حدود التفويض</dt><dd className="whitespace-pre-line">{r.rules.delegationLimits}</dd></div> : null}
          </dl>
        ) : empty("لم تُسجَّل قواعد الإدارة والصلاحيات بمصدرها.")}
      </Panel>

      <Panel title="الاجتماعات" tight>
        <div className="p-4">
          <p className="mb-2 text-[14px] text-muted">منعقدة {fmtNumber(r.meetings.held)} · ملغاة {fmtNumber(r.meetings.cancelled)} · مجدولة {fmtNumber(r.meetings.scheduled)} · محاضر مقفلة بالتوقيع {fmtNumber(r.meetings.lockedMinutes)}{r.meetings.perYearTarget != null ? ` · المستهدف ${r.meetings.perYearTarget} سنويًا` : ""}</p>
          {r.meetings.list.length ? (
            <DataTable rows={r.meetings.list} rowKey={(m) => m.id} columns={[
              { key: "t", label: "الاجتماع", render: (m) => <Link className="text-ink hover:underline" href={`/app/w/${id}/governance/meetings/${m.id}`}>{m.title}</Link> },
              { key: "d", label: "الموعد", render: (m) => fmtDateTime(m.at) },
              { key: "s", label: "الحالة", render: (m) => MEETING_STATUS_AR[m.status] ?? m.status },
              { key: "q", label: "النصاب", render: (m) => (m.status === "held" ? (m.quorumMet ? "مكتمل" : "غير مكتمل") : "—") },
              { key: "m", label: "المحضر", render: (m) => (m.minutes === "locked" ? "مقفل بالتوقيع" : m.minutes ? "لم يُقفل" : "لا محضر") },
            ]} />
          ) : empty("لا اجتماعات في الفترة.")}
        </div>
      </Panel>

      <Panel title="القرارات وتنفيذها" tight>
        <div className="p-4">
          {r.resolutions.length ? (
            <DataTable rows={r.resolutions} rowKey={(x) => x.id} columns={[
              { key: "n", label: "القرار", render: (x) => <span><span dir="ltr" className="tabular">{x.number}</span> — {x.text.length > 120 ? `${x.text.slice(0, 120)}…` : x.text}</span> },
              { key: "s", label: "الحالة", render: (x) => RESOLUTION_STATUS_AR[x.status] ?? x.status },
              { key: "t", label: "التنفيذ", render: (x) => (x.tasks.length ? <span>{x.done} منجزة من {x.tasks.length}{x.overdue ? <Badge tone="critical" icon={false} className="ms-1">{x.overdue} متأخرة</Badge> : null}<span className="block text-[12px] text-muted">{x.tasks.map((t) => `${t.title}${t.assignee ? ` (${t.assignee}${t.dueOn ? `، ${fmtDate(t.dueOn)}` : ""})` : ""}`).join("؛ ")}</span></span> : x.status === "approved" ? <span className="text-fine">لا مهام تنفيذ مسندة</span> : "—") },
            ]} />
          ) : empty("لا قرارات مسجلة في الفترة.")}
        </div>
      </Panel>

      <Panel title={`السياسات واللوائح (${r.policiesApproved} من ${r.policies.length} معتمدة)`} tight>
        <div className="p-4">
          <DataTable rows={r.policies} rowKey={(p) => p.type} columns={[
            { key: "l", label: "المتطلب", render: (p) => p.label },
            { key: "s", label: "الحالة", render: (p) => POL[p.status] ?? p.status },
            { key: "a", label: "اعتمدت في", render: (p) => (p.approvedOn ? fmtDate(p.approvedOn) : "—") },
            { key: "r", label: "مراجعتها", render: (p) => (p.reviewDue ? <span className={p.reviewOverdue ? "text-critical" : ""}>{fmtDate(p.reviewDue)}{p.reviewOverdue ? " (فات موعدها)" : ""}</span> : "—") },
          ]} />
        </div>
      </Panel>

      <Panel title="الالتزامات والمواعيد">
        {r.obligations.overdue.length || r.obligations.dueSoon.length ? (
          <ul className="space-y-1 text-[15px]">
            {r.obligations.overdue.map((o, i) => <li key={`o${i}`} className="text-critical">متأخر: {o.title}{o.dueOn ? ` — كان موعده ${fmtDate(o.dueOn)}` : ""}</li>)}
            {r.obligations.dueSoon.map((o, i) => <li key={`s${i}`}>خلال 30 يومًا: {o.title}{o.dueOn ? ` — ${fmtDate(o.dueOn)}` : ""}</li>)}
          </ul>
        ) : empty(`لا التزامات متأخرة أو قريبة. المنجزة: ${fmtNumber(r.obligations.done)}.`)}
      </Panel>

      <Panel title="الأصول">
        {r.assets.count ? (
          <p className="text-[15px]">{fmtNumber(r.assets.count)} أصلًا، منها {fmtNumber(r.assets.valued)} بقيمة مسجلة مجموعها {fmtSAR(r.assets.total)}{r.assets.stale ? `؛ و${fmtNumber(r.assets.stale)} بلا تقييم خلال 12 شهرًا` : ""}. القيم كما سُجّلت، وليست تقييمًا حديثًا.</p>
        ) : empty("لا أصول مسجلة في ملف الوقف.")}
      </Panel>

      <Panel title="المخاطر والملاحظات">
        {r.risks.list.length ? (
          <ul className="space-y-1 text-[15px]">
            {r.risks.list.map((x, i) => <li key={i}>{x.title} — {RISK_CAT[x.category] ?? x.category} · الأثر {x.impact} × الاحتمال {x.likelihood}{x.treatment ? ` · المعالجة: ${x.treatment}` : ""}{x.reviewOn ? ` · المراجعة ${fmtDate(x.reviewOn)}` : ""}</li>)}
          </ul>
        ) : empty("لا مخاطر مفتوحة في سجل المخاطر.")}
      </Panel>

      <p className="text-[13px] text-muted">التقارير المالية والاستثمارية لا تُدرج هنا إلا من القيود والتقارير المعتمدة في «المالية والصرف»؛ لا تُقدَّر أرقام لا سجل لها. هذا التقرير أداة عمل لإدارة الوقف وليس تقريرًا مقدمًا لجهة رسمية.</p>
    </div>
  );
}
