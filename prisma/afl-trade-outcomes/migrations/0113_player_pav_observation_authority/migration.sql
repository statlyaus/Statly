CREATE TABLE outcome_player_pav_policy (
  policy_id TEXT PRIMARY KEY,
  policy_sha256 CHAR(64) NOT NULL UNIQUE,
  environment "OutcomeEnvironment" NOT NULL,
  competition TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  method_id TEXT NOT NULL REFERENCES outcome_hpn_pav_method(method_id) ON DELETE RESTRICT,
  approval_decision_id TEXT NOT NULL REFERENCES outcome_review_decision(decision_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ(3) NOT NULL,
  policy_json JSONB NOT NULL,
  CONSTRAINT outcome_player_pav_policy_scope_key UNIQUE
    (environment,competition,policy_version)
);

CREATE TABLE outcome_player_pav_observation_set (
  observation_set_id TEXT PRIMARY KEY,
  observation_set_sha256 CHAR(64) NOT NULL UNIQUE,
  environment "OutcomeEnvironment" NOT NULL,
  competition TEXT NOT NULL,
  release_id TEXT NOT NULL REFERENCES outcome_release_manifest(release_id) ON DELETE RESTRICT,
  policy_id TEXT NOT NULL REFERENCES outcome_player_pav_policy(policy_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ(3) NOT NULL,
  knowledge_cutoff_at TIMESTAMPTZ(3) NOT NULL,
  status TEXT NOT NULL,
  calculation_count INTEGER NOT NULL,
  observation_count INTEGER NOT NULL,
  observation_set_json JSONB NOT NULL,
  finalized_at TIMESTAMPTZ(3),
  CONSTRAINT outcome_player_pav_observation_set_scope_key UNIQUE
    (environment,release_id,policy_id,knowledge_cutoff_at),
  CONSTRAINT outcome_player_pav_observation_set_status CHECK (
    (status='building' AND finalized_at IS NULL)
    OR (status='finalized' AND finalized_at=created_at)
  ),
  CONSTRAINT outcome_player_pav_observation_set_counts CHECK (
    calculation_count>0 AND observation_count>=4
  ),
  CONSTRAINT outcome_player_pav_observation_set_chronology CHECK (
    knowledge_cutoff_at<=created_at
  )
);

CREATE TABLE outcome_player_pav_calculation_member (
  observation_set_id TEXT NOT NULL REFERENCES outcome_player_pav_observation_set(observation_set_id) ON DELETE RESTRICT,
  calculation_id TEXT NOT NULL REFERENCES outcome_hpn_pav_calculation(calculation_id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL,
  calculation_sha256 CHAR(64) NOT NULL,
  membership_json JSONB NOT NULL,
  PRIMARY KEY (observation_set_id,calculation_id),
  CONSTRAINT outcome_player_pav_calculation_ordinal_key UNIQUE (observation_set_id,ordinal)
);

CREATE TABLE outcome_player_pav_observation (
  observation_set_id TEXT NOT NULL REFERENCES outcome_player_pav_observation_set(observation_set_id) ON DELETE RESTRICT,
  observation_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  partition TEXT NOT NULL,
  prediction_season INTEGER NOT NULL,
  player_id TEXT NOT NULL REFERENCES outcome_player(player_id) ON DELETE RESTRICT,
  spell_version_id TEXT NOT NULL REFERENCES outcome_acquisition_spell_version(spell_version_id) ON DELETE RESTRICT,
  outcome_state TEXT NOT NULL,
  feature_value_count INTEGER NOT NULL,
  target_value_count INTEGER NOT NULL,
  observation_sha256 CHAR(64) NOT NULL,
  observation_json JSONB NOT NULL,
  PRIMARY KEY (observation_set_id,observation_id),
  CONSTRAINT outcome_player_pav_observation_ordinal_key UNIQUE (observation_set_id,ordinal),
  CONSTRAINT outcome_player_pav_observation_spell_key UNIQUE
    (observation_set_id,prediction_season,spell_version_id),
  CONSTRAINT outcome_player_pav_observation_partition CHECK
    (partition IN ('train','calibration','validation','final_test')),
  CONSTRAINT outcome_player_pav_observation_state CHECK
    (outcome_state IN ('mature_observed','right_censored','unavailable')),
  CONSTRAINT outcome_player_pav_observation_counts CHECK
    (feature_value_count>0 AND target_value_count>=0)
);

CREATE TABLE outcome_player_pav_value (
  observation_set_id TEXT NOT NULL,
  observation_id TEXT NOT NULL,
  value_role TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  calculation_id TEXT NOT NULL,
  spell_version_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  club_id TEXT NOT NULL,
  player_sha256 CHAR(64) NOT NULL,
  games_played INTEGER NOT NULL,
  total_pav DOUBLE PRECISION NOT NULL,
  value_json JSONB NOT NULL,
  PRIMARY KEY (observation_set_id,observation_id,value_role,ordinal),
  CONSTRAINT outcome_player_pav_value_observation_fkey FOREIGN KEY
    (observation_set_id,observation_id) REFERENCES outcome_player_pav_observation
    (observation_set_id,observation_id) ON DELETE RESTRICT,
  CONSTRAINT outcome_player_pav_value_calculation_player_fkey FOREIGN KEY
    (calculation_id,spell_version_id) REFERENCES outcome_hpn_pav_calculation_player
    (calculation_id,spell_version_id) ON DELETE RESTRICT,
  CONSTRAINT outcome_player_pav_value_role CHECK (value_role IN ('feature','target')),
  CONSTRAINT outcome_player_pav_value_shape CHECK (games_played>0)
);

GRANT SELECT ON outcome_player_pav_policy,outcome_player_pav_observation_set,
  outcome_player_pav_calculation_member,outcome_player_pav_observation,
  outcome_player_pav_value,outcome_release_manifest,outcome_active_release,
  outcome_release_acquisition_spell,outcome_acquisition_spell_version,
  outcome_hpn_pav_calculation,outcome_hpn_pav_calculation_head,
  outcome_hpn_pav_calculation_team,outcome_hpn_pav_calculation_player,
  outcome_review_decision TO afl_trade_private_evaluation_coordinator;
GRANT INSERT ON outcome_player_pav_observation_set,outcome_player_pav_calculation_member,
  outcome_player_pav_observation,outcome_player_pav_value
  TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE (status,finalized_at) ON outcome_player_pav_observation_set
  TO afl_trade_private_evaluation_coordinator;
-- PostgreSQL row-locking clauses require UPDATE privilege even for FOR SHARE.
-- Identity-column updates remain blocked by the append-only triggers below.
GRANT UPDATE (policy_id) ON outcome_player_pav_policy
  TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE (release_id) ON outcome_release_acquisition_spell
  TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE (spell_version_id) ON outcome_acquisition_spell_version
  TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE (observation_set_id) ON outcome_player_pav_calculation_member
  TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE (calculation_id) ON outcome_hpn_pav_calculation,
  outcome_hpn_pav_calculation_head
  TO afl_trade_private_evaluation_coordinator;

CREATE FUNCTION validate_outcome_player_pav_policy_insert() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE decision_row RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-review-subject:player_pav_policy:'||NEW.competition||':'||NEW.policy_version,0));
  IF NEW.policy_id<>'player-pav-policy:'||NEW.policy_sha256
    OR encode(sha256(convert_to(outcome_afl_trade_canonical_json(
      NEW.policy_json->'content'),'UTF8')),'hex')<>NEW.policy_sha256
    OR NEW.policy_json->>'policyId'<>NEW.policy_id
    OR NEW.policy_json#>>'{content,schemaVersion}'<>'afl-trade-player-pav-policy/v1'
    OR NEW.policy_json#>>'{content,authorityBoundary}'<>
      'private_released_acquisition_spell_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership'
    OR NEW.policy_json#>'{content,publicationEligible}' IS DISTINCT FROM 'false'::JSONB
    OR NEW.policy_json#>>'{content,environment}'<>NEW.environment::TEXT
    OR NEW.policy_json#>>'{content,competition}'<>NEW.competition
    OR NEW.policy_json#>>'{content,policyVersion}'<>NEW.policy_version
    OR NEW.policy_json#>>'{content,methodId}'<>NEW.method_id
    OR NEW.policy_json#>>'{content,approvalDecision,id}'<>NEW.approval_decision_id
    OR (NEW.policy_json#>>'{content,createdAt}')::TIMESTAMPTZ<>NEW.created_at
    OR NEW.policy_json#>>'{content,sourceValueUnit}'<>'season_pav'
    OR NEW.policy_json#>>'{content,outcomeValueUnit}'<>'fixed_horizon_pav'
    OR (NEW.policy_json#>>'{content,featureHistorySeasons}')::INTEGER NOT BETWEEN 1 AND 10
    OR (NEW.policy_json#>>'{content,fixedHorizonSeasons}')::INTEGER NOT BETWEEN 1 AND 15
    OR jsonb_array_length(NEW.policy_json#>'{content,partitions}')<>4
  THEN RAISE EXCEPTION 'Player PAV policy content mismatch'; END IF;
  IF EXISTS (SELECT 1 FROM (
    SELECT ordinal,value->>'role' AS role,
      (value->>'fromPredictionSeason')::INTEGER AS first_season,
      (value->>'throughPredictionSeason')::INTEGER AS last_season,
      lag((value->>'throughPredictionSeason')::INTEGER) OVER (ORDER BY ordinal) AS prior_last
    FROM jsonb_array_elements(NEW.policy_json#>'{content,partitions}')
      WITH ORDINALITY partitions(value,ordinal)) partition
    WHERE role<>(ARRAY['train','calibration','validation','final_test'])[ordinal]
      OR first_season NOT BETWEEN 1998 AND 2200 OR last_season NOT BETWEEN 1998 AND 2200
      OR last_season<first_season OR (prior_last IS NOT NULL AND first_season<=prior_last))
  THEN RAISE EXCEPTION 'Player PAV policy partitions are invalid'; END IF;
  SELECT * INTO decision_row FROM outcome_review_decision
   WHERE decision_id=NEW.approval_decision_id FOR SHARE;
  IF NOT FOUND OR decision_row.subject_type<>'player_pav_policy'
    OR decision_row.subject_id<>NEW.competition||':'||NEW.policy_version
    OR decision_row.decision<>'approved' OR decision_row.decided_at>NEW.created_at
    OR decision_row.evidence_json IS DISTINCT FROM ((NEW.policy_json->'content')-'approvalDecision')
    OR EXISTS (SELECT 1 FROM outcome_review_decision successor
      WHERE successor.supersedes_decision_id=decision_row.decision_id)
  THEN RAISE EXCEPTION 'Player PAV policy approval is not exact and current'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION validate_outcome_player_pav_set_insert() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status<>'building' OR NEW.finalized_at IS NOT NULL
    OR NEW.created_at<>date_trunc('milliseconds',transaction_timestamp())
    OR NEW.observation_set_id<>'player-pav-observation-set:'||NEW.observation_set_sha256
    OR encode(sha256(convert_to(outcome_afl_trade_canonical_json(
      NEW.observation_set_json->'content'),'UTF8')),'hex')<>
      NEW.observation_set_sha256
    OR NEW.observation_set_json->>'observationSetId'<>NEW.observation_set_id
    OR NEW.observation_set_json#>>'{content,schemaVersion}'<>'afl-trade-player-pav-observation-set/v1'
    OR NEW.observation_set_json#>>'{content,authorityBoundary}'<>
      'private_released_acquisition_spell_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership'
    OR NEW.observation_set_json#>'{content,publicationEligible}' IS DISTINCT FROM 'false'::JSONB
    OR NEW.observation_set_json#>>'{content,environment}'<>NEW.environment::TEXT
    OR NEW.observation_set_json#>>'{content,competition}'<>NEW.competition
    OR NEW.observation_set_json#>>'{content,releaseId}'<>NEW.release_id
    OR NEW.observation_set_json#>>'{content,policy,policyId}'<>NEW.policy_id
    OR (NEW.observation_set_json#>>'{content,createdAt}')::TIMESTAMPTZ<>NEW.created_at
    OR (NEW.observation_set_json#>>'{content,knowledgeCutoffAt}')::TIMESTAMPTZ<>
      NEW.knowledge_cutoff_at
    OR jsonb_array_length(NEW.observation_set_json#>'{content,calculations}')<>
      NEW.calculation_count
    OR jsonb_array_length(NEW.observation_set_json#>'{content,observations}')<>
      NEW.observation_count
  THEN RAISE EXCEPTION 'Player PAV observation-set admission mismatch'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION validate_outcome_player_pav_finalization() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE actual_calculations INTEGER; actual_observations INTEGER; policy_row RECORD;
  expected_calculations JSONB; expected_observations JSONB;
BEGIN
  IF OLD.status<>'building' OR NEW.status<>'finalized'
    OR NEW.finalized_at IS DISTINCT FROM NEW.created_at
    OR (to_jsonb(NEW)-'status'-'finalized_at') IS DISTINCT FROM
       (to_jsonb(OLD)-'status'-'finalized_at')
  THEN RAISE EXCEPTION 'Player PAV observation set has an invalid finalization transition'; END IF;
  SELECT policy.*,decision.decision INTO policy_row
    FROM outcome_player_pav_policy policy
    JOIN outcome_review_decision decision ON decision.decision_id=policy.approval_decision_id
   WHERE policy.policy_id=NEW.policy_id FOR SHARE OF policy,decision;
  IF NOT FOUND OR policy_row.environment<>NEW.environment
    OR policy_row.competition<>NEW.competition OR policy_row.decision<>'approved'
    OR EXISTS (SELECT 1 FROM outcome_review_decision successor
      WHERE successor.supersedes_decision_id=policy_row.approval_decision_id)
  THEN RAISE EXCEPTION 'Player PAV policy is not current at finalization'; END IF;
  IF NOT EXISTS (SELECT 1 FROM outcome_active_release active
    JOIN outcome_release_manifest release ON release.release_id=active.release_id
    WHERE active.release_id=NEW.release_id AND release.environment=NEW.environment::TEXT
      AND release.effective_through<=NEW.knowledge_cutoff_at FOR SHARE OF active,release)
    AND NOT EXISTS (SELECT 1 FROM outcome_private_player_pav_authority authority
      WHERE authority.policy_id=NEW.policy_id
        AND authority.binding_json->>'releaseId'=NEW.release_id
        AND authority.binding_json->>'knowledgeCutoffAt'=
          to_char(NEW.knowledge_cutoff_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        AND load_outcome_private_player_pav_authority(authority.request_id)=authority.binding_json)
  THEN RAISE EXCEPTION 'Player PAV source release is not the exact active release'; END IF;
  SELECT count(*) INTO actual_calculations FROM outcome_player_pav_calculation_member
    WHERE observation_set_id=NEW.observation_set_id;
  SELECT count(*) INTO actual_observations FROM outcome_player_pav_observation
    WHERE observation_set_id=NEW.observation_set_id;
  IF actual_calculations<>NEW.calculation_count OR actual_observations<>NEW.observation_count
  THEN RAISE EXCEPTION 'Player PAV observation-set child counts do not reconcile'; END IF;
  SELECT jsonb_agg(membership_json ORDER BY ordinal) INTO expected_calculations
    FROM outcome_player_pav_calculation_member WHERE observation_set_id=NEW.observation_set_id;
  SELECT jsonb_agg(observation_json ORDER BY ordinal) INTO expected_observations
    FROM outcome_player_pav_observation WHERE observation_set_id=NEW.observation_set_id;
  IF NEW.observation_set_json#>'{content,calculations}' IS DISTINCT FROM expected_calculations
    OR NEW.observation_set_json#>'{content,observations}' IS DISTINCT FROM expected_observations
  THEN RAISE EXCEPTION 'Player PAV parent content does not match durable children'; END IF;
  IF EXISTS (SELECT 1 FROM outcome_player_pav_calculation_member member
    JOIN outcome_hpn_pav_calculation calculation USING (calculation_id)
    LEFT JOIN outcome_hpn_pav_calculation_head head
      ON head.environment=calculation.environment AND head.competition=calculation.competition
     AND head.season_year=calculation.season_year AND head.method_id=calculation.method_id
    WHERE member.observation_set_id=NEW.observation_set_id AND (
      head.calculation_id IS DISTINCT FROM calculation.calculation_id
      OR calculation.method_id<>policy_row.method_id OR calculation.status<>'finalized'
      OR calculation.finalized_at IS NULL OR calculation.environment<>NEW.environment
      OR calculation.competition<>NEW.competition OR calculation.calculated_at>NEW.knowledge_cutoff_at
      OR calculation.effective_through>NEW.knowledge_cutoff_at
      OR calculation.calculation_sha256<>member.calculation_sha256
      OR member.membership_json IS DISTINCT FROM jsonb_build_object(
        'calculationId',calculation.calculation_id,
        'calculationSha256',calculation.calculation_sha256,
        'inputSetId',calculation.input_set_id,'methodId',calculation.method_id,
        'seasonYear',calculation.season_year,
        'effectiveThrough',to_char(calculation.effective_through AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'calculatedAt',to_char(calculation.calculated_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))))
  THEN RAISE EXCEPTION 'Player PAV calculation membership is not exact and finalized'; END IF;
  IF EXISTS (SELECT 1 FROM outcome_player_pav_observation observation
    JOIN outcome_acquisition_spell_version spell USING (spell_version_id)
    LEFT JOIN outcome_release_acquisition_spell release_member
      ON release_member.release_id=NEW.release_id
     AND release_member.spell_version_id=observation.spell_version_id
    WHERE observation.observation_set_id=NEW.observation_set_id AND (
      release_member.spell_version_id IS NULL OR spell.status<>'approved'
      OR spell.player_id<>observation.player_id OR spell.recorded_at>NEW.knowledge_cutoff_at
      OR observation.observation_json->>'observationId'<>observation.observation_id
      OR observation.observation_json->>'partition'<>observation.partition
      OR (observation.observation_json->>'predictionSeason')::INTEGER<>
        observation.prediction_season
      OR observation.observation_json#>>'{acquisitionSpell,spellVersionId}'<>
        observation.spell_version_id
      OR observation.observation_id<>'player-pav-observation:'||observation.observation_sha256
      OR encode(sha256(convert_to(outcome_afl_trade_canonical_json(
        observation.observation_json-'observationId'),'UTF8')),'hex')<>
        observation.observation_sha256
      OR jsonb_array_length(observation.observation_json->'featureValues')<>
        observation.feature_value_count
      OR jsonb_array_length(observation.observation_json->'targetValues')<>
        observation.target_value_count
      OR (SELECT count(*) FROM outcome_player_pav_value value
        WHERE value.observation_set_id=observation.observation_set_id
          AND value.observation_id=observation.observation_id AND value.value_role='feature')<>
        observation.feature_value_count
      OR (SELECT count(*) FROM outcome_player_pav_value value
        WHERE value.observation_set_id=observation.observation_set_id
          AND value.observation_id=observation.observation_id AND value.value_role='target')<>
        observation.target_value_count
      OR (SELECT COALESCE(jsonb_agg(value.value_json ORDER BY value.ordinal),'[]'::JSONB)
        FROM outcome_player_pav_value value
        WHERE value.observation_set_id=observation.observation_set_id
          AND value.observation_id=observation.observation_id AND value.value_role='feature')
        IS DISTINCT FROM observation.observation_json->'featureValues'
      OR (SELECT COALESCE(jsonb_agg(value.value_json ORDER BY value.ordinal),'[]'::JSONB)
        FROM outcome_player_pav_value value
        WHERE value.observation_set_id=observation.observation_set_id
          AND value.observation_id=observation.observation_id AND value.value_role='target')
        IS DISTINCT FROM observation.observation_json->'targetValues'))
  THEN RAISE EXCEPTION 'Player PAV spell or observation custody is mismatched'; END IF;
  IF EXISTS (SELECT 1 FROM outcome_player_pav_value value
    JOIN outcome_hpn_pav_calculation calculation USING (calculation_id)
    JOIN outcome_hpn_pav_calculation_player player
      ON player.calculation_id=value.calculation_id
     AND player.spell_version_id=value.spell_version_id
    WHERE value.observation_set_id=NEW.observation_set_id AND (
      value.value_json->>'calculationId'<>value.calculation_id
      OR value.value_json->>'calculationSha256'<>calculation.calculation_sha256
      OR value.value_json->>'spellVersionId'<>value.spell_version_id
      OR value.value_json->>'playerId'<>value.player_id
      OR value.value_json->>'clubId'<>value.club_id
      OR value.value_json->>'playerSha256'<>value.player_sha256
      OR value.player_id<>player.player_id OR value.club_id<>player.team_id
      OR value.player_sha256<>player.player_sha256 OR value.total_pav<>player.total_pav
      OR (value.value_json->>'offensivePav')::DOUBLE PRECISION<>player.offensive_pav
      OR (value.value_json->>'midfieldPav')::DOUBLE PRECISION<>player.midfield_pav
      OR (value.value_json->>'defensivePav')::DOUBLE PRECISION<>player.defensive_pav
      OR value.value_json->'sourceRowIds' IS DISTINCT FROM
        player.player_canonical_json::JSONB#>'{source,sourceRowIds}'
      OR (player.player_canonical_json::JSONB#>>'{source,gamesPlayed}')::INTEGER<>
        value.games_played
      OR (value.value_json->>'gamesPlayed')::INTEGER<>value.games_played
      OR (value.value_json->>'totalPav')::DOUBLE PRECISION<>value.total_pav))
  THEN RAISE EXCEPTION 'Player PAV value custody is mismatched'; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER outcome_player_pav_policy_validate BEFORE INSERT ON outcome_player_pav_policy
  FOR EACH ROW EXECUTE FUNCTION validate_outcome_player_pav_policy_insert();
CREATE TRIGGER outcome_player_pav_set_validate BEFORE INSERT ON outcome_player_pav_observation_set
  FOR EACH ROW EXECUTE FUNCTION validate_outcome_player_pav_set_insert();
CREATE TRIGGER outcome_player_pav_set_finalize BEFORE UPDATE ON outcome_player_pav_observation_set
  FOR EACH ROW EXECUTE FUNCTION validate_outcome_player_pav_finalization();
DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['outcome_player_pav_policy','outcome_player_pav_calculation_member',
    'outcome_player_pav_observation','outcome_player_pav_value']
  LOOP EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_outcome_append_only_mutation()',
    table_name||'_append_only',table_name); END LOOP;
END $$;

CREATE TABLE outcome_private_player_pav_authority (
  request_id TEXT PRIMARY KEY REFERENCES outcome_private_valuation_dispatch_request(request_id) ON DELETE RESTRICT,
  policy_id TEXT NOT NULL REFERENCES outcome_player_pav_policy(policy_id) ON DELETE RESTRICT,
  lineage_admission_id TEXT NOT NULL REFERENCES outcome_corpus_factual_lineage_admission(admission_id) ON DELETE RESTRICT,
  binding_json JSONB NOT NULL
);
CREATE TRIGGER outcome_private_player_pav_authority_append_only
  BEFORE UPDATE OR DELETE ON outcome_private_player_pav_authority
  FOR EACH ROW EXECUTE FUNCTION reject_outcome_append_only_mutation();
GRANT SELECT,INSERT ON outcome_private_player_pav_authority
  TO afl_trade_private_valuation_scheduler_owner;
GRANT SELECT ON outcome_private_player_pav_authority
  TO afl_trade_private_evaluation_coordinator;
GRANT SELECT ON outcome_player_pav_policy,outcome_hpn_pav_calculation,
  outcome_hpn_pav_calculation_head,outcome_corpus_factual_lineage,
  outcome_corpus_factual_lineage_admission,outcome_promotion_backed_corpus,
  outcome_release_manifest,outcome_record_state_commitment,outcome_release_acquisition_spell,
  outcome_acquisition_spell_version,outcome_review_decision,outcome_gate_proposal,
  outcome_gate_decision TO afl_trade_private_valuation_scheduler_owner;
GRANT UPDATE (policy_id) ON outcome_player_pav_policy
  TO afl_trade_private_valuation_scheduler_owner;
GRANT UPDATE (decision_id) ON outcome_review_decision
  TO afl_trade_private_valuation_scheduler_owner;

DO $membership$ BEGIN
  EXECUTE format('GRANT afl_trade_private_valuation_scheduler_owner TO %I',session_user);
END $membership$;
SET ROLE afl_trade_private_valuation_scheduler_owner;

CREATE FUNCTION authenticate_outcome_private_player_pav_authority(
  target_request_id TEXT,target_policy_id TEXT,target_admission_id TEXT
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE request RECORD; policy RECORD; parent RECORD; hpn JSONB; trusted_at TIMESTAMPTZ;
  prediction_seasons JSONB; measurement_seasons JSONB; required_first INTEGER;
  required_last INTEGER; prediction_count INTEGER; measurement_count INTEGER;
BEGIN
  SELECT dispatch.*,output.output_id INTO request
    FROM outcome_private_valuation_dispatch_request dispatch
    JOIN outcome_private_valuation_factual_output output ON output.request_id=dispatch.request_id
   WHERE dispatch.request_id=target_request_id AND dispatch.scope_key='afl-men:2025-trades';
  IF NOT FOUND THEN RAISE EXCEPTION 'Private player PAV requires the exact 2025 dispatch output'; END IF;
  hpn:=load_outcome_private_valuation_hpn_factual_input(target_request_id,request.output_id);
  IF hpn IS NULL THEN RAISE EXCEPTION 'Private player PAV requires current factual authority'; END IF;
  trusted_at:=clock_timestamp();
  SELECT stored.*,decision.decision,decision.subject_type,decision.subject_id,
    decision.decision_id AS current_decision_id INTO policy
    FROM outcome_player_pav_policy stored
    JOIN outcome_review_decision decision ON decision.decision_id=stored.approval_decision_id
   WHERE stored.policy_id=target_policy_id FOR SHARE OF stored,decision;
  IF NOT FOUND OR policy.environment<>'non_production' OR policy.competition<>'AFLM'
    OR policy.decision<>'approved' OR policy.subject_type<>'player_pav_policy'
    OR policy.subject_id<>'AFLM:'||policy.policy_version
    OR EXISTS (SELECT 1 FROM outcome_review_decision successor
      WHERE successor.supersedes_decision_id=policy.approval_decision_id)
  THEN RAISE EXCEPTION 'Private player PAV policy is unavailable or not current'; END IF;

  SELECT jsonb_agg(season ORDER BY season),count(*) INTO prediction_seasons,prediction_count
    FROM (SELECT generate_series((part.value->>'fromPredictionSeason')::INTEGER,
      (part.value->>'throughPredictionSeason')::INTEGER) AS season
      FROM jsonb_array_elements(policy.policy_json#>'{content,partitions}') part(value)) years;
  SELECT jsonb_agg(season ORDER BY season),count(*),min(season),max(season)
    INTO measurement_seasons,measurement_count,required_first,required_last
    FROM (SELECT DISTINCT generate_series(
      prediction.season-(policy.policy_json#>>'{content,featureHistorySeasons}')::INTEGER+1,
      prediction.season+(policy.policy_json#>>'{content,fixedHorizonSeasons}')::INTEGER) AS season
      FROM jsonb_array_elements_text(prediction_seasons) values(value)
      CROSS JOIN LATERAL (SELECT value::INTEGER AS season) prediction) years;
  IF prediction_count<4 OR measurement_count=0 OR required_first<1998 OR required_last>2200
  THEN RAISE EXCEPTION 'Private player PAV policy has invalid historical coverage'; END IF;

  SELECT lineage.*,admission.gate_proposal_id,admission.gate_decision_id,
    corpus.knowledge_cutoff_at,corpus.member_set_sha256,
    release.effective_through,release.created_at AS release_created_at,
    release.manifest_json,release.manifest_canonical_json
    INTO parent FROM outcome_corpus_factual_lineage_admission admission
    JOIN outcome_corpus_factual_lineage lineage ON lineage.lineage_id=admission.lineage_id
    JOIN outcome_promotion_backed_corpus corpus ON corpus.corpus_id=lineage.corpus_id
    JOIN outcome_release_manifest release ON release.release_id=lineage.release_id
   WHERE admission.admission_id=target_admission_id
     AND lineage.environment='non_production' AND lineage.competition='AFLM'
     AND lineage.scope_key=request.scope_key
     AND lineage.valid_from_season<=required_first AND lineage.valid_through_season>=required_last
     AND corpus.status='finalized' AND corpus.finalized_at IS NOT NULL
     AND release.environment='non_production';
  IF NOT FOUND OR parent.knowledge_cutoff_at IS DISTINCT FROM parent.effective_through
    OR parent.effective_through>trusted_at OR parent.release_created_at>trusted_at
    OR parent.member_set_sha256<>parent.source_member_set_sha256
    OR parent.manifest_json#>>'{content,corpusId}' IS DISTINCT FROM parent.corpus_id
    OR parent.manifest_canonical_json::JSONB IS DISTINCT FROM parent.manifest_json->'content'
    OR 'outcome-release:'||encode(sha256(convert_to(parent.manifest_canonical_json,'UTF8')),'hex')
      IS DISTINCT FROM parent.release_id
    OR EXISTS (SELECT 1 FROM outcome_active_release WHERE release_id=parent.release_id)
    OR (SELECT record_state_json->>'state' FROM outcome_record_state_commitment
      WHERE release_id=parent.release_id ORDER BY event_revision DESC LIMIT 1) IS DISTINCT FROM 'approved'
  THEN RAISE EXCEPTION 'Private player PAV historical release is unavailable or mismatched'; END IF;
  IF NOT EXISTS (SELECT 1 FROM outcome_gate_decision gate
    JOIN outcome_gate_proposal proposal ON proposal.proposal_id=gate.proposal_id
    WHERE gate.decision_id=parent.gate_decision_id AND proposal.proposal_id=parent.gate_proposal_id
      AND gate.gate='gate_2_corpus_lineage' AND gate.environment='non_production'
      AND gate.decision_key='gate2:'||parent.lineage_id AND gate.state='approved'
      AND gate.effective_at<=trusted_at AND gate.revalidate_at>trusted_at
      AND proposal.scope_key=parent.scope_key
      AND NOT EXISTS (SELECT 1 FROM outcome_gate_decision successor
        WHERE successor.supersedes_decision_id=gate.decision_id))
  THEN RAISE EXCEPTION 'Private player PAV historical Gate 2 admission is not current'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(prediction_seasons) prediction(value)
    WHERE NOT EXISTS (SELECT 1 FROM outcome_release_acquisition_spell member
      JOIN outcome_acquisition_spell_version spell
        ON spell.spell_version_id=member.spell_version_id
      WHERE member.release_id=parent.release_id AND spell.status='approved'
        AND spell.start_date<=make_date(prediction.value::INTEGER,12,31)
        AND (spell.end_date IS NULL OR spell.end_date>=make_date(prediction.value::INTEGER,12,31))
        AND spell.recorded_at<=make_timestamptz(prediction.value::INTEGER,12,31,23,59,59,'UTC')))
  THEN RAISE EXCEPTION 'Private player PAV historical spell membership is incomplete or late'; END IF;
  IF (SELECT count(*) FROM outcome_hpn_pav_calculation_head head
      JOIN outcome_hpn_pav_calculation calculation ON calculation.calculation_id=head.calculation_id
      WHERE head.environment='non_production' AND head.competition='AFLM'
        AND head.method_id=policy.method_id
        AND head.season_year IN (SELECT value::INTEGER
          FROM jsonb_array_elements_text(measurement_seasons) values(value))
        AND calculation.status='finalized' AND calculation.finalized_at IS NOT NULL
        AND calculation.calculated_at<=parent.knowledge_cutoff_at
        AND calculation.effective_through<=parent.knowledge_cutoff_at)<>measurement_count
  THEN RAISE EXCEPTION 'Private player PAV finalized HPN measurement coverage is incomplete'; END IF;
  RETURN jsonb_build_object('requestId',target_request_id,'factualOutputId',request.output_id,
    'policyId',target_policy_id,'policyApprovalDecisionId',policy.approval_decision_id,
    'lineageAdmissionId',target_admission_id,'lineageId',parent.lineage_id,
    'corpusId',parent.corpus_id,'releaseId',parent.release_id,'methodId',policy.method_id,
    'knowledgeCutoffAt',to_char(parent.knowledge_cutoff_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'featureHistorySeasons',(policy.policy_json#>>'{content,featureHistorySeasons}')::INTEGER,
    'fixedHorizonSeasons',(policy.policy_json#>>'{content,fixedHorizonSeasons}')::INTEGER,
    'predictionSeasons',prediction_seasons,'requiredMeasurementSeasons',measurement_seasons,
    'sourceMemberSetSha256',parent.source_member_set_sha256,
    'canonicalMemberSetSha256',parent.canonical_member_set_sha256);
END $$;

CREATE FUNCTION load_outcome_private_player_pav_authority(target_request_id TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE retained RECORD; current_binding JSONB;
BEGIN
  SELECT * INTO retained FROM outcome_private_player_pav_authority
    WHERE request_id=target_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  current_binding:=authenticate_outcome_private_player_pav_authority(
    target_request_id,retained.policy_id,retained.lineage_admission_id);
  IF current_binding IS DISTINCT FROM retained.binding_json
  THEN RAISE EXCEPTION 'Private player PAV bound authority changed'; END IF;
  RETURN retained.binding_json;
END $$;

CREATE FUNCTION bind_outcome_private_player_pav_authority(
  target_request_id TEXT,target_claim_id TEXT,target_lease_sha256 TEXT,
  target_policy_id TEXT,target_admission_id TEXT
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE retained JSONB; binding JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-private-player-pav-authority:'||target_request_id,0));
  PERFORM load_outcome_private_valuation_dispatch_request_for_claim(
    target_request_id,target_claim_id,target_lease_sha256);
  binding:=authenticate_outcome_private_player_pav_authority(
    target_request_id,target_policy_id,target_admission_id);
  retained:=load_outcome_private_player_pav_authority(target_request_id);
  IF retained IS NOT NULL THEN
    IF retained IS DISTINCT FROM binding
    THEN RAISE EXCEPTION 'Private player PAV cannot substitute retained authority'; END IF;
    RETURN retained;
  END IF;
  INSERT INTO outcome_private_player_pav_authority
    (request_id,policy_id,lineage_admission_id,binding_json)
  VALUES (target_request_id,target_policy_id,target_admission_id,binding);
  RETURN binding;
END $$;

DO $paths$ DECLARE signature TEXT; BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'authenticate_outcome_private_player_pav_authority(TEXT,TEXT,TEXT)',
    'load_outcome_private_player_pav_authority(TEXT)',
    'bind_outcome_private_player_pav_authority(TEXT,TEXT,TEXT,TEXT,TEXT)']
  LOOP
    EXECUTE format('ALTER FUNCTION %I.%s SET search_path TO %I,pg_catalog,pg_temp',
      current_schema(),signature,current_schema());
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%s FROM PUBLIC',current_schema(),signature);
  END LOOP;
END $paths$;
GRANT EXECUTE ON FUNCTION bind_outcome_private_player_pav_authority(TEXT,TEXT,TEXT,TEXT,TEXT)
  TO afl_trade_private_evaluation_coordinator;
GRANT EXECUTE ON FUNCTION load_outcome_private_player_pav_authority(TEXT)
  TO afl_trade_private_evaluation_coordinator;
RESET ROLE;
DO $membership$ BEGIN
  EXECUTE format('REVOKE afl_trade_private_valuation_scheduler_owner FROM %I',session_user);
END $membership$;
