-- Appearance-membership acquisition spells (registration v3): a labelled bridge for league-wide
-- season PAV attribution only.
--
-- HPN season PAV aggregates every primary player-match row of a season under exactly one current
-- acquisition spell, so one unregistered player blocks the whole season. Reviewed entry spells
-- (v1/v2) require a promoted incoming asset, which does not yet exist for most league players.
--
-- A v3 spell binds one player, one represented club and one season to the first and last reviewed
-- appearance facts in that season. It carries no entry or departure event and claims nothing about
-- how or when the player joined or left. It may be consumed only by HPN season PAV calculation;
-- every trade-attribution consumer (metrics, releases, valuation datasets, player PAV observations)
-- keeps rejecting it. A current reviewed entry spell covering its window retires it.
--
-- Existing function bodies that are assembled by fragment replacement across earlier migrations are
-- edited in place from their deployed definitions, and every edit asserts its exact fragment first.

ALTER TABLE outcome_acquisition_spell_version ALTER COLUMN start_event_version_id DROP NOT NULL;
ALTER TABLE outcome_acquisition_spell_version ALTER COLUMN start_asset_version_id DROP NOT NULL;
ALTER TABLE outcome_acquisition_spell_version ADD CONSTRAINT outcome_acquisition_appearance_membership_tuple CHECK (
 CASE WHEN COALESCE(registration_canonical_json::JSONB->>'schemaVersion','')='afl-trade-acquisition-registration/v3'
 THEN start_event_version_id IS NULL AND start_asset_version_id IS NULL
   AND start_date IS NOT NULL AND end_date IS NOT NULL
   AND end_reason='last_reviewed_appearance_in_season'
 ELSE start_event_version_id IS NOT NULL AND start_asset_version_id IS NOT NULL END
);

ALTER TABLE outcome_acquisition_spell_rule DROP CONSTRAINT outcome_acquisition_rule_registration_tuple;
ALTER TABLE outcome_acquisition_spell_rule ADD CONSTRAINT outcome_acquisition_rule_registration_tuple CHECK (
 (registration_canonical_json IS NULL AND registration_approval_decision_id IS NULL AND registered_at IS NULL
  AND COALESCE(definition_json#>>'{content,schemaVersion}','') NOT IN ('afl-trade-acquisition-registration-rule/v1',
   'afl-trade-acquisition-registration-rule/v2','afl-trade-acquisition-registration-rule/v3')) OR
 (registration_canonical_json IS NOT NULL AND registration_approval_decision_id IS NOT NULL AND registered_at IS NOT NULL)
);

CREATE OR REPLACE FUNCTION outcome_acquisition_rule_registration_current(target_id TEXT, cutoff TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM outcome_acquisition_spell_rule rule
    CROSS JOIN LATERAL (SELECT rule.definition_json->'content' AS c) content
    WHERE rule.rule_id=target_id AND rule.status='approved'
      AND rule.registration_canonical_json IS NOT NULL
      AND rule.registration_canonical_json=outcome_afl_trade_canonical_json(c)
      AND rule.rule_id='acquisition-spell-rule:'||encode(sha256(convert_to(rule.registration_canonical_json,'UTF8')),'hex')
      AND rule.definition_json=jsonb_build_object('ruleId',rule.rule_id,'content',c)
      AND (
        (c->>'schemaVersion' IN ('afl-trade-acquisition-registration-rule/v1','afl-trade-acquisition-registration-rule/v2')
          AND c=jsonb_build_object('schemaVersion',c->>'schemaVersion',
            'environment',c->'environment','competition',c->'competition','ruleVersion',rule.rule_version,
            'entry',CASE WHEN c->>'schemaVersion'='afl-trade-acquisition-registration-rule/v2' THEN 'reviewed_incoming_asset_with_explicit_date_precision' ELSE 'exact_promoted_incoming_player_asset_on_event_date' END,
            'departure',CASE WHEN c->>'schemaVersion'='afl-trade-acquisition-registration-rule/v2' THEN 'reviewed_departure_bounds_day_excluded' ELSE 'exact_reviewed_departure_event_day_excluded' END,
            'intervals',CASE WHEN c->>'schemaVersion'='afl-trade-acquisition-registration-rule/v2' THEN 'possible_and_certain_membership_no_inferred_boundary_days' ELSE 'inclusive_start_inclusive_end_no_same_club_overlap' END,
            'missingEvidence','reject_never_infer_from_appearances',
            'evidence',c->'evidence','createdAt',c->'createdAt'))
        OR (c->>'schemaVersion'='afl-trade-acquisition-registration-rule/v3'
          AND c=jsonb_build_object('schemaVersion','afl-trade-acquisition-registration-rule/v3',
            'environment',c->'environment','competition',c->'competition','ruleVersion',rule.rule_version,
            'entry','first_reviewed_appearance_fact_in_season',
            'departure','none_last_reviewed_appearance_fact_in_season',
            'intervals','reviewed_appearance_window_within_one_season',
            'missingEvidence','reject_rows_outside_reviewed_appearance_window',
            'purpose','hpn_season_pav_attribution_only',
            'retirement','retired_by_covering_reviewed_entry_spell',
            'evidence',c->'evidence','createdAt',c->'createdAt'))
      )
      AND c->>'environment' IN ('test_fixture','non_production')
      AND c->>'competition' IN ('AFLM','AFLW')
      AND (c->>'createdAt')::TIMESTAMPTZ=rule.created_at
      AND outcome_acquisition_registration_evidence_exact(c->'evidence',c->>'environment',rule.created_at,rule.registered_at)
      AND outcome_acquisition_registration_review_current(rule.registration_approval_decision_id,
        'acquisition_spell_rule',rule.rule_id,rule.definition_json,rule.created_at,rule.registered_at,cutoff)
  )
