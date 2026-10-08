"use server";

/** Waqf finance: bank accounts (IBAN encrypted), budgets, double-entry journal, financial statements. */
import { and, countDistinct, eq, like } from "drizzle-orm";
import { z } from "zod";
import { bankAccounts, budgets, documentLinks, documents, financialStatements, ledgerEntries } from "../../db/schema";
import { audit } from "../../lib/audit";
import { encryptString } from "../../lib/crypto";
import { emitWaqfEvent } from "../compliance/events";
import { UserError } from "../_shared";
import type { ActionState } from "@/lib/utils";
import { flag, normalizeNumber, optDate, optMoney, optText, readRows, reqDate, reqText, todayIso } from "../waqf-file/form";
import { addTimeline, assertFound, fileAction } from "../waqf-file/guard";
import { isValidSaudiIban, normalizeIban, requiredStatementKind, validateJournal } from "./pure";

const meta = (c: { ip: string; userAgent: string }) => ({ ip: c.ip, userAgent: c.userAgent });
const SECTION = "finance";
const year = z.coerce.number({ error: "اختر السنة المالية." }).int().min(2000).max(2100);

// ───────────── Bank accounts ─────────────
const bankSchema = z.object({
  bankName: reqText(120, "اكتب اسم البنك."),
  iban: z.string({ error: "أدخل رقم الآيبان." }).transform(normalizeIban).refine(isValidSaudiIban, "رقم الآيبان غير صحيح: 24 خانة تبدأ بـ SA، وتأكد من الأرقام."),
  inWaqfName: flag,
  purpose: z.enum(["general", "donations", "investment", "distribution"]).default("general"),
  openedOn: optDate,
});

export async function addBankAccount(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, bankSchema, "finance.edit", async (c, d) => {
    const w = c.access.waqf;
    const last4 = d.iban.slice(-4);
    const [a] = await c.tx
      .insert(bankAccounts)
      .values({ waqfId: w.id, bankName: d.bankName, ibanEnc: encryptString(d.iban), ibanLast4: last4, inWaqfName: d.inWaqfName, purpose: d.purpose, openedOn: d.openedOn, createdBy: c.auth.user.id })
      .returning({ id: bankAccounts.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "finance.bank_account_added", entityType: "bank_account", entityId: a.id, waqfId: w.id, ...meta(c), after: { bankName: d.bankName, ibanLast4: last4, inWaqfName: d.inWaqfName, purpose: d.purpose } });
    return d.inWaqfName
      ? { ok: true, message: "أُضيف الحساب." }
      : { ok: true, message: "أُضيف الحساب، وعُلّم بأنه ليس باسم الوقف: أموال الوقف تُودع في حساب باسمه، فانقلها في أقرب وقت." };
  }, SECTION);
}

export async function closeBankAccount(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, z.object({ accountId: z.uuid() }), "finance.edit", async (c, d) => {
    const [a] = await c.tx.select().from(bankAccounts).where(and(eq(bankAccounts.id, d.accountId), eq(bankAccounts.waqfId, c.access.waqf.id))).limit(1);
    assertFound(a);
    await c.tx.update(bankAccounts).set({ status: "closed", updatedBy: c.auth.user.id }).where(eq(bankAccounts.id, d.accountId));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "finance.bank_account_closed", entityType: "bank_account", entityId: d.accountId, waqfId: c.access.waqf.id, ...meta(c), before: { status: a!.status }, after: { status: "closed" } });
    return { ok: true, message: "أُغلق الحساب في السجل." };
  }, SECTION);
}

