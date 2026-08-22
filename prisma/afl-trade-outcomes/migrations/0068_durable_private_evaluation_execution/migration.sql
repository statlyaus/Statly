-- Durable local execution cycles and fenced trade attempts. Earlier migrations remain immutable.

CREATE TABLE "outcome_private_evaluation_execution_cycle" (
  "cycle_id" TEXT PRIMARY KEY,
  "input_fingerprint" TEXT NOT NULL,
  "scope_key" TEXT NOT NULL,
  "prepared_input_set_id" TEXT NOT NULL REFERENCES "outcome_prepared_valuation_input_set"("prepared_input_set_id") ON DELETE RESTRICT,
  "prepared_input_set_revision" INTEGER NOT NULL CHECK ("prepared_input_set_revision">0),
  "factual_release_revision" INTEGER NOT NULL CHECK ("factual_release_revision">0),
  "model_qualification_work_id" TEXT NOT NULL REFERENCES "outcome_governed_model_qualification_work"("work_id") ON DELETE RESTRICT,
  "model_pair_revision" INTEGER NOT NULL CHECK ("model_pair_revision">0),
  "repair_sequence" INTEGER NOT NULL CHECK ("repair_sequence">=0),
  "opening_cause" TEXT NOT NULL CHECK ("opening_cause" IN ('authenticated_inputs_changed','explicit_repair')),
  "opening_principal_id" TEXT NOT NULL CHECK ("opening_principal_id"='system:weekly-valuation-coordinator'),
  "repair_operation_id" TEXT UNIQUE CHECK ("repair_operation_id" IS NULL OR "repair_operation_id" ~ '^cohort-execution-repair:[a-f0-9]{64}$'),
  "repair_reason" TEXT,
  "repairs_cycle_id" TEXT REFERENCES "outcome_private_evaluation_execution_cycle"("cycle_id") ON DELETE RESTRICT,
  "maximum_attempts" INTEGER NOT NULL CHECK ("maximum_attempts"=3),
  "opened_at" TIMESTAMPTZ(3) NOT NULL,
  "cycle_json" JSONB NOT NULL,
  CONSTRAINT "outcome_private_evaluation_execution_cycle_identity" UNIQUE ("input_fingerprint","repair_sequence"),
  CONSTRAINT "outcome_private_evaluation_execution_cycle_id_check" CHECK ("cycle_id" ~ '^cohort-execution-cycle:[a-f0-9]{64}$'),
  CONSTRAINT "outcome_private_evaluation_execution_fingerprint_check" CHECK ("input_fingerprint" ~ '^cohort-execution-input:[a-f0-9]{64}$')
);

CREATE TABLE "outcome_private_evaluation_execution_work" (
  "cycle_id" TEXT NOT NULL REFERENCES "outcome_private_evaluation_execution_cycle"("cycle_id") ON DELETE RESTRICT,
  "trade_id" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('pending','leased','retry_wait','succeeded','unavailable','exhausted')),
  "attempt_count" INTEGER NOT NULL DEFAULT 0 CHECK ("attempt_count" BETWEEN 0 AND 3),
  "available_at" TIMESTAMPTZ(3) NOT NULL,
  "current_claim_id" TEXT,
  "lease_token_sha256" CHAR(64),
  "lease_expires_at" TIMESTAMPTZ(3),
  "heartbeat_at" TIMESTAMPTZ(3),
  "terminal_stage" TEXT,
  "terminal_cause_json" JSONB,
  "result_json" JSONB,
  PRIMARY KEY ("cycle_id","trade_id"),
  CONSTRAINT "outcome_private_evaluation_execution_work_lease_shape" CHECK (
    ("status"='leased')=("current_claim_id" IS NOT NULL AND "lease_token_sha256" IS NOT NULL AND "lease_expires_at" IS NOT NULL AND "heartbeat_at" IS NOT NULL)
  ),
  CONSTRAINT "outcome_private_evaluation_execution_work_terminal_shape" CHECK (
    ("status"='exhausted')=("terminal_stage" IS NOT NULL AND "terminal_cause_json" IS NOT NULL)
  )
);

CREATE INDEX "outcome_private_evaluation_execution_work_claim_idx"
  ON "outcome_private_evaluation_execution_work"("cycle_id","status","available_at","trade_id");

