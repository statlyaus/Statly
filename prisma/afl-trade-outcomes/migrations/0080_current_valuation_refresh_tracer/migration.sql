-- Retain the first restart-safe no-change slice of the local current-valuation refresh coordinator.
-- No-change means the factual, model, prepared-input, and private-batch heads already agree.

CREATE TABLE "outcome_current_valuation_refresh_operation" (
  "operation_id" TEXT PRIMARY KEY,
  "scope_key" TEXT NOT NULL,
  "trigger_kind" TEXT NOT NULL CHECK ("trigger_kind" IN ('weekly','model_qualified','ad_hoc')),
  "stable_operation_key" TEXT NOT NULL,
  "factual_release_scope_key" TEXT NOT NULL,
  "factual_release_id" TEXT NOT NULL REFERENCES "outcome_release_manifest"("release_id") ON DELETE RESTRICT,
  "factual_release_revision" INTEGER NOT NULL CHECK ("factual_release_revision">0),
  "model_qualification_id" TEXT NOT NULL REFERENCES "outcome_governed_valuation_model_qualification"("qualification_id") ON DELETE RESTRICT,
  "model_qualification_work_id" TEXT NOT NULL REFERENCES "outcome_governed_model_qualification_work"("work_id") ON DELETE RESTRICT,
  "model_pair_revision" INTEGER NOT NULL CHECK ("model_pair_revision">0),
  "prepared_input_set_id" TEXT NOT NULL REFERENCES "outcome_prepared_valuation_input_set"("prepared_input_set_id") ON DELETE RESTRICT,
  "prepared_input_set_revision" INTEGER NOT NULL CHECK ("prepared_input_set_revision">0),
  "private_batch_id" TEXT NOT NULL REFERENCES "outcome_private_evaluation_batch"("batch_id") ON DELETE RESTRICT,
  "private_batch_revision" INTEGER NOT NULL CHECK ("private_batch_revision">0),
  "private_batch_transition_id" TEXT NOT NULL REFERENCES "outcome_private_evaluation_batch_transition"("transition_id") ON DELETE RESTRICT,
  "captured_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3) NOT NULL,
  "operation_json" JSONB NOT NULL,
  "result_json" JSONB NOT NULL,
  CONSTRAINT "outcome_current_valuation_refresh_operation_id_check"
    CHECK ("operation_id" ~ '^current-valuation-refresh-operation:[a-f0-9]{64}$'),
  CONSTRAINT "outcome_current_valuation_refresh_operation_key"
    UNIQUE ("stable_operation_key"),
  CONSTRAINT "outcome_current_valuation_refresh_chronology_check"
    CHECK ("completed_at">="captured_at")
);

CREATE OR REPLACE FUNCTION "current_valuation_refresh_authority_json"(
  factual_scope TEXT,factual_id TEXT,factual_revision INTEGER,
  qualification_id TEXT,qualification_work_id TEXT,model_revision INTEGER,
  prepared_id TEXT,prepared_revision INTEGER,batch_id TEXT,batch_revision INTEGER,
  batch_transition_id TEXT
) RETURNS JSONB LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT jsonb_build_object(
    'factualReleaseScopeKey',factual_scope,
    'factualReleaseId',factual_id,
    'factualReleaseRevision',factual_revision,
    'modelQualificationId',qualification_id,
    'modelQualificationWorkId',qualification_work_id,
    'modelPairRevision',model_revision,
    'preparedInputSetId',prepared_id,
    'preparedInputSetRevision',prepared_revision,
    'privateBatchId',batch_id,
    'privateBatchRevision',batch_revision,
    'privateBatchTransitionId',batch_transition_id)
$$;

