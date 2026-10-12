-- Reviewed pick-side issue deferral (statlyaus/Statly#869, "Mechanism for the scope decision").
-- A candidate prepared under an approved owner `reconciliation_scope` decision records its pick-side
-- issues as `deferred`. `issue_count` keeps meaning blocking issues, so every `issue_count <> 0` gate
-- below is unchanged in code and in meaning. A deferred-lineage promotion writes transactions and
-- directed assets, no custody observation or realization for a deferred pick and nothing of a draft
-- that holds a deferred selection; it is never admitted to a promotion-backed corpus.

ALTER TABLE outcome_external_reconciliation_candidate
  ADD COLUMN deferred_issue_count INTEGER NOT NULL DEFAULT 0
    CONSTRAINT outcome_external_reconciliation_deferred_issue_count_check CHECK (deferred_issue_count >= 0),
  ADD COLUMN lineage_deferral_decision_id TEXT NULL
    CONSTRAINT outcome_external_reconciliation_lineage_deferral_decision_fkey
    REFERENCES outcome_review_decision(decision_id) ON DELETE RESTRICT,
  ADD CONSTRAINT outcome_external_reconciliation_lineage_deferral_check CHECK (
    (deferred_issue_count = 0) = (lineage_deferral_decision_id IS NULL)
    AND (lineage_deferral_decision_id IS NULL
         OR lineage_deferral_decision_id ~ '^review-decision:[a-f0-9]{64}$')
    AND candidate_json#>>'{content,pickLineageDeferral,decisionId}'
        IS NOT DISTINCT FROM lineage_deferral_decision_id
  );

-- The decision must be the current approved reconciliation-scope decision for exactly the completion
-- the candidate was prepared from, decided before reconciliation.
CREATE FUNCTION validate_outcome_external_reconciliation_lineage_deferral()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE decision_row outcome_review_decision%ROWTYPE;
BEGIN
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
CREATE TRIGGER outcome_external_reconciliation_lineage_deferral_guard
BEFORE INSERT ON outcome_external_reconciliation_candidate
FOR EACH ROW EXECUTE FUNCTION validate_outcome_external_reconciliation_lineage_deferral();

-- Finalization: the stored issue_count is the blocking count and deferred_issue_count the rest.
DO $migration$
DECLARE definition TEXT;
 transition CONSTANT TEXT := $old$NEW.pick_lineage_count <> OLD.pick_lineage_count OR NEW.issue_count <> OLD.issue_count OR$old$;
 counting CONSTANT TEXT := $old$  SELECT count(*) INTO issue_count FROM outcome_external_reconciliation_issue WHERE candidate_id=NEW.candidate_id;$old$;
BEGIN
 definition:=pg_get_functiondef('finalize_outcome_external_reconciliation_candidate()'::regprocedure);
 IF (length(definition)-length(replace(definition,transition,'')))/length(transition)<>1
 THEN RAISE EXCEPTION 'Expected the exact finalization transition guard in finalize_outcome_external_reconciliation_candidate'; END IF;
 IF (length(definition)-length(replace(definition,counting,'')))/length(counting)<>1
 THEN RAISE EXCEPTION 'Expected the exact issue count in finalize_outcome_external_reconciliation_candidate'; END IF;
 definition:=replace(definition,transition,transition||$new$
     NEW.deferred_issue_count <> OLD.deferred_issue_count OR
     NEW.lineage_deferral_decision_id IS DISTINCT FROM OLD.lineage_deferral_decision_id OR$new$);
 definition:=replace(definition,counting,$new$  SELECT count(*) INTO issue_count FROM outcome_external_reconciliation_issue
   WHERE candidate_id=NEW.candidate_id AND COALESCE(issue_json->>'severity','blocking') <> 'deferred';
  IF (SELECT count(*) FROM outcome_external_reconciliation_issue
       WHERE candidate_id=NEW.candidate_id AND issue_json->>'severity'='deferred') <> NEW.deferred_issue_count THEN
    RAISE EXCEPTION 'External reconciliation deferred issue count does not reconcile';
  END IF;$new$);
 EXECUTE definition;
END $migration$;

-- The pick side a deferred candidate leaves unwritten, derived from its deferred issues alone.
CREATE FUNCTION outcome_external_candidate_deferred_drafts(target_candidate TEXT)
RETURNS TABLE (draft_year INTEGER, draft_type TEXT) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT split_part(issue.subject_key,':',2)::INTEGER, split_part(issue.subject_key,':',3)
    FROM outcome_external_reconciliation_issue issue
   WHERE issue.candidate_id=target_candidate AND issue.issue_json->>'severity'='deferred'
     AND issue.code='identity_unresolved' AND issue.subject_key LIKE 'selection:%'
$$;

CREATE FUNCTION outcome_external_candidate_deferred_transfers(target_candidate TEXT)
RETURNS TABLE (transfer_id TEXT) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT substring(issue.subject_key from length('lineage:')+1)
    FROM outcome_external_reconciliation_issue issue
   WHERE issue.candidate_id=target_candidate AND issue.issue_json->>'severity'='deferred'
     AND issue.subject_key LIKE 'lineage:%'
$$;

CREATE FUNCTION outcome_external_candidate_deferred_picks(target_candidate TEXT)
RETURNS TABLE (pick_id TEXT) LANGUAGE sql STABLE AS $$
  SELECT transfer.pick_id
    FROM outcome_external_reconciliation_transfer transfer
    JOIN outcome_external_candidate_deferred_transfers(target_candidate) deferred
      ON deferred.transfer_id=transfer.transfer_id
   WHERE transfer.candidate_id=target_candidate AND transfer.pick_id IS NOT NULL
  UNION
  SELECT split_part(substring(issue.subject_key from length('pick-custody:')+1),'|',1)
    FROM outcome_external_reconciliation_issue issue
   WHERE issue.candidate_id=target_candidate AND issue.issue_json->>'severity'='deferred'
     AND issue.subject_key LIKE 'pick-custody:%'
$$;

-- Selections a promotion of this candidate writes: none of a draft holding a deferred selection.
CREATE FUNCTION outcome_external_candidate_promotable_selections(target_candidate TEXT)
RETURNS SETOF outcome_external_reconciliation_draft_selection LANGUAGE sql STABLE AS $$
  SELECT selection.*
    FROM outcome_external_reconciliation_draft_selection selection
   WHERE selection.candidate_id=target_candidate
     AND NOT EXISTS (SELECT 1 FROM outcome_external_candidate_deferred_drafts(target_candidate) deferred
                      WHERE deferred.draft_year=selection.draft_year AND deferred.draft_type=selection.draft_type)
$$;

-- Reconciled records the promotion writes that lack a usable status. A deferred pick transfer is
-- still written as a directed asset but its unresolved status is exactly what was deferred.
CREATE FUNCTION outcome_external_candidate_unusable_record_count(target_candidate TEXT)
RETURNS INTEGER LANGUAGE sql STABLE AS $$
  SELECT count(*)::INTEGER FROM (
    SELECT status FROM outcome_external_reconciliation_transaction WHERE candidate_id=target_candidate
    UNION ALL SELECT transfer.status FROM outcome_external_reconciliation_transfer transfer
     WHERE transfer.candidate_id=target_candidate
       AND NOT EXISTS (SELECT 1 FROM outcome_external_candidate_deferred_transfers(target_candidate) deferred
                        WHERE deferred.transfer_id=transfer.transfer_id)
    UNION ALL SELECT selection.status FROM outcome_external_candidate_promotable_selections(target_candidate) selection
    UNION ALL SELECT custody.status FROM outcome_external_reconciliation_pick_custody custody
     WHERE custody.candidate_id=target_candidate
       AND NOT EXISTS (SELECT 1 FROM outcome_external_candidate_deferred_picks(target_candidate) deferred
                        WHERE deferred.pick_id=custody.pick_id)
    UNION ALL SELECT status FROM outcome_external_reconciliation_pick_lineage WHERE candidate_id=target_candidate
  ) records WHERE status NOT IN ('single_source','corroborated')
$$;

-- Both validators counted every reconciled record; they now count what the promotion writes.
DO $migration$
DECLARE signature TEXT; definition TEXT;
 old_fragment CONSTANT TEXT := $old$  SELECT count(*) INTO invalid_record_count FROM (
    SELECT status FROM outcome_external_reconciliation_transaction WHERE candidate_id=NEW.candidate_id
    UNION ALL SELECT status FROM outcome_external_reconciliation_transfer WHERE candidate_id=NEW.candidate_id
    UNION ALL SELECT status FROM outcome_external_reconciliation_draft_selection WHERE candidate_id=NEW.candidate_id
    UNION ALL SELECT status FROM outcome_external_reconciliation_pick_custody WHERE candidate_id=NEW.candidate_id
    UNION ALL SELECT status FROM outcome_external_reconciliation_pick_lineage WHERE candidate_id=NEW.candidate_id
  ) records WHERE status NOT IN ('single_source','corroborated');$old$;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'validate_outcome_external_canonical_promotion_insert()',
  'validate_outcome_external_promotion_review_insert()'
 ] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
  THEN RAISE EXCEPTION 'Expected the exact unusable-record count in %',signature; END IF;
  EXECUTE replace(definition,old_fragment,
   $new$  SELECT outcome_external_candidate_unusable_record_count(NEW.candidate_id) INTO invalid_record_count;$new$);
 END LOOP;