CREATE TABLE "outcome_private_evaluation_execution_attempt" (
  "claim_id" TEXT PRIMARY KEY,
  "cycle_id" TEXT NOT NULL,
  "trade_id" TEXT NOT NULL,
  "attempt_number" INTEGER NOT NULL CHECK ("attempt_number" BETWEEN 1 AND 3),
  "worker_id" TEXT NOT NULL,
  "lease_token_sha256" CHAR(64) NOT NULL CHECK ("lease_token_sha256" ~ '^[a-f0-9]{64}$'),
  "claimed_at" TIMESTAMPTZ(3) NOT NULL,
  "lease_expires_at" TIMESTAMPTZ(3) NOT NULL,
  "heartbeat_at" TIMESTAMPTZ(3) NOT NULL,
  "finished_at" TIMESTAMPTZ(3),
  "outcome" TEXT CHECK ("outcome" IN ('succeeded','unavailable','transient_failure','permanent_failure','lease_expired')),
  "terminal_stage" TEXT,
  "cause_json" JSONB,
  "result_json" JSONB,
  FOREIGN KEY ("cycle_id","trade_id") REFERENCES "outcome_private_evaluation_execution_work"("cycle_id","trade_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_private_evaluation_execution_attempt_number" UNIQUE ("cycle_id","trade_id","attempt_number"),
  CONSTRAINT "outcome_private_evaluation_execution_attempt_id_check" CHECK ("claim_id" ~ '^cohort-execution-claim:[a-f0-9]{64}$'),
  CONSTRAINT "outcome_private_evaluation_execution_attempt_result_shape" CHECK (("finished_at" IS NULL)=("outcome" IS NULL))
);

CREATE OR REPLACE FUNCTION "outcome_private_evaluation_json_object_key_count"(value JSONB)
RETURNS INTEGER LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT count(*)::INTEGER FROM jsonb_object_keys(value)
$$;

CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_execution_cycle"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE content JSONB:=NEW."cycle_json"->'content'; expected_fingerprint TEXT; expected_cycle TEXT;
BEGIN
  expected_fingerprint:='cohort-execution-input:'||encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(jsonb_build_object(
      'scopeKey',NEW."scope_key",'preparedInputSetId',NEW."prepared_input_set_id",
      'preparedInputSetRevision',NEW."prepared_input_set_revision",
      'factualReleaseRevision',NEW."factual_release_revision",
      'modelQualificationWorkId',NEW."model_qualification_work_id",
      'modelPairRevision',NEW."model_pair_revision")),'UTF8')),'hex');
  expected_cycle:='cohort-execution-cycle:'||encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(jsonb_build_object(
      'inputFingerprint',NEW."input_fingerprint",'repairSequence',NEW."repair_sequence")),'UTF8')),'hex');
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
                          AND work."status" NOT IN ('succeeded','unavailable','exhausted')))
  THEN RAISE EXCEPTION 'Private evaluation execution repair lacks a terminal predecessor'; END IF;
  IF jsonb_typeof(NEW."cycle_json") IS DISTINCT FROM 'object'
    OR "outcome_private_evaluation_json_object_key_count"(NEW."cycle_json") IS DISTINCT FROM 2
    OR jsonb_typeof(content) IS DISTINCT FROM 'object'
    OR "outcome_private_evaluation_json_object_key_count"(content) IS DISTINCT FROM 14
    OR jsonb_typeof(content->'authority') IS DISTINCT FROM 'object'
    OR "outcome_private_evaluation_json_object_key_count"(content->'authority') IS DISTINCT FROM 6
    OR jsonb_typeof(content->'repairSequence') IS DISTINCT FROM 'number'
    OR jsonb_typeof(content->'maximumAttemptsPerTrade') IS DISTINCT FROM 'number'
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
    OR content->>'schemaVersion' IS DISTINCT FROM 'private-evaluation-cohort-execution-cycle/v1'
    OR content->>'environment' IS DISTINCT FROM 'non_production'
    OR content->'publicationEligible' IS DISTINCT FROM 'false'::JSONB
    OR content->>'inputFingerprint' IS DISTINCT FROM NEW."input_fingerprint"
    OR content->'authority' IS DISTINCT FROM jsonb_build_object(
      'scopeKey',NEW."scope_key",'preparedInputSetId',NEW."prepared_input_set_id",
      'preparedInputSetRevision',NEW."prepared_input_set_revision",
      'factualReleaseRevision',NEW."factual_release_revision",
      'modelQualificationWorkId',NEW."model_qualification_work_id",
      'modelPairRevision',NEW."model_pair_revision")
    OR (content->>'repairSequence')::INTEGER IS DISTINCT FROM NEW."repair_sequence"
    OR content->>'openingCause' IS DISTINCT FROM NEW."opening_cause"
    OR content->>'openingPrincipalId' IS DISTINCT FROM NEW."opening_principal_id"
    OR content->>'repairOperationId' IS DISTINCT FROM NEW."repair_operation_id"
    OR content->>'repairReason' IS DISTINCT FROM NEW."repair_reason"
    OR content->>'repairsCycleId' IS DISTINCT FROM NEW."repairs_cycle_id"
    OR (content->>'maximumAttemptsPerTrade')::INTEGER IS DISTINCT FROM 3
    OR (content->>'openedAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."opened_at"
    OR content->>'limitation' IS DISTINCT FROM 'Private local execution control only; it grants no factual, model, production, or publication authority.'
    OR (NEW."repair_sequence"=0) IS DISTINCT FROM (NEW."repairs_cycle_id" IS NULL AND NEW."opening_cause"='authenticated_inputs_changed')
    OR (NEW."repair_sequence"=0) IS DISTINCT FROM (NEW."repair_operation_id" IS NULL)
    OR (NEW."repair_sequence"=0) IS DISTINCT FROM (NEW."repair_reason" IS NULL)
    OR (NEW."repair_sequence">0 AND (NEW."repair_reason" IS NULL OR btrim(NEW."repair_reason")=''
      OR length(NEW."repair_reason")>2000))
    OR NOT EXISTS (
      SELECT 1 FROM "outcome_current_prepared_valuation_input_set" prepared
      JOIN "outcome_prepared_valuation_input_set" parent ON parent."prepared_input_set_id"=prepared."prepared_input_set_id"
      JOIN "outcome_active_release" release ON release."scope_key"=parent."factual_release_scope_key" AND release."release_id"=parent."factual_release_id"
      JOIN "outcome_current_governed_valuation_model_pair" model ON model."scope_key"=prepared."scope_key"
       WHERE prepared."scope_key"=NEW."scope_key" AND prepared."prepared_input_set_id"=NEW."prepared_input_set_id"
         AND prepared."revision"=NEW."prepared_input_set_revision" AND release."revision"=NEW."factual_release_revision"
         AND parent."scope_key"=NEW."scope_key"
         AND parent."schema_version"='afl-trade-prepared-valuation-input-set/v3'
         AND parent."environment"='non_production' AND parent."finalized_at" IS NOT NULL
         AND model."work_id"=NEW."model_qualification_work_id" AND model."revision"=NEW."model_pair_revision")
  THEN RAISE EXCEPTION 'Private evaluation execution cycle is not exact current authority'; END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Private evaluation execution cycle is malformed';
END $$;
CREATE TRIGGER "outcome_private_evaluation_execution_cycle_validate"
BEFORE INSERT ON "outcome_private_evaluation_execution_cycle"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_evaluation_execution_cycle"();

CREATE OR REPLACE FUNCTION "reject_outcome_private_evaluation_execution_history_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Private evaluation execution history is append-only'; END $$;
CREATE TRIGGER "outcome_private_evaluation_execution_cycle_no_mutation"
BEFORE UPDATE OR DELETE ON "outcome_private_evaluation_execution_cycle"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_evaluation_execution_history_mutation"();

CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_execution_work_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" IS DISTINCT FROM 'pending'
    OR NEW."attempt_count" IS DISTINCT FROM 0
    OR NEW."available_at">transaction_timestamp()
    OR NEW."current_claim_id" IS NOT NULL
    OR NEW."lease_token_sha256" IS NOT NULL
    OR NEW."lease_expires_at" IS NOT NULL
    OR NEW."heartbeat_at" IS NOT NULL
    OR NEW."terminal_stage" IS NOT NULL
    OR NEW."terminal_cause_json" IS NOT NULL
    OR NEW."result_json" IS NOT NULL
    OR NOT EXISTS (
      SELECT 1
        FROM "outcome_private_evaluation_execution_cycle" cycle
        JOIN "outcome_prepared_valuation_input_entry" entry
          ON entry."prepared_input_set_id"=cycle."prepared_input_set_id"
         AND entry."trade_id"=NEW."trade_id"
       WHERE cycle."cycle_id"=NEW."cycle_id"
         AND entry."state"='ready')
  THEN
    RAISE EXCEPTION 'Private evaluation execution work is not exact ready cycle membership';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "outcome_private_evaluation_execution_work_validate_insert"
BEFORE INSERT ON "outcome_private_evaluation_execution_work"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_evaluation_execution_work_insert"();

CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_execution_work_update"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IS DISTINCT FROM 'afl_trade_private_evaluation_execution_owner'
    OR NEW."cycle_id" IS DISTINCT FROM OLD."cycle_id"
    OR NEW."trade_id" IS DISTINCT FROM OLD."trade_id"
    OR NEW."attempt_count"<OLD."attempt_count"
    OR NEW."attempt_count">OLD."attempt_count"+1
    OR OLD."status" IN ('succeeded','unavailable','exhausted')
    OR (OLD."status"='leased' AND NEW."status" NOT IN ('leased','retry_wait','succeeded','unavailable','exhausted'))
    OR (OLD."status" IN ('pending','retry_wait') AND NEW."status"<>'leased')
    OR (NEW."status"='leased' AND NEW."attempt_count"<>OLD."attempt_count"+CASE WHEN OLD."status"='leased' THEN 0 ELSE 1 END)
    OR (NEW."status"<>'leased' AND (
      NEW."current_claim_id" IS NOT NULL OR NEW."lease_token_sha256" IS NOT NULL
      OR NEW."lease_expires_at" IS NOT NULL OR NEW."heartbeat_at" IS NOT NULL))
    OR (NEW."status" NOT IN ('succeeded','unavailable') AND NEW."result_json" IS NOT NULL)
    OR (NEW."status"='leased' AND NOT EXISTS (
      SELECT 1 FROM "outcome_private_evaluation_execution_attempt" attempt
       WHERE attempt."claim_id"=NEW."current_claim_id" AND attempt."cycle_id"=NEW."cycle_id"
         AND attempt."trade_id"=NEW."trade_id" AND attempt."attempt_number"=NEW."attempt_count"
         AND attempt."lease_token_sha256"=NEW."lease_token_sha256"
         AND attempt."lease_expires_at"=NEW."lease_expires_at"
         AND attempt."heartbeat_at"=NEW."heartbeat_at" AND attempt."finished_at" IS NULL))
    OR (OLD."status"='leased' AND NEW."status"<>'leased' AND NOT EXISTS (
      SELECT 1 FROM "outcome_private_evaluation_execution_attempt" attempt
       WHERE attempt."claim_id"=OLD."current_claim_id" AND attempt."cycle_id"=OLD."cycle_id"
         AND attempt."trade_id"=OLD."trade_id" AND attempt."finished_at" IS NOT NULL
         AND ((NEW."status"='succeeded' AND attempt."outcome"='succeeded')
           OR (NEW."status"='unavailable' AND attempt."outcome"='unavailable')
           OR (NEW."status"='retry_wait' AND attempt."outcome" IN ('transient_failure','lease_expired'))
           OR (NEW."status"='exhausted' AND attempt."outcome" IN ('transient_failure','permanent_failure','lease_expired')))
         AND attempt."result_json" IS NOT DISTINCT FROM NEW."result_json"
         AND (NEW."status"<>'exhausted' OR (
           attempt."terminal_stage" IS NOT DISTINCT FROM NEW."terminal_stage"
           AND attempt."cause_json" IS NOT DISTINCT FROM NEW."terminal_cause_json"))))
  THEN
    RAISE EXCEPTION 'Private evaluation execution work transition is invalid';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "outcome_private_evaluation_execution_work_validate_update"
BEFORE UPDATE ON "outcome_private_evaluation_execution_work"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_evaluation_execution_work_update"();
CREATE TRIGGER "outcome_private_evaluation_execution_work_no_delete"
BEFORE DELETE ON "outcome_private_evaluation_execution_work"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_evaluation_execution_history_mutation"();

CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_execution_attempt_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE work RECORD; expected_claim_id TEXT;
BEGIN
  SELECT * INTO work FROM "outcome_private_evaluation_execution_work"
   WHERE "cycle_id"=NEW."cycle_id" AND "trade_id"=NEW."trade_id" FOR KEY SHARE;
  expected_claim_id:='cohort-execution-claim:'||encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(jsonb_build_object(
      'cycleId',NEW."cycle_id",'tradeId',NEW."trade_id",
      'attemptNumber',NEW."attempt_number",'leaseTokenSha256',NEW."lease_token_sha256")),
    'UTF8')),'hex');
  IF current_user IS DISTINCT FROM 'afl_trade_private_evaluation_execution_owner'
    OR NOT FOUND OR work."status" NOT IN ('pending','retry_wait')
    OR NEW."claim_id" IS DISTINCT FROM expected_claim_id
    OR NEW."attempt_number" IS DISTINCT FROM work."attempt_count"+1
    OR btrim(NEW."worker_id")='' OR length(NEW."worker_id")>400
    OR NEW."claimed_at" IS DISTINCT FROM date_trunc('milliseconds',transaction_timestamp())
    OR NEW."heartbeat_at" IS DISTINCT FROM NEW."claimed_at"
    OR NEW."lease_expires_at" IS DISTINCT FROM NEW."claimed_at"+INTERVAL '120 seconds'
    OR NEW."finished_at" IS NOT NULL OR NEW."outcome" IS NOT NULL
    OR NEW."terminal_stage" IS NOT NULL OR NEW."cause_json" IS NOT NULL OR NEW."result_json" IS NOT NULL
  THEN RAISE EXCEPTION 'Private evaluation execution attempt lacks exact claim custody'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "outcome_private_evaluation_execution_attempt_validate_insert"
