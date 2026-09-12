-- Retain the first trusted construction time and exact bundle result for one
-- current-model-evidence/specification pair. This is private, append-only
-- construction custody; it creates no public or production head.
CREATE TABLE outcome_valuation_input_bundle_construction_operation (
  operation_id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL,
  model_evidence_operation_id TEXT NOT NULL,
  specification_id TEXT NOT NULL,
  specification_json JSONB NOT NULL,
  specification_artifact_json JSONB NOT NULL,
  factual_revision INTEGER NOT NULL CHECK (factual_revision > 0),
  model_revision INTEGER NOT NULL CHECK (model_revision > 0),
  player_run_id TEXT NOT NULL,
  pick_run_id TEXT NOT NULL,
  constructed_at TIMESTAMPTZ(3) NOT NULL,
  valuation_input_bundle_id TEXT NOT NULL,
  valuation_input_bundle_json JSONB NOT NULL,
  valuation_input_bundle_artifact_json JSONB NOT NULL,
  result_json JSONB NOT NULL,
  CONSTRAINT outcome_bundle_construction_model_evidence_fkey
    FOREIGN KEY (model_evidence_operation_id)
    REFERENCES outcome_current_valuation_model_evidence_operation(operation_id) ON DELETE RESTRICT,
  CONSTRAINT outcome_bundle_construction_exact_input_key
    UNIQUE (scope_key,model_evidence_operation_id,specification_id),
  CONSTRAINT outcome_bundle_construction_distinct_runs_check CHECK (player_run_id<>pick_run_id)
);

CREATE INDEX outcome_bundle_construction_scope_time_idx
  ON outcome_valuation_input_bundle_construction_operation(scope_key,constructed_at);
CREATE FUNCTION validate_outcome_bundle_construction_insert() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE operation_preimage JSONB; bundle_content TEXT; bundle_bytes BYTEA;
  specification_content TEXT; specification_bytes BYTEA; expected_specification_sha TEXT;
  expected_specification_artifact_sha TEXT; expected_bundle_sha TEXT;
  expected_artifact_sha TEXT; evidence JSONB;
