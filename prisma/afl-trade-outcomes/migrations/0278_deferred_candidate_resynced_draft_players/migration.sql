-- Re-promoting a draftee whose player identity changed (statlyaus/Statly#853,
-- docs/architecture/afl-draft-pick-identity-rules.md, "Repairing promoted players").
-- An identity repair re-targets an external identity decision: a later revision of the same subject
-- names another canonical player, such as the AFL Tables twin of a Draftguru-created player. 0277
-- re-promotes the trade side. The draft side was still left alone: a deferred candidate listed the
-- draft in `promotedDrafts` because its selection ids were current, so the old player stayed on the
-- current selection and player asset, the twin had no draft asset, and no reviewed arrival could
-- start at it. Selection ids are keyed by draft slot, never by player, so only the player shows it.
--
-- A draft now counts as already promoted only when every candidate selection in it is current under
-- the candidate's own player. A draft whose only differences are re-targeted draftees records those
-- selections as `pickLineageDeferral.resyncedSelectionIds`. Its promotion still writes nothing of the
-- night as a draft (a deferred proposal has no session, and writing the night again would create a
-- second, session-less root: 0265). Instead each re-synced slot is re-promoted as part of one later
-- version of the session root it is current on, carrying only the changed slots. The deferred
-- (v1 or v4) proposal names that version in a `promoted_session_resync` coverage entry with its
-- date, precision and official name, read from canonical state when the proposal is derived; the
-- promoter refuses if it is no longer current. Carrying fewer than half of the other slots keeps the
-- new version additive under 0256, so every other draftee's selection, asset and the spells that
-- start at them stay current; the promoter refuses a version that would retire any slot it does not
-- carry. Such a draft asset is evidence for an arrival-only spell, and a re-sync version keeps the
-- evidenced date bounds of the version it supersedes.

-- The current canonical selections of a competition: the same rows as
-- `outcome_current_canonical_draft_selection_ids` (0265, asset-scoped since 0266), each with its
-- draft, number, player, session root and event version.
CREATE FUNCTION outcome_current_canonical_draft_selection_players(target_competition TEXT)
RETURNS TABLE (draft_year INTEGER, draft_type TEXT, selection_id TEXT, selection_number INTEGER,
               player_id TEXT, event_id TEXT, event_version_id TEXT) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT (record.record_json->>'draftYear')::INTEGER, record.record_json->>'draftType',
         record.source_record_id, selection.selection_number, selection.player_id,
         version.event_id, version.event_version_id
    FROM outcome_external_canonical_promotion_record record
    JOIN outcome_external_canonical_promotion promotion
      ON promotion.promotion_id=record.promotion_id AND promotion.status='finalized'
    JOIN outcome_draft_selection selection
      ON selection.selection_id=record.canonical_record_id AND selection.status='approved'
    JOIN outcome_event_version version ON version.event_version_id=selection.event_version_id
    JOIN outcome_event event ON event.event_id=version.event_id AND event.competition=target_competition
   WHERE record.record_kind='draft_selection'
     AND version.status='approved'
     AND NOT outcome_event_version_superseded_for(
           version.event_version_id, selection.player_id, selection.selection_number)
$$;

