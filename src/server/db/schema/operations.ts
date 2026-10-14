import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tracking } from "./_common";
import { serviceRequests, tasks } from "./work";

/**
 * The request as the single operational reference (see docs/SERVICE-FLOWS-AUDIT.md):
 * - request_links: the operational records a request created or relates to (waqf file, nazara engagement…), both ways.
 * - task_events: who did what on a task, when, and on whose behalf (append-only).
 * - outputs / output_versions: service outputs drafted from the platform's data, reviewed, versioned and approved.
 */

// ───────────────────────── Request ↔ operational records ─────────────────────────

/** waqf = the waqf file of the request; nazara_engagement = the corporate nazara file it opened or belongs to. */
export type RequestLinkEntity = "waqf" | "nazara_engagement";
/** origin = the request created the record; related = the request concerns an existing record. */
export type RequestLinkRelation = "origin" | "related";

export const requestLinks = pgTable("request_links", {
  id: id(),
  requestId: uuid().notNull().references(() => serviceRequests.id, { onDelete: "cascade" }),
  waqfId: uuid(),
  entityType: text().$type<RequestLinkEntity>().notNull(),
  entityId: uuid().notNull(),
  relation: text().$type<RequestLinkRelation>().notNull(),
  note: text(),
  createdBy: uuid(),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("request_links_uq").on(t.requestId, t.entityType, t.entityId),
  index("request_links_entity_idx").on(t.entityType, t.entityId),
]);

// ───────────────────────── Task execution log ─────────────────────────

export type TaskEventAction = "create" | "start" | "complete" | "return" | "cancel" | "reopen" | "assign" | "note" | "attach" | "output";

export const taskEvents = pgTable("task_events", {
  id: id(),
  taskId: uuid().notNull().references(() => tasks.id, { onDelete: "cascade" }),
  waqfId: uuid(),
  requestId: uuid(),
  action: text().$type<TaskEventAction>().notNull(),
  fromStatus: text(),
  toStatus: text(),
  actorUserId: uuid(),
  /** The person responsible (assignee) at the time of the action — kept even when someone else executes. */
  ownerUserId: uuid(),
  /** The actor was not the assignee (an authorized manager executed directly or on behalf). */
  direct: boolean().default(false).notNull(),
  note: text(),
  documentId: uuid(),
  outputId: uuid(),
  at: createdAt(),
}, (t) => [index("task_events_task_idx").on(t.taskId), index("task_events_req_idx").on(t.requestId)]);

// ───────────────────────── Service outputs ─────────────────────────

export type OutputSpecialty = "sharia" | "legal" | "finance" | "investment" | "governance" | "operations";
/** independent = approved only by someone who prepared no version; self_allowed = an authorized manager may approve
 *  their own draft (recorded as self-approval). */
export type ReviewPolicy = "independent" | "self_allowed";
export type OutputStatus = "draft" | "in_review" | "returned" | "approved";

/** Where a statement in a draft comes from. */
export type Provenance = "document" | "client" | "system" | "computed" | "assumption" | "unverified" | "specialist";

export type OutputBlock =
  | { type: "para"; text: string; prov?: Provenance; ref?: string }
  | { type: "facts"; rows: { label: string; value: string; prov: Provenance; ref?: string }[] }
  | { type: "table"; head: string[]; rows: string[][]; prov: Provenance; ref?: string; total?: string[] }
  | { type: "list"; items: { text: string; prov?: Provenance; ref?: string }[]; ordered?: boolean }
  /** Text the specialist must write; blocks approval while empty. */
  | { type: "specialist"; prompt: string; text: string }
  /** A drafted clause of a document (will, deed, policy): `generated` is the text built from the data; `text` is what
   *  the document says now (equal to `generated` until a person edits it). `refs` = where the rule behind it comes from. */
  | { type: "clause"; key: string; n: number; title: string; text: string; generated: string; prov: Provenance; refs?: string[] }
  /** Signature lines printed on the document (wet or official signing outside the platform; not an e-signature). */
  | { type: "signatures"; rows: { role: string; name: string }[] };

