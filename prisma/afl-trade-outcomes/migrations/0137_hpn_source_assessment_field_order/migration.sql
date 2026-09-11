-- JavaScript localeCompare and PostgreSQL collation need not order mixed-case
-- source names alike. Authenticate the full permission records as a multiset,
-- while preserving the originally reviewed assessment bytes and content address.
DO $$
DECLARE
  original_definition TEXT;
  corrected_definition TEXT;
  old_comparison CONSTANT TEXT := $fragment$    AND content=jsonb_build_object('schemaVersion','afl-trade-hpn-private-source-use-assessment/v2',$fragment$;
  new_comparison CONSTANT TEXT := $fragment$    AND CASE WHEN jsonb_typeof(content->'fields')='array' THEN
      (SELECT jsonb_agg(permission ORDER BY permission->>'sourceField')
         FROM jsonb_array_elements(content->'fields') entry(permission))=expected_fields
      ELSE false END
    AND content=jsonb_build_object('schemaVersion','afl-trade-hpn-private-source-use-assessment/v2',$fragment$;
  old_fields CONSTANT TEXT := $fragment$'fields',expected_fields,'reasons','[]'::JSONB$fragment$;
  new_fields CONSTANT TEXT := $fragment$'fields',content->'fields','reasons','[]'::JSONB$fragment$;
BEGIN
  SELECT pg_get_functiondef('outcome_hpn_source_first_projected_map_is_exact(text)'::regprocedure)
    INTO original_definition;
  IF original_definition IS NULL
     OR (length(original_definition)-length(replace(original_definition,old_comparison,'')))/length(old_comparison)<>1
     OR (length(original_definition)-length(replace(original_definition,old_fields,'')))/length(old_fields)<>1
     OR position(new_comparison IN original_definition)<>0
     OR position(new_fields IN original_definition)<>0 THEN
    RAISE EXCEPTION 'Expected exact source-first assessment field comparison';
  END IF;
  corrected_definition := replace(replace(original_definition,old_comparison,new_comparison),old_fields,new_fields);
  IF replace(replace(corrected_definition,new_comparison,old_comparison),new_fields,old_fields)
       IS DISTINCT FROM original_definition THEN
    RAISE EXCEPTION 'Field-order correction changed unrelated source-first authority bytes';
  END IF;
  -- No DISTINCT or field-name-only projection: duplicates, omissions, changed
  -- permissions/reasons and extra keys cannot match the complete expected array.
  -- Existing function identity, security, grants and other authority checks survive.
  EXECUTE corrected_definition;
END $$;
