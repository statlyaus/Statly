-- Extend immutable session coverage through a current authenticated parent chain.
DO $$
DECLARE definition TEXT; old_fragment TEXT; new_fragment TEXT;
BEGIN
 definition:=pg_get_functiondef('outcome_reviewed_session_transition_exact(jsonb,jsonb)'::regprocedure);
 old_fragment:=$old$OR NOT(p ? 'reviewedCorrection') OR p ? 'reviewedSessionCorrection'$old$;
 IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Expected original session-parent guard'; END IF;
 definition:=replace(definition,old_fragment,$new$OR NOT(p ? 'reviewedCorrection')$new$);
 old_fragment:=$old$p-ARRAY['draftSelections','sourceBatchIds','sourceAuthority','identityResolutionIds','reconciledAt','reviewedScope']$old$;
 IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Expected session parent conservation fields'; END IF;
 definition:=replace(definition,old_fragment,$new$p-ARRAY['draftSelections','sourceBatchIds','sourceAuthority','identityResolutionIds','reconciledAt','reviewedScope','reviewedSessionCorrection']$new$);
 old_fragment:=$old$-- Preserve every selection and every field except the precisely projected evidence union.$old$;
 new_fragment:=$new$-- A successor must add groups, preserving each prior projection byte-for-byte in canonical JSON.
 IF p ? 'reviewedSessionCorrection' AND (
   jsonb_array_length(marker->'projections')<=jsonb_array_length(p#>'{reviewedSessionCorrection,projections}')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(p#>'{reviewedSessionCorrection,projections}') prior
     WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(marker->'projections') next WHERE next=prior))
 ) THEN RETURN FALSE; END IF;
 -- Preserve every selection and every field except the precisely projected evidence union.$new$;
 IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Expected session projection conservation insertion'; END IF;
 definition:=replace(definition,old_fragment,new_fragment);
 EXECUTE definition;
END $$;

DO $$
DECLARE definition TEXT;
 old_fragment CONSTANT TEXT:='PERFORM validate_outcome_reviewed_admission_scope_before_sessions(parent_document);';
BEGIN
 definition:=pg_get_functiondef('validate_outcome_reviewed_admission_scope(jsonb)'::regprocedure);
 IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
 THEN RAISE EXCEPTION 'Expected session parent authentication call'; END IF;
 -- Every edge strictly increases the source set; recursion terminates at the original reviewed parent.
 EXECUTE replace(definition,old_fragment,'PERFORM validate_outcome_reviewed_admission_scope(parent_document);');
END $$;
