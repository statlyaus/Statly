-- Deferred custody observations (statlyaus/Statly#869). Under the pick-side deferral a custody row
-- whose status is not usable (`unresolved` or `disputed`: the order pages' holder-only special
-- picks with no original club, and the rows behind a deferred pick_identity_conflict) is pick-side.
-- Preparation records every such row under `content.pickLineageDeferral.deferredCustodyIds` (sorted
-- unique, present only when non-empty); the candidate insert checks each is a candidate custody row
-- without a usable status, the promoter re-checks, nothing is written for it, and the unusable-record
-- count stops counting it. Without a deferral nothing changes.

CREATE FUNCTION outcome_external_candidate_deferred_custody_valid(candidate JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE ids JSONB := candidate#>'{content,pickLineageDeferral,deferredCustodyIds}';
        id JSONB; row_status TEXT;
BEGIN
  IF ids IS NULL THEN RETURN TRUE; END IF;
  IF jsonb_typeof(ids)<>'array' OR jsonb_array_length(ids)=0
     OR jsonb_typeof(candidate#>'{content,pickCustody}') IS DISTINCT FROM 'array' THEN
    RETURN FALSE;
  END IF;
  FOR id IN SELECT value FROM jsonb_array_elements(ids) LOOP
    IF jsonb_typeof(id)<>'string' THEN RETURN FALSE; END IF;
    SELECT value->>'status' INTO row_status FROM jsonb_array_elements(candidate#>'{content,pickCustody}') value
     WHERE value->>'custodyId'=id#>>'{}' LIMIT 1;
    IF row_status IS NULL OR row_status IN ('single_source','corroborated') THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
END $$;

-- The candidate insert guard (0264, 0265, 0267) also demands the deferred custody rows be valid, and
-- only under the deferral decision.
CREATE OR REPLACE FUNCTION validate_outcome_external_reconciliation_lineage_deferral()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE decision_row outcome_review_decision%ROWTYPE;
BEGIN
  IF (NEW.candidate_json#>'{content,pickLineageDeferral,promotedDrafts}' IS NOT NULL
      OR NEW.candidate_json#>'{content,pickLineageDeferral,promotedTransactions}' IS NOT NULL
      OR NEW.candidate_json#>'{content,pickLineageDeferral,deferredCustodyIds}' IS NOT NULL)
     AND NEW.lineage_deferral_decision_id IS NULL THEN
    RAISE EXCEPTION 'Already-promoted drafts and transactions and deferred custody are recorded only under the pick-side deferral decision';
  END IF;
  IF NOT outcome_external_candidate_promoted_drafts_current(NEW.candidate_json) THEN
    RAISE EXCEPTION 'Every draft a deferred candidate leaves to an earlier promotion must be current canonical in full';
  END IF;
  IF NOT outcome_external_candidate_promoted_transactions_current(NEW.candidate_json) THEN
    RAISE EXCEPTION 'Every transaction a deferred candidate leaves to an earlier promotion must be current canonical with every transfer promoted';
  END IF;
  IF NOT outcome_external_candidate_deferred_custody_valid(NEW.candidate_json) THEN
    RAISE EXCEPTION 'Every deferred custody observation must be a candidate custody row without a usable status';
  END IF;
  IF NEW.lineage_deferral_decision_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.historical_completion_id IS NULL THEN
    RAISE EXCEPTION 'Pick-side deferral requires a candidate prepared from a historical completion';
  END IF;
  SELECT * INTO decision_row FROM outcome_review_decision
   WHERE decision_id=NEW.lineage_deferral_decision_id FOR SHARE;
  IF NOT FOUND OR decision_row.subject_type <> 'reconciliation_scope'
     OR decision_row.subject_id <> NEW.historical_completion_id
     OR decision_row.decision <> 'approved'
     OR decision_row.decided_at > NEW.reconciled_at
     OR EXISTS (SELECT 1 FROM outcome_review_decision successor
                 WHERE successor.supersedes_decision_id=decision_row.decision_id) THEN
    RAISE EXCEPTION 'Pick-side deferral requires the current approved reconciliation-scope decision for the candidate completion';
  END IF;
  RETURN NEW;
END $$;

-- Reconciled records the promotion writes that lack a usable status (0264, 0267): a deferred custody
-- observation is not written, so its status is not counted.
CREATE OR REPLACE FUNCTION outcome_external_candidate_unusable_record_count(target_candidate TEXT)
RETURNS INTEGER LANGUAGE sql STABLE AS $$
  SELECT count(*)::INTEGER FROM (
    SELECT status FROM outcome_external_candidate_promotable_transactions(target_candidate)
    UNION ALL SELECT transfer.status FROM outcome_external_reconciliation_transfer transfer
     WHERE transfer.candidate_id=target_candidate
       AND NOT EXISTS (SELECT 1 FROM outcome_external_candidate_deferred_transfers(target_candidate) deferred
                        WHERE deferred.transfer_id=transfer.transfer_id)
       AND EXISTS (SELECT 1 FROM outcome_external_candidate_promotable_transactions(target_candidate) written
                    WHERE written.transaction_id=transfer.transaction_id)
    UNION ALL SELECT selection.status FROM outcome_external_candidate_promotable_selections(target_candidate) selection
    UNION ALL SELECT custody.status FROM outcome_external_reconciliation_pick_custody custody
     WHERE custody.candidate_id=target_candidate
       AND NOT EXISTS (SELECT 1 FROM outcome_external_candidate_deferred_picks(target_candidate) deferred
                        WHERE deferred.pick_id=custody.pick_id)
       AND NOT EXISTS (SELECT 1 FROM outcome_external_reconciliation_candidate candidate
                       CROSS JOIN LATERAL jsonb_array_elements_text(
                         COALESCE(candidate.candidate_json#>'{content,pickLineageDeferral,deferredCustodyIds}','[]'::jsonb)) deferred
                        WHERE candidate.candidate_id=target_candidate AND deferred.value=custody.custody_id)
    UNION ALL SELECT status FROM outcome_external_reconciliation_pick_lineage WHERE candidate_id=target_candidate
  ) records WHERE status NOT IN ('single_source','corroborated')
$$;
