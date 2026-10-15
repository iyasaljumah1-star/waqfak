import "server-only";
import type { Tx } from "@/server/db";
import type { RequestCtx } from "@/server/modules/requests/access";
import { cycleOutputFor, deliveryRecordFacts, termOf } from "@/server/modules/operations/continuous";
import { parseCycleKey, requestOutputs } from "@/server/modules/operations/continuous-pure";
import { buildDraft } from "./build";
import { collectContext } from "./collect";
import { readiness } from "./pure";
import { outputsOf } from "./server";

/**
 * The inputs of an output's draft — the same path for saving a draft (generateOutput) and for previewing it before
 * any draft is saved. Returns null when the key is not an output of this request.
 */
export async function draftInputs(tx: Tx, rc: RequestCtx, outputKey: string) {
  const cyc = parseCycleKey(outputKey) ? await cycleOutputFor(tx, rc, outputKey) : null;
  const def = cyc?.def ?? requestOutputs(rc.service, (await outputsOf(tx, rc.req.id)).map((o) => o.outputKey)).find((x) => x.key === outputKey);
  if (!def) return null;
  const term = cyc?.record ? await termOf(tx, rc.req.id) : null;
  const record = cyc?.record ? await deliveryRecordFacts(tx, rc, cyc.cycle, term?.clientAcceptance ?? "required") : null;
  const ctx = await collectContext(tx, rc, cyc ? { cycle: { label: cyc.cycle.label, from: cyc.cycle.periodStart, to: cyc.cycle.periodEnd, due: cyc.cycle.dueOn }, record } : {});
  return { def, cyc, ctx, draft: buildDraft(ctx, def) };
}

/**
 * Preview of an output that has no saved draft yet: built from the request's current data, nothing is stored, the
 * request and its tasks are untouched. What is missing is listed (gaps and the parts the specialist writes).
 */
export async function livePreview(tx: Tx, rc: RequestCtx, outputKey: string) {
  const inp = await draftInputs(tx, rc, outputKey);
  if (!inp) return null;
  const { def, draft, cyc } = inp;
  return {
    def, cycle: cyc ? { label: cyc.cycle.label, status: cyc.cycle.status } : null,
    sections: draft.sections, gaps: draft.gaps, sources: draft.sources, ready: readiness(draft.sections, draft.gaps),
  };
}
