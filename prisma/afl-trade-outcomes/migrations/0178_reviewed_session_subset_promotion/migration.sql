-- V6 promotes only the exact selected membership of an authenticated complete-inventory proof.
ALTER FUNCTION outcome_external_draft_sessions_exact(TEXT,JSONB) RENAME TO outcome_external_draft_sessions_exact_before_v6;
CREATE FUNCTION outcome_external_draft_sessions_exact(target_candidate TEXT, proposal JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE document JSONB; expected JSONB; selection_ids JSONB; proposed_ids JSONB;
BEGIN
 IF proposal->>'schemaVersion' IS DISTINCT FROM 'afl-trade-external-canonical-promotion-proposal/v6'
 THEN RETURN outcome_external_draft_sessions_exact_before_v6(target_candidate,proposal); END IF;
 SELECT candidate_json INTO document FROM outcome_external_reconciliation_candidate
 WHERE candidate_id=target_candidate AND status='finalized'
 AND environment IN ('test_fixture','non_production')
 AND outcome_external_candidate_retained_sources_current(candidate_id,clock_timestamp());
 IF document IS NULL OR document#>'{content,reviewedSessionCorrection}' IS NULL
 OR proposal->>'candidateId' IS DISTINCT FROM target_candidate
 OR proposal->>'proposedAt' IS NULL
 OR (proposal->>'proposedAt')::timestamptz<(document#>>'{content,reconciledAt}')::timestamptz
 THEN RETURN FALSE; END IF;
 PERFORM validate_outcome_reviewed_admission_scope(document);
 SELECT jsonb_agg(s||jsonb_build_object('expectedSelectionCount',jsonb_array_length(s->'selectionIds'),
   'status','complete','proofKind',CASE WHEN p->>'schemaVersion'='afl-trade-combined-draft-session-projection/v1'
    THEN 'combined_session_facts' ELSE 'direct_session_claim' END) ORDER BY group_order,session_order)
 INTO expected FROM jsonb_array_elements(document#>'{content,reviewedSessionCorrection,projections}') WITH ORDINALITY q(p,group_order),
 jsonb_array_elements(p->'selectedSessions') WITH ORDINALITY r(s,session_order);
 IF expected IS NULL OR proposal->'draftEventCoverage' IS DISTINCT FROM expected THEN RETURN FALSE; END IF;
 SELECT jsonb_agg(s->'selectionId' ORDER BY s->>'selectionId') INTO selection_ids
 FROM jsonb_array_elements(document#>'{content,draftSelections}') s;
 SELECT jsonb_agg(to_jsonb(id) ORDER BY id) INTO proposed_ids
 FROM jsonb_array_elements(expected) s,jsonb_array_elements_text(s->'selectionIds') id;
 RETURN selection_ids IS NOT NULL AND selection_ids=proposed_ids;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN RETURN FALSE;
END $$;

-- Preserve all existing review, nullable-date, session-finalization and acquisition guards.
DO $migration$
DECLARE signature TEXT; definition TEXT;
 old_fragment CONSTANT TEXT:=$old$'afl-trade-external-canonical-promotion-proposal/v5')$old$;
 new_fragment CONSTANT TEXT:=$new$'afl-trade-external-canonical-promotion-proposal/v5','afl-trade-external-canonical-promotion-proposal/v6')$new$;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'validate_outcome_external_canonical_promotion_insert()',
  'validate_outcome_external_promotion_review_insert()',
  'require_outcome_external_draft_session_finalization()',
  'outcome_acquisition_registration_event_current(jsonb,text,text,text,text,boolean,timestamptz,timestamptz)'
 ] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
  THEN RAISE EXCEPTION 'Expected exact v6 predecessor in %',signature; END IF;
  EXECUTE replace(definition,old_fragment,new_fragment);
 END LOOP;
END $migration$;
