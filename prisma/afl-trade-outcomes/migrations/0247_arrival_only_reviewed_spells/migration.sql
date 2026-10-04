-- Arrival-only reviewed acquisition spells (registration v4), and season spells inside a reviewed stint.
--
-- A reviewed entry spell (v1) proves two things: how the player arrived, and, through continuity
-- evidence and observedThrough, that he was still at the club up to a date. The second claim needs
-- fresh evidence every season, and its evidence is what went missing for all 247 v1 spells. Season
-- (v3) appearance spells already prove continuity from match records the database verifies.
--
-- A v4 spell claims the arrival only. Its entry is checked exactly as a v1 entry is: the exact
-- promoted event and incoming player asset, a current entry event, exact entry evidence, a current
-- review and an intact version chain. It carries no observedThrough, no continuity evidence and no
-- departure; whether the player is still at the club in a season comes from that season's v3 spell.
-- A v4 spell may supersede a v1, v2 or v4 spell for the same player and club, which is how a reviewed
-- spell whose evidence was lost is re-made. HPN season attribution never binds a v4 spell: it reads
-- observedThrough from the spell, and season statistics bind season spells.
--
-- The overlap guard now admits a v3 season spell inside a current arrival-only (v4) stint for the
-- same player and club. Reviewed spells still cannot overlap one another, v3 spells still cannot
-- overlap one another, and a v1/v2 spell still excludes v3 spells and retires those inside it; that
-- changes together with HPN binding. A v4 spell does not retire them.
--
-- Function bodies assembled by fragment replacement are edited in place from their deployed
-- definitions, and every edit asserts its exact fragment first. No existing row changes.

ALTER TABLE outcome_acquisition_spell_rule DROP CONSTRAINT outcome_acquisition_rule_registration_tuple;
ALTER TABLE outcome_acquisition_spell_rule ADD CONSTRAINT outcome_acquisition_rule_registration_tuple CHECK (
 (registration_canonical_json IS NULL AND registration_approval_decision_id IS NULL AND registered_at IS NULL
  AND COALESCE(definition_json#>>'{content,schemaVersion}','') NOT IN ('afl-trade-acquisition-registration-rule/v1',
   'afl-trade-acquisition-registration-rule/v2','afl-trade-acquisition-registration-rule/v3',
   'afl-trade-acquisition-registration-rule/v4')) OR
 (registration_canonical_json IS NOT NULL AND registration_approval_decision_id IS NOT NULL AND registered_at IS NOT NULL)
);

