-- Versioned retrospective PAV custody. Existing v1 identities and historical recording rules
-- remain intact; v2 admits truthful later recording only under an exact reviewed private policy.
-- No new registry, grant to PUBLIC, or public model authority is introduced.

CREATE OR REPLACE FUNCTION validate_outcome_player_pav_policy_insert() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE decision_row RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-review-subject:player_pav_policy:'||NEW.competition||':'||NEW.policy_version,0));
  IF NEW.policy_id<>'player-pav-policy:'||NEW.policy_sha256
    OR encode(sha256(convert_to(outcome_afl_trade_canonical_json(
      NEW.policy_json->'content'),'UTF8')),'hex')<>NEW.policy_sha256
    OR NEW.policy_json->>'policyId'<>NEW.policy_id
    OR COALESCE(NEW.policy_json#>>'{content,schemaVersion}' NOT IN
      ('afl-trade-player-pav-policy/v1','afl-trade-player-pav-policy/v2'),TRUE)
    OR (NEW.policy_json#>>'{content,schemaVersion}'='afl-trade-player-pav-policy/v1'
      AND (NEW.policy_json->'content') ? 'knowledgePolicy')
    OR (NEW.policy_json#>>'{content,schemaVersion}'='afl-trade-player-pav-policy/v2'
      AND (NEW.environment::TEXT NOT IN ('test_fixture','non_production')
        OR NEW.policy_json#>>'{content,knowledgePolicy}' IS DISTINCT FROM
          'retrospective_as_recorded_by_dataset_creation'))
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

