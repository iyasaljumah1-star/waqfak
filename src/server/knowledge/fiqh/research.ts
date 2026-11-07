import "server-only";
import { inArray } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { fiqhDossiers, kbSources } from "@/server/db/schema";
import { canonical } from "@/server/lib/audit";
import { sha256 } from "@/server/lib/crypto";
import { DRAFT_FLAG_AR, type RefKind } from "../policy";
import { retrieve, type Retrieved } from "../retrieve";
import { analyzeIssue, compare, extractStatements, LIMITS, regulatoryTrack, weigh } from "./analyze";
import { DOSSIER_STANDING, STAGES, type Fact, type FiqhDossier, type SourceRef, type Stage } from "./types";

export const FIQH_ENGINE_VERSION = "fiqh-research/2";

/** Kinds searched for a fiqh matter (§3.2): the school's books, contemporary books, and official guidance by its nature. */
const FIQH_KINDS: RefKind[] = ["classical_fiqh", "contemporary_book", "official_guide", "statute", "regulation", "official_instruction"];

export type ResearchInput = { question: string; facts: Fact[]; service?: string; asOf: string; stage?: Stage; limit?: number; refCodes?: string[] };

/**
 * Prepares a fiqh research dossier from the knowledge base (§3): the matter and its facts; the passages found in the
 * school's books, «الميسّر» and official guidance — reviewed or not, each with its standing and flags; the statements
 * extracted; the comparison; a preliminary weighing. Searches more than one source; never assumes a statement that no
 * passage holds. Runs locally on the knowledge base: nothing is sent to any model.
 */
export async function research(tx: Tx, x: ResearchInput): Promise<FiqhDossier> {
  const stage: Stage = x.stage ?? "preliminary";
  const service = x.service ?? "*";
  const issue = analyzeIssue(x.question, x.facts);
  // the question as asked, and the question with its topic's name (recall in other words), merged by passage
  const queries = [x.question, ...(issue.topic ? [`${issue.topic}: ${x.question}`] : [])];
  const seen = new Map<string, Retrieved>();
  // each kind searched on its own, so that guidance pages do not crowd out the school's books (§3.2: more than one source)
  const groups: { kinds: RefKind[]; limit: number }[] = [{ kinds: ["classical_fiqh"], limit: x.limit ?? 8 }, { kinds: ["contemporary_book"], limit: 4 }, { kinds: ["official_guide"], limit: 3 }, { kinds: ["statute", "regulation", "official_instruction"], limit: 3 }];
  for (const q of queries) for (const g of groups) {
    const r = await retrieve(tx, { question: q, service, asOf: x.asOf, kinds: g.kinds.filter((k) => FIQH_KINDS.includes(k)), limit: g.limit, refCodes: x.refCodes });
    for (const u of r.usable) if (!seen.has(u.hit.chunkId)) seen.set(u.hit.chunkId, u);
  }
  const used = [...seen.values()];
  const meta = used.length ? await tx.select({ refCode: kbSources.refCode, issuer: kbSources.issuer, edition: kbSources.edition, version: kbSources.version }).from(kbSources).where(inArray(kbSources.refCode, [...new Set(used.map((u) => u.hit.refCode))])) : [];
  const metaOf = new Map(meta.map((m) => [m.refCode, m]));
  const sources: SourceRef[] = used.map((u) => {
    const h = u.hit;
    const m = metaOf.get(h.refCode);
    const vol = h.locator.match(/ج\s?(\d{1,2})/)?.[1] ?? null;
    const page = h.locator.match(/ص\s?(\d{1,4})/)?.[1] ?? h.pagePrinted ?? null;
    const topic = h.text.match(/^\[([^\]]{2,80})\]/)?.[1] ?? null;
    return {
      chunkId: h.chunkId, refCode: h.refCode, refKind: h.refKind, title: h.title, author: m?.issuer ?? null, edition: m?.edition ?? m?.version ?? null,
      locator: h.locator, volume: vol, page, topic, status: u.draft.usable ? u.draft.status : "rejected",
      flags: u.draft.usable ? u.draft.flags.map((f) => DRAFT_FLAG_AR[f]) : [],
    };
  });
  const atLeast = (s: Stage) => STAGES.indexOf(stage) >= STAGES.indexOf(s);
  const statements = atLeast("extraction") ? used.flatMap((u, i) => extractStatements(sources[i]!, u.hit.text, { question: x.question, facts: x.facts, idPrefix: `ق${i + 1}` })) : [];
  const comparison = atLeast("comparison") ? compare(statements, issue) : null;
  const weighing = atLeast("preliminary") && comparison ? weigh(statements, issue, comparison) : null;
  // the regulatory track beside the fiqh result (§4): never weighed with it, never dropped
  const regulatory = atLeast("comparison") ? regulatoryTrack(statements, weighing) : null;
  return { kind: "fiqh_dossier", engineVersion: FIQH_ENGINE_VERSION, stage, asOf: x.asOf, service, issue, sources, statements, comparison, weighing, regulatory, standing: DOSSIER_STANDING, limits: LIMITS };
}

export const dossierSha256 = (d: FiqhDossier) => sha256(JSON.stringify(canonical(d)));

/** Stores a dossier (append-only) for the sharia reviewer's queue. Returns its id and content hash. */
export async function saveDossier(tx: Tx, d: FiqhDossier, o: { createdBy: string | null; requestId?: string | null; outputId?: string | null; reviewRole?: "sharia" | "legal" | "accounting" | "data" | "investment" }) {
  const hash = dossierSha256(d);
  const [row] = await tx.insert(fiqhDossiers).values({
    question: d.issue.question, facts: d.issue.facts, dossier: d as unknown as Record<string, unknown>, sha256: hash, stage: d.stage,
    reviewRole: o.reviewRole ?? "sharia", serviceCode: d.service === "*" ? null : d.service, requestId: o.requestId ?? null, outputId: o.outputId ?? null,
    engineVersion: d.engineVersion, createdBy: o.createdBy,
  }).returning({ id: fiqhDossiers.id });
  return { id: row!.id, sha256: hash };
}
