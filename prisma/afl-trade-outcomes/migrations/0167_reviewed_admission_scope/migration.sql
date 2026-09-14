-- Scoped admission defers unrelated evidence; it never resolves a relevant issue.
CREATE FUNCTION validate_outcome_reviewed_admission_scope(document JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE c JSONB:=document->'content'; scope JSONB:=c->'reviewedScope'; parent JSONB; original JSONB; registration JSONB; expected JSONB; active_ids TEXT[]; item JSONB;
BEGIN
 IF scope IS NULL THEN RETURN; END IF;
 registration:=read_outcome_reviewed_pick_lineage(scope->>'registrationId');
 SELECT candidate_json->'content' INTO parent FROM outcome_external_reconciliation_candidate WHERE candidate_id=scope->>'sourceCandidateId' AND status='finalized';
 SELECT candidate_json->'content' INTO original FROM outcome_external_reconciliation_candidate WHERE candidate_id=registration->'content'->>'candidateId' AND status='finalized';
 IF parent IS NULL OR original IS NULL OR parent ? 'reviewedScope' OR c->>'environment'='production'
 OR c->'environment' IS DISTINCT FROM registration->'content'->'environment'
 OR NOT outcome_external_candidate_retained_sources_current(scope->>'sourceCandidateId',clock_timestamp())
 OR NOT outcome_external_candidate_retained_sources_current(registration->'content'->>'candidateId',clock_timestamp())
 THEN RAISE EXCEPTION 'Reviewed scope requires current retained candidates and private review authority'; END IF;
 IF c - ARRAY['transactions','transfers','draftSelections','issues','reviewedScope'] IS DISTINCT FROM parent - ARRAY['transactions','transfers','draftSelections','issues']
 OR c->'pickCustody'<>'[]'::jsonb OR c->'pickLineage'<>'[]'::jsonb
 THEN RAISE EXCEPTION 'Reviewed scope may only select intact pre-correction records'; END IF;
 WITH roots AS (
  SELECT DISTINCT t->>'transactionId' AS id FROM jsonb_array_elements(original->'transfers') t
  JOIN jsonb_array_elements(registration->'content'->'records') r ON r->>'transferId'=t->>'transferId'
 ) SELECT COALESCE(jsonb_agg(t.value ORDER BY t.ordinality),'[]'::jsonb) INTO expected
 FROM jsonb_array_elements(parent->'transactions') WITH ORDINALITY t WHERE t.value->>'transactionId' IN (SELECT id FROM roots);
 IF c->'transactions' IS DISTINCT FROM expected OR jsonb_array_length(expected)=0
 THEN RAISE EXCEPTION 'Reviewed scope must retain whole registered transactions'; END IF;
 SELECT COALESCE(jsonb_agg(t.value ORDER BY t.ordinality),'[]'::jsonb) INTO expected
 FROM jsonb_array_elements(parent->'transfers') WITH ORDINALITY t
 WHERE t.value->>'transactionId' IN (SELECT v->>'transactionId' FROM jsonb_array_elements(c->'transactions') v);
 IF c->'transfers' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Reviewed scope must retain every trade leg'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(c->'transactions') LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(original->'transactions') v WHERE v=item)
  THEN RAISE EXCEPTION 'Reviewed original transaction changed'; END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(c->'transfers') LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(original->'transfers') v WHERE v=item)
  THEN RAISE EXCEPTION 'Reviewed original transfer changed'; END IF;
 END LOOP;
 FOR item IN SELECT r->'endpoint' FROM jsonb_array_elements(registration->'content'->'records') r WHERE r->'endpoint'->>'kind'='selected' LOOP
  IF (SELECT count(*) FROM jsonb_array_elements(parent->'draftSelections') s
   WHERE s->'playerId'=item->'playerId' AND s->'clubId'=item->'exercisingClubId' AND s->'draftYear'=item->'draftYear'
   AND s->'draftType'=item->'draftType' AND s->'selectionNumber'=item->'livePick')<>1
  THEN RAISE EXCEPTION 'Reviewed endpoint requires one exact selection'; END IF;
 END LOOP;
 SELECT COALESCE(jsonb_agg(s.value ORDER BY s.ordinality),'[]'::jsonb) INTO expected
 FROM jsonb_array_elements(parent->'draftSelections') WITH ORDINALITY s
 WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(registration->'content'->'records') r
  WHERE r->'endpoint'->>'kind'='selected' AND s.value->'playerId'=r->'endpoint'->'playerId'
  AND s.value->'clubId'=r->'endpoint'->'exercisingClubId' AND s.value->'draftYear'=r->'endpoint'->'draftYear'
  AND s.value->'draftType'=r->'endpoint'->'draftType' AND s.value->'selectionNumber'=r->'endpoint'->'livePick');
 IF c->'draftSelections' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Reviewed scope selection membership differs'; END IF;
 SELECT array_agg(DISTINCT evidence) INTO active_ids FROM (
  SELECT jsonb_array_elements_text(v->'evidenceIds') AS evidence
  FROM jsonb_array_elements((c->'transactions')||(c->'transfers')||(c->'draftSelections')||(c->'issues')) v
 ) ids;
 FOR item IN SELECT value FROM jsonb_array_elements(parent->'issues') LOOP
  IF (jsonb_array_length(item->'evidenceIds')=0
   OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(item->'evidenceIds') id WHERE id=ANY(active_ids))
   OR EXISTS (SELECT 1 FROM jsonb_array_elements(c->'transfers') t WHERE item->>'subjectKey'='lineage:'||(t->>'transferId')))
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c->'issues') v WHERE v=item)
  THEN RAISE EXCEPTION 'Reviewed scope cannot defer a relevant blocking issue'; END IF;
 END LOOP;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(c->'issues') v WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(parent->'issues') old WHERE old=v))
 THEN RAISE EXCEPTION 'Reviewed scope cannot invent or modify issues'; END IF;
 IF jsonb_typeof(scope->'deferredEvidenceIds') IS DISTINCT FROM 'array'
 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(scope->'deferredEvidenceIds') id WHERE id=ANY(active_ids))
 THEN RAISE EXCEPTION 'Deferred evidence must be separate from active evidence'; END IF;
