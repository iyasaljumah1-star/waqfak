import "server-only";
import { withContext } from "../../db";
import type { Viewer } from "./access";
import { listShares, loadResultBundle, myWaqfsWith, type ResultBundle } from "./queries";

export type ResultPageData = {
  bundle: ResultBundle;
  shares: { id: string; expiresAt: string; revokedAt: string | null; views: number; createdAt: string }[];
  claimWaqfs: { id: string; name: string }[];
};

/** Loads the result bundle plus the viewer-specific extras (share links, waqfs for claiming). */
export async function resultPageData(v: Viewer): Promise<ResultPageData | null> {
  const data = await withContext(v.db, async (tx) => {
    const bundle = await loadResultBundle(tx, v.row);
    if (!bundle) return null;
    const shares = v.canShare ? await listShares(tx, v.row.id) : [];
    return {
      bundle,
      shares: shares.map((s) => ({ id: s.id, expiresAt: s.expiresAt.toISOString(), revokedAt: s.revokedAt?.toISOString() ?? null, views: s.views, createdAt: s.createdAt.toISOString() })),
    };
  });
  if (!data) return null;
  const claimWaqfs = v.canClaim && v.auth ? (await myWaqfsWith(v.auth, "assessment.run")).map((w) => ({ id: w.id, name: w.name })) : [];
  return { ...data, claimWaqfs };
}
