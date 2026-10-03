-- HPN season input acquisition-spell currency is evaluated once per spell, not once per row, and
-- an appearance-membership (v3) spell's currency no longer re-verifies unrelated spells and facts.
--
-- Building or finalizing a genuine season input asked outcome_hpn_acquisition_spell_is_current once
-- per player-stat row (twice per row at finalization). Each call re-derived its spell's complete
-- registration currency, which is identical for every row bound to that spell. For a v3 spell the
-- derivation was also non-sargable: the planner turned its two NOT EXISTS checks into anti-joins
-- whose base scans evaluated outcome_acquisition_spell_registration_current for every reviewed
-- v1/v2 spell in the database, and outcome_acquisition_appearance_fact_identity_current for every
-- measured appearance fact, before correlating either with the spell's player and club. On a
-- genuine database one call took about a second, so a 2025 season (about 20,000 rows) exceeded a
-- 60-minute statement timeout.
--
-- Every currency rule and every fail-closed outcome is unchanged:
--  1. The two expensive v3 predicates are guarded by CASE on the conjuncts already beside them, so
--     they are evaluated only for the spell's own player, club, season and window candidates.
--     A conjunction A AND f() and A AND CASE WHEN A THEN f() ELSE FALSE END admit the same rows.
--  2. outcome_hpn_acquisition_spell_source_current is derived byte-for-byte from the deployed
--     per-row function; the only change is that the spell's registration currency is an argument.
--     The per-row function itself is unchanged for every other caller.
--  3. HPN input finalization evaluates each candidate spell's registration currency once, before
--     its row loop, with the same cutoff source (clock_timestamp()).
-- Every edit is fragment-asserted and reverse-asserted against the deployed definition.

DO $migration$
DECLARE
  original_definition TEXT;
  corrected_definition TEXT;
  completeness_fragment CONSTANT TEXT := $old$        AND NOT ((fact.effective_at AT TIME ZONE 'UTC')::DATE BETWEEN spell.start_date AND spell.end_date)
        AND outcome_acquisition_appearance_fact_identity_current(fact.appearance_fact_id))$old$;
  completeness_guarded CONSTANT TEXT := $new$        AND NOT ((fact.effective_at AT TIME ZONE 'UTC')::DATE BETWEEN spell.start_date AND spell.end_date)
        -- 0236: identity currency is derived only for this spell's own out-of-window candidates.
        AND CASE WHEN fact.player_id=spell.player_id AND fact.represented_club_id=spell.club_id
            AND fact.season_year=(c->>'seasonYear')::INTEGER AND fact.competition=c->>'competition'
            AND fact.availability='measured' AND fact.appeared=TRUE
            AND batch.environment::TEXT=c->>'environment' AND batch.status='approved'
            AND fact.recorded_at<=spell.recorded_at
            AND NOT ((fact.effective_at AT TIME ZONE 'UTC')::DATE BETWEEN spell.start_date AND spell.end_date)
          THEN outcome_acquisition_appearance_fact_identity_current(fact.appearance_fact_id)
          ELSE FALSE END)$new$;
  retirement_fragment CONSTANT TEXT := $old$        AND outcome_acquisition_possible_membership(reviewed) @> daterange(spell.start_date,spell.end_date,'[]')
        AND outcome_acquisition_spell_registration_current(reviewed.spell_version_id,cutoff))$old$;
  retirement_guarded CONSTANT TEXT := $new$        AND outcome_acquisition_possible_membership(reviewed) @> daterange(spell.start_date,spell.end_date,'[]')
        -- 0236: only a same-player, same-club covering reviewed spell is re-verified.
        AND CASE WHEN reviewed.player_id=spell.player_id AND reviewed.club_id=spell.club_id
            AND reviewed.status='approved' AND reviewed.registration_canonical_json IS NOT NULL
            AND reviewed.registration_canonical_json::JSONB->>'schemaVersion' IN
              ('afl-trade-acquisition-registration/v1','afl-trade-acquisition-registration/v2')
            AND reviewed.recorded_at<=cutoff
            AND outcome_acquisition_possible_membership(reviewed) @> daterange(spell.start_date,spell.end_date,'[]')
          THEN outcome_acquisition_spell_registration_current(reviewed.spell_version_id,cutoff)
          ELSE FALSE END)$new$;
