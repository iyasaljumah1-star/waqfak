CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"request_id" uuid NOT NULL,
	"waqf_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"kind" text DEFAULT 'initial' NOT NULL,
	"parent_quote_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"scope" text NOT NULL,
	"deliverables" text,
	"exclusions" text,
	"assumptions" text,
	"client_obligations" text,
	"duration_days" integer,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subtotal" numeric(18, 2) NOT NULL,
	"discount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net" numeric(18, 2) NOT NULL,
	"vat_rate" numeric(5, 2) NOT NULL,
	"vat" numeric(18, 2) NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"payment_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"valid_until" date NOT NULL,
	"content_hash" text,
	"prepared_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"sent_by" uuid,
	"sent_at" timestamp with time zone,
	"responded_by" uuid,
	"responded_at" timestamp with time zone,
	"response_note" text,
	"superseded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "request_item_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"waqf_id" uuid,
	"action" text NOT NULL,
	"note" text,
	"document_id" uuid,
	"actor_user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"waqf_id" uuid,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"field_key" text,
	"doc_type" text,
	"required" boolean DEFAULT true NOT NULL,
	"visibility" text DEFAULT 'client' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"due_on" date,
	"response_text" text,
	"response_document_id" uuid,
	"answered_by" uuid,
	"answered_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "contract_signatures" ADD COLUMN "party_key" text;--> statement-breakpoint
ALTER TABLE "contract_signatures" ADD COLUMN "signer_name" text;--> statement-breakpoint
ALTER TABLE "contract_signatures" ADD COLUMN "capacity" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "quote_id" uuid;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "parent_contract_id" uuid;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "parties" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "executed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "kind" text DEFAULT 'tax_invoice' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "quote_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "installment_key" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "installment_label" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "credit_of_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "seller_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "buyer_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "receipt_number" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "request_notes" ADD COLUMN "document_id" uuid;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "intake_form_version" integer;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "intake_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "intake_verified_by" uuid;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "accepted_by" uuid;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "start_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "start_approved_by" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_item_events" ADD CONSTRAINT "request_item_events_item_id_request_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."request_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_items" ADD CONSTRAINT "request_items_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_num_ver_uq" ON "quotes" USING btree ("number","version");--> statement-breakpoint
CREATE INDEX "quotes_req_idx" ON "quotes" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "rie_item_idx" ON "request_item_events" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ri_req_seq_uq" ON "request_items" USING btree ("request_id","seq");--> statement-breakpoint
CREATE INDEX "ri_req_idx" ON "request_items" USING btree ("request_id");--> statement-breakpoint
-- ───────────── Integrity: frozen commercial records and append-only histories ─────────────
CREATE OR REPLACE FUNCTION waqfak_forbid_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only table: UPDATE is not allowed on %', TG_TABLE_NAME;
END $$;--> statement-breakpoint
CREATE TRIGGER request_item_events_append_only BEFORE UPDATE ON request_item_events FOR EACH ROW EXECUTE FUNCTION waqfak_forbid_update();--> statement-breakpoint
CREATE TRIGGER request_notes_append_only BEFORE UPDATE ON request_notes FOR EACH ROW EXECUTE FUNCTION waqfak_forbid_update();--> statement-breakpoint
CREATE TRIGGER contract_signatures_append_only BEFORE UPDATE ON contract_signatures FOR EACH ROW EXECUTE FUNCTION waqfak_forbid_update();--> statement-breakpoint
-- A quote's content is frozen once it leaves draft (approved, sent, answered…). Only its status trail may change.
CREATE OR REPLACE FUNCTION waqfak_freeze_quote() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' AND (
    NEW.number IS DISTINCT FROM OLD.number OR NEW.version IS DISTINCT FROM OLD.version OR NEW.request_id IS DISTINCT FROM OLD.request_id
    OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.scope IS DISTINCT FROM OLD.scope OR NEW.deliverables IS DISTINCT FROM OLD.deliverables
    OR NEW.exclusions IS DISTINCT FROM OLD.exclusions OR NEW.assumptions IS DISTINCT FROM OLD.assumptions
    OR NEW.client_obligations IS DISTINCT FROM OLD.client_obligations OR NEW.duration_days IS DISTINCT FROM OLD.duration_days
    OR NEW.lines IS DISTINCT FROM OLD.lines OR NEW.subtotal IS DISTINCT FROM OLD.subtotal OR NEW.discount IS DISTINCT FROM OLD.discount
    OR NEW.net IS DISTINCT FROM OLD.net OR NEW.vat_rate IS DISTINCT FROM OLD.vat_rate OR NEW.vat IS DISTINCT FROM OLD.vat
    OR NEW.total IS DISTINCT FROM OLD.total OR NEW.payment_terms IS DISTINCT FROM OLD.payment_terms OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
    OR (OLD.content_hash IS NOT NULL AND NEW.content_hash IS DISTINCT FROM OLD.content_hash)
  ) THEN
    RAISE EXCEPTION 'quote % v% is no longer a draft; issue a new version instead', OLD.number, OLD.version;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER quotes_freeze BEFORE UPDATE ON quotes FOR EACH ROW EXECUTE FUNCTION waqfak_freeze_quote();--> statement-breakpoint
