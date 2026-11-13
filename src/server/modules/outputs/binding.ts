/**
 * The binding of an engine-written text to what it rests on (owner's order of 2026-11-09, «ثالثاً» — N9-9).
 *
 * A specialist block written by the processing engine carries its text, the run that wrote it, how it was written
 * (a model over retrieved passages, or a template over the request's data), the passages it cites (`refs`), every
 * passage the model was given (`basis`) and the research dossier it rests on. Those travel together or not at all:
 * `binding` is the sha256 of all of them in one canonical string, computed when the run writes the block and recomputed
 * by the final gate — on the server (gate.ts) and in the database (security.sql specialist_block_errors(), which builds
 * the same string). A text kept with another run's references, references dropped by a merge, a basis emptied, a
 * dossier swapped: the binding no longer matches, and the output cannot be approved.
 *
 * It is a consistency hash, not a secret seal: it proves that the parts were written together by the run, and the gate
 * goes on to require every passage reviewed. (Against a database writer, see the HMAC seals of reviews.)
 */
import { createHash } from "node:crypto";
import type { OutputBlock } from "@/server/db/schema";

export type SpecialistBlock = Extract<OutputBlock, { type: "specialist" }>;

/** The canonical string: text, run, writer, cited refs (n:chunk, by n), basis (chunks, sorted), dossier. */
export function bindingInput(b: Pick<SpecialistBlock, "text" | "runId" | "writer" | "refs" | "basis" | "dossierId">): string {
  const refs = [...(b.refs ?? [])].sort((x, y) => x.n - y.n).map((r) => `${r.n}:${r.chunkId}`).join(",");
  const basis = [...new Set((b.basis ?? []).map((r) => r.chunkId))].sort().join(",");
  return [b.text, b.runId ?? "", b.writer ?? "", refs, basis, b.dossierId ?? ""].join("\n");
}

export const specialistBinding = (b: Parameters<typeof bindingInput>[0]) => createHash("sha256").update(bindingInput(b), "utf8").digest("hex");

/**
 * The fingerprint of a text for the engine-block registry (stage 11, N10-16, S11-8): the sha256 of its letters and digits
 * only — Arabic letters without diacritics or tatweel, Arabic-Indic and Latin digits, Latin letters lower-cased — so that
 * a copy re-spaced, re-punctuated or salted with invisible marks (RLM, ALM, soft hyphen, joiners) is still the engine's.
 * The database computes the same (security.sql block_text_sha()). A copy with a word changed is not recognised: it is
 * a person's text, and an exact fingerprint cannot tell otherwise.
 */
export const blockTextSha = (text: string) =>
  createHash("sha256").update(text.toLowerCase().replace(/[^0-9a-z\u0621-\u063A\u0641-\u064A\u0660-\u0669\u06F0-\u06F9\u0671-\u06D3]+/gu, ""), "utf8").digest("hex");

/** Citation marks in one form: Arabic-Indic, Persian and full-width digits, full-width brackets. */
export const citeForm = (t: string) =>
  t.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0)).replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10)).replace(/［/g, "[").replace(/］/g, "]");
/** The citation numbers in a text: «[3]», «[٣]», «[ 3 ]», «[３]», «[3، 4]» (N10-15, S11-11). */
export function citedNumbers(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of citeForm(text).matchAll(/\[\s*(\d{1,3}(?:\s*[,،]\s*\d{1,3})*)\s*\]/g)) for (const k of m[1]!.split(/\s*[,،]\s*/)) out.add(Number(k));
  return out;
}

/** What is wrong with an engine-written block's binding to its references (empty: nothing). */
export function engineBlockErrors(b: SpecialistBlock): string[] {
  if (b.by !== "engine") return [];
  const e: string[] = [];
  if (!b.text.trim()) return e; // an empty block is caught as unwritten
  if (!b.runId?.trim()) e.push("نص آلي بلا معرّف تشغيل");
  if (b.writer !== "model" && b.writer !== "template") e.push("نص آلي لا يُعرف كيف كُتب");
  if (!b.binding || b.binding !== specialistBinding(b)) e.push("نص آلي لا يطابق مراجعه وأساسه وتشغيله (أُعيد توليده أو عُدّل جزء منه دون الباقي)");
  if (b.writer === "model") {
    if (!b.refs?.length) e.push("نص كتبه النموذج بلا مراجع مستشهد بها");
    if (!b.basis?.length) e.push("نص كتبه النموذج بلا أساس استدلال (المقاطع المعروضة عليه)");
    const basis = new Set((b.basis ?? []).map((r) => r.chunkId));
    if ((b.refs ?? []).some((r) => !basis.has(r.chunkId))) e.push("مرجع مستشهد به ليس من المقاطع المعروضة على النموذج");
    const cited = citedNumbers(b.text);
    const have = new Set((b.refs ?? []).map((r) => r.n));
    if ([...cited].some((n) => !have.has(n))) e.push("النص يستشهد برقم لا مرجع له");
  }
  return e;
}
