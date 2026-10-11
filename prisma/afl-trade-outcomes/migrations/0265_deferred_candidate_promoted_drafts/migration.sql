-- Deferred-lineage promotion leaves an already-promoted draft alone (statlyaus/Statly#869).
-- A candidate prepared under the pick-side deferral may carry drafts whose every selection is already
-- a current canonical selection of a finalized promotion (the session-keyed draft promotions). The
-- metadata-only promotion path keys a draft without a session, so writing those selections again
-- would create a second draft root with duplicate selections and player assets. Such a draft is
-- recorded on the candidate (`content.pickLineageDeferral.promotedDrafts`, sorted, present only when
-- non-empty); the candidate insert checks it, the promoter re-checks it, and the promotable
-- selection set every draft-coverage and record validator reads leaves it out.

-- Source selection ids that are current canonical: a draft-selection member of a finalized promotion
-- whose selection row is approved under the current (unsuperseded, approved) version of a draft event
-- of the competition. Preparation records drafts from this set; the trigger and promoter re-read it.
CREATE FUNCTION outcome_current_canonical_draft_selection_ids(target_competition TEXT)
RETURNS TABLE (selection_id TEXT) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT record.source_record_id
    FROM outcome_external_canonical_promotion_record record
    JOIN outcome_external_canonical_promotion promotion
      ON promotion.promotion_id=record.promotion_id AND promotion.status='finalized'
    JOIN outcome_draft_selection selection
      ON selection.selection_id=record.canonical_record_id AND selection.status='approved'
    JOIN outcome_event_version version ON version.event_version_id=selection.event_version_id
    JOIN outcome_event event ON event.event_id=version.event_id AND event.competition=target_competition
   WHERE record.record_kind='draft_selection'
     AND version.status='approved'
     AND NOT EXISTS (SELECT 1 FROM outcome_event_version successor
                      WHERE successor.supersedes_version_id=version.event_version_id)
$$;

-- Every draft the candidate records as already promoted names a draft it holds a selection in, and
-- every one of its selections in that draft is current canonical. NULL (absent) is valid; an empty
-- or malformed list is not.
CREATE FUNCTION outcome_external_candidate_promoted_drafts_current(candidate JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE drafts JSONB := candidate#>'{content,pickLineageDeferral,promotedDrafts}';
        competition TEXT := candidate#>>'{content,competition}';
        draft JSONB; selection_count INTEGER; promoted_count INTEGER;
BEGIN
  IF drafts IS NULL THEN RETURN TRUE; END IF;
  IF jsonb_typeof(drafts)<>'array' OR jsonb_array_length(drafts)=0 OR competition IS NULL
     OR jsonb_typeof(candidate#>'{content,draftSelections}') IS DISTINCT FROM 'array' THEN
    RETURN FALSE;
  END IF;
  FOR draft IN SELECT value FROM jsonb_array_elements(drafts) LOOP
    IF jsonb_typeof(draft->'draftYear')<>'number' OR jsonb_typeof(draft->'draftType')<>'string' THEN
      RETURN FALSE;
    END IF;
    SELECT count(*), count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM outcome_current_canonical_draft_selection_ids(competition) current
              WHERE current.selection_id=selection->>'selectionId'))
      INTO selection_count, promoted_count
      FROM jsonb_array_elements(candidate#>'{content,draftSelections}') selection
     WHERE (selection->>'draftYear')::INTEGER=(draft->>'draftYear')::INTEGER
       AND selection->>'draftType'=draft->>'draftType';
    IF selection_count=0 OR promoted_count<>selection_count THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN FALSE;
END $$;

-- The candidate insert guard (0264) also demands the recorded drafts be current, and only under the
-- deferral decision.
CREATE OR REPLACE FUNCTION validate_outcome_external_reconciliation_lineage_deferral()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE decision_row outcome_review_decision%ROWTYPE;
BEGIN
  IF NEW.candidate_json#>'{content,pickLineageDeferral,promotedDrafts}' IS NOT NULL
     AND NEW.lineage_deferral_decision_id IS NULL THEN
    RAISE EXCEPTION 'Already-promoted drafts are recorded only under the pick-side deferral decision';
  END IF;
  IF NOT outcome_external_candidate_promoted_drafts_current(NEW.candidate_json) THEN
    RAISE EXCEPTION 'Every draft a deferred candidate leaves to an earlier promotion must be current canonical in full';
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

-- Selections a promotion of this candidate writes: none of a draft holding a deferred selection
-- (0264) and none of a draft the candidate leaves to an earlier promotion. Read by
-- outcome_external_draft_sessions_exact and outcome_external_candidate_unusable_record_count.
CREATE OR REPLACE FUNCTION outcome_external_candidate_promotable_selections(target_candidate TEXT)
RETURNS SETOF outcome_external_reconciliation_draft_selection LANGUAGE sql STABLE AS $$
  SELECT selection.*
    FROM outcome_external_reconciliation_draft_selection selection
   WHERE selection.candidate_id=target_candidate
     AND NOT EXISTS (SELECT 1 FROM outcome_external_candidate_deferred_drafts(target_candidate) deferred
                      WHERE deferred.draft_year=selection.draft_year AND deferred.draft_type=selection.draft_type)
     AND NOT EXISTS (SELECT 1 FROM outcome_external_reconciliation_candidate candidate
                     CROSS JOIN LATERAL jsonb_array_elements(
                       COALESCE(candidate.candidate_json#>'{content,pickLineageDeferral,promotedDrafts}','[]'::jsonb)) promoted
                      WHERE candidate.candidate_id=target_candidate
                        AND (promoted->>'draftYear')::INTEGER=selection.draft_year
                        AND promoted->>'draftType'=selection.draft_type)
$$;
