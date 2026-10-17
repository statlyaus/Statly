-- A completion with no pick-side issue can still re-sync a re-targeted draftee (statlyaus/Statly#853,
-- docs/architecture/afl-draft-pick-identity-rules.md, "Repairing promoted draftees").
-- The 2018 completion has no pick-side issue. Prepared under its approved deferral decision it gave a
-- candidate that deferred nothing, and the reconciler then dropped the decision with every list it
-- carries (0264: `(deferred_issue_count = 0) = (lineage_deferral_decision_id IS NULL)`). So the 2018
-- national draft, whose 20 draftees the identity repair re-targeted to their AFL Tables twins, had no
-- `resyncedSelectionIds` and nothing could re-promote those slots.
--
-- A candidate that deferred no issue now keeps the decision when it lists something (already-promoted
-- drafts, transactions or custody, re-synced selections or deferred custody) and writes no draft
-- whole: every draft it holds is recorded as already promoted or holds a re-synced selection. A
-- deferred candidate promotes through the metadata-only (v1 or v4) proposal, which carries no session
-- proof, so a draft with nothing deferred is never written under the decision. Such a candidate is
-- prepared without it, as before. Candidates that deferred an issue are unchanged.
--
-- 1. The candidate check allows the decision with no deferred issue; a deferred issue still needs it.
-- 2. The candidate insert guard (0278) also demands, for a decision with no deferred issue, the rule
--    above (`outcome_external_candidate_issueless_deferral_kept`).
-- 3. `outcome_external_draft_sessions_exact` takes its deferred branch for every candidate carrying
--    the decision, not only one with deferred issues. Before this migration the two were the same set
--    (the 0264 check), so every existing candidate takes the branch it took. For a decision with no
--    deferred issue the branch also refuses a proposal while the candidate has a promotable selection.
-- 4. `outcome_external_promoted_session_resync_version` (0280) skips the candidate-wide re-check for
--    every candidate carrying the decision. Soundness is 0280's argument unchanged: the branch the
--    insert guard took is chosen by `lineage_deferral_decision_id`, a column of the finalized
--    candidate that its finalization guard keeps fixed, and the branch reads only the proposal and
--    candidate facts (the candidate row, its reconciled selections, issues and source batches, and
--    those batches' evidence rows), none of which can change once the promotion exists. The added
--    promotable-selection test reads the same facts. So the value the insert guard checked is still
--    TRUE whenever this function runs.

-- 1. A deferred issue needs the decision; the decision no longer needs a deferred issue.
ALTER TABLE outcome_external_reconciliation_candidate
  DROP CONSTRAINT outcome_external_reconciliation_lineage_deferral_check,
  ADD CONSTRAINT outcome_external_reconciliation_lineage_deferral_check CHECK (
    (deferred_issue_count = 0 OR lineage_deferral_decision_id IS NOT NULL)
    AND (lineage_deferral_decision_id IS NULL
         OR lineage_deferral_decision_id ~ '^review-decision:[a-f0-9]{64}$')
    AND candidate_json#>>'{content,pickLineageDeferral,decisionId}'
        IS NOT DISTINCT FROM lineage_deferral_decision_id
  );

-- Whether a deferral that deferred no issue may be carried: it lists something, and every draft the
-- candidate holds is recorded as already promoted or holds a re-synced selection
-- (`aflTradeIssuelessDeferralKept`). A malformed document is FALSE.
CREATE FUNCTION outcome_external_candidate_issueless_deferral_kept(candidate JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE deferral JSONB := candidate#>'{content,pickLineageDeferral}';
        selections JSONB := candidate#>'{content,draftSelections}';
BEGIN
  IF jsonb_typeof(deferral) IS DISTINCT FROM 'object'
     OR jsonb_typeof(selections) IS DISTINCT FROM 'array' THEN
    RETURN FALSE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY['promotedDrafts','resyncedSelectionIds','promotedTransactions',
                               'deferredCustodyIds','promotedCustodyIds']) list(name)
     WHERE jsonb_typeof(deferral->list.name)='array' AND jsonb_array_length(deferral->list.name)>0)
  THEN
    RETURN FALSE;
  END IF;
  RETURN NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(selections) held
     WHERE NOT EXISTS (
             SELECT 1 FROM jsonb_array_elements(COALESCE(deferral->'promotedDrafts','[]'::jsonb)) promoted
              WHERE promoted->'draftYear'=held->'draftYear' AND promoted->'draftType'=held->'draftType')
       AND NOT EXISTS (
             SELECT 1 FROM jsonb_array_elements(selections) resynced
              WHERE COALESCE(deferral->'resyncedSelectionIds','[]'::jsonb) ? (resynced->>'selectionId')
                AND resynced->'draftYear'=held->'draftYear' AND resynced->'draftType'=held->'draftType'));
