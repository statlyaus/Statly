-- Re-keying a promoted draft selection's number-only pick id to its reviewed custody pick
-- (statlyaus/Statly#853, docs/architecture/afl-draft-pick-identity-rules.md, "Repairing promoted
-- draftees"). Measured read-only on the grading database (2026-10-15): 239 of 383 current canonical
-- 2019 to 2024 national selections carry another pick id than candidate
-- `external-reconciliation:24d83046…`. Every one of the 239 is a number-only address (draft year,
-- type and pick number, no round): those rows were promoted before the pick-identity rules (0273).
-- For 182 of them the candidate names a pick with a usable custody observation (for example 2020
-- #13, Tom Powell: number-only `draft-pick:93490e63…`, while the pick is Melbourne's 2020 round-1
-- entitlement held by North Melbourne, `draft-pick:ce2122fa…`). The other 57 are unresolved on the
-- pick side and keep their promoted id. No reviewed path changed a promoted selection's pick: a draft
-- whose selections are all current under the candidate's players is left whole (`promotedDrafts`
-- compares players, not picks), a re-sync keeps the promoted pick (0279), and a reviewed session
-- correction conserves every selection fact except evidence (0177).
--
-- A deferred candidate now records such slots as `pickLineageDeferral.rekeyedSelectionIds`, and the
-- promotion re-promotes them exactly as it re-syncs a re-targeted draftee (0278): one scoped later
-- version of each session root carrying only the changed slots, under a `promoted_session_resync`
-- coverage entry. A slot may change its player (re-synced), its pick (re-keyed) or both. A re-keyed
-- slot keeps its player and club and takes the candidate's pick id, and only when:
--   - the candidate selection is `single_source` or `corroborated`, with a player and club;
--   - its source selection is current canonical exactly once, at its number, under its own player
--     (or under another player when it is also re-synced) and its club;
--   - that current row's pick id is the slot's number-only address, never an entitlement, custody,
--     eventual-selection or reviewed id, and differs from the candidate's;
--   - the candidate's pick has a usable custody row, and no deferred issue defers that pick;
--   - no other current canonical selection carries the candidate's pick, and no other re-keyed slot
--     of the candidate takes it (pick-identity rule 4);
--   - no special-entitlement exercise or selection claim cites the current row: re-versioning it
--     would void that reviewed record;
--   - the draft is not recorded as already promoted, and every other candidate selection in it is
--     current under its own player.
-- The asset-scoped supersession rule (0256) still bounds each re-sync version: it must retire no
-- slot it does not carry, so it carries fewer than half of each version's other slots. Preparation
-- chooses the re-keyed slots of each root deterministically (by selection number) within that bound;
-- the rest are re-keyed by the next preparation once the first promotion lands.
--
-- 1. `outcome_external_selection_number_only_pick_ids`: the number-only addresses of a candidate
--    selection, with its round and with none.
-- 2. `outcome_current_canonical_draft_selection_picks`: the current canonical selections (0278) with
--    the stored row's id, pick and club.
-- 3. `outcome_external_candidate_rekeyed_selections_current`: the candidate guard above.
-- 4. `outcome_external_candidate_resynced_selections` returns the re-keyed selections as well, so the
--    promotable-selection exclusion, the unusable-record count and the deferred branch of
--    `outcome_external_draft_sessions_exact` treat both lists alike: coverage must name every
--    changed slot exactly once. For every existing candidate the function returns the same rows: no
--    stored candidate carries `rekeyedSelectionIds` (the candidate contract is strict), so the
--    deferred branch keeps its value for every existing promotion and 0280's stored-coverage
--    argument is unchanged.
-- 5. The unusable-record count also refuses a re-keyed selection without a usable status.
-- 6. `outcome_external_candidate_issueless_deferral_kept` (0282) counts the re-keyed list.
-- 7. The candidate insert guard (0282) records the list only under the deferral and checks it.

-- 1. The number-only addresses of a candidate selection: draft year, type and selection number,
-- with the selection's round and with no round (the form every pre-rules promotion wrote), computed
-- as the reconciler's content address (`draft-pick`, `outcome_afl_trade_canonical_json`, 0273).
CREATE FUNCTION outcome_external_selection_number_only_pick_ids(selection JSONB)
RETURNS TEXT[] LANGUAGE sql STABLE AS $$
  SELECT ARRAY(
    SELECT DISTINCT 'draft-pick:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(
             jsonb_build_object('draftYear',selection->'draftYear','draftType',selection->'draftType',
                                'nominalPick',selection->'selectionNumber','nominalRound',rounds.round)),
             'UTF8')),'hex')
      FROM (VALUES (COALESCE(selection->'roundNumber','null'::jsonb)),('null'::jsonb)) rounds(round)
     ORDER BY 1)
