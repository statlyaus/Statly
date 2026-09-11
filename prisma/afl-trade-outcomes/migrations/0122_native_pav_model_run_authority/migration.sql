-- Native PAV protocol/projection custody at the existing registration boundary.
-- Current HPN inputs, source rights and consume-once execution remain their existing
-- owners' responsibility. No new registry, grants or execution authority is introduced.
DO $migration$
DECLARE definition TEXT; marker CONSTANT TEXT := '  RETURN NEW;'; addition TEXT;
BEGIN
  SELECT pg_get_functiondef('validate_outcome_valuation_model_protocol_insert()'::regprocedure)
    INTO definition;
  addition := $guard$
  DECLARE content JSONB := NEW.protocol_json->'content'; original RECORD; method RECORD;
    reference JSONB; document JSONB; bytes TEXT; digest TEXT;
  BEGIN
    IF content->>'schemaVersion'='afl-trade-model-protocol/v3'
      OR dataset_row.dataset_json#>>'{content,schemaVersion}'='afl-trade-valuation-dataset/v5' THEN
      SELECT * INTO original FROM outcome_player_pav_observation_set
        WHERE observation_set_id=dataset_row.dataset_json#>>'{content,pavObservationSet,observationSetId}' FOR SHARE;
      SELECT * INTO method FROM outcome_hpn_pav_method
        WHERE method_id=original.observation_set_json#>>'{content,policy,content,methodId}' FOR SHARE;
      IF content->>'schemaVersion' IS DISTINCT FROM 'afl-trade-model-protocol/v3'
        OR dataset_row.dataset_json#>>'{content,schemaVersion}' IS DISTINCT FROM 'afl-trade-valuation-dataset/v5'
        OR original.observation_set_id IS NULL OR original.status IS DISTINCT FROM 'finalized'
        OR method.method_id IS NULL OR method.environment IS DISTINCT FROM NEW.environment
        OR original.environment IS DISTINCT FROM NEW.environment
        OR NEW.environment NOT IN ('test_fixture','non_production')
        OR NEW.protocol_canonical_json IS DISTINCT FROM outcome_afl_trade_canonical_json(content)
        OR content#>>'{sourceObservationSet,observationSetId}' IS DISTINCT FROM original.observation_set_id
        OR content#>>'{pavPolicy,policyId}' IS DISTINCT FROM original.observation_set_json#>>'{content,policy,policyId}'
        OR content#>>'{hpnMethod,methodId}' IS DISTINCT FROM method.method_id
        OR original.observation_set_json#>>'{content,policy,content,fixedHorizonSeasons}' IS DISTINCT FROM '3'
        OR content->'target' IS DISTINCT FROM '{"fixedHorizonSeasons":3,"annualValueUnit":"season_pav","aggregation":"sum","valueUnit":"fixed_horizon_pav"}'::JSONB
        OR content#>>'{featurePolicy,knowledgeJoin}' IS DISTINCT FROM dataset_row.dataset_json#>>'{content,specification,content,featurePolicy,knowledgeJoin}'
        OR content#>>'{datasetAdmission,admittedAt}' IS DISTINCT FROM admission_row.admission_json#>>'{content,admittedAt}'
        OR method.captured_at>original.knowledge_cutoff_at
        OR EXISTS (SELECT 1 FROM unnest(ARRAY['train','calibration','validation','finalTest']) partition
          WHERE content->'windows'->partition->>'from' IS NULL
            OR content->'windows'->partition->>'to' IS NULL
            OR (content->'windows'->partition->>'from')::TIMESTAMPTZ>=
              (content->'windows'->partition->>'to')::TIMESTAMPTZ)
        OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(dataset_row.dataset_json#>'{content,specification,content,featureDefinitions}') feature
          WHERE feature=content->'featureDefinitionArtifact')
      THEN RAISE EXCEPTION 'Native PAV protocol ancestry mismatch'; END IF;
      FOR reference,document IN
        SELECT content#>'{sourceObservationSet,artifact}',original.observation_set_json
        UNION ALL SELECT content#>'{pavPolicy,artifact}',original.observation_set_json#>'{content,policy}'
        UNION ALL SELECT content#>'{hpnMethod,artifact}',method.method_json
      LOOP
        bytes:=outcome_afl_trade_canonical_json(document);
        digest:=encode(sha256(convert_to(bytes,'UTF8')),'hex');
        IF reference->>'artifactId' IS DISTINCT FROM 'artifact:'||digest
          OR reference->>'contentSha256' IS DISTINCT FROM digest
          OR reference->>'mediaType' IS DISTINCT FROM 'application/json'
          OR (reference->>'byteLength')::BIGINT IS DISTINCT FROM octet_length(convert_to(bytes,'UTF8'))
        THEN RAISE EXCEPTION 'Native PAV protocol artifact mismatch'; END IF;
      END LOOP;
    END IF;
  END;