BEFORE INSERT ON "outcome_private_evaluation_execution_attempt"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_evaluation_execution_attempt_insert"();

CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_execution_attempt_update"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IS DISTINCT FROM 'afl_trade_private_evaluation_execution_owner'
    OR NEW."claim_id" IS DISTINCT FROM OLD."claim_id"
    OR NEW."cycle_id" IS DISTINCT FROM OLD."cycle_id"
    OR NEW."trade_id" IS DISTINCT FROM OLD."trade_id"
    OR NEW."attempt_number" IS DISTINCT FROM OLD."attempt_number"
    OR NEW."worker_id" IS DISTINCT FROM OLD."worker_id"
    OR NEW."lease_token_sha256" IS DISTINCT FROM OLD."lease_token_sha256"
    OR NEW."claimed_at" IS DISTINCT FROM OLD."claimed_at"
    OR OLD."finished_at" IS NOT NULL
    OR NEW."heartbeat_at"<OLD."heartbeat_at"
    OR NEW."lease_expires_at"<OLD."lease_expires_at"
    OR (NEW."finished_at" IS NULL AND (
      NEW."outcome" IS NOT NULL OR NEW."terminal_stage" IS NOT NULL
      OR NEW."cause_json" IS NOT NULL OR NEW."result_json" IS NOT NULL))
    OR (NEW."finished_at" IS NOT NULL AND (
      NEW."outcome" IS NULL OR NEW."finished_at"<NEW."claimed_at"
      OR (NEW."outcome" IN ('transient_failure','permanent_failure','lease_expired')
        AND (NEW."terminal_stage" IS NULL OR NEW."cause_json" IS NULL))))
  THEN
    RAISE EXCEPTION 'Private evaluation execution attempt transition is invalid';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "outcome_private_evaluation_execution_attempt_validate_update"
