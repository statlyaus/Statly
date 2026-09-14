-- Supplement an incomplete retained inventory without changing any parent selection.
DO $$
DECLARE definition TEXT;
 old_fragment CONSTANT TEXT:=$old$IF added IS NULL OR EXISTS(SELECT 1 FROM outcome_external_evidence_row WHERE batch_id=ANY(added)
   AND claim_kind NOT IN ('draft_session','draft_session_date','draft_session_completion','draft_session_boundary','draft_completed_total','draft_completed_inventory','draft_completed_membership_roster','draft_completed_member_number'))$old$;
 new_fragment CONSTANT TEXT:=$new$IF added IS NULL OR EXISTS(
   SELECT 1 FROM outcome_external_evidence_row e WHERE e.batch_id=ANY(added)
   AND e.claim_kind NOT IN ('draft_session','draft_session_date','draft_session_completion','draft_session_boundary','draft_completed_total','draft_completed_inventory','draft_completed_membership_roster','draft_completed_member_number')
   AND NOT (
     e.claim_kind='draft_selection' AND coalesce(e.evidence_json#>>'{content,provider}','')='official_afl'
     AND EXISTS(SELECT 1 FROM jsonb_array_elements(p->'draftSelections') s
       WHERE s->'draftYear'=e.evidence_json#>'{content,claim,draftYear}'
       AND s->'draftType'=e.evidence_json#>'{content,claim,draftType}')
     AND NOT EXISTS(SELECT 1 FROM outcome_external_evidence_row prior
       WHERE p->'sourceBatchIds' ? prior.batch_id AND prior.claim_kind='draft_selection'
       AND prior.evidence_json#>'{content,claim,draftYear}'=e.evidence_json#>'{content,claim,draftYear}'
       AND prior.evidence_json#>'{content,claim,draftType}'=e.evidence_json#>'{content,claim,draftType}'
       AND prior.evidence_json#>'{content,claim,selectionNumber}'=e.evidence_json#>'{content,claim,selectionNumber}')
   ))$new$;
BEGIN
 definition:=pg_get_functiondef('validate_outcome_reviewed_admission_scope(jsonb)'::regprocedure);
 IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
 THEN RAISE EXCEPTION 'Expected exact supplemental-selection predecessor'; END IF;
 EXECUTE replace(definition,old_fragment,new_fragment);
END $$;
