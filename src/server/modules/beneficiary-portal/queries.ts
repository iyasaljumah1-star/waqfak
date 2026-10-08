import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "../../db";
import { beneficiaries, beneficiaryClasses, distributionLines, distributions, entitlements, waqfs } from "../../db/schema";
import { mySubmissions } from "../complaints/queries";

/**
 * Everything a beneficiary may see about a waqf. RLS lets beneficiary members reach the waqf's rows,
 * so every query here is filtered by the caller's own beneficiary record(s) (beneficiaries.user_id = me).
 * Never select other beneficiaries' rows, names or totals.
 */
export async function beneficiaryView(tx: Tx, waqfId: string, userId: string) {
  const [w] = await tx
    .select({ id: waqfs.id, name: waqfs.name, internalNumber: waqfs.internalNumber, legalType: waqfs.legalType, nazirMode: waqfs.nazirMode, status: waqfs.status, fieldOfWork: waqfs.fieldOfWork, registeredOn: waqfs.registeredOn })
    .from(waqfs)
    .where(eq(waqfs.id, waqfId))
    .limit(1);
  if (!w) return null;

  const mine = await tx
    .select({ id: beneficiaries.id, displayName: beneficiaries.displayName, status: beneficiaries.status, share: beneficiaries.entitlementShare, lastVerifiedOn: beneficiaries.lastVerifiedOn, className: beneficiaryClasses.name, divisionRule: beneficiaryClasses.divisionRule })
    .from(beneficiaries)
    .leftJoin(beneficiaryClasses, eq(beneficiaryClasses.id, beneficiaries.classId))
    .where(and(eq(beneficiaries.waqfId, waqfId), eq(beneficiaries.userId, userId), isNull(beneficiaries.archivedAt)));
  const ids = mine.map((b) => b.id);

  const ents = ids.length
    ? await tx.select().from(entitlements).where(and(eq(entitlements.waqfId, waqfId), inArray(entitlements.beneficiaryId, ids))).orderBy(desc(entitlements.period))
    : [];
  const lines = ids.length
    ? await tx
        .select({ id: distributionLines.id, beneficiaryId: distributionLines.beneficiaryId, amount: distributionLines.amount, status: distributionLines.status, paidOn: distributionLines.paidOn, referenceNo: distributionLines.referenceNo, period: distributions.period })
        .from(distributionLines)
        .innerJoin(distributions, eq(distributions.id, distributionLines.distributionId))
        .where(and(eq(distributionLines.waqfId, waqfId), inArray(distributionLines.beneficiaryId, ids)))
        .orderBy(desc(distributions.period))
    : [];
  const submissions = await mySubmissions(tx, waqfId, userId);
  return { waqf: w, mine, entitlements: ents, lines, submissions };
}
