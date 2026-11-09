import "server-only";
import { eq, inArray } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { kbChunks, kbSources } from "@/server/db/schema";
import type { OutputSection } from "@/server/db/schema";
import { dossierStanding, passageStanding } from "./review";
import { registryCitable } from "./retrieve";
import { engineBlockErrors, type SpecialistBlock } from "@/server/modules/outputs/binding";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STANDING_AR = { unreviewed: "غير مراجع", under_review: "قيد المراجعة", rejected: "مرفوض" } as const;

/**
 * The final approval's review gate (owner's order 2026-11-07, §5.7 and §7.9–7.10): an output reaches a client only when
 * every passage it cites has been reviewed — that passage, by its field, in an authenticated session (B13) — or, for a
 * registry instrument, its article's comparison accepted; and every research dossier it rests on has been approved or
 * modified by a qualified reviewer. Applied on the server at the approval (outputs/quality.ts), and again by the
 * database (security.sql output_unreviewed_basis); release, download and notification all follow the approval only.
 */
export async function finalBasisErrors(tx: Tx, sections: OutputSection[], asOf: string): Promise<string[]> {
  const blocks = sections.filter((s) => !s.removed).flatMap((s) => s.blocks.map((b) => ({ s, b }))).filter((x) => x.b.type === "specialist");
  // the passages cited, and every passage the model was given for the section, cited or not (N7-14)
  type R = { chunkId: string; refCode: string; locator: string };
  const seenRef = new Set<string>();
  const refs = blocks.flatMap(({ s, b }) => [...((b as { refs?: R[] }).refs ?? []), ...((b as { basis?: R[] }).basis ?? [])].map((r) => ({ section: s.title, ...r })))
    .filter((r) => { const k = `${r.section}|${r.chunkId}`; if (seenRef.has(k)) return false; seenRef.add(k); return true; });
  const dossiers = blocks.map(({ s, b }) => ({ section: s.title, id: (b as { dossierId?: string }).dossierId })).filter((x): x is { section: string; id: string } => !!x.id);
  const errors: string[] = [];
  // every engine-written text bound to its run, references, basis and dossier (N9-9); a model's text never without them
  for (const { s, b } of blocks) for (const e of engineBlockErrors(b as SpecialistBlock)) errors.push(`${s.title}: ${e}.`);
  // a text that cites [n] carries the references it cites, whoever wrote it
  for (const { s, b } of blocks) {
    const sb = b as SpecialistBlock;
    if (sb.by === "engine") continue;
    const cited = [...sb.text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    if (cited.length && cited.some((n) => !(sb.refs ?? []).some((r) => r.n === n))) errors.push(`${s.title}: النص يستشهد برقم لا مرجع له.`);
  }
  const ids = [...new Set(refs.map((r) => r.chunkId))];
  const uuidIds = ids.filter((x) => UUID.test(x));
  const [standing, registry] = await Promise.all([passageStanding(tx, uuidIds), registryCitable(tx, uuidIds, asOf)]);
  // a passage of a version since superseded, or of a source repealed by the date, is not a basis (N7-14: decide() again)
  const state = uuidIds.length ? await tx.select({ id: kbChunks.id, superseded: kbSources.supersededAt, repealed: kbSources.repealedOn, registryId: kbSources.registryId })
    .from(kbChunks).innerJoin(kbSources, eq(kbSources.id, kbChunks.sourceId)).where(inArray(kbChunks.id, uuidIds)) : [];
  const stateOf = new Map(state.map((x) => [x.id, x]));
  for (const r of refs) {
    const st0 = stateOf.get(r.chunkId);
    if (!st0) { errors.push(`${r.section}: ${r.refCode} ${r.locator} — المقطع غير موجود في قاعدة المعرفة.`); continue; }
    if (!st0.registryId && (st0.superseded || (st0.repealed && st0.repealed <= asOf))) { errors.push(`${r.section}: ${r.refCode} ${r.locator} — ${st0.superseded ? "نسخة استُبدلت" : "مصدر ملغى"}؛ لا يُعتمد عليه.`); continue; }
    if (registry.has(r.chunkId)) {
      if (!registry.get(r.chunkId)) errors.push(`${r.section}: ${r.refCode} ${r.locator} — مطابقة المادة لم تُعتمد من مراجع نظامي.`);
      continue;
    }
    const st = standing.get(r.chunkId) ?? "unreviewed";
    if (st !== "approved") errors.push(`${r.section}: ${r.refCode} ${r.locator} — النص المستند إليه ${STANDING_AR[st]}؛ يلزم مراجعة هذا المقطع من مختص مجاله.`);
  }
  // an id that is not a uuid is not a dossier: counted as unreviewed, never a failed query (G13, fail safe)
  const ds = await dossierStanding(tx, [...new Set(dossiers.map((d) => d.id))].filter((x) => UUID.test(x)));
  for (const d of dossiers) {
    const x = ds.get(d.id);
    if (!x?.final) errors.push(`${d.section}: الملف البحثي الشرعي ${d.id.slice(0, 8)} ${x?.latest ? `آخر قرار فيه «${x.latest.decision}»` : "لم يراجعه المراجع الشرعي"}؛ لا يُعتمد المستند قبل اعتماد النتيجة أو تعديلها.`);
  }
  return [...new Set(errors)];
}