END $$;

-- 2. The candidate insert guard (0278), with the rule for a decision that deferred no issue.
CREATE OR REPLACE FUNCTION validate_outcome_external_reconciliation_lineage_deferral()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE decision_row outcome_review_decision%ROWTYPE;
BEGIN
  IF (NEW.candidate_json#>'{content,pickLineageDeferral,promotedDrafts}' IS NOT NULL
      OR NEW.candidate_json#>'{content,pickLineageDeferral,resyncedSelectionIds}' IS NOT NULL
      OR NEW.candidate_json#>'{content,pickLineageDeferral,promotedTransactions}' IS NOT NULL
      OR NEW.candidate_json#>'{content,pickLineageDeferral,deferredCustodyIds}' IS NOT NULL
      OR NEW.candidate_json#>'{content,pickLineageDeferral,promotedCustodyIds}' IS NOT NULL)
     AND NEW.lineage_deferral_decision_id IS NULL THEN
    RAISE EXCEPTION 'Already-promoted drafts, transactions and custody, re-synced selections and deferred custody are recorded only under the pick-side deferral decision';
  END IF;
  IF NEW.lineage_deferral_decision_id IS NOT NULL AND NEW.deferred_issue_count=0
     AND NOT outcome_external_candidate_issueless_deferral_kept(NEW.candidate_json) THEN
    RAISE EXCEPTION 'A pick-side deferral decision with no deferred issue is carried only by a candidate that lists already-promoted or re-synced records and writes no draft whole';
  END IF;
  IF NOT outcome_external_candidate_promoted_drafts_current(NEW.candidate_json) THEN
    RAISE EXCEPTION 'Every draft a deferred candidate leaves to an earlier promotion must be current canonical in full under the candidate''s players';
  END IF;
  IF NOT outcome_external_candidate_resynced_selections_current(NEW.candidate_json) THEN
    RAISE EXCEPTION 'Every re-synced selection must be current canonical once under another player, in a draft otherwise current under the candidate''s players';
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

-- 3. Draft coverage (0278): the deferred branch is chosen by the decision. A decision that deferred
-- no issue writes no draft whole, so its proposal is refused while a promotable selection exists.
-- Otherwise the branch is 0278's, word for word.
CREATE OR REPLACE FUNCTION outcome_external_draft_sessions_exact(target_candidate TEXT, proposal JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE deferral TEXT; deferred INTEGER;
BEGIN
  SELECT lineage_deferral_decision_id, deferred_issue_count INTO deferral, deferred
    FROM outcome_external_reconciliation_candidate
   WHERE candidate_id=target_candidate;
  IF deferral IS NULL THEN
    RETURN outcome_external_draft_sessions_exact_before_deferral(target_candidate,proposal);
  END IF;
  IF deferred=0 AND EXISTS (
       SELECT 1 FROM outcome_external_candidate_promotable_selections(target_candidate)) THEN
    RETURN FALSE;
  END IF;
  IF COALESCE(proposal->>'schemaVersion' NOT IN ('afl-trade-external-canonical-promotion-proposal/v1',
      'afl-trade-external-canonical-promotion-proposal/v4'),TRUE)
     OR proposal->>'proposedAt' IS NULL
     OR jsonb_typeof(proposal->'draftEventCoverage') IS DISTINCT FROM 'array' THEN RETURN FALSE; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(proposal->'draftEventCoverage') c
              WHERE jsonb_typeof(c)<>'object'
                 OR (c ? 'kind' AND c->>'kind' IS DISTINCT FROM 'promoted_session_resync')) THEN
    RETURN FALSE;
  END IF;
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
                WHERE NOT c ? 'kind'
                  AND id=selected.selection_id AND (c->>'draftYear')::INTEGER=selected.draft_year
                  AND c->>'draftType'=selected.draft_type))
    AND (SELECT count(*) FROM jsonb_array_elements(proposal->'draftEventCoverage') c,
           jsonb_array_elements_text(c->'selectionIds') id WHERE NOT c ? 'kind')
        =(SELECT count(*) FROM outcome_external_candidate_promotable_selections(target_candidate))
    AND (SELECT count(*) FROM jsonb_array_elements(proposal->'draftEventCoverage') c WHERE NOT c ? 'kind')
        =(SELECT count(*) FROM (SELECT DISTINCT draft_year,draft_type
            FROM outcome_external_candidate_promotable_selections(target_candidate)) drafts)
    AND NOT EXISTS (
      SELECT 1 FROM outcome_external_candidate_resynced_selections(target_candidate) selected
      WHERE 1<>(SELECT count(*) FROM jsonb_array_elements(proposal->'draftEventCoverage') c,
                  jsonb_array_elements_text(c->'selectionIds') id
                WHERE c->>'kind'='promoted_session_resync'
                  AND id=selected.selection_id AND (c->>'draftYear')::INTEGER=selected.draft_year
                  AND c->>'draftType'=selected.draft_type))
    AND (SELECT count(*) FROM jsonb_array_elements(proposal->'draftEventCoverage') c,
           jsonb_array_elements_text(c->'selectionIds') id WHERE c->>'kind'='promoted_session_resync')
        =(SELECT count(*) FROM outcome_external_candidate_resynced_selections(target_candidate))
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(proposal->'draftEventCoverage') c
                    WHERE c->>'kind'='promoted_session_resync'
                      AND (jsonb_typeof(c->'supersedesVersionId') IS DISTINCT FROM 'string'
                           OR jsonb_array_length(c->'selectionIds')=0))
    AND (SELECT count(*) FROM jsonb_array_elements(proposal->'draftEventCoverage') c
          WHERE c->>'kind'='promoted_session_resync')
        =(SELECT count(DISTINCT c->>'supersedesVersionId') FROM jsonb_array_elements(proposal->'draftEventCoverage') c
          WHERE c->>'kind'='promoted_session_resync')
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(proposal->'draftEventCoverage') c
                    WHERE c->>'status' IS DISTINCT FROM 'complete'
                       OR (c->>'expectedSelectionCount')::INTEGER IS DISTINCT FROM jsonb_array_length(c->'selectionIds'));
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range
  THEN RETURN FALSE;
