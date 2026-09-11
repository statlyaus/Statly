-- Explicit source-first authority lives in the existing immutable HPN binding.
-- Legacy reviewed-corpus bindings retain their original shape and foreign keys.
ALTER TABLE outcome_private_valuation_hpn_factual_binding
  ALTER COLUMN factual_operation_id DROP NOT NULL,
  ALTER COLUMN private_factual_candidate_id DROP NOT NULL,
  ALTER COLUMN private_factual_revision DROP NOT NULL,
  ADD COLUMN authority_kind TEXT NOT NULL DEFAULT 'reviewed_factual',
  ADD COLUMN source_admission_id TEXT REFERENCES outcome_private_valuation_source_admission(admission_id),
  ADD CONSTRAINT outcome_hpn_binding_authority_kind CHECK (
    (authority_kind='reviewed_factual' AND factual_operation_id IS NOT NULL
      AND private_factual_candidate_id IS NOT NULL AND private_factual_revision IS NOT NULL
      AND source_admission_id IS NULL)
    OR (authority_kind='source_first' AND factual_operation_id IS NULL
      AND private_factual_candidate_id IS NULL AND private_factual_revision IS NULL
      AND source_admission_id IS NOT NULL));

GRANT SELECT ON outcome_release_source_capture,outcome_factual_reconciliation_metric_input
  TO afl_trade_private_valuation_scheduler_owner;
GRANT UPDATE (fact_batch_id) ON outcome_provider_fact_batch
  TO afl_trade_private_valuation_scheduler_owner;
DO $$ BEGIN
  EXECUTE format('GRANT afl_trade_private_valuation_scheduler_owner TO %I',session_user);
END $$;
SET ROLE afl_trade_private_valuation_scheduler_owner;

