-- Retain multi-capture admitted-player factual custody without inventing a legacy factual run.

DO $roles$ BEGIN
  EXECUTE format('GRANT afl_trade_private_valuation_scheduler_owner TO %I', session_user);
END $roles$;

GRANT REFERENCES ON "outcome_valuation_dataset_candidate"
  TO afl_trade_private_valuation_scheduler_owner;
GRANT REFERENCES ON "outcome_valuation_dataset_admission"
  TO afl_trade_private_valuation_scheduler_owner;
GRANT SELECT ON "outcome_valuation_dataset_candidate", "outcome_valuation_dataset_admission"
  TO afl_trade_private_valuation_scheduler_owner;
GRANT SELECT ON
  "outcome_factual_release_candidate",
  "outcome_release_manifest",
  "outcome_record_state_commitment",
  "outcome_active_release",
  "outcome_release_spell_metric_member",
  "outcome_acquisition_spell_metric_version",
  "outcome_acquisition_spell_metric_batch"
  TO afl_trade_private_valuation_scheduler_owner;
GRANT SELECT ON "outcome_valuation_dataset_operation_authority"
  TO afl_trade_private_evaluation_coordinator;

SET ROLE afl_trade_private_valuation_scheduler_owner;

ALTER TABLE "outcome_private_valuation_factual_output"
  ALTER COLUMN "capture_binding_id" DROP NOT NULL,
  ALTER COLUMN "source_admission_id" DROP NOT NULL,
  ALTER COLUMN "normalization_run_id" DROP NOT NULL,
  ALTER COLUMN "fact_batch_id" DROP NOT NULL,
  ALTER COLUMN "factual_run_id" DROP NOT NULL,
  ADD COLUMN "player_dataset_id" TEXT,
  ADD COLUMN "player_dataset_admission_id" TEXT,
  ADD CONSTRAINT "outcome_private_valuation_factual_output_player_dataset_fkey"
    FOREIGN KEY ("player_dataset_id")
    REFERENCES "outcome_valuation_dataset_candidate"("dataset_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_private_valuation_factual_output_player_admission_fkey"
    FOREIGN KEY ("player_dataset_admission_id")
    REFERENCES "outcome_valuation_dataset_admission"("admission_id") ON DELETE RESTRICT;

ALTER TABLE "outcome_private_valuation_factual_output"
  DROP CONSTRAINT "outcome_private_valuation_factual_output_candidate_id_key",
  DROP CONSTRAINT "outcome_private_valuation_factual_output_factual_release_id_key";

CREATE UNIQUE INDEX "outcome_private_factual_output_v1_candidate_key"
  ON "outcome_private_valuation_factual_output"("candidate_id")
  WHERE "output_json"->'content'->>'schemaVersion' =
    'afl-trade-private-valuation-factual-output/v1';
CREATE UNIQUE INDEX "outcome_private_factual_output_v1_release_key"
  ON "outcome_private_valuation_factual_output"("factual_release_id")
  WHERE "output_json"->'content'->>'schemaVersion' =
    'afl-trade-private-valuation-factual-output/v1';
CREATE INDEX "outcome_private_factual_output_candidate_idx"
  ON "outcome_private_valuation_factual_output"("candidate_id");
CREATE INDEX "outcome_private_factual_output_release_idx"
  ON "outcome_private_valuation_factual_output"("factual_release_id");

ALTER TABLE "outcome_private_valuation_factual_output"
  DROP CONSTRAINT "outcome_private_valuation_factual_output_parent_ids_check",
  ADD CONSTRAINT "outcome_private_valuation_factual_output_parent_ids_check" CHECK (
    "candidate_id" ~ '^factual-release-candidate:[a-f0-9]{64}$'
    AND "factual_release_id" ~ '^outcome-release:[a-f0-9]{64}$'
    AND (
      (
        "capture_binding_id" IS NOT NULL
        AND "source_admission_id" IS NOT NULL
        AND "normalization_run_id" ~ '^provider-normalization-run:[a-f0-9]{64}$'
        AND "fact_batch_id" ~ '^source-fact-batch:[a-f0-9]{64}$'
        AND "factual_run_id" ~ '^factual-reconciliation-run:[a-f0-9]{64}$'
        AND "player_dataset_id" IS NULL
        AND "player_dataset_admission_id" IS NULL
      ) OR (
        "capture_binding_id" IS NULL
        AND "source_admission_id" IS NULL
        AND "normalization_run_id" IS NULL
        AND "fact_batch_id" IS NULL
        AND "factual_run_id" IS NULL
        AND "player_dataset_id" ~ '^dataset:[a-f0-9]{64}$'
        AND "player_dataset_admission_id" ~ '^dataset-admission:[a-f0-9]{64}$'
      )
    )
  ),
  ADD CONSTRAINT "outcome_private_valuation_factual_output_schema_check" CHECK (
    "output_json"->'content'->>'schemaVersion' IN (
      'afl-trade-private-valuation-factual-output/v1',
      'afl-trade-private-valuation-factual-output/v2'
    )
  );

DROP TRIGGER "validate_outcome_private_valuation_factual_output_trigger"
  ON "outcome_private_valuation_factual_output";

CREATE TRIGGER "validate_outcome_private_valuation_factual_output_v1_trigger"
BEFORE INSERT ON "outcome_private_valuation_factual_output"
FOR EACH ROW
WHEN ((NEW."output_json"->'content'->>'schemaVersion') =
  'afl-trade-private-valuation-factual-output/v1')
EXECUTE FUNCTION "validate_outcome_private_valuation_factual_output"();

CREATE OR REPLACE FUNCTION "validate_outcome_admitted_player_factual_output"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  parent RECORD;
  state_row RECORD;
  active_row RECORD;
  actual_sources JSONB;
  actual_batches JSONB;
  expected_output_id TEXT;
BEGIN
  SELECT request."scope_key",dataset."status" AS "dataset_status",
         dataset."finalized_at" AS "dataset_finalized_at",dataset."dataset_json",
         admission."status" AS "admission_status",
         admission."finalized_at" AS "admission_finalized_at",admission."admitted_at",
         admission."admission_json",candidate."candidate_sha256",
         candidate."member_set_sha256",candidate."target_release_id",
         candidate."scope_key" AS "candidate_scope_key",
         candidate."environment"::TEXT AS "candidate_environment",
         candidate."status" AS "candidate_status",
         candidate."finalized_at" AS "candidate_finalized_at",
         release."scope_key" AS "release_scope_key",release."environment" AS "release_environment"
    INTO parent
    FROM "outcome_private_valuation_dispatch_request" request
    JOIN "outcome_valuation_dataset_candidate" dataset
      ON dataset."dataset_id"=NEW."player_dataset_id"
    JOIN "outcome_valuation_dataset_admission" admission
      ON admission."admission_id"=NEW."player_dataset_admission_id"
     AND admission."dataset_id"=dataset."dataset_id"
    JOIN "outcome_factual_release_candidate" candidate
      ON candidate."candidate_id"=NEW."candidate_id"
    JOIN "outcome_release_manifest" release
      ON release."release_id"=NEW."factual_release_id"
   WHERE request."request_id"=NEW."request_id";

  SELECT commitment."record_state_json"->>'state' AS "state"
    INTO state_row
    FROM "outcome_record_state_commitment" commitment
   WHERE commitment."release_id"=NEW."factual_release_id"
   ORDER BY commitment."event_revision" DESC LIMIT 1;

  SELECT active."activated_at"
    INTO active_row
    FROM "outcome_active_release" active
   WHERE active."release_id"=NEW."factual_release_id";

  IF parent."dataset_status" IS DISTINCT FROM 'finalized'
    OR parent."dataset_finalized_at" IS NULL
    OR parent."admission_status" IS DISTINCT FROM 'finalized'
    OR parent."admission_finalized_at" IS NULL
    OR parent."candidate_status" IS DISTINCT FROM 'approved'
    OR parent."candidate_finalized_at" IS NULL
    OR parent."target_release_id" IS DISTINCT FROM NEW."factual_release_id"
    OR parent."scope_key" IS DISTINCT FROM parent."candidate_scope_key"
    OR parent."scope_key" IS DISTINCT FROM parent."release_scope_key"
    OR parent."candidate_environment" IS DISTINCT FROM 'non_production'
    OR parent."release_environment" IS DISTINCT FROM 'non_production'
    OR parent."dataset_json"->'content'->'factualParent'->>'factualCandidateId'
      IS DISTINCT FROM NEW."candidate_id"
    OR parent."dataset_json"->'content'->'factualParent'->>'factualReleaseId'
      IS DISTINCT FROM NEW."factual_release_id"
    OR parent."dataset_json"->'content'->'factualParent'->>'sourceMemberSetSha256'
      IS DISTINCT FROM parent."member_set_sha256"
    OR parent."admission_json"->'content'->>'factualCandidateId'
      IS DISTINCT FROM NEW."candidate_id"
    OR parent."admission_json"->'content'->>'factualReleaseId'
      IS DISTINCT FROM NEW."factual_release_id"
    OR parent."admission_json"->'content'->>'sourceMemberSetSha256'
      IS DISTINCT FROM parent."member_set_sha256"
    OR state_row."state" IS DISTINCT FROM 'approved'
    OR active_row."activated_at" IS NOT NULL
  THEN
    RAISE EXCEPTION 'Admitted-player factual output parent custody is invalid';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'captureId',source.value->>'captureId',
      'sourceSnapshotId',source.value->>'sourceSnapshotId',
      'consumedFieldSetId',source.value->>'consumedFieldSetId',
      'consumedFieldSetSha256',source.value->>'consumedFieldSetSha256'
    ) ORDER BY source.value->>'captureId'),'[]'::JSONB)
    INTO actual_sources
    FROM jsonb_array_elements(
      parent."admission_json"->'content'->'sourceRightsEvaluations'
    ) source(value);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'batchId',batch."batch_id",'batchSha256',batch."batch_sha256"
    ) ORDER BY batch."batch_id"),'[]'::JSONB)
    INTO actual_batches
    FROM (
      SELECT DISTINCT metric_batch."batch_id",metric_batch."batch_sha256"
        FROM "outcome_release_spell_metric_member" member
        JOIN "outcome_acquisition_spell_metric_version" metric_version
          ON metric_version."spell_metric_version_id"=member."spell_metric_version_id"
        JOIN "outcome_acquisition_spell_metric_batch" metric_batch
          ON metric_batch."batch_id"=metric_version."batch_id"
       WHERE member."candidate_id"=NEW."candidate_id"
         AND metric_batch."status"='approved'
         AND metric_batch."finalized_at" IS NOT NULL
    ) batch;

  IF jsonb_array_length(actual_sources)=0
    OR jsonb_array_length(actual_batches)=0
    OR NEW."capture_binding_id" IS NOT NULL
    OR NEW."source_admission_id" IS NOT NULL
    OR NEW."normalization_run_id" IS NOT NULL
    OR NEW."fact_batch_id" IS NOT NULL
    OR NEW."factual_run_id" IS NOT NULL
    OR NEW."prepared_at"<parent."admitted_at"
    OR (SELECT count(*) FROM jsonb_object_keys(NEW."output_json"))<>2
    OR (SELECT count(*) FROM jsonb_object_keys(NEW."output_json"->'content'))<>13
    OR NEW."output_json"->>'outputId' IS DISTINCT FROM NEW."output_id"
    OR NEW."output_json"->'content'->>'schemaVersion'
      IS DISTINCT FROM 'afl-trade-private-valuation-factual-output/v2'
    OR NEW."output_json"->'content'->>'requestId' IS DISTINCT FROM NEW."request_id"
    OR NEW."output_json"->'content'->>'valuationScopeKey' IS DISTINCT FROM parent."scope_key"
    OR NEW."output_json"->'content'->'admittedPlayerDataset' IS DISTINCT FROM jsonb_build_object(
      'datasetId',NEW."player_dataset_id",'admissionId',NEW."player_dataset_admission_id")
    OR NEW."output_json"->'content'->'sourceCaptures' IS DISTINCT FROM actual_sources
    OR NEW."output_json"->'content'->'spellMetricBatches' IS DISTINCT FROM actual_batches
    OR NEW."output_json"->'content'->'candidate' IS DISTINCT FROM jsonb_build_object(
      'candidateId',NEW."candidate_id",'candidateSha256',parent."candidate_sha256",
      'memberSetSha256',parent."member_set_sha256")
    OR NEW."output_json"->'content'->'factualRelease' IS DISTINCT FROM jsonb_build_object(
      'releaseId',NEW."factual_release_id",
      'releaseSha256',substring(NEW."factual_release_id" from length('outcome-release:')+1))
    OR NEW."output_json"->'content'->>'preparedAt' IS DISTINCT FROM
      to_char(NEW."prepared_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    OR NEW."output_json"->'content'->>'environment' IS DISTINCT FROM 'non_production'
    OR NEW."output_json"->'content'->'publicationEligible' IS DISTINCT FROM 'false'::JSONB
    OR NEW."output_json"->'content'->'publicationProhibited' IS DISTINCT FROM 'true'::JSONB
    OR NEW."output_json"->'content'->>'limitation' IS DISTINCT FROM
      'Retained non-production factual preparation custody only; it grants no model-training, private-evaluation, publication, or production authority.'
  THEN
    RAISE EXCEPTION 'Admitted-player factual output content is invalid';
  END IF;

  expected_output_id:='private-valuation-factual-output:'||encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(NEW."output_json"->'content'),'UTF8')),'hex');
  IF NEW."output_id" IS DISTINCT FROM expected_output_id THEN
    RAISE EXCEPTION 'Admitted-player factual output content address is invalid';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "validate_outcome_private_valuation_factual_output_v2_trigger"
