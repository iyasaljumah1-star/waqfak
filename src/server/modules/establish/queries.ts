import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Tx } from "../../db";
import { deedVersions, waqfDeeds, waqfMemberships, waqfs } from "../../db/schema";
import { normalizeState, type EstablishState } from "./pure";

const DRAFT_STATUSES = ["idea", "draft"] as const;

/** The user's establishment drafts: waqfs they created by the wizard (inter vivos, status idea/draft). */
export async function myDrafts(tx: Tx, userId: string) {
  const rows = await tx
    .select({ id: waqfs.id, name: waqfs.name, status: waqfs.status, internalNumber: waqfs.internalNumber, updatedAt: waqfs.updatedAt, legalType: waqfs.legalType })
    .from(waqfs)
    .innerJoin(waqfMemberships, and(eq(waqfMemberships.waqfId, waqfs.id), eq(waqfMemberships.userId, userId), eq(waqfMemberships.roleKey, "founder"), eq(waqfMemberships.status, "active")))
    .where(and(eq(waqfs.createdBy, userId), eq(waqfs.creationMode, "inter_vivos"), inArray(waqfs.status, [...DRAFT_STATUSES])))
    .orderBy(desc(waqfs.updatedAt));
  const out: (typeof rows[number] & { state: EstablishState | null })[] = [];
  for (const r of rows) {
    const s = await draftState(tx, r.id);
    if (s) out.push({ ...r, state: s.state });
  }
  return out;
}

/** Loads the wizard state stored in the draft's first deed version (structured jsonb). Null if not a wizard draft. */
export async function draftState(tx: Tx, waqfId: string) {
  const [row] = await tx
    .select({ deedId: waqfDeeds.id, versionId: deedVersions.id, structured: deedVersions.structured, body: deedVersions.body })
    .from(waqfDeeds)
    .innerJoin(deedVersions, eq(deedVersions.deedId, waqfDeeds.id))
    .where(eq(waqfDeeds.waqfId, waqfId))
    .orderBy(desc(deedVersions.version))
    .limit(1);
  if (!row || (row.structured as { kind?: string } | null)?.kind !== "establish") return null;
  return { deedId: row.deedId, versionId: row.versionId, state: normalizeState(row.structured), body: row.body };
}