END $$;

-- 4. The re-sync version test (0280): the candidate-wide re-check is skipped for every candidate
-- carrying the decision, the same set for which the insert guard took the deferred branch.
CREATE OR REPLACE FUNCTION outcome_external_promoted_session_resync_version(target_promotion TEXT, target_event_version TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM outcome_external_canonical_promotion promotion
    JOIN outcome_external_reconciliation_candidate candidate ON candidate.candidate_id=promotion.candidate_id
    JOIN outcome_external_canonical_promotion_record member ON member.promotion_id=promotion.promotion_id
    JOIN outcome_event_version version ON version.event_version_id=member.canonical_record_id
    JOIN outcome_event root ON root.event_id=version.event_id
    WHERE promotion.promotion_id=target_promotion AND promotion.status='finalized'
      AND promotion.proposal_json#>>'{content,schemaVersion}' IN (
        'afl-trade-external-canonical-promotion-proposal/v1',
        'afl-trade-external-canonical-promotion-proposal/v4')
      AND member.record_kind='draft_event' AND member.canonical_record_id=target_event_version
      AND member.source_import_row_id=version.source_import_row_id
      AND member.record_json->>'kind'='promoted_session_resync'
      AND member.record_json->>'supersedesVersionId'=version.supersedes_version_id
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(promotion.proposal_json#>'{content,draftEventCoverage}') coverage
                   WHERE coverage=member.record_json)
      AND root.stable_key LIKE 'external-draft:%:session:%'
      AND version.status='approved'
      AND (candidate.lineage_deferral_decision_id IS NOT NULL
           OR outcome_external_draft_sessions_exact(promotion.candidate_id,promotion.proposal_json->'content')))
$$;
