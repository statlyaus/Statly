-- Match the canonical document IDs produced by combinedDraftDocumentId in TypeScript.
-- Preserve unknown/non-AFL URL identity and all authenticated source joins.
DO $$
DECLARE signature TEXT; definition TEXT;
 before_text CONSTANT TEXT := '''documentId'',coalesce(substring(capture.manifest_json->>''sourceUrl''';
 after_text CONSTANT TEXT := '''documentId'',coalesce(''official_afl:news:''||substring(capture.manifest_json->>''sourceUrl''';
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'outcome_external_combined_draft_group_exact(text,jsonb,integer,text)',
  'outcome_external_combined_draft_group_exact_inventory(text,jsonb,integer,text,jsonb,jsonb,jsonb)'
 ] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  IF (length(definition)-length(replace(definition,before_text,'')))/length(before_text)<>1
  THEN RAISE EXCEPTION 'Expected one membership document identity constructor in %',signature; END IF;
  EXECUTE replace(definition,before_text,after_text);
 END LOOP;
END $$;
