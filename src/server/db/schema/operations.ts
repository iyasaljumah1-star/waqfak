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
  | { type: "para"; text: string; prov?: Provenance; ref?: string; internal?: boolean }
  | { type: "facts"; rows: { label: string; value: string; prov: Provenance; ref?: string }[] }
  | { type: "table"; head: string[]; rows: string[][]; prov: Provenance; ref?: string; total?: string[] }
  | { type: "list"; items: { text: string; prov?: Provenance; ref?: string }[]; ordered?: boolean }
  /** Text the specialist must write; blocks approval while empty. */
  | { type: "specialist"; prompt: string; text: string }
  /** A drafted clause of a document (will, deed, policy): `generated` is the text built from the data; `text` is what
   *  the document says now (equal to `generated` until a person edits it). `refs` = where the rule behind it comes from. */
  | { type: "clause"; key: string; n: number; title: string; text: string; generated: string; prov: Provenance; refs?: string[]; data?: ClauseDatum[] }
  /** Signature lines printed on the document (wet or official signing outside the platform; not an e-signature). */
  | { type: "signatures"; rows: { role: string; name: string }[] }
  /** Structured drafting checks (internal: never printed in the client copy). */
  | { type: "checks"; items: OutputCheck[] };

/** The data a clause rests on: field, value, its state, and where/when it came from. */
export type ClauseDatum = { field: string; value: string; status: "provided" | "missing" | "conflict" | "default" | "computed"; label?: string; source?: string; at?: string };
export type OutputCheck = { key: string; label: string; status: "verified" | "specialist" | "client_attested" | "incomplete" | "na" | "failed"; reason: string; source: string; rule: string; ref?: string; mode: "auto" | "professional" };

export type OutputSection = {
  key: string;
  title: string;
  /** Mandatory sections cannot be removed by the reviewer. */
  required: boolean;
  /** Added by a person (not by the generator). */
  manual?: boolean;
  /** An optional section a reviewer removed: kept (hidden) so regeneration does not bring it back. */
  removed?: boolean;
  /** internal = review material (checks, sources, notes) kept out of the client copy. */
  audience?: "client" | "internal";
  blocks: OutputBlock[];
};

/**
 * A gap never gets invented content: it names the missing field or document and who must complete it.
 * need: mandatory (blocks approval) / optional (does not) / review (a specialist must decide). kind: what is missing
 * (data, a document, a check, or a conflict to settle). `effect` says what the gap stops in the next stage.
 */
export type OutputGap = {
  key: string; label: string; severity: "blocking" | "warning"; hint?: string; field?: string; owner?: "client" | "specialist" | "team";
  need?: "mandatory" | "optional" | "review"; why?: string; kind?: "data" | "conflict" | "check" | "document"; source?: string; effect?: string;
  sides?: { field: string; label: string; value: string; source: string }[];
  /** A gap the specialist closes by writing the clause (its key): closed once the clause is edited and has no placeholder. */
  clause?: string;
};
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
  /** Hash of the request's own data (answers, documents, waqf file values) the version was drafted from: approval is
   *  refused when the data changed after the version (regenerate first). */
  dataHash: text(),
  /** The data itself the version was drafted from (answers, attached documents, waqf-file context with its source and
   *  date): later changes to the waqf file never rewrite an approved version silently; they show as differences. */
  dataSnapshot: jsonb().$type<Record<string, unknown>>(),
  note: text(),
  createdBy: uuid(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("output_versions_uq").on(t.outputId, t.version)]);

// ───────────────────────── Data conflicts, specialist findings, official documentation ─────────────────────────

/**
 * A conflict between the sources of a request's data (answers, waqf file, attached documents), as detected when an
 * output is drafted or validated. Never resolved by choosing a value: it closes when the data is corrected at its source
 * and the detection no longer finds it (resolved_by = who corrected or re-validated it). A conflict that comes back is
 * a new row; the closed one stays as history.
 */
