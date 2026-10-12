-- Repairing promoted pick identity (statlyaus/Statly#853, docs/architecture/afl-draft-pick-identity-rules.md).
-- A deferred candidate prepared after the identity rules may hold a trade an earlier promotion made
-- current canonical under pick ids the rules have since changed. 0267 counted such a trade as already
-- promoted when its transfer ids were promoted, so a promotion would write nothing and leave the old
-- ids current. From here a transaction counts as already promoted only when every candidate pick
-- transfer also carries the pick id of its promoted asset; any other is written as a superseding
-- trade version. That promotion then cites custody observations an earlier promotion already wrote:
-- a custody id addresses its evidence, so writing it again collides with the first row's import row
-- and recorded time. A usable candidate custody row whose id is already a canonical custody
-- observation of a finalized promotion with the candidate row's facts is recorded on the candidate
-- (`content.pickLineageDeferral.promotedCustodyIds`, sorted unique, present only when non-empty);
-- the candidate insert checks it, the promoter re-checks it, nothing is written for it, and the
-- unusable-record count ignores it. Same shape as 0267 and 0268.

-- The canonical draft kind a candidate draft type is promoted as (the promoter's mapping).
CREATE FUNCTION outcome_external_draft_type_kind(draft_type TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE regexp_replace(lower(btrim(draft_type)),'[[:space:]-]+','_','g')
    WHEN 'national' THEN 'national_draft' WHEN 'national_draft' THEN 'national_draft'
    WHEN 'preseason' THEN 'preseason_draft' WHEN 'pre_season' THEN 'preseason_draft'
    WHEN 'preseason_draft' THEN 'preseason_draft'
    WHEN 'rookie' THEN 'rookie_draft' WHEN 'rookie_draft' THEN 'rookie_draft'
    WHEN 'midseason' THEN 'midseason_draft' WHEN 'mid_season' THEN 'midseason_draft'
    WHEN 'midseason_draft' THEN 'midseason_draft'
    WHEN 'mini_draft' THEN 'supplemental_selection'
    WHEN 'supplemental_selection' THEN 'supplemental_selection'
  END
$$;

-- The pick id of every promoted asset on a current canonical trade version, by source transaction
-- and transfer: the same current versions as `outcome_current_canonical_transactions` (0267).
CREATE FUNCTION outcome_current_canonical_transaction_picks(target_competition TEXT)
RETURNS TABLE (transaction_id TEXT, transfer_id TEXT, pick_id TEXT) LANGUAGE sql STABLE AS $$
  SELECT record.source_record_id, transfer.source_record_id, asset.pick_id
    FROM outcome_external_canonical_promotion_record record
    JOIN outcome_external_canonical_promotion promotion
      ON promotion.promotion_id=record.promotion_id AND promotion.status='finalized'
    JOIN outcome_event_version version
      ON version.event_version_id=record.canonical_record_id AND version.status='approved'
     AND version.event_id=record.source_record_id
    JOIN outcome_event event ON event.event_id=version.event_id AND event.competition=target_competition
    JOIN outcome_external_canonical_promotion_record transfer
      ON transfer.promotion_id=record.promotion_id AND transfer.record_kind='transfer'
    JOIN outcome_event_asset asset
      ON asset.asset_version_id=transfer.canonical_record_id
     AND asset.event_version_id=version.event_version_id AND asset.status='approved'
   WHERE record.record_kind='transaction' AND asset.pick_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM outcome_event_version successor
                      WHERE successor.supersedes_version_id=version.event_version_id)
$$;

-- Current canonical trade events whose current version came from a promotion of reviewed pick
-- lineage: the promoted candidate carried a reviewed correction or a reviewed scope. A reviewer
-- settled those pick ids, so reconciliation's ids do not supersede them.
CREATE FUNCTION outcome_current_canonical_reviewed_lineage_transactions(target_competition TEXT)
RETURNS TABLE (transaction_id TEXT) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT record.source_record_id
    FROM outcome_external_canonical_promotion_record record
    JOIN outcome_external_canonical_promotion promotion
      ON promotion.promotion_id=record.promotion_id AND promotion.status='finalized'
    JOIN outcome_external_reconciliation_candidate candidate
      ON candidate.candidate_id=promotion.candidate_id
    JOIN outcome_event_version version
      ON version.event_version_id=record.canonical_record_id AND version.status='approved'
     AND version.event_id=record.source_record_id
    JOIN outcome_event event ON event.event_id=version.event_id AND event.competition=target_competition
   WHERE record.record_kind='transaction'
     AND (candidate.candidate_json#>'{content,reviewedCorrection}' IS NOT NULL
          OR candidate.candidate_json#>'{content,reviewedScope}' IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM outcome_event_version successor
                      WHERE successor.supersedes_version_id=version.event_version_id)
$$;

-- Every transaction the candidate records as already promoted is one it holds, is current canonical,
-- has every one of its candidate transfers promoted on that version, and every candidate pick
-- transfer among them carries its promoted asset's pick id. NULL (absent) is valid; an empty or
-- malformed list is not.
CREATE OR REPLACE FUNCTION outcome_external_candidate_promoted_transactions_current(candidate JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE ids JSONB := candidate#>'{content,pickLineageDeferral,promotedTransactions}';
        competition TEXT := candidate#>>'{content,competition}';
        moved_by_id JSONB;
        id JSONB; held JSONB; promoted TEXT[];
BEGIN
  IF ids IS NULL THEN RETURN TRUE; END IF;
  IF jsonb_typeof(ids)<>'array' OR jsonb_array_length(ids)=0 OR competition IS NULL
     OR jsonb_typeof(candidate#>'{content,transactions}') IS DISTINCT FROM 'array'
     OR jsonb_typeof(candidate#>'{content,transfers}') IS DISTINCT FROM 'array' THEN
    RETURN FALSE;
  END IF;
  SELECT COALESCE(jsonb_object_agg(value->>'transferId',value),'{}'::jsonb) INTO moved_by_id
    FROM jsonb_array_elements(candidate#>'{content,transfers}') value
   WHERE value->>'transferId' IS NOT NULL;
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
    IF NOT EXISTS (SELECT 1 FROM outcome_current_canonical_reviewed_lineage_transactions(competition) reviewed
                    WHERE reviewed.transaction_id=id#>>'{}') AND EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(held->'transferIds') transfer
          WHERE (moved_by_id->transfer.value) IS NULL
             OR ((moved_by_id->transfer.value)#>>'{asset,kind}'='pick_entitlement'
                 AND NOT EXISTS (
                   SELECT 1 FROM outcome_current_canonical_transaction_picks(competition) picked
                    WHERE picked.transaction_id=id#>>'{}' AND picked.transfer_id=transfer.value
                      AND picked.pick_id=(moved_by_id->transfer.value)#>>'{asset,pickId}'))) THEN
      RETURN FALSE;
    END IF;
  END LOOP;
  RETURN TRUE;
END $$;

-- Custody observations canonical under a finalized promotion, with the facts a candidate custody row
-- is compared on. A custody observation has no successor version, so canonical is current.
CREATE FUNCTION outcome_current_canonical_pick_custody(target_competition TEXT)
RETURNS TABLE (custody_id TEXT, pick_id TEXT, observed_at TIMESTAMPTZ, observed_date JSONB,
               draft_season_year INTEGER, draft_kind TEXT, recorded_round INTEGER,
               recorded_pick INTEGER, original_club_id TEXT, current_club_id TEXT,
               predecessor_custody_id TEXT)
LANGUAGE sql STABLE AS $$
  SELECT custody.custody_observation_id, custody.pick_id, custody.observed_at, custody.observed_date,
         custody.draft_season_year, custody.draft_kind::TEXT, custody.recorded_round,
         custody.recorded_pick, custody.original_club_id, custody.current_club_id,
         custody.predecessor_custody_id
    FROM outcome_pick_custody_observation custody
   WHERE custody.status='approved'
     AND EXISTS (SELECT 1 FROM outcome_external_canonical_promotion_record record
                 JOIN outcome_external_canonical_promotion promotion
                   ON promotion.promotion_id=record.promotion_id AND promotion.status='finalized'
                  AND promotion.competition=target_competition
                WHERE record.record_kind='pick_custody'
                  AND record.canonical_record_id=custody.custody_observation_id)
$$;

-- Every custody id the candidate records as already promoted is a usable candidate custody row whose
-- pick, observation date, draft, recorded round and pick, original and current club and predecessor
-- equal a canonical custody observation's. NULL (absent) is valid; an empty or malformed list is not.
CREATE FUNCTION outcome_external_candidate_promoted_custody_current(candidate JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE ids JSONB := candidate#>'{content,pickLineageDeferral,promotedCustodyIds}';
        competition TEXT := candidate#>>'{content,competition}';
        id JSONB; held JSONB;
BEGIN
  IF ids IS NULL THEN RETURN TRUE; END IF;
  IF jsonb_typeof(ids)<>'array' OR jsonb_array_length(ids)=0 OR competition IS NULL
     OR jsonb_typeof(candidate#>'{content,pickCustody}') IS DISTINCT FROM 'array' THEN
    RETURN FALSE;
  END IF;
  FOR id IN SELECT value FROM jsonb_array_elements(ids) LOOP
    IF jsonb_typeof(id)<>'string' THEN RETURN FALSE; END IF;
    SELECT value INTO held FROM jsonb_array_elements(candidate#>'{content,pickCustody}') value
     WHERE value->>'custodyId'=id#>>'{}' LIMIT 1;
    IF held IS NULL OR COALESCE(held->>'status' NOT IN ('single_source','corroborated'),TRUE)
       OR NOT EXISTS (
         SELECT 1 FROM outcome_current_canonical_pick_custody(competition) current
          WHERE current.custody_id=id#>>'{}'
            AND current.pick_id=held->>'pickId'
            AND (CASE jsonb_typeof(held->'observedAt')
                   WHEN 'string' THEN current.observed_date IS NULL
                     AND current.observed_at=(held->>'observedAt')::TIMESTAMPTZ(3)
                   WHEN 'object' THEN current.observed_at IS NULL
                     AND current.observed_date=held->'observedAt'
                   ELSE FALSE END)
            AND current.draft_season_year=(held->>'draftYear')::INTEGER
            AND current.draft_kind=outcome_external_draft_type_kind(held->>'draftType')
            AND current.recorded_round IS NOT DISTINCT FROM (held->>'roundNumber')::INTEGER
            AND current.recorded_pick IS NOT DISTINCT FROM (held->>'recordedPickNumber')::INTEGER
            AND current.original_club_id IS NOT DISTINCT FROM held->>'originalClubId'
            AND current.current_club_id=held->>'currentClubId'
            AND current.predecessor_custody_id IS NOT DISTINCT FROM held->>'predecessorCustodyId') THEN
      RETURN FALSE;
    END IF;
  END LOOP;
  RETURN TRUE;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow
  OR numeric_value_out_of_range THEN RETURN FALSE;
END $$;

-- The candidate insert guard (0264, 0265, 0267, 0268) also demands the already-promoted custody be
-- canonical with the candidate's facts, and only under the deferral decision.
CREATE OR REPLACE FUNCTION validate_outcome_external_reconciliation_lineage_deferral()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE decision_row outcome_review_decision%ROWTYPE;
BEGIN
  IF (NEW.candidate_json#>'{content,pickLineageDeferral,promotedDrafts}' IS NOT NULL
      OR NEW.candidate_json#>'{content,pickLineageDeferral,promotedTransactions}' IS NOT NULL
      OR NEW.candidate_json#>'{content,pickLineageDeferral,deferredCustodyIds}' IS NOT NULL
      OR NEW.candidate_json#>'{content,pickLineageDeferral,promotedCustodyIds}' IS NOT NULL)
     AND NEW.lineage_deferral_decision_id IS NULL THEN
    RAISE EXCEPTION 'Already-promoted drafts, transactions and custody and deferred custody are recorded only under the pick-side deferral decision';
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
  IF NOT outcome_external_candidate_promoted_custody_current(NEW.candidate_json) THEN
    RAISE EXCEPTION 'Every custody observation a deferred candidate leaves to an earlier promotion must be canonical with the candidate''s facts';
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

-- Reconciled records the promotion writes that lack a usable status (0264, 0267, 0268): custody left
-- to an earlier promotion is not written, so its status is not counted.
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
                         COALESCE(candidate.candidate_json#>'{content,pickLineageDeferral,deferredCustodyIds}','[]'::jsonb)
                         || COALESCE(candidate.candidate_json#>'{content,pickLineageDeferral,promotedCustodyIds}','[]'::jsonb)) unwritten
                        WHERE candidate.candidate_id=target_candidate AND unwritten.value=custody.custody_id)
    UNION ALL SELECT status FROM outcome_external_reconciliation_pick_lineage WHERE candidate_id=target_candidate
  ) records WHERE status NOT IN ('single_source','corroborated')
$$;
