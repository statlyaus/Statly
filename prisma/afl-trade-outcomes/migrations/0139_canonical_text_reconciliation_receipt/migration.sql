-- Keep legacy JSONB receipts readable; new receipts retain the complete canonical
-- wrapper without the JSONB container limit. This checksum is not run_sha256.
ALTER TABLE outcome_factual_reconciliation_run
  ALTER COLUMN receipt_json DROP NOT NULL,
  ADD COLUMN receipt_canonical_json TEXT,
  ADD COLUMN receipt_canonical_sha256 CHAR(64),
  ADD CONSTRAINT outcome_factual_run_receipt_representation_check CHECK (
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
  run_schema TEXT;
  old_declaration CONSTANT TEXT := 'DECLARE head_count INTEGER;';
  new_declaration TEXT;
  old_comparison CONSTANT TEXT := $fragment$  IF (to_jsonb(NEW) - ARRAY['status','completed_at','finalized_at','receipt_json','output_set_sha256']::TEXT[])
       IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','completed_at','finalized_at','receipt_json','output_set_sha256']::TEXT[]) THEN$fragment$;
  new_comparison CONSTANT TEXT := $fragment$  IF NEW.receipt_canonical_json IS DISTINCT FROM OLD.receipt_canonical_json THEN
    RAISE EXCEPTION 'Canonical reconciliation receipt bytes are immutable';
  END IF;
  new_immutable := NEW;
  old_immutable := OLD;
  new_immutable.status := NULL;
  old_immutable.status := NULL;
  new_immutable.completed_at := NULL;
  old_immutable.completed_at := NULL;
  new_immutable.finalized_at := NULL;
  old_immutable.finalized_at := NULL;
  new_immutable.receipt_json := NULL;
  old_immutable.receipt_json := NULL;
  new_immutable.receipt_canonical_json := NULL;
  old_immutable.receipt_canonical_json := NULL;
  new_immutable.output_set_sha256 := NULL;
  old_immutable.output_set_sha256 := NULL;
  IF to_jsonb(new_immutable) IS DISTINCT FROM to_jsonb(old_immutable) THEN$fragment$;
BEGIN
  SELECT n.nspname INTO STRICT run_schema
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE c.oid='outcome_factual_reconciliation_run'::regclass;
  new_declaration := format($fragment$DECLARE head_count INTEGER;
DECLARE new_immutable %I.outcome_factual_reconciliation_run%%ROWTYPE;
DECLARE old_immutable %I.outcome_factual_reconciliation_run%%ROWTYPE;$fragment$,run_schema,run_schema);
  SELECT pg_get_functiondef('validate_outcome_factual_reconciliation_run()'::regprocedure)
    INTO original_definition;
  IF original_definition IS NULL
    OR (length(original_definition)-length(replace(original_definition,old_declaration,'')))/length(old_declaration)<>1
    OR (length(original_definition)-length(replace(original_definition,old_comparison,'')))/length(old_comparison)<>1
    OR position('new_immutable' IN original_definition)<>0
    OR position('old_immutable' IN original_definition)<>0 THEN
    RAISE EXCEPTION 'Expected exact reconciliation immutable-field comparison';
  END IF;
  corrected_definition := replace(replace(original_definition,old_declaration,new_declaration),old_comparison,new_comparison);
  IF replace(replace(corrected_definition,new_declaration,old_declaration),new_comparison,old_comparison)
      IS DISTINCT FROM original_definition THEN
    RAISE EXCEPTION 'Canonical receipt correction changed unrelated reconciliation guards';
  END IF;
  -- The wrapper checksum remains immutable. All original policy, input, result,
  -- member, head and finalization checks and function privileges remain intact.
  EXECUTE corrected_definition;
END $$;
