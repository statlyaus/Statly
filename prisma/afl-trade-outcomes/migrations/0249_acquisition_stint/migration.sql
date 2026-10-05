-- Acquisition stints: a reviewed arrival plus the season spells that follow it at the same club.
--
-- Since migration 0248 a reviewed spell proves how a player arrived and season (v3) spells prove who
-- played for a club in a season. A stint joins the two claims for the realized-value rule: the
-- whole first stint at the receiving club, no cap, return stints excluded.
--
-- outcome_acquisition_stint(player, club, arrival) starts at a current reviewed (v1, v2 or v4)
-- arrival for that player and club, and returns the ordered current season spells at that club from
-- the arrival on. The stint closes at the earliest of:
--   * the first current season spell for the player at another club after the arrival; or
--   * a later current reviewed arrival for the same player and club (delisted and redrafted).
-- Its end date is the last appearance of the last season spell inside it. With no season spell it is
-- `no_appearances`; otherwise `closed` or `open`. An open stint (including a retired player) reads to
-- the latest season spell registered. Every spell it reads must be current and not superseded.
--
-- An arrival is a point claim with no continuity, so two current arrival-only (v4) spells for one
-- player and club may coexist when their arrival dates differ: that is how a delisted and redrafted
-- player gets a second stint. Every other overlap rule is unchanged.

DO $migration$
DECLARE definition TEXT; old_fragment TEXT; new_fragment TEXT;
BEGIN
  definition:=pg_get_functiondef('validate_outcome_version_chain()'::regprocedure);
  old_fragment:=$old$              -- 0248: a season spell may sit inside any current reviewed stint for the same player and club.$old$;
  new_fragment:=$new$              -- 0249: two arrivals for one player and club on different dates are separate stints.
              AND NOT (COALESCE(NEW."registration_canonical_json"::JSONB->>'schemaVersion','')='afl-trade-acquisition-registration/v4'
                AND COALESCE(current_spell."registration_canonical_json"::JSONB->>'schemaVersion','')='afl-trade-acquisition-registration/v4'
                AND NEW."start_date"<>current_spell."start_date")
              -- 0248: a season spell may sit inside any current reviewed stint for the same player and club.$new$;
  IF definition IS NULL OR array_length(string_to_array(definition,old_fragment),1)<>2
    OR position('0249:' IN definition)>0 THEN
    RAISE EXCEPTION 'Expected exactly one deployed 0248 overlap fragment before 0249';
  END IF;
  definition:=replace(definition,old_fragment,new_fragment);
  IF replace(definition,new_fragment,old_fragment) IS DISTINCT FROM pg_get_functiondef('validate_outcome_version_chain()'::regprocedure) THEN
    RAISE EXCEPTION '0249 altered bytes outside its fragment in validate_outcome_version_chain()';
  END IF;
  EXECUTE definition;
END $migration$;

