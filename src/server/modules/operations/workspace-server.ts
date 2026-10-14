import "server-only";
import { asc, desc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/server/db";
import type { Auth } from "@/server/authz/context";
import { contracts, invoices, outputs, quotes, requestRevisions, requestStages, users } from "@/server/db/schema";
import type { RequestCtx } from "@/server/modules/requests/access";
import { visibleFields, visibleSteps, type AnswerValue, type Field } from "@/server/modules/requests/intake/engine";
import { intakeOf, serviceForm } from "@/server/modules/requests/intake/server";
import { workStages } from "./exec-pure";
import { revisionImpact, rollbackOptions } from "./revisions-pure";

/** Workspace data beyond the request detail: revisions, rollback points and their impact, editable answers. */
export async function workspaceExtras(tx: Tx, _auth: Auth, rc: RequestCtx) {
  const id = rc.req.id;
  const [revs, stageRows, o, q, k, i] = await Promise.all([
    tx.select().from(requestRevisions).where(eq(requestRevisions.requestId, id)).orderBy(desc(requestRevisions.at)),
    tx.select().from(requestStages).where(eq(requestStages.requestId, id)).orderBy(asc(requestStages.position)),
    tx.select({ id: outputs.id, title: outputs.title, status: outputs.status, reviewNote: outputs.reviewNote }).from(outputs).where(eq(outputs.requestId, id)),
    tx.select({ id: quotes.id, number: quotes.number, status: quotes.status, kind: quotes.kind }).from(quotes).where(eq(quotes.requestId, id)),
    tx.select({ id: contracts.id, number: contracts.number, status: contracts.status }).from(contracts).where(eq(contracts.requestId, id)),
    tx.select({ id: invoices.id, number: invoices.number, status: invoices.status, kind: invoices.kind }).from(invoices).where(eq(invoices.requestId, id)),
  ]);
  const work = new Set(workStages(rc.stagesDef).map((s) => s.key));
  const options = rollbackOptions({ status: rc.req.status, hasSentQuote: q.some((x) => ["sent", "accepted"].includes(x.status)), workStages: stageRows.filter((s) => work.has(s.stageKey)).map((s) => ({ key: s.stageKey, name: s.name, status: s.status })) });
  const impact = revisionImpact({ outputs: o, quotes: q, contracts: k, invoices: i, verified: !!rc.req.intakeVerifiedAt, accepted: !!rc.req.acceptedAt }, options[0]?.target ?? "intake_edit");
  const editImpact = revisionImpact({ outputs: o, quotes: q, contracts: k, invoices: i, verified: !!rc.req.intakeVerifiedAt, accepted: !!rc.req.acceptedAt }, "intake_edit");
  // editable answers (visible fields of a form-based request)
  const intake = intakeOf(rc.req);
  const form = serviceForm(rc.service);
  const answers = intake.answers ?? {};
  const editable: { step: string; field: Field; value: AnswerValue | undefined }[] = intake.formVersion
    ? visibleSteps(form, answers).flatMap((st) => visibleFields(st, answers).filter((f) => f.type !== "ack" && st.key !== "applicant").map((f) => ({ step: st.title, field: f, value: answers[f.key] })))
    : [];
  const actorIds = [...new Set(revs.map((r) => r.actorUserId))];
  const people = actorIds.length ? await tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, actorIds)) : [];
  return { revisions: revs, revisionNames: new Map(people.map((p) => [p.id, p.name ?? "—"])), rollback: options, rollbackImpact: impact, editImpact, editable, outputsLite: o };
}