BEFORE UPDATE ON "outcome_private_evaluation_execution_attempt"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_evaluation_execution_attempt_update"();
CREATE TRIGGER "outcome_private_evaluation_execution_attempt_no_delete"
BEFORE DELETE ON "outcome_private_evaluation_execution_attempt"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_evaluation_execution_history_mutation"();

CREATE OR REPLACE FUNCTION "claim_outcome_private_evaluation_work"(
  target_cycle_id TEXT,target_trade_id TEXT,target_worker_id TEXT,target_lease_token_sha256 TEXT
) RETURNS TABLE(claim_id TEXT,attempt_number INTEGER,lease_expires_at TIMESTAMPTZ) LANGUAGE plpgsql AS $$
DECLARE work RECORD; now_at TIMESTAMPTZ:=date_trunc('milliseconds',transaction_timestamp()); next_attempt INTEGER; new_claim TEXT;
BEGIN
  SELECT * INTO work FROM "outcome_private_evaluation_execution_work"
   WHERE "cycle_id"=target_cycle_id AND "trade_id"=target_trade_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Private evaluation execution work was not found'; END IF;
  IF work."status"='leased' AND work."lease_expires_at">now_at THEN RETURN; END IF;
  IF work."status"='leased' THEN
    UPDATE "outcome_private_evaluation_execution_attempt" attempt SET "finished_at"=now_at,"outcome"='lease_expired',
      "terminal_stage"='stage_automated',"cause_json"=jsonb_build_object('code','lease_expired','message','Worker lease expired before completion.','retryable',true)
     WHERE attempt."claim_id"=work."current_claim_id";
    IF work."attempt_count">=3 THEN
      UPDATE "outcome_private_evaluation_execution_work" SET "status"='exhausted',"available_at"=now_at,
        "current_claim_id"=NULL,"lease_token_sha256"=NULL,"lease_expires_at"=NULL,"heartbeat_at"=NULL,
        "terminal_stage"='stage_automated',
        "terminal_cause_json"=jsonb_build_object('code','lease_expired','message','Worker lease expired before completion.','retryable',true),
        "result_json"=NULL
       WHERE "cycle_id"=target_cycle_id AND "trade_id"=target_trade_id;
      RETURN;
    END IF;
    UPDATE "outcome_private_evaluation_execution_work" SET "status"='retry_wait',"available_at"=now_at,
      "current_claim_id"=NULL,"lease_token_sha256"=NULL,"lease_expires_at"=NULL,"heartbeat_at"=NULL
     WHERE "cycle_id"=target_cycle_id AND "trade_id"=target_trade_id;
  ELSIF work."status" NOT IN ('pending','retry_wait') OR work."available_at">now_at THEN RETURN; END IF;
  next_attempt:=work."attempt_count"+1;
  IF next_attempt>3 THEN RETURN; END IF;
  new_claim:='cohort-execution-claim:'||encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(jsonb_build_object('cycleId',target_cycle_id,'tradeId',target_trade_id,
      'attemptNumber',next_attempt,'leaseTokenSha256',target_lease_token_sha256)),'UTF8')),'hex');
  INSERT INTO "outcome_private_evaluation_execution_attempt"
    ("claim_id","cycle_id","trade_id","attempt_number","worker_id","lease_token_sha256","claimed_at","lease_expires_at","heartbeat_at")
   VALUES (new_claim,target_cycle_id,target_trade_id,next_attempt,target_worker_id,target_lease_token_sha256,now_at,now_at+INTERVAL '120 seconds',now_at);
  UPDATE "outcome_private_evaluation_execution_work" SET "status"='leased',"attempt_count"=next_attempt,
    "current_claim_id"=new_claim,"lease_token_sha256"=target_lease_token_sha256,
    "lease_expires_at"=now_at+INTERVAL '120 seconds',"heartbeat_at"=now_at
   WHERE "cycle_id"=target_cycle_id AND "trade_id"=target_trade_id;
  RETURN QUERY SELECT new_claim,next_attempt,now_at+INTERVAL '120 seconds';
