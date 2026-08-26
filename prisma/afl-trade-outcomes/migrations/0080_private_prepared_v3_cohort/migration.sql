-- Admit exact dispatch-bound private prepared-v3 authority without weakening the retained public
-- factual-release branch. Private authority remains non-production and publication-prohibited.

ALTER TABLE "outcome_prepared_valuation_input_set"
  ALTER COLUMN "qualification_report_id" DROP NOT NULL;

ALTER TABLE "outcome_current_valuation_cohort_operation"
  ALTER COLUMN "factual_release_revision" DROP NOT NULL,
  ADD COLUMN "preparation_authority" TEXT NOT NULL
    DEFAULT 'authenticated_calculation_evidence_snapshot',
  ADD COLUMN "dispatch_request_id" TEXT,
  ADD COLUMN "factual_output_id" TEXT,
  ADD COLUMN "hpn_calculation_id" TEXT,
  ADD COLUMN "model_operation_id" TEXT;

ALTER TABLE "outcome_current_valuation_cohort_operation"
  DROP CONSTRAINT "outcome_current_valuation_cohort_operation_revision_check",
  ADD CONSTRAINT "outcome_current_valuation_cohort_operation_revision_check" CHECK (
    "model_qualification_revision">0 AND "expected_prepared_input_revision">=0 AND (
      (
        "preparation_authority"='authenticated_calculation_evidence_snapshot'
        AND "factual_release_revision">0
        AND "dispatch_request_id" IS NULL
        AND "factual_output_id" IS NULL
        AND "hpn_calculation_id" IS NULL
        AND "model_operation_id" IS NULL
      ) OR (
        "preparation_authority"='dispatch_bound_private_factual_output'
        AND "factual_release_revision" IS NULL
        AND "dispatch_request_id" IS NOT NULL
        AND "factual_output_id" IS NOT NULL
        AND "hpn_calculation_id" IS NOT NULL
        AND "model_operation_id" IS NOT NULL
      )
    )
  );

ALTER TABLE "outcome_private_evaluation_cohort_capture"
  ALTER COLUMN "factual_release_revision" DROP NOT NULL,
  ADD COLUMN "preparation_authority" TEXT NOT NULL
    DEFAULT 'authenticated_calculation_evidence_snapshot',
  ADD COLUMN "dispatch_request_id" TEXT,
  ADD COLUMN "factual_output_id" TEXT,
  ADD COLUMN "model_operation_id" TEXT,
  ADD CONSTRAINT "outcome_private_evaluation_cohort_capture_authority_check" CHECK (
    (
      "preparation_authority"='authenticated_calculation_evidence_snapshot'
      AND "factual_release_revision">0
      AND "dispatch_request_id" IS NULL
      AND "factual_output_id" IS NULL
      AND "model_operation_id" IS NULL
    ) OR (
      "preparation_authority"='dispatch_bound_private_factual_output'
      AND "factual_release_revision" IS NULL
      AND "dispatch_request_id" IS NOT NULL
      AND "factual_output_id" IS NOT NULL
      AND "model_operation_id" IS NOT NULL
    )
  );

ALTER TABLE "outcome_private_evaluation_execution_cycle"
  ALTER COLUMN "factual_release_revision" DROP NOT NULL,
  ADD COLUMN "preparation_authority" TEXT NOT NULL
    DEFAULT 'authenticated_calculation_evidence_snapshot',
  ADD COLUMN "dispatch_request_id" TEXT,
  ADD COLUMN "factual_output_id" TEXT,
  ADD COLUMN "hpn_calculation_id" TEXT,
  ADD COLUMN "model_operation_id" TEXT,
  ADD CONSTRAINT "outcome_private_evaluation_execution_cycle_authority_check" CHECK (
    (
      "preparation_authority"='authenticated_calculation_evidence_snapshot'
      AND "factual_release_revision">0
      AND "dispatch_request_id" IS NULL
      AND "factual_output_id" IS NULL
      AND "hpn_calculation_id" IS NULL
      AND "model_operation_id" IS NULL
    ) OR (
      "preparation_authority"='dispatch_bound_private_factual_output'
      AND "factual_release_revision" IS NULL
      AND "dispatch_request_id" IS NOT NULL
      AND "factual_output_id" IS NOT NULL
      AND "hpn_calculation_id" IS NOT NULL
      AND "model_operation_id" IS NOT NULL
    )
  );

DROP TRIGGER "outcome_prepared_valuation_input_set_v3_validate_insert"
  ON "outcome_prepared_valuation_input_set";
CREATE TRIGGER "outcome_prepared_valuation_input_set_v3_validate_insert"
BEFORE INSERT ON "outcome_prepared_valuation_input_set" FOR EACH ROW
WHEN (
  NEW."schema_version"='afl-trade-prepared-valuation-input-set/v3'
  AND NEW."prepared_set_json"->'content'->>'preparationAuthority'=
    'authenticated_calculation_evidence_snapshot'
)
EXECUTE FUNCTION "validate_outcome_prepared_valuation_input_set_v3_insert"();

CREATE FUNCTION "validate_outcome_private_prepared_valuation_input_set_v3_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  content JSONB := NEW."prepared_set_json"->'content';
  authority JSONB := content->'privateAuthority';
  release_row RECORD;
  operation_row RECORD;
  binding_row RECORD;
  model_row RECORD;
  work_row RECORD;
  expected_trade_ids JSONB;
  release_canonical_text TEXT;
  membership_canonical_text TEXT;
  bundle_canonical_text TEXT;
  release_sha256 TEXT;
  membership_sha256 TEXT;
