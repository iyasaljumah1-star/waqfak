import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { Alert, Badge, buttonClass, DataTable, EmptyState, PageHeader, Panel, Stat } from "@/components/ui";
import { cn, fmtDate, fmtDateTime, fmtSAR } from "@/lib/utils";
import { requireStaff } from "@/server/authz/context";
import { EINVOICE_STATUS_LABEL, INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE, PAYMENT_STATUS_LABEL, PROVIDER_LABEL } from "@/server/modules/billing/access";
import { AGING_LABEL, financeList, financePayments, receivables, type AgingBucket } from "@/server/modules/billing/queries";
import { einvoiceState } from "@/server/modules/billing/einvoice";
import { read } from "@/server/modules/_shared";
import { isFlagOn } from "@/server/modules/requests/catalog";

export const metadata: Metadata = { title: "الفواتير والمدفوعات" };

const TABS = [
  { key: "invoices", label: "الفواتير" },
  { key: "payments", label: "المدفوعات" },
  { key: "receivables", label: "الذمم المدينة" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const STATUS_FILTERS = [
  { value: "", label: "كل الحالات" },
  { value: "issued", label: "مستحقة" },
  { value: "partially_paid", label: "مدفوعة جزئيًا" },
  { value: "overdue", label: "متأخرة" },
  { value: "paid", label: "مدفوعة" },
  { value: "void", label: "ملغاة" },
  { value: "credit_note", label: "إشعارات دائنة" },
];

const iso = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

export default async function AdminFinance({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string; q?: string; from?: string; to?: string }> }) {
  const auth = await requireStaff("admin.finance");
  const sp = await searchParams;
  const tab: Tab = (TABS.find((t) => t.key === sp.tab)?.key ?? "invoices") as Tab;
  const flags = await read(auth, async (tx) => {
    const e = await einvoiceState(tx);
    return { live: await isFlagOn(tx, "payments.live"), zatca: e.active, einvoice: e.items };
  });
  const href = (t: Tab) => `/admin/finance?tab=${t}`;

  return (
    <div className="space-y-6">
      <PageHeader title="الفواتير والمدفوعات" description="الفواتير الضريبية الصادرة، وعمليات السداد، والذمم المستحقة على العملاء." />
      {!flags.live || !flags.zatca ? (
        <Alert tone="info" title="وضع التشغيل الحالي">
          {!flags.live ? "الدفع الإلكتروني في بيئة تجريبية: المبالغ المسجلة عبر «بيئة تجريبية» لا تمثل تحصيلًا فعليًا. " : ""}
          {!flags.zatca ? "الربط مع منصة فاتورة (هيئة الزكاة والضريبة والجمارك) غير مفعّل؛ الفواتير بحالة «بانتظار الربط»." : ""}
        </Alert>
      ) : null}
      {!flags.zatca ? (
        <Alert tone="fine" title="الفوترة الإلكترونية تُفعَّل تلقائيًا عند اكتمال الشروط" className="mt-0">
          <ul className="mt-1 space-y-1" data-testid="einvoice-readiness">
            {flags.einvoice.map((i) => <li key={i.label}>{i.ok ? "✓" : "✗"} {i.label}{!i.ok && i.detail ? <span className="text-muted"> — {i.detail}</span> : null}</li>)}
          </ul>
        </Alert>
      ) : null}

      <nav aria-label="أقسام المالية" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {TABS.map((t) => (
          <Link key={t.key} href={href(t.key)} aria-current={t.key === tab ? "page" : undefined}
            className={buttonClass(t.key === tab ? "primary" : "secondary", "sm", "shrink-0 gap-1.5")}>
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "invoices" ? <InvoicesTab auth={auth} sp={sp} /> : tab === "payments" ? <PaymentsTab auth={auth} sp={sp} /> : <ReceivablesTab auth={auth} />}
    </div>
  );
}

type Sp = { status?: string; q?: string; from?: string; to?: string };
type A = Awaited<ReturnType<typeof requireStaff>>;

function Filters({ tab, sp, statuses }: { tab: Tab; sp: Sp; statuses: { value: string; label: string }[] }) {
  const input = "h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-[15px]";
  return (
    <form className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_180px_160px_160px_auto]" role="search">
      <input type="hidden" name="tab" value={tab} />
      <label className="sr-only" htmlFor="fq">بحث</label>
      <input id="fq" name="q" defaultValue={sp.q ?? ""} placeholder="رقم الفاتورة، العميل، الطلب، الوقف" className={input} />
      <label className="sr-only" htmlFor="fs">الحالة</label>
      <select id="fs" name="status" defaultValue={sp.status ?? ""} className={input}>
        {statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
      <label className="sr-only" htmlFor="ff">من تاريخ</label>
      <input id="ff" name="from" type="date" dir="ltr" defaultValue={iso(sp.from) ?? ""} className={input} aria-label="من تاريخ" />
      <label className="sr-only" htmlFor="ft">إلى تاريخ</label>
      <input id="ft" name="to" type="date" dir="ltr" defaultValue={iso(sp.to) ?? ""} className={input} aria-label="إلى تاريخ" />
      <button className="h-10 rounded-md border border-line-strong bg-surface px-4 text-[15px] hover:bg-surface-2">تصفية</button>
    </form>
  );
}

async function InvoicesTab({ auth, sp }: { auth: A; sp: Sp }) {
  const { rows, totals } = await financeList(auth, { status: sp.status, q: sp.q, from: iso(sp.from), to: iso(sp.to) });
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="إجمالي المفوتر" value={fmtSAR(totals.issued)} sub="شامل الضريبة، بلا الملغاة" />
        <Stat label="المحصّل" value={fmtSAR(totals.paid)} tone="ok" sub={`ضريبة محصّلة ${fmtSAR(totals.vatCollected)}`} />
        <Stat label="المستحق" value={fmtSAR(totals.outstanding)} />
        <Stat label="المتأخر" value={fmtSAR(totals.overdue)} tone={totals.overdue ? "critical" : undefined} sub={totals.credits ? `إشعارات دائنة ${fmtSAR(totals.credits)}` : undefined} />
      </div>
      <Filters tab="invoices" sp={sp} statuses={STATUS_FILTERS} />
      <Panel tight>
        <div className="px-3 md:px-2">
          <DataTable
            rows={rows}
            rowKey={(r) => r.inv.id}
            caption="الفواتير"
            empty={<div className="p-4"><EmptyState icon={Receipt} title="لا فواتير">لا فواتير تطابق التصفية.</EmptyState></div>}
            columns={[
              { key: "n", label: "الفاتورة", render: (r) => <Link href={`/admin/finance/${r.inv.id}`} className="tabular font-medium text-ink hover:underline" dir="ltr">{r.inv.number}</Link> },
              { key: "c", label: "العميل", render: (r) => <span>{r.inv.billedToName}{r.reqNumber ? <span className="block text-[13px] text-muted" dir="ltr">{r.reqNumber}</span> : null}</span> },
              { key: "t", label: "الإجمالي", render: (r) => <span className="tabular">{fmtSAR(r.inv.total)}</span> },
              { key: "v", label: "الضريبة", render: (r) => <span className="tabular text-muted">{fmtSAR(r.inv.vat)}</span>, hideOnMobile: true },
              { key: "s", label: "الحالة", render: (r) => <Badge tone={INVOICE_STATUS_TONE[r.status] ?? "neutral"} icon={false}>{INVOICE_STATUS_LABEL[r.status] ?? r.status}</Badge> },
              { key: "e", label: "فاتورة", render: (r) => <span className="text-[13px] text-muted">{EINVOICE_STATUS_LABEL[r.inv.einvoiceStatus] ?? r.inv.einvoiceStatus}</span>, hideOnMobile: true },
              { key: "d", label: "الإصدار / الاستحقاق", render: (r) => <span className="text-[13px] text-muted">{fmtDate(r.inv.issuedOn)}{r.inv.dueOn ? <> · {fmtDate(r.inv.dueOn)}</> : null}</span>, hideOnMobile: true },
            ]}
          />
        </div>
      </Panel>
    </>
  );
}

async function PaymentsTab({ auth, sp }: { auth: A; sp: Sp }) {
  const { rows, totals } = await financePayments(auth, { status: sp.status || undefined, from: iso(sp.from), to: iso(sp.to) });
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="مدفوعات ناجحة" value={fmtSAR(totals.paid)} tone="ok" />
        <Stat label="منها تجريبية" value={fmtSAR(totals.sandbox)} sub="لا تمثل تحصيلًا فعليًا" />
        <Stat label="محاولات مرفوضة" value={totals.failed} />
      </div>
      <Filters tab="payments" sp={sp} statuses={[{ value: "", label: "كل الحالات" }, { value: "paid", label: "ناجحة" }, { value: "initiated", label: "بدأت ولم تكتمل" }, { value: "failed", label: "مرفوضة" }, { value: "refunded", label: "مستردة" }]} />
      <Panel tight>
        <div className="px-3 md:px-2">
          <DataTable
            rows={rows}
            rowKey={(r) => r.p.id}
            caption="المدفوعات"
            empty={<p className="p-4 text-sm text-muted">لا مدفوعات تطابق التصفية.</p>}
            columns={[
              { key: "i", label: "الفاتورة", render: (r) => <Link href={`/admin/finance/${r.p.invoiceId}`} className="tabular text-ink hover:underline" dir="ltr">{r.invNumber}</Link> },
              { key: "c", label: "العميل", render: (r) => r.billedTo, hideOnMobile: true },
              { key: "a", label: "المبلغ", render: (r) => <span className="tabular">{fmtSAR(r.p.amount)}</span> },
              { key: "m", label: "الوسيلة", render: (r) => <span>{PROVIDER_LABEL[r.p.provider] ?? r.p.provider}{r.p.providerRef ? <span className="block text-[12px] text-muted" dir="ltr">{r.p.providerRef}</span> : null}</span> },
              { key: "s", label: "الحالة", render: (r) => <Badge tone={r.p.status === "paid" ? "ok" : r.p.status === "failed" ? "critical" : "neutral"} icon={false}>{PAYMENT_STATUS_LABEL[r.p.status] ?? r.p.status}</Badge> },
              { key: "d", label: "التاريخ", render: (r) => <span className="text-[13px] text-muted">{fmtDateTime(r.p.paidAt ?? r.p.createdAt)}</span>, hideOnMobile: true },
            ]}
          />
        </div>
      </Panel>
    </>
  );
}

async function ReceivablesTab({ auth }: { auth: A }) {
  const r = await receivables(auth);
  const order: AgingBucket[] = ["current", "d1_30", "d31_60", "d61_90", "d90p"];
  return (
    <>
      <Panel title="أعمار الذمم" description={`إجمالي المستحق غير المسدد: ${fmtSAR(r.total)}`}>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {order.map((b) => (
            <div key={b} className="rounded-md border border-line p-3">
              <dt className="text-[13px] text-muted">{AGING_LABEL[b]}</dt>
              <dd className={cn("tabular mt-1 text-lg font-semibold", b !== "current" && r.buckets[b] ? "text-critical" : "")}>{fmtSAR(r.buckets[b])}</dd>
            </div>
          ))}
        </dl>
      </Panel>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="الفواتير غير المسددة" tight>
          <div className="px-3 md:px-2">
            <DataTable
              rows={r.rows}
              rowKey={(x) => x.inv.id}
              caption="الفواتير غير المسددة"
              empty={<p className="p-4 text-sm text-muted">لا ذمم مستحقة.</p>}
              columns={[
                { key: "n", label: "الفاتورة", render: (x) => <Link href={`/admin/finance/${x.inv.id}`} className="tabular font-medium text-ink hover:underline" dir="ltr">{x.inv.number}</Link> },
                { key: "c", label: "العميل", render: (x) => x.inv.billedToName },
                { key: "t", label: "المبلغ", render: (x) => <span className="tabular">{fmtSAR(x.inv.total)}</span> },
                { key: "d", label: "الاستحقاق", render: (x) => <span className="text-[13px]">{fmtDate(x.inv.dueOn)}</span>, hideOnMobile: true },
                { key: "a", label: "العمر", render: (x) => <Badge tone={x.bucket === "current" ? "neutral" : "critical"} icon={false}>{x.bucket === "current" ? AGING_LABEL.current : `متأخرة ${x.daysLate} يومًا`}</Badge> },
              ]}
            />
          </div>
        </Panel>
        <Panel title="حسب العميل">
          {r.clients.length ? (
            <ul className="divide-y divide-line">
              {r.clients.map((c) => (
                <li key={c.name} className="flex items-center justify-between gap-2 py-2 text-[15px]">
                  <span className="min-w-0 truncate">{c.name} <span className="text-[13px] text-muted">({c.count})</span></span>
                  <span className="tabular shrink-0">{fmtSAR(c.total)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">لا ذمم.</p>}
        </Panel>
      </div>
    </>
  );
}
