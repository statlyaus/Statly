-- Deferred-lineage promotion leaves an already-promoted transaction alone (statlyaus/Statly#869).
-- A candidate prepared under the pick-side deferral may carry a trade whose event is already current
-- canonical under the same stable key from a finalized promotion, with every one of the candidate's
-- transfers a promoted asset on that current version. Promoting it again would write a new trade
-- version over the current one and duplicate its assets. Such a transaction is recorded on the
-- candidate (`content.pickLineageDeferral.promotedTransactions`, sorted unique ids, present only when
-- non-empty); the candidate insert checks it, the promoter re-checks it, the promotable transaction
-- set the coverage validators compare against leaves it out, and the unusable-record count ignores
-- it and its transfers. Same shape as 0265 for drafts.

-- Current canonical trade events: a transaction member of a finalized promotion whose event version
-- is approved, current (no successor) and the version of the event keyed by the transaction itself,
-- with the source transfer ids promoted as approved assets on that version.
CREATE FUNCTION outcome_current_canonical_transactions(target_competition TEXT)
RETURNS TABLE (transaction_id TEXT, transfer_ids TEXT[]) LANGUAGE sql STABLE AS $$
  SELECT record.source_record_id,
         COALESCE((SELECT array_agg(transfer.source_record_id ORDER BY transfer.source_record_id)
                     FROM outcome_external_canonical_promotion_record transfer
                     JOIN outcome_event_asset asset ON asset.asset_version_id=transfer.canonical_record_id
                    WHERE transfer.promotion_id=record.promotion_id AND transfer.record_kind='transfer'
                      AND asset.event_version_id=version.event_version_id AND asset.status='approved'),
                  ARRAY[]::TEXT[])
    FROM outcome_external_canonical_promotion_record record
    JOIN outcome_external_canonical_promotion promotion
      ON promotion.promotion_id=record.promotion_id AND promotion.status='finalized'
    JOIN outcome_event_version version
      ON version.event_version_id=record.canonical_record_id AND version.status='approved'
     AND version.event_id=record.source_record_id
    JOIN outcome_event event ON event.event_id=version.event_id AND event.competition=target_competition
   WHERE record.record_kind='transaction'
     AND NOT EXISTS (SELECT 1 FROM outcome_event_version successor
                      WHERE successor.supersedes_version_id=version.event_version_id)
$$;

-- Every transaction the candidate records as already promoted is one it holds, is current canonical,
-- and has every one of its candidate transfers promoted on that version. NULL (absent) is valid; an
-- empty or malformed list is not.
CREATE FUNCTION outcome_external_candidate_promoted_transactions_current(candidate JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE ids JSONB := candidate#>'{content,pickLineageDeferral,promotedTransactions}';
        competition TEXT := candidate#>>'{content,competition}';
        id JSONB; held JSONB; promoted TEXT[];
BEGIN
  IF ids IS NULL THEN RETURN TRUE; END IF;
  IF jsonb_typeof(ids)<>'array' OR jsonb_array_length(ids)=0 OR competition IS NULL
     OR jsonb_typeof(candidate#>'{content,transactions}') IS DISTINCT FROM 'array' THEN
    RETURN FALSE;
  END IF;
  FOR id IN SELECT value FROM jsonb_array_elements(ids) LOOP
    IF jsonb_typeof(id)<>'string' THEN RETURN FALSE; END IF;
    SELECT value INTO held FROM jsonb_array_elements(candidate#>'{content,transactions}') value
     WHERE value->>'transactionId'=id#>>'{}' LIMIT 1;
    IF held IS NULL OR jsonb_typeof(held->'transferIds') IS DISTINCT FROM 'array' THEN RETURN FALSE; END IF;
    SELECT current.transfer_ids INTO promoted
      FROM outcome_current_canonical_transactions(competition) current
     WHERE current.transaction_id=id#>>'{}';
    IF promoted IS NULL OR EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(held->'transferIds') transfer
          WHERE NOT (transfer.value = ANY(promoted))) THEN
      RETURN FALSE;
    END IF;
  END LOOP;
  RETURN TRUE;
END $$;

-- The candidate insert guard (0264, 0265) also demands the recorded transactions be current, and
-- only under the deferral decision.
CREATE OR REPLACE FUNCTION validate_outcome_external_reconciliation_lineage_deferral()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE decision_row outcome_review_decision%ROWTYPE;
BEGIN
  IF (NEW.candidate_json#>'{content,pickLineageDeferral,promotedDrafts}' IS NOT NULL
      OR NEW.candidate_json#>'{content,pickLineageDeferral,promotedTransactions}' IS NOT NULL)
     AND NEW.lineage_deferral_decision_id IS NULL THEN
    RAISE EXCEPTION 'Already-promoted drafts and transactions are recorded only under the pick-side deferral decision';
  END IF;
  IF NOT outcome_external_candidate_promoted_drafts_current(NEW.candidate_json) THEN
    RAISE EXCEPTION 'Every draft a deferred candidate leaves to an earlier promotion must be current canonical in full';
  END IF;
  IF NOT outcome_external_candidate_promoted_transactions_current(NEW.candidate_json) THEN
    RAISE EXCEPTION 'Every transaction a deferred candidate leaves to an earlier promotion must be current canonical with every transfer promoted';
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

-- Transactions a promotion of this candidate writes: none left to an earlier promotion.
CREATE FUNCTION outcome_external_candidate_promotable_transactions(target_candidate TEXT)
RETURNS SETOF outcome_external_reconciliation_transaction LANGUAGE sql STABLE AS $$
  SELECT held.*
    FROM outcome_external_reconciliation_transaction held
   WHERE held.candidate_id=target_candidate
     AND NOT EXISTS (SELECT 1 FROM outcome_external_reconciliation_candidate candidate
                     CROSS JOIN LATERAL jsonb_array_elements_text(
                       COALESCE(candidate.candidate_json#>'{content,pickLineageDeferral,promotedTransactions}','[]'::jsonb)) promoted
                      WHERE candidate.candidate_id=target_candidate
                        AND promoted.value=held.transaction_id)
$$;

-- Reconciled records the promotion writes that lack a usable status (0264): a transaction left to an
-- earlier promotion and its transfers are not written, so their status is not counted.
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
    UNION ALL SELECT status FROM outcome_external_reconciliation_pick_lineage WHERE candidate_id=target_candidate
  ) records WHERE status NOT IN ('single_source','corroborated')
$$;

-- Both promotion validators compared the proposal's transaction-date coverage against every candidate
-- transaction; they now compare against the promotable ones (the actual set and its count).
DO $migration$
DECLARE signature TEXT; definition TEXT; replaced TEXT;
 pattern CONSTANT TEXT := 'FROM outcome_external_reconciliation_transaction\s+WHERE candidate_id=NEW\.candidate_id';
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'validate_outcome_external_canonical_promotion_insert()',
  'validate_outcome_external_promotion_review_insert()'
 ] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  replaced:=regexp_replace(definition,pattern,'FROM outcome_external_candidate_promotable_transactions(NEW.candidate_id)','g');
  IF replaced=definition
  THEN RAISE EXCEPTION 'Expected the candidate transaction set in %',signature; END IF;
  EXECUTE replaced;
 END LOOP;
END $migration$;