$guard$;
  IF (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1 THEN
    RAISE EXCEPTION 'Native PAV protocol guard expected one existing return';
  END IF;
  EXECUTE replace(definition,marker,addition||marker);

  SELECT pg_get_functiondef('validate_outcome_valuation_observation_set_insert()'::regprocedure)
    INTO definition;
  addition := $guard$
  DECLARE content JSONB := NEW.observation_json->'content'; original RECORD;
    observations JSONB; expected JSONB;
  BEGIN
    IF content->>'schemaVersion'='afl-trade-player-observation-set/v3'
      OR protocol_row.protocol_json#>>'{content,schemaVersion}'='afl-trade-model-protocol/v3'
      OR dataset_row.dataset_json#>>'{content,schemaVersion}'='afl-trade-valuation-dataset/v5' THEN
      IF content->>'schemaVersion' IS DISTINCT FROM 'afl-trade-player-observation-set/v3'
        OR protocol_row.protocol_json#>>'{content,schemaVersion}' IS DISTINCT FROM 'afl-trade-model-protocol/v3'
        OR dataset_row.dataset_json#>>'{content,schemaVersion}' IS DISTINCT FROM 'afl-trade-valuation-dataset/v5'
        OR NEW.environment IS DISTINCT FROM protocol_row.environment
      THEN RAISE EXCEPTION 'Native PAV observation versions mismatch'; END IF;
      SELECT * INTO original FROM outcome_player_pav_observation_set
        WHERE observation_set_id=dataset_row.dataset_json#>>'{content,pavObservationSet,observationSetId}' FOR SHARE;
      IF original.observation_set_id IS NULL OR original.status IS DISTINCT FROM 'finalized' THEN
        RAISE EXCEPTION 'Native PAV observation original set missing';
      END IF;
      WITH projected AS (
        SELECT row.ordinal,jsonb_build_object('datasetRowId',row.row_id,'rowOrdinal',row.ordinal,
          'pavObservation',observation) body
        FROM outcome_valuation_dataset_row row
        JOIN jsonb_array_elements(original.observation_set_json#>'{content,observations}') observation
          ON observation->>'observationId'=row.row_json#>>'{content,pavObservationId}'
        WHERE row.dataset_id=NEW.dataset_id
      ) SELECT jsonb_agg(body||jsonb_build_object('observationId','player-observation:'||
        encode(sha256(convert_to(outcome_afl_trade_canonical_json(body),'UTF8')),'hex')) ORDER BY ordinal)
        INTO observations FROM projected;
      expected:=jsonb_build_object(
        'schemaVersion','afl-trade-player-observation-set/v3',
        'publicIdentityBoundary','source_native_no_fantasy_ownership',
        'authorityBoundary','deterministic_admitted_pav_dataset_projection_no_fit_grade_publication_or_fantasy_ownership',
        'publicationEligible',false,'observationGrain','player_acquisition_spell_prediction',
        'featureKnowledgePolicy',dataset_row.dataset_json#>>'{content,specification,content,featurePolicy,knowledgeJoin}',
        'valueUnit','fixed_horizon_pav','fixedHorizonSeasons',3,
        'datasetId',NEW.dataset_id,'datasetRowSetSha256',NEW.dataset_row_set_sha256,
        'datasetAdmissionId',NEW.admission_id,'modelProtocolId',NEW.protocol_id,
        'pavObservationSetId',original.observation_set_id,
        'pavPolicyId',original.observation_set_json#>>'{content,policy,policyId}',
        'methodId',original.observation_set_json#>>'{content,policy,content,methodId}',
        'observations',observations);
      IF content IS DISTINCT FROM expected
        OR NEW.observation_canonical_json IS DISTINCT FROM outcome_afl_trade_canonical_json(expected)
        OR jsonb_array_length(observations) IS DISTINCT FROM dataset_row.row_count
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(observations) observation
          WHERE (observation#>>'{pavObservation,predictionCutoffAt}')::TIMESTAMPTZ<
            (protocol_row.protocol_json#>'{content,windows}'->(CASE observation#>>'{pavObservation,partition}'
              WHEN 'final_test' THEN 'finalTest' ELSE observation#>>'{pavObservation,partition}' END)->>'from')::TIMESTAMPTZ
          OR (observation#>>'{pavObservation,predictionCutoffAt}')::TIMESTAMPTZ>=
            (protocol_row.protocol_json#>'{content,windows}'->(CASE observation#>>'{pavObservation,partition}'
              WHEN 'final_test' THEN 'finalTest' ELSE observation#>>'{pavObservation,partition}' END)->>'to')::TIMESTAMPTZ)
      THEN RAISE EXCEPTION 'Native PAV observation projection mismatch'; END IF;
    END IF;
  END;
$guard$;
  IF (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1 THEN
    RAISE EXCEPTION 'Native PAV observation guard expected one existing return';
  END IF;
  EXECUTE replace(definition,marker,addition||marker);
END;
$migration$;
