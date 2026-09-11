-- Preserve legacy receipts while allowing exact complete canonical bytes without
-- PostgreSQL's expanded JSONB parse tree. This digest covers the full wrapper,
-- not the separate fact_batch_sha256 content identity.
ALTER TABLE outcome_provider_fact_batch
  ALTER COLUMN receipt_json DROP NOT NULL,
  ADD COLUMN receipt_canonical_json TEXT,
  ADD COLUMN receipt_canonical_sha256 CHAR(64),
  ADD CONSTRAINT outcome_provider_fact_batch_receipt_representation_check CHECK (
    (receipt_json IS NOT NULL AND receipt_canonical_json IS NULL
      AND receipt_canonical_sha256 IS NULL)
    OR
    (receipt_json IS NULL AND receipt_canonical_json IS NOT NULL
      AND receipt_canonical_sha256 IS NOT NULL
      AND octet_length(receipt_canonical_json)>0
      AND receipt_canonical_sha256 ~ '^[a-f0-9]{64}$'
      AND receipt_canonical_sha256=encode(sha256(convert_to(receipt_canonical_json,'UTF8')),'hex'))
  );

DO $$
DECLARE
  original_definition TEXT;
  corrected_definition TEXT;
  old_fragment CONSTANT TEXT := $fragment$  new_immutable := NEW;
  old_immutable := OLD;$fragment$;
  new_fragment CONSTANT TEXT := $fragment$  IF NEW.receipt_canonical_json IS DISTINCT FROM OLD.receipt_canonical_json THEN
    RAISE EXCEPTION 'Canonical factual batch receipt bytes are immutable';
  END IF;
  new_immutable := NEW;
  old_immutable := OLD;
  new_immutable.receipt_canonical_json := NULL;
  old_immutable.receipt_canonical_json := NULL;$fragment$;
BEGIN
  SELECT pg_get_functiondef('validate_outcome_provider_fact_batch()'::regprocedure)
    INTO original_definition;
  IF original_definition IS NULL
    OR (length(original_definition)-length(replace(original_definition,old_fragment,'')))/length(old_fragment)<>1
    OR position(new_fragment IN original_definition)<>0 THEN
    RAISE EXCEPTION 'Expected exact bounded factual batch immutable comparison';
  END IF;
  corrected_definition:=replace(original_definition,old_fragment,new_fragment);
  IF replace(corrected_definition,new_fragment,old_fragment) IS DISTINCT FROM original_definition THEN
    RAISE EXCEPTION 'Canonical receipt correction changed unrelated factual batch guards';
  END IF;
  -- The small wrapper digest remains in the existing immutable-field comparison.
  -- Original finalized-row, staging, child-count and accounting guards are unchanged.
  -- CREATE OR REPLACE preserves the existing owner, security mode and privileges.
  EXECUTE corrected_definition;
END $$;
