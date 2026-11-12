import "server-only";
import type { Tx } from "@/server/db";
import { engineBlocks } from "@/server/db/schema";
import { blockTextSha, type SpecialistBlock } from "./binding";

/**
 * Records a block the engine has just written in the append-only registry (stage 11, N10-16). Called only inside the
 * engine's run, on its system connection: the application role has no right to this table, so a text cannot be
 * declared «written by the engine» from a request, and an engine text cannot be relabelled without the gate seeing it.
 */
export async function registerEngineBlock(tx: Tx, b: SpecialistBlock, outputId: string | null) {
  if (!b.binding || !b.runId || (b.writer !== "model" && b.writer !== "template")) throw new Error("engine block without binding, run or writer");
  await tx.insert(engineBlocks).values({ binding: b.binding, textSha256: blockTextSha(b.text), runId: b.runId, writer: b.writer, outputId }).onConflictDoNothing();
}