-- Extract, rather than duplicate, the exact current Gate 0A/field-rights checks
-- already used by source-first factual output authentication.
DO $$
DECLARE original TEXT; fragment TEXT; first_pos INTEGER; last_pos INTEGER;
BEGIN
  SELECT prosrc INTO original FROM pg_proc WHERE oid=
    'authenticate_outcome_private_valuation_source_factual_output(text,text)'::regprocedure;
  first_pos:=strpos(original,E'  PERFORM pg_advisory_xact_lock(hashtextextended(\n    ''afl-trade-gate:');
  last_pos:=strpos(substr(original,first_pos),E'  PERFORM load_outcome_private_valuation_dispatch_request_for_claim(');
  IF first_pos=0 OR last_pos=0 THEN RAISE EXCEPTION 'Expected source rights authentication is unavailable'; END IF;
  fragment:=substr(original,first_pos,last_pos-1);
  fragment:=replace(fragment,'  trusted_at:=clock_timestamp();',
    '  SELECT * INTO source FROM outcome_source_capture WHERE capture_id=target_capture_id FOR SHARE;
       trusted_at:=clock_timestamp();');
  EXECUTE format($create$CREATE FUNCTION require_outcome_private_hpn_source_fields(
    target_capture_id TEXT,consumed_fields JSONB
  ) RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS %L$create$,
    'DECLARE source outcome_source_capture; trusted_at TIMESTAMPTZ; BEGIN
     SELECT * INTO source FROM outcome_source_capture WHERE capture_id=target_capture_id;
     IF NOT FOUND THEN RAISE EXCEPTION ''Private HPN source capture is unavailable''; END IF;
     '||fragment||' END;');
  EXECUTE format('CREATE OR REPLACE FUNCTION authenticate_outcome_private_valuation_source_factual_output(target_request_id TEXT,target_output_id TEXT) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS %L',
    replace(original,substr(original,first_pos,last_pos-1),'  PERFORM require_outcome_private_hpn_source_fields(source.capture_id,consumed_fields);'));
END $$;

-- Both authority variants execute the same full factual-input completeness checks.
DO $$
DECLARE original TEXT; fragment TEXT; first_pos INTEGER; last_pos INTEGER;
BEGIN
  SELECT prosrc INTO original FROM pg_proc WHERE oid=
    'authenticate_outcome_private_valuation_hpn_factual_input(text,text,text,text)'::regprocedure;
  first_pos:=strpos(original,'  SELECT run.* INTO hpn');
  last_pos:=strpos(original,'  RETURN jsonb_build_object(');
  IF first_pos=0 OR last_pos<=first_pos THEN RAISE EXCEPTION 'Expected complete HPN input validation is unavailable'; END IF;
  fragment:=substr(original,first_pos,last_pos-first_pos);
  EXECUTE format($create$CREATE FUNCTION authenticate_outcome_private_hpn_factual_members(
    target_request_id TEXT,target_output_id TEXT,target_hpn_run_id TEXT,custody JSONB
  ) RETURNS outcome_factual_reconciliation_run LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS %L$create$,
    'DECLARE request RECORD; output RECORD; hpn outcome_factual_reconciliation_run; BEGIN
     SELECT * INTO request FROM outcome_private_valuation_dispatch_request WHERE request_id=target_request_id;
     IF NOT FOUND THEN RAISE EXCEPTION ''Private HPN factual request is unavailable''; END IF;
     SELECT * INTO output FROM outcome_private_valuation_factual_output WHERE output_id=target_output_id AND request_id=target_request_id;
     IF NOT FOUND THEN RAISE EXCEPTION ''Private HPN factual output is unavailable''; END IF;
     '||fragment||' RETURN hpn; END;');
  EXECUTE format('CREATE OR REPLACE FUNCTION authenticate_outcome_private_valuation_hpn_factual_input(target_request_id TEXT,target_output_id TEXT,target_operation_id TEXT,target_hpn_run_id TEXT) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS %L',
    replace(original,fragment,'  SELECT * INTO hpn FROM authenticate_outcome_private_hpn_factual_members(target_request_id,target_output_id,target_hpn_run_id,custody);'));
END $$;

CREATE FUNCTION outcome_private_hpn_factual_source_inputs(target_candidate_id TEXT,target_run_id TEXT)
RETURNS TABLE(normalization_run_id TEXT,fact_batch_id TEXT,competition TEXT,season_year INTEGER,fact_json JSONB)
LANGUAGE SQL STABLE AS $$
  WITH player_facts AS (
    SELECT member.reconciled_fact_id FROM outcome_release_spell_metric_member release_member
    JOIN outcome_acquisition_spell_metric_version_member member USING(spell_metric_version_id)
    WHERE release_member.candidate_id=target_candidate_id
  )
  SELECT fact.normalization_run_id,fact.fact_batch_id,fact.competition,fact.season_year,fact.fact_json
    FROM outcome_factual_reconciliation_match_input input
    LEFT JOIN outcome_provider_match_universe_fact fact USING(match_fact_id)
    WHERE input.factual_run_id=target_run_id
  UNION ALL SELECT fact.normalization_run_id,fact.fact_batch_id,fact.competition,fact.season_year,fact.fact_json
    FROM outcome_factual_reconciliation_appearance_input input
    LEFT JOIN outcome_provider_player_appearance_fact fact USING(appearance_fact_id)
    WHERE input.factual_run_id=target_run_id
  UNION ALL SELECT fact.normalization_run_id,fact.fact_batch_id,fact.competition,fact.season_year,fact.fact_json
    FROM outcome_factual_reconciliation_metric_input input
    LEFT JOIN outcome_provider_numeric_metric_fact fact USING(metric_fact_id)
    WHERE input.factual_run_id=target_run_id
  UNION ALL SELECT fact.normalization_run_id,fact.fact_batch_id,fact.competition,fact.season_year,fact.fact_json
    FROM player_facts source JOIN outcome_reconciled_factual_metric_member member USING(reconciled_fact_id)
    LEFT JOIN outcome_provider_numeric_metric_fact fact USING(metric_fact_id)
  UNION ALL SELECT fact.normalization_run_id,fact.fact_batch_id,fact.competition,fact.season_year,fact.fact_json
    FROM player_facts source JOIN outcome_reconciled_factual_game_appearance_member member USING(reconciled_fact_id)
    LEFT JOIN outcome_provider_player_appearance_fact fact USING(appearance_fact_id)
  UNION ALL SELECT fact.normalization_run_id,fact.fact_batch_id,fact.competition,fact.season_year,fact.fact_json
    FROM player_facts source JOIN outcome_reconciled_factual_game_match_member member USING(reconciled_fact_id)
    LEFT JOIN outcome_provider_match_universe_fact fact USING(match_fact_id)
$$;

-- Review writers take their subject key before updating source/policy rows. Take
-- the complete immutable parent key set in one order before entering either
-- factual-output branch; a different primary capture cannot invert that order.
CREATE FUNCTION lock_outcome_private_hpn_factual_sources(target_output_id TEXT,target_run_id TEXT)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE output outcome_private_valuation_factual_output; lock_key TEXT;
BEGIN
  SELECT * INTO output FROM outcome_private_valuation_factual_output WHERE output_id=target_output_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Private HPN factual output is unavailable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('factual-release-candidate:'||output.candidate_id,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-release-membership:'||output.factual_release_id,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-release-parent:'||output.factual_release_id,0));
  FOR lock_key IN
    SELECT DISTINCT 'outcome-review-subject:provider_field_map:'||normalization.field_map_id
    FROM outcome_provider_normalization_run normalization
    WHERE normalization.normalization_run_id=output.normalization_run_id
      OR normalization.normalization_run_id IN (SELECT input.normalization_run_id
        FROM outcome_private_hpn_factual_source_inputs(output.candidate_id,target_run_id) input)
    ORDER BY 1
  LOOP PERFORM pg_advisory_xact_lock(hashtextextended(lock_key,0)); END LOOP;
  FOR lock_key IN
    SELECT DISTINCT 'outcome-review-subject:factual_reconciliation_policy:'||run.policy_id
    FROM outcome_factual_reconciliation_run run
    WHERE run.factual_run_id IN (output.factual_run_id,target_run_id)
      OR run.factual_run_id IN (SELECT member.factual_run_id
        FROM outcome_release_spell_metric_member release_member
        JOIN outcome_acquisition_spell_metric_version_member member USING(spell_metric_version_id)
        WHERE release_member.candidate_id=output.candidate_id)
    ORDER BY 1
  LOOP PERFORM pg_advisory_xact_lock(hashtextextended(lock_key,0)); END LOOP;
  FOR lock_key IN
    SELECT DISTINCT 'afl-trade-gate:gate_0a_permission_to_evaluate:non_production:'||
      (capture.manifest_json#>>'{gate0aReceipt,content,request,decisionKey}')
    FROM outcome_source_capture capture JOIN outcome_provider_normalization_run normalization USING(capture_id)
    WHERE normalization.normalization_run_id=output.normalization_run_id
      OR normalization.normalization_run_id IN (SELECT input.normalization_run_id
        FROM outcome_private_hpn_factual_source_inputs(output.candidate_id,target_run_id) input)
    ORDER BY 1
  LOOP PERFORM pg_advisory_xact_lock(hashtextextended(lock_key,0)); END LOOP;
END $$;

DO $$ DECLARE original TEXT; marker TEXT:='  SELECT capture.*,normalization.field_map_id'; BEGIN
  SELECT prosrc INTO original FROM pg_proc WHERE oid=
    'authenticate_outcome_private_valuation_source_factual_output(text,text)'::regprocedure;
  IF strpos(original,marker)=0 THEN RAISE EXCEPTION 'Expected source review lock boundary is unavailable'; END IF;
  EXECUTE format('CREATE OR REPLACE FUNCTION authenticate_outcome_private_valuation_source_factual_output(target_request_id TEXT,target_output_id TEXT) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS %L',
    replace(original,marker,'  PERFORM lock_outcome_private_hpn_factual_sources(target_output_id,retained.factual_run_id);'||E'\n'||marker));
END $$;

CREATE FUNCTION authenticate_outcome_private_valuation_source_hpn_factual_input(
  target_request_id TEXT,target_output_id TEXT,target_hpn_run_id TEXT
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE output outcome_private_valuation_factual_output; source RECORD; inputs RECORD;
  custody JSONB:='[]'; fields JSONB; hpn outcome_factual_reconciliation_run; run RECORD;
BEGIN
  SELECT * INTO output FROM outcome_private_valuation_factual_output
    WHERE output_id=target_output_id AND request_id=target_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Private HPN factual output is unavailable'; END IF;
  PERFORM lock_outcome_private_hpn_factual_sources(target_output_id,target_hpn_run_id);
  PERFORM authenticate_outcome_private_valuation_source_factual_output(target_request_id,target_output_id);
  -- Freeze all referenced factual policies/current reviews, not just the selected result.
  FOR run IN SELECT DISTINCT factual.factual_run_id,factual.policy_id,policy.approval_decision_id
    FROM outcome_factual_reconciliation_run factual
    JOIN outcome_factual_reconciliation_policy policy USING(policy_id)
    WHERE factual.factual_run_id=target_hpn_run_id OR factual.factual_run_id IN (
      SELECT member.factual_run_id FROM outcome_release_spell_metric_member release_member
      JOIN outcome_acquisition_spell_metric_version_member member USING(spell_metric_version_id)
      WHERE release_member.candidate_id=output.candidate_id)
    ORDER BY factual.factual_run_id
  LOOP
    PERFORM 1 FROM outcome_factual_reconciliation_run WHERE factual_run_id=run.factual_run_id FOR SHARE;
    PERFORM 1 FROM outcome_factual_reconciliation_policy WHERE policy_id=run.policy_id FOR SHARE;
    PERFORM pg_advisory_xact_lock(hashtextextended('outcome-review-subject:factual_reconciliation_policy:'||run.policy_id,0));
    IF NOT EXISTS (SELECT 1 FROM outcome_factual_reconciliation_run factual
      JOIN outcome_factual_reconciliation_policy policy USING(policy_id)
      JOIN outcome_review_decision approval ON approval.decision_id=policy.approval_decision_id
      WHERE factual.factual_run_id=run.factual_run_id AND factual.status='approved'
        AND factual.finalized_at IS NOT NULL AND factual.finalized_at<=clock_timestamp()
        AND factual.environment='non_production' AND factual.competition='AFLM'
        AND factual.conflict_count=0 AND policy.status='approved'
        AND policy.environment=factual.environment AND policy.competition=factual.competition
        AND factual.season_year BETWEEN policy.valid_from_season AND policy.valid_through_season
        AND approval.subject_type='factual_reconciliation_policy' AND approval.subject_id=policy.policy_id
        AND approval.decision='approved' AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
          WHERE successor.supersedes_decision_id=approval.decision_id))
    THEN RAISE EXCEPTION 'Source-first HPN factual policy is unavailable or stale'; END IF;
  END LOOP;

  FOR inputs IN SELECT fact.normalization_run_id,fact.fact_batch_id,
      min(fact.competition) AS competition,min(fact.season_year) AS season_year,
      count(DISTINCT fact.competition)=1 AND count(DISTINCT fact.season_year)=1 AS exact_scope,
      jsonb_agg(fact.fact_json) AS facts
    FROM outcome_private_hpn_factual_source_inputs(output.candidate_id,target_hpn_run_id) fact
    GROUP BY fact.normalization_run_id,fact.fact_batch_id
    ORDER BY fact.normalization_run_id,fact.fact_batch_id
  LOOP
    SELECT capture.capture_id,normalization.field_map_id,map.approval_decision_id,
      map.approved_at,map.field_map_sha256 INTO source
      FROM outcome_provider_normalization_run normalization
      JOIN outcome_source_capture capture USING(capture_id)
      JOIN outcome_provider_field_map map USING(field_map_id)
      JOIN outcome_provider_fact_batch batch USING(normalization_run_id,capture_id)
      JOIN outcome_release_source_capture membership ON membership.capture_id=capture.capture_id
        AND membership.release_id=output.factual_release_id
      WHERE normalization.normalization_run_id=inputs.normalization_run_id
        AND batch.fact_batch_id=inputs.fact_batch_id
        AND inputs.exact_scope AND batch.competition=inputs.competition AND batch.season_year=inputs.season_year
        AND batch.environment='non_production' AND batch.competition='AFLM'
        AND batch.status='approved' AND batch.finalized_at IS NOT NULL AND batch.finalized_at<=clock_timestamp()
        AND capture.status='approved' AND capture.environment='non_production'
        AND capture.competition=batch.competition AND capture.anchor_season_year=batch.season_year
        AND normalization.status IN ('staged','needs_review') AND normalization.finalized_at IS NOT NULL
        AND normalization.finalized_at<=clock_timestamp()
      FOR SHARE OF capture,normalization,map,batch;
    IF NOT FOUND THEN RAISE EXCEPTION 'Source-first HPN inputs lack exact current release source custody'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('outcome-review-subject:provider_field_map:'||source.field_map_id,0));
    IF NOT EXISTS (SELECT 1 FROM outcome_review_decision approval
      WHERE approval.decision_id=source.approval_decision_id AND approval.subject_type='provider_field_map'
        AND approval.subject_id=source.field_map_id AND approval.decision='approved'
        AND approval.decided_at=source.approved_at AND approval.evidence_json->>'fieldMapSha256'=source.field_map_sha256
        AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=approval.decision_id))
    THEN RAISE EXCEPTION 'Source-first HPN decode review is no longer current'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(inputs.facts) fact
      WHERE CASE WHEN jsonb_typeof(fact#>'{source,consumedSourceFields}')='array'
        THEN jsonb_array_length(fact#>'{source,consumedSourceFields}')=0 ELSE TRUE END)
    THEN RAISE EXCEPTION 'Source-first HPN consumed source fields are incomplete'; END IF;
    SELECT jsonb_agg(field ORDER BY field) INTO fields FROM (
      SELECT DISTINCT field FROM jsonb_array_elements(inputs.facts) fact
      CROSS JOIN LATERAL jsonb_array_elements_text(fact#>'{source,consumedSourceFields}') value(field)
    ) actual;
    PERFORM require_outcome_private_hpn_source_fields(source.capture_id,fields);
    custody:=custody||jsonb_build_array(jsonb_build_object('normalizationRunId',inputs.normalization_run_id,'captureId',source.capture_id));
  END LOOP;
  SELECT * INTO hpn FROM authenticate_outcome_private_hpn_factual_members(
    target_request_id,target_output_id,target_hpn_run_id,custody);
  PERFORM authenticate_outcome_private_valuation_source_factual_output(target_request_id,target_output_id);
  RETURN jsonb_build_object('authorityKind','source_first','requestId',target_request_id,
    'factualOutputId',target_output_id,'sourceAdmissionId',output.source_admission_id,
    'hpnFactualRunId',target_hpn_run_id,'hpnInputSetSha256',hpn.input_set_sha256,
    'hpnFinalizedAt',to_char(hpn.finalized_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END $$;

-- Existing getter dispatches only from immutable stored authority kind.
DO $$ DECLARE original TEXT; old_fragment TEXT; BEGIN
  SELECT prosrc INTO original FROM pg_proc WHERE oid='load_outcome_private_valuation_hpn_factual_input(text,text)'::regprocedure;
  old_fragment:='  current_binding:=authenticate_outcome_private_valuation_hpn_factual_input(';
  IF strpos(original,old_fragment)=0 THEN RAISE EXCEPTION 'Expected HPN getter is unavailable'; END IF;
  EXECUTE format('CREATE OR REPLACE FUNCTION load_outcome_private_valuation_hpn_factual_input(target_request_id TEXT,target_output_id TEXT) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS %L',
    replace(original,old_fragment,$branch$  IF retained.authority_kind='source_first' THEN
    current_binding:=authenticate_outcome_private_valuation_source_hpn_factual_input(target_request_id,target_output_id,retained.hpn_factual_run_id);
    IF current_binding->>'sourceAdmissionId' IS DISTINCT FROM retained.source_admission_id
      OR current_binding->>'hpnInputSetSha256' IS DISTINCT FROM retained.hpn_input_set_sha256::TEXT
      OR (current_binding->>'hpnFinalizedAt')::TIMESTAMPTZ IS DISTINCT FROM retained.hpn_finalized_at
    THEN RAISE EXCEPTION 'Source-first HPN retained authority has changed'; END IF;
    RETURN current_binding;
  END IF;
  current_binding:=authenticate_outcome_private_valuation_hpn_factual_input($branch$));
  SELECT prosrc INTO original FROM pg_proc WHERE oid='bind_outcome_private_valuation_hpn_factual_input(text,text,text,text,text,text)'::regprocedure;
  old_fragment:='INSERT INTO outcome_private_valuation_hpn_factual_binding VALUES (';
  IF strpos(original,old_fragment)=0 THEN RAISE EXCEPTION 'Expected HPN binder is unavailable'; END IF;
  EXECUTE format('CREATE OR REPLACE FUNCTION bind_outcome_private_valuation_hpn_factual_input(target_request_id TEXT,target_claim_id TEXT,target_lease_token_sha256 TEXT,target_output_id TEXT,target_operation_id TEXT,target_hpn_run_id TEXT) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS %L',
    replace(original,old_fragment,'INSERT INTO outcome_private_valuation_hpn_factual_binding (request_id,factual_output_id,factual_operation_id,private_factual_candidate_id,private_factual_revision,hpn_factual_run_id,hpn_input_set_sha256,hpn_finalized_at) VALUES ('));
END $$;

CREATE FUNCTION bind_outcome_private_valuation_source_hpn_factual_input(
  target_request_id TEXT,target_claim_id TEXT,target_lease_token_sha256 TEXT,target_output_id TEXT,target_hpn_run_id TEXT
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE binding JSONB; retained JSONB;
BEGIN
  PERFORM load_outcome_private_valuation_dispatch_request_for_claim(target_request_id,target_claim_id,target_lease_token_sha256);
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-private-hpn-factual-binding:'||target_request_id,0));
  binding:=authenticate_outcome_private_valuation_source_hpn_factual_input(target_request_id,target_output_id,target_hpn_run_id);
  retained:=load_outcome_private_valuation_hpn_factual_input(target_request_id,target_output_id);
  IF retained IS NOT NULL THEN
    IF retained IS DISTINCT FROM binding THEN RAISE EXCEPTION 'Private HPN binding cannot substitute retained authority'; END IF;
    RETURN retained;
  END IF;
  INSERT INTO outcome_private_valuation_hpn_factual_binding
    (request_id,factual_output_id,hpn_factual_run_id,hpn_input_set_sha256,hpn_finalized_at,authority_kind,source_admission_id)
    VALUES(target_request_id,target_output_id,target_hpn_run_id,binding->>'hpnInputSetSha256',
      (binding->>'hpnFinalizedAt')::TIMESTAMPTZ,'source_first',binding->>'sourceAdmissionId');
  RETURN binding;
END $$;

DO $$ DECLARE signature TEXT; BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'require_outcome_private_hpn_source_fields(text,jsonb)',
    'authenticate_outcome_private_valuation_source_factual_output(text,text)',
    'authenticate_outcome_private_hpn_factual_members(text,text,text,jsonb)',
    'authenticate_outcome_private_valuation_hpn_factual_input(text,text,text,text)',
    'outcome_private_hpn_factual_source_inputs(text,text)',
    'lock_outcome_private_hpn_factual_sources(text,text)',
    'authenticate_outcome_private_valuation_source_hpn_factual_input(text,text,text)',
    'load_outcome_private_valuation_hpn_factual_input(text,text)',
    'bind_outcome_private_valuation_hpn_factual_input(text,text,text,text,text,text)',
    'bind_outcome_private_valuation_source_hpn_factual_input(text,text,text,text,text)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path TO %I,pg_catalog,pg_temp',signature,current_schema());
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',signature);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION bind_outcome_private_valuation_source_hpn_factual_input(TEXT,TEXT,TEXT,TEXT,TEXT)
  TO afl_trade_private_evaluation_coordinator;
RESET ROLE;
-- V1 unbound history retains its primary-run equality. Only the explicit current
-- source-first binding permits the independently authenticated HPN universe.
DO $$ DECLARE definition TEXT; old_fragment TEXT; BEGIN
  SELECT pg_get_functiondef('validate_outcome_private_valuation_model_request_binding()'::regprocedure) INTO definition;
  old_fragment:=$old$  IF current_user<>'afl_trade_private_evaluation_coordinator'$old$;
  IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
  THEN RAISE EXCEPTION 'Expected model request binding authority is unavailable'; END IF;
  definition:=replace(definition,old_fragment,$new$  IF factual."output_json"#>>'{content,schemaVersion}'='afl-trade-private-valuation-factual-output/v1'
    AND EXISTS (SELECT 1 FROM outcome_private_valuation_hpn_factual_binding
      WHERE request_id=NEW."request_id" AND authority_kind='source_first') THEN
    hpn_parent:=load_outcome_private_valuation_hpn_factual_input(NEW."request_id",NEW."factual_output_id");
  END IF;
  IF current_user<>'afl_trade_private_evaluation_coordinator'$new$);
  old_fragment:=$old$      AND calculation."calculation_json"->'content'->>'factualRunId'<>
        factual."factual_run_id"$old$;
  IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
  THEN RAISE EXCEPTION 'Expected legacy factual-run equality is unavailable'; END IF;
  EXECUTE replace(definition,old_fragment,$new$      AND calculation."calculation_json"->'content'->>'factualRunId' IS DISTINCT FROM
        CASE WHEN hpn_parent->>'authorityKind'='source_first' THEN hpn_parent->>'hpnFactualRunId'
          ELSE factual."factual_run_id" END$new$);
END $$;
DO $$ BEGIN EXECUTE format('REVOKE afl_trade_private_valuation_scheduler_owner FROM %I',session_user); END $$;
