-- Source-first factual evidence precedes model admission. Keep the v1 insert
-- contract shared with current-parent authentication, and preserve the v2 branch.
DO $$
DECLARE body TEXT;
BEGIN
  SELECT prosrc INTO body FROM pg_proc
    WHERE oid='validate_outcome_private_valuation_factual_output()'::regprocedure;
  IF body IS NULL OR body NOT LIKE '%RETURN NEW;%' OR body NOT LIKE '%parent custody is invalid%'
  THEN RAISE EXCEPTION 'Expected v1 factual-output validator is unavailable'; END IF;
  body:=replace(replace(body,'NEW.','source_output.'),'RETURN NEW;','RETURN;');
  EXECUTE format('CREATE FUNCTION validate_outcome_private_valuation_source_factual_row(source_output outcome_private_valuation_factual_output) RETURNS VOID LANGUAGE plpgsql AS %L',body);
END $$;

DO $$ BEGIN
  EXECUTE format('ALTER FUNCTION validate_outcome_private_valuation_source_factual_row(outcome_private_valuation_factual_output) SET search_path TO %I,pg_catalog,pg_temp',current_schema());
END $$;
REVOKE ALL ON FUNCTION validate_outcome_private_valuation_source_factual_row(outcome_private_valuation_factual_output) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION validate_outcome_private_valuation_source_factual_row(outcome_private_valuation_factual_output)
  TO afl_trade_private_valuation_scheduler_owner,afl_trade_private_evaluation_coordinator;

CREATE OR REPLACE FUNCTION validate_outcome_private_valuation_factual_output()
RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN
  PERFORM validate_outcome_private_valuation_source_factual_row(NEW);
  RETURN NEW;
END $$;

GRANT SELECT ON outcome_source_rights_proposal,outcome_gate_proposal,outcome_gate_decision,
  outcome_provider_field_map TO afl_trade_private_valuation_scheduler_owner;
-- PostgreSQL requires UPDATE privilege for row locks; append-only guards still
-- reject identity mutations. These grants are not given to the coordinator.
GRANT UPDATE (normalization_run_id) ON outcome_provider_normalization_run TO afl_trade_private_valuation_scheduler_owner;
GRANT UPDATE (field_map_id) ON outcome_provider_field_map TO afl_trade_private_valuation_scheduler_owner;
GRANT UPDATE (policy_id) ON outcome_factual_reconciliation_policy TO afl_trade_private_valuation_scheduler_owner;
GRANT UPDATE (factual_run_id) ON outcome_factual_reconciliation_run TO afl_trade_private_valuation_scheduler_owner;
DO $$ BEGIN
  EXECUTE format('GRANT afl_trade_private_valuation_scheduler_owner TO %I',session_user);
END $$;
SET ROLE afl_trade_private_valuation_scheduler_owner;