CREATE OR REPLACE FUNCTION "current_valuation_refresh_operation_content_json"(
  target_scope_key TEXT,target_trigger TEXT,target_stable_operation_key TEXT,
  target_authority JSONB,target_captured_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT jsonb_build_object(
    'schemaVersion','afl-current-valuation-refresh-operation-v1',
    'scopeKey',target_scope_key,'trigger',target_trigger,
    'stableOperationKey',target_stable_operation_key,'capturedAuthority',target_authority,
    'capturedAt',to_char(target_captured_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'executionLocation','local','visibility','private','environment','non_production',
    'publicationEligible',false,'publicationProhibited',true,
    'limitation','Private local non-production current-authority refresh trace only; no factual, model, prepared-input, private-evaluation, production, activation, or publication authority is granted.')
$$;

CREATE OR REPLACE FUNCTION "current_valuation_refresh_result_json"(
  target_operation_id TEXT,target_scope_key TEXT,target_trigger TEXT,
  target_stable_operation_key TEXT,target_authority JSONB,
  target_captured_at TIMESTAMPTZ,target_completed_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT jsonb_build_object(
    'schemaVersion','afl-current-valuation-refresh-result-v1',
    'operationId',target_operation_id,'scopeKey',target_scope_key,'trigger',target_trigger,
    'stableOperationKey',target_stable_operation_key,'state','no_change',
    'capturedAuthority',target_authority,
    'capturedAt',to_char(target_captured_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'completedAt',to_char(target_completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'executionLocation','local','visibility','private','environment','non_production',
    'publicationEligible',false,'publicationProhibited',true,
    'limitation','Private local non-production current-authority refresh trace only; no factual, model, prepared-input, private-evaluation, production, activation, or publication authority is granted.')
$$;

CREATE OR REPLACE FUNCTION "validate_outcome_current_valuation_refresh_operation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE authority JSONB; operation_content JSONB; expected_id TEXT;
BEGIN
  authority:="current_valuation_refresh_authority_json"(
    NEW."factual_release_scope_key",NEW."factual_release_id",NEW."factual_release_revision",
    NEW."model_qualification_id",NEW."model_qualification_work_id",NEW."model_pair_revision",
    NEW."prepared_input_set_id",NEW."prepared_input_set_revision",NEW."private_batch_id",
    NEW."private_batch_revision",NEW."private_batch_transition_id");
  operation_content:="current_valuation_refresh_operation_content_json"(
    NEW."scope_key",NEW."trigger_kind",NEW."stable_operation_key",authority,NEW."captured_at");
  expected_id:='current-valuation-refresh-operation:'||encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(operation_content),'UTF8')),'hex');
  IF NEW."operation_id" IS DISTINCT FROM expected_id
    OR NEW."operation_json" IS DISTINCT FROM jsonb_build_object(
      'operationId',expected_id,'content',operation_content)
    OR NEW."result_json" IS DISTINCT FROM "current_valuation_refresh_result_json"(
      expected_id,NEW."scope_key",NEW."trigger_kind",NEW."stable_operation_key",authority,
      NEW."captured_at",NEW."completed_at")
    OR NEW."captured_at">statement_timestamp()
    OR NEW."completed_at">statement_timestamp()
    OR NOT EXISTS (
      SELECT 1
        FROM "outcome_current_prepared_valuation_input_set" prepared_head
        JOIN "outcome_prepared_valuation_input_set" prepared
          ON prepared."prepared_input_set_id"=prepared_head."prepared_input_set_id"
        JOIN "outcome_active_release" active_release
          ON active_release."scope_key"=prepared."factual_release_scope_key"
         AND active_release."release_id"=prepared."factual_release_id"
        JOIN "outcome_current_governed_valuation_model_pair" model_head
          ON model_head."scope_key"=prepared_head."scope_key"
        JOIN "outcome_current_private_evaluation_batch" batch_head
          ON batch_head."scope_key"=prepared_head."scope_key"
        JOIN "outcome_private_evaluation_batch" batch
          ON batch."batch_id"=batch_head."batch_id"
        JOIN "outcome_private_evaluation_cohort_batch" batch_binding
          ON batch_binding."batch_id"=batch."batch_id"
        JOIN "outcome_private_evaluation_cohort_capture" batch_capture
          ON batch_capture."operation_id"=batch_binding."operation_id"
       WHERE prepared_head."scope_key"=NEW."scope_key"
         AND prepared."schema_version"='afl-trade-prepared-valuation-input-set/v3'
         AND prepared."environment"='non_production'
         AND prepared."factual_release_scope_key"=NEW."factual_release_scope_key"
         AND active_release."release_id"=NEW."factual_release_id"
         AND active_release."revision"=NEW."factual_release_revision"
         AND model_head."qualification_id"=NEW."model_qualification_id"
         AND model_head."work_id"=NEW."model_qualification_work_id"
         AND model_head."revision"=NEW."model_pair_revision"
         AND prepared_head."prepared_input_set_id"=NEW."prepared_input_set_id"
         AND prepared_head."revision"=NEW."prepared_input_set_revision"
         AND batch."scope_key"=NEW."scope_key"
         AND batch."prepared_input_set_id"=NEW."prepared_input_set_id"
         AND batch."prepared_input_set_revision"=NEW."prepared_input_set_revision"
         AND batch."factual_release_id"=NEW."factual_release_id"
         AND batch."model_qualification_id"=NEW."model_qualification_id"
         AND batch."model_qualification_work_id"=NEW."model_qualification_work_id"
         AND batch_head."batch_id"=NEW."private_batch_id"
         AND batch_head."revision"=NEW."private_batch_revision"
         AND batch_head."last_transition_id"=NEW."private_batch_transition_id"
         AND batch_capture."factual_release_revision"=NEW."factual_release_revision"
         AND batch_capture."model_pair_revision"=NEW."model_pair_revision")
  THEN
    RAISE EXCEPTION 'Current valuation refresh operation custody is invalid';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_current_valuation_refresh_operation_validate"
BEFORE INSERT ON "outcome_current_valuation_refresh_operation"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_current_valuation_refresh_operation"();

CREATE OR REPLACE FUNCTION "reject_outcome_current_valuation_refresh_operation_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Current valuation refresh operation history is append-only';
END $$;
CREATE TRIGGER "outcome_current_valuation_refresh_operation_no_update"
BEFORE UPDATE ON "outcome_current_valuation_refresh_operation"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_current_valuation_refresh_operation_mutation"();
CREATE TRIGGER "outcome_current_valuation_refresh_operation_no_delete"
BEFORE DELETE ON "outcome_current_valuation_refresh_operation"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_current_valuation_refresh_operation_mutation"();

CREATE OR REPLACE FUNCTION "retain_outcome_current_valuation_refresh_no_change"(
  target_scope_key TEXT,target_trigger TEXT,target_stable_operation_key TEXT
) RETURNS TABLE(operation_id TEXT,operation_json JSONB,result_json JSONB)
LANGUAGE plpgsql AS $$
DECLARE current_authority RECORD; retained RECORD; trusted_at TIMESTAMPTZ(3);
  authority JSONB; operation_content JSONB; target_operation_id TEXT;
BEGIN
  IF target_scope_key IS NULL OR target_scope_key IS DISTINCT FROM btrim(target_scope_key)
    OR length(target_scope_key) NOT BETWEEN 1 AND 400
    OR target_trigger IS NULL
    OR target_trigger NOT IN ('weekly','model_qualified','ad_hoc')
    OR target_stable_operation_key IS NULL
    OR target_stable_operation_key IS DISTINCT FROM btrim(target_stable_operation_key)
    OR length(target_stable_operation_key) NOT BETWEEN 1 AND 400
  THEN RAISE EXCEPTION 'Current valuation refresh request is malformed'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(target_stable_operation_key,0));
  SELECT operation.* INTO retained FROM "outcome_current_valuation_refresh_operation" operation
   WHERE operation."stable_operation_key"=target_stable_operation_key;
  IF FOUND THEN
    IF retained."scope_key" IS DISTINCT FROM target_scope_key
      OR retained."trigger_kind" IS DISTINCT FROM target_trigger THEN
      RAISE EXCEPTION 'Current valuation refresh request conflicts with retained custody';
    END IF;
    operation_id:=retained."operation_id";
    operation_json:=retained."operation_json";
    result_json:=retained."result_json";
    RETURN NEXT;
    RETURN;
  END IF;
  trusted_at:=date_trunc('milliseconds',statement_timestamp());
  SELECT prepared."factual_release_scope_key",active_release."release_id" AS factual_release_id,
         active_release."revision" AS factual_release_revision,
         model_head."qualification_id",model_head."work_id",model_head."revision" AS model_pair_revision,
         prepared_head."prepared_input_set_id",prepared_head."revision" AS prepared_input_set_revision,
         batch_head."batch_id",batch_head."revision" AS private_batch_revision,
         batch_head."last_transition_id",batch_capture."factual_release_revision" AS batch_factual_revision,
         batch_capture."model_pair_revision" AS batch_model_revision
    INTO current_authority
    FROM "outcome_current_prepared_valuation_input_set" prepared_head
    JOIN "outcome_prepared_valuation_input_set" prepared
      ON prepared."prepared_input_set_id"=prepared_head."prepared_input_set_id"
    JOIN "outcome_active_release" active_release
      ON active_release."scope_key"=prepared."factual_release_scope_key"
     AND active_release."release_id"=prepared."factual_release_id"
    JOIN "outcome_current_governed_valuation_model_pair" model_head
      ON model_head."scope_key"=prepared_head."scope_key"
    JOIN "outcome_current_private_evaluation_batch" batch_head
      ON batch_head."scope_key"=prepared_head."scope_key"
    JOIN "outcome_private_evaluation_batch" batch ON batch."batch_id"=batch_head."batch_id"
    JOIN "outcome_private_evaluation_cohort_batch" batch_binding
      ON batch_binding."batch_id"=batch."batch_id"
    JOIN "outcome_private_evaluation_cohort_capture" batch_capture
      ON batch_capture."operation_id"=batch_binding."operation_id"
   WHERE prepared_head."scope_key"=target_scope_key
     AND prepared."schema_version"='afl-trade-prepared-valuation-input-set/v3'
     AND prepared."environment"='non_production'
     AND batch."scope_key"=target_scope_key
     AND batch."prepared_input_set_id"=prepared_head."prepared_input_set_id"
     AND batch."prepared_input_set_revision"=prepared_head."revision"
     AND batch."factual_release_id"=active_release."release_id"
     AND batch."model_qualification_id"=model_head."qualification_id"
     AND batch."model_qualification_work_id"=model_head."work_id"
     AND batch_capture."factual_release_revision"=active_release."revision"
     AND batch_capture."model_pair_revision"=model_head."revision";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Current valuation refresh cannot retain no change because governed authority is not current';
  END IF;
  authority:="current_valuation_refresh_authority_json"(
    current_authority."factual_release_scope_key",current_authority."factual_release_id",
    current_authority."factual_release_revision",current_authority."qualification_id",
    current_authority."work_id",current_authority."model_pair_revision",
    current_authority."prepared_input_set_id",current_authority."prepared_input_set_revision",
    current_authority."batch_id",current_authority."private_batch_revision",
    current_authority."last_transition_id");
  operation_content:="current_valuation_refresh_operation_content_json"(
    target_scope_key,target_trigger,target_stable_operation_key,authority,trusted_at);
  target_operation_id:='current-valuation-refresh-operation:'||encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(operation_content),'UTF8')),'hex');
  INSERT INTO "outcome_current_valuation_refresh_operation" (
    operation_id,scope_key,trigger_kind,stable_operation_key,
    factual_release_scope_key,factual_release_id,factual_release_revision,
    model_qualification_id,model_qualification_work_id,model_pair_revision,
    prepared_input_set_id,prepared_input_set_revision,private_batch_id,private_batch_revision,
    private_batch_transition_id,captured_at,completed_at,operation_json,result_json)
  VALUES (
    target_operation_id,target_scope_key,target_trigger,target_stable_operation_key,
    current_authority."factual_release_scope_key",current_authority."factual_release_id",
    current_authority."factual_release_revision",current_authority."qualification_id",
    current_authority."work_id",current_authority."model_pair_revision",
    current_authority."prepared_input_set_id",current_authority."prepared_input_set_revision",
    current_authority."batch_id",current_authority."private_batch_revision",
    current_authority."last_transition_id",trusted_at,trusted_at,
    jsonb_build_object('operationId',target_operation_id,'content',operation_content),
    "current_valuation_refresh_result_json"(
      target_operation_id,target_scope_key,target_trigger,target_stable_operation_key,
      authority,trusted_at,trusted_at));
  operation_id:=target_operation_id;
  operation_json:=jsonb_build_object('operationId',target_operation_id,'content',operation_content);
  SELECT operation."result_json" INTO result_json
    FROM "outcome_current_valuation_refresh_operation" operation
   WHERE operation."operation_id"=target_operation_id;
  RETURN NEXT;