END $migration$;

-- Draft coverage of a deferred-lineage candidate: the metadata-only proposal (v1, or v4 with a null
-- day) must cover exactly the promotable selections, grouped by draft. Everything else delegates.
ALTER FUNCTION outcome_external_draft_sessions_exact(TEXT,JSONB)
  RENAME TO outcome_external_draft_sessions_exact_before_deferral;
CREATE FUNCTION outcome_external_draft_sessions_exact(target_candidate TEXT, proposal JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE deferred INTEGER;
BEGIN
  SELECT deferred_issue_count INTO deferred FROM outcome_external_reconciliation_candidate
   WHERE candidate_id=target_candidate;
  IF COALESCE(deferred,0)=0 THEN
    RETURN outcome_external_draft_sessions_exact_before_deferral(target_candidate,proposal);
  END IF;
  IF COALESCE(proposal->>'schemaVersion' NOT IN ('afl-trade-external-canonical-promotion-proposal/v1',
      'afl-trade-external-canonical-promotion-proposal/v4'),TRUE)
     OR proposal->>'proposedAt' IS NULL
     OR jsonb_typeof(proposal->'draftEventCoverage') IS DISTINCT FROM 'array' THEN RETURN FALSE; END IF;
  -- Retained draft_session claims need a session proposal, which the deferral does not carry.
  IF EXISTS (SELECT 1 FROM outcome_external_reconciliation_source_batch source
             JOIN outcome_external_evidence_row row USING(batch_id)
             WHERE source.candidate_id=target_candidate AND row.claim_kind='draft_session') THEN RETURN FALSE; END IF;
  RETURN NOT EXISTS (
      SELECT 1 FROM outcome_external_candidate_promotable_selections(target_candidate) selected
      WHERE 1<>(SELECT count(*) FROM jsonb_array_elements(proposal->'draftEventCoverage') c,
                  jsonb_array_elements_text(c->'selectionIds') id
                WHERE id=selected.selection_id AND (c->>'draftYear')::INTEGER=selected.draft_year
                  AND c->>'draftType'=selected.draft_type))
    AND (SELECT count(*) FROM jsonb_array_elements(proposal->'draftEventCoverage') c,
           jsonb_array_elements_text(c->'selectionIds') id)
        =(SELECT count(*) FROM outcome_external_candidate_promotable_selections(target_candidate))
    AND (SELECT count(*) FROM jsonb_array_elements(proposal->'draftEventCoverage'))
        =(SELECT count(*) FROM (SELECT DISTINCT draft_year,draft_type
            FROM outcome_external_candidate_promotable_selections(target_candidate)) drafts)
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(proposal->'draftEventCoverage') c
                    WHERE c->>'status' IS DISTINCT FROM 'complete'
                       OR (c->>'expectedSelectionCount')::INTEGER IS DISTINCT FROM jsonb_array_length(c->'selectionIds'));
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range
  THEN RETURN FALSE;