export const dataConflicts = pgTable("data_conflicts", {
  id: id(),
  requestId: uuid().notNull().references(() => serviceRequests.id, { onDelete: "cascade" }),
  waqfId: uuid(),
  outputId: uuid(),
  conflictKey: text().notNull(),
  severity: text().$type<"material" | "minor">().notNull(),
  label: text().notNull(),
  sides: jsonb().$type<{ field: string; label: string; value: string; source: string }[]>().notNull(),
  action: text().notNull(),
  fields: jsonb().$type<string[]>().default([]).notNull(),
  status: text().$type<"open" | "resolved">().default("open").notNull(),
  detectedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  detectedBy: uuid(),
  lastSeenAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp({ withTimezone: true }),
  resolvedBy: uuid(),
  /** How it was resolved (the correction that removed it). */
  resolution: text(),
  /** The deficiency item raised for the client to correct it, when one was. */
  itemId: uuid(),
}, (t) => [
  index("data_conflicts_req_idx").on(t.requestId, t.status),
]);

/**
 * A specialist's finding, append-only (latest per target wins): on a drafting check (verified / failed / not
 * applicable) or on a clause's citation (supports / needs another source / unavailable / unverified), with the reasoning.
 */
export const outputReviews = pgTable("output_reviews", {
  id: id(),
  outputId: uuid().notNull().references(() => outputs.id, { onDelete: "cascade" }),
  requestId: uuid().notNull(),
  waqfId: uuid(),
  version: integer().notNull(),
  kind: text().$type<"check" | "citation">().notNull(),
  /** check key, or «clause key|citation key». */
  targetKey: text().notNull(),
  status: text().notNull(),
  note: text().notNull(),
  /** Where in the source the reviewer found it (page, article…), for citations. */
  location: text(),
  createdBy: uuid().notNull(),
  createdAt: createdAt(),
}, (t) => [index("output_reviews_out_idx").on(t.outputId, t.kind)]);

/**
 * Official documentation of an approved output with the competent authority (court, notary, Najiz…), recorded only
 * after it happened, with what proves it. The platform's approval is never official documentation. Append-only.
 */
export const outputOfficialRecords = pgTable("output_official_records", {
  id: id(),
  outputId: uuid().notNull().references(() => outputs.id, { onDelete: "cascade" }),
  requestId: uuid().notNull(),
  waqfId: uuid(),
  version: integer().notNull(),
  authority: text().notNull(),
  referenceNo: text().notNull(),
  issuedOn: date().notNull(),
  /** The proof (a document of the request: the official instrument or its copy). */
  documentId: uuid().notNull(),
  note: text(),
  createdBy: uuid().notNull(),
  createdAt: createdAt(),
});

// ───────────────────────── Request revisions (staff corrections and rollbacks) ─────────────────────────

/**
 * intake_edit = a staff member corrected or completed the client's answers; rollback = the request or a work stage was
 * reopened for correction; reopen_output = an approved output was reopened. Append-only, staff-only: the history of who
 * changed what, why, and what it affected (outputs to regenerate, quotes/contracts/invoices needing a correction path).
 */
export type RevisionKind = "intake_edit" | "rollback" | "reopen_output" | "client_completion";
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
export type Cadence = "monthly" | "quarterly" | "semiannual" | "annual" | "event" | "custom";
/** Contractual delivery dates or stages (cadence «custom»). */
export type CustomDelivery = { label: string; due: string; from?: string | null; to?: string | null };
/** required = the client must approve each delivery before its cycle closes; info = delivered for information (the
 *  client may still approve or ask for changes). Set per service, adjustable per contract by an authorized manager. */
