CREATE TABLE "outcome_private_evaluation_cohort_capture" (
  "operation_id" TEXT PRIMARY KEY,
  "scope_key" TEXT NOT NULL,
  "prepared_input_set_id" TEXT NOT NULL REFERENCES "outcome_prepared_valuation_input_set"("prepared_input_set_id") ON DELETE RESTRICT,
  "prepared_input_set_revision" INTEGER NOT NULL CHECK ("prepared_input_set_revision">0),
  "model_qualification_work_id" TEXT NOT NULL REFERENCES "outcome_governed_model_qualification_work"("work_id") ON DELETE RESTRICT,
  "factual_release_revision" INTEGER NOT NULL CHECK ("factual_release_revision">0),
  "model_pair_revision" INTEGER NOT NULL CHECK ("model_pair_revision">0),
  "expected_batch_revision" INTEGER NOT NULL CHECK ("expected_batch_revision">=0),
  "captured_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "outcome_private_evaluation_cohort_capture_id_check"
    CHECK ("operation_id" ~ '^private-evaluation-cohort-run:[a-f0-9]{64}$')
);

CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_cohort_capture"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."operation_id" IS DISTINCT FROM 'private-evaluation-cohort-run:'||encode(sha256(convert_to(
      "outcome_afl_trade_canonical_json"(jsonb_build_object(
        'scopeKey',NEW."scope_key",
        'preparedInputSetId',NEW."prepared_input_set_id",
        'preparedInputSetRevision',NEW."prepared_input_set_revision",
        'modelQualificationWorkId',NEW."model_qualification_work_id",
        'factualReleaseRevision',NEW."factual_release_revision",
        'modelPairRevision',NEW."model_pair_revision",
        'expectedBatchRevision',NEW."expected_batch_revision"
      )),'UTF8')),'hex')
    OR NEW."captured_at">transaction_timestamp()
    OR NEW."captured_at"<transaction_timestamp()-INTERVAL '5 minutes'
    OR NOT EXISTS (
      SELECT 1 FROM "outcome_current_prepared_valuation_input_set" prepared_head
      JOIN "outcome_prepared_valuation_input_set" prepared
        ON prepared."prepared_input_set_id"=prepared_head."prepared_input_set_id"
      JOIN "outcome_active_release" active_release
        ON active_release."scope_key"=prepared."factual_release_scope_key"
       AND active_release."release_id"=prepared."factual_release_id"
       WHERE prepared_head."scope_key"=NEW."scope_key"
         AND prepared_head."prepared_input_set_id"=NEW."prepared_input_set_id"
         AND prepared_head."revision"=NEW."prepared_input_set_revision"
         AND prepared."schema_version"='afl-trade-prepared-valuation-input-set/v3'
         AND prepared."environment"='non_production'
         AND active_release."revision"=NEW."factual_release_revision"
    )
    OR NOT EXISTS (
      SELECT 1 FROM "outcome_current_governed_valuation_model_pair" model_head
       WHERE model_head."scope_key"=NEW."scope_key"
         AND model_head."work_id"=NEW."model_qualification_work_id"
         AND model_head."revision"=NEW."model_pair_revision"
    )
    OR COALESCE((
      SELECT batch_head."revision" FROM "outcome_current_private_evaluation_batch" batch_head
       WHERE batch_head."scope_key"=NEW."scope_key"
    ),0) IS DISTINCT FROM NEW."expected_batch_revision"
  THEN
    RAISE EXCEPTION 'Private evaluation cohort capture is not exact current authority';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_private_evaluation_cohort_capture_validate"
BEFORE INSERT ON "outcome_private_evaluation_cohort_capture"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_evaluation_cohort_capture"();

CREATE TRIGGER "outcome_private_evaluation_cohort_capture_no_mutation"
BEFORE UPDATE OR DELETE ON "outcome_private_evaluation_cohort_capture"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_evaluation_batch_mutation"();