DO $migration$
DECLARE definition TEXT; old_fragment TEXT; new_fragment TEXT;
BEGIN
 definition:=pg_get_functiondef('outcome_acquisition_rule_registration_current(text,timestamp with time zone)'::regprocedure);
 old_fragment:=$old$        OR (c->>'schemaVersion'='afl-trade-acquisition-registration-rule/v3'$old$;
 new_fragment:=$new$        OR (c->>'schemaVersion'='afl-trade-acquisition-registration-rule/v4'
          AND c=jsonb_build_object('schemaVersion','afl-trade-acquisition-registration-rule/v4',
            'environment',c->'environment','competition',c->'competition','ruleVersion',rule.rule_version,
            'entry','exact_promoted_incoming_player_asset_on_event_date',
            'departure','none_continuity_from_appearance_spells',
            'intervals','arrival_only_open_stint_no_same_club_reviewed_overlap',
            'missingEvidence','reject_never_infer_from_appearances',
            'evidence',c->'evidence','createdAt',c->'createdAt'))
        OR (c->>'schemaVersion'='afl-trade-acquisition-registration-rule/v3'$new$;
 IF array_length(string_to_array(definition,old_fragment),1)<>2 THEN
   RAISE EXCEPTION 'Expected exactly one v3 rule branch in the rule registration currency function';
 END IF;
 EXECUTE replace(definition,old_fragment,new_fragment);
END $migration$;

CREATE FUNCTION outcome_acquisition_arrival_spell_registration_current(target_id TEXT, cutoff TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM outcome_acquisition_spell_version spell
  JOIN outcome_acquisition_spell_rule rule ON rule.rule_id=spell.rule_id
  CROSS JOIN LATERAL (SELECT spell.registration_canonical_json::JSONB AS c) content
  WHERE spell.spell_version_id=target_id AND spell.status='approved'
    AND spell.registration_canonical_json IS NOT NULL
    AND spell.registration_canonical_json=outcome_afl_trade_canonical_json(c)
    AND spell.spell_version_id='acquisition-spell-version:'||encode(sha256(convert_to(spell.registration_canonical_json,'UTF8')),'hex')
    AND c=jsonb_build_object('schemaVersion','afl-trade-acquisition-registration/v4',
      'environment',c->'environment','competition',c->'competition','playerId',spell.player_id,
      'clubId',spell.club_id,'entry',c->'entry','ruleId',spell.rule_id,
      'version',spell.version,'supersedesSpellVersionId',spell.supersedes_spell_version_id,
      'createdAt',c->'createdAt')
    AND c->>'environment'=rule.definition_json#>>'{content,environment}'
    AND c->>'competition'=rule.definition_json#>>'{content,competition}'
    AND rule.definition_json#>>'{content,schemaVersion}'='afl-trade-acquisition-registration-rule/v4'
    AND outcome_acquisition_rule_registration_current(rule.rule_id,cutoff)
    AND (c->>'createdAt')::TIMESTAMPTZ=spell.recorded_at
    AND c#>>'{entry,eventVersionId}'=spell.start_event_version_id
    AND c#>>'{entry,assetVersionId}'=spell.start_asset_version_id
    AND (c#>>'{entry,eventDate}')::DATE=spell.start_date
    AND spell.start_date<=(spell.recorded_at AT TIME ZONE 'UTC')::DATE
    AND spell.end_date IS NULL AND spell.end_reason IS NULL
    AND outcome_acquisition_registration_event_current(c->'entry',spell.player_id,spell.club_id,
      c->>'environment',c->>'competition',TRUE,spell.recorded_at,cutoff)
    AND outcome_acquisition_registration_review_current(spell.registration_approval_decision_id,
      'acquisition_spell_registration',spell.spell_version_id,
      jsonb_build_object('spellVersionId',spell.spell_version_id,'content',c),spell.recorded_at,spell.registered_at,cutoff)
    AND NOT EXISTS (SELECT 1 FROM outcome_acquisition_spell_version successor WHERE successor.supersedes_spell_version_id=spell.spell_version_id)
    AND ((spell.version=1 AND spell.supersedes_spell_version_id IS NULL AND spell.spell_id=spell.spell_version_id)
      OR EXISTS (SELECT 1 FROM outcome_acquisition_spell_version predecessor
        WHERE predecessor.spell_version_id=spell.supersedes_spell_version_id
          AND predecessor.registration_canonical_json IS NOT NULL
          -- An arrival re-makes a reviewed entry spell, never an appearance-membership spell.
          AND predecessor.registration_canonical_json::JSONB->>'schemaVersion' IN
            ('afl-trade-acquisition-registration/v1','afl-trade-acquisition-registration/v2',
             'afl-trade-acquisition-registration/v4')
          AND predecessor.spell_id=spell.spell_id AND predecessor.player_id=spell.player_id
          AND predecessor.club_id=spell.club_id AND predecessor.version+1=spell.version
          AND predecessor.recorded_at<=spell.recorded_at))
 )
$$;

CREATE OR REPLACE FUNCTION outcome_acquisition_spell_registration_current(target_id TEXT, cutoff TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT COALESCE((SELECT CASE spell.registration_canonical_json::JSONB->>'schemaVersion'
 WHEN 'afl-trade-acquisition-registration/v2' THEN outcome_acquisition_window_spell_registration_current(target_id,cutoff)
 WHEN 'afl-trade-acquisition-registration/v3' THEN outcome_acquisition_appearance_spell_registration_current(target_id,cutoff)
 WHEN 'afl-trade-acquisition-registration/v4' THEN outcome_acquisition_arrival_spell_registration_current(target_id,cutoff)
 ELSE outcome_acquisition_exact_spell_registration_current(target_id,cutoff)
   AND rule.definition_json#>>'{content,schemaVersion}'='afl-trade-acquisition-registration-rule/v1' END
 FROM outcome_acquisition_spell_version spell JOIN outcome_acquisition_spell_rule rule USING(rule_id)
 WHERE spell.spell_version_id=target_id),FALSE)
$$;

-- Trade-attribution consumers keep rejecting v2 windows and v3 appearance membership. HPN season PAV
-- calculation binds season statistics to season spells and never to an arrival-only spell.
CREATE OR REPLACE FUNCTION require_outcome_exact_acquisition_consumer() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE referenced_spell_version_id TEXT; referenced_schema TEXT;
BEGIN
  IF TG_TABLE_NAME = 'outcome_valuation_dataset_row' THEN
    referenced_spell_version_id := NEW.acquisition_spell_version_id;
  ELSE
    referenced_spell_version_id := NEW.spell_version_id;
  END IF;
  SELECT spell.registration_canonical_json::JSONB->>'schemaVersion' INTO referenced_schema
    FROM outcome_acquisition_spell_version spell
   WHERE spell.spell_version_id = referenced_spell_version_id;
  IF referenced_schema = 'afl-trade-acquisition-registration/v2' THEN
    RAISE EXCEPTION 'Window acquisition requires interval-aware metric and release qualification';
  END IF;
  IF referenced_schema = 'afl-trade-acquisition-registration/v3'
     AND TG_TABLE_NAME <> 'outcome_hpn_pav_calculation_player' THEN
    RAISE EXCEPTION 'Appearance-membership acquisition is limited to HPN season PAV attribution';
  END IF;
  IF referenced_schema = 'afl-trade-acquisition-registration/v4'
     AND TG_TABLE_NAME = 'outcome_hpn_pav_calculation_player' THEN
    RAISE EXCEPTION 'HPN season PAV attribution binds season spells, not arrival-only spells';
  END IF;
  RETURN NEW;
END $$;

DO $migration$
DECLARE definition TEXT; old_fragment TEXT; new_fragment TEXT;
BEGIN
 definition:=pg_get_functiondef('validate_outcome_version_chain()'::regprocedure);

 -- A season spell may sit inside a current arrival-only stint for the same player and club.
 old_fragment:=$old$                AND outcome_acquisition_possible_membership(NEW) @> outcome_acquisition_possible_membership(current_spell))$old$;
 new_fragment:=$new$                AND outcome_acquisition_possible_membership(NEW) @> outcome_acquisition_possible_membership(current_spell))
              AND NOT (COALESCE(NEW."registration_canonical_json"::JSONB->>'schemaVersion','')='afl-trade-acquisition-registration/v3'
                AND COALESCE(current_spell."registration_canonical_json"::JSONB->>'schemaVersion','')='afl-trade-acquisition-registration/v4'
                AND outcome_acquisition_possible_membership(current_spell) @> outcome_acquisition_possible_membership(NEW))$new$;
 IF array_length(string_to_array(definition,old_fragment),1)<>2 THEN
   RAISE EXCEPTION 'Expected exactly one reviewed-over-season overlap allowance';
 END IF;
 EXECUTE replace(definition,old_fragment,new_fragment);
END $migration$;
