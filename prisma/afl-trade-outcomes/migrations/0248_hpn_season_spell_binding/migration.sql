-- HPN season input binds every player-stat row to a season (v3) spell, never a reviewed spell.
--
-- Until now a row could bind either a reviewed entry spell (v1/v2) or a season appearance-membership
-- spell (v3). A v1 spell's possible membership is open-ended, so it blocked every later season spell
-- for the same player and club and retired any season spell inside it. Its continuity claim needs
-- fresh evidence each season (observedThrough), and that evidence is lost for all 247 v1 spells.
-- Season spells prove continuity from match records the database verifies, so they become the only
-- binding for season statistics. Reviewed spells keep proving the arrival, for trade attribution.
--
--  1. The overlap guard admits a v3 spell inside a current v1, v2 or v4 stint for the same player
--     and club (0247 admitted v4 only). Reviewed spells still cannot overlap one another, and
--     season spells still cannot overlap one another.
--  2. A reviewed spell no longer retires a season spell inside its stint.
--  3. outcome_hpn_acquisition_spell_source_current, used only by the HPN input build and its
--     finalization guard, admits a season (v3) spell and no reviewed (v1, v2 or v4) spell. Legacy
--     spells recorded before registration existed keep their unchanged branch. The per-row
--     outcome_hpn_acquisition_spell_is_current, which the postseason projection uses to re-verify
--     retained input sets, is unchanged.
--
-- Every edit asserts its exact deployed fragment and that nothing else changed. No row changes.

-- 1. Season spells may sit inside any current reviewed stint.
DO $migration$
DECLARE definition TEXT; old_fragment TEXT; new_fragment TEXT;
BEGIN
  definition:=pg_get_functiondef('validate_outcome_version_chain()'::regprocedure);
  old_fragment:=$old$              AND NOT (COALESCE(NEW."registration_canonical_json"::JSONB->>'schemaVersion','')='afl-trade-acquisition-registration/v3'
                AND COALESCE(current_spell."registration_canonical_json"::JSONB->>'schemaVersion','')='afl-trade-acquisition-registration/v4'
                AND outcome_acquisition_possible_membership(current_spell) @> outcome_acquisition_possible_membership(NEW))$old$;
  new_fragment:=$new$              -- 0248: a season spell may sit inside any current reviewed stint for the same player and club.
              AND NOT (COALESCE(NEW."registration_canonical_json"::JSONB->>'schemaVersion','')='afl-trade-acquisition-registration/v3'
                AND COALESCE(current_spell."registration_canonical_json"::JSONB->>'schemaVersion','') IN
                  ('afl-trade-acquisition-registration/v1','afl-trade-acquisition-registration/v2',
                   'afl-trade-acquisition-registration/v4')
                AND outcome_acquisition_possible_membership(current_spell) @> outcome_acquisition_possible_membership(NEW))$new$;
  IF definition IS NULL OR array_length(string_to_array(definition,old_fragment),1)<>2
    OR position('0248:' IN definition)>0 THEN
    RAISE EXCEPTION 'Expected exactly one deployed fragment before 0248: %',left(old_fragment,80);
  END IF;
  definition:=replace(definition,old_fragment,new_fragment);
  IF replace(definition,new_fragment,old_fragment) IS DISTINCT FROM pg_get_functiondef('validate_outcome_version_chain()'::regprocedure) THEN
    RAISE EXCEPTION '0248 altered bytes outside its fragment in validate_outcome_version_chain()';
  END IF;
  EXECUTE definition;
END $migration$;

