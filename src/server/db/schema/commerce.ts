import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tracking } from "./_common";
import { serviceRequests } from "./work";

/**
 * Request deficiencies/queries register, quotes (scope + price, versioned) and the shared types used by contracts
 * and invoices. Records here are never edited silently: every change of state writes an event, and sent quotes are
 * frozen by a trigger (see drizzle/0002_requests_commerce.sql).
 */

// ───────────────────────── Deficiencies / queries register ─────────────────────────

/** data = a missing or unclear field; document = a missing/defective document; question = a query to the client;
 *  internal = a note for the team only; technical = a platform/technical issue on the request. */
export type RequestItemKind = "data" | "document" | "question" | "internal" | "technical";
export type RequestItemStatus = "open" | "answered" | "accepted" | "correction_requested" | "cancelled";

export const requestItems = pgTable("request_items", {
  id: id(),
  requestId: uuid().notNull().references(() => serviceRequests.id, { onDelete: "cascade" }),
  waqfId: uuid(),
  seq: integer().notNull(),
  kind: text().$type<RequestItemKind>().notNull(),
  title: text().notNull(),
  body: text(),
  /** Form field the item refers to (data items), e.g. "asset.deedNo". */
  fieldKey: text(),
  /** Document type requested (document items). */
  docType: text(),
  /** Blocks submission/progress while open. */
  required: boolean().default(true).notNull(),
  /** client = visible to the client; internal = staff only (always for kind "internal"). */
  visibility: text().$type<"client" | "internal">().default("client").notNull(),
  status: text().$type<RequestItemStatus>().default("open").notNull(),
  dueOn: date(),
  responseText: text(),
  responseDocumentId: uuid(),
  answeredBy: uuid(),
  answeredAt: timestamp({ withTimezone: true }),
  resolvedBy: uuid(),
  resolvedAt: timestamp({ withTimezone: true }),
  ...tracking(),
}, (t) => [uniqueIndex("ri_req_seq_uq").on(t.requestId, t.seq), index("ri_req_idx").on(t.requestId)]);

/** Immutable history of each item (append-only by trigger). */
export const requestItemEvents = pgTable("request_item_events", {
  id: id(),
  itemId: uuid().notNull().references(() => requestItems.id, { onDelete: "cascade" }),
  requestId: uuid().notNull(),
  waqfId: uuid(),
  action: text().notNull(), // raised | answered | accepted | correction_requested | cancelled | reopened
  note: text(),
  documentId: uuid(),
  actorUserId: uuid(),
  at: createdAt(),
}, (t) => [index("rie_item_idx").on(t.itemId)]);

// ───────────────────────── Quotes ─────────────────────────

export type QuoteLine = { description: string; qty: number; unit: number; total: number };
/** One installment of the price. `beforeStart` makes its payment a condition for starting the work. */
/** When an installment falls due: on signing, before work starts, on delivery, on completion, on a set date, or on a
 *  named contractual milestone or period. A recurring plan (monthly, quarterly, annual) is stored as dated installments. */
export type PaymentDue = "on_contract" | "before_start" | "on_delivery" | "on_completion" | "on_date" | "on_milestone";
export type PaymentTerm = {
  key: string; label: string; percent: number; due: PaymentDue; beforeStart: boolean;
  /** on_date: the due date (YYYY-MM-DD). */
  dueOn?: string | null;
  /** on_milestone (and optionally others): the stage or contractual period the installment is tied to. */
  milestone?: string | null;
  /** Generated as part of a recurring plan («شهرية»، «ربع سنوية»، «سنوية»). */
  series?: string | null;
};
export type QuoteStatus = "draft" | "approved" | "sent" | "accepted" | "rejected" | "change_requested" | "expired" | "superseded" | "withdrawn";

export const quotes = pgTable("quotes", {
  id: id(),
  number: text().notNull(), // QUO-000001 (shared by all versions of one quote)
  requestId: uuid().notNull().references(() => serviceRequests.id, { onDelete: "cascade" }),
  waqfId: uuid(),
  version: integer().default(1).notNull(),
  /** initial = the scope and price of the request; amendment = a change after acceptance (adds to the contract). */
  kind: text().$type<"initial" | "amendment">().default("initial").notNull(),
  parentQuoteId: uuid(),
  status: text().$type<QuoteStatus>().default("draft").notNull(),
  scope: text().notNull(),
  deliverables: text(),
  exclusions: text(),
  assumptions: text(),
  clientObligations: text(),
  durationDays: integer(),
  lines: jsonb().$type<QuoteLine[]>().default([]).notNull(),
  subtotal: numeric({ precision: 18, scale: 2 }).notNull(),
  discount: numeric({ precision: 18, scale: 2 }).default("0").notNull(),
  net: numeric({ precision: 18, scale: 2 }).notNull(),
  vatRate: numeric({ precision: 5, scale: 2 }).notNull(),
  vat: numeric({ precision: 18, scale: 2 }).notNull(),
  total: numeric({ precision: 18, scale: 2 }).notNull(),
  currency: text().default("SAR").notNull(),
  paymentTerms: jsonb().$type<PaymentTerm[]>().default([]).notNull(),
  /** Continuous services: the delivery cadence agreed in the quote (null = not set in the quote). */
  deliverySchedule: jsonb().$type<{ cadence: string; customDates?: { label: string; due: string }[] } | null>(),
  validUntil: date().notNull(),
  /** sha256 of the frozen content, set when the quote is sent. */
  contentHash: text(),
  preparedBy: uuid(),
  approvedBy: uuid(),
  approvedAt: timestamp({ withTimezone: true }),
  sentBy: uuid(),
  sentAt: timestamp({ withTimezone: true }),
  respondedBy: uuid(),
  respondedAt: timestamp({ withTimezone: true }),
  responseNote: text(),
  supersededBy: uuid(),
  ...tracking(),
}, (t) => [uniqueIndex("quotes_num_ver_uq").on(t.number, t.version), index("quotes_req_idx").on(t.requestId)]);

// ───────────────────────── Contract parties (jsonb on contracts) ─────────────────────────

/** self = the party signs for themself; agent = by power of attorney; nazir = as nazir of the waqf;
 *  board = authorised by a board/council resolution; legal_rep = legal representative of an entity;
 *  company_signatory = the company's authorised signatory. */
export type AuthorityType = "self" | "agent" | "nazir" | "board" | "legal_rep" | "company_signatory";

export type ContractParty = {
  key: string;
  side: "client" | "company";
  /** The contracting party (person or entity) the contract binds. */
  name: string;
  /** Capacity of the party, e.g. «واقف», «ناظر الوقف», «شركة ذات مسؤولية محدودة». */
  capacity: string;
  idLabel?: string | null;
  idNumber?: string | null;
  /** The person who signs on the party's behalf (may be the party itself). */
  signerName: string;
  signerUserId: string | null;
  authorityType: AuthorityType;
  /** POA number/date, resolution number, appointment deed… */
  authorityRef?: string | null;
  authorityDocumentId?: string | null;
  required: boolean;
};