CREATE TABLE "outcome_private_evaluation_cohort_batch" (
  "batch_id" TEXT PRIMARY KEY REFERENCES "outcome_private_evaluation_batch"("batch_id") ON DELETE RESTRICT,
  "operation_id" TEXT NOT NULL REFERENCES "outcome_private_evaluation_cohort_capture"("operation_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_private_evaluation_cohort_batch_operation_key" UNIQUE ("operation_id")
);

CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_cohort_batch"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE batch RECORD; capture RECORD;
BEGIN
  SELECT * INTO batch FROM "outcome_private_evaluation_batch"
   WHERE "batch_id"=NEW."batch_id" FOR KEY SHARE;
  SELECT * INTO capture FROM "outcome_private_evaluation_cohort_capture"
   WHERE "operation_id"=NEW."operation_id" FOR KEY SHARE;
  IF batch."scope_key" IS DISTINCT FROM capture."scope_key"
    OR batch."prepared_input_set_id" IS DISTINCT FROM capture."prepared_input_set_id"
    OR batch."prepared_input_set_revision" IS DISTINCT FROM capture."prepared_input_set_revision"
    OR batch."model_qualification_work_id" IS DISTINCT FROM capture."model_qualification_work_id"
    OR batch."created_at"<capture."captured_at"
  THEN
    RAISE EXCEPTION 'Private evaluation cohort batch does not match its captured authority';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_private_evaluation_cohort_batch_validate"
BEFORE INSERT ON "outcome_private_evaluation_cohort_batch"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_evaluation_cohort_batch"();

CREATE TRIGGER "outcome_private_evaluation_cohort_batch_no_mutation"
BEFORE UPDATE OR DELETE ON "outcome_private_evaluation_cohort_batch"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_evaluation_batch_mutation"();

CREATE TABLE "outcome_private_evaluation_cohort_failure" (
  "diagnostic_id" TEXT PRIMARY KEY,
  "operation_id" TEXT NOT NULL UNIQUE REFERENCES "outcome_private_evaluation_cohort_capture"("operation_id") ON DELETE RESTRICT,
  "scope_key" TEXT NOT NULL,
  "prepared_input_set_id" TEXT NOT NULL REFERENCES "outcome_prepared_valuation_input_set"("prepared_input_set_id") ON DELETE RESTRICT,
  "prepared_input_set_revision" INTEGER NOT NULL CHECK ("prepared_input_set_revision">0),
  "model_qualification_work_id" TEXT NOT NULL REFERENCES "outcome_governed_model_qualification_work"("work_id") ON DELETE RESTRICT,
  "expected_batch_revision" INTEGER NOT NULL CHECK ("expected_batch_revision">=0),
  "diagnostic_json" JSONB NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "outcome_private_evaluation_cohort_failure_id_check"
    CHECK ("diagnostic_id" ~ '^private-evaluation-cohort-failure:[a-f0-9]{64}$')
);

CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_cohort_failure"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE content JSONB := NEW."diagnostic_json"->'content'; capture RECORD;
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
    OR (content->>'preparedInputSetRevision')::INTEGER IS DISTINCT FROM NEW."prepared_input_set_revision"
    OR content->>'modelQualificationWorkId' IS DISTINCT FROM NEW."model_qualification_work_id"
    OR jsonb_typeof(content->'expectedBatchRevision') IS DISTINCT FROM 'number'
    OR (content->>'expectedBatchRevision')::INTEGER IS DISTINCT FROM NEW."expected_batch_revision"
    OR (content->>'recordedAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."recorded_at"
    OR NEW."recorded_at">transaction_timestamp()
    OR NEW."recorded_at"<transaction_timestamp()-INTERVAL '5 minutes'
    OR content->>'limitation' IS DISTINCT FROM
      'Private engineering diagnostics only; no factual, model, production, or publication authority.'
    OR jsonb_typeof(content->'diagnostics') IS DISTINCT FROM 'array'
    OR jsonb_array_length(content->'diagnostics')<1
    OR jsonb_array_length(content->'diagnostics')>10000
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(content->'diagnostics') WITH ORDINALITY diagnostic(value,ordinal)
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
    OR (SELECT count(DISTINCT value->>'tradeId') FROM jsonb_array_elements(content->'diagnostics') value)
       IS DISTINCT FROM jsonb_array_length(content->'diagnostics')::BIGINT
    OR NEW."operation_id" IS DISTINCT FROM 'private-evaluation-cohort-run:'||encode(sha256(convert_to(
      "outcome_afl_trade_canonical_json"(jsonb_build_object(
        'scopeKey',NEW."scope_key",
        'preparedInputSetId',NEW."prepared_input_set_id",
        'preparedInputSetRevision',NEW."prepared_input_set_revision",
        'modelQualificationWorkId',NEW."model_qualification_work_id",
        'factualReleaseRevision',capture."factual_release_revision",
        'modelPairRevision',capture."model_pair_revision",
        'expectedBatchRevision',NEW."expected_batch_revision"
      )),'UTF8')),'hex')
    OR NEW."diagnostic_id" IS DISTINCT FROM 'private-evaluation-cohort-failure:'||encode(sha256(convert_to(
      "outcome_afl_trade_canonical_json"(content),'UTF8')),'hex')
    OR capture."scope_key" IS DISTINCT FROM NEW."scope_key"
    OR capture."prepared_input_set_id" IS DISTINCT FROM NEW."prepared_input_set_id"
    OR capture."prepared_input_set_revision" IS DISTINCT FROM NEW."prepared_input_set_revision"
    OR capture."model_qualification_work_id" IS DISTINCT FROM NEW."model_qualification_work_id"
    OR capture."expected_batch_revision" IS DISTINCT FROM NEW."expected_batch_revision"
    OR NEW."recorded_at"<capture."captured_at"
  THEN
    RAISE EXCEPTION 'Private evaluation cohort failure evidence is not exact';
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Private evaluation cohort failure evidence has invalid typed fields';
END $$;

CREATE TRIGGER "outcome_private_evaluation_cohort_failure_validate"
BEFORE INSERT ON "outcome_private_evaluation_cohort_failure"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_evaluation_cohort_failure"();

CREATE TRIGGER "outcome_private_evaluation_cohort_failure_no_mutation"
BEFORE UPDATE OR DELETE ON "outcome_private_evaluation_cohort_failure"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_evaluation_batch_mutation"();

CREATE OR REPLACE FUNCTION "advance_outcome_current_private_evaluation_batch_from_capture"(
  requested_scope_key TEXT, requested_batch_id TEXT, expected_revision INTEGER,
  requested_operation_id TEXT, requested_action TEXT, requested_principal_id TEXT,
  requested_cohort_operation_id TEXT
) RETURNS TABLE(batch_id TEXT,revision INTEGER,transition_id TEXT,activated_at TIMESTAMPTZ) AS $$
DECLARE capture RECORD; prepared RECORD; prepared_head RECORD; model_head RECORD; active_release RECORD;
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
  SELECT "factual_release_scope_key","factual_release_id" INTO prepared
    FROM "outcome_prepared_valuation_input_set"
   WHERE "prepared_input_set_id"=capture."prepared_input_set_id" FOR KEY SHARE;
  SELECT * INTO model_head FROM "outcome_current_governed_valuation_model_pair"
   WHERE "scope_key"=requested_scope_key FOR SHARE;
  SELECT * INTO active_release FROM "outcome_active_release"
   WHERE "scope_key"=prepared."factual_release_scope_key" FOR SHARE;
  IF requested_action IS DISTINCT FROM 'activate'
    OR capture."operation_id" IS NULL
    OR prepared_head."prepared_input_set_id" IS DISTINCT FROM capture."prepared_input_set_id"
    OR prepared_head."revision" IS DISTINCT FROM capture."prepared_input_set_revision"
    OR model_head."work_id" IS DISTINCT FROM capture."model_qualification_work_id"
    OR model_head."revision" IS DISTINCT FROM capture."model_pair_revision"
    OR active_release."release_id" IS DISTINCT FROM prepared."factual_release_id"
    OR active_release."revision" IS DISTINCT FROM capture."factual_release_revision"
  THEN
    RAISE EXCEPTION 'Private evaluation cohort final authority is stale';
  END IF;
  RETURN QUERY SELECT * FROM "advance_outcome_current_private_evaluation_batch"(
    requested_scope_key,requested_batch_id,expected_revision,requested_operation_id,
    requested_action,requested_principal_id
  );
END;
$$ LANGUAGE plpgsql;

-- Prepared-v3 can retain these expected unavailability codes. Replace the 0066
-- validator deterministically so migration output never depends on installed function text.
CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_batch"() RETURNS TRIGGER AS $$
DECLARE content JSONB; prepared RECORD; work RECORD; expected_ids JSONB;
  prepared_head RECORD; model_head RECORD; active_release RECORD;
BEGIN
  content:=NEW."batch_json"->'content';
  SELECT "scope_key","factual_release_scope_key","factual_release_id","trade_count","finalized_at"
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
     active_release."release_id" IS DISTINCT FROM NEW."factual_release_id" OR
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