END $$;

DO $roles$ BEGIN
  BEGIN CREATE ROLE afl_trade_current_valuation_refresh_owner NOLOGIN;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN CREATE ROLE afl_trade_private_evaluation_coordinator NOLOGIN;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  EXECUTE format('GRANT afl_trade_current_valuation_refresh_owner TO %I',current_user);
  EXECUTE format('GRANT afl_trade_private_evaluation_coordinator TO %I',current_user);
  EXECUTE format('GRANT USAGE,CREATE ON SCHEMA %I TO afl_trade_current_valuation_refresh_owner',current_schema());
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO afl_trade_private_evaluation_coordinator',current_schema());
END $roles$;

ALTER TABLE "outcome_current_valuation_refresh_operation" OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER FUNCTION "current_valuation_refresh_authority_json"(TEXT,TEXT,INTEGER,TEXT,TEXT,INTEGER,TEXT,INTEGER,TEXT,INTEGER,TEXT) OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER FUNCTION "current_valuation_refresh_operation_content_json"(TEXT,TEXT,TEXT,JSONB,TIMESTAMPTZ) OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER FUNCTION "current_valuation_refresh_result_json"(TEXT,TEXT,TEXT,TEXT,JSONB,TIMESTAMPTZ,TIMESTAMPTZ) OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER FUNCTION "validate_outcome_current_valuation_refresh_operation"() OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER FUNCTION "reject_outcome_current_valuation_refresh_operation_mutation"() OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER FUNCTION "retain_outcome_current_valuation_refresh_no_change"(TEXT,TEXT,TEXT) OWNER TO afl_trade_current_valuation_refresh_owner;