BEGIN
  SELECT pg_get_functiondef('outcome_acquisition_appearance_spell_registration_current(text,timestamptz)'::regprocedure)
    INTO original_definition;
  IF original_definition IS NULL
    OR (length(original_definition)-length(replace(original_definition,completeness_fragment,'')))/length(completeness_fragment)<>1
    OR (length(original_definition)-length(replace(original_definition,retirement_fragment,'')))/length(retirement_fragment)<>1
    OR position('0236:' IN original_definition)>0 THEN
    RAISE EXCEPTION 'Expected exact appearance-membership registration currency before 0236';
  END IF;
  corrected_definition:=replace(replace(original_definition,completeness_fragment,completeness_guarded),
    retirement_fragment,retirement_guarded);
  IF replace(replace(corrected_definition,completeness_guarded,completeness_fragment),
      retirement_guarded,retirement_fragment) IS DISTINCT FROM original_definition THEN
    RAISE EXCEPTION 'Sargable appearance-membership currency altered unrelated bytes';
  END IF;
  EXECUTE corrected_definition;
END $migration$;

DO $migration$
DECLARE
  original_definition TEXT;
  derived_definition TEXT;
  original_signature CONSTANT TEXT := 'outcome_hpn_acquisition_spell_is_current(target_spell text, target_row text, target_run text, target_map text, effective_date date, cutoff timestamp with time zone)';
  derived_signature CONSTANT TEXT := 'outcome_hpn_acquisition_spell_source_current(target_spell text, target_row text, target_run text, target_map text, effective_date date, spell_registration_is_current boolean)';
  original_registration CONSTANT TEXT := 'outcome_acquisition_spell_registration_current(target_spell,cutoff)';
  derived_registration CONSTANT TEXT := 'spell_registration_is_current';
