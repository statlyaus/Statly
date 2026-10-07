-- Asset-scoped event supersession.
--
-- A reviewed spell, a draft selection and a special-entitlement custody edge each cite one asset of
-- one event version. Six checks treated the whole event version as stale as soon as any later
-- version superseded it, whatever that version carried. On 2026-09-30 the 2020 Jeremy Cameron trade
-- promotion recorded the two or three players drafted with the Cameron picks as new versions of the
-- whole 2019-11-28, 2020-12-09 and 2021-11-25 draft events. The 148 other assets on the old versions
-- were never re-versioned and stay approved, yet every reviewed spell on them (68) became
-- non-current.
--
-- Owner decision (statlyaus/Statly#742, 2026-10-07, option a): an event version counts as superseded
-- for an asset only when a later version in its chain re-versions that asset. For a player asset or
-- a reviewed spell that is a later asset for the same player; for a draft selection, a later
-- selection for the same player or the same selection number. A cited asset with neither a player
-- nor a selection number keeps the old whole-event rule. A re-version of the asset itself still makes
-- the old citation stale, so a correction that changes who was drafted, or moves a player, is never
-- hidden; a version that adds unrelated assets no longer invalidates everything else on the night.
--
-- The version-chain trigger drops spells on superseded events from its overlap check; it takes the
-- same predicate so a spell that is still current keeps blocking overlaps. Postseason observation,
-- valuation cohort inputs and the special-correction dependency trigger reason about whole events
-- and are unchanged. Every edit below is an asserted in-place replacement of the deployed
-- definition, as 0247, 0248, 0252 and 0254 do.

CREATE FUNCTION outcome_event_version_superseded_for(
  origin_version TEXT, target_player TEXT, target_selection INTEGER
) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 WITH RECURSIVE successors AS (
  SELECT version.event_version_id, 1 AS hops
  FROM outcome_event_version version WHERE version.supersedes_version_id=origin_version
  UNION ALL
  SELECT version.event_version_id, successors.hops+1
  FROM successors
  JOIN outcome_event_version version ON version.supersedes_version_id=successors.event_version_id
  WHERE successors.hops<64
 )
 SELECT (target_player IS NULL AND target_selection IS NULL AND EXISTS (SELECT 1 FROM successors))
   OR EXISTS (SELECT 1 FROM successors
              JOIN outcome_event_asset asset ON asset.event_version_id=successors.event_version_id
              WHERE target_player IS NOT NULL AND asset.player_id=target_player)
   OR EXISTS (SELECT 1 FROM successors
              JOIN outcome_draft_selection selection
                ON selection.event_version_id=successors.event_version_id
              WHERE (target_player IS NOT NULL AND selection.player_id=target_player)
                 OR (target_selection IS NOT NULL AND selection.selection_number=target_selection))
$$;

-- Replaces `old` with `new` in one deployed function. Each fragment must occur exactly once.
CREATE FUNCTION pg_temp.replace_supersession_clause(target REGPROCEDURE, old TEXT, new TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE definition TEXT;
BEGIN
  definition:=pg_get_functiondef(target);
  IF array_length(string_to_array(definition,old),1)<>2 THEN
    RAISE EXCEPTION 'Expected exactly one supersession fragment in %: %', target, old;
  END IF;
  EXECUTE replace(definition,old,new);
END $$;

DO $migration$
DECLARE fn TEXT;
BEGIN
 -- 1, 2: the promoted-event check (v1, v2 and v3 spells) and its arrival-only copy (v4 spells).
 FOREACH fn IN ARRAY ARRAY[
   'outcome_acquisition_promoted_event_current(jsonb,text,text,text,text,boolean,timestamp with time zone,timestamp with time zone)',
   'outcome_acquisition_arrival_event_current(jsonb,text,text,text,text,boolean,timestamp with time zone,timestamp with time zone)'] LOOP
   PERFORM pg_temp.replace_supersession_clause(fn::regprocedure,
     $old$    AND NOT EXISTS (SELECT 1 FROM outcome_event_version successor WHERE successor.supersedes_version_id=event.event_version_id)$old$,
     $new$    AND NOT outcome_event_version_superseded_for(event.event_version_id,asset.player_id,NULL)$new$);
 END LOOP;

 -- 3: the version-chain trigger's overlap check keeps counting a spell whose event was superseded
 -- without touching its asset.
 PERFORM pg_temp.replace_supersession_clause('validate_outcome_version_chain()'::regprocedure,
   $old$                  WHERE current_spell."start_event_version_id" IS NOT NULL
                    AND entry_successor."supersedes_version_id" = current_spell."start_event_version_id"$old$,
   $new$                  WHERE current_spell."start_event_version_id" IS NOT NULL
                    AND entry_successor."supersedes_version_id" = current_spell."start_event_version_id"
                    AND "outcome_event_version_superseded_for"(current_spell."start_event_version_id", current_spell."player_id", NULL)$new$);

 -- 4, 5: special-entitlement exercise on a draft selection.
 FOREACH fn IN ARRAY ARRAY[
   'authenticate_outcome_special_entitlement_lifecycle(jsonb,text)',
   'authenticate_outcome_special_entitlement_revision_lifecycle(jsonb,text,jsonb)'] LOOP
   PERFORM pg_temp.replace_supersession_clause(fn::regprocedure,
     $old$      OR EXISTS (SELECT 1 FROM outcome_event_version WHERE supersedes_version_id=selection.event_version_id)$old$,
     $new$      OR outcome_event_version_superseded_for(selection.event_version_id,selection.player_id,selection.selection_number)$new$);
 END LOOP;

 -- 6: special-entitlement custody edges cite a canonical asset.
 PERFORM pg_temp.replace_supersession_clause('authenticate_outcome_special_entitlement_revision(jsonb,text)'::regprocedure,
   $old$      OR EXISTS (SELECT 1 FROM outcome_event_version WHERE supersedes_version_id=canonical.event_version_id)$old$,
   $new$      OR outcome_event_version_superseded_for(canonical.event_version_id,canonical.player_id,NULL)$new$);
END $migration$;

DROP FUNCTION pg_temp.replace_supersession_clause(REGPROCEDURE, TEXT, TEXT);