// ───────────── Budget ─────────────
export async function saveBudget(_: ActionState, fd: FormData): Promise<ActionState> {
  const rows = readRows(fd, "bl", ["kind", "label", "amount"]);
  return fileAction(fd, z.object({ fiscalYear: year }), "finance.edit", async (c, d) => {
    const w = c.access.waqf;
    const lines: { code: string; label: string; amount: number; kind: "revenue" | "expense" }[] = [];
    for (const [i, r] of rows.entries()) {
      const amount = Number(normalizeNumber(r.amount));
      if (r.kind !== "revenue" && r.kind !== "expense") return { error: `اختر «إيراد» أو «مصروف» في السطر ${i + 1}.` };
      if (!r.label) return { error: `اكتب بيان السطر ${i + 1}.` };
      if (!Number.isFinite(amount) || amount < 0) return { error: `المبلغ في السطر ${i + 1} غير صحيح.` };
      lines.push({ code: `${r.kind === "revenue" ? "R" : "E"}${String(i + 1).padStart(2, "0")}`, label: r.label, amount: Math.round(amount * 100) / 100, kind: r.kind });
    }
    if (!lines.length) return { error: "أضف سطرًا واحدًا على الأقل." };
    const totalRevenue = lines.filter((l) => l.kind === "revenue").reduce((s, l) => s + l.amount, 0);
    const totalExpense = lines.filter((l) => l.kind === "expense").reduce((s, l) => s + l.amount, 0);
    const [cur] = await c.tx.select().from(budgets).where(and(eq(budgets.waqfId, w.id), eq(budgets.fiscalYear, d.fiscalYear))).limit(1);
    if (cur?.status === "approved") throw new UserError("موازنة هذه السنة معتمدة ولا تُعدّل. يلزم قرار معتمد لأي تعديل.");
    const values = { lines, totalRevenue: totalRevenue.toFixed(2), totalExpense: totalExpense.toFixed(2), updatedBy: c.auth.user.id };
    let id = cur?.id;
    if (cur) await c.tx.update(budgets).set(values).where(eq(budgets.id, cur.id));
    else id = (await c.tx.insert(budgets).values({ ...values, waqfId: w.id, fiscalYear: d.fiscalYear, createdBy: c.auth.user.id }).returning({ id: budgets.id }))[0].id;
    await audit(c.tx, { actorUserId: c.auth.user.id, action: cur ? "finance.budget_updated" : "finance.budget_created", entityType: "budget", entityId: id, waqfId: w.id, ...meta(c), before: cur ? { totalRevenue: cur.totalRevenue, totalExpense: cur.totalExpense } : null, after: { fiscalYear: d.fiscalYear, totalRevenue, totalExpense, lines: lines.length } });
    return { ok: true, message: `حُفظت مسودة موازنة ${d.fiscalYear}${totalExpense > totalRevenue ? " — المصروفات تزيد على الإيرادات" : ""}.` };
  }, SECTION);
}

export async function approveBudget(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, z.object({ budgetId: z.uuid() }), "finance.approve", async (c, d) => {
    const w = c.access.waqf;
    const [b] = await c.tx.select().from(budgets).where(and(eq(budgets.id, d.budgetId), eq(budgets.waqfId, w.id))).limit(1);
    assertFound(b);
    if (b!.status === "approved") throw new UserError("الموازنة معتمدة مسبقًا.");
    const t = todayIso();
    await c.tx.update(budgets).set({ status: "approved", approvedOn: t, updatedBy: c.auth.user.id }).where(eq(budgets.id, b!.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "finance.budget_approved", entityType: "budget", entityId: b!.id, waqfId: w.id, ...meta(c), after: { fiscalYear: b!.fiscalYear, approvedOn: t } });
    await addTimeline(c.tx, w, c.auth.user.id, "governance", `اعتماد موازنة السنة المالية ${b!.fiscalYear}`);
    return { ok: true, message: "اعتُمدت الموازنة." };
  }, SECTION);
}

// ───────────── Journal (simple double entry) ─────────────
const journalSchema = z.object({ entryDate: reqDate("أدخل تاريخ القيد."), description: reqText(300, "اكتب بيان القيد."), referenceNo: optText(60) });

export async function addJournalEntry(_: ActionState, fd: FormData): Promise<ActionState> {
  const rows = readRows(fd, "jl", ["accountCode", "debit", "credit"]);
  return fileAction(fd, journalSchema, "finance.edit", async (c, d) => {
    const w = c.access.waqf;
    if (d.entryDate > todayIso()) return { error: "تاريخ القيد لا يكون في المستقبل.", fieldErrors: { entryDate: "تاريخ غير صحيح." } };
    const lines = rows.map((r) => ({ accountCode: r.accountCode, debit: Number(normalizeNumber(r.debit) ?? 0) || 0, credit: Number(normalizeNumber(r.credit) ?? 0) || 0 }));
    const v = validateJournal(lines);
    if (!v.ok) return { error: v.error };
    let ref = d.referenceNo;
    if (!ref) {
      const y = d.entryDate.slice(0, 4);
      const [{ n }] = await c.tx.select({ n: countDistinct(ledgerEntries.referenceNo) }).from(ledgerEntries).where(and(eq(ledgerEntries.waqfId, w.id), like(ledgerEntries.referenceNo, `JV-${y}-%`)));
      ref = `JV-${y}-${String(Number(n) + 1).padStart(4, "0")}`;
    }
    await c.tx.insert(ledgerEntries).values(lines.map((l) => ({ waqfId: w.id, entryDate: d.entryDate, accountCode: l.accountCode, description: d.description, debit: l.debit.toFixed(2), credit: l.credit.toFixed(2), referenceNo: ref, createdBy: c.auth.user.id })));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "finance.journal_posted", entityType: "ledger_entry", entityId: null, waqfId: w.id, ...meta(c), after: { referenceNo: ref, entryDate: d.entryDate, total: v.total, lines } });
    return { ok: true, message: `قُيّد القيد ${ref} (${v.total.toLocaleString("en-US")} ريال).` };
  }, SECTION);
}

