-- Status reconciliation preserves every fact and authenticates its immutable session parent.
CREATE FUNCTION outcome_reviewed_status_transition_exact(parent_document JSONB, document JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE p JSONB:=parent_document->'content'; c JSONB:=document->'content';
 t JSONB; leg JSONB; selection JSONB; session JSONB; legs JSONB; sessions JSONB;
 transactions JSONB:='[]'; selections JSONB:='[]'; transaction_ids JSONB:='[]'; selection_ids JSONB:='[]';
 expected JSONB; marker JSONB;
BEGIN
 IF COALESCE(p->>'environment','') NOT IN ('non_production','test_fixture') OR NOT(p ? 'reviewedCorrection')
 OR NOT(p ? 'reviewedSessionCorrection') OR p ? 'reviewedStatusCorrection'
 OR p->'issues' IS DISTINCT FROM '[]'::jsonb THEN RETURN FALSE; END IF;
 FOR t IN SELECT value FROM jsonb_array_elements(p->'transactions') LOOP
   SELECT COALESCE(jsonb_agg(value),'[]') INTO legs FROM jsonb_array_elements(p->'transfers')
     WHERE value->>'transactionId'=t->>'transactionId';
   SELECT COALESCE(jsonb_agg(value->'transferId' ORDER BY value->>'transferId'),'[]') INTO expected
     FROM jsonb_array_elements(legs);
   IF t->>'status' NOT IN ('unresolved','single_source','corroborated')
   OR jsonb_array_length(t->'parties')<2 OR jsonb_array_length(legs)=0
   OR expected IS DISTINCT FROM t->'transferIds' THEN RETURN FALSE; END IF;
   FOR leg IN SELECT value FROM jsonb_array_elements(legs) LOOP
     IF leg->>'status' NOT IN ('single_source','corroborated')
     OR leg->>'fromClubId' IS NULL OR leg->>'toClubId' IS NULL
     OR leg->>'fromClubId'=leg->>'toClubId'
     OR NOT(t->'parties' ? (leg->>'fromClubId')) OR NOT(t->'parties' ? (leg->>'toClubId'))
     OR (leg#>>'{asset,kind}'='player' AND leg#>>'{asset,playerId}' IS NULL)
     THEN RETURN FALSE; END IF;
   END LOOP;
   IF t->>'status'='unresolved' THEN
     transaction_ids:=transaction_ids||jsonb_build_array(t->'transactionId');
     t:=jsonb_set(t,'{status}','"single_source"');
   END IF;
   transactions:=transactions||jsonb_build_array(t);
 END LOOP;
 FOR selection IN SELECT value FROM jsonb_array_elements(p->'draftSelections') LOOP
   SELECT COALESCE(jsonb_agg(s.value),'[]') INTO sessions
   FROM jsonb_array_elements(p#>'{reviewedSessionCorrection,projections}') projection,
     LATERAL jsonb_array_elements(projection->'selectedSessions') s
   WHERE s.value->'selectionIds' ? (selection->>'selectionId');
   IF selection->>'status' NOT IN ('unresolved','single_source','corroborated')
   OR selection->>'playerId' IS NULL OR selection->>'clubId' IS NULL
   OR jsonb_array_length(sessions)<>1 THEN RETURN FALSE; END IF;
   session:=sessions->0;
   IF session->'draftYear' IS DISTINCT FROM selection->'draftYear'
   OR session->'draftType' IS DISTINCT FROM selection->'draftType'
   OR NOT((selection->'evidenceIds') @> (session->'evidenceIds'))
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(p->'pickCustody') custody
     WHERE custody->'draftYear'=selection->'draftYear' AND custody->'draftType'=selection->'draftType'
       AND custody->'recordedPickNumber'=selection->'selectionNumber'
       AND custody->>'status' NOT IN ('single_source','corroborated'))
   THEN RETURN FALSE; END IF;
   IF selection->>'status'='unresolved' THEN
     selection_ids:=selection_ids||jsonb_build_array(selection->'selectionId');
     selection:=jsonb_set(selection,'{status}','"single_source"');
   END IF;
   selections:=selections||jsonb_build_array(selection);
 END LOOP;
 IF jsonb_array_length(transaction_ids)+jsonb_array_length(selection_ids)=0 THEN RETURN FALSE; END IF;
 SELECT COALESCE(jsonb_agg(value ORDER BY value),'[]') INTO transaction_ids FROM jsonb_array_elements(transaction_ids);
 SELECT COALESCE(jsonb_agg(value ORDER BY value),'[]') INTO selection_ids FROM jsonb_array_elements(selection_ids);
 marker:=jsonb_build_object('schemaVersion','afl-trade-reviewed-status-correction/v1',
   'parentCandidateId',parent_document->'candidateId','transactionIds',transaction_ids,'selectionIds',selection_ids);
 expected:=p||jsonb_build_object('transactions',transactions,'draftSelections',selections,'reviewedStatusCorrection',marker);
 RETURN COALESCE(c=expected,FALSE);
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END $$;

ALTER FUNCTION validate_outcome_reviewed_admission_scope(JSONB) RENAME TO validate_outcome_reviewed_admission_scope_before_statuses;
CREATE FUNCTION validate_outcome_reviewed_admission_scope(document JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE parent_document JSONB; parent_id TEXT:=document#>>'{content,reviewedStatusCorrection,parentCandidateId}';
 parent_identities JSONB; child_identities JSONB;
BEGIN
 IF NOT(document->'content' ? 'reviewedStatusCorrection') THEN
   PERFORM validate_outcome_reviewed_admission_scope_before_statuses(document); RETURN;
 END IF;
 SELECT candidate_json INTO parent_document FROM outcome_external_reconciliation_candidate
 WHERE candidate_id=parent_id AND status='finalized'
   AND outcome_external_candidate_retained_sources_current(candidate_id,clock_timestamp()) FOR SHARE;
 IF parent_document IS NULL OR outcome_reviewed_status_transition_exact(parent_document,document) IS NOT TRUE
 THEN RAISE EXCEPTION 'Status correction requires its exact current resolved session parent'; END IF;
 -- Parent cannot itself be a status successor, so this edge cannot introduce recursion cycles.
 PERFORM validate_outcome_reviewed_admission_scope(parent_document);
 SELECT COALESCE(jsonb_agg(resolution_json ORDER BY resolution_id),'[]') INTO parent_identities
 FROM outcome_external_reconciliation_identity_resolution WHERE candidate_id=parent_id;
 SELECT COALESCE(jsonb_agg(resolution_json ORDER BY resolution_id),'[]') INTO child_identities
 FROM outcome_external_reconciliation_identity_resolution WHERE candidate_id=document->>'candidateId';
 IF child_identities IS DISTINCT FROM parent_identities THEN
   RAISE EXCEPTION 'Status correction must retain exact authenticated identity resolutions';
 END IF;
END $$;