export type ClientAcceptance = "required" | "info";
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
  customDates: jsonb().$type<CustomDelivery[]>().default([]).notNull(),
  clientAcceptance: text().$type<ClientAcceptance>().default("required").notNull(),
  /** Where the cadence came from: «quote» (the accepted quote), «catalog», or «set» (chosen at setup by the user). */
  cadenceSource: text(),
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
export type CycleClientEvent = { at: string; by: string | null; kind: "available" | "viewed" | "approved" | "revision_requested" | "reminder"; version?: number | null; note?: string | null };
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
  /** First time a client party opened the delivered file (recorded by the platform, not assumed). */
  viewedAt: timestamp({ withTimezone: true }),
  /** The client's explicit decision on the delivery (never implied by silence or time). */
  clientDecision: text().$type<"approved" | "revision_requested">(),
  clientDecisionAt: timestamp({ withTimezone: true }),
  clientDecisionBy: uuid(),
  clientDecisionNote: text(),
  /** Version of the cycle output the client approved. */
  clientApprovedVersion: integer(),
  /** Every client decision and reminder of the cycle (append-only list). */
  clientEvents: jsonb().$type<CycleClientEvent[]>().default([]).notNull(),
  ...tracking(),
}, (t) => [uniqueIndex("service_cycles_req_seq_uq").on(t.requestId, t.seq), index("service_cycles_due_idx").on(t.dueOn)]);

// ───────────────────────── Payment schedule (contract installments) ─────────────────────────

export type ScheduleEvent = { at: string; by: string | null; kind: "created" | "due_set" | "due_changed" | "alert"; note?: string | null; from?: string | null; to?: string | null };

/**
 * The installments of an executed contract, one row per payment term of its quote. The due date is the contract's
 * (set date, signing date) or set later when a milestone is reached; every change is kept in `history`. Invoices are
 * never created from a row: the finance team is alerted and issues them through the invoice cycle.
 */
export const paymentSchedule = pgTable("payment_schedule", {
  id: id(),
  requestId: uuid().notNull().references(() => serviceRequests.id, { onDelete: "cascade" }),
  waqfId: uuid(),
  quoteId: uuid().notNull(),
  contractId: uuid(),
  termKey: text().notNull(),
  label: text().notNull(),
  percent: text().notNull(),
  net: text().notNull(),
  vat: text().notNull(),
  total: text().notNull(),
  dueKind: text().notNull(),
  dueOn: date(),
  milestone: text(),
  beforeStart: boolean().default(false).notNull(),
  series: text(),
  history: jsonb().$type<ScheduleEvent[]>().default([]).notNull(),
  /** Alerts already sent (keys like «before», «due», «overdue:7») so each is sent once. */
  alerts: jsonb().$type<string[]>().default([]).notNull(),
  ...tracking(),
}, (t) => [uniqueIndex("payment_schedule_quote_term_uq").on(t.quoteId, t.termKey), index("payment_schedule_due_idx").on(t.dueOn)]);

// ───────────────────────── Field-level review of a request ─────────────────────────

/** pending: not reviewed yet · approved: reviewed and approved by the team · needs_review: changed or reopened since. */
export type FieldReviewStatus = "pending" | "approved" | "needs_review";
export type FieldReviewEvent = { at: string; by: string; action: "approve" | "reopen" | "changed"; note?: string | null; value?: unknown };

/**
 * Review state of one field (or one waqf-file context block, key "ctx:<block>") of a request. Approving a field never
 * approves another field or the request; an edit or a client completion puts the field back to needs_review.
 */
export const requestFieldStates = pgTable("request_field_states", {
  id: id(),
  requestId: uuid().notNull().references(() => serviceRequests.id, { onDelete: "cascade" }),
  waqfId: uuid(),
  fieldKey: text().notNull(),
  status: text().$type<FieldReviewStatus>().default("pending").notNull(),
  /** The value (or block fingerprint) that was approved: a later change shows the approval as outdated. */
  approvedValue: jsonb(),
  decidedBy: uuid(),
  decidedAt: timestamp({ withTimezone: true }),
  note: text(),
  history: jsonb().$type<FieldReviewEvent[]>().default([]).notNull(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("request_field_states_uq").on(t.requestId, t.fieldKey)]);