BEGIN
  SELECT * INTO release_row FROM "outcome_release_manifest"
   WHERE "release_id"=NEW."factual_release_id" FOR KEY SHARE;
  SELECT * INTO operation_row FROM "outcome_current_valuation_cohort_operation"
   WHERE "operation_id"=content->>'preparationOperationId' FOR KEY SHARE;
  SELECT * INTO binding_row FROM "outcome_private_valuation_model_request_binding"
   WHERE "request_id"=authority->>'dispatchRequestId' FOR KEY SHARE;
  SELECT * INTO model_row FROM "outcome_current_governed_valuation_model_pair"
   WHERE "scope_key"=NEW."scope_key" FOR KEY SHARE;
  SELECT * INTO work_row FROM "outcome_governed_model_qualification_work"
   WHERE "work_id"=authority->>'modelQualificationWorkId' FOR KEY SHARE;

  SELECT jsonb_agg(to_jsonb(member->>'canonicalRecordId') ORDER BY member->>'canonicalRecordId')
    INTO expected_trade_ids
    FROM jsonb_array_elements(
      release_row."manifest_json"->'content'->'canonicalMembers'
    ) members(member)
   WHERE member->>'recordKind'='transaction';
  release_canonical_text:=outcome_afl_trade_canonical_json(release_row."manifest_json");
  membership_canonical_text:=outcome_afl_trade_canonical_json(
    release_row."manifest_json"->'content'->'canonicalMembers'
  );
  bundle_canonical_text:=outcome_afl_trade_canonical_json(
    operation_row."context_json"->'valuationInputBundle'
  );
  release_sha256:=encode(sha256(convert_to(release_canonical_text,'UTF8')),'hex');
  membership_sha256:=encode(sha256(convert_to(membership_canonical_text,'UTF8')),'hex');

  IF NEW."finalized_at" IS NOT NULL
    OR NEW."qualification_report_id" IS NOT NULL
    OR NEW."content_canonical_json" IS DISTINCT FROM outcome_afl_trade_canonical_json(content)
    OR NEW."prepared_set_canonical_json" IS DISTINCT FROM
       outcome_afl_trade_canonical_json(NEW."prepared_set_json")
    OR NEW."content_sha256" IS DISTINCT FROM
       encode(sha256(convert_to(NEW."content_canonical_json",'UTF8')),'hex')
    OR NEW."prepared_set_json"->>'preparedInputSetId' IS DISTINCT FROM
       NEW."prepared_input_set_id"
    OR (SELECT count(*) FROM jsonb_object_keys(NEW."prepared_set_json"))<>2
    OR (SELECT count(*) FROM jsonb_object_keys(content))<>21
    OR content->>'schemaVersion' IS DISTINCT FROM NEW."schema_version"
    OR content->>'environment' IS DISTINCT FROM NEW."environment"::TEXT
    OR content->>'environment' IS DISTINCT FROM 'non_production'
    OR content->>'scopeKey' IS DISTINCT FROM NEW."scope_key"
    OR content->>'factualReleaseScopeKey' IS DISTINCT FROM
       NEW."factual_release_scope_key"
    OR content->>'factualReleaseId' IS DISTINCT FROM NEW."factual_release_id"
    OR content->>'preparationAuthority' IS DISTINCT FROM
       'dispatch_bound_private_factual_output'
    OR content->>'qualificationOperation' IS DISTINCT FROM
       'valuation_model_training_and_derived_feature_creation'
    OR jsonb_typeof(authority) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(authority))<>9
    OR (content->>'tradeCount')::INTEGER IS DISTINCT FROM NEW."trade_count"
    OR (content->>'readyCount')::INTEGER IS DISTINCT FROM NEW."ready_count"
    OR (content->>'blockedCount')::INTEGER IS DISTINCT FROM NEW."blocked_count"
    OR (content->>'preparedAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."prepared_at"
    OR content->'publicationEligible' IS DISTINCT FROM 'false'::JSONB
    OR release_row."release_id" IS NULL
    OR release_row."scope_key" IS DISTINCT FROM NEW."factual_release_scope_key"
    OR release_row."environment" IS DISTINCT FROM 'non_production'
    OR content->'releaseTradeIds' IS DISTINCT FROM expected_trade_ids
    OR jsonb_array_length(content->'entries') IS DISTINCT FROM NEW."trade_count"
    OR content->'factualReleaseArtifact'->>'artifactId' IS DISTINCT FROM
       'artifact:'||release_sha256
    OR content->'factualReleaseArtifact'->>'contentSha256' IS DISTINCT FROM release_sha256
    OR content->'factualReleaseArtifact'->>'storageUri' IS DISTINCT FROM
       'artifact://sha256/'||release_sha256
    OR content->'factualReleaseArtifact'->>'mediaType' IS DISTINCT FROM
       'application/json'
    OR (content->'factualReleaseArtifact'->>'byteLength')::INTEGER IS DISTINCT FROM
       octet_length(convert_to(release_canonical_text,'UTF8'))
    OR (content->'factualReleaseArtifact'->>'createdAt')::TIMESTAMPTZ IS DISTINCT FROM
       release_row."created_at"
    OR content->'releaseMembershipArtifact'->>'artifactId' IS DISTINCT FROM
       'artifact:'||membership_sha256
    OR content->'releaseMembershipArtifact'->>'contentSha256' IS DISTINCT FROM
       membership_sha256
    OR content->'releaseMembershipArtifact'->>'storageUri' IS DISTINCT FROM
       'artifact://sha256/'||membership_sha256
    OR content->'releaseMembershipArtifact'->>'mediaType' IS DISTINCT FROM
       'application/json'
    OR (content->'releaseMembershipArtifact'->>'byteLength')::INTEGER IS DISTINCT FROM
       octet_length(convert_to(membership_canonical_text,'UTF8'))
    OR (content->'releaseMembershipArtifact'->>'createdAt')::TIMESTAMPTZ IS DISTINCT FROM
       release_row."created_at"
    OR operation_row."operation_id" IS NULL
    OR operation_row."preparation_authority" IS DISTINCT FROM
       'dispatch_bound_private_factual_output'
    OR operation_row."scope_key" IS DISTINCT FROM NEW."scope_key"
    OR operation_row."factual_release_id" IS DISTINCT FROM NEW."factual_release_id"
    OR operation_row."context_json"->'privateAuthority' IS DISTINCT FROM authority
    OR operation_row."context_json"->>'valuationInputBundleId' IS DISTINCT FROM
       content->>'valuationInputBundleId'
    OR operation_row."context_json"->'valuationInputBundleArtifact' IS DISTINCT FROM
       content->'valuationInputBundleArtifact'
    OR binding_row."operation_id" IS DISTINCT FROM authority->>'modelOperationId'
    OR binding_row."factual_output_id" IS DISTINCT FROM authority->>'factualOutputId'
    OR binding_row."hpn_calculation_id" IS DISTINCT FROM authority->>'hpnCalculationId'
    OR model_row."qualification_id" IS DISTINCT FROM authority->>'modelQualificationId'
    OR model_row."work_id" IS DISTINCT FROM authority->>'modelQualificationWorkId'
    OR model_row."revision" IS DISTINCT FROM
       (authority->>'modelQualificationRevision')::INTEGER
    OR model_row."player_run_id" IS DISTINCT FROM authority->>'playerRunId'
    OR model_row."pick_run_id" IS DISTINCT FROM authority->>'pickRunId'
    OR work_row."qualification_id" IS DISTINCT FROM authority->>'modelQualificationId'
    OR content->'valuationInputBundleArtifact'->>'contentSha256' IS DISTINCT FROM
       encode(sha256(convert_to(bundle_canonical_text,'UTF8')),'hex')
    OR (content->'valuationInputBundleArtifact'->>'byteLength')::INTEGER IS DISTINCT FROM
       octet_length(convert_to(bundle_canonical_text,'UTF8'))
    OR validate_outcome_prepared_valuation_input_v2_artifact(
         content->'valuationInputBundleArtifact',NEW."environment"
       ) IS DISTINCT FROM TRUE
    OR (content->'valuationInputBundleArtifact'->>'createdAt')::TIMESTAMPTZ>
       NEW."prepared_at"
  THEN
    RAISE EXCEPTION 'Private prepared valuation input v3 authority mismatch';
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR cardinality_violation THEN
  RAISE EXCEPTION 'Private prepared valuation input v3 contains invalid typed authority';
END $$;

-- The original cohort-failure validator predates dispatch-bound private authority and derives only
-- the authenticated-release operation id. Preserve every diagnostics custody check while deriving
-- the operation id from the same authority branch as the retained cohort capture.
CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_cohort_failure"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  content JSONB := NEW."diagnostic_json"->'content';
  capture RECORD;
  prepared RECORD;
  expected_operation_id TEXT;
BEGIN
  SELECT * INTO capture FROM "outcome_private_evaluation_cohort_capture"
   WHERE "operation_id"=NEW."operation_id" FOR KEY SHARE;
  SELECT * INTO prepared FROM "outcome_prepared_valuation_input_set"
   WHERE "prepared_input_set_id"=NEW."prepared_input_set_id" FOR KEY SHARE;

  IF capture."preparation_authority"='dispatch_bound_private_factual_output' THEN
    expected_operation_id:='private-evaluation-cohort-run:'||encode(sha256(convert_to(
      "outcome_afl_trade_canonical_json"(jsonb_build_object(
        'scopeKey',NEW."scope_key",
        'preparedInputSetId',NEW."prepared_input_set_id",
        'preparedInputSetRevision',NEW."prepared_input_set_revision",
        'privateAuthority',prepared."prepared_set_json"->'content'->'privateAuthority',
        'expectedBatchRevision',NEW."expected_batch_revision"
      )),'UTF8')),'hex');
  ELSE
    expected_operation_id:='private-evaluation-cohort-run:'||encode(sha256(convert_to(
      "outcome_afl_trade_canonical_json"(jsonb_build_object(
        'scopeKey',NEW."scope_key",
        'preparedInputSetId',NEW."prepared_input_set_id",
        'preparedInputSetRevision',NEW."prepared_input_set_revision",
        'modelQualificationWorkId',NEW."model_qualification_work_id",
        'factualReleaseRevision',capture."factual_release_revision",
        'modelPairRevision',capture."model_pair_revision",
        'expectedBatchRevision',NEW."expected_batch_revision"
      )),'UTF8')),'hex');
  END IF;

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
    OR jsonb_array_length(content->'diagnostics')<1
    OR jsonb_array_length(content->'diagnostics')>10000
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
         OR (ordinal>1 AND value->>'tradeId'<(
           content->'diagnostics'->((ordinal-2)::INTEGER)->>'tradeId'
         ))
    )
    OR (SELECT count(DISTINCT value->>'tradeId')
          FROM jsonb_array_elements(content->'diagnostics') value)
       IS DISTINCT FROM jsonb_array_length(content->'diagnostics')::BIGINT
    OR NEW."operation_id" IS DISTINCT FROM expected_operation_id
    OR capture."scope_key" IS DISTINCT FROM NEW."scope_key"
    OR capture."prepared_input_set_id" IS DISTINCT FROM NEW."prepared_input_set_id"
    OR capture."prepared_input_set_revision" IS DISTINCT FROM
       NEW."prepared_input_set_revision"
    OR capture."model_qualification_work_id" IS DISTINCT FROM
       NEW."model_qualification_work_id"
    OR capture."expected_batch_revision" IS DISTINCT FROM NEW."expected_batch_revision"
    OR NEW."recorded_at"<capture."captured_at"
  THEN
    RAISE EXCEPTION 'Private evaluation cohort failure evidence is not exact';
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Private evaluation cohort failure evidence has invalid typed fields';
END $$;

CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_batch"() RETURNS TRIGGER AS $$
DECLARE content JSONB; prepared RECORD; work RECORD; expected_ids JSONB;
  prepared_head RECORD; model_head RECORD; active_release RECORD;
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
  SELECT * INTO active_release FROM "outcome_active_release"
   WHERE "scope_key"=prepared."factual_release_scope_key" FOR KEY SHARE;
  IF prepared."finalized_at" IS NULL OR prepared."scope_key" IS DISTINCT FROM NEW."scope_key" OR
     prepared."factual_release_id" IS DISTINCT FROM NEW."factual_release_id" OR
     prepared."trade_count" IS DISTINCT FROM NEW."trade_count" OR
     work."scope_key" IS DISTINCT FROM NEW."scope_key" OR
     work."qualification_id" IS DISTINCT FROM NEW."model_qualification_id" OR
     prepared_head."prepared_input_set_id" IS DISTINCT FROM NEW."prepared_input_set_id" OR
     prepared_head."revision" IS DISTINCT FROM NEW."prepared_input_set_revision" OR
     model_head."qualification_id" IS DISTINCT FROM NEW."model_qualification_id" OR
     model_head."work_id" IS DISTINCT FROM NEW."model_qualification_work_id" OR
     (prepared."prepared_set_json"->'content'->>'preparationAuthority'
        IS DISTINCT FROM 'dispatch_bound_private_factual_output'
       AND active_release."release_id" IS DISTINCT FROM NEW."factual_release_id") OR
     NEW."created_at">transaction_timestamp() OR
     jsonb_typeof(NEW."batch_json")<>'object' OR (SELECT count(*) FROM jsonb_object_keys(NEW."batch_json"))<>2 OR
     NEW."batch_json"->>'batchId' IS DISTINCT FROM NEW."batch_id" OR
     jsonb_typeof(content)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(content))<>15 OR
     content->>'schemaVersion' IS DISTINCT FROM 'governed-private-evaluation-batch/v1' OR
     content->>'environment' IS DISTINCT FROM 'non_production' OR
     content->'publicationEligible' IS DISTINCT FROM 'false'::jsonb OR
     content->>'scopeKey' IS DISTINCT FROM NEW."scope_key" OR
     content->>'preparedInputSetId' IS DISTINCT FROM NEW."prepared_input_set_id" OR
     (content->>'preparedInputSetRevision')::integer IS DISTINCT FROM NEW."prepared_input_set_revision" OR
     content->>'factualReleaseId' IS DISTINCT FROM NEW."factual_release_id" OR
     content->>'modelQualificationId' IS DISTINCT FROM NEW."model_qualification_id" OR
     content->>'modelQualificationWorkId' IS DISTINCT FROM NEW."model_qualification_work_id" OR
     content->'entries' IS NULL OR jsonb_typeof(content->'entries')<>'array' OR
     (SELECT jsonb_agg(to_jsonb(entry->>'tradeId') ORDER BY ordinal)
        FROM jsonb_array_elements(content->'entries') WITH ORDINALITY supplied(entry,ordinal))
       IS DISTINCT FROM expected_ids OR
     jsonb_array_length(content->'entries') IS DISTINCT FROM NEW."trade_count" OR
     (content->>'tradeCount')::integer IS DISTINCT FROM NEW."trade_count" OR
     (content->>'readyCount')::integer IS DISTINCT FROM NEW."ready_count" OR
     (content->>'unavailableCount')::integer IS DISTINCT FROM NEW."unavailable_count" OR
     (SELECT count(*) FROM jsonb_array_elements(content->'entries') entry
       WHERE entry->>'state'='ready') IS DISTINCT FROM NEW."ready_count" OR
     (SELECT count(*) FROM jsonb_array_elements(content->'entries') entry
       WHERE entry->>'state'='unavailable') IS DISTINCT FROM NEW."unavailable_count" OR
     EXISTS (
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
            OR entry->>'generationId' !~ '^local-private-trade-evaluation-generation:[a-f0-9]{64}$'
          ))
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
                   'temporal_evidence_unavailable'
                 )
                 OR jsonb_typeof(blocker->'message')<>'string'
                 OR char_length(btrim(blocker->>'message')) NOT BETWEEN 1 AND 2000
                 OR blocker->>'message' IS DISTINCT FROM btrim(blocker->>'message')
            )
          ))
     ) OR
     (content->>'createdAt')::timestamptz IS DISTINCT FROM NEW."created_at" OR
     content->>'limitation' IS DISTINCT FROM
       'Private non-production evaluation batch only; it grants no factual, production, or publication authority.' OR
     NEW."content_canonical_json" IS DISTINCT FROM "outcome_afl_trade_canonical_json"(content) OR
     NEW."content_sha256" IS DISTINCT FROM encode(sha256(convert_to(NEW."content_canonical_json",'UTF8')),'hex') OR
     NEW."batch_id" IS DISTINCT FROM 'private-evaluation-batch:'||encode(sha256(convert_to(NEW."content_canonical_json",'UTF8')),'hex') THEN
    RAISE EXCEPTION 'Private evaluation batch identity or governed ancestry mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_private_prepared_valuation_input_set_v3_validate_insert"
