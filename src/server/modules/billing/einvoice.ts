import "server-only";
import type { Tx } from "@/server/db";
import { companyProfile } from "@/server/modules/commerce/state";
import { einvoiceReadiness } from "./einvoice-pure";

/**
 * E-invoicing (ZATCA «فاتورة») switches on by itself once every condition is met — decided by the owner: it is
 * active as soon as the company's tax data and the onboarding credentials are complete and the connector exists.
 * Credentials are read from the environment only (never stored in code or the database).
 */
export async function einvoiceState(tx: Tx) {
  const company = await companyProfile(tx);
  return einvoiceReadiness({
    company,
    credentials: { csid: !!process.env.ZATCA_CSID, secret: !!process.env.ZATCA_SECRET, env: process.env.ZATCA_ENV ?? "" },
  });
}
