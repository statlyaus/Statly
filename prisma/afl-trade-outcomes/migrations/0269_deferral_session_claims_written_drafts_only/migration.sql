-- Retained draft_session claims refuse a deferred-lineage proposal only for a draft the candidate
-- writes (statlyaus/Statly#869). 0264's deferral branch of outcome_external_draft_sessions_exact
-- returned FALSE on any draft_session claim in the candidate's source batches, because the
-- metadata-only proposal carries no session. A deferred candidate whose drafts are all left to their
-- earlier promotions (promotedDrafts) or deferred (a deferred selection) writes no draft, so a
-- retained session claim for such a draft has nothing to prove: the check now refuses only when the
-- claim's draft is one with promotable selections. With no promotable selections and an empty
-- draftEventCoverage the session check passes. The non-deferral branch is untouched.
CREATE OR REPLACE FUNCTION outcome_external_draft_sessions_exact(target_candidate TEXT, proposal JSONB)
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
  -- A retained draft_session claim needs a session proposal only for a draft this candidate writes.
  IF EXISTS (SELECT 1 FROM outcome_external_reconciliation_source_batch source
             JOIN outcome_external_evidence_row row USING(batch_id)
             WHERE source.candidate_id=target_candidate AND row.claim_kind='draft_session'
               AND EXISTS (SELECT 1 FROM outcome_external_candidate_promotable_selections(target_candidate) written
                            WHERE written.draft_year=(row.evidence_json#>>'{content,claim,draftYear}')::INTEGER
                              AND written.draft_type=row.evidence_json#>>'{content,claim,draftType}')) THEN
    RETURN FALSE;
  END IF;
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