END $$;

-- Nothing deferred is ever published: a deferred-lineage promotion is refused as a corpus member and
-- left out of the complete eligible set a corpus must contain.
DO $migration$
DECLARE definition TEXT;
 membership CONSTANT TEXT := $old$     OR promotion.finalized_at>parent.knowledge_cutoff_at THEN$old$;
 eligibility CONSTANT TEXT := $old$       AND finalized_at<=NEW.knowledge_cutoff_at
  ), members AS ($old$;
BEGIN
 definition:=pg_get_functiondef('guard_outcome_promotion_backed_corpus_promotion_insert()'::regprocedure);
 IF (length(definition)-length(replace(definition,membership,'')))/length(membership)<>1
 THEN RAISE EXCEPTION 'Expected the exact membership guard in guard_outcome_promotion_backed_corpus_promotion_insert'; END IF;
 EXECUTE replace(definition,membership,$new$     OR promotion.receipt_json#>'{content,pickLineageDeferral}' IS NOT NULL$new$||E'\n'||membership);
 definition:=pg_get_functiondef('finalize_outcome_promotion_backed_corpus()'::regprocedure);
 IF (length(definition)-length(replace(definition,eligibility,'')))/length(eligibility)<>1
 THEN RAISE EXCEPTION 'Expected the exact eligible promotion set in finalize_outcome_promotion_backed_corpus'; END IF;
 EXECUTE replace(definition,eligibility,$new$       AND finalized_at<=NEW.knowledge_cutoff_at
       AND receipt_json#>'{content,pickLineageDeferral}' IS NULL
  ), members AS ($new$);
END $migration$;
