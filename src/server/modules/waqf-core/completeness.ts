import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { completeness, type CompletenessFacts } from "./file-review-pure";

export type WaqfCompleteness = { complete: boolean; missing: string[] };

/**
 * Completeness of the given waqfs, computed from their records in one query. The counts are read with the system
 * context (a member's own view may not show every document or class), and only yes/no facts leave this function; the
 * caller has already been given the waqf ids through its own access.
 */
export async function completenessOf(tx: Tx, waqfIds: string[]): Promise<Map<string, WaqfCompleteness>> {
  const out = new Map<string, WaqfCompleteness>();
  if (!waqfIds.length) return out;
  const ids = sql.join(waqfIds.map((i) => sql`${i}::uuid`), sql`, `);
  // counts only, for the waqfs the caller can see — through a function that checks it (stage 11)
  const rows = await tx.execute<{ id: string; status: string; archived: boolean; deed: boolean; assets: number; classes: number; trustees: number; board: number }>(sql`select * from app_waqf_completeness(array[${ids}]::uuid[])`);
  for (const r of rows.rows) {
    const f: CompletenessFacts = { status: r.status, archived: r.archived, deedInVault: r.deed, assets: Number(r.assets), classes: Number(r.classes), trustees: Number(r.trustees), boardMembers: Number(r.board) };
    out.set(r.id, completeness(f));
  }
  return out;
}

/** SQL predicate (on alias `w`) equal to `completeness(...).complete`, for counts over all waqfs. */
export const COMPLETE_WAQF_SQL = sql`(
  w.archived_at is null and w.status in ('documented','registered','active','suspended')
  and exists (select 1 from documents d where d.waqf_id = w.id and d.doc_type = 'waqf_deed' and d.status = 'active' and d.archived_at is null)
  and exists (select 1 from assets a where a.waqf_id = w.id and a.archived_at is null)
  and exists (select 1 from beneficiary_classes c where c.waqf_id = w.id)
  and (exists (select 1 from trustees t where t.waqf_id = w.id and t.status = 'active')
    or exists (select 1 from body_memberships m join bodies b on b.id = m.body_id
      where b.waqf_id = w.id and b.kind = 'board' and coalesce(m.status, 'active') = 'active' and (m.ends_on is null or m.ends_on >= current_date))))`;