BEFORE INSERT ON "outcome_private_valuation_factual_output"
FOR EACH ROW
WHEN ((NEW."output_json"->'content'->>'schemaVersion') =
  'afl-trade-private-valuation-factual-output/v2')
EXECUTE FUNCTION "validate_outcome_admitted_player_factual_output"();

-- A source-rights proposal may authorize several exact captures. Count proposal identities,
-- not capture-level admission evaluations, when issuing one model-run authorization.
RESET ROLE;

DO $patch_model_run_multi_capture_rights$
DECLARE
  current_definition TEXT;
  updated_definition TEXT;
  old_current_count TEXT := $old$  SELECT count(*) INTO current_receipt_count$old$;
  new_current_count TEXT := $new$  SELECT count(DISTINCT requested."receipt_id")
    INTO current_receipt_count$new$;
  old_required_count TEXT := $old$  SELECT jsonb_array_length(
    admission_row."admission_json"->'content'->'sourceRightsEvaluations'
  ) INTO required_proposal_count;$old$;
  new_required_count TEXT := $new$  SELECT count(DISTINCT required."evaluation"->>'proposalId')
    INTO required_proposal_count
    FROM jsonb_array_elements(
      admission_row."admission_json"->'content'->'sourceRightsEvaluations'
    ) required("evaluation");$new$;
  old_covered_count TEXT := $old$  SELECT count(*) INTO covered_proposal_count
    FROM jsonb_array_elements(
      admission_row."admission_json"->'content'->'sourceRightsEvaluations'
    ) required("evaluation")$old$;
  new_covered_count TEXT := $new$  SELECT count(DISTINCT required."evaluation"->>'proposalId')
    INTO covered_proposal_count
    FROM jsonb_array_elements(
      admission_row."admission_json"->'content'->'sourceRightsEvaluations'
    ) required("evaluation")$new$;
