import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Tx } from "../../db";
import { beneficiaries, complaints, users } from "../../db/schema";

const responder = alias(users, "responder");

export async function waqfComplaints(tx: Tx, waqfId: string) {
  return tx
    .select({ c: complaints, raisedBy: users.fullName, beneficiary: beneficiaries.displayName, responder: responder.fullName })
    .from(complaints)
    .leftJoin(users, eq(users.id, complaints.raisedByUserId))
    .leftJoin(beneficiaries, eq(beneficiaries.id, complaints.beneficiaryId))
    .leftJoin(responder, eq(responder.id, complaints.respondedBy))
    .where(eq(complaints.waqfId, waqfId))
    .orderBy(desc(complaints.createdAt))
    .limit(300);
}

/** Only the caller's own submissions. */
export async function mySubmissions(tx: Tx, waqfId: string, userId: string) {
  return tx
    .select()
    .from(complaints)
    .where(and(eq(complaints.waqfId, waqfId), eq(complaints.raisedByUserId, userId)))
    .orderBy(desc(complaints.createdAt))
    .limit(100);
}
