-- PAV uses the existing private dataset owner. Legacy dataset/row paths remain unchanged.
-- Union-find retains one representative per identity, never all reachable identity pairs.
CREATE FUNCTION outcome_player_pav_dataset_selection(observations JSONB, mappings JSONB)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  nodes TEXT[]; parents INTEGER[]; sizes INTEGER[]; roots INTEGER[];
  edge RECORD; i INTEGER; left_root INTEGER; right_root INTEGER; result JSONB;
BEGIN
  SELECT array_agg(node ORDER BY node COLLATE "C") INTO nodes FROM (
    SELECT 'player:'||(value->>'playerId') node FROM jsonb_array_elements(mappings)
    UNION SELECT 'event:'||(value->>'eventId') FROM jsonb_array_elements(mappings)
    UNION SELECT 'spell:'||(value->>'acquisitionSpellVersionId') FROM jsonb_array_elements(mappings)
  ) identities;
  IF COALESCE(cardinality(nodes),0)=0 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(observations) observation WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(mappings) mapping
      WHERE mapping->>'playerId'=observation->>'playerId'
        AND mapping->>'clubId'=observation#>>'{acquisitionSpell,clubId}'
        AND mapping->>'acquisitionSpellId'=observation#>>'{acquisitionSpell,spellId}'
        AND mapping->>'acquisitionSpellVersionId'=observation#>>'{acquisitionSpell,spellVersionId}'))
  THEN RAISE EXCEPTION 'PAV selection requires exact sealed observation lineage'; END IF;
  SELECT array_agg(index),array_agg(1) INTO parents,sizes
    FROM generate_series(1,cardinality(nodes)) index;
  FOR edge IN
    WITH indexed AS (SELECT node,index::INTEGER FROM unnest(nodes) WITH ORDINALITY item(node,index)),
    links AS (
      SELECT 'player:'||(value->>'playerId') left_node,
             'event:'||(value->>'eventId') right_node FROM jsonb_array_elements(mappings)
      UNION ALL SELECT 'player:'||(value->>'playerId'),
             'spell:'||(value->>'acquisitionSpellVersionId') FROM jsonb_array_elements(mappings))
    SELECT a.index left_index,b.index right_index FROM links
      JOIN indexed a ON a.node=links.left_node JOIN indexed b ON b.node=links.right_node
  LOOP
    left_root:=edge.left_index; right_root:=edge.right_index;
    WHILE parents[left_root]<>left_root LOOP left_root:=parents[left_root]; END LOOP;
    WHILE parents[right_root]<>right_root LOOP right_root:=parents[right_root]; END LOOP;
    IF left_root<>right_root THEN
      IF sizes[left_root]<sizes[right_root] THEN
        parents[left_root]:=right_root; sizes[right_root]:=sizes[right_root]+sizes[left_root];
      ELSE
        parents[right_root]:=left_root; sizes[left_root]:=sizes[left_root]+sizes[right_root];
      END IF;
    END IF;
  END LOOP;
  roots:=parents;
  FOR i IN 1..cardinality(nodes) LOOP
    left_root:=i;
    WHILE parents[left_root]<>left_root LOOP left_root:=parents[left_root]; END LOOP;
    roots[i]:=left_root;
  END LOOP;
  WITH identities AS (
    SELECT node,roots[index] representative FROM unnest(nodes) WITH ORDINALITY item(node,index)),
  original AS (
    SELECT observation,representative FROM jsonb_array_elements(observations) observation
      JOIN identities ON node='player:'||(observation->>'playerId')),
  components AS (
    SELECT representative,outcome_afl_trade_canonical_json(jsonb_build_array(
      COALESCE(jsonb_agg(substring(node FROM 8) ORDER BY node COLLATE "C") FILTER (WHERE node LIKE 'player:%'),'[]'::JSONB),
      COALESCE(jsonb_agg(substring(node FROM 7) ORDER BY node COLLATE "C") FILTER (WHERE node LIKE 'event:%'),'[]'::JSONB),
      COALESCE(jsonb_agg(substring(node FROM 7) ORDER BY node COLLATE "C") FILTER (WHERE node LIKE 'spell:%'),'[]'::JSONB))) sort_key
    FROM identities WHERE representative IN (SELECT representative FROM original) GROUP BY representative),
  assigned AS (
    SELECT representative,(ARRAY['train','calibration','validation','final_test'])[
      ((row_number() OVER (ORDER BY sort_key COLLATE "C")-1)%4+1)::INTEGER] partition FROM components),
  selected AS (SELECT observation,partition FROM original JOIN assigned USING (representative))
  SELECT jsonb_build_object(
    'includedObservationIds',COALESCE(jsonb_agg(observation->>'observationId' ORDER BY observation->>'observationId' COLLATE "C")
      FILTER (WHERE observation->>'partition'=partition),'[]'::JSONB),
    'excludedObservations',COALESCE(jsonb_agg(jsonb_build_object('observationId',observation->>'observationId',
      'assignedPartition',partition,'reason','assigned_to_different_partition') ORDER BY observation->>'observationId' COLLATE "C")
      FILTER (WHERE observation->>'partition'<>partition),'[]'::JSONB)) INTO result FROM selected;
  RETURN result;