// ───────────── Financial statements ─────────────
const stmtSchema = z.object({
  fiscalYear: year,
  kind: z.enum(["audited", "simple_statement"], { error: "اختر نوع القوائم." }),
  auditorName: optText(160),
  auditorLicense: optText(60),
  auditorIndependent: flag,
  opinion: z.union([z.literal(""), z.enum(["unqualified", "qualified", "adverse", "disclaimer"])]).optional().transform((v) => v || null),
  totalRevenue: optMoney,
  totalExpense: optMoney,
}).superRefine((d, ctx) => {
  if (d.kind === "audited" && !d.auditorName) ctx.addIssue({ code: "custom", path: ["auditorName"], message: "القوائم المدققة تحتاج اسم المراجع المعتمد." });
});

export async function createStatement(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, stmtSchema, "finance.edit", async (c, d) => {
    const w = c.access.waqf;
    const [dup] = await c.tx.select({ id: financialStatements.id }).from(financialStatements).where(and(eq(financialStatements.waqfId, w.id), eq(financialStatements.fiscalYear, d.fiscalYear))).limit(1);
    if (dup) throw new UserError(`سُجّلت قوائم السنة ${d.fiscalYear} مسبقًا.`);
    const [s] = await c.tx.insert(financialStatements).values({ ...d, waqfId: w.id, createdBy: c.auth.user.id }).returning({ id: financialStatements.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "finance.statement_created", entityType: "financial_statement", entityId: s.id, waqfId: w.id, ...meta(c), after: d });
    const req = requiredStatementKind(w.sizeClass);
    const warn = req !== d.kind ? ` فئة الوقف تتطلب ${req === "audited" ? "قوائم مدققة من مراجع معتمد" : "بيانًا ماليًا مبسطًا"}.` : "";
    return { ok: true, message: `سُجّلت القوائم كمسودة. ارفع الملف ثم اعتمدها.${warn}` };
  }, SECTION);
}

/** Approving the statements makes them final and starts the GAA submission deadline (OB-FIN-04). */
export async function approveStatement(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, z.object({ statementId: z.uuid() }), "finance.approve", async (c, d) => {
    const w = c.access.waqf;
    const [s] = await c.tx.select().from(financialStatements).where(and(eq(financialStatements.id, d.statementId), eq(financialStatements.waqfId, w.id))).limit(1);
    assertFound(s);
    if (s!.status !== "draft") throw new UserError("القوائم معتمدة مسبقًا.");
    const [doc] = await c.tx
      .select({ id: documents.id, status: documents.status })
      .from(documentLinks)
      .innerJoin(documents, eq(documents.id, documentLinks.documentId))
      .where(and(eq(documentLinks.entityType, "financial_statement"), eq(documentLinks.entityId, s!.id), eq(documents.status, "active")))
      .limit(1);
    if (!doc) throw new UserError("ارفع ملف القوائم أولًا، وانتظر اكتمال فحصه، ثم اعتمدها.");
    const t = todayIso();
    await c.tx.update(financialStatements).set({ status: "final", documentId: doc.id, updatedBy: c.auth.user.id }).where(eq(financialStatements.id, s!.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "finance.statement_approved", entityType: "financial_statement", entityId: s!.id, waqfId: w.id, ...meta(c), before: { status: "draft" }, after: { status: "final", documentId: doc.id } });
    await emitWaqfEvent(c.tx, { waqfId: w.id, event: "statements_final", date: t, refId: s!.id, actorUserId: c.auth.user.id, meta: { documentId: doc.id, fiscalYear: s!.fiscalYear } });
    await addTimeline(c.tx, w, c.auth.user.id, "governance", `اعتماد القوائم المالية لسنة ${s!.fiscalYear}`);
    return { ok: true, message: "اعتُمدت القوائم. ارفعها للهيئة خلال 10 أيام عمل (أُضيف الالتزام)." };
  }, SECTION);
}

export async function markStatementSubmitted(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, z.object({ statementId: z.uuid(), submittedToGaaOn: reqDate("أدخل تاريخ الرفع."), sharedWithBeneficiaries: flag }), "finance.edit", async (c, d) => {
    const w = c.access.waqf;
    const [s] = await c.tx.select().from(financialStatements).where(and(eq(financialStatements.id, d.statementId), eq(financialStatements.waqfId, w.id))).limit(1);
    assertFound(s);
    if (s!.status === "draft") throw new UserError("اعتمد القوائم قبل تسجيل رفعها.");
    if (d.submittedToGaaOn > todayIso()) return { error: "تاريخ الرفع لا يكون في المستقبل." };
    await c.tx.update(financialStatements).set({ status: "submitted", submittedToGaaOn: d.submittedToGaaOn, sharedWithBeneficiaries: d.sharedWithBeneficiaries, updatedBy: c.auth.user.id }).where(eq(financialStatements.id, s!.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "finance.statement_submitted", entityType: "financial_statement", entityId: s!.id, waqfId: w.id, ...meta(c), after: d });
    return { ok: true, message: "سُجّل رفع القوائم للهيئة. أغلق الالتزام من صفحة الامتثال بإرفاق إيصال الرفع." };
  }, SECTION);
}