CREATE FUNCTION authenticate_outcome_private_valuation_source_factual_output(
  target_request_id TEXT,target_output_id TEXT
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE dispatch RECORD; retained outcome_private_valuation_factual_output;
  source RECORD; consumed_fields JSONB; trusted_at TIMESTAMPTZ;
BEGIN
  SELECT * INTO dispatch FROM outcome_private_valuation_dispatch_request
    WHERE request_id=target_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source-first factual dispatch is unavailable'; END IF;
  PERFORM load_outcome_private_valuation_dispatch_request_for_claim(
    target_request_id,dispatch.claim_id,dispatch.lease_token_sha256);
  SELECT * INTO retained FROM outcome_private_valuation_factual_output
    WHERE output_id=target_output_id AND request_id=target_request_id;
  IF NOT FOUND OR retained.output_json#>>'{content,schemaVersion}' IS DISTINCT FROM
    'afl-trade-private-valuation-factual-output/v1'
  THEN RAISE EXCEPTION 'Source-first factual output is unavailable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('factual-release-candidate:'||retained.candidate_id,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-release-membership:'||retained.factual_release_id,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-release-parent:'||retained.factual_release_id,0));
  PERFORM validate_outcome_private_valuation_source_factual_row(retained);
  -- V1 is a private approved candidate without registry activation. A record-state
  -- event is not required; an explicit adverse state can never be ignored.
  IF EXISTS (SELECT 1 FROM (
    SELECT record_state_json->>'state' AS state FROM outcome_record_state_commitment
      WHERE release_id=retained.factual_release_id ORDER BY event_revision DESC LIMIT 1
  ) latest WHERE latest.state IS DISTINCT FROM 'approved')
  THEN RAISE EXCEPTION 'Source-first factual release state is unavailable'; END IF;

  SELECT capture.*,normalization.field_map_id,normalization.status AS normalization_status,
    normalization.finalized_at AS normalization_finalized_at,
    field_map.approval_decision_id,field_map.approved_at,field_map.field_map_sha256,
    policy.policy_id,policy.approval_decision_id AS policy_approval_id
    INTO source FROM outcome_private_valuation_source_admission admission
    JOIN outcome_source_capture capture ON capture.capture_id=admission.source_capture_id
    JOIN outcome_provider_normalization_run normalization
      ON normalization.normalization_run_id=retained.normalization_run_id
      AND normalization.capture_id=capture.capture_id
    JOIN outcome_provider_field_map field_map ON field_map.field_map_id=normalization.field_map_id
    JOIN outcome_factual_reconciliation_run run ON run.factual_run_id=retained.factual_run_id
    JOIN outcome_factual_reconciliation_policy policy ON policy.policy_id=run.policy_id
    WHERE admission.admission_id=retained.source_admission_id
      AND admission.request_id=target_request_id AND capture.status='approved'
      AND capture.environment='non_production' AND capture.competition='AFLM'
      AND capture.anchor_season_year=outcome_private_valuation_hpn_scope_season(dispatch.scope_key)
      AND policy.environment=run.environment AND policy.competition=run.competition
      AND run.season_year BETWEEN policy.valid_from_season AND policy.valid_through_season
      AND policy.status='approved' AND run.conflict_count=0
    FOR SHARE OF capture,normalization,field_map,policy,run;
  IF NOT FOUND OR source.normalization_status NOT IN ('staged','needs_review')
    OR source.normalization_finalized_at IS NULL
  THEN RAISE EXCEPTION 'Source-first factual source or policy is unavailable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-review-subject:provider_field_map:'||source.field_map_id,0));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-review-subject:factual_reconciliation_policy:'||source.policy_id,0));
  IF NOT EXISTS (SELECT 1 FROM outcome_review_decision approval
    WHERE approval.decision_id=source.approval_decision_id
      AND approval.subject_type='provider_field_map' AND approval.subject_id=source.field_map_id
      AND approval.decision='approved' AND approval.decided_at=source.approved_at
      AND approval.evidence_json->>'fieldMapSha256'=source.field_map_sha256
      AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
        WHERE successor.supersedes_decision_id=approval.decision_id))
    OR NOT EXISTS (SELECT 1 FROM outcome_review_decision approval
      WHERE approval.decision_id=source.policy_approval_id
        AND approval.subject_type='factual_reconciliation_policy'
        AND approval.subject_id=source.policy_id AND approval.decision='approved'
        AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
          WHERE successor.supersedes_decision_id=approval.decision_id))
  THEN RAISE EXCEPTION 'Source-first factual review is no longer current'; END IF;

  IF EXISTS (SELECT 1 FROM (
    SELECT fact_json FROM outcome_provider_numeric_metric_fact WHERE fact_batch_id=retained.fact_batch_id
    UNION ALL SELECT fact_json FROM outcome_provider_match_universe_fact WHERE fact_batch_id=retained.fact_batch_id
    UNION ALL SELECT fact_json FROM outcome_provider_player_appearance_fact WHERE fact_batch_id=retained.fact_batch_id
  ) facts WHERE CASE WHEN jsonb_typeof(facts.fact_json#>'{source,consumedSourceFields}')='array'
    THEN jsonb_array_length(facts.fact_json#>'{source,consumedSourceFields}')=0 ELSE TRUE END)
  THEN RAISE EXCEPTION 'Source-first factual consumed source fields are incomplete'; END IF;
  SELECT jsonb_agg(field ORDER BY field) INTO consumed_fields FROM (
    SELECT DISTINCT field FROM (
      SELECT fact_json FROM outcome_provider_numeric_metric_fact WHERE fact_batch_id=retained.fact_batch_id
      UNION ALL SELECT fact_json FROM outcome_provider_match_universe_fact WHERE fact_batch_id=retained.fact_batch_id
      UNION ALL SELECT fact_json FROM outcome_provider_player_appearance_fact WHERE fact_batch_id=retained.fact_batch_id
    ) facts CROSS JOIN LATERAL jsonb_array_elements_text(
      facts.fact_json#>'{source,consumedSourceFields}') fields(field)
  ) consumed;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'afl-trade-gate:gate_0a_permission_to_evaluate:non_production:'||
      (source.manifest_json#>>'{gate0aReceipt,content,request,decisionKey}'),0));
  trusted_at:=clock_timestamp();
  IF NOT EXISTS (SELECT 1 FROM outcome_source_rights_proposal rights
    JOIN outcome_gate_decision gate ON gate.decision_id=
      source.manifest_json#>>'{gate0aReceipt,content,result,decisionId}'
    JOIN outcome_gate_proposal proposal ON proposal.proposal_id=gate.proposal_id
    WHERE rights.rights_artifact_id=source.manifest_json#>>'{sourceRightsProposal,rightsArtifactId}'
      AND rights.content_json IS NOT DISTINCT FROM source.manifest_json->'sourceRightsProposal'
      AND gate.gate='gate_0a_permission_to_evaluate' AND gate.environment='non_production'
      AND gate.state='approved' AND gate.effective_at<=trusted_at AND gate.revalidate_at>trusted_at
      AND gate.decision_key=source.manifest_json#>>'{gate0aReceipt,content,request,decisionKey}'
      AND proposal.gate=gate.gate AND proposal.environment=gate.environment
      AND proposal.decision_key=gate.decision_key
      AND NOT EXISTS (SELECT 1 FROM (VALUES
        ('source_rights_artifact',rights.rights_artifact_id),
        ('competition',source.competition),('season',source.anchor_season_year::TEXT),
        ('fitzroy_capability',source.capability_id),('operation','derived_feature_creation')
      ) required(name,value) WHERE NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(proposal.proposal_json#>'{content,scope,dimensions}') dimension
        WHERE dimension->>'name'=required.name AND (dimension->'values') ? required.value))
      AND NOT EXISTS (SELECT 1 FROM outcome_gate_decision successor
        WHERE successor.supersedes_decision_id=gate.decision_id)
      AND outcome_hpn_private_source_rights_permit(rights.content_json,consumed_fields,
        source.competition,source.anchor_season_year,trusted_at))
  THEN RAISE EXCEPTION 'Source-first factual source rights are no longer current'; END IF;
  PERFORM load_outcome_private_valuation_dispatch_request_for_claim(
    target_request_id,dispatch.claim_id,dispatch.lease_token_sha256);
  RETURN retained.output_json;
END $$;

DO $$ BEGIN
  EXECUTE format('ALTER FUNCTION authenticate_outcome_private_valuation_source_factual_output(TEXT,TEXT) SET search_path TO %I,pg_catalog,pg_temp',current_schema());
END $$;
REVOKE ALL ON FUNCTION authenticate_outcome_private_valuation_source_factual_output(TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authenticate_outcome_private_valuation_source_factual_output(TEXT,TEXT)
  TO afl_trade_private_evaluation_coordinator;
RESET ROLE;

DO $$
DECLARE definition TEXT; old_fragment TEXT := $old$     AND output_json#>>'{content,schemaVersion}'='afl-trade-private-valuation-factual-output/v2';
  IF NOT FOUND THEN RAISE EXCEPTION 'Private HPN factual binding requires the exact admitted output'; END IF;
  PERFORM load_outcome_admitted_player_factual_parent(
    target_request_id,request.claim_id,request.lease_token_sha256,
    output.player_dataset_id,output.player_dataset_admission_id);$old$;
BEGIN
  SELECT pg_get_functiondef('authenticate_outcome_private_valuation_hpn_factual_input(text,text,text,text)'::regprocedure) INTO definition;
  IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
  THEN RAISE EXCEPTION 'Expected private HPN factual authentication branch is unavailable'; END IF;
  EXECUTE replace(definition,old_fragment,$new$     AND output_json#>>'{content,schemaVersion}' IN (
       'afl-trade-private-valuation-factual-output/v1','afl-trade-private-valuation-factual-output/v2');
  IF NOT FOUND THEN RAISE EXCEPTION 'Private HPN factual binding requires an exact supported output'; END IF;
  IF output.output_json#>>'{content,schemaVersion}'='afl-trade-private-valuation-factual-output/v1' THEN
    PERFORM authenticate_outcome_private_valuation_source_factual_output(target_request_id,target_output_id);
  ELSE
    PERFORM load_outcome_admitted_player_factual_parent(
      target_request_id,request.claim_id,request.lease_token_sha256,
      output.player_dataset_id,output.player_dataset_admission_id);
  END IF;$new$);
END $$;

DO $$ BEGIN
  EXECUTE format('REVOKE afl_trade_private_valuation_scheduler_owner FROM %I',session_user);
END $$;