export type OutputSection = {
  key: string;
  title: string;
  /** Mandatory sections cannot be removed by the reviewer. */
  required: boolean;
  /** Added by a person (not by the generator). */
  manual?: boolean;
  /** An optional section a reviewer removed: kept (hidden) so regeneration does not bring it back. */
  removed?: boolean;
  blocks: OutputBlock[];
};

/** A gap never gets invented content: it names the missing field or document and who must complete it. */
export type OutputGap = { key: string; label: string; severity: "blocking" | "warning"; hint?: string; field?: string; owner?: "client" | "specialist" | "team" };
export type OutputSource = { code: string; label: string; status: "verified" | "pending_verification" | "operational" | "internal"; detail?: string };

export const outputs = pgTable("outputs", {
  id: id(),
  number: text().notNull(), // OUT-000001
  requestId: uuid().notNull().references(() => serviceRequests.id, { onDelete: "cascade" }),
  waqfId: uuid(),
  taskId: uuid(),
  outputKey: text().notNull(),
  title: text().notNull(),
  specialty: text().$type<OutputSpecialty>().notNull(),
  reviewPolicy: text().$type<ReviewPolicy>().notNull(),
  status: text().$type<OutputStatus>().default("draft").notNull(),
  currentVersion: integer().default(0).notNull(),
  approvedVersion: integer(),
  submittedBy: uuid(),
  submittedAt: timestamp({ withTimezone: true }),
  reviewNote: text(),
  approvedBy: uuid(),
  approvedAt: timestamp({ withTimezone: true }),
  selfApproved: boolean().default(false).notNull(),
  /** Rendered PDF of the approved version (documents vault) and the delivery record handed to the request flow. */
  documentId: uuid(),
  deliverableId: uuid(),
  ...tracking(),
}, (t) => [
  uniqueIndex("outputs_number_uq").on(t.number),
  uniqueIndex("outputs_req_key_uq").on(t.requestId, t.outputKey),
]);