BEGIN
  SELECT pg_get_functiondef(
    'validate_outcome_valuation_model_authorization_insert()'::regprocedure
  ) INTO current_definition;
  updated_definition:=replace(current_definition,old_current_count,new_current_count);
  IF updated_definition=current_definition THEN
    RAISE EXCEPTION 'Expected model-run current receipt count was not found';
  END IF;
  current_definition:=updated_definition;
  updated_definition:=replace(current_definition,old_required_count,new_required_count);
  IF updated_definition=current_definition THEN
    RAISE EXCEPTION 'Expected model-run required proposal count was not found';
  END IF;
  current_definition:=updated_definition;
  updated_definition:=replace(current_definition,old_covered_count,new_covered_count);
  IF updated_definition=current_definition THEN
    RAISE EXCEPTION 'Expected model-run covered proposal count was not found';
  END IF;
  EXECUTE updated_definition;
END
$patch_model_run_multi_capture_rights$;

SET ROLE afl_trade_private_valuation_scheduler_owner;

CREATE OR REPLACE FUNCTION "validate_outcome_private_valuation_model_request_binding"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE request RECORD; attempt RECORD; operation RECORD; factual RECORD; calculation RECORD;
BEGIN
  SELECT * INTO request FROM "outcome_private_valuation_dispatch_request"
   WHERE "request_id"=NEW."request_id";
  SELECT * INTO attempt FROM "outcome_private_valuation_dispatch_attempt"
   WHERE "claim_id"=NEW."claim_id";
  SELECT * INTO operation FROM "outcome_private_valuation_model_operation"
   WHERE "operation_id"=NEW."operation_id";
  SELECT * INTO factual FROM "outcome_private_valuation_factual_output"
   WHERE "output_id"=NEW."factual_output_id";
  SELECT * INTO calculation FROM "outcome_hpn_pav_calculation"
   WHERE "calculation_id"=NEW."hpn_calculation_id";
  IF current_user<>'afl_trade_private_evaluation_coordinator'
    OR request."status"<>'claimed' OR request."claim_id"<>NEW."claim_id"
    OR request."lease_expires_at"<clock_timestamp()
    OR attempt."request_id"<>NEW."request_id" OR attempt."finished_at" IS NOT NULL
    OR attempt."attempt_number"<>NEW."attempt_number"
    OR operation."operation_id" IS NULL OR operation."scope_key"<>request."scope_key"
    OR factual."output_id" IS NULL OR factual."request_id"<>NEW."request_id"
    OR operation."factual_values_sha256"<>
      factual."output_json"->'content'->'candidate'->>'memberSetSha256'
    OR calculation."status"<>'finalized' OR calculation."finalized_at" IS NULL
    OR operation."hpn_method_id"<>calculation."method_id"
    OR operation."hpn_values_sha256"<>
      "outcome_private_valuation_hpn_substantive_sha256"(calculation."calculation_json")
    OR (
      factual."output_json"->'content'->>'schemaVersion'=
        'afl-trade-private-valuation-factual-output/v1'
      AND calculation."calculation_json"->'content'->>'factualRunId'<>
        factual."factual_run_id"
    )
    OR (
      factual."output_json"->'content'->>'schemaVersion'=
        'afl-trade-private-valuation-factual-output/v2'
      AND (
        operation."player_dataset_id"<>factual."player_dataset_id"
        OR operation."player_dataset_admission_id"<>factual."player_dataset_admission_id"
      )
    )
  THEN RAISE EXCEPTION 'Private valuation model input lacks exact live dispatch custody'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION "enqueue_outcome_admitted_player_dispatch"(
  target_dataset_id TEXT,
  target_admission_id TEXT,
  target_operation_key TEXT
) RETURNS TABLE(request_id TEXT,request_json JSONB)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  authority RECORD;
  scheduled_at TIMESTAMPTZ(3);
  expected_id TEXT;