BEGIN
  SELECT result_json INTO evidence
    FROM outcome_current_valuation_model_evidence_operation
   WHERE operation_id=NEW.model_evidence_operation_id AND scope_key=NEW.scope_key
     AND result_state='qualified' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Valuation input bundle construction evidence is unavailable'; END IF;
  operation_preimage:=jsonb_build_object(
    'scopeKey',NEW.scope_key,
    'modelEvidenceOperationId',NEW.model_evidence_operation_id,
    'specificationId',NEW.specification_id);
  bundle_content:=outcome_afl_trade_canonical_json(NEW.valuation_input_bundle_json->'content');
  bundle_bytes:=convert_to(outcome_afl_trade_canonical_json(NEW.valuation_input_bundle_json),'UTF8');
  specification_content:=outcome_afl_trade_canonical_json(NEW.specification_json->'content');
  specification_bytes:=convert_to(outcome_afl_trade_canonical_json(NEW.specification_json),'UTF8');
  expected_specification_sha:=encode(sha256(convert_to(specification_content,'UTF8')),'hex');
  expected_specification_artifact_sha:=encode(sha256(specification_bytes),'hex');
  expected_bundle_sha:=encode(sha256(convert_to(bundle_content,'UTF8')),'hex');
  expected_artifact_sha:=encode(sha256(bundle_bytes),'hex');
  IF NEW.operation_id IS DISTINCT FROM 'valuation-input-bundle-construction-operation:'||encode(sha256(
       convert_to(outcome_afl_trade_canonical_json(operation_preimage),'UTF8')),'hex')
    OR NEW.constructed_at IS DISTINCT FROM date_trunc('milliseconds',transaction_timestamp())
    OR evidence->>'operationId' IS DISTINCT FROM NEW.model_evidence_operation_id
    OR evidence->>'scopeKey' IS DISTINCT FROM NEW.scope_key
    OR (evidence#>>'{privateFactualAuthority,revision}')::INTEGER IS DISTINCT FROM NEW.factual_revision
    OR (evidence->>'modelRevision')::INTEGER IS DISTINCT FROM NEW.model_revision
    OR evidence->>'playerRunId' IS DISTINCT FROM NEW.player_run_id
    OR evidence->>'pickRunId' IS DISTINCT FROM NEW.pick_run_id
    OR NEW.specification_id IS DISTINCT FROM
      'valuation-input-bundle-construction-specification:'||expected_specification_sha
    OR NEW.specification_json->>'specificationId' IS DISTINCT FROM NEW.specification_id
    OR NEW.specification_json#>>'{content,schemaVersion}' IS DISTINCT FROM
      'afl-trade-valuation-input-bundle-construction-specification/v1'
    OR NEW.specification_json#>>'{content,environment}' IS DISTINCT FROM 'non_production'
    OR NEW.specification_json#>'{content,publicationEligible}' IS DISTINCT FROM 'false'::JSONB
    OR NEW.specification_json#>>'{content,scopeKey}' IS DISTINCT FROM NEW.scope_key
    OR nullif(NEW.specification_json#>>'{content,valueUnitId}','') IS NULL
    OR NEW.specification_json#>>'{content,valueUnitId}' IS DISTINCT FROM
      btrim(NEW.specification_json#>>'{content,valueUnitId}')
    OR length(NEW.specification_json#>>'{content,valueUnitId}')>200
    OR NEW.specification_json#>>'{content,valueUnitId}' !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$'
    OR NEW.specification_json#>>'{content,limitation}' IS DISTINCT FROM
      'Retained non-production calculation configuration only; model, execution, activation, publication, and production authority remain separate.'
    OR NEW.specification_json#>>'{content,createdAt}' IS NULL
    OR NEW.specification_json#>>'{content,currentView,effectiveAt}' IS NULL
    OR NEW.specification_json#>>'{content,currentView,knowledgeCutoffAt}' IS NULL
    OR NEW.specification_json#>>'{content,currentView,valuationAsOf}' IS NULL
    OR (NEW.specification_json#>>'{content,createdAt}')::TIMESTAMPTZ>NEW.constructed_at
    OR (NEW.specification_json#>>'{content,currentView,effectiveAt}')::TIMESTAMPTZ>
      (NEW.specification_json#>>'{content,currentView,valuationAsOf}')::TIMESTAMPTZ
    OR (NEW.specification_json#>>'{content,currentView,knowledgeCutoffAt}')::TIMESTAMPTZ>
      (NEW.specification_json#>>'{content,currentView,valuationAsOf}')::TIMESTAMPTZ
    OR (SELECT count(*) FROM jsonb_each(
      NEW.specification_json#>'{content,policies}')) IS DISTINCT FROM 7::BIGINT
    OR NEW.specification_json#>'{content,policies,listSpot}' IS NULL
    OR NEW.specification_json#>'{content,policies,scarcity}' IS NULL
    OR NEW.specification_json#>'{content,policies,roleCongestion}' IS NULL
    OR NEW.specification_json#>'{content,policies,lowReturn}' IS NULL
    OR NEW.specification_json#>'{content,policies,eliteOutcome}' IS NULL
    OR NEW.specification_json#>'{content,policies,practicalEquivalence}' IS NULL
    OR NEW.specification_json#>'{content,policies,explanation}' IS NULL
    OR (SELECT count(DISTINCT value->>'artifactId') FROM jsonb_each(
      NEW.specification_json#>'{content,policies}')) IS DISTINCT FROM 7::BIGINT
    OR EXISTS (SELECT 1 FROM jsonb_each(NEW.specification_json#>'{content,policies}') policy
      WHERE policy.value->>'artifactId' IS NULL OR policy.value->>'contentSha256' IS NULL
        OR policy.value->>'storageUri' IS NULL OR nullif(policy.value->>'mediaType','') IS NULL
        OR policy.value->>'byteLength' IS NULL OR policy.value->>'createdAt' IS NULL
        OR policy.value->>'contentSha256' !~ '^[a-f0-9]{64}$'
        OR policy.value->>'artifactId' IS DISTINCT FROM 'artifact:'||(policy.value->>'contentSha256')
        OR policy.value->>'storageUri' IS DISTINCT FROM 'artifact://sha256/'||(policy.value->>'contentSha256')
        OR length(policy.value->>'mediaType')>160
        OR (policy.value->>'byteLength')::INTEGER<0
        OR (policy.value->>'createdAt')::TIMESTAMPTZ>
          (NEW.specification_json#>>'{content,createdAt}')::TIMESTAMPTZ)
    OR NEW.specification_json#>>'{content,simulation,draws}' IS NULL
    OR (NEW.specification_json#>>'{content,simulation,draws}')::INTEGER NOT BETWEEN 1 AND 100000
    OR nullif(NEW.specification_json#>>'{content,simulation,seed}','') IS NULL
    OR NEW.specification_json#>>'{content,simulation,seed}' IS DISTINCT FROM
      btrim(NEW.specification_json#>>'{content,simulation,seed}')
    OR length(NEW.specification_json#>>'{content,simulation,seed}')>200
    OR NEW.specification_json#>>'{content,simulation,seed}' !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$'
    OR NEW.specification_json#>>'{content,simulation,samplingAlgorithmVersion}' IS DISTINCT FROM
      'counter_sha256_rejection_v1'
    OR NEW.specification_artifact_json->>'artifactId' IS DISTINCT FROM
      'artifact:'||expected_specification_artifact_sha
    OR NEW.specification_artifact_json->>'contentSha256' IS DISTINCT FROM expected_specification_artifact_sha
    OR NEW.specification_artifact_json->>'storageUri' IS DISTINCT FROM
      'artifact://sha256/'||expected_specification_artifact_sha
    OR NEW.specification_artifact_json->>'mediaType' IS DISTINCT FROM 'application/json'
    OR (NEW.specification_artifact_json->>'byteLength')::INTEGER IS DISTINCT FROM
      octet_length(specification_bytes)
    OR (NEW.specification_artifact_json->>'createdAt')::TIMESTAMPTZ IS DISTINCT FROM
      (NEW.specification_json#>>'{content,createdAt}')::TIMESTAMPTZ
    OR NEW.valuation_input_bundle_id IS DISTINCT FROM 'valuation-input-bundle:'||expected_bundle_sha
    OR NEW.valuation_input_bundle_json->>'valuationInputBundleId' IS DISTINCT FROM NEW.valuation_input_bundle_id
    OR NEW.valuation_input_bundle_json#>>'{content,schemaVersion}' IS DISTINCT FROM 'afl-trade-valuation-input-bundle/v1'
    OR NEW.valuation_input_bundle_json#>>'{content,publicAssetBoundary}' IS DISTINCT FROM
      'source_native_afl_assets_no_user_or_fantasy_ownership'
    OR NEW.valuation_input_bundle_json#>>'{content,environment}' IS DISTINCT FROM 'non_production'
    OR NEW.valuation_input_bundle_json#>'{content,publicationEligible}' IS DISTINCT FROM 'false'::JSONB
    OR jsonb_array_length(NEW.valuation_input_bundle_json#>'{content,components}') IS DISTINCT FROM 2
    OR NEW.valuation_input_bundle_json#>>'{content,components,0,role}' IS DISTINCT FROM 'player_contribution_and_availability'
    OR NEW.valuation_input_bundle_json#>>'{content,components,1,role}' IS DISTINCT FROM 'draft_pick_and_future_pick_distribution'
    OR NEW.valuation_input_bundle_json#>>'{content,components,0,modelKind}' IS DISTINCT FROM 'player_contribution_and_availability'
    OR NEW.valuation_input_bundle_json#>>'{content,components,1,modelKind}' IS DISTINCT FROM 'draft_pick_and_future_pick_distribution'
    OR NEW.valuation_input_bundle_json#>>'{content,scopeKey}' IS DISTINCT FROM NEW.scope_key
    OR NEW.valuation_input_bundle_json#>>'{content,valueUnitId}' IS DISTINCT FROM
      NEW.specification_json#>>'{content,valueUnitId}'
    OR (NEW.valuation_input_bundle_json#>'{content,viewPolicy,current}')-'modelVintage' IS DISTINCT FROM
      NEW.specification_json#>'{content,currentView}'
    OR NEW.valuation_input_bundle_json#>'{content,packagePolicy,listSpotPolicyArtifact}' IS DISTINCT FROM
      NEW.specification_json#>'{content,policies,listSpot}'
    OR NEW.valuation_input_bundle_json#>'{content,packagePolicy,scarcityPolicyArtifact}' IS DISTINCT FROM
      NEW.specification_json#>'{content,policies,scarcity}'
    OR NEW.valuation_input_bundle_json#>'{content,packagePolicy,roleCongestionPolicyArtifact}' IS DISTINCT FROM
      NEW.specification_json#>'{content,policies,roleCongestion}'
    OR NEW.valuation_input_bundle_json#>'{content,simulation,lowReturnDefinitionArtifact}' IS DISTINCT FROM
      NEW.specification_json#>'{content,policies,lowReturn}'
    OR NEW.valuation_input_bundle_json#>'{content,simulation,eliteOutcomeDefinitionArtifact}' IS DISTINCT FROM
      NEW.specification_json#>'{content,policies,eliteOutcome}'
    OR NEW.valuation_input_bundle_json#>'{content,simulation,practicalEquivalenceDefinitionArtifact}' IS DISTINCT FROM
      NEW.specification_json#>'{content,policies,practicalEquivalence}'
    OR NEW.valuation_input_bundle_json#>'{content,explanationPolicyArtifact}' IS DISTINCT FROM
      NEW.specification_json#>'{content,policies,explanation}'
    OR NEW.valuation_input_bundle_json#>>'{content,simulation,draws}' IS DISTINCT FROM
      NEW.specification_json#>>'{content,simulation,draws}'
    OR NEW.valuation_input_bundle_json#>>'{content,simulation,seed}' IS DISTINCT FROM
      NEW.specification_json#>>'{content,simulation,seed}'
    OR NEW.valuation_input_bundle_json#>>'{content,simulation,samplingAlgorithmVersion}' IS DISTINCT FROM
      NEW.specification_json#>>'{content,simulation,samplingAlgorithmVersion}'
    OR NEW.valuation_input_bundle_json#>>'{content,viewPolicy,atTrade,modelVintage}' IS DISTINCT FROM 'historical_restatement'
    OR NEW.valuation_input_bundle_json#>>'{content,viewPolicy,atTrade,knowledgeCutoff}' IS DISTINCT FROM
      'transaction_effective_at_exclusive'
    OR NEW.valuation_input_bundle_json#>'{content,viewPolicy,currentViewsShareOneTemporalContext}' IS DISTINCT FROM 'true'::JSONB
    OR NEW.valuation_input_bundle_json#>>'{content,packagePolicy,calculationUnit}' IS DISTINCT FROM 'complete_multi_party_trade'
    OR NEW.valuation_input_bundle_json#>>'{content,packagePolicy,attribution}' IS DISTINCT FROM 'lineage_frontier_exactly_once'
    OR NEW.valuation_input_bundle_json#>>'{content,packagePolicy,aggregation}' IS DISTINCT FROM 'joint_simulation_not_independent_point_sum'
    OR NEW.valuation_input_bundle_json#>>'{content,packagePolicy,currentOutcomeIdentity}' IS DISTINCT FROM
      'realized_club_value_plus_remaining_asset_value'
    OR NEW.valuation_input_bundle_json#>>'{content,packagePolicy,unresolvedAssetTreatment}' IS DISTINCT FROM
      'exclude_with_explicit_reason_no_fallback_value'
    OR NEW.valuation_input_bundle_json#>>'{content,simulation,mode}' IS DISTINCT FROM 'deterministic_counter_sample'
    OR NEW.valuation_input_bundle_json#>>'{content,simulation,centralIntervalLevel}' IS DISTINCT FROM '0.8'
    OR NEW.valuation_input_bundle_json#>>'{content,simulation,downsideQuantile}' IS DISTINCT FROM '0.1'
    OR NEW.valuation_input_bundle_json#>>'{content,simulation,upsideQuantile}' IS DISTINCT FROM '0.9'
    OR NEW.valuation_input_bundle_json#>>'{content,limitation}' IS DISTINCT FROM
      'Approved calculation inputs only; not execution evidence, numerical validity, publication approval, or activation authority.'
    OR (NEW.valuation_input_bundle_json#>>'{content,createdAt}')::TIMESTAMPTZ IS DISTINCT FROM NEW.constructed_at
    OR NEW.result_json->>'operationId' IS DISTINCT FROM NEW.operation_id
    OR NEW.result_json->>'specificationId' IS DISTINCT FROM NEW.specification_id
    OR NEW.result_json->>'valuationInputBundleId' IS DISTINCT FROM NEW.valuation_input_bundle_id
    OR NEW.result_json->'specificationArtifact' IS DISTINCT FROM NEW.specification_artifact_json
    OR NEW.result_json->'valuationInputBundle' IS DISTINCT FROM NEW.valuation_input_bundle_json
    OR NEW.result_json->'valuationInputBundleArtifact' IS DISTINCT FROM NEW.valuation_input_bundle_artifact_json
    OR NEW.valuation_input_bundle_artifact_json->>'artifactId' IS DISTINCT FROM 'artifact:'||expected_artifact_sha
    OR NEW.valuation_input_bundle_artifact_json->>'contentSha256' IS DISTINCT FROM expected_artifact_sha
    OR NEW.valuation_input_bundle_artifact_json->>'storageUri' IS DISTINCT FROM 'artifact://sha256/'||expected_artifact_sha
    OR NEW.valuation_input_bundle_artifact_json->>'mediaType' IS DISTINCT FROM 'application/json'
    OR (NEW.valuation_input_bundle_artifact_json->>'byteLength')::INTEGER IS DISTINCT FROM octet_length(bundle_bytes)
    OR (NEW.valuation_input_bundle_artifact_json->>'createdAt')::TIMESTAMPTZ IS DISTINCT FROM NEW.constructed_at
    OR NEW.player_run_id IS DISTINCT FROM NEW.valuation_input_bundle_json#>>'{content,components,0,runId}'
    OR NEW.pick_run_id IS DISTINCT FROM NEW.valuation_input_bundle_json#>>'{content,components,1,runId}'
    OR evidence->>'playerGate3DecisionId' IS DISTINCT FROM NEW.valuation_input_bundle_json#>>'{content,components,0,gate3DecisionId}'
    OR evidence->>'pickGate3DecisionId' IS DISTINCT FROM NEW.valuation_input_bundle_json#>>'{content,components,1,gate3DecisionId}'
    OR NOT EXISTS (SELECT 1 FROM outcome_governed_valuation_component_run player
      WHERE player.run_id=NEW.player_run_id
        AND player.role='player_contribution_and_availability'
        AND player.protocol_id=NEW.valuation_input_bundle_json#>>'{content,components,0,protocolId}'
        AND player.dataset_id=NEW.valuation_input_bundle_json#>>'{content,components,0,datasetId}')
    OR NOT EXISTS (SELECT 1 FROM outcome_governed_valuation_component_run pick
      WHERE pick.run_id=NEW.pick_run_id
        AND pick.role='draft_pick_and_future_pick_distribution'
        AND pick.protocol_id=NEW.valuation_input_bundle_json#>>'{content,components,1,protocolId}'
        AND pick.dataset_id=NEW.valuation_input_bundle_json#>>'{content,components,1,datasetId}')
    OR NOT EXISTS (SELECT 1 FROM outcome_current_governed_valuation_model_pair current_pair
      WHERE current_pair.scope_key=NEW.scope_key AND current_pair.revision=NEW.model_revision
        AND current_pair.qualification_id=evidence->>'qualificationId'
        AND current_pair.player_run_id=NEW.player_run_id AND current_pair.pick_run_id=NEW.pick_run_id
        AND current_pair.player_gate3_decision_id=evidence->>'playerGate3DecisionId'
        AND current_pair.pick_gate3_decision_id=evidence->>'pickGate3DecisionId' FOR SHARE)
    OR NOT EXISTS (SELECT 1 FROM outcome_current_private_factual_authority factual
      WHERE factual.valuation_scope_key=NEW.scope_key
        AND factual.candidate_id=evidence#>>'{privateFactualAuthority,candidateId}'
        AND factual.revision=NEW.factual_revision FOR SHARE)
  THEN RAISE EXCEPTION 'Valuation input bundle construction operation failed exact admission'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outcome_bundle_construction_validate_insert
  BEFORE INSERT ON outcome_valuation_input_bundle_construction_operation
  FOR EACH ROW EXECUTE FUNCTION validate_outcome_bundle_construction_insert();
CREATE TRIGGER outcome_bundle_construction_no_update_delete
  BEFORE UPDATE OR DELETE ON outcome_valuation_input_bundle_construction_operation
  FOR EACH ROW EXECUTE FUNCTION reject_outcome_current_valuation_factual_refresh_mutation();

GRANT SELECT,INSERT ON outcome_valuation_input_bundle_construction_operation
  TO afl_trade_private_evaluation_coordinator;
GRANT SELECT ON outcome_current_valuation_model_evidence_operation,
  outcome_current_governed_valuation_model_pair,outcome_current_private_factual_authority,
  outcome_private_factual_candidate,outcome_current_valuation_factual_refresh_operation
  TO afl_trade_private_evaluation_coordinator;
-- PostgreSQL requires UPDATE privilege for row-locking clauses. Append-only/head
-- ownership still prevents this coordinator from issuing authority mutations.
GRANT UPDATE (scope_key) ON outcome_current_governed_valuation_model_pair
  TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE (valuation_scope_key) ON outcome_current_private_factual_authority
  TO afl_trade_private_evaluation_coordinator;
GRANT UPDATE (operation_id) ON outcome_current_valuation_model_evidence_operation
  TO afl_trade_private_evaluation_coordinator;
