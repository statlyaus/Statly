-- A session re-sync repairs the player alone (statlyaus/Statly#853,
-- docs/architecture/afl-draft-pick-identity-rules.md, "Repairing promoted draftees").
-- The first rehearsal of the identity repair (2026-10-14, a copy of the grading database) prepared a
-- deferred candidate with 73 re-synced selections. 38 of them were `unresolved` although their player
-- and club resolve: the reconciler marks a selection unresolved when its pick custody is not uniquely
-- resolved, a pick-side state that raises no issue. 0278's unusable-record count counted every
-- re-synced selection by status, so the review refused the candidate. Before 0278 the same drafts were
-- left whole to their earlier promotion and those selections were never counted.
--
-- A re-sync changes who was drafted at a slot and nothing else: the promoter keeps the pick id of the
-- selection it re-versions (the candidate's differs for 45 of the 73, and is a fallback slot id where
-- custody is unresolved) and refuses a club change. So a re-synced selection needs its player and club
-- resolved and its providers in agreement (not `disputed`); a pick-side `unresolved` status does not
-- make it unusable. The candidate guard now also demands the candidate's club equal the current row's,
-- and an undisputed status.

-- Reconciled records the promotion writes that lack a usable status (0278). A re-synced selection is
-- unusable only when disputed or missing its player or club.
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
                          THEN 'unresolved' ELSE 'single_source' END
       FROM outcome_external_candidate_resynced_selections(target_candidate) selection
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

-- Every selection the candidate records as re-synced is an undisputed candidate selection with a
-- player and club whose source selection is current canonical exactly once, at the candidate's
-- number, under another player and the candidate's club; no re-synced selection sits in a draft
-- recorded as already promoted; and every other candidate selection in a draft holding one is current
-- canonical under its own player (or, without a player, by id). NULL (absent) is valid; an empty,
-- duplicated or malformed list is not.
CREATE OR REPLACE FUNCTION outcome_external_candidate_resynced_selections_current(candidate JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE ids JSONB := candidate#>'{content,pickLineageDeferral,resyncedSelectionIds}';
        competition TEXT := candidate#>>'{content,competition}';
        selections JSONB := candidate#>'{content,draftSelections}';
        valid BOOLEAN;
BEGIN
  IF ids IS NULL THEN RETURN TRUE; END IF;
  IF jsonb_typeof(ids)<>'array' OR jsonb_array_length(ids)=0 OR competition IS NULL
     OR jsonb_typeof(selections) IS DISTINCT FROM 'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(ids) id WHERE jsonb_typeof(id)<>'string')
     OR (SELECT count(DISTINCT id) FROM jsonb_array_elements_text(ids) id)<>jsonb_array_length(ids) THEN
    RETURN FALSE;
  END IF;
  WITH held AS (
    SELECT value->>'selectionId' AS selection_id, (value->>'draftYear')::INTEGER AS draft_year,
           value->>'draftType' AS draft_type, (value->>'selectionNumber')::INTEGER AS selection_number,
           value->'playerId' AS player, value->'clubId' AS club, value->>'status' AS status,
           ids ? (value->>'selectionId') AS listed
      FROM jsonb_array_elements(selections) value
  ), current AS MATERIALIZED (
    SELECT current.*, stored.club_id
      FROM outcome_current_canonical_draft_selection_players(competition) current
      JOIN outcome_draft_selection stored
        ON stored.event_version_id=current.event_version_id
       AND stored.selection_number=current.selection_number
       AND stored.player_id=current.player_id
     WHERE current.selection_id IN (SELECT selection_id FROM held)
  ), drafts AS (
    SELECT DISTINCT draft_year, draft_type FROM held WHERE listed
  )
  SELECT NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(ids) id
            WHERE NOT EXISTS (
              SELECT 1 FROM held
               WHERE held.selection_id=id AND jsonb_typeof(held.player)='string'
                 AND jsonb_typeof(held.club)='string' AND held.status IS DISTINCT FROM 'disputed'
                 AND (SELECT count(*) FROM current WHERE current.selection_id=held.selection_id)=1
                 AND EXISTS (SELECT 1 FROM current
                              WHERE current.selection_id=held.selection_id
                                AND current.selection_number=held.selection_number
                                AND current.player_id<>held.player#>>'{}'
                                AND current.club_id=held.club#>>'{}')))
     AND NOT EXISTS (
           SELECT 1 FROM drafts
             JOIN jsonb_array_elements(COALESCE(candidate#>'{content,pickLineageDeferral,promotedDrafts}','[]'::jsonb)) promoted
               ON (promoted->>'draftYear')::INTEGER=drafts.draft_year AND promoted->>'draftType'=drafts.draft_type)
     AND NOT EXISTS (
           SELECT 1 FROM drafts JOIN held USING (draft_year, draft_type)
            WHERE NOT held.listed
              AND NOT EXISTS (SELECT 1 FROM current
                               WHERE current.selection_id=held.selection_id
                                 AND (jsonb_typeof(held.player) IS DISTINCT FROM 'string'
                                      OR current.player_id=held.player#>>'{}')))
    INTO valid;
  RETURN valid;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN FALSE;
END $$;