BEGIN
  IF target_dataset_id !~ '^dataset:[a-f0-9]{64}$'
    OR target_admission_id !~ '^dataset-admission:[a-f0-9]{64}$'
    OR target_operation_key IS DISTINCT FROM btrim(target_operation_key)
    OR length(target_operation_key) NOT BETWEEN 1 AND 400
  THEN RAISE EXCEPTION 'Admitted-player dispatch authority is malformed'; END IF;

  SELECT dataset."scope_key",dataset."environment"::TEXT AS "dataset_environment",
         dataset."status" AS "dataset_status",dataset."finalized_at" AS "dataset_finalized_at",
         admission."environment"::TEXT AS "admission_environment",
         admission."status" AS "admission_status",
         admission."finalized_at" AS "admission_finalized_at"
    INTO authority
    FROM "outcome_valuation_dataset_candidate" dataset
    JOIN "outcome_valuation_dataset_admission" admission
      ON admission."dataset_id"=dataset."dataset_id"
     AND admission."admission_id"=target_admission_id
   WHERE dataset."dataset_id"=target_dataset_id;
  IF authority."dataset_environment" IS DISTINCT FROM 'non_production'
    OR authority."admission_environment" IS DISTINCT FROM 'non_production'
    OR authority."dataset_status" IS DISTINCT FROM 'finalized'
    OR authority."dataset_finalized_at" IS NULL
    OR authority."admission_status" IS DISTINCT FROM 'finalized'
    OR authority."admission_finalized_at" IS NULL
  THEN RAISE EXCEPTION 'Admitted-player dispatch lacks one exact finalized dataset'; END IF;

  scheduled_at:=date_trunc('milliseconds',clock_timestamp());
  expected_id:="create_outcome_private_valuation_dispatch_id"(
    authority."scope_key",'ad_hoc',scheduled_at,target_operation_key);
  INSERT INTO "outcome_private_valuation_dispatch_request"(
    "request_id","scope_key","trigger_kind","scheduled_for","authority_key",
    "status","available_at","request_json"
  ) VALUES (
    expected_id,authority."scope_key",'ad_hoc',scheduled_at,target_operation_key,
    'pending',scheduled_at,jsonb_build_object(
      'requestId',expected_id,'scopeKey',authority."scope_key",'trigger','ad_hoc',
      'scheduledFor',to_char(scheduled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'authorityKey',target_operation_key)
  ) ON CONFLICT DO NOTHING;

  RETURN QUERY
  SELECT request."request_id",request."request_json"
    FROM "outcome_private_valuation_dispatch_request" request
   WHERE request."scope_key"=authority."scope_key"
     AND request."trigger_kind"='ad_hoc'
     AND request."authority_key"=target_operation_key;
END $$;

REVOKE ALL ON FUNCTION "enqueue_outcome_admitted_player_dispatch"(TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "enqueue_outcome_admitted_player_dispatch"(TEXT,TEXT,TEXT)
  TO afl_trade_private_evaluation_coordinator;

CREATE OR REPLACE FUNCTION "retain_outcome_private_valuation_factual_output"(
  target_request_id TEXT,
  target_claim_id TEXT,
  target_lease_token_sha256 TEXT,
  target_output JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  dispatch_authority RECORD;
  retained RECORD;
  trusted_at TIMESTAMPTZ(3);
  output_content JSONB;
  schema_version TEXT;
  batch JSONB;
  batch_ordinal INTEGER:=0;
BEGIN
  IF target_request_id !~ '^private-valuation-dispatch:[a-f0-9]{64}$'
    OR target_claim_id !~ '^private-valuation-dispatch-claim:[a-f0-9]{64}$'
    OR target_lease_token_sha256 !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(target_output) IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION 'Private valuation factual output retention is malformed'; END IF;

  SELECT request."request_id",request."claim_id",request."claim_sequence",
         request."lease_token_sha256",request."lease_expires_at",
         attempt."attempt_sequence",attempt."lease_token_sha256" AS "attempt_token",
         attempt."lease_expires_at" AS "attempt_expiry",attempt."finished_at"
    INTO dispatch_authority
    FROM "outcome_private_valuation_dispatch_request" request
    JOIN "outcome_private_valuation_dispatch_attempt" attempt
      ON attempt."request_id"=request."request_id" AND attempt."claim_id"=target_claim_id
   WHERE request."request_id"=target_request_id AND request."claim_id"=target_claim_id
   FOR UPDATE OF request,attempt;
  trusted_at:=date_trunc('milliseconds',clock_timestamp());
  IF NOT FOUND
    OR dispatch_authority."claim_sequence" IS DISTINCT FROM dispatch_authority."attempt_sequence"
    OR dispatch_authority."lease_token_sha256" IS DISTINCT FROM target_lease_token_sha256
    OR dispatch_authority."attempt_token" IS DISTINCT FROM target_lease_token_sha256
    OR dispatch_authority."lease_expires_at"<trusted_at
    OR dispatch_authority."attempt_expiry"<trusted_at
    OR dispatch_authority."finished_at" IS NOT NULL
  THEN RAISE EXCEPTION 'Private valuation factual output lost its live dispatch claim fence'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-private-valuation-factual-output:'||target_request_id,0));
  SELECT * INTO retained FROM "outcome_private_valuation_factual_output"
   WHERE "request_id"=target_request_id FOR SHARE;
  IF FOUND THEN
    IF retained."output_json" IS DISTINCT FROM target_output THEN
      RAISE EXCEPTION 'Private valuation dispatch already retained different factual output';
    END IF;
    RETURN retained."output_json";
  END IF;

  trusted_at:=date_trunc('milliseconds',clock_timestamp());
  output_content:=target_output->'content';
  schema_version:=output_content->>'schemaVersion';
  IF dispatch_authority."lease_expires_at"<trusted_at
    OR dispatch_authority."attempt_expiry"<trusted_at
    OR dispatch_authority."finished_at" IS NOT NULL
    OR output_content->>'requestId' IS DISTINCT FROM target_request_id
    OR (output_content->>'preparedAt')::TIMESTAMPTZ>trusted_at
  THEN RAISE EXCEPTION 'Private valuation factual output lost its live dispatch claim fence'; END IF;

  IF schema_version='afl-trade-private-valuation-factual-output/v1' THEN
    INSERT INTO "outcome_private_valuation_factual_output"(
      "output_id","request_id","capture_binding_id","source_admission_id",
      "normalization_run_id","fact_batch_id","factual_run_id","candidate_id",
      "factual_release_id","prepared_at","output_json"
    ) VALUES (
      target_output->>'outputId',target_request_id,output_content->>'captureBindingId',
      output_content->>'sourceAdmissionId',output_content->>'normalizationRunId',
      output_content->'factBatch'->>'batchId',
      output_content->'reconciliation'->>'factualRunId',
      output_content->'candidate'->>'candidateId',
      output_content->'factualRelease'->>'releaseId',
      (output_content->>'preparedAt')::TIMESTAMPTZ,target_output
    );
  ELSIF schema_version='afl-trade-private-valuation-factual-output/v2' THEN
    INSERT INTO "outcome_private_valuation_factual_output"(
      "output_id","request_id","candidate_id","factual_release_id","prepared_at",
      "player_dataset_id","player_dataset_admission_id","output_json"
    ) VALUES (
      target_output->>'outputId',target_request_id,
      output_content->'candidate'->>'candidateId',
      output_content->'factualRelease'->>'releaseId',
      (output_content->>'preparedAt')::TIMESTAMPTZ,
      output_content->'admittedPlayerDataset'->>'datasetId',
      output_content->'admittedPlayerDataset'->>'admissionId',target_output
    );
  ELSE
    RAISE EXCEPTION 'Private valuation factual output schema is unsupported';
  END IF;

  FOR batch IN SELECT value FROM jsonb_array_elements(output_content->'spellMetricBatches') LOOP
    batch_ordinal:=batch_ordinal+1;
    INSERT INTO "outcome_private_valuation_factual_output_spell_batch"(
      "output_id","batch_id","ordinal")
    VALUES (target_output->>'outputId',batch->>'batchId',batch_ordinal);
  END LOOP;
  RETURN target_output;
END $$;

DO $paths$ BEGIN
  EXECUTE format(
    'ALTER FUNCTION %I.enqueue_outcome_admitted_player_dispatch(TEXT,TEXT,TEXT) SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema());
  EXECUTE format(
    'ALTER FUNCTION %I.retain_outcome_private_valuation_factual_output(TEXT,TEXT,TEXT,JSONB) SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema());
END $paths$;

RESET ROLE;

REVOKE REFERENCES ON "outcome_valuation_dataset_candidate"
  FROM afl_trade_private_valuation_scheduler_owner;
REVOKE REFERENCES ON "outcome_valuation_dataset_admission"
  FROM afl_trade_private_valuation_scheduler_owner;

DO $membership$ BEGIN
  EXECUTE format('REVOKE afl_trade_private_valuation_scheduler_owner FROM %I', session_user);
END $membership$;