END $$;

CREATE OR REPLACE FUNCTION "heartbeat_outcome_private_evaluation_work"(
  target_claim_id TEXT,target_lease_token_sha256 TEXT
) RETURNS TIMESTAMPTZ LANGUAGE plpgsql AS $$
DECLARE renewed TIMESTAMPTZ:=date_trunc('milliseconds',transaction_timestamp())+INTERVAL '120 seconds'; updated INTEGER;
BEGIN
  UPDATE "outcome_private_evaluation_execution_attempt" SET "heartbeat_at"=transaction_timestamp(),"lease_expires_at"=renewed
   WHERE "claim_id"=target_claim_id AND "lease_token_sha256"=target_lease_token_sha256
     AND "finished_at" IS NULL AND "lease_expires_at">transaction_timestamp();
  GET DIAGNOSTICS updated=ROW_COUNT;
  IF updated<>1 THEN RAISE EXCEPTION 'Private evaluation execution lease was lost'; END IF;
  UPDATE "outcome_private_evaluation_execution_work" SET "heartbeat_at"=transaction_timestamp(),"lease_expires_at"=renewed
   WHERE "current_claim_id"=target_claim_id AND "status"='leased'
     AND "lease_token_sha256"=target_lease_token_sha256;
  RETURN renewed;
