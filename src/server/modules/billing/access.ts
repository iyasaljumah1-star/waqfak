import "server-only";
import { eq } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { invoices } from "@/server/db/schema";
import type { Auth } from "@/server/authz/context";
import { memberWaqfIdsWith } from "@/server/modules/requests/access";

export type InvoiceRow = typeof invoices.$inferSelect;

/**
 * Invoice isolation (app level, on top of RLS — RLS shows waqf-less invoices to everyone):
 * the billed user, a waqf member whose membership grants requests.view/finance.view, or staff with admin.finance.
 */
export async function canSeeInvoice(tx: Tx, auth: Auth, inv: Pick<InvoiceRow, "userId" | "waqfId">) {
  if (inv.userId === auth.user.id) return true;
  if (auth.isStaff && auth.perms.has("admin.finance")) return true;
  if (inv.waqfId) {
    const a = await memberWaqfIdsWith(tx, auth, "requests.view");
    if (a.includes(inv.waqfId)) return true;
    const b = await memberWaqfIdsWith(tx, auth, "finance.view");
    if (b.includes(inv.waqfId)) return true;
  }
  return false;
}

/** May pay: the billed user, or a member with contracts.sign / finance.edit on the waqf. */
export async function canPayInvoice(tx: Tx, auth: Auth, inv: Pick<InvoiceRow, "userId" | "waqfId">) {
  if (inv.userId === auth.user.id) return true;
  if (inv.waqfId) {
    for (const p of ["contracts.sign", "finance.edit"]) if ((await memberWaqfIdsWith(tx, auth, p)).includes(inv.waqfId)) return true;
  }
  return false;
}

export async function loadInvoice(tx: Tx, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  return inv ?? null;
}

export const INVOICE_STATUS_LABEL: Record<string, string> = { issued: "مستحقة", paid: "مدفوعة", void: "ملغاة", overdue: "متأخرة", credit_note: "إشعار دائن" };
export const INVOICE_STATUS_TONE: Record<string, "ok" | "warn" | "critical" | "neutral" | "info"> = { issued: "warn", paid: "ok", void: "neutral", overdue: "critical", credit_note: "info" };
export const PAYMENT_STATUS_LABEL: Record<string, string> = { initiated: "بدأت", paid: "ناجحة", failed: "مرفوضة", refunded: "مستردة" };
export const PROVIDER_LABEL: Record<string, string> = { sandbox: "بيئة تجريبية", bank_transfer: "تحويل بنكي", moyasar: "ميسر", hyperpay: "هايبر باي" };

/** Display status: issued + past due → overdue. */
export function effectiveStatus(inv: Pick<InvoiceRow, "status" | "dueOn">, today: string) {
  if (inv.status === "issued" && inv.dueOn && inv.dueOn < today) return "overdue";
  return inv.status;
}
