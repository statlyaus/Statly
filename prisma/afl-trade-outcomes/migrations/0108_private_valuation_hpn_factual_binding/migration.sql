-- An admitted player dataset and the HPN match universe are distinct parents.
-- Bind both to the exact current private factual operation, never to review-set IDs.
CREATE TABLE outcome_private_valuation_hpn_factual_binding (
  request_id TEXT PRIMARY KEY,
  factual_output_id TEXT NOT NULL,
  factual_operation_id TEXT NOT NULL,
  private_factual_candidate_id TEXT NOT NULL,
  private_factual_revision INTEGER NOT NULL CHECK (private_factual_revision > 0),
  hpn_factual_run_id TEXT NOT NULL,
  hpn_input_set_sha256 CHAR(64) NOT NULL CHECK (hpn_input_set_sha256 ~ '^[a-f0-9]{64}$'),
  hpn_finalized_at TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT outcome_hpn_binding_request_fkey FOREIGN KEY (request_id)
    REFERENCES outcome_private_valuation_dispatch_request(request_id) ON DELETE RESTRICT,
  CONSTRAINT outcome_hpn_binding_output_fkey FOREIGN KEY (factual_output_id)
    REFERENCES outcome_private_valuation_factual_output(output_id) ON DELETE RESTRICT,
  CONSTRAINT outcome_hpn_binding_operation_fkey FOREIGN KEY (factual_operation_id)
    REFERENCES outcome_current_valuation_factual_refresh_operation(operation_id) ON DELETE RESTRICT,
  CONSTRAINT outcome_hpn_binding_candidate_fkey FOREIGN KEY (private_factual_candidate_id)
    REFERENCES outcome_private_factual_candidate(candidate_id) ON DELETE RESTRICT,
  CONSTRAINT outcome_hpn_binding_run_fkey FOREIGN KEY (hpn_factual_run_id)
    REFERENCES outcome_factual_reconciliation_run(factual_run_id) ON DELETE RESTRICT
);
CREATE TRIGGER outcome_hpn_factual_binding_no_update_delete
  BEFORE UPDATE OR DELETE ON outcome_private_valuation_hpn_factual_binding
  FOR EACH ROW EXECUTE FUNCTION reject_outcome_current_valuation_factual_refresh_mutation();

GRANT SELECT,INSERT ON outcome_private_valuation_hpn_factual_binding
  TO afl_trade_private_valuation_scheduler_owner;
GRANT SELECT ON outcome_current_valuation_factual_refresh_operation,
  outcome_current_valuation_evidence_orchestration_operation,outcome_private_factual_candidate,
  outcome_factual_reconciliation_policy,outcome_review_decision,
  outcome_factual_reconciliation_match_input,outcome_factual_reconciliation_appearance_input,
  outcome_provider_match_universe_fact,outcome_provider_player_appearance_fact,
  outcome_provider_numeric_metric_fact,outcome_provider_fact_batch,outcome_provider_normalization_run,
  outcome_acquisition_spell_metric_version_member,outcome_reconciled_factual_metric,
  outcome_reconciled_factual_metric_member,outcome_reconciled_factual_game_appearance_member,
  outcome_reconciled_factual_game_match_member
  TO afl_trade_private_valuation_scheduler_owner;
GRANT EXECUTE ON FUNCTION outcome_private_prepared_v3_factual_authority_is_current(
  TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER) TO afl_trade_private_valuation_scheduler_owner;

DO $membership$ BEGIN
  EXECUTE format('GRANT afl_trade_private_valuation_scheduler_owner TO %I',session_user);
END $membership$;
SET ROLE afl_trade_private_valuation_scheduler_owner;

