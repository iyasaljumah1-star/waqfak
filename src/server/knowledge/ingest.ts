import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as s from "@/server/db/schema";
import { normForSearch } from "@/server/engine/knowledge/pure";
import type { RefKind } from "./policy";
import type { Unit } from "./units";

/**
 * Loads one source of the unified knowledge engine with its retrieval units. Never deletes: the same text of the same
 * version is loaded once; a new version or a corrected text becomes the current row and the earlier row is kept
 * (superseded), so earlier processing runs still resolve the passages they cited. The source's kind and services are
 * recorded explicitly — being attached to the project does not make a file binding.
 */
export type SourceInput = {
  refCode: string;
  version: string;
  title: string;
  issuer: string | null;
  refKind: RefKind;
  registryId?: string | null;
  registrySnapshot?: string | null;
  edition?: string | null;
  publishedOn?: string | null;
  effectiveOn?: string | null;
  repealedOn?: string | null;
  services: string[];
  origin: string;
  /** Fingerprint of the original (file bytes or official text). */
  originSha256: string;
  textQuality: "good" | "degraded" | "unreadable";
  qualityNote: string;
  units: Unit[];
  meta?: Record<string, unknown>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = NodePgDatabase<any>;

const BINDING: Partial<Record<RefKind, string>> = { statute: "binding", regulation: "binding", official_instruction: "binding" };
const CHUNK_KIND = (k: RefKind) => (BINDING[k] ? "statute" : k === "classical_fiqh" || k === "contemporary_book" || k === "academic_study" ? "interpretation" : "guidance");

export async function ingestUnits(db: AnyDb, x: SourceInput): Promise<{ status: "loaded" | "unchanged"; units: number }> {
  const sha = createHash("sha256").update(`units-1\n${x.originSha256}\n${x.units.map((u) => `${u.locator}\u0001${u.text}`).join("\u0002")}`).digest("hex");
  const [existing] = await db.select({ id: s.kbSources.id, n: s.kbSources.chunkCount }).from(s.kbSources).where(and(eq(s.kbSources.refCode, x.refCode), eq(s.kbSources.version, x.version), eq(s.kbSources.sha256, sha))).limit(1);
  if (existing) return { status: "unchanged", units: existing.n };
  await db.transaction(async (tx) => {
    await tx.update(s.kbSources).set({ supersededAt: new Date() }).where(and(eq(s.kbSources.refCode, x.refCode), isNull(s.kbSources.supersededAt)));
    const [src] = await tx
      .insert(s.kbSources)
      .values({
        refCode: x.refCode, version: x.version, title: x.title, issuer: x.issuer, bindingLevel: BINDING[x.refKind] ?? (x.refKind === "professional_standard" ? "professional" : "guidance"),
        verificationStatus: "pending_verification", effectiveOn: x.effectiveOn ?? null, origin: x.origin, sha256: sha, textQuality: x.textQuality, qualityNote: x.qualityNote,
        chunkCount: x.units.length, refKind: x.refKind, registryId: x.registryId ?? null, registrySnapshot: x.registrySnapshot ?? null, edition: x.edition ?? null,
        publishedOn: x.publishedOn ?? null, repealedOn: x.repealedOn ?? null, services: x.services, meta: { originSha256: x.originSha256, ...(x.meta ?? {}) },
      })
      .returning({ id: s.kbSources.id });
    for (let i = 0; i < x.units.length; i += 200) {
      await tx.insert(s.kbChunks).values(
        x.units.slice(i, i + 200).map((u, k) => ({
          sourceId: src!.id, seq: i + k + 1, locator: u.locator, articleNo: u.articleNo, paragraphNo: u.paragraphNo, pageFile: u.pageFile, pagePrinted: u.pagePrinted,
          kind: CHUNK_KIND(x.refKind), text: u.text, norm: normForSearch(u.text), sha256: createHash("sha256").update(u.text).digest("hex"), textOrigin: u.textOrigin,
        })),
      );
    }
  });
  return { status: "loaded", units: x.units.length };
}
