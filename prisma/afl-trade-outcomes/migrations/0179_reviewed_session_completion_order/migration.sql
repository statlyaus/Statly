-- Retained completion hashes bind target order; candidate batch hashes bind sorted membership.
-- Preserve the original completion hash and compare membership in canonical candidate order.
DO $$
DECLARE definition TEXT;
 old_fragment CONSTANT TEXT:=$old$completion#>'{content,sourceBatchIds}' IS DISTINCT FROM c->'sourceBatchIds'$old$;
 new_fragment CONSTANT TEXT:=$new$(SELECT jsonb_agg(value ORDER BY value) FROM jsonb_array_elements(completion#>'{content,sourceBatchIds}')) IS DISTINCT FROM c->'sourceBatchIds'$new$;
BEGIN
 definition:=pg_get_functiondef('validate_outcome_reviewed_admission_scope(jsonb)'::regprocedure);
 IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
 THEN RAISE EXCEPTION 'Expected reviewed-session completion membership predicate'; END IF;
 EXECUTE replace(definition,old_fragment,new_fragment);
END $$;