END $$;

CREATE FUNCTION validate_outcome_player_pav_dataset(content JSONB) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE retained RECORD; authority JSONB; lineage JSONB; selection JSONB; policy JSONB; report JSONB;
  reference JSONB; expected_digest TEXT; expected_bytes TEXT;
BEGIN
  IF content->>'schemaVersion'<>'afl-trade-valuation-dataset/v5' THEN
    IF content ? 'pavObservationSet' OR EXISTS (SELECT 1 FROM jsonb_array_elements(content->'rows') row
      WHERE row#>>'{content,schemaVersion}' IS DISTINCT FROM 'afl-trade-valuation-dataset-row/v3')
    THEN RAISE EXCEPTION 'Legacy dataset cannot consume PAV rows'; END IF;
    RETURN;
  END IF;
  SELECT * INTO retained FROM outcome_player_pav_observation_set
    WHERE observation_set_id=content#>>'{pavObservationSet,observationSetId}' FOR SHARE;
  IF NOT FOUND OR retained.status<>'finalized' OR retained.finalized_at IS NULL
    OR retained.environment::TEXT<>content->>'environment' OR retained.environment::TEXT='production'
    OR retained.release_id<>content#>>'{factualParent,factualReleaseId}'
    OR retained.competition<>content->>'competition'
    OR retained.knowledge_cutoff_at<>(content->>'knowledgeCutoffAt')::TIMESTAMPTZ
    OR retained.created_at>(content->>'createdAt')::TIMESTAMPTZ
    OR retained.observation_set_json#>>'{content,policy,content,fixedHorizonSeasons}'<>'3'
  THEN RAISE EXCEPTION 'PAV dataset requires exact finalized private original observations'; END IF;
  IF retained.environment::TEXT<>'test_fixture' THEN
    authority:=load_outcome_private_player_pav_authority(content#>>'{pavObservationSet,requestId}');
    IF authority IS NULL OR authority->>'releaseId' IS DISTINCT FROM retained.release_id
      OR authority->>'policyId' IS DISTINCT FROM retained.policy_id
      OR authority->>'lineageId' IS DISTINCT FROM content#>>'{factualParent,corpusToCandidateLineageId}'
      OR (authority->>'knowledgeCutoffAt')::TIMESTAMPTZ IS DISTINCT FROM retained.knowledge_cutoff_at
    THEN RAISE EXCEPTION 'PAV dataset private request authority is not current'; END IF;
  END IF;
  SELECT lineage_json INTO lineage FROM outcome_corpus_factual_lineage
    WHERE lineage_id=content#>>'{factualParent,corpusToCandidateLineageId}';
  IF lineage IS NULL THEN
    SELECT lineage_json INTO lineage FROM outcome_valuation_dataset_factual_lineage
      WHERE lineage_id=content#>>'{factualParent,corpusToCandidateLineageId}';
  END IF;
  selection:=outcome_player_pav_dataset_selection(retained.observation_set_json#>'{content,observations}',
    lineage#>'{content,domainLineageMappings}');
  policy:=jsonb_build_object('schemaVersion','afl-trade-player-pav-dataset-inclusion/v1',
    'observationSetId',retained.observation_set_id,'selectionRule','sorted_leakage_components_round_robin',
    'partitionOrder',jsonb_build_array('train','calibration','validation','final_test'),
    'selectionInputs','player_event_acquisition_spell_identities_only');
  report:=selection||jsonb_build_object('schemaVersion','afl-trade-player-pav-dataset-exclusion/v1',
    'observationSetId',retained.observation_set_id,
    'inclusionPolicyArtifactId',content#>>'{specification,content,inclusionPolicy,artifactId}');
  FOR reference,expected_bytes IN
    SELECT content#>'{pavObservationSet,artifact}',outcome_afl_trade_canonical_json(retained.observation_set_json)
    UNION ALL SELECT content#>'{specification,content,inclusionPolicy}',outcome_afl_trade_canonical_json(policy)
    UNION ALL SELECT content->'exclusionReport',outcome_afl_trade_canonical_json(report)
  LOOP
    expected_digest:=encode(sha256(convert_to(expected_bytes,'UTF8')),'hex');
    IF reference->>'artifactId' IS DISTINCT FROM 'artifact:'||expected_digest
      OR reference->>'contentSha256' IS DISTINCT FROM expected_digest
      OR reference->>'mediaType' IS DISTINCT FROM 'application/json'
      OR (reference->>'byteLength')::BIGINT IS DISTINCT FROM octet_length(convert_to(expected_bytes,'UTF8'))
    THEN RAISE EXCEPTION 'PAV dataset original/selection artifact does not bind exact canonical content'; END IF;
  END LOOP;
  IF (content#>>'{specification,content,inclusionPolicy,createdAt}')::TIMESTAMPTZ<retained.created_at
    OR (SELECT jsonb_agg(row#>>'{content,pavObservationId}' ORDER BY row#>>'{content,pavObservationId}' COLLATE "C")
      FROM jsonb_array_elements(content->'rows') row) IS DISTINCT FROM selection->'includedObservationIds'
    OR (SELECT count(DISTINCT row#>>'{content,splitRole}') FROM jsonb_array_elements(content->'rows') row)<>4
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(content->'rows') row
      LEFT JOIN jsonb_array_elements(retained.observation_set_json#>'{content,observations}') observation
        ON observation->>'observationId'=row#>>'{content,pavObservationId}'
      WHERE observation IS NULL OR row#>>'{content,schemaVersion}' IS DISTINCT FROM 'afl-trade-valuation-dataset-row/v4'
        OR row#>>'{content,identity,playerId}' IS DISTINCT FROM observation->>'playerId'
        OR row#>>'{content,identity,clubId}' IS DISTINCT FROM observation#>>'{acquisitionSpell,clubId}'
        OR row#>>'{content,lineage,acquisitionSpellVersionId}' IS DISTINCT FROM observation#>>'{acquisitionSpell,spellVersionId}'
        OR row#>>'{content,splitRole}' IS DISTINCT FROM observation->>'partition'
        OR row#>>'{content,seasonYear}' IS DISTINCT FROM observation->>'predictionSeason'
        OR row#>>'{content,predictionOriginAt}' IS DISTINCT FROM observation->>'predictionCutoffAt'
        OR (row#>>'{content,targetFrom}')::TIMESTAMPTZ IS DISTINCT FROM (observation->>'predictionCutoffAt')::TIMESTAMPTZ+interval '1 millisecond'
        OR row#>>'{content,targetThrough}' IS DISTINCT FROM observation->>'outcomeHorizonEndsAt')
  THEN RAISE EXCEPTION 'PAV dataset rows do not exactly match committed original observation selection'; END IF;
  -- Lock and check every original calculation, including measurements excluded from training rows.
  PERFORM 1 FROM outcome_hpn_pav_calculation_head head
    JOIN jsonb_array_elements(retained.observation_set_json#>'{content,calculations}') member
      ON member->>'calculationId'=head.calculation_id
    ORDER BY head.season_year,head.method_id FOR SHARE OF head;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(retained.observation_set_json#>'{content,calculations}') member
    LEFT JOIN outcome_hpn_pav_calculation calculation ON calculation.calculation_id=member->>'calculationId'
    LEFT JOIN outcome_hpn_pav_calculation_head head ON head.calculation_id=calculation.calculation_id
      AND head.environment=calculation.environment AND head.competition=calculation.competition
      AND head.season_year=calculation.season_year AND head.method_id=calculation.method_id
    LEFT JOIN outcome_hpn_pav_input_set inputs ON inputs.input_set_id=calculation.input_set_id
    WHERE head.calculation_id IS NULL OR calculation.status<>'finalized' OR calculation.finalized_at IS NULL
      OR inputs.status<>'finalized' OR inputs.finalized_at IS NULL
      OR calculation.environment<>retained.environment OR calculation.competition<>retained.competition
      OR calculation.method_id IS DISTINCT FROM retained.observation_set_json#>>'{content,policy,content,methodId}'
      OR calculation.calculated_at>retained.knowledge_cutoff_at
      OR member->>'inputSetId' IS DISTINCT FROM calculation.input_set_id
      OR member->>'methodId' IS DISTINCT FROM calculation.method_id)
  THEN RAISE EXCEPTION 'PAV dataset original calculation universe is no longer current'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(retained.observation_set_json#>'{content,calculations}') member
      JOIN outcome_hpn_pav_input_set inputs ON inputs.input_set_id=member->>'inputSetId'
      CROSS JOIN LATERAL jsonb_array_elements(inputs.input_set_json#>'{content,sourceRuns}') run
    WHERE NOT EXISTS (
      SELECT 1 FROM outcome_factual_release_candidate candidate,
        LATERAL jsonb_array_elements(candidate.candidate_json#>'{content,members,sourceCaptures}') capture
      WHERE candidate.candidate_id=content#>>'{factualParent,factualCandidateId}'
        AND capture->>'captureId'=run->>'captureId'
        AND capture->>'sourceSnapshotId'=run->>'sourceSnapshotId'))
  THEN RAISE EXCEPTION 'PAV dataset factual parent omits league-wide source capture ancestry'; END IF;
  IF EXISTS (
    WITH selected AS (
      SELECT row->'content' row,observation FROM jsonb_array_elements(content->'rows') row
        JOIN jsonb_array_elements(retained.observation_set_json#>'{content,observations}') observation
          ON row#>>'{content,pavObservationId}'=observation->>'observationId'),
    sides AS (
      SELECT row->'featureInputs' inputs,observation->'featureValues' measured_values FROM selected
      UNION ALL SELECT row->'targetInputs',observation->'targetValues' FROM selected)
    SELECT 1 FROM sides WHERE jsonb_array_length(inputs)<>jsonb_array_length(measured_values)
      OR (SELECT count(DISTINCT input->>'memberId') FROM jsonb_array_elements(inputs) input)<>jsonb_array_length(inputs)
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(inputs) input
        LEFT JOIN jsonb_array_elements(measured_values) measured(value)
          ON measured.value->>'calculationId'=input->>'calculationId' AND measured.value->>'spellVersionId'=input->>'spellVersionId'
        LEFT JOIN outcome_hpn_pav_calculation calculation ON calculation.calculation_id=input->>'calculationId'
        LEFT JOIN outcome_hpn_pav_calculation_head head ON head.calculation_id=calculation.calculation_id
          AND head.environment=calculation.environment AND head.competition=calculation.competition
          AND head.season_year=calculation.season_year AND head.method_id=calculation.method_id
        LEFT JOIN outcome_hpn_pav_calculation_player player ON player.calculation_id=calculation.calculation_id
          AND player.spell_version_id=input->>'spellVersionId'
        LEFT JOIN outcome_hpn_pav_input_set source ON source.input_set_id=calculation.input_set_id
        WHERE measured.value IS NULL OR player.player_sha256 IS NULL
          OR input->>'kind' IS DISTINCT FROM 'hpn_pav_measurement' OR input->>'state' IS DISTINCT FROM 'finalized'
          OR input->>'memberId' IS DISTINCT FROM 'hpn-pav-measurement:'||encode(sha256(convert_to(
            outcome_afl_trade_canonical_json(jsonb_build_object('calculationId',input->>'calculationId',
              'spellVersionId',input->>'spellVersionId','playerSha256',measured.value->>'playerSha256')),'UTF8')),'hex')
          OR input->>'recordSha256' IS DISTINCT FROM measured.value->>'playerSha256'
          OR input->>'recordSha256' IS DISTINCT FROM player.player_sha256::TEXT
          OR (input->>'headRevision')::INTEGER IS DISTINCT FROM head.revision
          OR input->>'inputSetId' IS DISTINCT FROM calculation.input_set_id
          OR input->>'methodId' IS DISTINCT FROM calculation.method_id
          OR input->>'seasonYear' IS DISTINCT FROM measured.value->>'seasonYear'
          OR input->>'playerId' IS DISTINCT FROM measured.value->>'playerId'
          OR input->>'clubId' IS DISTINCT FROM measured.value->>'clubId'
          OR input->>'effectiveThrough' IS DISTINCT FROM measured.value->>'effectiveThrough'
          OR input->>'recordedAt' IS DISTINCT FROM measured.value->>'calculatedAt'
          OR (input->>'effectiveFrom')::TIMESTAMPTZ IS DISTINCT FROM (
            SELECT min((match->>'effectiveAt')::TIMESTAMPTZ)
              FROM jsonb_array_elements(source.input_set_json#>'{content,rows}') source_row
              JOIN jsonb_array_elements(source.input_set_json#>'{content,completedMatches}') match
                ON match->>'matchId'=source_row#>>'{match,canonicalId}'
              WHERE source_row->>'kind'='player_match_stats'
                AND source_row#>>'{acquisitionSpell,spellVersionId}'=input->>'spellVersionId')))
  THEN RAISE EXCEPTION 'PAV dataset measurement references differ from original finalized values'; END IF;
  IF retained.observation_set_json#>>'{content,knowledgePolicy}' IS NOT NULL
    AND content#>>'{specification,content,featurePolicy,knowledgeJoin}' IS DISTINCT FROM 'retrospective_as_captured_at_dataset_creation'
  THEN RAISE EXCEPTION 'Retrospective PAV requires explicit retrospective dataset knowledge policy'; END IF;
END $$;

CREATE FUNCTION validate_outcome_player_pav_dataset_source_coverage(dataset JSONB, admission_id TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF dataset->>'schemaVersion'<>'afl-trade-valuation-dataset/v5' THEN RETURN; END IF;
  PERFORM validate_outcome_player_pav_dataset(dataset);
  IF EXISTS (
    SELECT 1 FROM outcome_player_pav_observation_set retained
      CROSS JOIN LATERAL jsonb_array_elements(retained.observation_set_json#>'{content,calculations}') member
      JOIN outcome_hpn_pav_input_set inputs ON inputs.input_set_id=member->>'inputSetId'
      CROSS JOIN LATERAL jsonb_array_elements(inputs.input_set_json#>'{content,sourceRuns}') run
    WHERE retained.observation_set_id=dataset#>>'{pavObservationSet,observationSetId}'
      AND NOT EXISTS (
        SELECT 1 FROM outcome_valuation_dataset_admission_source source
          JOIN outcome_valuation_dataset_consumed_field_set fields ON fields.field_set_id=source.consumed_field_set_id
        WHERE source.admission_id=validate_outcome_player_pav_dataset_source_coverage.admission_id
          AND source.capture_id=run->>'captureId' AND source.source_snapshot_id=run->>'sourceSnapshotId'
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(inputs.input_set_json#>'{content,rows}') source_row
              CROSS JOIN LATERAL jsonb_array_elements_text(source_row#>'{source,sourceFields}') field
            WHERE source_row#>>'{source,normalizationRunId}'=run->>'normalizationRunId'
              AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(fields.field_set_json#>'{content,fields}') consumed
                WHERE consumed->>'sourceField'=field))))
  THEN RAISE EXCEPTION 'PAV dataset requires training and derivation source evidence for the entire original league universe'; END IF;
END $$;

ALTER TABLE outcome_valuation_dataset_artifact_member DROP CONSTRAINT outcome_valuation_dataset_artifact_member_role_check;
ALTER TABLE outcome_valuation_dataset_artifact_member ADD CONSTRAINT outcome_valuation_dataset_artifact_member_role_check
  CHECK (role IN ('dataset','exclusion_report','extractor_code','extractor_configuration',
    'feature_definition','target_definition','value_unit_definition','role_taxonomy',
    'era_definition','censoring_definition','inclusion_policy','pav_observation_set'));

-- Exact-once replacements fail closed if the existing owner changes underneath this migration.
CREATE FUNCTION pg_temp.replace_pav_dataset_guard(signature TEXT,old_fragment TEXT,new_fragment TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE definition TEXT; occurrences INTEGER;
BEGIN
  SELECT pg_get_functiondef(to_regprocedure(signature)) INTO definition;
  IF definition IS NULL THEN RAISE EXCEPTION 'Expected dataset owner % missing',signature; END IF;
  occurrences:=(length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment);
  IF occurrences<>1 THEN RAISE EXCEPTION 'Expected one dataset owner fragment in %, found %',signature,occurrences; END IF;
  EXECUTE replace(definition,old_fragment,new_fragment);
END $$;
SELECT pg_temp.replace_pav_dataset_guard('validate_outcome_valuation_dataset_candidate_insert()',
  $old$content->>'schemaVersion'<>'afl-trade-valuation-dataset/v4'$old$,
  $new$content->>'schemaVersion' NOT IN ('afl-trade-valuation-dataset/v4','afl-trade-valuation-dataset/v5')$new$);
SELECT pg_temp.replace_pav_dataset_guard('validate_outcome_valuation_dataset_candidate_insert()',
  'RETURN NEW;', $new$IF content->>'schemaVersion'='afl-trade-valuation-dataset/v5' THEN
    PERFORM validate_outcome_player_pav_dataset(content); END IF; RETURN NEW;$new$);
SELECT pg_temp.replace_pav_dataset_guard('validate_outcome_valuation_dataset_row_insert()',
  $old$content->>'schemaVersion'<>'afl-trade-valuation-dataset-row/v3'$old$,
  $new$content->>'schemaVersion' IS DISTINCT FROM (CASE WHEN EXISTS (
    SELECT 1 FROM outcome_valuation_dataset_candidate parent WHERE parent.dataset_id=NEW.dataset_id
      AND parent.dataset_json#>>'{content,schemaVersion}'='afl-trade-valuation-dataset/v5')
    THEN 'afl-trade-valuation-dataset-row/v4' ELSE 'afl-trade-valuation-dataset-row/v3' END)$new$);
SELECT pg_temp.replace_pav_dataset_guard('finalize_outcome_valuation_dataset_candidate()',
  'expected_artifact_count:=10+jsonb_array_length(',
  $new$expected_artifact_count:=10+CASE WHEN NEW.dataset_json#>>'{content,schemaVersion}'='afl-trade-valuation-dataset/v5' THEN 1 ELSE 0 END+jsonb_array_length($new$);
SELECT pg_temp.replace_pav_dataset_guard('finalize_outcome_valuation_dataset_candidate()',
  $old$SELECT 'dataset',1,NEW."dataset_json"->'content'->'datasetArtifact' UNION ALL$old$,
  $new$SELECT 'pav_observation_set',1,NEW.dataset_json#>'{content,pavObservationSet,artifact}'
        WHERE NEW.dataset_json#>>'{content,schemaVersion}'='afl-trade-valuation-dataset/v5' UNION ALL
      SELECT 'dataset',1,NEW."dataset_json"->'content'->'datasetArtifact' UNION ALL$new$);
SELECT pg_temp.replace_pav_dataset_guard('finalize_outcome_valuation_dataset_candidate()',
  'RETURN NEW;', $new$IF NEW.dataset_json#>>'{content,schemaVersion}'='afl-trade-valuation-dataset/v5' THEN
    PERFORM validate_outcome_player_pav_dataset(NEW.dataset_json->'content'); END IF; RETURN NEW;$new$);
SELECT pg_temp.replace_pav_dataset_guard('validate_outcome_valuation_dataset_admission_insert()',
  'RETURN NEW;', $new$IF dataset.dataset_json#>>'{content,schemaVersion}'='afl-trade-valuation-dataset/v5' THEN
    PERFORM validate_outcome_player_pav_dataset(dataset.dataset_json->'content'); END IF; RETURN NEW;$new$);
SELECT pg_temp.replace_pav_dataset_guard('finalize_outcome_valuation_dataset_admission()',
  'RETURN NEW;', $new$IF EXISTS (SELECT 1 FROM outcome_valuation_dataset_candidate
    WHERE dataset_id=NEW.dataset_id AND dataset_json#>>'{content,schemaVersion}'='afl-trade-valuation-dataset/v5') THEN
      PERFORM validate_outcome_player_pav_dataset_source_coverage(
        (SELECT dataset_json->'content' FROM outcome_valuation_dataset_candidate WHERE dataset_id=NEW.dataset_id),NEW.admission_id); END IF;
    RETURN NEW;$new$);
DROP FUNCTION pg_temp.replace_pav_dataset_guard(TEXT,TEXT,TEXT);

-- These are internal helpers for the existing administrative admission owner,
-- not new source-admission capabilities for the restricted evaluation coordinator.
DO $$ DECLARE signature TEXT; BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'outcome_player_pav_dataset_selection(JSONB,JSONB)',
    'validate_outcome_player_pav_dataset(JSONB)',
    'validate_outcome_player_pav_dataset_source_coverage(JSONB,TEXT)']
  LOOP
    EXECUTE format('ALTER FUNCTION %I.%s SET search_path TO %I,pg_catalog,pg_temp',
      current_schema(),signature,current_schema());
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%s FROM PUBLIC',current_schema(),signature);
  END LOOP;
END $$;
