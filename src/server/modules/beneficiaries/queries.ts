import "server-only";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "../../db";
import { bankAccounts, beneficialOwners, beneficiaries, beneficiaryClasses, distributionLines, distributions, entitlements, users } from "../../db/schema";
import { decryptNullable } from "../../lib/crypto";
import { maskId } from "./pure";

export async function beneficiariesData(tx: Tx, waqfId: string) {
  const [classes, people, ents, dists, accounts] = await Promise.all([
    tx.select().from(beneficiaryClasses).where(eq(beneficiaryClasses.waqfId, waqfId)).orderBy(asc(beneficiaryClasses.tier), asc(beneficiaryClasses.position), asc(beneficiaryClasses.createdAt)),
    tx.select().from(beneficiaries).where(eq(beneficiaries.waqfId, waqfId)).orderBy(asc(beneficiaries.status), asc(beneficiaries.displayName)),
    tx.select().from(entitlements).where(eq(entitlements.waqfId, waqfId)).orderBy(desc(entitlements.period), desc(entitlements.createdAt)).limit(200),
    tx.select({ d: distributions, maker: users.fullName }).from(distributions).leftJoin(users, eq(users.id, distributions.createdBy)).where(eq(distributions.waqfId, waqfId)).orderBy(desc(distributions.createdAt)),
    tx.select({ id: bankAccounts.id, bankName: bankAccounts.bankName, last4: bankAccounts.ibanLast4, inWaqfName: bankAccounts.inWaqfName }).from(bankAccounts).where(and(eq(bankAccounts.waqfId, waqfId), eq(bankAccounts.status, "active"))),
  ]);
  const distIds = dists.map((x) => x.d.id);
  const lines = distIds.length ? await tx.select().from(distributionLines).where(inArray(distributionLines.distributionId, distIds)).orderBy(asc(distributionLines.referenceNo)) : [];
  return { classes, people, entitlements: ents, distributions: dists, lines, accounts };
}

/**
 * Beneficial-owner register with sensitive fields decrypted and masked on the server.
 * Full values never leave this function.
 */
export async function boRegister(tx: Tx, waqfId: string) {
  const rows = await tx.select().from(beneficialOwners).where(and(eq(beneficialOwners.waqfId, waqfId), isNull(beneficialOwners.archivedAt))).orderBy(asc(beneficialOwners.role), asc(beneficialOwners.fullName));
  return rows.map((r) => {
    const idNo = safeDecrypt(r.idNumberEnc);
    const addr = safeDecrypt(r.addressEnc);
    const bank = safeDecrypt(r.bankDetailsEnc);
    const { addressEnc: _a, idNumberEnc: _i, idNumberHash: _h, bankDetailsEnc: _b, ...rest } = r;
    void _a; void _i; void _h; void _b;
    return {
      ...rest,
      idNumberMasked: maskId(idNo),
      addressMasked: addr ? "•••• •••• ••••" : null,
      bankMasked: bank ? `•••• ${bank.slice(-4)}` : null,
      hasAddress: !!addr,
      hasBank: !!bank,
    };
  });
}

function safeDecrypt(v: string | null) {
  try {
    return decryptNullable(v);
  } catch {
    return v ? "????" : null;
  }
}