END $$;

CREATE OR REPLACE FUNCTION "complete_outcome_private_evaluation_work"(
  target_claim_id TEXT,target_lease_token_sha256 TEXT,target_outcome TEXT,
  target_stage TEXT,target_cause JSONB,target_result JSONB
) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE work RECORD; now_at TIMESTAMPTZ:=date_trunc('milliseconds',transaction_timestamp()); next_status TEXT; delay_seconds INTEGER; expected_operation_id TEXT;
BEGIN
  SELECT candidate.* INTO work FROM "outcome_private_evaluation_execution_work" candidate
   WHERE candidate."current_claim_id"=target_claim_id FOR UPDATE;
  IF NOT FOUND OR work."status"<>'leased' OR work."lease_token_sha256"<>target_lease_token_sha256
    OR work."lease_expires_at"<=now_at THEN RAISE EXCEPTION 'Private evaluation execution lease was lost'; END IF;
  IF target_outcome NOT IN ('succeeded','unavailable','transient_failure','permanent_failure') THEN
    RAISE EXCEPTION 'Private evaluation execution outcome is invalid'; END IF;
  expected_operation_id:='private-evaluation-operation:'||encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(jsonb_build_object(
      'cycleId',work."cycle_id",'tradeId',work."trade_id")),'UTF8')),'hex');
  IF (target_outcome='succeeded' AND (
      jsonb_typeof(target_result) IS DISTINCT FROM 'object'
      OR "outcome_private_evaluation_json_object_key_count"(target_result) IS DISTINCT FROM 3
      OR target_result->>'state' IS DISTINCT FROM 'activated'
      OR target_result->>'generationId' !~ '^local-private-trade-evaluation-generation:[a-f0-9]{64}$'
      OR NOT EXISTS (SELECT 1 FROM "outcome_local_private_trade_evaluation_generation" generation
          JOIN "outcome_private_evaluation_execution_cycle" cycle ON cycle."cycle_id"=work."cycle_id"
          JOIN "outcome_private_evaluation_transition_intent" intent
            ON intent."transition_intent_id"=generation."transition_intent_id"
          JOIN "outcome_private_evaluation_transition_receipt" receipt
            ON receipt."transition_intent_id"=intent."transition_intent_id"
         WHERE generation."generation_id"=target_result->>'generationId'
           AND generation."valuation_scope_key"=cycle."scope_key"
           AND generation."trade_id"=work."trade_id"
           AND generation."generated_at"=(target_result->>'generatedAt')::TIMESTAMPTZ
           AND intent."operation_id"=expected_operation_id
           AND intent."valuation_scope_key"=cycle."scope_key"
           AND intent."trade_id"=work."trade_id" AND intent."action"='construct_and_activate'
           AND receipt."operation_id"=expected_operation_id
           AND receipt."valuation_scope_key"=cycle."scope_key"
           AND receipt."trade_id"=work."trade_id" AND receipt."action"='construct_and_activate'
           AND receipt."to_status"='active'
           AND receipt."to_generation_id"=generation."generation_id"))
    OR (target_outcome='unavailable' AND (
      jsonb_typeof(target_result) IS DISTINCT FROM 'object'
      OR "outcome_private_evaluation_json_object_key_count"(target_result) IS DISTINCT FROM 2
      OR target_result->>'state' IS DISTINCT FROM 'unavailable'
      OR jsonb_typeof(target_result->'blockers') IS DISTINCT FROM 'array'
      OR jsonb_array_length(target_result->'blockers') NOT BETWEEN 1 AND 10000
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(target_result->'blockers') blocker
                  WHERE jsonb_typeof(blocker) IS DISTINCT FROM 'object'
                     OR "outcome_private_evaluation_json_object_key_count"(blocker) IS DISTINCT FROM 2
                     OR jsonb_typeof(blocker->'code') IS DISTINCT FROM 'string'
                     OR length(btrim(blocker->>'code')) NOT BETWEEN 1 AND 200
                     OR jsonb_typeof(blocker->'message') IS DISTINCT FROM 'string'
                     OR length(btrim(blocker->>'message')) NOT BETWEEN 1 AND 2000)))
    OR (target_outcome IN ('transient_failure','permanent_failure') AND (
      target_stage IS NULL OR jsonb_typeof(target_cause) IS DISTINCT FROM 'object'
      OR "outcome_private_evaluation_json_object_key_count"(target_cause) IS DISTINCT FROM 3
      OR target_cause->>'code' IS NULL
      OR length(btrim(target_cause->>'code')) NOT BETWEEN 1 AND 200
      OR target_cause->>'message' IS NULL
      OR length(btrim(target_cause->>'message')) NOT BETWEEN 1 AND 4000
      OR jsonb_typeof(target_cause->'retryable') IS DISTINCT FROM 'boolean'
      OR (target_cause->'retryable') IS DISTINCT FROM to_jsonb(target_outcome='transient_failure')))
    OR (target_outcome IN ('succeeded','unavailable') AND (target_stage IS NOT NULL OR target_cause IS NOT NULL))
    OR (target_outcome IN ('transient_failure','permanent_failure') AND target_result IS NOT NULL))
  THEN RAISE EXCEPTION 'Private evaluation execution completion custody is invalid'; END IF;
  IF target_outcome='transient_failure' AND work."attempt_count"<3 THEN next_status:='retry_wait';
  ELSIF target_outcome IN ('transient_failure','permanent_failure') THEN next_status:='exhausted';
  ELSE next_status:=target_outcome; END IF;
  delay_seconds:=LEAST(60,(5*power(2,GREATEST(0,work."attempt_count"-1)))::INTEGER);
  UPDATE "outcome_private_evaluation_execution_attempt" SET "finished_at"=now_at,"outcome"=target_outcome,
    "terminal_stage"=target_stage,"cause_json"=target_cause,"result_json"=target_result
   WHERE "claim_id"=target_claim_id;
  UPDATE "outcome_private_evaluation_execution_work" SET "status"=next_status,
    "available_at"=CASE WHEN next_status='retry_wait' THEN now_at+make_interval(secs=>delay_seconds) ELSE now_at END,
    "current_claim_id"=NULL,"lease_token_sha256"=NULL,"lease_expires_at"=NULL,"heartbeat_at"=NULL,
    "terminal_stage"=CASE WHEN next_status='exhausted' THEN target_stage ELSE NULL END,
    "terminal_cause_json"=CASE WHEN next_status='exhausted' THEN target_cause ELSE NULL END,
    "result_json"=CASE WHEN next_status IN ('succeeded','unavailable') THEN target_result ELSE NULL END
   WHERE "cycle_id"=work."cycle_id" AND "trade_id"=work."trade_id";
  RETURN next_status;