$$;

-- One reviewed, measured appearance of this player for this represented club in this season.
CREATE FUNCTION outcome_acquisition_appearance_binding_current(
  binding JSONB, target_player TEXT, target_club TEXT, target_season INTEGER,
  target_environment TEXT, target_competition TEXT, cutoff TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_typeof(binding)='object'
    AND binding=jsonb_build_object('appearanceFactId',binding->'appearanceFactId',
      'matchId',binding->'matchId','date',binding->'date')
    AND EXISTS (
      SELECT 1 FROM outcome_provider_player_appearance_fact fact
      JOIN outcome_provider_fact_batch batch ON batch.fact_batch_id=fact.fact_batch_id
      JOIN outcome_match match ON match.match_id=fact.match_id
      WHERE fact.appearance_fact_id=binding->>'appearanceFactId'
        AND fact.match_id=binding->>'matchId'
        AND fact.player_id=target_player AND fact.represented_club_id=target_club
        AND fact.season_year=target_season AND fact.competition=target_competition
        AND fact.availability='measured' AND fact.appeared=TRUE
        AND (fact.effective_at AT TIME ZONE 'UTC')::DATE=(binding->>'date')::DATE
        AND target_club IN (match.home_club_id,match.away_club_id)
        AND batch.environment::TEXT=target_environment AND batch.status='approved'
        AND fact.recorded_at<=cutoff),FALSE)
$$;

