-- Unknown acquisition dates remain NULL; immutable registration JSON owns their explicit bounds.
-- Preserve v1 currentness and every existing authority check while adding reviewed v2 storage.
CREATE FUNCTION outcome_acquisition_binding_bounds(binding JSONB)
RETURNS DATERANGE LANGUAGE sql IMMUTABLE AS $$
 SELECT outcome_session_precision_bounds(jsonb_build_object(
  'eventDate',binding->'eventDate',
  'draftYear',left(COALESCE(binding->>'eventDate',binding#>>'{datePrecision,earliestDate}'),4)::INTEGER)
  || CASE WHEN binding ? 'datePrecision' THEN jsonb_build_object('datePrecision',binding->'datePrecision') ELSE '{}'::JSONB END,TRUE)
$$;

ALTER TABLE outcome_acquisition_spell_version ALTER COLUMN start_date DROP NOT NULL;
ALTER TABLE outcome_acquisition_spell_version ADD CONSTRAINT outcome_acquisition_window_registration_required CHECK (
 start_date IS NOT NULL OR COALESCE(registration_canonical_json::JSONB->>'schemaVersion'='afl-trade-acquisition-registration/v2',FALSE)
);
ALTER TABLE outcome_acquisition_spell_rule DROP CONSTRAINT outcome_acquisition_rule_registration_tuple;
ALTER TABLE outcome_acquisition_spell_rule ADD CONSTRAINT outcome_acquisition_rule_registration_tuple CHECK (
 (registration_canonical_json IS NULL AND registration_approval_decision_id IS NULL AND registered_at IS NULL
  AND COALESCE(definition_json#>>'{content,schemaVersion}','') NOT IN ('afl-trade-acquisition-registration-rule/v1','afl-trade-acquisition-registration-rule/v2')) OR
 (registration_canonical_json IS NOT NULL AND registration_approval_decision_id IS NOT NULL AND registered_at IS NOT NULL)
);

DO $migration$
DECLARE definition TEXT; old_fragment TEXT;
BEGIN
 definition:=pg_get_functiondef('outcome_acquisition_rule_registration_current(text,timestamp with time zone)'::regprocedure);
 old_fragment:=$old$c=jsonb_build_object('schemaVersion','afl-trade-acquisition-registration-rule/v1',$old$;
 IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Expected acquisition rule v1 schema'; END IF;
 definition:=replace(definition,old_fragment,$new$c->>'schemaVersion' IN ('afl-trade-acquisition-registration-rule/v1','afl-trade-acquisition-registration-rule/v2')
      AND c=jsonb_build_object('schemaVersion',c->>'schemaVersion',$new$);
 definition:=replace(definition,$old$'entry','exact_promoted_incoming_player_asset_on_event_date',$old$,
  $new$'entry',CASE WHEN c->>'schemaVersion'='afl-trade-acquisition-registration-rule/v2' THEN 'reviewed_incoming_asset_with_explicit_date_precision' ELSE 'exact_promoted_incoming_player_asset_on_event_date' END,$new$);
 definition:=replace(definition,$old$'departure','exact_reviewed_departure_event_day_excluded',$old$,
  $new$'departure',CASE WHEN c->>'schemaVersion'='afl-trade-acquisition-registration-rule/v2' THEN 'reviewed_departure_bounds_day_excluded' ELSE 'exact_reviewed_departure_event_day_excluded' END,$new$);
 definition:=replace(definition,$old$'intervals','inclusive_start_inclusive_end_no_same_club_overlap',$old$,
  $new$'intervals',CASE WHEN c->>'schemaVersion'='afl-trade-acquisition-registration-rule/v2' THEN 'possible_and_certain_membership_no_inferred_boundary_days' ELSE 'inclusive_start_inclusive_end_no_same_club_overlap' END,$new$);
 EXECUTE definition;
 definition:=pg_get_functiondef('outcome_acquisition_registration_event_current(jsonb,text,text,text,text,boolean,timestamp with time zone,timestamp with time zone)'::regprocedure);
 old_fragment:=$old$event.event_date=(binding->>'eventDate')::DATE$old$;
 IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Expected acquisition event date guard'; END IF;
 EXECUTE replace(definition,old_fragment,$new$(event.event_date IS NOT DISTINCT FROM (binding->>'eventDate')::DATE
    AND event.date_precision IS NOT DISTINCT FROM binding->'datePrecision'
    AND outcome_acquisition_binding_bounds(binding) IS NOT NULL
    AND outcome_event_evidenced_date_bounds(event.event_version_id)=outcome_acquisition_binding_bounds(binding))$new$);
END $migration$;

ALTER FUNCTION outcome_acquisition_spell_registration_current(TEXT,TIMESTAMPTZ)
 RENAME TO outcome_acquisition_exact_spell_registration_current;
CREATE FUNCTION outcome_acquisition_window_spell_registration_current(target_id TEXT, cutoff TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM outcome_acquisition_spell_version spell
  JOIN outcome_acquisition_spell_rule rule ON rule.rule_id=spell.rule_id
  CROSS JOIN LATERAL (SELECT spell.registration_canonical_json::JSONB AS c) content
  WHERE spell.spell_version_id=target_id AND spell.status='approved'
    AND spell.registration_canonical_json IS NOT NULL
    AND spell.registration_canonical_json=outcome_afl_trade_canonical_json(c)
    AND spell.spell_version_id='acquisition-spell-version:'||encode(sha256(convert_to(spell.registration_canonical_json,'UTF8')),'hex')
    AND c=jsonb_build_object('schemaVersion','afl-trade-acquisition-registration/v2',
      'environment',c->'environment','competition',c->'competition','playerId',spell.player_id,
      'clubId',spell.club_id,'entry',c->'entry','departure',c->'departure','ruleId',spell.rule_id,
      'version',spell.version,'supersedesSpellVersionId',spell.supersedes_spell_version_id,
      'observedThrough',c->'observedThrough','continuityEvidence',c->'continuityEvidence','createdAt',c->'createdAt')
    AND c->>'environment'=rule.definition_json#>>'{content,environment}'
    AND c->>'competition'=rule.definition_json#>>'{content,competition}'
    AND rule.definition_json#>>'{content,schemaVersion}'='afl-trade-acquisition-registration-rule/v2'
    AND outcome_acquisition_rule_registration_current(rule.rule_id,cutoff)
    AND (c->>'createdAt')::TIMESTAMPTZ=spell.recorded_at
    AND c#>>'{entry,eventVersionId}'=spell.start_event_version_id
    AND c#>>'{entry,assetVersionId}'=spell.start_asset_version_id
    AND (c#>>'{entry,eventDate}')::DATE IS NOT DISTINCT FROM spell.start_date
    AND outcome_acquisition_binding_bounds(c->'entry') IS NOT NULL
    AND (c#>'{entry,datePrecision}' IS NOT NULL OR c#>'{departure,datePrecision}' IS NOT NULL)
    AND upper(outcome_acquisition_binding_bounds(c->'entry'))-1 <= (c->>'observedThrough')::DATE
    AND (c->>'observedThrough')::DATE <= (spell.recorded_at AT TIME ZONE 'UTC')::DATE
    AND ((c->'departure'='null'::JSONB AND spell.end_date IS NULL AND spell.end_reason IS NULL)
      OR (jsonb_typeof(c->'departure')='object'
        AND spell.end_date IS NOT DISTINCT FROM (c#>>'{departure,eventDate}')::DATE-1
        AND spell.end_reason='reviewed_departure'
        AND outcome_acquisition_binding_bounds(c->'departure') IS NOT NULL
        AND lower(outcome_acquisition_binding_bounds(c->'departure')) >= upper(outcome_acquisition_binding_bounds(c->'entry'))
        AND upper(outcome_acquisition_binding_bounds(c->'departure'))-1 <= (c->>'observedThrough')::DATE
        AND outcome_acquisition_registration_event_current(c->'departure',spell.player_id,spell.club_id,
          c->>'environment',c->>'competition',FALSE,spell.recorded_at,cutoff)))
    AND outcome_acquisition_registration_event_current(c->'entry',spell.player_id,spell.club_id,
      c->>'environment',c->>'competition',TRUE,spell.recorded_at,cutoff)
    AND outcome_acquisition_registration_evidence_exact(c->'continuityEvidence',c->>'environment',spell.recorded_at,spell.registered_at)
    AND outcome_acquisition_registration_review_current(spell.registration_approval_decision_id,
      'acquisition_spell_registration',spell.spell_version_id,
      jsonb_build_object('spellVersionId',spell.spell_version_id,'content',c),spell.recorded_at,spell.registered_at,cutoff)
    AND NOT EXISTS (SELECT 1 FROM outcome_acquisition_spell_version successor WHERE successor.supersedes_spell_version_id=spell.spell_version_id)
    AND ((spell.version=1 AND spell.supersedes_spell_version_id IS NULL AND spell.spell_id=spell.spell_version_id)
      OR EXISTS (SELECT 1 FROM outcome_acquisition_spell_version predecessor
        WHERE predecessor.spell_version_id=spell.supersedes_spell_version_id
          AND predecessor.registration_canonical_json IS NOT NULL
          AND predecessor.spell_id=spell.spell_id AND predecessor.player_id=spell.player_id
          AND predecessor.club_id=spell.club_id AND predecessor.version+1=spell.version
          AND predecessor.recorded_at<=spell.recorded_at))
 )
$$;


CREATE FUNCTION outcome_acquisition_spell_registration_current(target_id TEXT, cutoff TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT COALESCE((SELECT CASE WHEN spell.registration_canonical_json::JSONB->>'schemaVersion'='afl-trade-acquisition-registration/v2'
 THEN outcome_acquisition_window_spell_registration_current(target_id,cutoff)
 ELSE outcome_acquisition_exact_spell_registration_current(target_id,cutoff)
   AND rule.definition_json#>>'{content,schemaVersion}'='afl-trade-acquisition-registration-rule/v1' END
 FROM outcome_acquisition_spell_version spell JOIN outcome_acquisition_spell_rule rule USING(rule_id)
 WHERE spell.spell_version_id=target_id),FALSE)
$$;

-- Possible membership determines overlap. An open departure remains unbounded, not observedThrough.
CREATE FUNCTION outcome_acquisition_possible_membership(spell outcome_acquisition_spell_version)
RETURNS DATERANGE LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN spell.registration_canonical_json::JSONB->>'schemaVersion'='afl-trade-acquisition-registration/v2'
 THEN daterange(lower(outcome_acquisition_binding_bounds(spell.registration_canonical_json::JSONB->'entry')),
  CASE WHEN spell.registration_canonical_json::JSONB->'departure'='null'::JSONB THEN NULL
   ELSE upper(outcome_acquisition_binding_bounds(spell.registration_canonical_json::JSONB->'departure'))-1 END,'[)')
 ELSE daterange(spell.start_date,spell.end_date,'[]') END
$$;

DO $migration$
DECLARE definition TEXT; old_fragment TEXT;
BEGIN
 definition:=pg_get_functiondef('validate_outcome_version_chain()'::regprocedure);
 old_fragment:=$old$current_spell."start_date" <= COALESCE(NEW."end_date", 'infinity'::date)
              AND NEW."start_date" <= COALESCE(current_spell."end_date", 'infinity'::date)$old$;
 IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Expected acquisition overlap guard'; END IF;
 EXECUTE replace(definition,old_fragment,'outcome_acquisition_possible_membership(current_spell) && outcome_acquisition_possible_membership(NEW)');
END $migration$;

-- Exact-day consumers cannot interpret an uncertain endpoint as an open spell or an exact day.
-- Versioned interval-aware metric admission must replace this guard before window grading.
CREATE FUNCTION require_outcome_exact_acquisition_consumer() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM outcome_acquisition_spell_version spell WHERE spell.spell_version_id=NEW.spell_version_id
   AND spell.registration_canonical_json::JSONB->>'schemaVersion'='afl-trade-acquisition-registration/v2') THEN
  RAISE EXCEPTION 'Window acquisition requires interval-aware metric and release qualification';
 END IF;
 RETURN NEW;
END $$;
DO $migration$
DECLARE target TEXT;
BEGIN
 FOREACH target IN ARRAY ARRAY[
  'outcome_acquisition_spell_metric','outcome_acquisition_spell_metric_batch',
  'outcome_acquisition_spell_metric_version','outcome_release_acquisition_spell',
  'outcome_valuation_dataset_row','outcome_hpn_pav_calculation_player','outcome_player_pav_observation'
 ] LOOP
  EXECUTE format('CREATE TRIGGER outcome_exact_acquisition_consumer BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION require_outcome_exact_acquisition_consumer()',target);
 END LOOP;
END $migration$;