-- A contract's text, amount and parties are frozen once it leaves draft.
CREATE OR REPLACE FUNCTION waqfak_freeze_contract() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' AND (
    NEW.number IS DISTINCT FROM OLD.number OR NEW.body IS DISTINCT FROM OLD.body OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
    OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.parties IS DISTINCT FROM OLD.parties OR NEW.quote_id IS DISTINCT FROM OLD.quote_id
    OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.party_user_id IS DISTINCT FROM OLD.party_user_id
  ) THEN
    RAISE EXCEPTION 'contract % is no longer a draft; create a new version instead', OLD.number;
  END IF;
  IF OLD.status IN ('signed', 'void') AND NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'signed' AND NEW.status = 'void') THEN
    RAISE EXCEPTION 'contract % status % is final', OLD.number, OLD.status;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER contracts_freeze BEFORE UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION waqfak_freeze_contract();--> statement-breakpoint
-- Issued invoices are never edited: corrections go through a credit note and a new invoice.
CREATE OR REPLACE FUNCTION waqfak_freeze_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.number IS DISTINCT FROM OLD.number OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.waqf_id IS DISTINCT FROM OLD.waqf_id OR NEW.billed_to_name IS DISTINCT FROM OLD.billed_to_name OR NEW.request_id IS DISTINCT FROM OLD.request_id
    OR NEW.contract_id IS DISTINCT FROM OLD.contract_id OR NEW.quote_id IS DISTINCT FROM OLD.quote_id OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
    OR NEW.discount IS DISTINCT FROM OLD.discount OR NEW.vat_rate IS DISTINCT FROM OLD.vat_rate OR NEW.vat IS DISTINCT FROM OLD.vat
    OR NEW.total IS DISTINCT FROM OLD.total OR NEW.lines IS DISTINCT FROM OLD.lines OR NEW.issued_on IS DISTINCT FROM OLD.issued_on
    OR NEW.due_on IS DISTINCT FROM OLD.due_on OR NEW.installment_key IS DISTINCT FROM OLD.installment_key
    OR NEW.seller_snapshot IS DISTINCT FROM OLD.seller_snapshot OR NEW.buyer_snapshot IS DISTINCT FROM OLD.buyer_snapshot
    OR NEW.credit_of_id IS DISTINCT FROM OLD.credit_of_id THEN
    RAISE EXCEPTION 'invoice % is issued; amounts and parties cannot be edited (issue a credit note)', OLD.number;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER invoices_freeze BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION waqfak_freeze_invoice();--> statement-breakpoint
-- A confirmed payment keeps its amount and invoice.
CREATE OR REPLACE FUNCTION waqfak_freeze_payment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'paid' AND (NEW.amount IS DISTINCT FROM OLD.amount OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
    OR NEW.paid_at IS DISTINCT FROM OLD.paid_at OR (OLD.receipt_number IS NOT NULL AND NEW.receipt_number IS DISTINCT FROM OLD.receipt_number)) THEN
    RAISE EXCEPTION 'confirmed payment cannot be edited';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER payments_freeze BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION waqfak_freeze_payment();--> statement-breakpoint
CREATE UNIQUE INDEX "payments_receipt_uq" ON "payments" USING btree ("receipt_number") WHERE "receipt_number" IS NOT NULL;
