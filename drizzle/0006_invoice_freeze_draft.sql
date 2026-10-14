-- Request invoices now have a draft → approved → issued cycle. A draft can be corrected and gets its legal number on
-- approval; an approved invoice only gets its issue/due dates when sent. From issue on, nothing changes (credit note).
CREATE OR REPLACE FUNCTION waqfak_freeze_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;
  IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.waqf_id IS DISTINCT FROM OLD.waqf_id OR NEW.billed_to_name IS DISTINCT FROM OLD.billed_to_name OR NEW.request_id IS DISTINCT FROM OLD.request_id
    OR NEW.contract_id IS DISTINCT FROM OLD.contract_id OR NEW.quote_id IS DISTINCT FROM OLD.quote_id OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
    OR NEW.discount IS DISTINCT FROM OLD.discount OR NEW.vat_rate IS DISTINCT FROM OLD.vat_rate OR NEW.vat IS DISTINCT FROM OLD.vat
    OR NEW.total IS DISTINCT FROM OLD.total OR NEW.lines IS DISTINCT FROM OLD.lines OR NEW.installment_key IS DISTINCT FROM OLD.installment_key
    OR NEW.seller_snapshot IS DISTINCT FROM OLD.seller_snapshot OR NEW.buyer_snapshot IS DISTINCT FROM OLD.buyer_snapshot
    OR NEW.credit_of_id IS DISTINCT FROM OLD.credit_of_id OR NEW.number IS DISTINCT FROM OLD.number
    OR (OLD.status <> 'approved' AND (NEW.issued_on IS DISTINCT FROM OLD.issued_on OR NEW.due_on IS DISTINCT FROM OLD.due_on)) THEN
    RAISE EXCEPTION 'invoice % is issued; amounts and parties cannot be edited (issue a credit note)', OLD.number;
  END IF;
  RETURN NEW;
END $$;
