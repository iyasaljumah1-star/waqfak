import "server-only";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { asSystem } from "@/server/db/as-system";
import { dataConflicts, documents, requestFieldStates, requestItems, requestNotes, requestRevisions, tasks, users } from "@/server/db/schema";
import { todayISO } from "@/server/engines/dates";
import type { RequestCtx } from "./access";
import { contextFor } from "./context/map";
import { resolveContext } from "./context/resolve";
import { periodFor } from "./context/types";
import { analyzeRequest, type FieldState } from "./insights";
import { intakeOf, prefillSources, serviceForm, withServerAnswers } from "./intake/server";

export type FieldNote = { id: string; visibility: string; body: string; author: string; at: string; documentId: string | null; documentTitle: string | null };
export type FieldTask = { id: string; title: string; status: string; dueOn: string | null; assignee: string | null };

/**
 * Everything the unified request page shows per field and per waqf-file block, from the database: the form answers in
 * the order the client saw them, the waqf-file records the service reads, review states, corrections, open completion
 * requests, conflicts, notes and evidence, and tasks tied to each field — plus the analysis built on them.
 */
export async function fieldWorkspace(tx: Tx, rc: RequestCtx, audience: "staff" | "client" = "staff") {
  const form = serviceForm(rc.service);
  const intake = intakeOf(rc.req);
  const answers = withServerAnswers(form, rc.req.waqfId, intake.answers ?? {});
  const keys = rc.req.waqfId ? contextFor(rc.service.code) : [];
  const [blocks, src, states, revs, items, conflicts, notes, ftasks] = await Promise.all([
    keys.length ? resolveContext(tx, rc.req.waqfId!, keys, periodFor(answers, todayISO()), { serviceCode: rc.service.code, requestId: rc.req.id }) : Promise.resolve([]),
    prefillSources(tx, rc.req.requesterUserId, rc.req.waqfId),
    tx.select().from(requestFieldStates).where(eq(requestFieldStates.requestId, rc.req.id)),
    audience === "staff"
      ? tx.select({ kind: requestRevisions.kind, target: requestRevisions.target, at: requestRevisions.at, actor: users.fullName, reason: requestRevisions.reason, before: requestRevisions.before, after: requestRevisions.after })
        .from(requestRevisions).leftJoin(users, eq(users.id, requestRevisions.actorUserId)).where(eq(requestRevisions.requestId, rc.req.id)).orderBy(asc(requestRevisions.at))
      // the client sees corrections made to their own answers (who: the team, not a person; why; before and after),
      // read after the request access check, limited to field corrections
      : asSystem(tx, () => tx.select({ kind: requestRevisions.kind, target: requestRevisions.target, at: requestRevisions.at, actor: requestRevisions.kind, reason: requestRevisions.reason, before: requestRevisions.before, after: requestRevisions.after })
        .from(requestRevisions).where(and(eq(requestRevisions.requestId, rc.req.id), inArray(requestRevisions.kind, ["intake_edit", "client_completion"]))).orderBy(asc(requestRevisions.at)))
        .then((xs) => xs.map((x) => ({ ...x, actor: x.kind === "client_completion" ? "أنت" : "فريق وقفك" }))),
    tx.select({ seq: requestItems.seq, fieldKey: requestItems.fieldKey, status: requestItems.status, title: requestItems.title, visibility: requestItems.visibility }).from(requestItems).where(eq(requestItems.requestId, rc.req.id)),
    audience === "staff"
      ? tx.select({ key: dataConflicts.conflictKey, label: dataConflicts.label, fields: dataConflicts.fields, status: dataConflicts.status, severity: dataConflicts.severity, action: dataConflicts.action }).from(dataConflicts).where(eq(dataConflicts.requestId, rc.req.id))
      : Promise.resolve([]),
    tx.select({ id: requestNotes.id, fieldKey: requestNotes.fieldKey, visibility: requestNotes.visibility, body: requestNotes.body, at: requestNotes.createdAt, author: users.fullName, documentId: requestNotes.documentId })
      .from(requestNotes).leftJoin(users, eq(users.id, requestNotes.authorId)).where(and(eq(requestNotes.requestId, rc.req.id), isNotNull(requestNotes.fieldKey))).orderBy(desc(requestNotes.createdAt)),
    audience === "staff"
      ? tx.select({ id: tasks.id, fieldKey: tasks.fieldKey, title: tasks.title, status: tasks.status, dueOn: tasks.dueOn, assignee: users.fullName }).from(tasks).leftJoin(users, eq(users.id, tasks.assigneeUserId)).where(and(eq(tasks.requestId, rc.req.id), isNotNull(tasks.fieldKey)))
      : Promise.resolve([]),
  ]);
  const docIds = notes.map((n) => n.documentId).filter((x): x is string => !!x);
  const docTitles = docIds.length ? new Map((await tx.select({ id: documents.id, title: documents.title }).from(documents).where(inArray(documents.id, docIds))).map((d) => [d.id, d.title])) : new Map<string, string>();
  const fileValues: Record<string, string | null | undefined> = {};
  for (const st of form.steps) for (const f of st.fields) if (f.prefill) fileValues[f.key] = src[f.prefill];
  const stateMap: Record<string, FieldState> = Object.fromEntries(states.map((s) => [s.fieldKey, { status: s.status, approvedValue: s.approvedValue, decidedAt: s.decidedAt ? s.decidedAt.toISOString() : null, decidedBy: s.decidedBy, note: s.note }]));
  const visibleItems = audience === "client" ? items.filter((x) => x.visibility === "client") : items;
  const analysis = analyzeRequest({
    code: rc.service.code, form, answers, docs: intake.docs ?? {}, fileValues, blocks, states: stateMap,
    revisions: revs.map((r) => ({ kind: r.kind, target: r.target, at: r.at.toISOString(), actor: r.actor ?? "—", reason: r.reason, before: r.before, after: r.after })),
    items: visibleItems.map((x) => ({ seq: x.seq, fieldKey: x.fieldKey, status: x.status, title: x.title })),
    conflicts: conflicts.map((x) => ({ ...x, fields: x.fields ?? [] })),
  });
  const byField = <T extends { fieldKey: string | null }>(xs: T[]) => xs.reduce<Record<string, T[]>>((m, x) => ((m[x.fieldKey!] ??= []).push(x), m), {});
  const visibleNotes = audience === "client" ? notes.filter((n) => n.visibility === "client") : notes;
  return {
    form, answers, analysis,
    revisions: revs.map((r) => ({ kind: r.kind, target: r.target, at: r.at.toISOString(), actor: r.actor ?? "—", reason: r.reason, before: r.before, after: r.after })),
    notes: Object.fromEntries(Object.entries(byField(visibleNotes)).map(([k, xs]) => [k, xs.map((n): FieldNote => ({ id: n.id, visibility: n.visibility, body: n.body, author: n.author ?? "—", at: n.at.toISOString(), documentId: n.documentId, documentTitle: n.documentId ? docTitles.get(n.documentId) ?? "مستند" : null }))])) as Record<string, FieldNote[]>,
    tasks: Object.fromEntries(Object.entries(byField(ftasks)).map(([k, xs]) => [k, xs.map((t): FieldTask => ({ id: t.id, title: t.title, status: t.status, dueOn: t.dueOn, assignee: t.assignee }))])) as Record<string, FieldTask[]>,
  };
}