$$;

-- 2. The current canonical selections of a competition (0278), each with the stored selection row's
-- id, pick and club.
CREATE FUNCTION outcome_current_canonical_draft_selection_picks(target_competition TEXT)
RETURNS TABLE (draft_year INTEGER, draft_type TEXT, selection_id TEXT, selection_number INTEGER,
               player_id TEXT, event_id TEXT, event_version_id TEXT, canonical_selection_id TEXT,
               pick_id TEXT, club_id TEXT) LANGUAGE sql STABLE AS $$
  SELECT current.draft_year, current.draft_type, current.selection_id, current.selection_number,
         current.player_id, current.event_id, current.event_version_id, stored.selection_id,
         stored.pick_id, stored.club_id
    FROM outcome_current_canonical_draft_selection_players(target_competition) current
    JOIN outcome_draft_selection stored
      ON stored.event_version_id=current.event_version_id
     AND stored.selection_number=current.selection_number
$$;

-- 3. Every selection the candidate records as re-keyed meets the rule in the header. NULL (absent)
-- is valid; an empty, duplicated or malformed list is not.
CREATE FUNCTION outcome_external_candidate_rekeyed_selections_current(candidate JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE ids JSONB := candidate#>'{content,pickLineageDeferral,rekeyedSelectionIds}';
        resynced JSONB := COALESCE(candidate#>'{content,pickLineageDeferral,resyncedSelectionIds}','[]'::jsonb);
        competition TEXT := candidate#>>'{content,competition}';
        selections JSONB := candidate#>'{content,draftSelections}';
        valid BOOLEAN;
BEGIN
  IF ids IS NULL THEN RETURN TRUE; END IF;
  IF jsonb_typeof(ids)<>'array' OR jsonb_array_length(ids)=0 OR competition IS NULL
     OR jsonb_typeof(selections) IS DISTINCT FROM 'array'
     OR jsonb_typeof(resynced)<>'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(ids) id WHERE jsonb_typeof(id)<>'string')
     OR (SELECT count(DISTINCT id) FROM jsonb_array_elements_text(ids) id)<>jsonb_array_length(ids) THEN
    RETURN FALSE;
  END IF;
  WITH held AS (
    SELECT value->>'selectionId' AS selection_id, (value->>'draftYear')::INTEGER AS draft_year,
           value->>'draftType' AS draft_type, (value->>'selectionNumber')::INTEGER AS selection_number,
           value->'playerId' AS player, value->'clubId' AS club, value->>'status' AS status,
           value->>'pickId' AS pick_id,
           outcome_external_selection_number_only_pick_ids(value) AS number_only,
           ids ? (value->>'selectionId') AS listed,
           resynced ? (value->>'selectionId') AS resynced
      FROM jsonb_array_elements(selections) value
  ), current AS MATERIALIZED (
    SELECT * FROM outcome_current_canonical_draft_selection_picks(competition)
  ), usable_picks AS (
    SELECT DISTINCT custody->>'pickId' AS pick_id
      FROM jsonb_array_elements(COALESCE(candidate#>'{content,pickCustody}','[]'::jsonb)) custody
     WHERE custody->>'status' IN ('single_source','corroborated')
       AND NOT COALESCE(candidate#>'{content,pickLineageDeferral,deferredCustodyIds}','[]'::jsonb)
               ? (custody->>'custodyId')
  ), deferred_issues AS (
    SELECT issue->>'subjectKey' AS subject_key
      FROM jsonb_array_elements(COALESCE(candidate#>'{content,issues}','[]'::jsonb)) issue
     WHERE issue->>'severity'='deferred'
  ), deferred_picks AS (
    -- `pickLineageDeferral.ts`: a deferred `pick-custody:<pick>[|<time>]` subject, or a deferred
    -- `lineage:<transfer>` subject of a pick transfer.
    SELECT split_part(substr(subject_key,length('pick-custody:')+1),'|',1) AS pick_id
      FROM deferred_issues WHERE starts_with(subject_key,'pick-custody:')
    UNION
    SELECT transfer#>>'{asset,pickId}'
      FROM deferred_issues
      JOIN jsonb_array_elements(COALESCE(candidate#>'{content,transfers}','[]'::jsonb)) transfer
        ON deferred_issues.subject_key='lineage:'||(transfer->>'transferId')
     WHERE transfer#>>'{asset,kind}'='pick_entitlement' AND transfer#>>'{asset,pickId}' IS NOT NULL
  ), drafts AS (
    SELECT DISTINCT draft_year, draft_type FROM held WHERE listed
  )
  SELECT NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(ids) id
            WHERE NOT EXISTS (
              SELECT 1 FROM held
               WHERE held.selection_id=id AND jsonb_typeof(held.player)='string'
                 AND jsonb_typeof(held.club)='string'
                 AND held.status IN ('single_source','corroborated')
                 AND held.pick_id IS NOT NULL
                 AND EXISTS (SELECT 1 FROM usable_picks WHERE usable_picks.pick_id=held.pick_id)
                 AND NOT EXISTS (SELECT 1 FROM deferred_picks WHERE deferred_picks.pick_id=held.pick_id)
                 AND NOT held.pick_id=ANY(held.number_only)
                 AND (SELECT count(*) FROM current WHERE current.selection_id=held.selection_id)=1
                 AND EXISTS (
                       SELECT 1 FROM current
                        WHERE current.selection_id=held.selection_id
                          AND current.selection_number=held.selection_number
                          AND current.club_id=held.club#>>'{}'
                          AND current.pick_id=ANY(held.number_only)
                          AND current.pick_id<>held.pick_id
                          AND (held.resynced OR current.player_id=held.player#>>'{}')
                          AND NOT EXISTS (SELECT 1 FROM outcome_special_entitlement_lifecycle lifecycle
                                           WHERE lifecycle.selection_id=current.canonical_selection_id)
                          AND NOT EXISTS (SELECT 1 FROM outcome_special_entitlement_selection_claim claim
                                           WHERE claim.selection_id=current.canonical_selection_id))
                 AND NOT EXISTS (SELECT 1 FROM current other
                                  WHERE other.pick_id=held.pick_id
                                    AND other.selection_id<>held.selection_id)))
     -- Two re-keyed slots never take one pick (rule 4).
     AND (SELECT count(DISTINCT held.pick_id) FROM held WHERE held.listed)
         =(SELECT count(*) FROM held WHERE held.listed)
     AND NOT EXISTS (
           SELECT 1 FROM drafts
             JOIN jsonb_array_elements(COALESCE(candidate#>'{content,pickLineageDeferral,promotedDrafts}','[]'::jsonb)) promoted
               ON (promoted->>'draftYear')::INTEGER=drafts.draft_year AND promoted->>'draftType'=drafts.draft_type)
     AND NOT EXISTS (
           SELECT 1 FROM drafts JOIN held USING (draft_year, draft_type)
            WHERE NOT held.listed AND NOT held.resynced
              AND NOT EXISTS (SELECT 1 FROM current
                               WHERE current.selection_id=held.selection_id
                                 AND (jsonb_typeof(held.player) IS DISTINCT FROM 'string'
                                      OR current.player_id=held.player#>>'{}')))
    INTO valid;
  RETURN valid;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN FALSE;
END $$;

-- 4. The candidate selections a session re-sync re-promotes, as stored reconciliation rows: the
-- re-synced (0278) and the re-keyed. The id lists are read from `candidate_json` once (0280).
CREATE OR REPLACE FUNCTION outcome_external_candidate_resynced_selections(target_candidate TEXT)
RETURNS SETOF outcome_external_reconciliation_draft_selection LANGUAGE sql STABLE AS $$
  WITH listed AS MATERIALIZED (
    SELECT COALESCE(candidate.candidate_json#>'{content,pickLineageDeferral,resyncedSelectionIds}','[]'::jsonb)
           || COALESCE(candidate.candidate_json#>'{content,pickLineageDeferral,rekeyedSelectionIds}','[]'::jsonb) AS ids
      FROM outcome_external_reconciliation_candidate candidate
     WHERE candidate.candidate_id=target_candidate
  )
  SELECT selection.*
    FROM outcome_external_reconciliation_draft_selection selection
    JOIN listed ON listed.ids ? selection.selection_id
   WHERE selection.candidate_id=target_candidate
$$;

-- 5. Reconciled records the promotion writes that lack a usable status (0279): a re-synced or
-- re-keyed selection is unusable when disputed or missing its player or club, and a re-keyed one also
-- when its status is not usable (it takes the candidate's pick).
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
    UNION ALL SELECT CASE WHEN selection.status='disputed'
                            OR jsonb_typeof(selection.selection_json->'playerId') IS DISTINCT FROM 'string'
                            OR jsonb_typeof(selection.selection_json->'clubId') IS DISTINCT FROM 'string'
                            OR (COALESCE(candidate.candidate_json#>'{content,pickLineageDeferral,rekeyedSelectionIds}','[]'::jsonb)
                                  ? selection.selection_id
                                AND selection.status NOT IN ('single_source','corroborated'))
                          THEN 'unresolved' ELSE 'single_source' END
       FROM outcome_external_candidate_resynced_selections(target_candidate) selection
       JOIN outcome_external_reconciliation_candidate candidate ON candidate.candidate_id=target_candidate
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

-- 6. Whether a deferral that deferred no issue may be carried (0282): it lists something, the
-- re-keyed list included, and every draft the candidate holds is recorded as already promoted or
-- holds a re-synced or re-keyed selection (`aflTradeIssuelessDeferralKept`).
CREATE OR REPLACE FUNCTION outcome_external_candidate_issueless_deferral_kept(candidate JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE deferral JSONB := candidate#>'{content,pickLineageDeferral}';
        selections JSONB := candidate#>'{content,draftSelections}';
        changed JSONB;
BEGIN
  IF jsonb_typeof(deferral) IS DISTINCT FROM 'object'
     OR jsonb_typeof(selections) IS DISTINCT FROM 'array' THEN
    RETURN FALSE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY['promotedDrafts','resyncedSelectionIds','rekeyedSelectionIds',
                               'promotedTransactions','deferredCustodyIds','promotedCustodyIds']) list(name)
     WHERE jsonb_typeof(deferral->list.name)='array' AND jsonb_array_length(deferral->list.name)>0)
  THEN
    RETURN FALSE;
  END IF;
  changed := COALESCE(deferral->'resyncedSelectionIds','[]'::jsonb)
             || COALESCE(deferral->'rekeyedSelectionIds','[]'::jsonb);
  RETURN NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(selections) held
     WHERE NOT EXISTS (
             SELECT 1 FROM jsonb_array_elements(COALESCE(deferral->'promotedDrafts','[]'::jsonb)) promoted
              WHERE promoted->'draftYear'=held->'draftYear' AND promoted->'draftType'=held->'draftType')
       AND NOT EXISTS (
             SELECT 1 FROM jsonb_array_elements(selections) resynced
              WHERE changed ? (resynced->>'selectionId')
                AND resynced->'draftYear'=held->'draftYear' AND resynced->'draftType'=held->'draftType'));
END $$;

-- 7. The candidate insert guard (0282), with the re-keyed list.
CREATE OR REPLACE FUNCTION validate_outcome_external_reconciliation_lineage_deferral()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE decision_row outcome_review_decision%ROWTYPE;
BEGIN
  IF (NEW.candidate_json#>'{content,pickLineageDeferral,promotedDrafts}' IS NOT NULL
      OR NEW.candidate_json#>'{content,pickLineageDeferral,resyncedSelectionIds}' IS NOT NULL
      OR NEW.candidate_json#>'{content,pickLineageDeferral,rekeyedSelectionIds}' IS NOT NULL
      OR NEW.candidate_json#>'{content,pickLineageDeferral,promotedTransactions}' IS NOT NULL
      OR NEW.candidate_json#>'{content,pickLineageDeferral,deferredCustodyIds}' IS NOT NULL
      OR NEW.candidate_json#>'{content,pickLineageDeferral,promotedCustodyIds}' IS NOT NULL)
     AND NEW.lineage_deferral_decision_id IS NULL THEN
    RAISE EXCEPTION 'Already-promoted drafts, transactions and custody, re-synced and re-keyed selections and deferred custody are recorded only under the pick-side deferral decision';
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
  IF NOT outcome_external_candidate_rekeyed_selections_current(NEW.candidate_json) THEN
    RAISE EXCEPTION 'Every re-keyed selection must be current canonical once under a number-only pick id, with a usable undeferred candidate pick no other current selection carries, in a draft otherwise current under the candidate''s players';
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