BEGIN
  IF to_regprocedure('outcome_hpn_acquisition_spell_source_current(text,text,text,text,date,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'HPN acquisition source currency already exists before 0236';
  END IF;
  SELECT pg_get_functiondef('outcome_hpn_acquisition_spell_is_current(text,text,text,text,date,timestamptz)'::regprocedure)
    INTO original_definition;
  IF original_definition IS NULL
    OR (length(original_definition)-length(replace(original_definition,original_signature,'')))/length(original_signature)<>1
    OR (length(original_definition)-length(replace(original_definition,original_registration,'')))/length(original_registration)<>1
    -- The cutoff is consumed only by the spell's registration currency.
    OR (length(original_definition)-length(replace(original_definition,'cutoff','')))/length('cutoff')<>2
    OR position(derived_registration IN original_definition)>0 THEN
    RAISE EXCEPTION 'Expected exact per-row HPN acquisition currency before 0236';
  END IF;
  derived_definition:=replace(replace(original_definition,original_signature,derived_signature),
    original_registration,derived_registration);
  IF replace(replace(derived_definition,derived_signature,original_signature),
      derived_registration,original_registration) IS DISTINCT FROM original_definition THEN
    RAISE EXCEPTION 'Derived HPN acquisition source currency differs beyond its registration argument';
  END IF;
  EXECUTE derived_definition;
END $migration$;

COMMENT ON FUNCTION outcome_hpn_acquisition_spell_source_current(TEXT,TEXT,TEXT,TEXT,DATE,BOOLEAN) IS
  'outcome_hpn_acquisition_spell_is_current with the spell''s registration currency supplied by a set-based caller that evaluates it once per spell.';

DO $migration$
DECLARE
  original_definition TEXT;
  corrected_definition TEXT;
  declare_fragment CONSTANT TEXT := 'lock_subject TEXT; row_record RECORD;';
  declare_hoisted CONSTANT TEXT := 'lock_subject TEXT; row_record RECORD; registered_spells TEXT[];';
  loop_fragment CONSTANT TEXT := $old$
  FOR row_record IN SELECT * FROM "outcome_hpn_pav_input_row"
    WHERE "input_set_id"=NEW."input_set_id"
  LOOP$old$;
  loop_hoisted CONSTANT TEXT := $new$
  -- 0236: each candidate spell's registration currency is evaluated once, not once per row.
  -- Candidates are every approved spell for a row's player and club covering its match date,
  -- a superset of the spells either per-row check below can consider.
  registered_spells:=ARRAY(
    SELECT candidate.spell_version_id FROM (
      SELECT DISTINCT spell."spell_version_id"
        FROM "outcome_hpn_pav_input_row" member
        JOIN "outcome_hpn_pav_input_match" member_match
          ON member_match."input_set_id"=member."input_set_id"
         AND member_match."match_id"=member."row_json"#>>'{match,canonicalId}'
        JOIN "outcome_acquisition_spell_version" spell
          ON spell."player_id"=member."row_json"#>>'{player,canonicalId}'
         AND spell."club_id"=member."row_json"#>>'{club,canonicalId}'
         AND spell."start_date"<=member_match."effective_at"::DATE
         AND (spell."end_date" IS NULL OR spell."end_date">=member_match."effective_at"::DATE)
       WHERE member."input_set_id"=NEW."input_set_id" AND spell."status"='approved'
    ) candidate
    WHERE outcome_acquisition_spell_registration_current(candidate.spell_version_id,clock_timestamp()));
  FOR row_record IN SELECT * FROM "outcome_hpn_pav_input_row"
    WHERE "input_set_id"=NEW."input_set_id"
  LOOP$new$;
  eligible_fragment CONSTANT TEXT := $old$
         AND outcome_hpn_acquisition_spell_is_current(eligible."spell_version_id",
           row_record."provider_decoded_row_id",row_record."normalization_run_id",
           (SELECT projected_field_map_id FROM outcome_hpn_pav_input_run
             WHERE input_set_id=NEW.input_set_id AND normalization_run_id=row_record.normalization_run_id),
           eligible_match."effective_at"::DATE,clock_timestamp())$old$;
  eligible_hoisted CONSTANT TEXT := $new$
         AND outcome_hpn_acquisition_spell_source_current(eligible."spell_version_id",
           row_record."provider_decoded_row_id",row_record."normalization_run_id",
           (SELECT projected_field_map_id FROM outcome_hpn_pav_input_run
             WHERE input_set_id=NEW.input_set_id AND normalization_run_id=row_record.normalization_run_id),
           eligible_match."effective_at"::DATE,eligible."spell_version_id"=ANY(registered_spells))$new$;
  selected_fragment CONSTANT TEXT := $old$
           AND outcome_hpn_acquisition_spell_is_current(spell."spell_version_id",
             row_record."provider_decoded_row_id",row_record."normalization_run_id",
             (SELECT projected_field_map_id FROM outcome_hpn_pav_input_run
               WHERE input_set_id=NEW.input_set_id AND normalization_run_id=row_record.normalization_run_id),
             match_member."effective_at"::DATE,clock_timestamp())$old$;
  selected_hoisted CONSTANT TEXT := $new$
           AND outcome_hpn_acquisition_spell_source_current(spell."spell_version_id",
             row_record."provider_decoded_row_id",row_record."normalization_run_id",
             (SELECT projected_field_map_id FROM outcome_hpn_pav_input_run
               WHERE input_set_id=NEW.input_set_id AND normalization_run_id=row_record.normalization_run_id),
             match_member."effective_at"::DATE,spell."spell_version_id"=ANY(registered_spells))$new$;
  fragment TEXT;
BEGIN
  SELECT pg_get_functiondef('finalize_outcome_hpn_pav_input_set_v2()'::regprocedure) INTO original_definition;
  IF original_definition IS NULL OR position('registered_spells' IN original_definition)>0 THEN
    RAISE EXCEPTION 'Expected HPN input finalization before 0236';
  END IF;
  FOREACH fragment IN ARRAY ARRAY[declare_fragment,loop_fragment,eligible_fragment,selected_fragment] LOOP
    IF (length(original_definition)-length(replace(original_definition,fragment,'')))/length(fragment)<>1 THEN
      RAISE EXCEPTION 'Expected exactly one HPN finalization fragment before 0236: %',left(fragment,80);
    END IF;
  END LOOP;
  IF (length(original_definition)-length(replace(original_definition,'outcome_hpn_acquisition_spell_is_current','')))
      /length('outcome_hpn_acquisition_spell_is_current')<>2 THEN
    RAISE EXCEPTION 'Expected exactly two per-row HPN acquisition currency calls before 0236';
  END IF;
  corrected_definition:=replace(replace(replace(replace(original_definition,
    declare_fragment,declare_hoisted),loop_fragment,loop_hoisted),
    eligible_fragment,eligible_hoisted),selected_fragment,selected_hoisted);
  IF replace(replace(replace(replace(corrected_definition,
      selected_hoisted,selected_fragment),eligible_hoisted,eligible_fragment),
      loop_hoisted,loop_fragment),declare_hoisted,declare_fragment) IS DISTINCT FROM original_definition
    OR position('outcome_hpn_acquisition_spell_is_current' IN corrected_definition)>0 THEN
    RAISE EXCEPTION 'Hoisted HPN finalization altered unrelated bytes';
  END IF;
  EXECUTE corrected_definition;
END $migration$;