CREATE FUNCTION outcome_acquisition_stint(target_player TEXT, target_club TEXT, arrival_spell TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
DECLARE
  reviewed CONSTANT TEXT[] := ARRAY['afl-trade-acquisition-registration/v1',
    'afl-trade-acquisition-registration/v2','afl-trade-acquisition-registration/v4'];
  season_schema CONSTANT TEXT := 'afl-trade-acquisition-registration/v3';
  arrival RECORD; other_club RECORD; later_arrival RECORD;
  close_date DATE; closed_by JSONB; closing_season INTEGER;
  seasons JSONB; last_appearance DATE;
BEGIN
  SELECT spell.spell_version_id,spell.start_date,
         spell.registration_canonical_json::JSONB->>'schemaVersion' AS schema_version
    INTO arrival
    FROM outcome_acquisition_spell_version spell
   WHERE spell.spell_version_id=arrival_spell AND spell.player_id=target_player
     AND spell.club_id=target_club AND spell.status='approved'
     AND spell.registration_canonical_json::JSONB->>'schemaVersion'=ANY(reviewed)
     AND NOT EXISTS (SELECT 1 FROM outcome_acquisition_spell_version successor
       WHERE successor.supersedes_spell_version_id=spell.spell_version_id)
     AND outcome_acquisition_spell_registration_current(spell.spell_version_id,clock_timestamp());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'An acquisition stint starts at a current reviewed arrival for the same player and club';
  END IF;

  -- The first current season spell for the player at another club after the arrival.
  SELECT candidate.spell_version_id,candidate.start_date,candidate.season_year INTO other_club
    FROM (SELECT spell.spell_version_id,spell.start_date,
                 (spell.registration_canonical_json::JSONB->>'seasonYear')::INTEGER AS season_year
            FROM outcome_acquisition_spell_version spell
           WHERE spell.player_id=target_player AND spell.club_id<>target_club
             AND spell.status='approved' AND spell.start_date>arrival.start_date
             AND spell.registration_canonical_json::JSONB->>'schemaVersion'=season_schema
             AND NOT EXISTS (SELECT 1 FROM outcome_acquisition_spell_version successor
               WHERE successor.supersedes_spell_version_id=spell.spell_version_id)) candidate
   WHERE outcome_acquisition_spell_registration_current(candidate.spell_version_id,clock_timestamp())
   ORDER BY candidate.start_date,candidate.spell_version_id LIMIT 1;

  -- A later current reviewed arrival for the same player and club starts the next stint.
  SELECT candidate.spell_version_id,candidate.start_date INTO later_arrival
    FROM (SELECT spell.spell_version_id,spell.start_date
            FROM outcome_acquisition_spell_version spell
           WHERE spell.player_id=target_player AND spell.club_id=target_club
             AND spell.status='approved' AND spell.start_date>arrival.start_date
             AND spell.registration_canonical_json::JSONB->>'schemaVersion'=ANY(reviewed)
             AND NOT EXISTS (SELECT 1 FROM outcome_acquisition_spell_version successor
               WHERE successor.supersedes_spell_version_id=spell.spell_version_id)) candidate
   WHERE outcome_acquisition_spell_registration_current(candidate.spell_version_id,clock_timestamp())
   ORDER BY candidate.start_date,candidate.spell_version_id LIMIT 1;

  IF other_club.spell_version_id IS NOT NULL
     AND (later_arrival.spell_version_id IS NULL OR other_club.start_date<=later_arrival.start_date) THEN
    close_date:=other_club.start_date;
    closing_season:=other_club.season_year;
    closed_by:=jsonb_build_object('kind','season_spell_at_another_club',
      'spellVersionId',other_club.spell_version_id,'date',other_club.start_date);
  ELSIF later_arrival.spell_version_id IS NOT NULL THEN
    close_date:=later_arrival.start_date;
    closed_by:=jsonb_build_object('kind','later_arrival_at_same_club',
      'spellVersionId',later_arrival.spell_version_id,'date',later_arrival.start_date);
  END IF;

  -- Current season spells at the club from the arrival until the stint closes.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('seasonYear',season.season_year,
           'spellVersionId',season.spell_version_id,'firstAppearanceDate',season.start_date,
           'lastAppearanceDate',season.end_date) ORDER BY season.season_year),'[]'::JSONB),
         max(season.end_date)
    INTO seasons,last_appearance
    FROM (SELECT spell.spell_version_id,spell.start_date,spell.end_date,
                 (spell.registration_canonical_json::JSONB->>'seasonYear')::INTEGER AS season_year
            FROM outcome_acquisition_spell_version spell
           WHERE spell.player_id=target_player AND spell.club_id=target_club
             AND spell.status='approved' AND spell.start_date>=arrival.start_date
             AND (close_date IS NULL OR spell.start_date<close_date)
             AND spell.registration_canonical_json::JSONB->>'schemaVersion'=season_schema
             AND NOT EXISTS (SELECT 1 FROM outcome_acquisition_spell_version successor
               WHERE successor.supersedes_spell_version_id=spell.spell_version_id)) season
   WHERE outcome_acquisition_spell_registration_current(season.spell_version_id,clock_timestamp());

  -- A later arrival's stint begins with its first season spell at the club, if there is one yet.
  IF later_arrival.spell_version_id IS NOT NULL AND closing_season IS NULL THEN
    SELECT min((spell.registration_canonical_json::JSONB->>'seasonYear')::INTEGER) INTO closing_season
      FROM outcome_acquisition_spell_version spell
     WHERE spell.player_id=target_player AND spell.club_id=target_club
       AND spell.status='approved' AND spell.start_date>=later_arrival.start_date
       AND spell.registration_canonical_json::JSONB->>'schemaVersion'=season_schema
       AND NOT EXISTS (SELECT 1 FROM outcome_acquisition_spell_version successor
         WHERE successor.supersedes_spell_version_id=spell.spell_version_id)
       AND outcome_acquisition_spell_registration_current(spell.spell_version_id,clock_timestamp());
  END IF;

  RETURN jsonb_build_object(
    'schemaVersion','afl-trade-acquisition-stint/v1',
    'playerId',target_player,'clubId',target_club,
    'arrival',jsonb_build_object('spellVersionId',arrival.spell_version_id,
      'schemaVersion',arrival.schema_version,'date',arrival.start_date),
    'seasons',seasons,
    'closingSeason',closing_season,
    'closedBy',closed_by,
    'endDate',CASE WHEN closed_by IS NOT NULL THEN last_appearance END,
    'status',CASE WHEN jsonb_array_length(seasons)=0 THEN 'no_appearances'
      WHEN closed_by IS NOT NULL THEN 'closed' ELSE 'open' END);
END $$;

COMMENT ON FUNCTION outcome_acquisition_stint(TEXT,TEXT,TEXT) IS
  'A reviewed arrival and the current season spells at the same club until the first season at another club or a later arrival at the same club. Read-only; every spell read must be current.';