END $$;

CREATE OR REPLACE FUNCTION "finalize_outcome_external_reconciliation_candidate"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  source_count INTEGER;
  identity_count INTEGER;
  transaction_count INTEGER;
  transfer_count INTEGER;
  selection_count INTEGER;
  custody_count INTEGER;
  lineage_count INTEGER;
  issue_count INTEGER;
  unfinalized_source_count INTEGER;
  invalid_identity_decision_count INTEGER;
  missing_evidence_count INTEGER;
  invalid_lineage_count INTEGER;
BEGIN
  IF OLD.status <> 'open' OR NEW.status <> 'finalized' OR NEW.finalized_at IS NULL OR
     NEW.candidate_id <> OLD.candidate_id OR NEW.environment <> OLD.environment OR
     NEW.competition <> OLD.competition OR NEW.anchor_season_year <> OLD.anchor_season_year OR
     NEW.reconciled_at <> OLD.reconciled_at OR
     NEW.source_batch_count <> OLD.source_batch_count OR
     NEW.identity_resolution_count <> OLD.identity_resolution_count OR
     NEW.transaction_count <> OLD.transaction_count OR NEW.transfer_count <> OLD.transfer_count OR
     NEW.draft_selection_count <> OLD.draft_selection_count OR
     NEW.pick_custody_count <> OLD.pick_custody_count OR
     NEW.pick_lineage_count <> OLD.pick_lineage_count OR NEW.issue_count <> OLD.issue_count OR
     NEW.candidate_json <> OLD.candidate_json THEN
    RAISE EXCEPTION 'External reconciliation update is not the exact finalization transition';
  END IF;
  PERFORM validate_outcome_reviewed_admission_scope(NEW.candidate_json);
  SELECT count(*) INTO source_count FROM outcome_external_reconciliation_source_batch WHERE candidate_id=NEW.candidate_id;
  SELECT count(*) INTO identity_count FROM outcome_external_reconciliation_identity_resolution WHERE candidate_id=NEW.candidate_id;
  SELECT count(*) INTO transaction_count FROM outcome_external_reconciliation_transaction WHERE candidate_id=NEW.candidate_id;
  SELECT count(*) INTO transfer_count FROM outcome_external_reconciliation_transfer WHERE candidate_id=NEW.candidate_id;
  SELECT count(*) INTO selection_count FROM outcome_external_reconciliation_draft_selection WHERE candidate_id=NEW.candidate_id;
  SELECT count(*) INTO custody_count FROM outcome_external_reconciliation_pick_custody WHERE candidate_id=NEW.candidate_id;
  SELECT count(*) INTO lineage_count FROM outcome_external_reconciliation_pick_lineage WHERE candidate_id=NEW.candidate_id;
  SELECT count(*) INTO issue_count FROM outcome_external_reconciliation_issue WHERE candidate_id=NEW.candidate_id;
  IF source_count <> NEW.source_batch_count OR identity_count <> NEW.identity_resolution_count OR
     transaction_count <> NEW.transaction_count OR transfer_count <> NEW.transfer_count OR
     selection_count <> NEW.draft_selection_count OR custody_count <> NEW.pick_custody_count OR
     lineage_count <> NEW.pick_lineage_count OR issue_count <> NEW.issue_count THEN
    RAISE EXCEPTION 'External reconciliation candidate child counts do not reconcile';
  END IF;
  SELECT count(*) INTO unfinalized_source_count
    FROM outcome_external_reconciliation_source_batch member
    JOIN outcome_external_evidence_batch batch ON batch.batch_id=member.batch_id
    JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
   WHERE member.candidate_id=NEW.candidate_id AND
         (batch.status <> 'finalized' OR batch.finalized_at IS NULL OR batch.issue_count <> 0 OR
          capture.environment <> NEW.environment OR capture.competition <> NEW.competition OR
          capture.anchor_season_year NOT IN (
            SELECT (item->>'seasonYear')::INTEGER
              FROM jsonb_array_elements(NEW.candidate_json->'content'->'transactions') item
            UNION
            SELECT (item->'asset'->>'draftYear')::INTEGER
              FROM jsonb_array_elements(NEW.candidate_json->'content'->'transfers') item
             WHERE item->'asset'->>'kind' = 'pick_entitlement'
            UNION
            SELECT (item->>'draftYear')::INTEGER
              FROM jsonb_array_elements(NEW.candidate_json->'content'->'draftSelections') item
            UNION
            SELECT (item->>'draftYear')::INTEGER
              FROM jsonb_array_elements(NEW.candidate_json->'content'->'pickCustody') item
          ));
  IF unfinalized_source_count <> 0 THEN
    RAISE EXCEPTION 'External reconciliation requires finalized, issue-free source evidence batches';
  END IF;
  SELECT count(*) INTO invalid_identity_decision_count
    FROM outcome_external_reconciliation_identity_resolution identity_member
    JOIN outcome_review_decision decision ON decision.decision_id=identity_member.review_decision_id
   WHERE identity_member.candidate_id=NEW.candidate_id AND
         (NOT (decision.subject_type = 'external_provider_identity' OR
               (NEW.environment = 'test_fixture' AND
                decision.subject_type = 'external_provider_identity_fixture')) OR
          decision.canonical_record_id IS DISTINCT FROM identity_member.canonical_id OR
          decision.decision <> 'approved' OR
          decision.decided_at IS DISTINCT FROM (identity_member.resolution_json->'content'->>'decidedAt')::timestamptz OR
          decision.decided_at > NEW.reconciled_at OR
          EXISTS (SELECT 1 FROM outcome_review_decision successor
                   WHERE successor.supersedes_decision_id=decision.decision_id));
  IF invalid_identity_decision_count <> 0 THEN
    RAISE EXCEPTION 'External reconciliation requires current approved identity decisions';
  END IF;
  SELECT count(*) INTO invalid_lineage_count
    FROM outcome_external_reconciliation_pick_lineage lineage
    JOIN outcome_external_reconciliation_transfer transfer
      ON transfer.candidate_id=lineage.candidate_id AND transfer.transfer_id=lineage.transfer_id
    JOIN outcome_external_reconciliation_draft_selection selection
      ON selection.candidate_id=lineage.candidate_id AND selection.selection_id=lineage.selection_id
   WHERE lineage.candidate_id=NEW.candidate_id AND
         (lineage.pick_id IS DISTINCT FROM transfer.pick_id OR
          lineage.pick_id IS DISTINCT FROM selection.pick_id OR
          lineage.status NOT IN ('single_source','corroborated') OR
          transfer.status NOT IN ('single_source','corroborated') OR
          selection.status NOT IN ('single_source','corroborated') OR
          NOT EXISTS (
            SELECT 1
              FROM outcome_external_reconciliation_pick_custody custody
             WHERE custody.candidate_id=lineage.candidate_id AND
                   custody.pick_id=lineage.pick_id AND
                   custody.status IN ('single_source','corroborated')
          ));
  IF invalid_lineage_count <> 0 THEN
    RAISE EXCEPTION 'External reconciliation lineage requires usable transfer, selection, and custody';
  END IF;
  WITH referenced_evidence AS (
    SELECT jsonb_array_elements_text(transaction_json->'evidenceIds') AS evidence_id
      FROM outcome_external_reconciliation_transaction WHERE candidate_id=NEW.candidate_id
    UNION
    SELECT jsonb_array_elements_text(transfer_json->'evidenceIds')
      FROM outcome_external_reconciliation_transfer WHERE candidate_id=NEW.candidate_id
    UNION
    SELECT jsonb_array_elements_text(selection_json->'evidenceIds')
      FROM outcome_external_reconciliation_draft_selection WHERE candidate_id=NEW.candidate_id
    UNION
    SELECT jsonb_array_elements_text(custody_json->'evidenceIds')
      FROM outcome_external_reconciliation_pick_custody WHERE candidate_id=NEW.candidate_id
    UNION
    SELECT jsonb_array_elements_text(lineage_json->'evidenceIds')
      FROM outcome_external_reconciliation_pick_lineage WHERE candidate_id=NEW.candidate_id
    UNION
    SELECT jsonb_array_elements_text(issue_json->'evidenceIds')
      FROM outcome_external_reconciliation_issue WHERE candidate_id=NEW.candidate_id
    UNION
    SELECT jsonb_array_elements_text(COALESCE(NEW.candidate_json#>'{content,reviewedScope,deferredEvidenceIds}','[]'::jsonb))
  ), source_evidence AS (
    SELECT evidence.evidence_id
      FROM outcome_external_evidence_row evidence
      JOIN outcome_external_reconciliation_source_batch source
        ON source.batch_id=evidence.batch_id AND source.candidate_id=NEW.candidate_id
  ), evidence_gap AS (
    SELECT reference.evidence_id
      FROM referenced_evidence reference
      LEFT JOIN source_evidence source ON source.evidence_id=reference.evidence_id
     WHERE source.evidence_id IS NULL
    UNION ALL
    SELECT source.evidence_id
      FROM source_evidence source
      LEFT JOIN referenced_evidence reference ON reference.evidence_id=source.evidence_id
     WHERE reference.evidence_id IS NULL
  )
  SELECT count(*) INTO missing_evidence_count
    FROM evidence_gap;
  IF missing_evidence_count <> 0 THEN
    RAISE EXCEPTION 'External reconciliation must conserve the exact source evidence set';
  END IF;
  RETURN NEW;
END;
$$;

