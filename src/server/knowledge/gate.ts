import "server-only";
import type { Tx } from "@/server/db";
import type { OutputSection } from "@/server/db/schema";
import { dossierStanding, passageStanding } from "./review";
import { registryCitable } from "./retrieve";

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
  const refs = blocks.flatMap(({ s, b }) => ((b as { refs?: { chunkId: string; refCode: string; locator: string }[] }).refs ?? []).map((r) => ({ section: s.title, ...r })));
  const dossiers = blocks.map(({ s, b }) => ({ section: s.title, id: (b as { dossierId?: string }).dossierId })).filter((x): x is { section: string; id: string } => !!x.id);
  const errors: string[] = [];
  const ids = [...new Set(refs.map((r) => r.chunkId))];
  const [standing, registry] = await Promise.all([passageStanding(tx, ids), registryCitable(tx, ids, asOf)]);
  for (const r of refs) {
    if (registry.has(r.chunkId)) {
      if (!registry.get(r.chunkId)) errors.push(`${r.section}: ${r.refCode} ${r.locator} — مطابقة المادة لم تُعتمد من مراجع نظامي.`);
      continue;
    }
    const st = standing.get(r.chunkId) ?? "unreviewed";
    if (st !== "approved") errors.push(`${r.section}: ${r.refCode} ${r.locator} — النص المستند إليه ${STANDING_AR[st]}؛ يلزم مراجعة هذا المقطع من مختص مجاله.`);
  }
  const ds = await dossierStanding(tx, [...new Set(dossiers.map((d) => d.id))]);
  for (const d of dossiers) {
    const x = ds.get(d.id);
    if (!x?.final) errors.push(`${d.section}: الملف البحثي الشرعي ${d.id.slice(0, 8)} ${x?.latest ? `آخر قرار فيه «${x.latest.decision}»` : "لم يراجعه المراجع الشرعي"}؛ لا يُعتمد المستند قبل اعتماد النتيجة أو تعديلها.`);
  }
  return [...new Set(errors)];
}
