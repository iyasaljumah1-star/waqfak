import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as s from "@/server/db/schema";
import { SPLITTER_VERSION, assessQuality, normForSearch, splitPassages, type TextQuality } from "./pure";

/**
 * Loads one version of a reference text into the knowledge base: the source row (with its version, origin, fingerprint
 * and text quality) and its passages verbatim. Idempotent on (refCode, version): the same text is not loaded twice;
 * a new version supersedes the previous one without deleting it (earlier runs keep pointing to what they used).
 * The verification status comes from the reference registry (regulatory_references) — never assumed here.
 */
export type KbInput = {
  refCode: string; version: string; title: string; issuer?: string | null; bindingLevel?: string | null;
  kind: "statute" | "guidance" | "interpretation"; origin: string; effectiveOn?: string | null; text: string; note?: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = NodePgDatabase<any>;

export async function ingestSource(db: AnyDb, x: KbInput): Promise<{ status: "loaded" | "unchanged"; quality: TextQuality; passages: number }> {
  // the splitter's version is part of the fingerprint: a corrected splitter re-splits a source already loaded
  const sha = createHash("sha256").update(`${SPLITTER_VERSION}\n${x.text}`).digest("hex");
  const [existing] = await db.select().from(s.kbSources).where(and(eq(s.kbSources.refCode, x.refCode), eq(s.kbSources.version, x.version))).limit(1);
  if (existing && existing.sha256 === sha) return { status: "unchanged", quality: existing.textQuality as TextQuality, passages: existing.chunkCount };
  const q = assessQuality(x.text);
  const passages = q.quality === "unreadable" ? [] : splitPassages(x.text);
  const [ref] = await db.select({ status: s.regulatoryReferences.verificationStatus }).from(s.regulatoryReferences).where(eq(s.regulatoryReferences.code, x.refCode)).limit(1);
  await db.transaction(async (tx) => {
    if (existing) await tx.delete(s.kbSources).where(eq(s.kbSources.id, existing.id)); // same version, corrected text
    // the newest version is current; earlier versions stay (superseded)
    await tx.update(s.kbSources).set({ supersededAt: new Date() }).where(and(eq(s.kbSources.refCode, x.refCode), isNull(s.kbSources.supersededAt)));
    const [src] = await tx.insert(s.kbSources).values({
      refCode: x.refCode, version: x.version, title: x.title, issuer: x.issuer ?? null, bindingLevel: x.bindingLevel ?? null,
      verificationStatus: ref?.status === "verified" ? "verified" : "pending_verification", effectiveOn: x.effectiveOn ?? null,
      origin: x.origin, sha256: sha, textQuality: q.quality, qualityNote: [q.note, x.note].filter(Boolean).join(" "), chunkCount: passages.length,
    }).returning({ id: s.kbSources.id });
    for (let i = 0; i < passages.length; i += 200) {
      await tx.insert(s.kbChunks).values(passages.slice(i, i + 200).map((p, k) => ({
        sourceId: src.id, seq: i + k + 1, locator: p.locator, articleNo: p.articleNo, kind: x.kind, text: p.text, norm: normForSearch(p.text),
        sha256: createHash("sha256").update(p.text).digest("hex"),
      })));
    }
  });
  return { status: "loaded", quality: q.quality, passages: passages.length };
}
