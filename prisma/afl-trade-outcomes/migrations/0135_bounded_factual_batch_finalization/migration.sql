-- Exclude mutable fields before JSON conversion, so a large receipt is never
-- materialized merely to discard it. Typed copies retain future-column coverage.
DO $$
DECLARE
  original_definition TEXT;
  corrected_definition TEXT;
  batch_schema TEXT;
  old_declaration CONSTANT TEXT := '  run_row RECORD;';
  new_declaration TEXT;
  old_comparison CONSTANT TEXT := $fragment$  IF (to_jsonb(NEW) - ARRAY['status','completed_at','finalized_at','receipt_json']::TEXT[])
       IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','completed_at','finalized_at','receipt_json']::TEXT[]) THEN$fragment$;
  new_comparison CONSTANT TEXT := $fragment$  new_immutable := NEW;
  old_immutable := OLD;
  new_immutable.status := NULL;
  old_immutable.status := NULL;
  new_immutable.completed_at := NULL;
  old_immutable.completed_at := NULL;
  new_immutable.finalized_at := NULL;
  old_immutable.finalized_at := NULL;
  new_immutable.receipt_json := NULL;
  old_immutable.receipt_json := NULL;
  IF to_jsonb(new_immutable) IS DISTINCT FROM to_jsonb(old_immutable) THEN$fragment$;
BEGIN
  SELECT n.nspname INTO STRICT batch_schema
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE c.oid='outcome_provider_fact_batch'::regclass;
  new_declaration := format($fragment$  run_row RECORD;
  new_immutable %I.outcome_provider_fact_batch%%ROWTYPE;
  old_immutable %I.outcome_provider_fact_batch%%ROWTYPE;$fragment$,batch_schema,batch_schema);
  SELECT pg_get_functiondef('validate_outcome_provider_fact_batch()'::regprocedure)
    INTO original_definition;
  IF original_definition IS NULL
     OR (length(original_definition)-length(replace(original_definition,old_declaration,'')))/length(old_declaration)<>1
     OR (length(original_definition)-length(replace(original_definition,old_comparison,'')))/length(old_comparison)<>1
     OR position('new_immutable' IN original_definition)<>0
     OR position('old_immutable' IN original_definition)<>0 THEN
    RAISE EXCEPTION 'Expected exact factual batch immutable-field comparison';
  END IF;
  corrected_definition := replace(replace(original_definition,old_declaration,new_declaration),old_comparison,new_comparison);
  IF replace(replace(corrected_definition,new_declaration,old_declaration),new_comparison,old_comparison)
       IS DISTINCT FROM original_definition THEN
    RAISE EXCEPTION 'Bounded comparison changed unrelated factual batch guard bytes';
  END IF;
  -- Existing function identity, attributes, owner, grants and all other checks survive.
  EXECUTE corrected_definition;
END $$;