-- Every draft the candidate records as already promoted names a draft it holds a selection in, and
-- every one of its selections in that draft is current canonical under the candidate's own player.
-- A selection without a player (an unresolved, deferred identity) compares its id alone, as before.
-- NULL (absent) is valid; an empty or malformed list is not.
CREATE OR REPLACE FUNCTION outcome_external_candidate_promoted_drafts_current(candidate JSONB)
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
             SELECT 1 FROM outcome_current_canonical_draft_selection_players(competition) current
              WHERE current.selection_id=selection->>'selectionId'
                AND (jsonb_typeof(selection->'playerId') IS DISTINCT FROM 'string'
                     OR current.player_id=selection->>'playerId')))
      INTO selection_count, promoted_count
      FROM jsonb_array_elements(candidate#>'{content,draftSelections}') selection
     WHERE (selection->>'draftYear')::INTEGER=(draft->>'draftYear')::INTEGER
       AND selection->>'draftType'=draft->>'draftType';
    IF selection_count=0 OR promoted_count<>selection_count THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN FALSE;
END $$;

-- Every selection the candidate records as re-synced is a candidate selection with a player whose
-- source selection is current canonical exactly once, at the candidate's number, under another
-- player; no re-synced selection sits in a draft recorded as already promoted; and every other
-- candidate selection in a draft holding one is current canonical under its own player (or, without
-- a player, by id). NULL (absent) is valid; an empty, duplicated or malformed list is not.
CREATE FUNCTION outcome_external_candidate_resynced_selections_current(candidate JSONB)
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
           value->'playerId' AS player, ids ? (value->>'selectionId') AS listed
      FROM jsonb_array_elements(selections) value
  ), current AS MATERIALIZED (
    SELECT current.* FROM outcome_current_canonical_draft_selection_players(competition) current
     WHERE current.selection_id IN (SELECT selection_id FROM held)
  ), drafts AS (
    SELECT DISTINCT draft_year, draft_type FROM held WHERE listed
  )
  SELECT NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(ids) id
            WHERE NOT EXISTS (
              SELECT 1 FROM held
               WHERE held.selection_id=id AND jsonb_typeof(held.player)='string'
                 AND (SELECT count(*) FROM current WHERE current.selection_id=held.selection_id)=1
                 AND EXISTS (SELECT 1 FROM current
                              WHERE current.selection_id=held.selection_id
                                AND current.selection_number=held.selection_number
                                AND current.player_id<>held.player#>>'{}')))
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

-- The candidate selections recorded as re-synced, as stored reconciliation rows.
CREATE FUNCTION outcome_external_candidate_resynced_selections(target_candidate TEXT)
RETURNS SETOF outcome_external_reconciliation_draft_selection LANGUAGE sql STABLE AS $$
  SELECT selection.*
    FROM outcome_external_reconciliation_draft_selection selection
    JOIN outcome_external_reconciliation_candidate candidate
      ON candidate.candidate_id=selection.candidate_id
   WHERE selection.candidate_id=target_candidate
     AND COALESCE(candidate.candidate_json#>'{content,pickLineageDeferral,resyncedSelectionIds}','[]'::jsonb)
         ? selection.selection_id
$$;

-- The candidate insert guard (0264 to 0274) also demands the re-synced selections be current under
-- another player, and only under the deferral decision.
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

-- Selections a promotion of this candidate writes as a draft: none of a draft holding a deferred
-- selection (0264), none of a draft left to an earlier promotion (0265) and none of a draft holding a
-- re-synced selection, whose re-synced slots are written by their session re-sync alone.
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
     AND NOT EXISTS (SELECT 1 FROM outcome_external_candidate_resynced_selections(target_candidate) resynced
                      WHERE resynced.draft_year=selection.draft_year AND resynced.draft_type=selection.draft_type)
$$;

-- Reconciled records the promotion writes that lack a usable status: a re-synced selection is
-- written too.
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
    UNION ALL SELECT selection.status FROM outcome_external_candidate_resynced_selections(target_candidate) selection
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

-- Draft coverage of a deferred-lineage candidate (0264, 0269): an entry without a kind writes a draft
-- and must cover exactly the promotable selections, grouped by draft, as before. An entry of kind
-- `promoted_session_resync` re-syncs one session version: together they cover every re-synced
-- selection exactly once, in an entry of its own draft, each entry naming a distinct version. Only
-- candidate facts are checked here, so the result is the same after the promotion as before it;
-- whether the named version is current, and on the right root, the promoter checks when it writes.
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

-- Whether an event version is the re-sync version of a finalized deferred promotion: written for a
-- `promoted_session_resync` coverage entry of its exact proposal, superseding the version that entry
-- names, on a session-keyed draft root, under exact candidate coverage.
CREATE FUNCTION outcome_external_promoted_session_resync_version(target_promotion TEXT, target_event_version TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM outcome_external_canonical_promotion promotion
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
      AND outcome_external_draft_sessions_exact(promotion.candidate_id,promotion.proposal_json->'content'))
$$;

-- A re-sync version keeps the evidenced date bounds of the version it supersedes when it repeats
-- that version's date and precision (0196, 0263 otherwise unchanged).
CREATE OR REPLACE FUNCTION outcome_event_evidenced_date_bounds(target_event_version TEXT)
RETURNS DATERANGE LANGUAGE plpgsql STABLE AS $$
DECLARE event RECORD; bounds DATERANGE;
BEGIN
 SELECT v.*,e.season_year INTO event FROM outcome_event_version v JOIN outcome_event e USING(event_id)
 WHERE v.event_version_id=target_event_version;
 IF NOT FOUND THEN RETURN NULL; END IF;
 bounds:=outcome_session_precision_bounds(jsonb_build_object('eventDate',event.event_date,
  'draftYear',event.season_year)||CASE WHEN event.date_precision IS NULL THEN '{}'::jsonb
   ELSE jsonb_build_object('datePrecision',event.date_precision) END,TRUE);
 IF bounds IS NULL THEN RETURN NULL; END IF;
 IF event.date_precision IS NOT NULL AND event.kind='trade' THEN
  IF NOT EXISTS (
   SELECT 1 FROM outcome_external_canonical_promotion_record member
   JOIN outcome_external_canonical_promotion promotion USING(promotion_id)
   WHERE member.canonical_record_id=target_event_version AND member.record_kind='transaction'
    AND member.source_import_row_id=event.source_import_row_id AND promotion.status='finalized'
    AND member.record_json->>'transactionType'='trade'
    AND member.record_json->'occurredOn'='null'::jsonb
    AND member.record_json->'datePrecision'=event.date_precision
    AND member.record_json->'seasonYear'=to_jsonb(event.season_year)
    AND EXISTS (
     SELECT 1 FROM jsonb_array_elements(promotion.proposal_json#>'{content,transactionDateCoverage}') item
     WHERE item->>'transactionId'=member.source_record_id
      AND item->'occurredOn'='null'::jsonb
      AND item->'datePrecision'=event.date_precision
      AND item->'seasonYear'=to_jsonb(event.season_year))
  ) THEN RETURN NULL; END IF;
  RETURN bounds;
 END IF;
 IF event.date_precision IS NOT NULL AND event.supersedes_version_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM outcome_external_canonical_promotion_record member
  JOIN outcome_external_canonical_promotion promotion USING(promotion_id)
  JOIN outcome_event_version predecessor ON predecessor.event_version_id=event.supersedes_version_id
  WHERE member.canonical_record_id=target_event_version AND member.record_kind='draft_event'
   AND member.source_import_row_id=event.source_import_row_id AND promotion.status='finalized'
   AND member.record_json->>'kind'='promoted_session_resync'
   AND member.record_json->>'supersedesVersionId'=event.supersedes_version_id
   AND member.record_json->'datePrecision'=event.date_precision
   AND predecessor.date_precision=event.date_precision
   AND predecessor.event_date IS NOT DISTINCT FROM event.event_date
 ) THEN
  RETURN CASE WHEN outcome_event_evidenced_date_bounds(event.supersedes_version_id)=bounds
              THEN bounds END;
 END IF;
 IF event.date_precision IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM outcome_external_canonical_promotion_record member
  JOIN outcome_external_canonical_promotion promotion USING(promotion_id)
  WHERE member.canonical_record_id=target_event_version AND member.record_kind='draft_event'
   AND member.source_import_row_id=event.source_import_row_id AND promotion.status='finalized'
   AND promotion.proposal_json#>>'{content,schemaVersion}'='afl-trade-external-canonical-promotion-proposal/v7'
   AND member.record_json->'eventDate'='null'::jsonb
   AND member.record_json->'datePrecision'=event.date_precision
   AND member.record_json->>'draftYear'=event.season_year::TEXT
   AND outcome_external_draft_sessions_exact(promotion.candidate_id,promotion.proposal_json->'content')
 ) THEN RETURN NULL; END IF;
 RETURN bounds;
END $$;

-- A reviewed arrival-only (v4) spell may start at a re-synced draftee's player asset: the asset of a
-- re-sync version of a deferred promotion counts as session evidence, as the asset of the session
-- promotion it supersedes did. Every other check of the arrival test is unchanged.
DO $migration$
DECLARE definition TEXT;
 old_fragment CONSTANT TEXT := $old$    AND (member.record_kind='transfer' OR ($old$;
BEGIN
 definition:=pg_get_functiondef('outcome_acquisition_arrival_event_current(jsonb,text,text,text,text,boolean,timestamp with time zone,timestamp with time zone)'::regprocedure);
 IF array_length(string_to_array(definition,old_fragment),1)<>2 THEN
   RAISE EXCEPTION 'Expected exactly one draft-asset evidence clause in outcome_acquisition_arrival_event_current';
 END IF;
 EXECUTE replace(definition,old_fragment,
   $new$    AND (member.record_kind='transfer'
      OR (member.record_kind='draft_player_asset'
          AND outcome_external_promoted_session_resync_version(promotion.promotion_id,event.event_version_id))
      OR ($new$);
END $migration$;