-- 2. A reviewed spell no longer retires the season windows inside it.
DO $migration$
DECLARE definition TEXT; old_fragment TEXT; new_fragment TEXT;
BEGIN
  definition:=pg_get_functiondef('outcome_acquisition_appearance_spell_registration_current(text,timestamp with time zone)'::regprocedure);
  old_fragment:=$old$    -- A reviewed entry spell whose membership contains this window retires it (a bridge only).
    AND NOT EXISTS (
      SELECT 1 FROM outcome_acquisition_spell_version reviewed
      WHERE reviewed.player_id=spell.player_id AND reviewed.club_id=spell.club_id
        AND reviewed.status='approved' AND reviewed.registration_canonical_json IS NOT NULL
        AND reviewed.registration_canonical_json::JSONB->>'schemaVersion' IN
          ('afl-trade-acquisition-registration/v1','afl-trade-acquisition-registration/v2')
        AND reviewed.recorded_at<=cutoff
        AND outcome_acquisition_possible_membership(reviewed) @> daterange(spell.start_date,spell.end_date,'[]')
        -- 0236: only a same-player, same-club covering reviewed spell is re-verified.
        AND CASE WHEN reviewed.player_id=spell.player_id AND reviewed.club_id=spell.club_id
            AND reviewed.status='approved' AND reviewed.registration_canonical_json IS NOT NULL
            AND reviewed.registration_canonical_json::JSONB->>'schemaVersion' IN
              ('afl-trade-acquisition-registration/v1','afl-trade-acquisition-registration/v2')
            AND reviewed.recorded_at<=cutoff
            AND outcome_acquisition_possible_membership(reviewed) @> daterange(spell.start_date,spell.end_date,'[]')
          THEN outcome_acquisition_spell_registration_current(reviewed.spell_version_id,cutoff)
          ELSE FALSE END)
$old$;
  new_fragment:=$new$    -- 0248: a reviewed spell no longer retires a season window inside it; both stay current.
$new$;
  IF definition IS NULL OR array_length(string_to_array(definition,old_fragment),1)<>2
    OR position('0248:' IN definition)>0 THEN
    RAISE EXCEPTION 'Expected exactly one deployed fragment before 0248: %',left(old_fragment,80);
  END IF;
  definition:=replace(definition,old_fragment,new_fragment);
  IF replace(definition,new_fragment,old_fragment) IS DISTINCT FROM pg_get_functiondef('outcome_acquisition_appearance_spell_registration_current(text,timestamp with time zone)'::regprocedure) THEN
    RAISE EXCEPTION '0248 altered bytes outside its fragment in outcome_acquisition_appearance_spell_registration_current(text,timestamp with time zone)';
  END IF;
  EXECUTE definition;
END $migration$;

-- 3. HPN input binding admits season spells only.
DO $migration$
DECLARE definition TEXT; old_fragment TEXT; new_fragment TEXT;
BEGIN
  definition:=pg_get_functiondef('outcome_hpn_acquisition_spell_source_current(text,text,text,text,date,boolean)'::regprocedure);
  old_fragment:=$old$    SELECT 1 FROM outcome_acquisition_spell_version spell WHERE spell.spell_version_id=target_spell
      AND ((NOT COALESCE(source_first,TRUE) AND spell.registration_canonical_json IS NULL)
        OR (spell_registration_is_current
          AND spell.registration_canonical_json::JSONB->>'environment'=source.environment::TEXT
          AND spell.registration_canonical_json::JSONB->>'competition'=source.competition
          AND effective_date<=(spell.registration_canonical_json::JSONB->>'observedThrough')::DATE))$old$;
  new_fragment:=$new$    SELECT 1 FROM outcome_acquisition_spell_version spell WHERE spell.spell_version_id=target_spell
      AND ((NOT COALESCE(source_first,TRUE) AND spell.registration_canonical_json IS NULL)
        OR (spell_registration_is_current
          -- 0248: of the registered spells, only a season (v3) spell binds season statistics.
          AND spell.registration_canonical_json::JSONB->>'schemaVersion'='afl-trade-acquisition-registration/v3'
          AND spell.registration_canonical_json::JSONB->>'environment'=source.environment::TEXT
          AND spell.registration_canonical_json::JSONB->>'competition'=source.competition
          AND effective_date<=(spell.registration_canonical_json::JSONB->>'observedThrough')::DATE))$new$;
  IF definition IS NULL OR array_length(string_to_array(definition,old_fragment),1)<>2
    OR position('0248:' IN definition)>0 THEN
    RAISE EXCEPTION 'Expected exactly one deployed fragment before 0248: %',left(old_fragment,80);
  END IF;
  definition:=replace(definition,old_fragment,new_fragment);
  IF replace(definition,new_fragment,old_fragment) IS DISTINCT FROM pg_get_functiondef('outcome_hpn_acquisition_spell_source_current(text,text,text,text,date,boolean)'::regprocedure) THEN
    RAISE EXCEPTION '0248 altered bytes outside its fragment in outcome_hpn_acquisition_spell_source_current(text,text,text,text,date,boolean)';
  END IF;
  EXECUTE definition;
END $migration$;
