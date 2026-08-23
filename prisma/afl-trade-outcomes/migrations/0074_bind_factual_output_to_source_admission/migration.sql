-- Bind every retained factual output to the exact automated source admission that enabled it.

DO $roles$ BEGIN
  EXECUTE format('GRANT afl_trade_private_valuation_scheduler_owner TO %I', session_user);
END $roles$;

SET ROLE afl_trade_private_valuation_scheduler_owner;

ALTER TABLE "outcome_private_valuation_factual_output"
  ADD COLUMN "source_admission_id" TEXT NOT NULL UNIQUE
    REFERENCES "outcome_private_valuation_source_admission"("admission_id") ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION "validate_outcome_private_valuation_factual_output"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  parent RECORD;
  actual_batches JSONB;
  expected_output_id TEXT;
BEGIN
  SELECT
    request."scope_key",binding."normalization_run_id" AS "bound_normalization_run_id",
    binding."source_capture_id",admission."admission_id",
    admission."normalization_run_id" AS "admitted_normalization_run_id",
    admission."fact_batch_id" AS "admitted_fact_batch_id",
    admission."factual_run_id" AS "admitted_factual_run_id",
    fact_batch."normalization_run_id" AS "batch_normalization_run_id",
    fact_batch."capture_id" AS "batch_capture_id",fact_batch."fact_batch_sha256",
    fact_batch."status" AS "fact_batch_status",fact_batch."finalized_at" AS "fact_batch_finalized_at",
    factual_run."run_sha256",factual_run."output_set_sha256",
    factual_run."status" AS "factual_run_status",factual_run."finalized_at" AS "factual_run_finalized_at",
    candidate."candidate_sha256",candidate."member_set_sha256",
    candidate."target_release_id",candidate."scope_key" AS "candidate_scope_key",
    candidate."environment"::TEXT AS "candidate_environment",
    candidate."status" AS "candidate_status",candidate."finalized_at" AS "candidate_finalized_at",
    release."scope_key" AS "release_scope_key",release."environment" AS "release_environment"
  INTO parent
  FROM "outcome_private_valuation_dispatch_request" request
  JOIN "outcome_private_valuation_capture_binding" binding
    ON binding."request_id"=request."request_id"
  JOIN "outcome_private_valuation_source_admission" admission
    ON admission."request_id"=request."request_id"
   AND admission."capture_binding_id"=binding."binding_id"
   AND admission."source_capture_id"=binding."source_capture_id"
  JOIN "outcome_provider_fact_batch" fact_batch
    ON fact_batch."fact_batch_id"=admission."fact_batch_id"
  JOIN "outcome_factual_reconciliation_run" factual_run
    ON factual_run."factual_run_id"=admission."factual_run_id"
  JOIN "outcome_factual_release_candidate" candidate
    ON candidate."candidate_id"=NEW."candidate_id"
  JOIN "outcome_release_manifest" release
    ON release."release_id"=NEW."factual_release_id"
  WHERE request."request_id"=NEW."request_id"
    AND binding."binding_id"=NEW."capture_binding_id"
    AND admission."admission_id"=NEW."source_admission_id";

  IF NOT FOUND
    OR parent."bound_normalization_run_id" IS DISTINCT FROM NEW."normalization_run_id"
    OR parent."admitted_normalization_run_id" IS DISTINCT FROM NEW."normalization_run_id"
    OR parent."admitted_fact_batch_id" IS DISTINCT FROM NEW."fact_batch_id"
    OR parent."admitted_factual_run_id" IS DISTINCT FROM NEW."factual_run_id"
    OR parent."batch_normalization_run_id" IS DISTINCT FROM NEW."normalization_run_id"
    OR parent."batch_capture_id" IS DISTINCT FROM parent."source_capture_id"
    OR parent."fact_batch_status" IS DISTINCT FROM 'approved'
    OR parent."fact_batch_finalized_at" IS NULL
    OR parent."factual_run_status" IS DISTINCT FROM 'approved'
    OR parent."factual_run_finalized_at" IS NULL
    OR parent."candidate_status" IS DISTINCT FROM 'approved'
    OR parent."candidate_finalized_at" IS NULL
    OR parent."target_release_id" IS DISTINCT FROM NEW."factual_release_id"
    OR parent."scope_key" IS DISTINCT FROM parent."candidate_scope_key"
    OR parent."scope_key" IS DISTINCT FROM parent."release_scope_key"
    OR parent."candidate_environment" IS DISTINCT FROM 'non_production'
    OR parent."release_environment" IS DISTINCT FROM 'non_production'
    OR EXISTS (
      SELECT 1 FROM "outcome_registry_event" event
       WHERE event."release_id"=NEW."factual_release_id")
    OR NOT EXISTS (
      SELECT 1 FROM "outcome_release_source_capture" member
       WHERE member."release_id"=NEW."factual_release_id"
         AND member."capture_id"=parent."source_capture_id")
    OR NOT EXISTS (
      SELECT 1 FROM "outcome_release_factual_run_member" member
       WHERE member."candidate_id"=NEW."candidate_id"
         AND member."factual_run_id"=NEW."factual_run_id")
    OR NOT EXISTS (
      SELECT 1 FROM "outcome_factual_reconciliation_metric_input" input
      JOIN "outcome_provider_numeric_metric_fact" fact
        ON fact."metric_fact_id"=input."metric_fact_id"
       WHERE input."factual_run_id"=NEW."factual_run_id"
         AND fact."fact_batch_id"=NEW."fact_batch_id")
  THEN
    RAISE EXCEPTION 'Private valuation factual output parent custody is invalid';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('batchId',batch."batch_id",'batchSha256',batch."batch_sha256")
    ORDER BY batch."batch_id"),'[]'::jsonb)
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
       AND EXISTS (
         SELECT 1 FROM "outcome_acquisition_spell_metric_version_member" metric_member
          WHERE metric_member."spell_metric_version_id"=metric_version."spell_metric_version_id"
            AND metric_member."factual_run_id"=NEW."factual_run_id")
       AND NOT EXISTS (
         SELECT 1
           FROM "outcome_release_spell_metric_member" sibling_member
           JOIN "outcome_acquisition_spell_metric_version" sibling_version
             ON sibling_version."spell_metric_version_id"=sibling_member."spell_metric_version_id"
          WHERE sibling_member."candidate_id"=member."candidate_id"
            AND sibling_version."batch_id"=metric_batch."batch_id"
            AND EXISTS (
              SELECT 1
                FROM "outcome_acquisition_spell_metric_version_member" foreign_member
               WHERE foreign_member."spell_metric_version_id"=sibling_version."spell_metric_version_id"
                 AND foreign_member."factual_run_id"<>NEW."factual_run_id"))
  ) batch;

  IF jsonb_array_length(actual_batches)=0
    OR NEW."prepared_at"<parent."factual_run_finalized_at"
    OR (SELECT count(*) FROM jsonb_object_keys(NEW."output_json"))<>2
    OR (SELECT count(*) FROM jsonb_object_keys(NEW."output_json"->'content'))<>16
    OR NEW."output_json"->>'outputId' IS DISTINCT FROM NEW."output_id"
    OR NEW."output_json"->'content'->>'schemaVersion'
      IS DISTINCT FROM 'afl-trade-private-valuation-factual-output/v1'
    OR NEW."output_json"->'content'->>'requestId' IS DISTINCT FROM NEW."request_id"
    OR NEW."output_json"->'content'->>'valuationScopeKey' IS DISTINCT FROM parent."scope_key"
    OR NEW."output_json"->'content'->>'captureBindingId' IS DISTINCT FROM NEW."capture_binding_id"
    OR NEW."output_json"->'content'->>'sourceAdmissionId' IS DISTINCT FROM NEW."source_admission_id"
    OR NEW."output_json"->'content'->>'normalizationRunId' IS DISTINCT FROM NEW."normalization_run_id"
    OR NEW."output_json"->'content'->'factBatch' IS DISTINCT FROM jsonb_build_object(
      'batchId',NEW."fact_batch_id",'batchSha256',parent."fact_batch_sha256")
    OR NEW."output_json"->'content'->'reconciliation' IS DISTINCT FROM jsonb_build_object(
      'factualRunId',NEW."factual_run_id",'runSha256',parent."run_sha256",
      'outputSetSha256',parent."output_set_sha256",
      'finalizedAt',to_char(parent."factual_run_finalized_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
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
    OR jsonb_typeof(NEW."output_json"->'content'->'publicationEligible') IS DISTINCT FROM 'boolean'
    OR NEW."output_json"->'content'->'publicationEligible' IS DISTINCT FROM 'false'::jsonb
    OR jsonb_typeof(NEW."output_json"->'content'->'publicationProhibited') IS DISTINCT FROM 'boolean'
    OR NEW."output_json"->'content'->'publicationProhibited' IS DISTINCT FROM 'true'::jsonb
    OR NEW."output_json"->'content'->>'limitation' IS DISTINCT FROM
      'Retained non-production factual preparation custody only; it grants no model-training, private-evaluation, publication, or production authority.'
  THEN
    RAISE EXCEPTION 'Private valuation factual output content is invalid';
  END IF;

  expected_output_id:='private-valuation-factual-output:'||encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(NEW."output_json"->'content'),'UTF8')),'hex');
  IF NEW."output_id" IS DISTINCT FROM expected_output_id THEN
    RAISE EXCEPTION 'Private valuation factual output content address is invalid';
  END IF;
  RETURN NEW;
