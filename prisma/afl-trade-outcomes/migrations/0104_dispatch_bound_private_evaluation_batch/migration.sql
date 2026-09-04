-- Extend the retained public/release-backed cohort runner with one private branch rooted in
-- migration 0103's qualified current-model-evidence preparation. Dispatch claims remain ephemeral:
-- only the final atomic head transition consumes the exact current live claim.

ALTER TABLE "outcome_private_evaluation_cohort_capture"
  ALTER COLUMN "factual_release_revision" DROP NOT NULL,
  ADD COLUMN "preparation_authority" TEXT NOT NULL DEFAULT
    'authenticated_calculation_evidence_snapshot',
  ADD COLUMN "preparation_operation_id" TEXT,
  ADD COLUMN "current_model_evidence_operation_id" TEXT,
  ADD COLUMN "dispatch_request_id" TEXT,
  ADD COLUMN "factual_output_id" TEXT,
  ADD COLUMN "hpn_calculation_id" TEXT,
  ADD COLUMN "model_operation_id" TEXT,
  ADD CONSTRAINT "outcome_private_evaluation_cohort_capture_authority_shape" CHECK (
    ("preparation_authority"='authenticated_calculation_evidence_snapshot' AND
     "factual_release_revision">0 AND "preparation_operation_id" IS NULL AND
     "current_model_evidence_operation_id" IS NULL AND "dispatch_request_id" IS NULL AND
     "factual_output_id" IS NULL AND "hpn_calculation_id" IS NULL AND
     "model_operation_id" IS NULL)
    OR
    ("preparation_authority"='qualified_current_model_evidence' AND
     "factual_release_revision" IS NULL AND "preparation_operation_id" IS NOT NULL AND
     "current_model_evidence_operation_id" IS NOT NULL AND "dispatch_request_id" IS NOT NULL AND
     "factual_output_id" IS NOT NULL AND "hpn_calculation_id" IS NOT NULL AND
     "model_operation_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "outcome_private_evaluation_capture_preparation_fkey"
    FOREIGN KEY ("preparation_operation_id")
    REFERENCES "outcome_current_valuation_cohort_operation"("operation_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_private_evaluation_capture_model_evidence_fkey"
    FOREIGN KEY ("current_model_evidence_operation_id")
    REFERENCES "outcome_current_valuation_model_evidence_operation"("operation_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_private_evaluation_capture_dispatch_fkey"
    FOREIGN KEY ("dispatch_request_id")
    REFERENCES "outcome_private_valuation_dispatch_request"("request_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_private_evaluation_capture_factual_output_fkey"
    FOREIGN KEY ("factual_output_id")
    REFERENCES "outcome_private_valuation_factual_output"("output_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_private_evaluation_capture_hpn_calculation_fkey"
    FOREIGN KEY ("hpn_calculation_id")
    REFERENCES "outcome_hpn_pav_calculation"("calculation_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_private_evaluation_capture_model_operation_fkey"
    FOREIGN KEY ("model_operation_id")
    REFERENCES "outcome_private_valuation_model_operation"("operation_id") ON DELETE RESTRICT;

ALTER TABLE "outcome_private_evaluation_execution_cycle"
  ALTER COLUMN "factual_release_revision" DROP NOT NULL,
  ADD COLUMN "preparation_authority" TEXT NOT NULL DEFAULT
    'authenticated_calculation_evidence_snapshot',
  ADD COLUMN "preparation_operation_id" TEXT,
  ADD COLUMN "current_model_evidence_operation_id" TEXT,
  ADD COLUMN "dispatch_request_id" TEXT,
  ADD COLUMN "factual_output_id" TEXT,
  ADD COLUMN "hpn_calculation_id" TEXT,
  ADD COLUMN "model_operation_id" TEXT,
  ADD CONSTRAINT "outcome_private_evaluation_execution_cycle_authority_shape" CHECK (
    ("preparation_authority"='authenticated_calculation_evidence_snapshot' AND
     "factual_release_revision">0 AND "preparation_operation_id" IS NULL AND
     "current_model_evidence_operation_id" IS NULL AND "dispatch_request_id" IS NULL AND
     "factual_output_id" IS NULL AND "hpn_calculation_id" IS NULL AND
     "model_operation_id" IS NULL)
    OR
    ("preparation_authority"='qualified_current_model_evidence' AND
     "factual_release_revision" IS NULL AND "preparation_operation_id" IS NOT NULL AND
     "current_model_evidence_operation_id" IS NOT NULL AND "dispatch_request_id" IS NOT NULL AND
     "factual_output_id" IS NOT NULL AND "hpn_calculation_id" IS NOT NULL AND
     "model_operation_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "outcome_private_evaluation_cycle_preparation_fkey"
    FOREIGN KEY ("preparation_operation_id")
    REFERENCES "outcome_current_valuation_cohort_operation"("operation_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_private_evaluation_cycle_model_evidence_fkey"
    FOREIGN KEY ("current_model_evidence_operation_id")
    REFERENCES "outcome_current_valuation_model_evidence_operation"("operation_id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_private_evaluation_cycle_dispatch_fkey"
    FOREIGN KEY ("dispatch_request_id")
    REFERENCES "outcome_private_valuation_dispatch_request"("request_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_private_evaluation_cycle_factual_output_fkey"
    FOREIGN KEY ("factual_output_id")
    REFERENCES "outcome_private_valuation_factual_output"("output_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_private_evaluation_cycle_hpn_calculation_fkey"
    FOREIGN KEY ("hpn_calculation_id")
    REFERENCES "outcome_hpn_pav_calculation"("calculation_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_private_evaluation_cycle_model_operation_fkey"
    FOREIGN KEY ("model_operation_id")
    REFERENCES "outcome_private_valuation_model_operation"("operation_id") ON DELETE RESTRICT;

DO $roles$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname='afl_trade_private_evaluation_batch_head_owner'
  ) THEN
    CREATE ROLE afl_trade_private_evaluation_batch_head_owner NOLOGIN;
  END IF;
  EXECUTE format(
    'GRANT afl_trade_private_evaluation_batch_head_owner TO %I',
    session_user
  );
  EXECUTE format(
    'GRANT USAGE,CREATE ON SCHEMA %I TO afl_trade_private_evaluation_batch_head_owner',
    current_schema()
  );
END $roles$;

CREATE FUNCTION "outcome_private_evaluation_prepared_authority_is_current"(
  target_scope_key TEXT,
  target_prepared_input_set_id TEXT,
  target_prepared_input_set_revision INTEGER,
  target_model_qualification_work_id TEXT,
  target_model_pair_revision INTEGER,
  target_preparation_operation_id TEXT,
  target_current_model_evidence_operation_id TEXT,
  target_dispatch_request_id TEXT,
  target_factual_output_id TEXT,
  target_hpn_calculation_id TEXT,
  target_model_operation_id TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE prepared RECORD; operation RECORD; authority RECORD;
BEGIN
  SELECT prepared_set."prepared_set_json",prepared_head."revision" AS head_revision
    INTO prepared
    FROM "outcome_current_prepared_valuation_input_set" prepared_head
    JOIN "outcome_prepared_valuation_input_set" prepared_set
      ON prepared_set."prepared_input_set_id"=prepared_head."prepared_input_set_id"
   WHERE prepared_head."scope_key"=target_scope_key
     AND prepared_head."prepared_input_set_id"=target_prepared_input_set_id
     AND prepared_head."revision"=target_prepared_input_set_revision
   FOR SHARE OF prepared_head,prepared_set;
  SELECT operation_row.* INTO operation
    FROM "outcome_current_valuation_cohort_operation" operation_row
    JOIN "outcome_current_valuation_cohort_operation_result" result_row
      ON result_row."operation_id"=operation_row."operation_id"
     AND result_row."prepared_input_set_id"=target_prepared_input_set_id
     AND result_row."head_revision"=target_prepared_input_set_revision
   WHERE operation_row."operation_id"=target_preparation_operation_id
     AND operation_row."preparation_authority"='qualified_current_model_evidence'
   FOR SHARE OF operation_row,result_row;
  SELECT * INTO authority
    FROM "load_outcome_private_prepared_v3_authority"(target_dispatch_request_id);
  RETURN prepared."prepared_set_json" IS NOT NULL
    AND operation."operation_id" IS NOT NULL
    AND authority."scope_key" IS NOT NULL
    AND prepared."prepared_set_json"->'content'->>'preparationAuthority'=
      'qualified_current_model_evidence'
    AND prepared."prepared_set_json"->'content'->>'preparationOperationId'=
      target_preparation_operation_id
    AND prepared."prepared_set_json"->'content'->'modelEvidence'->>'operationId'=
      target_current_model_evidence_operation_id
    AND prepared."prepared_set_json"->'content'->'dispatchAuthority'=jsonb_build_object(
      'requestId',target_dispatch_request_id,
      'factualOutputId',target_factual_output_id,
      'hpnCalculationId',target_hpn_calculation_id,
      'modelOperationId',target_model_operation_id)
    AND operation."scope_key"=target_scope_key
    AND operation."current_model_evidence_operation_id"=target_current_model_evidence_operation_id
    AND operation."dispatch_request_id"=target_dispatch_request_id
    AND operation."factual_output_id"=target_factual_output_id
    AND operation."hpn_calculation_id"=target_hpn_calculation_id
    AND operation."model_operation_id"=target_model_operation_id
    AND operation."model_qualification_work_id"=target_model_qualification_work_id
    AND operation."model_qualification_revision"=target_model_pair_revision
    AND authority."scope_key"=target_scope_key
    AND authority."factual_output_id"=target_factual_output_id
    AND authority."hpn_calculation_id"=target_hpn_calculation_id
    AND authority."model_operation_id"=target_model_operation_id
    AND authority."model_evidence_json"->>'operationId'=
      target_current_model_evidence_operation_id
    AND authority."model_evidence_json"->>'qualificationWorkId'=
      target_model_qualification_work_id
    AND (authority."model_evidence_json"->>'modelRevision')::INTEGER=
      target_model_pair_revision
    AND EXISTS (
      SELECT 1 FROM "outcome_current_governed_valuation_model_pair" model_head
       WHERE model_head."scope_key"=target_scope_key
         AND model_head."work_id"=target_model_qualification_work_id
         AND model_head."revision"=target_model_pair_revision
    );
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN FALSE;
END $$;
ALTER FUNCTION "validate_outcome_automated_ready_calculation_authority"(JSONB,TEXT,TEXT)
  SECURITY DEFINER;
ALTER FUNCTION "validate_outcome_automated_ready_calculation_authority"(JSONB,TEXT,TEXT)
  OWNER TO afl_trade_private_evaluation_batch_head_owner;
DO $calculation_authority_path$ BEGIN
  EXECUTE format(
    'ALTER FUNCTION %I.validate_outcome_automated_ready_calculation_authority(JSONB,TEXT,TEXT) SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema()
  );
END $calculation_authority_path$;

ALTER FUNCTION "outcome_private_evaluation_prepared_authority_is_current"(
  TEXT,TEXT,INTEGER,TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT
) OWNER TO afl_trade_private_evaluation_batch_head_owner;
DO $paths$ BEGIN
  EXECUTE format(
    'ALTER FUNCTION %I.outcome_private_evaluation_prepared_authority_is_current(TEXT,TEXT,INTEGER,TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema()
  );
END $paths$;
REVOKE ALL ON FUNCTION "outcome_private_evaluation_prepared_authority_is_current"(
  TEXT,TEXT,INTEGER,TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "outcome_private_evaluation_prepared_authority_is_current"(
  TEXT,TEXT,INTEGER,TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT
) TO afl_trade_private_evaluation_coordinator;

-- Preserve the existing public calculation-authority validator byte-for-byte, then add the
-- private prepared-v3 ancestry that its original schema could not name.
ALTER FUNCTION "validate_outcome_automated_ready_calculation_authority"(JSONB,TEXT,TEXT)
  RENAME TO "validate_outcome_automated_ready_calculation_authority_pre_0104";

CREATE FUNCTION "validate_outcome_automated_ready_calculation_authority"(
  authority JSONB, requested_scope_key TEXT, requested_trade_id TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  prepared_document JSONB;
  prepared_head RECORD;
  prepared_set RECORD;
  prepared_entry RECORD;
  manifest RECORD;
  model_pair RECORD;
  qualification RECORD;
  player_component RECORD;
  pick_component RECORD;
  player_gate RECORD;
  pick_gate RECORD;
  current_authority_count INTEGER;
  current_authority_rows JSONB;
BEGIN
  SELECT prepared."prepared_set_json" INTO prepared_document
    FROM "outcome_prepared_valuation_input_set" prepared
   WHERE prepared."prepared_input_set_id"=authority->>'preparedInputSetId'
   FOR KEY SHARE;
  IF prepared_document#>>'{content,preparationAuthority}'=
       'authenticated_calculation_evidence_snapshot' THEN
    RETURN "validate_outcome_automated_ready_calculation_authority_pre_0104"(
      authority,requested_scope_key,requested_trade_id
    );
  END IF;
  IF prepared_document#>>'{content,preparationAuthority}' IS DISTINCT FROM
       'qualified_current_model_evidence' THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO prepared_head FROM "outcome_current_prepared_valuation_input_set"
   WHERE "scope_key"=requested_scope_key FOR KEY SHARE;
  SELECT * INTO prepared_set FROM "outcome_prepared_valuation_input_set"
   WHERE "prepared_input_set_id"=authority->>'preparedInputSetId' FOR KEY SHARE;
  SELECT * INTO prepared_entry FROM "outcome_prepared_valuation_input_entry"
   WHERE "prepared_input_set_id"=authority->>'preparedInputSetId'
     AND "trade_id"=requested_trade_id FOR KEY SHARE;
  SELECT * INTO manifest FROM "outcome_private_evaluation_materialization_manifest"
   WHERE "materialization_manifest_id"=authority->>'materializationManifestId'
   FOR KEY SHARE;
  SELECT * INTO model_pair FROM "outcome_current_governed_valuation_model_pair"
   WHERE "scope_key"=requested_scope_key FOR KEY SHARE;
  SELECT * INTO qualification FROM "outcome_governed_valuation_model_qualification"
   WHERE "qualification_id"=model_pair."qualification_id" FOR KEY SHARE;
  SELECT * INTO player_component FROM "outcome_governed_valuation_component_run"
   WHERE "run_id"=model_pair."player_run_id" FOR KEY SHARE;
  SELECT * INTO pick_component FROM "outcome_governed_valuation_component_run"
   WHERE "run_id"=model_pair."pick_run_id" FOR KEY SHARE;
  SELECT * INTO player_gate FROM "outcome_gate_decision"
   WHERE "decision_id"=model_pair."player_gate3_decision_id" FOR KEY SHARE;
  SELECT * INTO pick_gate FROM "outcome_gate_decision"
   WHERE "decision_id"=model_pair."pick_gate3_decision_id" FOR KEY SHARE;
  SELECT count(*)::INTEGER,jsonb_agg(to_jsonb(current_authority))
    INTO current_authority_count,current_authority_rows
    FROM "load_outcome_private_prepared_v3_authority"(
      prepared_document#>>'{content,dispatchAuthority,requestId}'
    ) current_authority;

  RETURN COALESCE(
    jsonb_typeof(authority)='object'
    AND (SELECT count(*) FROM jsonb_object_keys(authority))=14
    AND jsonb_typeof(authority->'components')='array'
    AND jsonb_array_length(authority->'components')=2
    AND jsonb_typeof(authority->'components'->0)='object'
    AND jsonb_typeof(authority->'components'->1)='object'
    AND (SELECT count(*) FROM jsonb_object_keys(authority->'components'->0))=10
    AND (SELECT count(*) FROM jsonb_object_keys(authority->'components'->1))=10
    AND authority->>'state'='ready'
    AND prepared_head."prepared_input_set_id"=authority->>'preparedInputSetId'
    AND prepared_head."revision"=(authority->>'preparedInputHeadRevision')::INTEGER
    AND prepared_set."schema_version"='afl-trade-prepared-valuation-input-set/v3'
    AND prepared_set."finalized_at" IS NOT NULL
    AND prepared_entry."state"='ready'
    AND prepared_entry."entry_json"->>'materializationManifestId'=
        authority->>'materializationManifestId'
    AND manifest."valuation_scope_key"=requested_scope_key
    AND manifest."trade_id"=requested_trade_id
    AND manifest."artifact_id"=authority->'materializationManifestArtifact'->>'artifactId'
    AND prepared_entry."entry_json"->'materializationManifestArtifact'=
        authority->'materializationManifestArtifact'
    AND prepared_document#>>'{content,valuationInputBundleId}'=
        authority->>'valuationInputBundleId'
    AND prepared_document#>'{content,valuationInputBundleArtifact}'=
        authority->'valuationInputBundleArtifact'
    AND model_pair."qualification_id"=authority->'components'->0->>'qualificationId'
    AND model_pair."qualification_id"=authority->'components'->1->>'qualificationId'
    AND qualification."outcome"='qualified'
    AND authority->'components'->0->>'qualificationPolicyVersion'=
        qualification."qualification_json"->'content'->'policy'->>'policyVersion'
    AND authority->'components'->1->>'qualificationPolicyVersion'=
        qualification."qualification_json"->'content'->'policy'->>'policyVersion'
    AND model_pair."player_run_id"=authority->'components'->0->>'runId'
    AND model_pair."pick_run_id"=authority->'components'->1->>'runId'
    AND authority->'components'->0->>'role'='player_contribution_and_availability'
    AND authority->'components'->1->>'role'='draft_pick_and_future_pick_distribution'
    AND authority->'components'->0->>'protocolId'=player_component."protocol_id"
    AND authority->'components'->1->>'protocolId'=pick_component."protocol_id"
    AND authority->'components'->0->>'datasetId'=player_component."dataset_id"
    AND authority->'components'->1->>'datasetId'=pick_component."dataset_id"
    AND authority->'components'->0->>'datasetAdmissionId'=
        player_component."dataset_admission_id"
    AND authority->'components'->1->>'datasetAdmissionId'=
        pick_component."dataset_admission_id"
    AND (authority->'components'->0->>'datasetAdmissionGateLedgerRevision')::INTEGER=
        player_component."dataset_admission_gate_ledger_revision"
    AND (authority->'components'->1->>'datasetAdmissionGateLedgerRevision')::INTEGER=
        pick_component."dataset_admission_gate_ledger_revision"
    AND authority->'components'->0->>'gate3DecisionId'=player_gate."decision_id"
    AND authority->'components'->1->>'gate3DecisionId'=pick_gate."decision_id"
    AND (authority->'components'->0->>'gate3DecisionVersion')::INTEGER=
        player_gate."version"
    AND (authority->'components'->1->>'gate3DecisionVersion')::INTEGER=pick_gate."version"
    AND player_gate."gate"='gate_3_model_validity'
    AND pick_gate."gate"='gate_3_model_validity'
    AND player_gate."environment"='non_production'::"OutcomeEnvironment"
    AND pick_gate."environment"='non_production'::"OutcomeEnvironment"
    AND player_gate."state"='approved'
    AND pick_gate."state"='approved'
    AND NOT EXISTS (SELECT 1 FROM "outcome_gate_decision" successor
      WHERE successor."supersedes_decision_id"=player_gate."decision_id")
    AND NOT EXISTS (SELECT 1 FROM "outcome_gate_decision" successor
      WHERE successor."supersedes_decision_id"=pick_gate."decision_id")
    AND validate_outcome_prepared_valuation_input_v2_artifact(
      authority->'materializationManifestArtifact','non_production'::"OutcomeEnvironment"
    )
    AND validate_outcome_prepared_valuation_input_v2_artifact(
      authority->'valuationInputBundleArtifact','non_production'::"OutcomeEnvironment"
    )
    AND current_authority_count=1
    AND authority->>'preparationAuthority'='qualified_current_model_evidence'
    AND authority->>'preparationOperationId'=
        prepared_document#>>'{content,preparationOperationId}'
    AND authority->>'currentModelEvidenceOperationId'=
        prepared_document#>>'{content,modelEvidence,operationId}'
    AND authority->'dispatchAuthority'=
        prepared_document#>'{content,dispatchAuthority}'
    AND authority->>'factualReleaseId'=
        prepared_document#>>'{content,factualReleaseId}'
    AND prepared_document#>>'{content,scopeKey}'=requested_scope_key
    AND current_authority_rows->0->>'scope_key'=requested_scope_key
    AND current_authority_rows->0->>'factual_release_scope_key'=
        prepared_document#>>'{content,factualReleaseScopeKey}'
    AND current_authority_rows->0->>'factual_release_id'=
        prepared_document#>>'{content,factualReleaseId}'
    AND current_authority_rows->0->>'factual_output_id'=
        prepared_document#>>'{content,dispatchAuthority,factualOutputId}'
    AND current_authority_rows->0->>'hpn_calculation_id'=
        prepared_document#>>'{content,dispatchAuthority,hpnCalculationId}'
    AND current_authority_rows->0->>'model_operation_id'=
        prepared_document#>>'{content,dispatchAuthority,modelOperationId}'
    AND current_authority_rows->0->'model_evidence_json'=
        prepared_document#>'{content,modelEvidence}',
    FALSE
  );
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN FALSE;
END $$;

CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_cohort_capture"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE prepared RECORD; expected_operation_id TEXT; dispatch_authority JSONB;
BEGIN
  SELECT prepared_set."prepared_set_json",prepared_set."factual_release_scope_key",
         prepared_set."factual_release_id",prepared_head."revision" AS head_revision
    INTO prepared
    FROM "outcome_current_prepared_valuation_input_set" prepared_head
    JOIN "outcome_prepared_valuation_input_set" prepared_set
      ON prepared_set."prepared_input_set_id"=prepared_head."prepared_input_set_id"
   WHERE prepared_head."scope_key"=NEW."scope_key"
   FOR SHARE OF prepared_head,prepared_set;
  IF NEW."preparation_authority"='authenticated_calculation_evidence_snapshot' THEN
    expected_operation_id:='private-evaluation-cohort-run:'||encode(sha256(convert_to(
      "outcome_afl_trade_canonical_json"(jsonb_build_object(
        'scopeKey',NEW."scope_key",'preparedInputSetId',NEW."prepared_input_set_id",
        'preparedInputSetRevision',NEW."prepared_input_set_revision",
        'modelQualificationWorkId',NEW."model_qualification_work_id",
        'factualReleaseRevision',NEW."factual_release_revision",
        'modelPairRevision',NEW."model_pair_revision",
        'expectedBatchRevision',NEW."expected_batch_revision"
      )),'UTF8')),'hex');
    IF NOT EXISTS (
      SELECT 1 FROM "outcome_active_release" active_release
       WHERE active_release."scope_key"=prepared."factual_release_scope_key"
         AND active_release."release_id"=prepared."factual_release_id"
         AND active_release."revision"=NEW."factual_release_revision"
    ) THEN RAISE EXCEPTION 'Private evaluation cohort capture is not exact current authority';
    END IF;
  ELSE
    dispatch_authority:=prepared."prepared_set_json"->'content'->'dispatchAuthority';
    expected_operation_id:='private-evaluation-cohort-run:'||encode(sha256(convert_to(
      "outcome_afl_trade_canonical_json"(jsonb_build_object(
        'scopeKey',NEW."scope_key",'preparedInputSetId',NEW."prepared_input_set_id",
        'preparedInputSetRevision',NEW."prepared_input_set_revision",
        'preparationOperationId',NEW."preparation_operation_id",
        'currentModelEvidenceOperationId',NEW."current_model_evidence_operation_id",
        'dispatchAuthority',dispatch_authority,
        'modelQualificationWorkId',NEW."model_qualification_work_id",
        'modelPairRevision',NEW."model_pair_revision",
        'expectedBatchRevision',NEW."expected_batch_revision"
      )),'UTF8')),'hex');
    IF "outcome_private_evaluation_prepared_authority_is_current"(
         NEW."scope_key",NEW."prepared_input_set_id",NEW."prepared_input_set_revision",
         NEW."model_qualification_work_id",NEW."model_pair_revision",
         NEW."preparation_operation_id",NEW."current_model_evidence_operation_id",
         NEW."dispatch_request_id",NEW."factual_output_id",NEW."hpn_calculation_id",
         NEW."model_operation_id"
       ) IS DISTINCT FROM TRUE
      OR dispatch_authority->>'requestId' IS DISTINCT FROM NEW."dispatch_request_id"
      OR dispatch_authority->>'factualOutputId' IS DISTINCT FROM NEW."factual_output_id"
      OR dispatch_authority->>'hpnCalculationId' IS DISTINCT FROM NEW."hpn_calculation_id"
      OR dispatch_authority->>'modelOperationId' IS DISTINCT FROM NEW."model_operation_id"
    THEN RAISE EXCEPTION 'Private evaluation cohort capture is not exact current authority';
    END IF;
  END IF;
  IF NEW."operation_id" IS DISTINCT FROM expected_operation_id
    OR NEW."captured_at">transaction_timestamp()
    OR NEW."captured_at"<transaction_timestamp()-INTERVAL '5 minutes'
    OR prepared."head_revision" IS DISTINCT FROM NEW."prepared_input_set_revision"
    OR COALESCE((SELECT batch_head."revision"
                   FROM "outcome_current_private_evaluation_batch" batch_head
                  WHERE batch_head."scope_key"=NEW."scope_key"),0)
       IS DISTINCT FROM NEW."expected_batch_revision"
    OR NOT EXISTS (
      SELECT 1 FROM "outcome_current_governed_valuation_model_pair" model_head
       WHERE model_head."scope_key"=NEW."scope_key"
         AND model_head."work_id"=NEW."model_qualification_work_id"
         AND model_head."revision"=NEW."model_pair_revision"
    )
  THEN RAISE EXCEPTION 'Private evaluation cohort capture is not exact current authority';
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Private evaluation cohort capture contains invalid typed authority';
END $$;

CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_cohort_failure"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE content JSONB:=NEW."diagnostic_json"->'content'; capture RECORD;
BEGIN
  SELECT * INTO capture FROM "outcome_private_evaluation_cohort_capture"
   WHERE "operation_id"=NEW."operation_id" FOR KEY SHARE;
  IF jsonb_typeof(NEW."diagnostic_json") IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(NEW."diagnostic_json"))<>2
    OR NEW."diagnostic_json"->>'diagnosticId' IS DISTINCT FROM NEW."diagnostic_id"
    OR jsonb_typeof(content) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(content))<>12
    OR content->>'schemaVersion' IS DISTINCT FROM 'private-evaluation-cohort-failure/v1'
    OR content->>'environment' IS DISTINCT FROM 'non_production'
    OR content->'publicationEligible' IS DISTINCT FROM 'false'::JSONB
    OR content->>'scopeKey' IS DISTINCT FROM NEW."scope_key"
    OR content->>'operationId' IS DISTINCT FROM NEW."operation_id"
    OR content->>'preparedInputSetId' IS DISTINCT FROM NEW."prepared_input_set_id"
    OR jsonb_typeof(content->'preparedInputSetRevision') IS DISTINCT FROM 'number'
    OR (content->>'preparedInputSetRevision')::INTEGER IS DISTINCT FROM
       NEW."prepared_input_set_revision"
    OR content->>'modelQualificationWorkId' IS DISTINCT FROM
       NEW."model_qualification_work_id"
    OR jsonb_typeof(content->'expectedBatchRevision') IS DISTINCT FROM 'number'
    OR (content->>'expectedBatchRevision')::INTEGER IS DISTINCT FROM
       NEW."expected_batch_revision"
    OR (content->>'recordedAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."recorded_at"
    OR NEW."recorded_at">transaction_timestamp()
    OR NEW."recorded_at"<transaction_timestamp()-INTERVAL '5 minutes'
    OR content->>'limitation' IS DISTINCT FROM
       'Private engineering diagnostics only; no factual, model, production, or publication authority.'
    OR jsonb_typeof(content->'diagnostics') IS DISTINCT FROM 'array'
    OR jsonb_array_length(content->'diagnostics') NOT BETWEEN 1 AND 10000
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(content->'diagnostics')
        WITH ORDINALITY diagnostic(value,ordinal)
       WHERE jsonb_typeof(value) IS DISTINCT FROM 'object'
         OR (SELECT count(*) FROM jsonb_object_keys(value))<>4
         OR jsonb_typeof(value->'tradeId') IS DISTINCT FROM 'string'
         OR jsonb_typeof(value->'stage') IS DISTINCT FROM 'string'
         OR jsonb_typeof(value->'name') IS DISTINCT FROM 'string'
         OR jsonb_typeof(value->'message') IS DISTINCT FROM 'string'
         OR value->>'stage' IS DISTINCT FROM 'stage_automated'
         OR char_length(btrim(value->>'tradeId')) NOT BETWEEN 1 AND 400
         OR char_length(btrim(value->>'name')) NOT BETWEEN 1 AND 400
         OR char_length(btrim(value->>'message')) NOT BETWEEN 1 AND 4000
         OR value->>'tradeId' IS DISTINCT FROM btrim(value->>'tradeId')
         OR value->>'name' IS DISTINCT FROM btrim(value->>'name')
         OR value->>'message' IS DISTINCT FROM btrim(value->>'message')
         OR NOT EXISTS (
           SELECT 1 FROM "outcome_prepared_valuation_input_entry" prepared_entry
            WHERE prepared_entry."prepared_input_set_id"=NEW."prepared_input_set_id"
              AND prepared_entry."trade_id"=value->>'tradeId'
              AND prepared_entry."state"='ready'
         )
         OR (ordinal>1 AND value->>'tradeId'<
             content->'diagnostics'->((ordinal-2)::INTEGER)->>'tradeId')
    )
    OR (SELECT count(DISTINCT value->>'tradeId')
          FROM jsonb_array_elements(content->'diagnostics') value)
       IS DISTINCT FROM jsonb_array_length(content->'diagnostics')::BIGINT
    OR NEW."diagnostic_id" IS DISTINCT FROM 'private-evaluation-cohort-failure:'||
       encode(sha256(convert_to("outcome_afl_trade_canonical_json"(content),'UTF8')),'hex')
    OR capture."scope_key" IS DISTINCT FROM NEW."scope_key"
    OR capture."prepared_input_set_id" IS DISTINCT FROM NEW."prepared_input_set_id"
    OR capture."prepared_input_set_revision" IS DISTINCT FROM
       NEW."prepared_input_set_revision"
    OR capture."model_qualification_work_id" IS DISTINCT FROM
       NEW."model_qualification_work_id"
    OR capture."expected_batch_revision" IS DISTINCT FROM NEW."expected_batch_revision"
    OR NEW."recorded_at"<capture."captured_at"
  THEN RAISE EXCEPTION 'Private evaluation cohort failure evidence is not exact';
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Private evaluation cohort failure evidence has invalid typed fields';
END $$;

CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_execution_cycle"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE content JSONB:=NEW."cycle_json"->'content'; authority JSONB;
  expected_fingerprint TEXT; expected_cycle TEXT; authority_key_count INTEGER;
BEGIN
  IF NEW."preparation_authority"='authenticated_calculation_evidence_snapshot' THEN
    authority:=jsonb_build_object(
      'scopeKey',NEW."scope_key",'preparedInputSetId',NEW."prepared_input_set_id",
      'preparedInputSetRevision',NEW."prepared_input_set_revision",
      'factualReleaseRevision',NEW."factual_release_revision",
      'modelQualificationWorkId',NEW."model_qualification_work_id",
      'modelPairRevision',NEW."model_pair_revision");
    authority_key_count:=6;
  ELSE
    authority:=jsonb_build_object(
      'scopeKey',NEW."scope_key",'preparedInputSetId',NEW."prepared_input_set_id",
      'preparedInputSetRevision',NEW."prepared_input_set_revision",
      'preparationOperationId',NEW."preparation_operation_id",
      'currentModelEvidenceOperationId',NEW."current_model_evidence_operation_id",
      'dispatchAuthority',jsonb_build_object(
        'requestId',NEW."dispatch_request_id",'factualOutputId',NEW."factual_output_id",
        'hpnCalculationId',NEW."hpn_calculation_id",'modelOperationId',NEW."model_operation_id"),
      'modelQualificationWorkId',NEW."model_qualification_work_id",
      'modelPairRevision',NEW."model_pair_revision");
    authority_key_count:=8;
  END IF;
  expected_fingerprint:='cohort-execution-input:'||encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(authority),'UTF8')),'hex');
  expected_cycle:='cohort-execution-cycle:'||encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(jsonb_build_object(
      'inputFingerprint',NEW."input_fingerprint",'repairSequence',NEW."repair_sequence"
    )),'UTF8')),'hex');
  IF NEW."repair_sequence">0 AND NOT EXISTS (
    SELECT 1 FROM "outcome_private_evaluation_execution_cycle" prior
     WHERE prior."cycle_id"=NEW."repairs_cycle_id"
       AND prior."input_fingerprint"=NEW."input_fingerprint"
       AND prior."repair_sequence"=NEW."repair_sequence"-1
       AND NEW."opened_at">=prior."opened_at"
       AND NEW."opened_at">=COALESCE((
         SELECT max(attempt."finished_at")
           FROM "outcome_private_evaluation_execution_attempt" attempt
          WHERE attempt."cycle_id"=prior."cycle_id"
       ),prior."opened_at")
       AND EXISTS (SELECT 1 FROM "outcome_private_evaluation_execution_work" work
                    WHERE work."cycle_id"=prior."cycle_id")
       AND NOT EXISTS (SELECT 1 FROM "outcome_private_evaluation_execution_work" work
                        WHERE work."cycle_id"=prior."cycle_id"
                          AND work."status" NOT IN ('succeeded','unavailable','exhausted'))
  ) THEN RAISE EXCEPTION 'Private evaluation execution repair lacks a terminal predecessor';
  END IF;
  IF jsonb_typeof(NEW."cycle_json") IS DISTINCT FROM 'object'
    OR "outcome_private_evaluation_json_object_key_count"(NEW."cycle_json")<>2
    OR jsonb_typeof(content) IS DISTINCT FROM 'object'
    OR "outcome_private_evaluation_json_object_key_count"(content)<>14
    OR jsonb_typeof(content->'authority') IS DISTINCT FROM 'object'
    OR "outcome_private_evaluation_json_object_key_count"(content->'authority')<>
       authority_key_count
    OR jsonb_typeof(content->'repairSequence') IS DISTINCT FROM 'number'
    OR jsonb_typeof(content->'maximumAttemptsPerTrade') IS DISTINCT FROM 'number'
    OR content->'authority' IS DISTINCT FROM authority
    OR NEW."input_fingerprint" IS DISTINCT FROM expected_fingerprint
    OR NEW."cycle_id" IS DISTINCT FROM expected_cycle
    OR NEW."maximum_attempts"<>3
    OR NEW."opened_at">transaction_timestamp()
    OR (NEW."repair_sequence">0
      AND NEW."opened_at" IS DISTINCT FROM date_trunc('milliseconds',transaction_timestamp())
      AND NOT EXISTS (SELECT 1 FROM "outcome_private_evaluation_execution_cycle" retained
                       WHERE retained."cycle_id"=NEW."cycle_id"
                         AND retained."cycle_json"=NEW."cycle_json"))
    OR NEW."cycle_json"->>'cycleId' IS DISTINCT FROM NEW."cycle_id"
    OR content->>'schemaVersion' IS DISTINCT FROM
       'private-evaluation-cohort-execution-cycle/v1'
    OR content->>'environment' IS DISTINCT FROM 'non_production'
    OR content->'publicationEligible' IS DISTINCT FROM 'false'::JSONB
    OR content->>'inputFingerprint' IS DISTINCT FROM NEW."input_fingerprint"
    OR (content->>'repairSequence')::INTEGER IS DISTINCT FROM NEW."repair_sequence"
    OR content->>'openingCause' IS DISTINCT FROM NEW."opening_cause"
    OR content->>'openingPrincipalId' IS DISTINCT FROM NEW."opening_principal_id"
    OR content->>'repairOperationId' IS DISTINCT FROM NEW."repair_operation_id"
    OR content->>'repairReason' IS DISTINCT FROM NEW."repair_reason"
    OR content->>'repairsCycleId' IS DISTINCT FROM NEW."repairs_cycle_id"
    OR (content->>'maximumAttemptsPerTrade')::INTEGER IS DISTINCT FROM 3
    OR (content->>'openedAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."opened_at"
    OR content->>'limitation' IS DISTINCT FROM
       'Private local execution control only; it grants no factual, model, production, or publication authority.'
    OR (NEW."repair_sequence"=0) IS DISTINCT FROM
       (NEW."repairs_cycle_id" IS NULL AND NEW."opening_cause"='authenticated_inputs_changed')
    OR (NEW."repair_sequence"=0) IS DISTINCT FROM (NEW."repair_operation_id" IS NULL)
    OR (NEW."repair_sequence"=0) IS DISTINCT FROM (NEW."repair_reason" IS NULL)
    OR (NEW."repair_sequence">0 AND (NEW."repair_reason" IS NULL OR
        btrim(NEW."repair_reason")='' OR length(NEW."repair_reason")>2000))
    OR (NEW."preparation_authority"='authenticated_calculation_evidence_snapshot' AND NOT EXISTS (
      SELECT 1 FROM "outcome_current_prepared_valuation_input_set" prepared_head
      JOIN "outcome_prepared_valuation_input_set" prepared
        ON prepared."prepared_input_set_id"=prepared_head."prepared_input_set_id"
      JOIN "outcome_active_release" active_release
        ON active_release."scope_key"=prepared."factual_release_scope_key"
       AND active_release."release_id"=prepared."factual_release_id"
      JOIN "outcome_current_governed_valuation_model_pair" model_head
        ON model_head."scope_key"=prepared_head."scope_key"
       WHERE prepared_head."scope_key"=NEW."scope_key"
         AND prepared_head."prepared_input_set_id"=NEW."prepared_input_set_id"
         AND prepared_head."revision"=NEW."prepared_input_set_revision"
         AND active_release."revision"=NEW."factual_release_revision"
         AND prepared."schema_version"='afl-trade-prepared-valuation-input-set/v3'
         AND prepared."environment"='non_production' AND prepared."finalized_at" IS NOT NULL
         AND model_head."work_id"=NEW."model_qualification_work_id"
         AND model_head."revision"=NEW."model_pair_revision"
    ))
    OR (NEW."preparation_authority"='qualified_current_model_evidence' AND
       "outcome_private_evaluation_prepared_authority_is_current"(
         NEW."scope_key",NEW."prepared_input_set_id",NEW."prepared_input_set_revision",
         NEW."model_qualification_work_id",NEW."model_pair_revision",
         NEW."preparation_operation_id",NEW."current_model_evidence_operation_id",
         NEW."dispatch_request_id",NEW."factual_output_id",NEW."hpn_calculation_id",
         NEW."model_operation_id"
       ) IS DISTINCT FROM TRUE)
  THEN RAISE EXCEPTION 'Private evaluation execution cycle is not exact current authority';
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Private evaluation execution cycle is malformed';
END $$;

CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_batch"() RETURNS TRIGGER AS $$
DECLARE content JSONB; prepared RECORD; work RECORD; expected_ids JSONB;
  prepared_head RECORD; model_head RECORD; release_is_current BOOLEAN;
BEGIN
  content:=NEW."batch_json"->'content';
  SELECT "scope_key","factual_release_scope_key","factual_release_id","trade_count",
         "finalized_at","prepared_set_json"
    INTO prepared FROM "outcome_prepared_valuation_input_set"
   WHERE "prepared_input_set_id"=NEW."prepared_input_set_id" FOR KEY SHARE;
  SELECT "scope_key","qualification_id" INTO work
    FROM "outcome_governed_model_qualification_work"
   WHERE "work_id"=NEW."model_qualification_work_id" FOR KEY SHARE;
  SELECT jsonb_agg(to_jsonb("trade_id") ORDER BY "trade_id") INTO expected_ids
    FROM "outcome_prepared_valuation_input_entry"
   WHERE "prepared_input_set_id"=NEW."prepared_input_set_id";
  SELECT * INTO prepared_head FROM "outcome_current_prepared_valuation_input_set"
   WHERE "scope_key"=NEW."scope_key" FOR KEY SHARE;
  SELECT * INTO model_head FROM "outcome_current_governed_valuation_model_pair"
   WHERE "scope_key"=NEW."scope_key" FOR KEY SHARE;
  IF prepared."prepared_set_json"->'content'->>'preparationAuthority'=
       'authenticated_calculation_evidence_snapshot' THEN
    SELECT EXISTS(
      SELECT 1 FROM "outcome_active_release" active_release
       WHERE active_release."scope_key"=prepared."factual_release_scope_key"
         AND active_release."release_id"=NEW."factual_release_id"
    ) INTO release_is_current;
  ELSE
    release_is_current:="outcome_private_evaluation_prepared_authority_is_current"(
      NEW."scope_key",NEW."prepared_input_set_id",NEW."prepared_input_set_revision",
      NEW."model_qualification_work_id",
      (prepared."prepared_set_json"#>>'{content,modelEvidence,modelRevision}')::INTEGER,
      prepared."prepared_set_json"->'content'->>'preparationOperationId',
      prepared."prepared_set_json"#>>'{content,modelEvidence,operationId}',
      prepared."prepared_set_json"#>>'{content,dispatchAuthority,requestId}',
      prepared."prepared_set_json"#>>'{content,dispatchAuthority,factualOutputId}',
      prepared."prepared_set_json"#>>'{content,dispatchAuthority,hpnCalculationId}',
      prepared."prepared_set_json"#>>'{content,dispatchAuthority,modelOperationId}'
    );
  END IF;
  IF release_is_current IS DISTINCT FROM TRUE
    OR prepared."finalized_at" IS NULL OR prepared."scope_key" IS DISTINCT FROM NEW."scope_key"
    OR prepared."factual_release_id" IS DISTINCT FROM NEW."factual_release_id"
    OR prepared."trade_count" IS DISTINCT FROM NEW."trade_count"
    OR work."scope_key" IS DISTINCT FROM NEW."scope_key"
    OR work."qualification_id" IS DISTINCT FROM NEW."model_qualification_id"
    OR prepared_head."prepared_input_set_id" IS DISTINCT FROM NEW."prepared_input_set_id"
    OR prepared_head."revision" IS DISTINCT FROM NEW."prepared_input_set_revision"
    OR model_head."qualification_id" IS DISTINCT FROM NEW."model_qualification_id"
    OR model_head."work_id" IS DISTINCT FROM NEW."model_qualification_work_id"
    OR NEW."created_at">transaction_timestamp()
    OR jsonb_typeof(NEW."batch_json")<>'object'
    OR (SELECT count(*) FROM jsonb_object_keys(NEW."batch_json"))<>2
    OR NEW."batch_json"->>'batchId' IS DISTINCT FROM NEW."batch_id"
    OR jsonb_typeof(content)<>'object'
    OR (SELECT count(*) FROM jsonb_object_keys(content))<>15
    OR content->>'schemaVersion' IS DISTINCT FROM 'governed-private-evaluation-batch/v1'
    OR content->>'environment' IS DISTINCT FROM 'non_production'
    OR content->'publicationEligible' IS DISTINCT FROM 'false'::JSONB
    OR content->>'scopeKey' IS DISTINCT FROM NEW."scope_key"
    OR content->>'preparedInputSetId' IS DISTINCT FROM NEW."prepared_input_set_id"
    OR (content->>'preparedInputSetRevision')::INTEGER IS DISTINCT FROM
       NEW."prepared_input_set_revision"
    OR content->>'factualReleaseId' IS DISTINCT FROM NEW."factual_release_id"
    OR content->>'modelQualificationId' IS DISTINCT FROM NEW."model_qualification_id"
    OR content->>'modelQualificationWorkId' IS DISTINCT FROM
       NEW."model_qualification_work_id"
    OR content->'entries' IS NULL OR jsonb_typeof(content->'entries')<>'array'
    OR (SELECT jsonb_agg(to_jsonb(entry->>'tradeId') ORDER BY ordinal)
          FROM jsonb_array_elements(content->'entries') WITH ORDINALITY supplied(entry,ordinal))
       IS DISTINCT FROM expected_ids
    OR jsonb_array_length(content->'entries') IS DISTINCT FROM NEW."trade_count"
    OR (content->>'tradeCount')::INTEGER IS DISTINCT FROM NEW."trade_count"
    OR (content->>'readyCount')::INTEGER IS DISTINCT FROM NEW."ready_count"
    OR (content->>'unavailableCount')::INTEGER IS DISTINCT FROM NEW."unavailable_count"
    OR (SELECT count(*) FROM jsonb_array_elements(content->'entries') entry
         WHERE entry->>'state'='ready') IS DISTINCT FROM NEW."ready_count"
    OR (SELECT count(*) FROM jsonb_array_elements(content->'entries') entry
         WHERE entry->>'state'='unavailable') IS DISTINCT FROM NEW."unavailable_count"
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(content->'entries') entry
       WHERE jsonb_typeof(entry)<>'object'
         OR jsonb_typeof(entry->'tradeId')<>'string'
         OR char_length(entry->>'tradeId') NOT BETWEEN 1 AND 400
         OR entry->>'tradeId' !~ '^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$'
         OR jsonb_typeof(entry->'state')<>'string'
         OR entry->>'state' NOT IN ('ready','unavailable')
         OR (entry->>'state'='ready' AND (
           (SELECT count(*) FROM jsonb_object_keys(entry))<>3
           OR jsonb_typeof(entry->'generationId')<>'string'
           OR entry->>'generationId' !~
              '^local-private-trade-evaluation-generation:[a-f0-9]{64}$'))
         OR (entry->>'state'='unavailable' AND (
           (SELECT count(*) FROM jsonb_object_keys(entry))<>3
           OR jsonb_typeof(entry->'blockers')<>'array'
           OR jsonb_array_length(entry->'blockers') NOT BETWEEN 1 AND 10000
           OR EXISTS (
             SELECT 1 FROM jsonb_array_elements(entry->'blockers') blocker
              WHERE jsonb_typeof(blocker)<>'object'
                OR (SELECT count(*) FROM jsonb_object_keys(blocker))<>2
                OR jsonb_typeof(blocker->'code')<>'string'
                OR blocker->>'code' NOT IN (
                  'source_blocked','insufficient_data','identity_unresolved','lineage_unresolved',
                  'model_not_approved','reconciliation_failed','engineering_unavailable',
                  'component_output_unavailable','unsupported_trade','policy_unavailable',
                  'temporal_evidence_unavailable')
                OR jsonb_typeof(blocker->'message')<>'string'
                OR char_length(btrim(blocker->>'message')) NOT BETWEEN 1 AND 2000
                OR blocker->>'message' IS DISTINCT FROM btrim(blocker->>'message')
           )))
    )
    OR (content->>'createdAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."created_at"
    OR content->>'limitation' IS DISTINCT FROM
       'Private non-production evaluation batch only; it grants no factual, production, or publication authority.'
    OR NEW."content_canonical_json" IS DISTINCT FROM
       "outcome_afl_trade_canonical_json"(content)
    OR NEW."content_sha256" IS DISTINCT FROM
       encode(sha256(convert_to(NEW."content_canonical_json",'UTF8')),'hex')
    OR NEW."batch_id" IS DISTINCT FROM 'private-evaluation-batch:'||
       encode(sha256(convert_to(NEW."content_canonical_json",'UTF8')),'hex')
  THEN RAISE EXCEPTION 'Private evaluation batch identity or governed ancestry mismatch';
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Private evaluation batch identity or governed ancestry mismatch';
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_batch_activation_target"(
  requested_scope_key TEXT, requested_batch_id TEXT
) RETURNS BOOLEAN LANGUAGE SQL AS $$
  SELECT COALESCE((
    SELECT "validate_outcome_private_evaluation_batch_complete"(
      requested_scope_key,requested_batch_id
    )
    AND EXISTS (
      SELECT 1 FROM "outcome_current_prepared_valuation_input_set" prepared_head
       WHERE prepared_head."scope_key"=target."scope_key"
         AND prepared_head."prepared_input_set_id"=target."prepared_input_set_id"
         AND prepared_head."revision"=target."prepared_input_set_revision"
    )
    AND EXISTS (
      SELECT 1 FROM "outcome_current_governed_valuation_model_pair" model_head
       WHERE model_head."scope_key"=target."scope_key"
         AND model_head."qualification_id"=target."model_qualification_id"
         AND model_head."work_id"=target."model_qualification_work_id"
    )
    AND EXISTS (
      SELECT 1 FROM "outcome_prepared_valuation_input_set" prepared
       WHERE prepared."prepared_input_set_id"=target."prepared_input_set_id"
         AND (
           (prepared."prepared_set_json"->'content'->>'preparationAuthority'=
              'authenticated_calculation_evidence_snapshot' AND EXISTS (
             SELECT 1 FROM "outcome_active_release" active_release
              WHERE active_release."scope_key"=prepared."factual_release_scope_key"
                AND active_release."release_id"=target."factual_release_id"
           ))
           OR
           (prepared."prepared_set_json"->'content'->>'preparationAuthority'=
              'qualified_current_model_evidence' AND
            "outcome_private_evaluation_prepared_authority_is_current"(
              target."scope_key",target."prepared_input_set_id",
              target."prepared_input_set_revision",target."model_qualification_work_id",
              (prepared."prepared_set_json"#>>'{content,modelEvidence,modelRevision}')::INTEGER,
              prepared."prepared_set_json"->'content'->>'preparationOperationId',
              prepared."prepared_set_json"#>>'{content,modelEvidence,operationId}',
              prepared."prepared_set_json"#>>'{content,dispatchAuthority,requestId}',
              prepared."prepared_set_json"#>>'{content,dispatchAuthority,factualOutputId}',
              prepared."prepared_set_json"#>>'{content,dispatchAuthority,hpnCalculationId}',
              prepared."prepared_set_json"#>>'{content,dispatchAuthority,modelOperationId}'
            ))
         )
    )
    FROM "outcome_private_evaluation_batch" target
    WHERE target."batch_id"=requested_batch_id AND target."scope_key"=requested_scope_key
  ),FALSE)
$$;

CREATE OR REPLACE FUNCTION "advance_outcome_current_private_evaluation_batch"(
  requested_scope_key TEXT, requested_batch_id TEXT, expected_revision INTEGER,
  requested_operation_id TEXT, requested_action TEXT, requested_principal_id TEXT
) RETURNS TABLE(batch_id TEXT,revision INTEGER,transition_id TEXT,activated_at TIMESTAMPTZ) AS $$
DECLARE current_head RECORD; target RECORD; retained RECORD; next_revision INTEGER;
  new_transition_id TEXT; target_preparation_authority TEXT;
BEGIN
  SELECT prepared."prepared_set_json"->'content'->>'preparationAuthority'
    INTO target_preparation_authority
    FROM "outcome_private_evaluation_batch" target_batch
    JOIN "outcome_prepared_valuation_input_set" prepared
      ON prepared."prepared_input_set_id"=target_batch."prepared_input_set_id"
   WHERE target_batch."batch_id"=requested_batch_id
     AND target_batch."scope_key"=requested_scope_key
   FOR KEY SHARE OF target_batch,prepared;
  IF target_preparation_authority='qualified_current_model_evidence'
    AND current_user IS DISTINCT FROM 'afl_trade_private_evaluation_batch_head_owner'
  THEN RAISE EXCEPTION 'Dispatch-bound private batch activation requires a live claim';
  END IF;
  IF requested_action IS DISTINCT FROM 'activate' OR expected_revision<0 OR
     requested_principal_id IS DISTINCT FROM 'system:weekly-valuation-coordinator' OR
     requested_operation_id IS DISTINCT FROM 'private-evaluation-batch-operation:'||
       encode(sha256(convert_to("outcome_afl_trade_canonical_json"(jsonb_build_object(
         'scopeKey',requested_scope_key,'batchId',requested_batch_id,
         'expectedRevision',expected_revision,'action',requested_action,
         'principalId',requested_principal_id
       )),'UTF8')),'hex')
  THEN RAISE EXCEPTION 'Private evaluation batch transition request is invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('private-evaluation-batch-head:'||requested_scope_key,0));
  SELECT target_row.* INTO target FROM "outcome_private_evaluation_batch" target_row
   WHERE target_row."batch_id"=requested_batch_id
     AND target_row."scope_key"=requested_scope_key FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Private evaluation batch target is incomplete or cross-scope';
  END IF;
  SELECT * INTO retained FROM "outcome_private_evaluation_batch_transition"
   WHERE "operation_id"=requested_operation_id FOR KEY SHARE;
  IF FOUND THEN
    IF retained."scope_key" IS DISTINCT FROM requested_scope_key OR
       retained."to_batch_id" IS DISTINCT FROM requested_batch_id OR
       retained."action" IS DISTINCT FROM requested_action OR
       retained."principal_id" IS DISTINCT FROM requested_principal_id OR
       retained."from_revision" IS DISTINCT FROM expected_revision OR
       retained."to_revision" IS DISTINCT FROM expected_revision+1 OR
       NOT (
         EXISTS (SELECT 1 FROM "outcome_current_private_evaluation_batch" head
                  WHERE head."scope_key"=requested_scope_key
                    AND head."last_transition_id"=retained."transition_id")
         OR EXISTS (SELECT 1 FROM "outcome_private_evaluation_batch_transition" successor
                     WHERE successor."scope_key"=requested_scope_key
                       AND successor."from_revision"=retained."to_revision"
                       AND successor."from_batch_id"=retained."to_batch_id")
       )
    THEN RAISE EXCEPTION 'Private evaluation batch operation replay is stale or conflicting';
    END IF;
    batch_id:=retained."to_batch_id"; revision:=retained."to_revision";
    transition_id:=retained."transition_id"; activated_at:=retained."transitioned_at";
    RETURN NEXT; RETURN;
  END IF;
  IF "validate_outcome_private_evaluation_batch_complete"(
       requested_scope_key,requested_batch_id) IS DISTINCT FROM TRUE OR
     "validate_outcome_private_evaluation_batch_activation_target"(
       requested_scope_key,requested_batch_id) IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'Private evaluation batch target is incomplete or cross-scope';
  END IF;
  SELECT * INTO current_head FROM "outcome_current_private_evaluation_batch"
   WHERE "scope_key"=requested_scope_key FOR UPDATE;
  IF COALESCE(current_head."revision",0)<>expected_revision THEN
    RAISE EXCEPTION 'Private evaluation batch heads require fenced compare-and-swap';
  END IF;
  next_revision:=expected_revision+1;
  new_transition_id:='private-evaluation-batch-transition:'||encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(jsonb_build_object(
      'operationId',requested_operation_id,'scopeKey',requested_scope_key,
      'action',requested_action,'principalId',requested_principal_id,
      'fromRevision',expected_revision,'fromBatchId',current_head."batch_id",
      'toRevision',next_revision,'toBatchId',requested_batch_id
    )),'UTF8')),'hex');
  INSERT INTO "outcome_private_evaluation_batch_transition"(
    "transition_id","operation_id","scope_key","principal_id","action","from_revision",
    "from_batch_id","to_revision","to_batch_id","transitioned_at"
  ) VALUES (
    new_transition_id,requested_operation_id,requested_scope_key,requested_principal_id,
    requested_action,expected_revision,current_head."batch_id",next_revision,
    requested_batch_id,date_trunc('milliseconds',transaction_timestamp())
  );
  IF current_head."scope_key" IS NULL THEN
    INSERT INTO "outcome_current_private_evaluation_batch"(
      "scope_key","batch_id","revision","last_transition_id","activated_at"
    ) VALUES (
      requested_scope_key,requested_batch_id,next_revision,new_transition_id,
      date_trunc('milliseconds',transaction_timestamp())
    );
  ELSE
    UPDATE "outcome_current_private_evaluation_batch" SET
      "batch_id"=requested_batch_id,"revision"=next_revision,
      "last_transition_id"=new_transition_id,
      "activated_at"=date_trunc('milliseconds',transaction_timestamp())
     WHERE "scope_key"=requested_scope_key;
  END IF;
  SELECT head."batch_id",head."revision",head."last_transition_id",head."activated_at"
    INTO batch_id,revision,transition_id,activated_at
    FROM "outcome_current_private_evaluation_batch" head
   WHERE head."scope_key"=requested_scope_key;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "advance_outcome_current_private_evaluation_batch_from_capture"(
  requested_scope_key TEXT, requested_batch_id TEXT, expected_revision INTEGER,
  requested_operation_id TEXT, requested_action TEXT, requested_principal_id TEXT,
  requested_cohort_operation_id TEXT
) RETURNS TABLE(batch_id TEXT,revision INTEGER,transition_id TEXT,activated_at TIMESTAMPTZ) AS $$
DECLARE capture RECORD; prepared RECORD; prepared_head RECORD; model_head RECORD;
  active_release RECORD;
BEGIN
  SELECT captured.* INTO capture
    FROM "outcome_private_evaluation_cohort_capture" captured
    JOIN "outcome_private_evaluation_cohort_batch" binding
      ON binding."operation_id"=captured."operation_id"
     AND binding."batch_id"=requested_batch_id
   WHERE captured."operation_id"=requested_cohort_operation_id
     AND captured."scope_key"=requested_scope_key
   FOR SHARE OF captured,binding;
  SELECT * INTO prepared_head FROM "outcome_current_prepared_valuation_input_set"
   WHERE "scope_key"=requested_scope_key FOR SHARE;
  SELECT * INTO prepared FROM "outcome_prepared_valuation_input_set"
   WHERE "prepared_input_set_id"=capture."prepared_input_set_id" FOR KEY SHARE;
  SELECT * INTO model_head FROM "outcome_current_governed_valuation_model_pair"
   WHERE "scope_key"=requested_scope_key FOR SHARE;
  IF capture."preparation_authority"='authenticated_calculation_evidence_snapshot' THEN
    SELECT * INTO active_release FROM "outcome_active_release"
     WHERE "scope_key"=prepared."factual_release_scope_key" FOR SHARE;
    IF active_release."release_id" IS DISTINCT FROM prepared."factual_release_id"
      OR active_release."revision" IS DISTINCT FROM capture."factual_release_revision"
    THEN RAISE EXCEPTION 'Private evaluation cohort final authority is stale';
    END IF;
  ELSIF "outcome_private_evaluation_prepared_authority_is_current"(
      requested_scope_key,capture."prepared_input_set_id",
      capture."prepared_input_set_revision",capture."model_qualification_work_id",
      capture."model_pair_revision",capture."preparation_operation_id",
      capture."current_model_evidence_operation_id",capture."dispatch_request_id",
      capture."factual_output_id",capture."hpn_calculation_id",capture."model_operation_id"
    ) IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'Private evaluation cohort final authority is stale';
  END IF;
  IF requested_action IS DISTINCT FROM 'activate' OR capture."operation_id" IS NULL
    OR prepared_head."prepared_input_set_id" IS DISTINCT FROM capture."prepared_input_set_id"
    OR prepared_head."revision" IS DISTINCT FROM capture."prepared_input_set_revision"
    OR model_head."work_id" IS DISTINCT FROM capture."model_qualification_work_id"
    OR model_head."revision" IS DISTINCT FROM capture."model_pair_revision"
  THEN RAISE EXCEPTION 'Private evaluation cohort final authority is stale';
  END IF;
  RETURN QUERY SELECT * FROM "advance_outcome_current_private_evaluation_batch"(
    requested_scope_key,requested_batch_id,expected_revision,requested_operation_id,
    requested_action,requested_principal_id
  );
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Private evaluation cohort final authority is stale';
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "advance_outcome_current_private_evaluation_batch_from_dispatch_claim"(
  requested_scope_key TEXT, requested_batch_id TEXT, expected_revision INTEGER,
  requested_operation_id TEXT, requested_action TEXT, requested_principal_id TEXT,
  requested_cohort_operation_id TEXT, requested_dispatch_request_id TEXT,
  requested_claim_id TEXT, requested_lease_token_sha256 TEXT
) RETURNS TABLE(batch_id TEXT,revision INTEGER,transition_id TEXT,activated_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE capture RECORD;
BEGIN
  PERFORM "load_outcome_private_valuation_dispatch_request_for_claim"(
    requested_dispatch_request_id,requested_claim_id,requested_lease_token_sha256
  );
  SELECT captured.* INTO capture
    FROM "outcome_private_evaluation_cohort_capture" captured
    JOIN "outcome_private_evaluation_cohort_batch" binding
      ON binding."operation_id"=captured."operation_id"
     AND binding."batch_id"=requested_batch_id
   WHERE captured."operation_id"=requested_cohort_operation_id
     AND captured."scope_key"=requested_scope_key
     AND captured."preparation_authority"='qualified_current_model_evidence'
     AND captured."dispatch_request_id"=requested_dispatch_request_id
   FOR SHARE OF captured,binding;
  IF capture."operation_id" IS NULL
    OR requested_action IS DISTINCT FROM 'activate'
    OR requested_principal_id IS DISTINCT FROM 'system:weekly-valuation-coordinator'
  THEN RAISE EXCEPTION 'Private evaluation batch dispatch claim is not exact captured authority';
  END IF;
  RETURN QUERY SELECT *
    FROM "advance_outcome_current_private_evaluation_batch_from_capture"(
      requested_scope_key,requested_batch_id,expected_revision,requested_operation_id,
      requested_action,requested_principal_id,requested_cohort_operation_id
    );
  -- A claim that expires during validation must roll back the otherwise complete head transition.
  PERFORM "load_outcome_private_valuation_dispatch_request_for_claim"(
    requested_dispatch_request_id,requested_claim_id,requested_lease_token_sha256
  );
END;
$$;

ALTER FUNCTION "advance_outcome_current_private_evaluation_batch_from_dispatch_claim"(
  TEXT,TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT
) OWNER TO afl_trade_private_evaluation_batch_head_owner;
DO $paths$ BEGIN
  EXECUTE format(
    'ALTER FUNCTION %I.advance_outcome_current_private_evaluation_batch_from_dispatch_claim(TEXT,TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema()
  );
END $paths$;

CREATE FUNCTION "load_outcome_private_evaluation_cohort_capture"(
  target_operation_id TEXT
) RETURNS TABLE(
  scope_key TEXT,
  prepared_input_set_id TEXT,
  prepared_input_set_revision INTEGER,
  preparation_operation_id TEXT,
  current_model_evidence_operation_id TEXT,
  dispatch_request_id TEXT,
  factual_output_id TEXT,
  hpn_calculation_id TEXT,
  model_operation_id TEXT,
  model_qualification_work_id TEXT,
  model_pair_revision INTEGER,
  expected_batch_revision INTEGER,
  captured_at TIMESTAMPTZ
) LANGUAGE SQL VOLATILE SECURITY DEFINER AS $$
  SELECT capture."scope_key",capture."prepared_input_set_id",
         capture."prepared_input_set_revision",capture."preparation_operation_id",
         capture."current_model_evidence_operation_id",capture."dispatch_request_id",
         capture."factual_output_id",capture."hpn_calculation_id",
         capture."model_operation_id",capture."model_qualification_work_id",
         capture."model_pair_revision",capture."expected_batch_revision",capture."captured_at"
    FROM "outcome_private_evaluation_cohort_capture" capture
   WHERE capture."operation_id"=target_operation_id
   FOR KEY SHARE
$$;
ALTER FUNCTION "load_outcome_private_evaluation_cohort_capture"(TEXT)
  OWNER TO afl_trade_private_evaluation_batch_head_owner;
DO $capture_loader_path$ BEGIN
  EXECUTE format(
    'ALTER FUNCTION %I.load_outcome_private_evaluation_cohort_capture(TEXT) SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema()
  );
END $capture_loader_path$;
REVOKE ALL ON FUNCTION "load_outcome_private_evaluation_cohort_capture"(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "load_outcome_private_evaluation_cohort_capture"(TEXT)
  TO afl_trade_private_evaluation_coordinator;

-- Coordinator inserts invoke validators that retain exact authority rows with locking reads.
-- Run those validators through the no-login owner so the coordinator never receives UPDATE.
ALTER FUNCTION "validate_outcome_private_evaluation_cohort_capture"() SECURITY DEFINER;
ALTER FUNCTION "validate_outcome_private_evaluation_cohort_failure"() SECURITY DEFINER;
ALTER FUNCTION "validate_outcome_private_evaluation_cohort_batch"() SECURITY DEFINER;
ALTER FUNCTION "validate_outcome_private_evaluation_batch"() SECURITY DEFINER;
ALTER FUNCTION "validate_outcome_private_evaluation_batch_entry"() SECURITY DEFINER;
ALTER FUNCTION "validate_outcome_private_evaluation_cohort_capture"()
  OWNER TO afl_trade_private_evaluation_batch_head_owner;
ALTER FUNCTION "validate_outcome_private_evaluation_cohort_failure"()
  OWNER TO afl_trade_private_evaluation_batch_head_owner;
ALTER FUNCTION "validate_outcome_private_evaluation_cohort_batch"()
  OWNER TO afl_trade_private_evaluation_batch_head_owner;
ALTER FUNCTION "validate_outcome_private_evaluation_batch"()
  OWNER TO afl_trade_private_evaluation_batch_head_owner;
ALTER FUNCTION "validate_outcome_private_evaluation_batch_entry"()
  OWNER TO afl_trade_private_evaluation_batch_head_owner;
DO $validator_paths$ BEGIN
  EXECUTE format(
    'ALTER FUNCTION %I.validate_outcome_private_evaluation_cohort_capture() SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema()
  );
  EXECUTE format(
    'ALTER FUNCTION %I.validate_outcome_private_evaluation_cohort_failure() SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema()
  );
  EXECUTE format(
    'ALTER FUNCTION %I.validate_outcome_private_evaluation_cohort_batch() SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema()
  );
  EXECUTE format(
    'ALTER FUNCTION %I.validate_outcome_private_evaluation_batch() SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema()
  );
  EXECUTE format(
    'ALTER FUNCTION %I.validate_outcome_private_evaluation_batch_entry() SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema()
  );
END $validator_paths$;
REVOKE ALL ON FUNCTION "validate_outcome_private_evaluation_cohort_capture"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "validate_outcome_private_evaluation_cohort_failure"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "validate_outcome_private_evaluation_cohort_batch"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "validate_outcome_private_evaluation_batch"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "validate_outcome_private_evaluation_batch_entry"() FROM PUBLIC;

GRANT SELECT ON TABLE
  "outcome_private_evaluation_batch","outcome_private_evaluation_batch_entry",
  "outcome_private_evaluation_batch_transition","outcome_current_private_evaluation_batch",
  "outcome_private_evaluation_cohort_capture","outcome_private_evaluation_cohort_batch",
  "outcome_prepared_valuation_input_set","outcome_prepared_valuation_input_entry",
  "outcome_current_prepared_valuation_input_set","outcome_current_governed_valuation_model_pair",
  "outcome_current_valuation_cohort_operation",
  "outcome_current_valuation_cohort_operation_result",
  "outcome_governed_model_qualification_work",
  "outcome_private_evaluation_materialization_manifest",
  "outcome_governed_valuation_model_qualification",
  "outcome_governed_valuation_component_run","outcome_gate_decision",
  "outcome_local_private_trade_evaluation_generation",
  "outcome_private_evaluation_transition_intent",
  "outcome_private_evaluation_authority_snapshot","outcome_active_release",
  "outcome_artifact_custody"
  TO afl_trade_private_evaluation_batch_head_owner;
GRANT INSERT ON TABLE "outcome_private_evaluation_batch_transition",
  "outcome_current_private_evaluation_batch"
  TO afl_trade_private_evaluation_batch_head_owner;
GRANT UPDATE ON TABLE
  "outcome_current_prepared_valuation_input_set",
  "outcome_prepared_valuation_input_set",
  "outcome_prepared_valuation_input_entry",
  "outcome_current_valuation_cohort_operation",
  "outcome_current_valuation_cohort_operation_result",
  "outcome_private_evaluation_cohort_capture",
  "outcome_private_evaluation_cohort_batch",
  "outcome_private_evaluation_batch",
  "outcome_private_evaluation_batch_transition",
  "outcome_current_private_evaluation_batch",
  "outcome_governed_model_qualification_work",
  "outcome_current_governed_valuation_model_pair",
  "outcome_private_evaluation_materialization_manifest",
  "outcome_governed_valuation_model_qualification",
  "outcome_governed_valuation_component_run",
  "outcome_gate_decision",
  "outcome_local_private_trade_evaluation_generation",
  "outcome_private_evaluation_transition_intent",
  "outcome_private_evaluation_authority_snapshot",
  "outcome_active_release",
  "outcome_artifact_custody"
  TO afl_trade_private_evaluation_batch_head_owner;
GRANT EXECUTE ON FUNCTION "load_outcome_private_valuation_dispatch_request_for_claim"(
  TEXT,TEXT,TEXT
) TO afl_trade_private_evaluation_batch_head_owner;
GRANT EXECUTE ON FUNCTION "load_outcome_private_prepared_v3_authority"(TEXT)
  TO afl_trade_private_evaluation_batch_head_owner;

GRANT SELECT,INSERT ON TABLE
  "outcome_private_evaluation_cohort_capture",
  "outcome_private_evaluation_cohort_failure",
  "outcome_private_evaluation_cohort_batch",
  "outcome_private_evaluation_batch",
  "outcome_private_evaluation_batch_entry",
  "outcome_private_evaluation_execution_cycle",
  "outcome_private_evaluation_execution_work"
  TO afl_trade_private_evaluation_coordinator;
GRANT SELECT ON TABLE "outcome_current_private_evaluation_batch"
  TO afl_trade_private_evaluation_coordinator;
REVOKE ALL ON FUNCTION "advance_outcome_current_private_evaluation_batch_from_dispatch_claim"(
  TEXT,TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "advance_outcome_current_private_evaluation_batch_from_dispatch_claim"(
  TEXT,TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT
) TO afl_trade_private_evaluation_coordinator;

DO $membership$ BEGIN
  EXECUTE format(
    'REVOKE afl_trade_private_evaluation_batch_head_owner FROM %I',
    session_user
  );
END $membership$;