CREATE OR REPLACE FUNCTION validate_outcome_player_pav_set_insert() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status<>'building' OR NEW.finalized_at IS NOT NULL
    OR NEW.created_at<>date_trunc('milliseconds',transaction_timestamp())
    OR NEW.observation_set_id<>'player-pav-observation-set:'||NEW.observation_set_sha256
    OR encode(sha256(convert_to(outcome_afl_trade_canonical_json(
      NEW.observation_set_json->'content'),'UTF8')),'hex')<>
      NEW.observation_set_sha256
    OR NEW.observation_set_json->>'observationSetId'<>NEW.observation_set_id
    OR COALESCE(NEW.observation_set_json#>>'{content,schemaVersion}' NOT IN
      ('afl-trade-player-pav-observation-set/v1','afl-trade-player-pav-observation-set/v2'),TRUE)
    OR (NEW.observation_set_json#>>'{content,schemaVersion}'='afl-trade-player-pav-observation-set/v1'
      AND ((NEW.observation_set_json->'content') ? 'knowledgePolicy'
        OR NEW.observation_set_json#>>'{content,policy,content,schemaVersion}'
          IS DISTINCT FROM 'afl-trade-player-pav-policy/v1'))
    OR (NEW.observation_set_json#>>'{content,schemaVersion}'='afl-trade-player-pav-observation-set/v2'
      AND (NEW.environment::TEXT NOT IN ('test_fixture','non_production')
        OR NEW.observation_set_json#>>'{content,knowledgePolicy}' IS DISTINCT FROM
          'retrospective_as_recorded_by_dataset_creation'
        OR NEW.observation_set_json#>>'{content,policy,content,schemaVersion}'
          IS DISTINCT FROM 'afl-trade-player-pav-policy/v2'
        OR NEW.observation_set_json#>>'{content,policy,content,knowledgePolicy}'
          IS DISTINCT FROM 'retrospective_as_recorded_by_dataset_creation'))
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
  IF NOT EXISTS (SELECT 1 FROM outcome_player_pav_policy policy
    WHERE policy.policy_id=NEW.policy_id
      AND policy.policy_json=NEW.observation_set_json#>'{content,policy}')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(
      NEW.observation_set_json#>'{content,observations}') item(value)
      WHERE CASE WHEN NEW.observation_set_json#>>'{content,schemaVersion}'=
        'afl-trade-player-pav-observation-set/v2'
        THEN item.value->'knowledgeBinding' IS DISTINCT FROM jsonb_build_object(
          'policy','retrospective_as_recorded_by_dataset_creation',
          'knowledgeCutoffAt',NEW.observation_set_json#>>'{content,knowledgeCutoffAt}')
        ELSE item.value ? 'knowledgeBinding' END)
  THEN RAISE EXCEPTION 'Player PAV exact policy or observation knowledge binding mismatch'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION validate_outcome_player_pav_finalization() RETURNS TRIGGER
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
    OR NEW.observation_set_json#>'{content,policy}' IS DISTINCT FROM policy_row.policy_json
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
      OR CASE WHEN NEW.observation_set_json#>>'{content,schemaVersion}'=
        'afl-trade-player-pav-observation-set/v2' THEN
        COALESCE((observation.observation_json->>'predictionCutoffAt')::TIMESTAMPTZ>
          NEW.knowledge_cutoff_at,TRUE)
        OR COALESCE((observation.observation_json->>'outcomeObservedAt')::TIMESTAMPTZ>
          NEW.knowledge_cutoff_at,TRUE)
        OR
        observation.observation_json->'knowledgeBinding' IS DISTINCT FROM jsonb_build_object(
          'policy','retrospective_as_recorded_by_dataset_creation',
          'knowledgeCutoffAt',NEW.observation_set_json#>>'{content,knowledgeCutoffAt}')
        OR observation.observation_json->'acquisitionSpell' IS DISTINCT FROM jsonb_build_object(
          'spellId',spell.spell_id,'spellVersionId',spell.spell_version_id,
          'clubId',spell.club_id,'effectiveFrom',to_char(spell.start_date,'YYYY-MM-DD'),
          'effectiveThrough',CASE WHEN spell.end_date IS NULL THEN NULL
            ELSE to_char(spell.end_date,'YYYY-MM-DD') END,
          'recordedAt',to_char(spell.recorded_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        ELSE observation.observation_json ? 'knowledgeBinding' END
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
    JOIN outcome_player_pav_observation observation
      ON observation.observation_set_id=value.observation_set_id
     AND observation.observation_id=value.observation_id
    JOIN outcome_hpn_pav_calculation calculation USING (calculation_id)
    JOIN outcome_hpn_pav_calculation_player player
      ON player.calculation_id=value.calculation_id
     AND player.spell_version_id=value.spell_version_id
    WHERE value.observation_set_id=NEW.observation_set_id AND (
      value.value_json->>'calculationId'<>value.calculation_id
      OR (NEW.observation_set_json#>>'{content,schemaVersion}'=
        'afl-trade-player-pav-observation-set/v2' AND (
          (value.value_json->>'seasonYear')::INTEGER IS DISTINCT FROM calculation.season_year
          OR (value.value_json->>'calculatedAt')::TIMESTAMPTZ
            IS DISTINCT FROM calculation.calculated_at
          OR (value.value_json->>'effectiveThrough')::TIMESTAMPTZ
            IS DISTINCT FROM calculation.effective_through
          OR (value.value_role='feature' AND calculation.effective_through>
            (observation.observation_json->>'predictionCutoffAt')::TIMESTAMPTZ)))
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

DO $membership$ BEGIN
  EXECUTE format('GRANT afl_trade_private_valuation_scheduler_owner TO %I',session_user);
END $membership$;
SET ROLE afl_trade_private_valuation_scheduler_owner;

CREATE OR REPLACE FUNCTION authenticate_outcome_private_player_pav_authority(
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
        AND spell.recorded_at<=CASE
          WHEN policy.policy_json#>>'{content,schemaVersion}'='afl-trade-player-pav-policy/v2'
          THEN parent.knowledge_cutoff_at
          ELSE make_timestamptz(prediction.value::INTEGER,12,31,23,59,59,'UTC') END))
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

DO $paths$ BEGIN
  EXECUTE format('ALTER FUNCTION %I.authenticate_outcome_private_player_pav_authority(TEXT,TEXT,TEXT) SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema());
  EXECUTE format('REVOKE ALL ON FUNCTION %I.authenticate_outcome_private_player_pav_authority(TEXT,TEXT,TEXT) FROM PUBLIC',
    current_schema());
END $paths$;
RESET ROLE;
DO $membership$ BEGIN
  EXECUTE format('REVOKE afl_trade_private_valuation_scheduler_owner FROM %I',session_user);
END $membership$;