CREATE FUNCTION authenticate_outcome_private_valuation_hpn_factual_input(
  target_request_id TEXT,target_output_id TEXT,target_operation_id TEXT,target_hpn_run_id TEXT
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE request RECORD; output RECORD; authority RECORD; hpn RECORD; custody JSONB;
BEGIN
  SELECT * INTO request FROM outcome_private_valuation_dispatch_request
   WHERE request_id=target_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Private HPN factual binding request is unavailable'; END IF;
  PERFORM load_outcome_private_valuation_dispatch_request_for_claim(
    target_request_id,request.claim_id,request.lease_token_sha256);
  SELECT * INTO output FROM outcome_private_valuation_factual_output
   WHERE output_id=target_output_id AND request_id=target_request_id
     AND output_json#>>'{content,schemaVersion}'='afl-trade-private-valuation-factual-output/v2';
  IF NOT FOUND THEN RAISE EXCEPTION 'Private HPN factual binding requires the exact admitted output'; END IF;
  PERFORM load_outcome_admitted_player_factual_parent(
    target_request_id,request.claim_id,request.lease_token_sha256,
    output.player_dataset_id,output.player_dataset_admission_id);

  SELECT candidate.*,operation.private_factual_revision INTO authority
    FROM outcome_current_valuation_factual_refresh_operation operation
    JOIN outcome_current_valuation_evidence_orchestration_operation orchestration
      ON orchestration.downstream_operation_id=operation.operation_id
     AND orchestration.stable_operation_key=target_request_id
     AND orchestration.scope_key=request.scope_key
     AND orchestration.trigger_kind=request.trigger_kind
     AND orchestration.state='complete' AND orchestration.stage='private_factual_authority'
    JOIN outcome_private_factual_candidate candidate ON candidate.candidate_id=operation.candidate_id
   WHERE operation.operation_id=target_operation_id
     AND operation.scope_key=request.scope_key AND operation.trigger_kind=request.trigger_kind
     AND operation.state='factual_refresh_complete'
     AND candidate.valuation_scope_key=request.scope_key;
  IF NOT FOUND OR outcome_private_prepared_v3_factual_authority_is_current(
    request.scope_key,authority.candidate_id,authority.evidence_scope_key,
    authority.evidence_bundle_id,authority.review_decision_id,
    authority.private_factual_revision) IS NOT TRUE
  THEN RAISE EXCEPTION 'Private HPN factual binding requires exact current factual authority'; END IF;
  custody:=authority.candidate_json#>'{content,normalizedReconciledCustody,normalizationRuns}';

  SELECT run.* INTO hpn FROM outcome_factual_reconciliation_run run
    JOIN outcome_factual_reconciliation_policy policy ON policy.policy_id=run.policy_id
    JOIN outcome_review_decision approval ON approval.decision_id=policy.approval_decision_id
   WHERE run.factual_run_id=target_hpn_run_id
     AND run.environment='non_production' AND run.competition='AFLM'
     AND run.season_year=outcome_private_valuation_hpn_scope_season(request.scope_key)
     AND run.status='approved' AND run.finalized_at IS NOT NULL AND run.conflict_count=0
     AND policy.environment=run.environment AND policy.competition=run.competition
     AND run.season_year BETWEEN policy.valid_from_season AND policy.valid_through_season
     AND policy.status='approved' AND approval.subject_type='factual_reconciliation_policy'
     AND approval.subject_id=policy.policy_id AND approval.decision='approved'
     AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
       WHERE successor.supersedes_decision_id=approval.decision_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Private HPN factual binding run is unavailable or stale'; END IF;
  IF NOT EXISTS (SELECT 1 FROM outcome_factual_reconciliation_match_input input
    JOIN outcome_provider_match_universe_fact fact USING (match_fact_id)
    WHERE input.factual_run_id=target_hpn_run_id AND fact.availability='measured'
      AND fact.completion_state='completed')
    OR NOT EXISTS (SELECT 1 FROM outcome_factual_reconciliation_appearance_input input
    JOIN outcome_provider_player_appearance_fact fact USING (appearance_fact_id)
    WHERE input.factual_run_id=target_hpn_run_id AND fact.availability='measured' AND fact.appeared)
  THEN RAISE EXCEPTION 'Private HPN factual binding requires observed match and appearance inputs'; END IF;


  -- An unavailable metric can legitimately have no observed input. A measured
  -- metric cannot lose its retained source members and vacuously pass the anti-join.
  IF EXISTS (
    SELECT 1 FROM outcome_release_spell_metric_member release_member
      JOIN outcome_acquisition_spell_metric_version_member member
        ON member.spell_metric_version_id=release_member.spell_metric_version_id
      LEFT JOIN outcome_reconciled_factual_metric fact
        ON fact.reconciled_fact_id=member.reconciled_fact_id AND fact.factual_run_id=member.factual_run_id
      LEFT JOIN outcome_factual_reconciliation_run run ON run.factual_run_id=member.factual_run_id
     WHERE release_member.candidate_id=output.candidate_id
       AND (fact.reconciled_fact_id IS NULL OR run.status IS DISTINCT FROM 'approved'
         OR run.finalized_at IS NULL OR run.environment IS DISTINCT FROM 'non_production'
         OR (fact.state='measured' AND fact.result_kind='source_metric' AND NOT EXISTS (
           SELECT 1 FROM outcome_reconciled_factual_metric_member source
            WHERE source.reconciled_fact_id=fact.reconciled_fact_id
         ))
         OR (fact.state='measured' AND fact.result_kind='derived_games' AND NOT EXISTS (
           SELECT 1 FROM outcome_reconciled_factual_game_appearance_member appearance
            JOIN outcome_reconciled_factual_game_match_member match USING (reconciled_fact_id)
            WHERE appearance.reconciled_fact_id=fact.reconciled_fact_id
         )))
    UNION ALL
    SELECT 1 FROM outcome_release_spell_metric_member release_member
      JOIN outcome_acquisition_spell_metric_version version USING (spell_metric_version_id)
     WHERE release_member.candidate_id=output.candidate_id AND version.state='measured'
       AND NOT EXISTS (SELECT 1 FROM outcome_acquisition_spell_metric_version_member member
         WHERE member.spell_metric_version_id=version.spell_metric_version_id)
  ) THEN RAISE EXCEPTION 'Private player measured factual lineage is unavailable'; END IF;

  -- Every retained input participates, including non-selected reconciled members.
  -- Acquisition/event captures are deliberately not confused with player source facts.
  IF EXISTS (
    WITH player_facts AS (
      SELECT member.reconciled_fact_id
        FROM outcome_release_spell_metric_member release_member
        JOIN outcome_acquisition_spell_metric_version_member member
          ON member.spell_metric_version_id=release_member.spell_metric_version_id
       WHERE release_member.candidate_id=output.candidate_id
    ), source_facts AS (
      SELECT fact.normalization_run_id,fact.fact_batch_id,fact.competition,fact.season_year
        FROM outcome_factual_reconciliation_match_input input
        LEFT JOIN outcome_provider_match_universe_fact fact USING (match_fact_id)
       WHERE input.factual_run_id=target_hpn_run_id
      UNION ALL
      SELECT fact.normalization_run_id,fact.fact_batch_id,fact.competition,fact.season_year
        FROM outcome_factual_reconciliation_appearance_input input
        LEFT JOIN outcome_provider_player_appearance_fact fact USING (appearance_fact_id)
       WHERE input.factual_run_id=target_hpn_run_id
      UNION ALL
      SELECT fact.normalization_run_id,fact.fact_batch_id,fact.competition,fact.season_year
        FROM player_facts source
        JOIN outcome_reconciled_factual_metric_member member USING (reconciled_fact_id)
        LEFT JOIN outcome_provider_numeric_metric_fact fact USING (metric_fact_id)
      UNION ALL
      SELECT fact.normalization_run_id,fact.fact_batch_id,fact.competition,fact.season_year
        FROM player_facts source
        JOIN outcome_reconciled_factual_game_appearance_member member USING (reconciled_fact_id)
        LEFT JOIN outcome_provider_player_appearance_fact fact USING (appearance_fact_id)
      UNION ALL
      SELECT fact.normalization_run_id,fact.fact_batch_id,fact.competition,fact.season_year
        FROM player_facts source
        JOIN outcome_reconciled_factual_game_match_member member USING (reconciled_fact_id)
        LEFT JOIN outcome_provider_match_universe_fact fact USING (match_fact_id)
    ) SELECT 1 FROM source_facts fact
      WHERE NOT EXISTS (
        SELECT 1 FROM outcome_provider_fact_batch batch
        JOIN outcome_provider_normalization_run normalization
          ON normalization.normalization_run_id=batch.normalization_run_id
         AND normalization.capture_id=batch.capture_id
        JOIN jsonb_array_elements(custody) retained(item)
          ON retained.item->>'normalizationRunId'=normalization.normalization_run_id
         AND retained.item->>'captureId'=normalization.capture_id
        WHERE batch.fact_batch_id=fact.fact_batch_id
          AND batch.normalization_run_id=fact.normalization_run_id
          AND batch.environment='non_production' AND batch.competition='AFLM'
          AND fact.competition=batch.competition AND fact.season_year=batch.season_year
          AND batch.status='approved' AND batch.finalized_at IS NOT NULL
          AND normalization.status IN ('staged','needs_review') AND normalization.finalized_at IS NOT NULL
      )
  ) THEN RAISE EXCEPTION 'Private HPN and player inputs must belong to exact current normalized custody'; END IF;

  RETURN jsonb_build_object(
    'requestId',target_request_id,'factualOutputId',target_output_id,
    'factualOperationId',target_operation_id,'privateFactualCandidateId',authority.candidate_id,
    'privateFactualRevision',authority.private_factual_revision,'hpnFactualRunId',target_hpn_run_id,
    'hpnInputSetSha256',hpn.input_set_sha256,
    'hpnFinalizedAt',to_char(hpn.finalized_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END $$;

CREATE FUNCTION load_outcome_private_valuation_hpn_factual_input(
  target_request_id TEXT,target_output_id TEXT
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE retained RECORD; current_binding JSONB;
BEGIN
  SELECT * INTO retained FROM outcome_private_valuation_hpn_factual_binding
    WHERE request_id=target_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF retained.factual_output_id IS DISTINCT FROM target_output_id
  THEN RAISE EXCEPTION 'Private HPN factual binding cannot substitute its output'; END IF;
  current_binding:=authenticate_outcome_private_valuation_hpn_factual_input(
    target_request_id,target_output_id,retained.factual_operation_id,retained.hpn_factual_run_id);
  IF current_binding->>'privateFactualCandidateId' IS DISTINCT FROM retained.private_factual_candidate_id
    OR (current_binding->>'privateFactualRevision')::INTEGER IS DISTINCT FROM retained.private_factual_revision
    OR current_binding->>'hpnInputSetSha256' IS DISTINCT FROM retained.hpn_input_set_sha256::TEXT
    OR (current_binding->>'hpnFinalizedAt')::TIMESTAMPTZ IS DISTINCT FROM retained.hpn_finalized_at
  THEN RAISE EXCEPTION 'Private HPN factual binding authority has changed'; END IF;
  RETURN current_binding;
END $$;

CREATE FUNCTION bind_outcome_private_valuation_hpn_factual_input(
  target_request_id TEXT,target_claim_id TEXT,target_lease_token_sha256 TEXT,
  target_output_id TEXT,target_operation_id TEXT,target_hpn_run_id TEXT
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE binding JSONB; retained JSONB;
BEGIN
  PERFORM load_outcome_private_valuation_dispatch_request_for_claim(
    target_request_id,target_claim_id,target_lease_token_sha256);
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-private-hpn-factual-binding:'||target_request_id,0));
  binding:=authenticate_outcome_private_valuation_hpn_factual_input(
    target_request_id,target_output_id,target_operation_id,target_hpn_run_id);
  retained:=load_outcome_private_valuation_hpn_factual_input(target_request_id,target_output_id);
  IF retained IS NOT NULL THEN
    IF retained IS DISTINCT FROM binding
    THEN RAISE EXCEPTION 'Private HPN factual binding cannot substitute retained authority'; END IF;
    RETURN retained;
  END IF;
  INSERT INTO outcome_private_valuation_hpn_factual_binding VALUES (
    target_request_id,target_output_id,target_operation_id,binding->>'privateFactualCandidateId',
    (binding->>'privateFactualRevision')::INTEGER,target_hpn_run_id,binding->>'hpnInputSetSha256',
    (binding->>'hpnFinalizedAt')::TIMESTAMPTZ);
  RETURN binding;
END $$;

DO $paths$ DECLARE signature TEXT; BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'authenticate_outcome_private_valuation_hpn_factual_input(TEXT,TEXT,TEXT,TEXT)',
    'load_outcome_private_valuation_hpn_factual_input(TEXT,TEXT)',
    'bind_outcome_private_valuation_hpn_factual_input(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %I.%s SET search_path TO %I,pg_catalog,pg_temp',current_schema(),signature,current_schema());
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%s FROM PUBLIC',current_schema(),signature);
  END LOOP;
END $paths$;
GRANT EXECUTE ON FUNCTION load_outcome_private_valuation_hpn_factual_input(TEXT,TEXT),
  bind_outcome_private_valuation_hpn_factual_input(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)
  TO afl_trade_private_evaluation_coordinator;
RESET ROLE;
DO $membership$ BEGIN
  EXECUTE format('REVOKE afl_trade_private_valuation_scheduler_owner FROM %I',session_user);
END $membership$;