END $$;

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
  batch JSONB;
  batch_ordinal INTEGER:=0;
BEGIN
  IF target_request_id !~ '^private-valuation-dispatch:[a-f0-9]{64}$'
    OR target_claim_id !~ '^private-valuation-dispatch-claim:[a-f0-9]{64}$'
    OR target_lease_token_sha256 !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(target_output) IS DISTINCT FROM 'object'
  THEN
    RAISE EXCEPTION 'Private valuation factual output retention is malformed';
  END IF;
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
  THEN
    RAISE EXCEPTION 'Private valuation factual output lost its live dispatch claim fence';
  END IF;
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
  IF dispatch_authority."lease_expires_at"<trusted_at
    OR dispatch_authority."attempt_expiry"<trusted_at
    OR dispatch_authority."finished_at" IS NOT NULL
  THEN
    RAISE EXCEPTION 'Private valuation factual output lost its live dispatch claim fence';
  END IF;
  output_content:=target_output->'content';
  IF output_content->>'requestId' IS DISTINCT FROM target_request_id
    OR (output_content->>'preparedAt')::timestamptz>trusted_at
  THEN
    RAISE EXCEPTION 'Private valuation factual output does not match its dispatch or trusted chronology';
  END IF;
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
    (output_content->>'preparedAt')::timestamptz,target_output
  );
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
    'ALTER FUNCTION %I.retain_outcome_private_valuation_factual_output(TEXT,TEXT,TEXT,JSONB) SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema());
END $paths$;

RESET ROLE;

DO $membership$ BEGIN
  EXECUTE format('REVOKE afl_trade_private_valuation_scheduler_owner FROM %I', session_user);
END $membership$;