DO $paths$ BEGIN
  EXECUTE format('REVOKE CREATE ON SCHEMA %I FROM PUBLIC,afl_trade_private_evaluation_coordinator',current_schema());
  EXECUTE format('ALTER FUNCTION %I.retain_outcome_current_valuation_refresh_no_change(TEXT,TEXT,TEXT) SECURITY DEFINER SET search_path TO %I,pg_catalog,pg_temp',current_schema(),current_schema());
END $paths$;

REVOKE ALL ON "outcome_current_valuation_refresh_operation"
  FROM PUBLIC,afl_trade_private_evaluation_coordinator;
REVOKE ALL ON FUNCTION "retain_outcome_current_valuation_refresh_no_change"(TEXT,TEXT,TEXT)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "retain_outcome_current_valuation_refresh_no_change"(TEXT,TEXT,TEXT)
  TO afl_trade_private_evaluation_coordinator;
GRANT SELECT ON "outcome_active_release","outcome_prepared_valuation_input_set",
  "outcome_current_prepared_valuation_input_set","outcome_current_governed_valuation_model_pair",
  "outcome_private_evaluation_batch","outcome_current_private_evaluation_batch",
  "outcome_private_evaluation_cohort_batch","outcome_private_evaluation_cohort_capture"
  TO afl_trade_current_valuation_refresh_owner;

DO $membership$ BEGIN
  EXECUTE format('REVOKE afl_trade_current_valuation_refresh_owner FROM %I',current_user);
END $membership$;