BEFORE INSERT ON "outcome_prepared_valuation_input_set" FOR EACH ROW
WHEN (
  NEW."schema_version"='afl-trade-prepared-valuation-input-set/v3'
  AND NEW."prepared_set_json"->'content'->>'preparationAuthority'=
    'dispatch_bound_private_factual_output'
)
EXECUTE FUNCTION "validate_outcome_private_prepared_valuation_input_set_v3_insert"();

CREATE OR REPLACE FUNCTION "validate_outcome_automated_ready_calculation_authority"(
  authority JSONB, requested_scope_key TEXT, requested_trade_id TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
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
  private_authority JSONB := authority->'privateAuthority';
  is_private BOOLEAN := COALESCE(
    authority->>'preparationAuthority'='dispatch_bound_private_factual_output',
    FALSE
  );
BEGIN
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
  RETURN COALESCE(
    jsonb_typeof(authority)='object'
    AND (
      (is_private AND (SELECT count(*) FROM jsonb_object_keys(authority))=12)
      OR (NOT is_private AND (SELECT count(*) FROM jsonb_object_keys(authority))=14)
    )
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
    AND prepared_set."prepared_set_json"->'content'->>'valuationInputBundleId'=
        authority->>'valuationInputBundleId'
    AND prepared_set."prepared_set_json"->'content'->'valuationInputBundleArtifact'=
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
    AND (authority->'components'->1->>'gate3DecisionVersion')::INTEGER=
        pick_gate."version"
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
    AND (
      NOT is_private OR (
        jsonb_typeof(private_authority)='object'
        AND (SELECT count(*) FROM jsonb_object_keys(private_authority))=9
        AND prepared_set."factual_release_id"=authority->>'factualReleaseId'
        AND prepared_set."prepared_set_json"->'content'->>'preparationAuthority'=
            'dispatch_bound_private_factual_output'
        AND prepared_set."prepared_set_json"->'content'->'privateAuthority'=
            private_authority
        AND model_pair."qualification_id"=private_authority->>'modelQualificationId'
        AND model_pair."work_id"=private_authority->>'modelQualificationWorkId'
        AND model_pair."revision"=(private_authority->>'modelQualificationRevision')::INTEGER
        AND model_pair."player_run_id"=private_authority->>'playerRunId'
        AND model_pair."pick_run_id"=private_authority->>'pickRunId'
        AND EXISTS (
          SELECT 1 FROM "outcome_private_valuation_model_request_binding" binding
          JOIN "outcome_private_valuation_dispatch_request" request
            ON request."request_id"=binding."request_id"
           AND request."scope_key"=requested_scope_key
          JOIN "outcome_private_valuation_factual_output" factual
            ON factual."request_id"=binding."request_id"
           AND factual."output_id"=binding."factual_output_id"
           AND factual."factual_release_id"=authority->>'factualReleaseId'
          JOIN "outcome_release_manifest" release
            ON release."release_id"=factual."factual_release_id"
           AND release."scope_key"=prepared_set."factual_release_scope_key"
          JOIN "outcome_private_valuation_model_operation" operation
            ON operation."operation_id"=binding."operation_id"
           AND operation."qualification_outcome"='qualified'
           AND operation."qualification_id"=model_pair."qualification_id"
           AND operation."player_run_id"=model_pair."player_run_id"
           AND operation."pick_run_id"=model_pair."pick_run_id"
          JOIN "outcome_governed_model_qualification_work" work
            ON work."work_id"=model_pair."work_id"
           AND work."qualification_id"=model_pair."qualification_id"
         WHERE binding."request_id"=private_authority->>'dispatchRequestId'
           AND binding."factual_output_id"=private_authority->>'factualOutputId'
           AND binding."hpn_calculation_id"=private_authority->>'hpnCalculationId'
           AND binding."operation_id"=private_authority->>'modelOperationId'
        )
      )
    ),FALSE);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN FALSE;
END $$;

DROP TRIGGER "outcome_current_valuation_cohort_operation_validate"
  ON "outcome_current_valuation_cohort_operation";
CREATE TRIGGER "outcome_current_valuation_cohort_operation_validate"
BEFORE INSERT ON "outcome_current_valuation_cohort_operation" FOR EACH ROW
WHEN (NEW."preparation_authority"='authenticated_calculation_evidence_snapshot')
EXECUTE FUNCTION "validate_outcome_current_valuation_cohort_operation"();

CREATE FUNCTION "validate_outcome_private_current_valuation_cohort_operation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  context JSONB := NEW."context_json";
  authority JSONB := context->'privateAuthority';
  identity_json JSONB;
  release_row RECORD;
  binding_row RECORD;
  factual_row RECORD;
  model_operation_row RECORD;
  model_row RECORD;
  work_row RECORD;
  prepared_head_revision INTEGER;
  expected_trade_ids JSONB;
  release_canonical_text TEXT;
  membership_canonical_text TEXT;
  bundle JSONB := context->'valuationInputBundle';
  bundle_canonical_text TEXT;
BEGIN
  identity_json:=jsonb_build_object(
    'scopeKey',NEW."scope_key",
    'factualReleaseId',NEW."factual_release_id",
    'privateAuthority',authority,
    'valuationInputBundleId',context->>'valuationInputBundleId',
    'expectedPreparedInputRevision',NEW."expected_prepared_input_revision"
  );
  SELECT * INTO release_row FROM "outcome_release_manifest"
   WHERE "release_id"=NEW."factual_release_id" FOR KEY SHARE;
  SELECT * INTO binding_row FROM "outcome_private_valuation_model_request_binding"
   WHERE "request_id"=NEW."dispatch_request_id" FOR KEY SHARE;
  SELECT * INTO factual_row FROM "outcome_private_valuation_factual_output"
   WHERE "output_id"=NEW."factual_output_id" FOR KEY SHARE;
  SELECT * INTO model_operation_row FROM "outcome_private_valuation_model_operation"
   WHERE "operation_id"=NEW."model_operation_id" FOR KEY SHARE;
  SELECT * INTO model_row FROM "outcome_current_governed_valuation_model_pair"
   WHERE "scope_key"=NEW."scope_key" FOR KEY SHARE;
  SELECT * INTO work_row FROM "outcome_governed_model_qualification_work"
   WHERE "work_id"=NEW."model_qualification_work_id" FOR KEY SHARE;
  SELECT COALESCE("revision",0) INTO prepared_head_revision
    FROM "outcome_current_prepared_valuation_input_set"
   WHERE "scope_key"=NEW."scope_key" FOR KEY SHARE;
  prepared_head_revision:=COALESCE(prepared_head_revision,0);

  SELECT jsonb_agg(to_jsonb(member->>'canonicalRecordId') ORDER BY member->>'canonicalRecordId')
    INTO expected_trade_ids
    FROM jsonb_array_elements(
      release_row."manifest_json"->'content'->'canonicalMembers'
    ) members(member)
   WHERE member->>'recordKind'='transaction';
  release_canonical_text:=outcome_afl_trade_canonical_json(release_row."manifest_json");
  membership_canonical_text:=outcome_afl_trade_canonical_json(
    release_row."manifest_json"->'content'->'canonicalMembers'
  );
  bundle_canonical_text:=outcome_afl_trade_canonical_json(bundle);

  IF NEW."context_canonical_json" IS DISTINCT FROM outcome_afl_trade_canonical_json(context)
    OR NEW."context_sha256" IS DISTINCT FROM
       encode(sha256(convert_to(NEW."context_canonical_json",'UTF8')),'hex')
    OR NEW."operation_id" IS DISTINCT FROM 'valuation-cohort-preparation-operation:'||
       encode(sha256(convert_to(outcome_afl_trade_canonical_json(identity_json),'UTF8')),'hex')
    OR (SELECT count(*) FROM jsonb_object_keys(context))<>14
    OR context->>'operationId' IS DISTINCT FROM NEW."operation_id"
    OR context->>'scopeKey' IS DISTINCT FROM NEW."scope_key"
    OR context->>'factualReleaseId' IS DISTINCT FROM NEW."factual_release_id"
    OR context->>'preparationAuthority' IS DISTINCT FROM NEW."preparation_authority"
    OR context->>'preparationAuthority' IS DISTINCT FROM
       'dispatch_bound_private_factual_output'
    OR context->'privateAuthority'->>'dispatchRequestId' IS DISTINCT FROM
       NEW."dispatch_request_id"
    OR context->'privateAuthority'->>'factualOutputId' IS DISTINCT FROM NEW."factual_output_id"
    OR context->'privateAuthority'->>'hpnCalculationId' IS DISTINCT FROM NEW."hpn_calculation_id"
    OR context->'privateAuthority'->>'modelOperationId' IS DISTINCT FROM NEW."model_operation_id"
    OR context->'privateAuthority'->>'modelQualificationId' IS DISTINCT FROM
       NEW."model_qualification_id"
    OR context->'privateAuthority'->>'modelQualificationWorkId' IS DISTINCT FROM
       NEW."model_qualification_work_id"
    OR (context->'privateAuthority'->>'modelQualificationRevision')::INTEGER IS DISTINCT FROM
       NEW."model_qualification_revision"
    OR (context->>'expectedPreparedInputRevision')::INTEGER IS DISTINCT FROM
       NEW."expected_prepared_input_revision"
    OR (context->>'capturedAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."captured_at"
    OR NEW."captured_at">transaction_timestamp()
    OR NEW."captured_at"<transaction_timestamp()-INTERVAL '5 minutes'
    OR prepared_head_revision IS DISTINCT FROM NEW."expected_prepared_input_revision"
    OR release_row."release_id" IS NULL
    OR release_row."scope_key" IS DISTINCT FROM context->>'factualReleaseScopeKey'
    OR release_row."environment" IS DISTINCT FROM 'non_production'
    OR context->'releaseTradeIds' IS DISTINCT FROM expected_trade_ids
    OR context->'factualReleaseArtifact'->>'contentSha256' IS DISTINCT FROM
       encode(sha256(convert_to(release_canonical_text,'UTF8')),'hex')
    OR context->'releaseMembershipArtifact'->>'contentSha256' IS DISTINCT FROM
       encode(sha256(convert_to(membership_canonical_text,'UTF8')),'hex')
    OR binding_row."operation_id" IS DISTINCT FROM NEW."model_operation_id"
    OR binding_row."factual_output_id" IS DISTINCT FROM NEW."factual_output_id"
    OR binding_row."hpn_calculation_id" IS DISTINCT FROM NEW."hpn_calculation_id"
    OR factual_row."request_id" IS DISTINCT FROM NEW."dispatch_request_id"
    OR factual_row."factual_release_id" IS DISTINCT FROM NEW."factual_release_id"
    OR model_operation_row."qualification_id" IS DISTINCT FROM NEW."model_qualification_id"
    OR model_operation_row."qualification_outcome" IS DISTINCT FROM 'qualified'
    OR model_operation_row."player_run_id" IS DISTINCT FROM
       authority->>'playerRunId'
    OR model_operation_row."pick_run_id" IS DISTINCT FROM authority->>'pickRunId'
    OR model_row."qualification_id" IS DISTINCT FROM NEW."model_qualification_id"
    OR model_row."work_id" IS DISTINCT FROM NEW."model_qualification_work_id"
    OR model_row."revision" IS DISTINCT FROM NEW."model_qualification_revision"
    OR model_row."player_run_id" IS DISTINCT FROM authority->>'playerRunId'
    OR model_row."pick_run_id" IS DISTINCT FROM authority->>'pickRunId'
    OR work_row."qualification_id" IS DISTINCT FROM NEW."model_qualification_id"
    OR bundle->>'valuationInputBundleId' IS DISTINCT FROM context->>'valuationInputBundleId'
    OR bundle->>'valuationInputBundleId' IS DISTINCT FROM 'valuation-input-bundle:'||
       encode(sha256(convert_to(outcome_afl_trade_canonical_json(bundle->'content'),'UTF8')),'hex')
    OR bundle->'content'->>'scopeKey' IS DISTINCT FROM NEW."scope_key"
    OR bundle->'content'->'components'->0->>'runId' IS DISTINCT FROM authority->>'playerRunId'
    OR bundle->'content'->'components'->1->>'runId' IS DISTINCT FROM authority->>'pickRunId'
    OR context->'valuationInputBundleArtifact'->>'contentSha256' IS DISTINCT FROM
       encode(sha256(convert_to(bundle_canonical_text,'UTF8')),'hex')
    OR (context->'valuationInputBundleArtifact'->>'byteLength')::INTEGER IS DISTINCT FROM
       octet_length(convert_to(bundle_canonical_text,'UTF8'))
  THEN
    RAISE EXCEPTION 'Private current valuation cohort operation authority mismatch';
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Private current valuation cohort operation contains invalid typed authority';
END $$;

CREATE TRIGGER "outcome_private_current_valuation_cohort_operation_validate"
BEFORE INSERT ON "outcome_current_valuation_cohort_operation" FOR EACH ROW
WHEN (NEW."preparation_authority"='dispatch_bound_private_factual_output')
EXECUTE FUNCTION "validate_outcome_private_current_valuation_cohort_operation"();

CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_cohort_capture"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE prepared RECORD; authority JSONB; expected_operation_id TEXT;
BEGIN
  SELECT prepared_set.*,prepared_head.revision AS head_revision
    INTO prepared
    FROM "outcome_current_prepared_valuation_input_set" prepared_head
    JOIN "outcome_prepared_valuation_input_set" prepared_set
      ON prepared_set."prepared_input_set_id"=prepared_head."prepared_input_set_id"
   WHERE prepared_head."scope_key"=NEW."scope_key" FOR SHARE OF prepared_head,prepared_set;
  IF NEW."preparation_authority"='authenticated_calculation_evidence_snapshot' THEN
    expected_operation_id:='private-evaluation-cohort-run:'||encode(sha256(convert_to(
      "outcome_afl_trade_canonical_json"(jsonb_build_object(
        'scopeKey',NEW."scope_key",
        'preparedInputSetId',NEW."prepared_input_set_id",
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
    ) THEN RAISE EXCEPTION 'Private evaluation cohort capture is not exact current authority'; END IF;
  ELSE
    authority:=prepared."prepared_set_json"->'content'->'privateAuthority';
    expected_operation_id:='private-evaluation-cohort-run:'||encode(sha256(convert_to(
      "outcome_afl_trade_canonical_json"(jsonb_build_object(
        'scopeKey',NEW."scope_key",
        'preparedInputSetId',NEW."prepared_input_set_id",
        'preparedInputSetRevision',NEW."prepared_input_set_revision",
        'privateAuthority',authority,
        'expectedBatchRevision',NEW."expected_batch_revision"
      )),'UTF8')),'hex');
    IF prepared."prepared_set_json"->'content'->>'preparationAuthority' IS DISTINCT FROM
         'dispatch_bound_private_factual_output'
      OR authority->>'dispatchRequestId' IS DISTINCT FROM NEW."dispatch_request_id"
      OR authority->>'factualOutputId' IS DISTINCT FROM NEW."factual_output_id"
      OR authority->>'modelOperationId' IS DISTINCT FROM NEW."model_operation_id"
      OR authority->>'modelQualificationWorkId' IS DISTINCT FROM
         NEW."model_qualification_work_id"
      OR (authority->>'modelQualificationRevision')::INTEGER IS DISTINCT FROM
         NEW."model_pair_revision"
      OR NOT EXISTS (
        SELECT 1 FROM "outcome_private_valuation_model_request_binding" binding
        JOIN "outcome_private_valuation_model_operation" operation
          ON operation."operation_id"=binding."operation_id"
         AND operation."qualification_outcome"='qualified'
         WHERE binding."request_id"=NEW."dispatch_request_id"
           AND binding."factual_output_id"=NEW."factual_output_id"
           AND binding."operation_id"=NEW."model_operation_id"
           AND operation."qualification_id"=authority->>'modelQualificationId'
           AND operation."player_run_id"=authority->>'playerRunId'
           AND operation."pick_run_id"=authority->>'pickRunId'
      )
    THEN RAISE EXCEPTION 'Private evaluation cohort capture is not exact current authority'; END IF;
  END IF;
  IF NEW."operation_id" IS DISTINCT FROM expected_operation_id
    OR NEW."captured_at">transaction_timestamp()
    OR NEW."captured_at"<transaction_timestamp()-INTERVAL '5 minutes'
    OR prepared."prepared_input_set_id" IS DISTINCT FROM NEW."prepared_input_set_id"
    OR prepared."head_revision" IS DISTINCT FROM NEW."prepared_input_set_revision"
    OR prepared."schema_version" IS DISTINCT FROM
       'afl-trade-prepared-valuation-input-set/v3'
    OR prepared."environment" IS DISTINCT FROM 'non_production'
    OR NOT EXISTS (
      SELECT 1 FROM "outcome_current_governed_valuation_model_pair" model
       WHERE model."scope_key"=NEW."scope_key"
         AND model."work_id"=NEW."model_qualification_work_id"
         AND model."revision"=NEW."model_pair_revision"
    )
    OR COALESCE((SELECT batch_head."revision"
                   FROM "outcome_current_private_evaluation_batch" batch_head
                  WHERE batch_head."scope_key"=NEW."scope_key"),0)
       IS DISTINCT FROM NEW."expected_batch_revision"
  THEN RAISE EXCEPTION 'Private evaluation cohort capture is not exact current authority'; END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Private evaluation cohort capture contains invalid typed authority';
END $$;

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
      LEFT JOIN "outcome_active_release" active_release
        ON active_release."scope_key"=prepared."factual_release_scope_key"
       AND active_release."release_id"=target."factual_release_id"
       WHERE prepared."prepared_input_set_id"=target."prepared_input_set_id"
         AND (
           active_release."release_id" IS NOT NULL OR
           prepared."prepared_set_json"->'content'->>'preparationAuthority'=
             'dispatch_bound_private_factual_output'
         )
    )
    FROM "outcome_private_evaluation_batch" target
    WHERE target."batch_id"=requested_batch_id AND target."scope_key"=requested_scope_key
  ),FALSE)
$$;

CREATE OR REPLACE FUNCTION "advance_outcome_current_private_evaluation_batch_from_capture"(
  requested_scope_key TEXT, requested_batch_id TEXT, expected_revision INTEGER,
  requested_operation_id TEXT, requested_action TEXT, requested_principal_id TEXT,
  requested_cohort_operation_id TEXT
) RETURNS TABLE(batch_id TEXT,revision INTEGER,transition_id TEXT,activated_at TIMESTAMPTZ) AS $$
DECLARE capture RECORD; prepared RECORD; prepared_head RECORD; model_head RECORD;
  active_release RECORD; authority JSONB;
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
    THEN RAISE EXCEPTION 'Private evaluation cohort final authority is stale'; END IF;
  ELSE
    authority:=prepared."prepared_set_json"->'content'->'privateAuthority';
    IF prepared."prepared_set_json"->'content'->>'preparationAuthority'
         IS DISTINCT FROM capture."preparation_authority"
      OR authority->>'dispatchRequestId' IS DISTINCT FROM capture."dispatch_request_id"
      OR authority->>'factualOutputId' IS DISTINCT FROM capture."factual_output_id"
      OR authority->>'modelOperationId' IS DISTINCT FROM capture."model_operation_id"
      OR authority->>'modelQualificationWorkId' IS DISTINCT FROM
         capture."model_qualification_work_id"
      OR (authority->>'modelQualificationRevision')::INTEGER IS DISTINCT FROM
         capture."model_pair_revision"
    THEN RAISE EXCEPTION 'Private evaluation cohort final authority is stale'; END IF;
  END IF;
  IF requested_action IS DISTINCT FROM 'activate'
    OR capture."operation_id" IS NULL
    OR prepared_head."prepared_input_set_id" IS DISTINCT FROM capture."prepared_input_set_id"
    OR prepared_head."revision" IS DISTINCT FROM capture."prepared_input_set_revision"
    OR model_head."work_id" IS DISTINCT FROM capture."model_qualification_work_id"
    OR model_head."revision" IS DISTINCT FROM capture."model_pair_revision"
  THEN RAISE EXCEPTION 'Private evaluation cohort final authority is stale'; END IF;
  RETURN QUERY SELECT * FROM "advance_outcome_current_private_evaluation_batch"(
    requested_scope_key,requested_batch_id,expected_revision,requested_operation_id,
    requested_action,requested_principal_id
  );
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Private evaluation cohort final authority is stale';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_execution_cycle"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE content JSONB:=NEW."cycle_json"->'content'; authority_json JSONB;
  expected_fingerprint TEXT; expected_cycle TEXT;
BEGIN
  IF NEW."preparation_authority"='authenticated_calculation_evidence_snapshot' THEN
    authority_json:=jsonb_build_object(
      'scopeKey',NEW."scope_key",'preparedInputSetId',NEW."prepared_input_set_id",
      'preparedInputSetRevision',NEW."prepared_input_set_revision",
      'factualReleaseRevision',NEW."factual_release_revision",
      'modelQualificationWorkId',NEW."model_qualification_work_id",
      'modelPairRevision',NEW."model_pair_revision");
  ELSE
    authority_json:=jsonb_build_object(
      'preparationAuthority','dispatch_bound_private_factual_output',
      'scopeKey',NEW."scope_key",'preparedInputSetId',NEW."prepared_input_set_id",
      'preparedInputSetRevision',NEW."prepared_input_set_revision",
      'modelQualificationWorkId',NEW."model_qualification_work_id",
      'modelPairRevision',NEW."model_pair_revision",
      'privateAuthority',content->'authority'->'privateAuthority');
  END IF;
  expected_fingerprint:='cohort-execution-input:'||encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(authority_json),'UTF8')),'hex');
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
  ) THEN RAISE EXCEPTION 'Private evaluation execution repair lacks a terminal predecessor'; END IF;
  IF jsonb_typeof(NEW."cycle_json") IS DISTINCT FROM 'object'
    OR "outcome_private_evaluation_json_object_key_count"(NEW."cycle_json") IS DISTINCT FROM 2
    OR jsonb_typeof(content) IS DISTINCT FROM 'object'
    OR "outcome_private_evaluation_json_object_key_count"(content) IS DISTINCT FROM 14
    OR content->'authority' IS DISTINCT FROM authority_json
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
    OR (NEW."repair_sequence">0 AND (NEW."repair_reason" IS NULL
      OR btrim(NEW."repair_reason")='' OR length(NEW."repair_reason")>2000))
    OR NOT EXISTS (
      SELECT 1 FROM "outcome_current_prepared_valuation_input_set" prepared_head
      JOIN "outcome_prepared_valuation_input_set" prepared
        ON prepared."prepared_input_set_id"=prepared_head."prepared_input_set_id"
      JOIN "outcome_current_governed_valuation_model_pair" model
        ON model."scope_key"=prepared_head."scope_key"
       WHERE prepared_head."scope_key"=NEW."scope_key"
         AND prepared_head."prepared_input_set_id"=NEW."prepared_input_set_id"
         AND prepared_head."revision"=NEW."prepared_input_set_revision"
         AND prepared."scope_key"=NEW."scope_key"
         AND prepared."schema_version"='afl-trade-prepared-valuation-input-set/v3'
         AND prepared."environment"='non_production'
         AND prepared."finalized_at" IS NOT NULL
         AND model."work_id"=NEW."model_qualification_work_id"
         AND model."revision"=NEW."model_pair_revision"
         AND (
           (NEW."preparation_authority"='authenticated_calculation_evidence_snapshot'
             AND EXISTS (
               SELECT 1 FROM "outcome_active_release" release
                WHERE release."scope_key"=prepared."factual_release_scope_key"
                  AND release."release_id"=prepared."factual_release_id"
                  AND release."revision"=NEW."factual_release_revision"
             ))
           OR
           (NEW."preparation_authority"='dispatch_bound_private_factual_output'
             AND prepared."prepared_set_json"->'content'->>'preparationAuthority'=
                 NEW."preparation_authority"
             AND prepared."prepared_set_json"->'content'->'privateAuthority'->>'dispatchRequestId'=
                 NEW."dispatch_request_id"
             AND prepared."prepared_set_json"->'content'->'privateAuthority'->>'factualOutputId'=
                 NEW."factual_output_id"
             AND prepared."prepared_set_json"->'content'->'privateAuthority'->>'hpnCalculationId'=
                 NEW."hpn_calculation_id"
             AND prepared."prepared_set_json"->'content'->'privateAuthority'->>'modelOperationId'=
                 NEW."model_operation_id"
             AND prepared."prepared_set_json"->'content'->'privateAuthority'
                 IS DISTINCT FROM NULL)
         )
    )
  THEN RAISE EXCEPTION 'Private evaluation execution cycle is not exact current authority'; END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Private evaluation execution cycle is malformed';
END $$;