export const outputVersions = pgTable("output_versions", {
  id: id(),
  outputId: uuid().notNull().references(() => outputs.id, { onDelete: "cascade" }),
  requestId: uuid().notNull(),
  waqfId: uuid(),
  version: integer().notNull(),
  /** generated = first draft; regenerated = rebuilt from updated data; edited = a person changed the text. */
  origin: text().$type<"generated" | "regenerated" | "edited">().notNull(),
  basedOn: integer(),
  sections: jsonb().$type<OutputSection[]>().notNull(),
  gaps: jsonb().$type<OutputGap[]>().default([]).notNull(),
  sources: jsonb().$type<OutputSource[]>().default([]).notNull(),
  /** Hash of the data the generator read (to tell whether regeneration would change anything). */
  inputsHash: text(),
  note: text(),
  createdBy: uuid(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("output_versions_uq").on(t.outputId, t.version)]);

// ───────────────────────── Request revisions (staff corrections and rollbacks) ─────────────────────────

/**
 * intake_edit = a staff member corrected or completed the client's answers; rollback = the request or a work stage was
 * reopened for correction; reopen_output = an approved output was reopened. Append-only, staff-only: the history of who
 * changed what, why, and what it affected (outputs to regenerate, quotes/contracts/invoices needing a correction path).
 */
export type RevisionKind = "intake_edit" | "rollback" | "reopen_output";
export type RevisionImpact = { kind: "output" | "quote" | "contract" | "invoice" | "verification" | "acceptance" | "stage"; id?: string; label: string; action: string }[];

export const requestRevisions = pgTable("request_revisions", {
  id: id(),
  requestId: uuid().notNull().references(() => serviceRequests.id, { onDelete: "cascade" }),
  waqfId: uuid(),
  kind: text().$type<RevisionKind>().notNull(),
  target: text(),
  reason: text().notNull(),
  before: jsonb(),
  after: jsonb(),
  impact: jsonb().$type<RevisionImpact>().default([]).notNull(),
  actorUserId: uuid().notNull(),
  at: createdAt(),
}, (t) => [index("request_revisions_req_idx").on(t.requestId)]);

// ───────────────────────── Continuous services: term and delivery cycles ─────────────────────────

/**
 * A continuous service (workflow «subscription») runs for the term agreed in its contract. The request stays open for
 * the term; each period (or event) is a delivery cycle with its own due date, executor, tasks, output and review.
 * Closing a cycle never closes the request. Billing is NOT driven by cycles: invoices follow the contract's
 * installments (see docs/CONTINUOUS-SERVICES.md).
 */
export type Cadence = "monthly" | "quarterly" | "semiannual" | "annual" | "event";
/** active → suspended (request on hold) → active; terminated (early end by decision, with reason and reference).
 *  «ended» is derived: end_on has passed. */
export type TermStatus = "active" | "suspended" | "terminated";
export type TermEvent = { at: string; by: string; kind: "setup" | "extend" | "suspend" | "resume" | "terminate" | "edit"; note?: string | null; before?: Record<string, unknown>; after?: Record<string, unknown> };

export const serviceTerms = pgTable("service_terms", {
  id: id(),
  requestId: uuid().notNull().references(() => serviceRequests.id, { onDelete: "cascade" }),
  waqfId: uuid(),
  serviceCode: text().notNull(),
  /** The contract and accepted quote the term rests on (null when work started on an operational agreement). */
  contractId: uuid(),
  quoteId: uuid(),
  cadence: text().$type<Cadence>().notNull(),
  startOn: date().notNull(),
  endOn: date().notNull(),
  /** Days after the end of a period by which its delivery is due. */
  dueOffsetDays: integer().default(10).notNull(),
  status: text().$type<TermStatus>().default("active").notNull(),
  suspendedAt: timestamp({ withTimezone: true }),
  suspendReason: text(),
  terminatedOn: date(),
  terminationReason: text(),
  /** Written basis of the termination (notice, amendment, decision number). */
  terminationRef: text(),
  terminatedBy: uuid(),
  history: jsonb().$type<TermEvent[]>().default([]).notNull(),
  ...tracking(),
}, (t) => [uniqueIndex("service_terms_req_uq").on(t.requestId)]);

/** periodic = a period of the cadence; event = an occurrence (a board meeting, a disbursement batch); closing = the
 *  end-of-service delivery (e.g. the nazara handover record). */
export type CycleKind = "periodic" | "event" | "closing";
/** open → sent (delivered to the client) → closed; skipped (with reason). Output review states live on the output. */
export type CycleStatus = "open" | "sent" | "closed" | "skipped";
export type CycleCheck = { key: string; label: string; done: boolean; by?: string | null; at?: string | null };

export const serviceCycles = pgTable("service_cycles", {
  id: id(),
  requestId: uuid().notNull().references(() => serviceRequests.id, { onDelete: "cascade" }),
  waqfId: uuid(),
  termId: uuid().notNull().references(() => serviceTerms.id, { onDelete: "cascade" }),
  seq: integer().notNull(),
  kind: text().$type<CycleKind>().default("periodic").notNull(),
  label: text().notNull(),
  periodStart: date(),
  periodEnd: date(),
  dueOn: date().notNull(),
  status: text().$type<CycleStatus>().default("open").notNull(),
  assigneeUserId: uuid(),
  /** Key of the cycle's output (outputs.output_key); null for a follow-up cycle with no delivered document. */
  outputKey: text(),
  /** Board meeting the cycle concerns (N02 / N05). */
  meetingId: uuid(),
  checklist: jsonb().$type<CycleCheck[]>().default([]).notNull(),
  sentAt: timestamp({ withTimezone: true }),
  sentBy: uuid(),
  /** Actual delivery date. */
  deliveredOn: date(),
  closedAt: timestamp({ withTimezone: true }),
  closedBy: uuid(),
  closeNote: text(),
  skippedReason: text(),
  dueChanges: jsonb().$type<{ at: string; by: string; from: string; to: string; reason: string }[]>().default([]).notNull(),
  ...tracking(),
}, (t) => [uniqueIndex("service_cycles_req_seq_uq").on(t.requestId, t.seq), index("service_cycles_due_idx").on(t.dueOn)]);