END $$;

DO $roles$ BEGIN
  BEGIN CREATE ROLE afl_trade_private_evaluation_execution_owner NOLOGIN;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN CREATE ROLE afl_trade_private_evaluation_coordinator NOLOGIN;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  EXECUTE format('GRANT afl_trade_private_evaluation_execution_owner TO %I',current_user);
  EXECUTE format('GRANT afl_trade_private_evaluation_coordinator TO %I',current_user);
  EXECUTE format('GRANT USAGE,CREATE ON SCHEMA %I TO afl_trade_private_evaluation_execution_owner',current_schema());
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO afl_trade_private_evaluation_coordinator',current_schema());
END $roles$;

ALTER TABLE "outcome_private_evaluation_execution_cycle" OWNER TO afl_trade_private_evaluation_execution_owner;
ALTER TABLE "outcome_private_evaluation_execution_work" OWNER TO afl_trade_private_evaluation_execution_owner;
ALTER TABLE "outcome_private_evaluation_execution_attempt" OWNER TO afl_trade_private_evaluation_execution_owner;
ALTER FUNCTION "claim_outcome_private_evaluation_work"(TEXT,TEXT,TEXT,TEXT) OWNER TO afl_trade_private_evaluation_execution_owner;
ALTER FUNCTION "heartbeat_outcome_private_evaluation_work"(TEXT,TEXT) OWNER TO afl_trade_private_evaluation_execution_owner;
ALTER FUNCTION "complete_outcome_private_evaluation_work"(TEXT,TEXT,TEXT,TEXT,JSONB,JSONB) OWNER TO afl_trade_private_evaluation_execution_owner;

