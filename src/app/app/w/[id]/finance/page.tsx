import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Landmark } from "lucide-react";
import { Alert, Badge, DataTable, EmptyState, PageHeader, Panel, Stat } from "@/components/ui";
import { DocumentList } from "@/components/documents";
import { DocumentUploader } from "@/components/documents/uploader";
import { ActionButton, ActionForm, Disclosure, RawActionForm, RowsEditor } from "@/components/waqf/action-form";
import { Masked, Muted } from "@/components/waqf/bits";
import { cn, fmtDate, fmtNumber, fmtSAR } from "@/lib/utils";
import { requireAuth, waqfCan } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import {
  addBankAccount, addJournalEntry, approveBudget, approveStatement, closeBankAccount, createStatement, markStatementSubmitted, saveBudget,
} from "@/server/modules/finance/actions";
import { fiscalYearOf, requiredStatementKind } from "@/server/modules/finance/pure";
import { financeDetail, financeSummary } from "@/server/modules/finance/queries";
import { waqfAccess } from "@/server/modules/waqf-core/queries";
import { todayIso } from "@/server/modules/waqf-file/form";
import { ACCOUNT_LABEL, ACCOUNTS, BANK_PURPOSE_LABEL, options, STATEMENT_KIND_LABEL, STATEMENT_STATUS_LABEL, STATEMENT_STATUS_TONE } from "@/server/modules/waqf-file/labels";

export const metadata: Metadata = { title: "المالية والصرف" };

const OPINION: Record<string, string> = { unqualified: "رأي نظيف", qualified: "رأي متحفظ", adverse: "رأي معاكس", disclaimer: "امتناع عن إبداء الرأي" };