CREATE FUNCTION outcome_acquisition_appearance_spell_registration_current(target_id TEXT, cutoff TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM outcome_acquisition_spell_version spell
  JOIN outcome_acquisition_spell_rule rule ON rule.rule_id=spell.rule_id
  CROSS JOIN LATERAL (SELECT spell.registration_canonical_json::JSONB AS c) content
  WHERE spell.spell_version_id=target_id AND spell.status='approved'
    AND spell.registration_canonical_json IS NOT NULL
    AND spell.registration_canonical_json=outcome_afl_trade_canonical_json(c)
    AND spell.spell_version_id='acquisition-spell-version:'||encode(sha256(convert_to(spell.registration_canonical_json,'UTF8')),'hex')
    AND c=jsonb_build_object('schemaVersion','afl-trade-acquisition-registration/v3',
      'environment',c->'environment','competition',c->'competition','playerId',spell.player_id,
      'clubId',spell.club_id,'seasonYear',c->'seasonYear','firstAppearance',c->'firstAppearance',
      'lastAppearance',c->'lastAppearance','ruleId',spell.rule_id,'version',spell.version,
      'supersedesSpellVersionId',spell.supersedes_spell_version_id,
      'observedThrough',c->'observedThrough','createdAt',c->'createdAt')
    AND c->>'environment'=rule.definition_json#>>'{content,environment}'
    AND c->>'competition'=rule.definition_json#>>'{content,competition}'
    AND rule.definition_json#>>'{content,schemaVersion}'='afl-trade-acquisition-registration-rule/v3'
    AND outcome_acquisition_rule_registration_current(rule.rule_id,cutoff)
    AND (c->>'createdAt')::TIMESTAMPTZ=spell.recorded_at
    AND spell.start_event_version_id IS NULL AND spell.start_asset_version_id IS NULL
    AND spell.start_date=(c#>>'{firstAppearance,date}')::DATE
    AND spell.end_date=(c#>>'{lastAppearance,date}')::DATE
    AND spell.end_reason='last_reviewed_appearance_in_season'
    AND spell.start_date<=spell.end_date
    AND extract(YEAR FROM spell.start_date)=(c->>'seasonYear')::INTEGER
    AND extract(YEAR FROM spell.end_date)=(c->>'seasonYear')::INTEGER
    AND (c->>'observedThrough')::DATE=spell.end_date
    AND (c->>'observedThrough')::DATE<=(spell.recorded_at AT TIME ZONE 'UTC')::DATE
    AND outcome_acquisition_appearance_binding_current(c->'firstAppearance',spell.player_id,spell.club_id,
      (c->>'seasonYear')::INTEGER,c->>'environment',c->>'competition',spell.recorded_at)
    AND outcome_acquisition_appearance_binding_current(c->'lastAppearance',spell.player_id,spell.club_id,
      (c->>'seasonYear')::INTEGER,c->>'environment',c->>'competition',spell.recorded_at)
    -- The window is complete: no reviewed appearance for this player, club and season lies outside it.
    AND NOT EXISTS (
      SELECT 1 FROM outcome_provider_player_appearance_fact fact
      JOIN outcome_provider_fact_batch batch ON batch.fact_batch_id=fact.fact_batch_id
      WHERE fact.player_id=spell.player_id AND fact.represented_club_id=spell.club_id
        AND fact.season_year=(c->>'seasonYear')::INTEGER AND fact.competition=c->>'competition'
        AND fact.availability='measured' AND fact.appeared=TRUE
        AND batch.environment::TEXT=c->>'environment' AND batch.status='approved'
        AND fact.recorded_at<=spell.recorded_at
        AND NOT ((fact.effective_at AT TIME ZONE 'UTC')::DATE BETWEEN spell.start_date AND spell.end_date))
    AND outcome_acquisition_registration_review_current(spell.registration_approval_decision_id,
      'acquisition_spell_registration',spell.spell_version_id,
      jsonb_build_object('spellVersionId',spell.spell_version_id,'content',c),spell.recorded_at,spell.registered_at,cutoff)
    AND NOT EXISTS (SELECT 1 FROM outcome_acquisition_spell_version successor WHERE successor.supersedes_spell_version_id=spell.spell_version_id)
    -- A reviewed entry spell covering this window retires it: appearance membership is a bridge only.
    AND NOT EXISTS (
      SELECT 1 FROM outcome_acquisition_spell_version reviewed
      WHERE reviewed.player_id=spell.player_id AND reviewed.club_id=spell.club_id
        AND reviewed.status='approved' AND reviewed.registration_canonical_json IS NOT NULL
        AND reviewed.registration_canonical_json::JSONB->>'schemaVersion' IN
          ('afl-trade-acquisition-registration/v1','afl-trade-acquisition-registration/v2')
        AND reviewed.recorded_at<=cutoff
        AND outcome_acquisition_possible_membership(reviewed) && daterange(spell.start_date,spell.end_date,'[]')
        AND outcome_acquisition_spell_registration_current(reviewed.spell_version_id,cutoff))
    AND ((spell.version=1 AND spell.supersedes_spell_version_id IS NULL AND spell.spell_id=spell.spell_version_id)
      OR EXISTS (SELECT 1 FROM outcome_acquisition_spell_version predecessor
        WHERE predecessor.spell_version_id=spell.supersedes_spell_version_id
          AND predecessor.registration_canonical_json IS NOT NULL
          -- Appearance membership only extends appearance membership for the same season.
          AND predecessor.registration_canonical_json::JSONB->>'schemaVersion'='afl-trade-acquisition-registration/v3'
          AND predecessor.registration_canonical_json::JSONB->>'seasonYear'=c->>'seasonYear'
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
 ELSE outcome_acquisition_exact_spell_registration_current(target_id,cutoff)
   AND rule.definition_json#>>'{content,schemaVersion}'='afl-trade-acquisition-registration-rule/v1' END
 FROM outcome_acquisition_spell_version spell JOIN outcome_acquisition_spell_rule rule USING(rule_id)
 WHERE spell.spell_version_id=target_id),FALSE)
$$;

-- True only for a stored appearance-membership (v3) spell under an approved v3 rule.
CREATE FUNCTION outcome_acquisition_is_appearance_membership(target_id TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT COALESCE((SELECT spell.registration_canonical_json::JSONB->>'schemaVersion'='afl-trade-acquisition-registration/v3'
   AND spell.start_event_version_id IS NULL AND spell.start_asset_version_id IS NULL
   AND rule.status='approved'::"OutcomeRecordStatus"
   AND rule.definition_json#>>'{content,schemaVersion}'='afl-trade-acquisition-registration-rule/v3'
 FROM outcome_acquisition_spell_version spell JOIN outcome_acquisition_spell_rule rule USING(rule_id)
 WHERE spell.spell_version_id=target_id),FALSE)
$$;

-- Trade-attribution consumers keep rejecting v2 windows and now also v3 appearance membership.
-- Only HPN season PAV calculation may consume a v3 spell.
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
  RETURN NEW;
END $$;

DO $migration$
DECLARE definition TEXT; old_fragment TEXT; new_fragment TEXT;
BEGIN
 -- Spell chain integrity: a v3 spell has no start asset; it still requires an approved v3 rule.
 definition:=pg_get_functiondef('validate_outcome_version_chain()'::regprocedure);
 old_fragment:=$old$        IF NOT EXISTS (
            SELECT 1 FROM "outcome_event_asset" asset
            JOIN "outcome_acquisition_spell_rule" rule ON rule."rule_id" = NEW."rule_id"
            WHERE asset."asset_version_id" = NEW."start_asset_version_id"$old$;
 new_fragment:=$new$        IF NOT (
            (COALESCE(NEW."registration_canonical_json"::JSONB->>'schemaVersion','')='afl-trade-acquisition-registration/v3'
             AND NEW."start_event_version_id" IS NULL AND NEW."start_asset_version_id" IS NULL
             AND EXISTS (SELECT 1 FROM "outcome_acquisition_spell_rule" rule
               WHERE rule."rule_id" = NEW."rule_id" AND rule."status" = 'approved'::"OutcomeRecordStatus"
                 AND rule."definition_json"#>>'{content,schemaVersion}'='afl-trade-acquisition-registration-rule/v3'))
            OR EXISTS (
            SELECT 1 FROM "outcome_event_asset" asset
            JOIN "outcome_acquisition_spell_rule" rule ON rule."rule_id" = NEW."rule_id"
            WHERE asset."asset_version_id" = NEW."start_asset_version_id"$new$;
 IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Expected acquisition start-asset guard'; END IF;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old$              AND rule."status" = 'approved'::"OutcomeRecordStatus"
        ) THEN
            RAISE EXCEPTION 'Acquisition spells require an exact approved start asset and rule';$old$;
 new_fragment:=$new$              AND rule."status" = 'approved'::"OutcomeRecordStatus"
        )) THEN
            RAISE EXCEPTION 'Acquisition spells require an exact approved start asset and rule';$new$;
 IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Expected acquisition start-asset guard end'; END IF;
 EXECUTE replace(definition,old_fragment,new_fragment);

 -- Overlap: a reviewed entry spell may cover current appearance-membership windows for the same
 -- player and club, which it retires (their currentness requires no covering reviewed spell). A v3
 -- spell still cannot overlap any current spell.
 definition:=pg_get_functiondef('validate_outcome_version_chain()'::regprocedure);
 old_fragment:=$old$              AND current_spell."spell_version_id" IS DISTINCT FROM NEW."supersedes_spell_version_id"$old$;
 IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Expected acquisition overlap guard'; END IF;
 EXECUTE replace(definition,old_fragment,old_fragment||$new$
              AND NOT (COALESCE(NEW."registration_canonical_json"::JSONB->>'schemaVersion','')<>'afl-trade-acquisition-registration/v3'
                AND COALESCE(current_spell."registration_canonical_json"::JSONB->>'schemaVersion','')='afl-trade-acquisition-registration/v3')$new$);

 -- HPN input finalization (v2 guard): a v3 spell satisfies the start-asset join by being
 -- appearance membership; exact spell columns compare NULL-safely. The v1 guard is unchanged and
 -- therefore keeps rejecting v3 spells.
 definition:=pg_get_functiondef('finalize_outcome_hpn_pav_input_set_v2()'::regprocedure);
 old_fragment:=$old$        JOIN "outcome_event_asset" eligible_asset
          ON eligible_asset."asset_version_id"=eligible."start_asset_version_id"$old$;
 IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Expected HPN eligible asset join'; END IF;
 definition:=replace(definition,old_fragment,$new$        LEFT JOIN "outcome_event_asset" eligible_asset
          ON eligible_asset."asset_version_id"=eligible."start_asset_version_id"$new$);
 old_fragment:=$old$         AND eligible_asset."event_version_id"=eligible."start_event_version_id"
         AND eligible_asset."kind"='player'::"OutcomeAssetKind"
         AND eligible_asset."player_id"=eligible."player_id"
         AND eligible_asset."to_club_id"=eligible."club_id"
         AND eligible_asset."status"='approved'::"OutcomeRecordStatus"$old$;
 IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Expected HPN eligible asset predicate'; END IF;
 definition:=replace(definition,old_fragment,$new$         AND (outcome_acquisition_is_appearance_membership(eligible."spell_version_id")
           OR (eligible_asset."event_version_id"=eligible."start_event_version_id"
         AND eligible_asset."kind"='player'::"OutcomeAssetKind"
         AND eligible_asset."player_id"=eligible."player_id"
         AND eligible_asset."to_club_id"=eligible."club_id"
         AND eligible_asset."status"='approved'::"OutcomeRecordStatus"))$new$);
 old_fragment:=$old$           AND spell."start_event_version_id"=
             row_record."row_json"#>>'{acquisitionSpell,startEventVersionId}'
           AND spell."start_asset_version_id"=
             row_record."row_json"#>>'{acquisitionSpell,startAssetVersionId}'$old$;
 IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Expected HPN exact spell entry columns'; END IF;
 definition:=replace(definition,old_fragment,$new$           AND spell."start_event_version_id" IS NOT DISTINCT FROM
             row_record."row_json"#>>'{acquisitionSpell,startEventVersionId}'
           AND spell."start_asset_version_id" IS NOT DISTINCT FROM
             row_record."row_json"#>>'{acquisitionSpell,startAssetVersionId}'$new$);
 old_fragment:=$old$           AND EXISTS (
             SELECT 1 FROM "outcome_event_asset" asset
             JOIN "outcome_acquisition_spell_rule" rule ON rule."rule_id"=spell."rule_id"
             WHERE asset."asset_version_id"=spell."start_asset_version_id"
               AND asset."event_version_id"=spell."start_event_version_id"
               AND asset."kind"='player'::"OutcomeAssetKind"
               AND asset."player_id"=spell."player_id"
               AND asset."to_club_id"=spell."club_id"
               AND asset."status"='approved'::"OutcomeRecordStatus"
               AND rule."status"='approved'::"OutcomeRecordStatus"
           )$old$;
 IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Expected HPN exact spell start asset'; END IF;
 definition:=replace(definition,old_fragment,$new$           AND (outcome_acquisition_is_appearance_membership(spell."spell_version_id") OR EXISTS (
             SELECT 1 FROM "outcome_event_asset" asset
             JOIN "outcome_acquisition_spell_rule" rule ON rule."rule_id"=spell."rule_id"
             WHERE asset."asset_version_id"=spell."start_asset_version_id"
               AND asset."event_version_id"=spell."start_event_version_id"
               AND asset."kind"='player'::"OutcomeAssetKind"
               AND asset."player_id"=spell."player_id"
               AND asset."to_club_id"=spell."club_id"
               AND asset."status"='approved'::"OutcomeRecordStatus"
               AND rule."status"='approved'::"OutcomeRecordStatus"
           ))$new$);
 EXECUTE definition;
END $migration$;