DO $paths$ BEGIN
  EXECUTE format('REVOKE CREATE ON SCHEMA %I FROM PUBLIC,afl_trade_private_evaluation_coordinator',current_schema());
  EXECUTE format('ALTER FUNCTION %I.claim_outcome_private_evaluation_work(TEXT,TEXT,TEXT,TEXT) SECURITY DEFINER SET search_path TO %I,pg_catalog,pg_temp',current_schema(),current_schema());
  EXECUTE format('ALTER FUNCTION %I.heartbeat_outcome_private_evaluation_work(TEXT,TEXT) SECURITY DEFINER SET search_path TO %I,pg_catalog,pg_temp',current_schema(),current_schema());
  EXECUTE format('ALTER FUNCTION %I.complete_outcome_private_evaluation_work(TEXT,TEXT,TEXT,TEXT,JSONB,JSONB) SECURITY DEFINER SET search_path TO %I,pg_catalog,pg_temp',current_schema(),current_schema());
END $paths$;

REVOKE ALL ON "outcome_private_evaluation_execution_attempt" FROM PUBLIC,afl_trade_private_evaluation_coordinator;
REVOKE UPDATE,DELETE ON "outcome_private_evaluation_execution_work" FROM PUBLIC,afl_trade_private_evaluation_coordinator;
REVOKE ALL ON FUNCTION "claim_outcome_private_evaluation_work"(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION "heartbeat_outcome_private_evaluation_work"(TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION "complete_outcome_private_evaluation_work"(TEXT,TEXT,TEXT,TEXT,JSONB,JSONB) FROM PUBLIC;
GRANT SELECT,INSERT ON "outcome_private_evaluation_execution_cycle","outcome_private_evaluation_execution_work" TO afl_trade_private_evaluation_coordinator;
GRANT SELECT ON "outcome_private_evaluation_execution_attempt" TO afl_trade_private_evaluation_coordinator;
GRANT SELECT ON "outcome_current_prepared_valuation_input_set","outcome_prepared_valuation_input_set",
  "outcome_prepared_valuation_input_entry","outcome_active_release",
  "outcome_current_governed_valuation_model_pair","outcome_local_private_trade_evaluation_generation",
  "outcome_private_evaluation_transition_intent","outcome_private_evaluation_transition_receipt"
  TO afl_trade_private_evaluation_execution_owner,afl_trade_private_evaluation_coordinator;
GRANT EXECUTE ON FUNCTION "claim_outcome_private_evaluation_work"(TEXT,TEXT,TEXT,TEXT),
  "heartbeat_outcome_private_evaluation_work"(TEXT,TEXT),
  "complete_outcome_private_evaluation_work"(TEXT,TEXT,TEXT,TEXT,JSONB,JSONB)
  TO afl_trade_private_evaluation_coordinator;
DO $membership$ BEGIN
  EXECUTE format('REVOKE afl_trade_private_evaluation_execution_owner FROM %I',current_user);
END $membership$;