export default async function FinancePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fy?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const auth = await requireAuth({ next: `/app/w/${id}/finance` });
  const access = await waqfAccess(auth, id, "finance.summary");
  const w = access.waqf;
  const can = (p: Parameters<typeof waqfCan>[1]) => waqfCan(access, p);
  const full = can("finance.view");
  const today = todayIso();
  const currentFy = fiscalYearOf(w.fiscalYearEnd, today);
  const fy = /^\d{4}$/.test(sp.fy ?? "") ? Number(sp.fy) : currentFy;
  const [sum, det] = await read(auth, async (tx) => [await financeSummary(tx, id, w.fiscalYearEnd, fy), full ? await financeDetail(tx, id, w.fiscalYearEnd, fy) : null] as const);
  const reqKind = requiredStatementKind(w.sizeClass);
  const budget = det?.budgets.find((b) => b.fiscalYear === fy) ?? null;
  const refs = det ? [...new Set(det.entries.map((e) => e.referenceNo ?? e.id))] : [];
  const yearOpts = [currentFy - 2, currentFy - 1, currentFy, currentFy + 1].map((y) => ({ value: String(y), label: String(y) }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="المالية والصرف"
        description={`أموال الوقف منفصلة عن أموال غيره: حسابات باسمه، وموازنة معتمدة، ودفاتر بقيد مزدوج، وقوائم مالية ${reqKind === "audited" ? "مدققة" : "مبسطة"} تُرفع للهيئة.`}
        actions={
          <nav aria-label="السنة المالية" className="flex flex-wrap gap-1">
            {[currentFy - 2, currentFy - 1, currentFy].map((y) => (
              <Link key={y} href={`/app/w/${id}/finance?fy=${y}`} aria-current={y === fy ? "page" : undefined} className={cn("rounded-md border px-3 py-1.5 text-sm tabular", y === fy ? "border-ink bg-ink-soft font-semibold text-ink" : "border-line text-muted hover:bg-surface-2")}>
                {y}
              </Link>
            ))}
          </nav>
        }
      />
      <p className="-mt-4 text-[13px] text-muted">السنة المالية {fy}: من {fmtDate(sum.range.from)} إلى {fmtDate(sum.range.to)}.</p>

      {!full ? <Alert tone="info" title="ملخص مالي">صلاحيتك تتيح الاطلاع على المجاميع فقط، دون القيود وأرقام الحسابات.</Alert> : null}
      {sum.accounts.notInName ? (
        <Alert tone="critical" title={`${fmtNumber(sum.accounts.notInName)} حساب بنكي ليس باسم الوقف`}>أموال الوقف تُودع في حساب باسمه مستقل عن أموال الناظر وغيره. انقل الرصيد وأغلق الحساب.</Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="fy-summary">
        <Stat label="الإيرادات" value={fmtSAR(sum.revenue)} sub={sum.budget ? `الموازنة ${fmtSAR(sum.budget.totalRevenue)}` : "لا موازنة"} />
        <Stat label="المصروفات" value={fmtSAR(sum.expense)} sub={sum.budget ? `الموازنة ${fmtSAR(sum.budget.totalExpense)}` : undefined} />
        <Stat label="صافي الغلة" value={fmtSAR(sum.net)} tone={sum.net < 0 ? "critical" : undefined} />
        <Stat label="المصروف للمستفيدين" value={fmtSAR(sum.distributions)} sub={sum.pendingDistributions ? `${fmtNumber(sum.pendingDistributions)} كشف قيد الإجراء` : undefined} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="الموازنة" value={sum.budget ? (sum.budget.status === "approved" ? "معتمدة" : "مسودة") : "لم تُعد"} tone={sum.budget?.status === "approved" ? "ok" : undefined} sub={sum.budget?.approvedOn ? `اعتُمدت ${fmtDate(sum.budget.approvedOn)}` : w.sizeClass === "large" || w.sizeClass === "medium" ? "مطلوبة لفئة الوقف" : undefined} />
        <Stat label="القوائم المالية" value={sum.statement ? STATEMENT_STATUS_LABEL[sum.statement.status] : "لم تُعد"} tone={sum.statement?.status === "submitted" ? "ok" : undefined} sub={STATEMENT_KIND_LABEL[reqKind]} />
        <Stat label="الحسابات البنكية" value={fmtNumber(sum.accounts.total)} sub={sum.accounts.notInName ? "منها حسابات ليست باسم الوقف" : "كلها باسم الوقف"} tone={sum.accounts.notInName ? "critical" : undefined} />
      </div>

      {det ? (
        <>
          <Panel title="الحسابات البنكية">
            <DataTable
              rows={det.accounts}
              rowKey={(a) => a.id}
              empty={<EmptyState icon={Landmark} title="لا حسابات مسجلة">سجّل حساب الوقف البنكي؛ يُحفظ رقم الآيبان مشفّرًا ويُعرض مخفيًا.</EmptyState>}
              columns={[
                { key: "b", label: "البنك", render: (a) => <span className="font-medium">{a.bankName}</span> },
                { key: "i", label: "الآيبان", render: (a) => <Masked value={a.ibanMasked} label="الآيبان" /> },
                { key: "p", label: "الغرض", render: (a) => BANK_PURPOSE_LABEL[a.purpose] ?? a.purpose },
                { key: "n", label: "باسم الوقف", render: (a) => (a.inWaqfName ? <Badge tone="ok" icon={false}>نعم</Badge> : <Badge tone="critical">ليس باسم الوقف</Badge>) },
                { key: "s", label: "الحالة", render: (a) => (a.status === "active" ? "نشط" : "مغلق") },
                ...(can("finance.edit") ? [{ key: "x", label: "", render: (a: (typeof det.accounts)[number]) => (a.status === "active" ? <ActionButton action={closeBankAccount} hidden={{ waqfId: id, accountId: a.id }} label="أغلق" variant="ghost" confirm="تسجيل إغلاق هذا الحساب؟" /> : null) }] : []),
              ]}
            />
            {can("finance.edit") ? (
              <div className="mt-3">
                <Disclosure summary="أضف حسابًا" testId="add-bank">
                  <ActionForm
                    action={addBankAccount}
                    hidden={{ waqfId: id }}
                    submitLabel="أضف الحساب"
                    fields={[
                      { name: "bankName", label: "البنك", required: true },
                      { name: "iban", label: "رقم الآيبان", required: true, ltr: true, placeholder: "SA00 0000 0000 0000 0000 0000", autoComplete: "off" },
                      { name: "purpose", label: "الغرض", type: "select", options: options(BANK_PURPOSE_LABEL), defaultValue: "general" },
                      { name: "openedOn", label: "تاريخ الفتح", type: "date" },
                      { name: "inWaqfName", label: "الحساب باسم الوقف", type: "checkbox", defaultValue: true },
                    ]}
                  />
                </Disclosure>
              </div>
            ) : null}
          </Panel>

          <Panel title={`الموازنة التقديرية ${fy}`} actions={budget ? <Badge tone={budget.status === "approved" ? "ok" : "neutral"}>{budget.status === "approved" ? "معتمدة" : "مسودة"}</Badge> : null}>
            {budget ? (
              <>
                <DataTable
                  rows={budget.lines ?? []}
                  rowKey={(l) => l.code}
                  columns={[
                    { key: "k", label: "النوع", render: (l) => (l.kind === "revenue" ? "إيراد" : "مصروف") },
                    { key: "l", label: "البيان", render: (l) => l.label },
                    { key: "a", label: "المبلغ", render: (l) => fmtSAR(l.amount) },
                  ]}
                />
                <p className="mt-2 text-[14px]">الإيرادات {fmtSAR(budget.totalRevenue)} · المصروفات {fmtSAR(budget.totalExpense)} · الفائض {fmtSAR(Number(budget.totalRevenue) - Number(budget.totalExpense))}</p>
                {budget.status === "draft" && can("finance.approve") ? <div className="mt-2"><ActionButton action={approveBudget} hidden={{ waqfId: id, budgetId: budget.id }} label="اعتمد الموازنة" variant="primary" /></div> : null}
              </>
            ) : (
              <Muted>لم تُعدّ موازنة لهذه السنة. اعتماد الموازنة قبل بداية السنة مطلوب للأوقاف المتوسطة والكبيرة (لائحة تنظيم أعمال النظارة م15/4).</Muted>
            )}
            {can("finance.edit") && budget?.status !== "approved" ? (
              <div className="mt-3">
                <Disclosure summary={budget ? "عدّل المسودة" : "أعدّ الموازنة"}>
                  <RawActionForm action={saveBudget} hidden={{ waqfId: id, fiscalYear: String(fy) }} submitLabel="احفظ المسودة">
                    <RowsEditor
                      prefix="bl"
                      min={2}
                      addLabel="أضف سطرًا"
                      initial={(budget?.lines ?? []).map((l) => ({ kind: l.kind, label: l.label, amount: String(l.amount) }))}
                      fields={[
                        { key: "kind", label: "النوع", type: "select", options: [{ value: "revenue", label: "إيراد" }, { value: "expense", label: "مصروف" }] },
                        { key: "label", label: "البيان", width: "sm:col-span-2" },
                        { key: "amount", label: "المبلغ", type: "number" },
                      ]}
                    />
                  </RawActionForm>
                </Disclosure>
              </div>
            ) : null}
          </Panel>

          <Panel title="دفتر القيود" description={`القيود في السنة المالية ${fy}. كل قيد متوازن: مجموع المدين يساوي مجموع الدائن.`}>
            {refs.length ? (
              <div className="space-y-3">
                {refs.slice(0, 40).map((ref) => {
                  const ls = det.entries.filter((e) => (e.referenceNo ?? e.id) === ref);
                  return (
                    <div key={ref} className="rounded-md border border-line" data-testid="journal">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2 px-3 py-1.5 text-[14px]">
                        <span className="font-medium">{ls[0].description}</span>
                        <span className="text-muted"><span dir="ltr" className="tabular">{ref}</span> · {fmtDate(ls[0].entryDate)}</span>
                      </div>
                      <ul className="divide-y divide-line text-[14px]">
                        {ls.map((e) => (
                          <li key={e.id} className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-1.5">
                            <span>{ACCOUNT_LABEL[e.accountCode] ?? e.accountCode}</span>
                            <span className="tabular w-28 text-end">{Number(e.debit) ? fmtNumber(e.debit) : ""}</span>
                            <span className="tabular w-28 text-end text-muted">{Number(e.credit) ? fmtNumber(e.credit) : ""}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
                <Muted>العمود الأول مدين والثاني دائن.</Muted>
              </div>
            ) : (
              <EmptyState icon={BookOpen} title="لا قيود في هذه السنة" />
            )}
            {sum.byAccount.length ? (
              <details className="mt-4">
                <summary className="cursor-pointer text-[14px] text-ink">أرصدة الحسابات للسنة</summary>
                <ul className="mt-2 divide-y divide-line text-[14px]">
                  {sum.byAccount.map((a) => <li key={a.code} className="flex justify-between py-1"><span>{ACCOUNT_LABEL[a.code] ?? a.code}</span><span className="tabular">{fmtSAR(a.amount)}</span></li>)}
                </ul>
              </details>
            ) : null}
            {can("finance.edit") ? (
              <div className="mt-3">
                <Disclosure summary="أضف قيدًا" testId="add-journal">
                  <RawActionForm action={addJournalEntry} hidden={{ waqfId: id }} submitLabel="قيّد" testId="journal-form">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="space-y-1 text-[14px]"><span className="block font-medium">التاريخ</span><input type="date" name="entryDate" defaultValue={today} dir="ltr" className="block h-10 w-full rounded-md border border-line-strong bg-surface px-2" /></label>
                      <label className="space-y-1 text-[14px] sm:col-span-2"><span className="block font-medium">البيان</span><input name="description" maxLength={300} className="block h-10 w-full rounded-md border border-line-strong bg-surface px-2" placeholder="مثال: تحصيل إيجار الربع الثالث" /></label>
                    </div>
                    <RowsEditor
                      prefix="jl"
                      min={2}
                      addLabel="أضف سطرًا"
                      initial={[{ accountCode: "1100", debit: "", credit: "" }, { accountCode: "4100", debit: "", credit: "" }]}
                      fields={[
                        { key: "accountCode", label: "الحساب", type: "select", options: ACCOUNTS.map((a) => ({ value: a.code, label: `${a.code} — ${a.label}` })), width: "sm:col-span-2" },
                        { key: "debit", label: "مدين", type: "number" },
                        { key: "credit", label: "دائن", type: "number" },
                      ]}
                    />
                  </RawActionForm>
                </Disclosure>
              </div>
            ) : null}
          </Panel>
        </>
      ) : null}

      {can("statements.view") || full ? (
        <Panel title="القوائم المالية" description={`مطلوب لفئة الوقف: ${STATEMENT_KIND_LABEL[reqKind]}${reqKind === "audited" ? " من مراجع معتمد مستقل" : ""}. اعتماد القوائم يبدأ مهلة رفعها للهيئة.`}>
          {det?.statements.length ? (
            <ul className="space-y-3">
              {det.statements.map((s) => (
                <li key={s.id} className="rounded-md border border-line p-3" data-testid="statement">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">السنة {s.fiscalYear} · {STATEMENT_KIND_LABEL[s.kind] ?? s.kind}</p>
                    <Badge tone={STATEMENT_STATUS_TONE[s.status]}>{STATEMENT_STATUS_LABEL[s.status] ?? s.status}</Badge>
                  </div>
                  <Muted>
                    {[s.auditorName && `المراجع: ${s.auditorName}${s.auditorLicense ? ` (${s.auditorLicense})` : ""}${s.auditorIndependent ? " — مستقل" : ""}`, s.opinion && OPINION[s.opinion], s.totalRevenue && `الإيرادات ${fmtSAR(s.totalRevenue)}`, s.totalExpense && `المصروفات ${fmtSAR(s.totalExpense)}`, s.submittedToGaaOn && `رُفعت للهيئة ${fmtDate(s.submittedToGaaOn)}`].filter(Boolean).join(" · ")}
                  </Muted>
                  <div className="mt-2 space-y-2">
                    <DocumentList waqfId={id} link={{ entityType: "financial_statement", entityId: s.id }} emptyText="لم يُرفع ملف القوائم." />
                    {s.status === "draft" && can("finance.edit") && can("documents.upload") ? (
                      <DocumentUploader waqfId={id} link={{ entityType: "financial_statement", entityId: s.id }} docType="financial_statement" confidentiality="confidential" defaultTitle={`القوائم المالية ${s.fiscalYear}`} />
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap items-start gap-3">
                    {s.status === "draft" && can("finance.approve") ? <ActionButton action={approveStatement} hidden={{ waqfId: id, statementId: s.id }} label="اعتمد القوائم نهائيًا" variant="primary" /> : null}
                    {s.status === "final" && can("finance.edit") ? (
                      <Disclosure summary="سجّل الرفع للهيئة">
                        <ActionForm action={markStatementSubmitted} hidden={{ waqfId: id, statementId: s.id }} submitLabel="سجّل" fields={[
                          { name: "submittedToGaaOn", label: "تاريخ الرفع", type: "date", required: true, defaultValue: today },
                          { name: "sharedWithBeneficiaries", label: "أُتيحت للمستفيدين", type: "checkbox" },
                        ]} />
                      </Disclosure>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : !det ? (
            <Muted>{sum.statement ? `قوائم السنة ${fy}: ${STATEMENT_STATUS_LABEL[sum.statement.status]}.` : `لا قوائم مسجلة للسنة ${fy}.`}</Muted>
          ) : (
            <Muted>لا قوائم مسجلة.</Muted>
          )}
          {can("finance.edit") ? (
            <div className="mt-3">
              <Disclosure summary="سجّل قوائم سنة مالية">
                <ActionForm
                  action={createStatement}
                  hidden={{ waqfId: id }}
                  submitLabel="سجّل"
                  fields={[
                    { name: "fiscalYear", label: "السنة المالية", type: "select", options: yearOpts, required: true, defaultValue: String(currentFy - 1) },
                    { name: "kind", label: "النوع", type: "select", options: options(STATEMENT_KIND_LABEL), required: true, defaultValue: reqKind },
                    { name: "auditorName", label: "المراجع الخارجي" },
                    { name: "auditorLicense", label: "رقم ترخيص المراجع", ltr: true },
                    { name: "opinion", label: "رأي المراجع", type: "select", options: options(OPINION) },
                    { name: "totalRevenue", label: "إجمالي الإيرادات", type: "number", defaultValue: fy === currentFy - 1 ? sum.revenue || "" : "" },
                    { name: "totalExpense", label: "إجمالي المصروفات", type: "number", defaultValue: fy === currentFy - 1 ? sum.expense || "" : "" },
                    { name: "auditorIndependent", label: "المراجع مستقل عن الناظر والمستفيدين", type: "checkbox" },
                  ]}
                />
              </Disclosure>
            </div>
          ) : null}
        </Panel>
      ) : null}
    </div>
  );
}
