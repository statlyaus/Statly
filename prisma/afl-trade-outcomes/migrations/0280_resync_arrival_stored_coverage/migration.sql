-- A re-synced draftee's arrival check reads its promotion's stored coverage, not a candidate-wide
-- re-validation (statlyaus/Statly#853, docs/architecture/afl-draft-pick-identity-rules.md,
-- "Repairing promoted draftees"). On a copy of the grading database (2026-10-14) one reviewed v4
-- arrival check for a draftee of the 73-slot re-sync promotion took 9 min 38 s. Nearly all of it was
-- the call to `outcome_external_draft_sessions_exact` in `outcome_external_promoted_session_resync_version`
-- (0278): `outcome_external_candidate_promotable_selections` took 3 min 12 s per call and returned no
-- rows, and `outcome_external_candidate_resynced_selections` 11 s. Both read a list out of the
-- candidate's 2.2 MB `candidate_json` once per reconciled selection (443 of them), and the planner
-- re-ran the resynced-selection side once per outer selection. An arrival check runs per spell, in
-- the registration trigger and in every registration-currency pass, so 44 spells cost about 7 hours.
--
-- 1. `outcome_external_promoted_session_resync_version` no longer re-runs the candidate-wide check
--    for a deferred candidate. Soundness: it adds nothing there. Every promotion row passed
--    `validate_outcome_external_canonical_promotion_insert`, which raises unless
--    `outcome_external_draft_sessions_exact(candidate_id, proposal_json->'content')` holds. For a
--    candidate with `deferred_issue_count <> 0` that function takes its deferred branch (0264, 0269,
--    0278), which reads only the proposal and candidate facts, as 0278 says: the candidate row's
--    `deferred_issue_count` and `candidate_json`, its reconciled selections, issues and source
--    batches, and those batches' evidence rows. None of them can change once the promotion exists.
--    The promotion needs a finalized candidate. A finalized candidate cannot be updated (its
--    finalization guard demands `OLD.status = 'open'` and an unchanged `candidate_json` and counts)
--    or deleted. Reconciled children are append-only and are inserted only under an open candidate.
--    Evidence rows are append-only and are inserted only under an open batch, and finalizing a
--    candidate needs every source batch finalized. The promotion's `candidate_id` and `proposal_json`
--    are fixed by its finalization guard, and it cannot be deleted. So the value the insert guard
--    checked is still TRUE whenever this function runs, and the check is dropped for a deferred
--    candidate. Every other condition is unchanged: the promotion is finalized with a v1 or v4
--    proposal, the version is a `promoted_session_resync` member stored as one of that proposal's
--    coverage entries, it supersedes the version that entry names, and it is approved on a
--    session-keyed root. A candidate with nothing deferred keeps the call. It never re-syncs, since
--    `resyncedSelectionIds` exists only under the deferral decision. This holds while the deferred
--    branch keeps the definition it has had since 0278, the only one under which a re-sync
--    promotion has been admitted. A migration that tightens that branch must re-check existing
--    deferred promotions explicitly. Arrival checks no longer re-run it.
-- 2. `outcome_external_candidate_resynced_selections` and
--    `outcome_external_candidate_promotable_selections` read the candidate's lists once, through a
--    materialized CTE. They return the same rows. This also speeds up the review and promotion
--    guards, the promoter's replay check and the unusable-record count. The copy took 0.1 s for
--    each, against 11 s and 3 min 12 s before.

-- The candidate selections recorded as re-synced, as stored reconciliation rows (0278). The id list
-- is read from `candidate_json` once.
CREATE OR REPLACE FUNCTION outcome_external_candidate_resynced_selections(target_candidate TEXT)
RETURNS SETOF outcome_external_reconciliation_draft_selection LANGUAGE sql STABLE AS $$
  WITH listed AS MATERIALIZED (
    SELECT COALESCE(candidate.candidate_json#>'{content,pickLineageDeferral,resyncedSelectionIds}','[]'::jsonb) AS ids
      FROM outcome_external_reconciliation_candidate candidate
     WHERE candidate.candidate_id=target_candidate
  )
  SELECT selection.*
    FROM outcome_external_reconciliation_draft_selection selection
    JOIN listed ON listed.ids ? selection.selection_id
   WHERE selection.candidate_id=target_candidate
$$;

-- Selections a promotion of this candidate writes as a draft (0278): none of a draft holding a
-- deferred selection, none of a draft left to an earlier promotion and none of a draft holding a
-- re-synced selection. Each excluded draft set is computed once.
CREATE OR REPLACE FUNCTION outcome_external_candidate_promotable_selections(target_candidate TEXT)
RETURNS SETOF outcome_external_reconciliation_draft_selection LANGUAGE sql STABLE AS $$
  WITH deferred AS MATERIALIZED (
    SELECT draft_year, draft_type FROM outcome_external_candidate_deferred_drafts(target_candidate)
  ), promoted AS MATERIALIZED (
    SELECT (promoted->>'draftYear')::INTEGER AS draft_year, promoted->>'draftType' AS draft_type
      FROM outcome_external_reconciliation_candidate candidate
     CROSS JOIN LATERAL jsonb_array_elements(
       COALESCE(candidate.candidate_json#>'{content,pickLineageDeferral,promotedDrafts}','[]'::jsonb)) promoted
     WHERE candidate.candidate_id=target_candidate
  ), resynced AS MATERIALIZED (
    SELECT DISTINCT draft_year, draft_type FROM outcome_external_candidate_resynced_selections(target_candidate)
  )
  SELECT selection.*
    FROM outcome_external_reconciliation_draft_selection selection
   WHERE selection.candidate_id=target_candidate
     AND NOT EXISTS (SELECT 1 FROM deferred
                      WHERE deferred.draft_year=selection.draft_year AND deferred.draft_type=selection.draft_type)
     AND NOT EXISTS (SELECT 1 FROM promoted
                      WHERE promoted.draft_year=selection.draft_year AND promoted.draft_type=selection.draft_type)
     AND NOT EXISTS (SELECT 1 FROM resynced
                      WHERE resynced.draft_year=selection.draft_year AND resynced.draft_type=selection.draft_type)
$$;

-- Whether an event version is the re-sync version of a finalized deferred promotion: written for a
-- `promoted_session_resync` coverage entry of its exact proposal, superseding the version that entry
-- names, on a session-keyed draft root. The exact candidate coverage was proven when the promotion
-- was inserted, from facts that cannot change since. It is re-checked only for a candidate with
-- nothing deferred.
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
      AND (candidate.deferred_issue_count<>0
           OR outcome_external_draft_sessions_exact(promotion.candidate_id,promotion.proposal_json->'content')))
$$;
