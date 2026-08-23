-- Admit one exact accepted fitzRoy source chain for non-production private calculation.
-- This is not public factual-release approval and never touches the public registry.

DO $roles$ BEGIN
  EXECUTE format('GRANT afl_trade_private_valuation_scheduler_owner TO %I', session_user);
END $roles$;

GRANT SELECT ON
  "outcome_private_valuation_dispatch_request",
  "outcome_private_valuation_dispatch_attempt",
  "outcome_private_valuation_capture_binding",
  "outcome_provider_fact_batch",
  "outcome_provider_numeric_metric_fact",
  "outcome_provider_player_appearance_fact",
  "outcome_provider_match_universe_fact",
  "outcome_factual_reconciliation_run",
  "outcome_factual_reconciliation_metric_input",
  "outcome_factual_reconciliation_appearance_input",
  "outcome_factual_reconciliation_match_input"
TO afl_trade_private_valuation_scheduler_owner;
GRANT UPDATE ("status") ON "outcome_source_capture"
TO afl_trade_private_valuation_scheduler_owner;
GRANT REFERENCES ON
  "outcome_provider_fact_batch",
  "outcome_factual_reconciliation_run"
TO afl_trade_private_valuation_scheduler_owner;

SET ROLE afl_trade_private_valuation_scheduler_owner;

CREATE UNIQUE INDEX "outcome_private_valuation_capture_binding_id_run_key"
  ON "outcome_private_valuation_capture_binding"("binding_id","normalization_run_id");

CREATE TABLE "outcome_private_valuation_source_admission" (
  "admission_id" TEXT PRIMARY KEY,
  "request_id" TEXT NOT NULL UNIQUE
    REFERENCES "outcome_private_valuation_dispatch_request"("request_id") ON DELETE RESTRICT,
  "capture_binding_id" TEXT NOT NULL UNIQUE
    REFERENCES "outcome_private_valuation_capture_binding"("binding_id") ON DELETE RESTRICT,
  "source_capture_id" TEXT NOT NULL UNIQUE
    REFERENCES "outcome_source_capture"("capture_id") ON DELETE RESTRICT,
  "normalization_run_id" TEXT NOT NULL,
  "fact_batch_id" TEXT NOT NULL
    REFERENCES "outcome_provider_fact_batch"("fact_batch_id") ON DELETE RESTRICT,
  "factual_run_id" TEXT NOT NULL
    REFERENCES "outcome_factual_reconciliation_run"("factual_run_id") ON DELETE RESTRICT,
  "admitted_at" TIMESTAMPTZ(3) NOT NULL,
  "admission_json" JSONB NOT NULL,
  CONSTRAINT "outcome_private_valuation_source_admission_binding_run_fkey"
    FOREIGN KEY ("capture_binding_id","normalization_run_id")
    REFERENCES "outcome_private_valuation_capture_binding"("binding_id","normalization_run_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_private_valuation_source_admission_fact_run_fkey"
    FOREIGN KEY ("fact_batch_id","normalization_run_id")
    REFERENCES "outcome_provider_fact_batch"("fact_batch_id","normalization_run_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_private_valuation_source_admission_id_check" CHECK (
    "admission_id" ~ '^private-valuation-source-admission:[a-f0-9]{64}$'
  ),
  CONSTRAINT "outcome_private_valuation_source_admission_json_check" CHECK (
    jsonb_typeof("admission_json")='object'
  )
);

CREATE UNIQUE INDEX "outcome_private_valuation_source_admission_binding_run_key"
  ON "outcome_private_valuation_source_admission"("capture_binding_id","normalization_run_id");

CREATE OR REPLACE FUNCTION "create_outcome_private_valuation_source_admission_id"(
  target_content JSONB
) RETURNS TEXT LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT 'private-valuation-source-admission:'||encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(target_content),'UTF8')),'hex')
$$;

CREATE OR REPLACE FUNCTION "validate_outcome_private_valuation_source_admission"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE expected_content JSONB;
BEGIN
  expected_content:=NEW."admission_json"->'content';
  IF (SELECT count(*) FROM jsonb_object_keys(NEW."admission_json"))<>2
    OR (SELECT count(*) FROM jsonb_object_keys(expected_content))<>13
    OR NEW."admission_json"->>'admissionId' IS DISTINCT FROM NEW."admission_id"
    OR NEW."admission_id" IS DISTINCT FROM
       "create_outcome_private_valuation_source_admission_id"(expected_content)
    OR expected_content->>'schemaVersion' IS DISTINCT FROM
       'afl-trade-private-valuation-source-admission/v1'
    OR expected_content->>'requestId' IS DISTINCT FROM NEW."request_id"
    OR expected_content->>'captureBindingId' IS DISTINCT FROM NEW."capture_binding_id"
    OR expected_content->>'sourceCaptureId' IS DISTINCT FROM NEW."source_capture_id"
    OR expected_content->>'normalizationRunId' IS DISTINCT FROM NEW."normalization_run_id"
    OR expected_content->>'factBatchId' IS DISTINCT FROM NEW."fact_batch_id"
    OR expected_content->>'factualRunId' IS DISTINCT FROM NEW."factual_run_id"
    OR jsonb_typeof(expected_content->'publicationEligible') IS DISTINCT FROM 'boolean'
    OR (expected_content->'publicationEligible')::boolean IS DISTINCT FROM false
    OR jsonb_typeof(expected_content->'publicationProhibited') IS DISTINCT FROM 'boolean'
    OR (expected_content->'publicationProhibited')::boolean IS DISTINCT FROM true
    OR expected_content->>'principalId' IS DISTINCT FROM 'system:weekly-valuation-coordinator'
    OR expected_content->>'environment' IS DISTINCT FROM 'non_production'
    OR expected_content->>'limitation' IS DISTINCT FROM
       'Non-production private-calculation source admission only; it grants no model, public-display, redistribution, publication, or production authority.'
    OR (expected_content->>'admittedAt')::timestamptz IS DISTINCT FROM NEW."admitted_at"
  THEN
    RAISE EXCEPTION 'Private valuation source admission custody is invalid';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_private_valuation_source_admission_validate"
BEFORE INSERT ON "outcome_private_valuation_source_admission"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_valuation_source_admission"();

CREATE OR REPLACE FUNCTION "reject_outcome_private_valuation_source_admission_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Private valuation source admissions are immutable';
END $$;

CREATE TRIGGER "outcome_private_valuation_source_admission_no_update_delete"
BEFORE UPDATE OR DELETE ON "outcome_private_valuation_source_admission"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_valuation_source_admission_mutation"();

RESET ROLE;

CREATE OR REPLACE FUNCTION "guard_outcome_private_valuation_source_admission_status"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Outcome analytical evidence is append-only';
  END IF;
  IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status')
    OR OLD."status" IS DISTINCT FROM 'staged'::"OutcomeRecordStatus"
    OR NEW."status" IS DISTINCT FROM 'approved'::"OutcomeRecordStatus"
    OR NOT EXISTS (
      SELECT 1 FROM "outcome_private_valuation_source_admission" admission
       WHERE admission."source_capture_id"=NEW."capture_id"
    )
  THEN
    RAISE EXCEPTION 'Source capture status requires exact automated non-production admission';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER "outcome_source_capture_append_only" ON "outcome_source_capture";
CREATE TRIGGER "outcome_source_capture_private_admission_status_guard"
BEFORE UPDATE OR DELETE ON "outcome_source_capture"
FOR EACH ROW EXECUTE FUNCTION "guard_outcome_private_valuation_source_admission_status"();

ALTER FUNCTION "guard_outcome_private_valuation_source_admission_status"()
  OWNER TO afl_trade_private_valuation_scheduler_owner;

SET ROLE afl_trade_private_valuation_scheduler_owner;

CREATE OR REPLACE FUNCTION "admit_outcome_private_valuation_dispatch_source"(
  target_request_id TEXT,
  target_claim_id TEXT,
  target_lease_token_sha256 TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  trusted_at TIMESTAMPTZ(3);
  dispatch_authority RECORD;
  binding RECORD;
  fact_batch RECORD;
  factual_run RECORD;
  retained RECORD;
  fact_batch_count INTEGER;
  factual_run_count INTEGER;
  invalid_input_count INTEGER;
  expected_competition TEXT;
  expected_season INTEGER;
  admission_content JSONB;
  target_admission_id TEXT;
  target_admission_json JSONB;
BEGIN
  IF target_request_id !~ '^private-valuation-dispatch:[a-f0-9]{64}$'
    OR target_claim_id !~ '^private-valuation-dispatch-claim:[a-f0-9]{64}$'
    OR target_lease_token_sha256 !~ '^[a-f0-9]{64}$'
  THEN
    RAISE EXCEPTION 'Private valuation source admission request is malformed';
  END IF;

  SELECT request."request_id",request."scope_key",request."request_json",
         request."claim_id" AS "current_claim_id",
         request."claim_sequence" AS "current_claim_sequence",
         request."lease_token_sha256" AS "current_lease_token_sha256",
         request."lease_expires_at" AS "current_lease_expires_at",
         attempt."attempt_sequence",attempt."lease_token_sha256" AS "attempt_lease_token_sha256",
         attempt."lease_expires_at" AS "attempt_lease_expires_at",
         attempt."finished_at" AS "attempt_finished_at"
    INTO dispatch_authority
    FROM "outcome_private_valuation_dispatch_request" request
    JOIN "outcome_private_valuation_dispatch_attempt" attempt
      ON attempt."request_id"=request."request_id"
     AND attempt."claim_id"=target_claim_id
   WHERE request."request_id"=target_request_id
     AND request."claim_id"=target_claim_id
   FOR UPDATE OF request,attempt;
  trusted_at:=date_trunc('milliseconds',clock_timestamp());
  IF NOT FOUND
    OR dispatch_authority."current_claim_id" IS DISTINCT FROM target_claim_id
    OR dispatch_authority."current_claim_sequence" IS DISTINCT FROM dispatch_authority."attempt_sequence"
    OR dispatch_authority."current_lease_token_sha256" IS DISTINCT FROM target_lease_token_sha256
    OR dispatch_authority."attempt_lease_token_sha256" IS DISTINCT FROM target_lease_token_sha256
    OR dispatch_authority."current_lease_expires_at"<trusted_at
    OR dispatch_authority."attempt_lease_expires_at"<trusted_at
    OR dispatch_authority."attempt_finished_at" IS NOT NULL
  THEN
    RAISE EXCEPTION 'Private valuation source admission lost its live dispatch claim fence';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-private-valuation-source-admission:'||target_request_id,0));
  SELECT * INTO retained FROM "outcome_private_valuation_source_admission"
   WHERE "request_id"=target_request_id FOR SHARE;
  trusted_at:=date_trunc('milliseconds',clock_timestamp());
  IF dispatch_authority."current_lease_expires_at"<trusted_at
    OR dispatch_authority."attempt_lease_expires_at"<trusted_at
  THEN
    RAISE EXCEPTION 'Private valuation source admission lost its live dispatch claim fence';
  END IF;
  IF FOUND THEN
    IF NOT EXISTS (
      SELECT 1 FROM "outcome_source_capture" capture
       WHERE capture."capture_id"=retained."source_capture_id"
         AND capture."status"='approved'
    ) THEN
      RAISE EXCEPTION 'Retained private valuation source admission is not effective';
    END IF;
    RETURN jsonb_build_object(
      'state','already_admitted','admission',retained."admission_json");
  END IF;

  IF dispatch_authority."scope_key" !~ '^afl-(men|women):[0-9]{4}-trades$' THEN
    RAISE EXCEPTION 'Private valuation source admission scope is unsupported';
  END IF;
  expected_competition:=CASE
    WHEN dispatch_authority."scope_key" LIKE 'afl-men:%' THEN 'AFLM'
    ELSE 'AFLW'
  END;
  expected_season:=substring(dispatch_authority."scope_key" FROM ':([0-9]{4})-')::integer;

  SELECT capture_binding."binding_id",capture_binding."source_capture_id",
         capture_binding."normalization_run_id",capture_binding."binding_json",
         capture."status" AS "capture_status"
    INTO binding
    FROM "outcome_private_valuation_capture_binding" capture_binding
    JOIN "outcome_source_capture" capture
      ON capture."capture_id"=capture_binding."source_capture_id"
   WHERE capture_binding."request_id"=target_request_id
   FOR UPDATE OF capture;
  IF NOT FOUND
    OR binding."binding_json"->'content'->'request' IS DISTINCT FROM dispatch_authority."request_json"
    OR binding."binding_json"->'content'->'sourcePlan'->>'competition' IS DISTINCT FROM expected_competition
    OR (binding."binding_json"->'content'->'sourcePlan'->>'seasonYear')::integer
       IS DISTINCT FROM expected_season
    OR binding."capture_status" IS DISTINCT FROM 'staged'::"OutcomeRecordStatus"
  THEN
    RAISE EXCEPTION 'Private valuation source admission capture ancestry is invalid';
  END IF;

  SELECT count(*) INTO fact_batch_count
    FROM "outcome_provider_fact_batch" batch
   WHERE batch."normalization_run_id"=binding."normalization_run_id"
     AND batch."capture_id"=binding."source_capture_id"
     AND batch."environment"='non_production'
     AND batch."status"='approved' AND batch."finalized_at" IS NOT NULL
     AND batch."issue_count"=0 AND batch."non_normalized_row_count"=0
     AND batch."source_row_count"=batch."normalized_row_count";
  IF fact_batch_count<>1 THEN
    RAISE EXCEPTION 'Private valuation source admission requires one exact clean factual batch';
  END IF;
  SELECT * INTO fact_batch FROM "outcome_provider_fact_batch" batch
   WHERE batch."normalization_run_id"=binding."normalization_run_id"
     AND batch."capture_id"=binding."source_capture_id"
     AND batch."environment"='non_production'
     AND batch."status"='approved' AND batch."finalized_at" IS NOT NULL
     AND batch."issue_count"=0 AND batch."non_normalized_row_count"=0
     AND batch."source_row_count"=batch."normalized_row_count";
  IF fact_batch."competition" IS DISTINCT FROM expected_competition
    OR fact_batch."season_year" IS DISTINCT FROM expected_season
    OR fact_batch."provider" IS DISTINCT FROM binding."binding_json"->'content'->'sourcePlan'->>'provider'
    OR fact_batch."capability_id" IS DISTINCT FROM binding."binding_json"->'content'->'sourcePlan'->>'capabilityId'
    OR fact_batch."finalized_at">trusted_at
  THEN
    RAISE EXCEPTION 'Private valuation source admission factual batch is outside scope';
  END IF;

  SELECT count(DISTINCT run."factual_run_id") INTO factual_run_count
    FROM "outcome_factual_reconciliation_run" run
   WHERE run."environment"='non_production'
     AND run."competition"=expected_competition AND run."season_year"=expected_season
     AND run."status"='approved' AND run."finalized_at" IS NOT NULL
     AND run."conflict_count"=0
     AND EXISTS (
       SELECT 1 FROM "outcome_factual_reconciliation_metric_input" input
       JOIN "outcome_provider_numeric_metric_fact" fact
         ON fact."metric_fact_id"=input."metric_fact_id"
      WHERE input."factual_run_id"=run."factual_run_id"
        AND fact."fact_batch_id"=fact_batch."fact_batch_id"
     );
  IF factual_run_count<>1 THEN
    RAISE EXCEPTION 'Private valuation source admission requires one exact clean reconciliation';
  END IF;
  SELECT run.* INTO factual_run
    FROM "outcome_factual_reconciliation_run" run
   WHERE run."environment"='non_production'
     AND run."competition"=expected_competition AND run."season_year"=expected_season
     AND run."status"='approved' AND run."finalized_at" IS NOT NULL
     AND run."conflict_count"=0
     AND EXISTS (
       SELECT 1 FROM "outcome_factual_reconciliation_metric_input" input
       JOIN "outcome_provider_numeric_metric_fact" fact
         ON fact."metric_fact_id"=input."metric_fact_id"
      WHERE input."factual_run_id"=run."factual_run_id"
        AND fact."fact_batch_id"=fact_batch."fact_batch_id"
     );
  SELECT count(*) INTO invalid_input_count FROM (
    SELECT fact."fact_batch_id" FROM "outcome_factual_reconciliation_metric_input" input
    JOIN "outcome_provider_numeric_metric_fact" fact ON fact."metric_fact_id"=input."metric_fact_id"
    WHERE input."factual_run_id"=factual_run."factual_run_id"
    UNION ALL
    SELECT fact."fact_batch_id" FROM "outcome_factual_reconciliation_appearance_input" input
    JOIN "outcome_provider_player_appearance_fact" fact ON fact."appearance_fact_id"=input."appearance_fact_id"
    WHERE input."factual_run_id"=factual_run."factual_run_id"
    UNION ALL
    SELECT fact."fact_batch_id" FROM "outcome_factual_reconciliation_match_input" input
    JOIN "outcome_provider_match_universe_fact" fact ON fact."match_fact_id"=input."match_fact_id"
    WHERE input."factual_run_id"=factual_run."factual_run_id"
  ) inputs WHERE inputs."fact_batch_id" IS DISTINCT FROM fact_batch."fact_batch_id";
  IF invalid_input_count<>0
    OR factual_run."source_fact_count" IS DISTINCT FROM
       (fact_batch."metric_fact_count"+fact_batch."appearance_fact_count"+fact_batch."match_fact_count")
    OR factual_run."finalized_at">trusted_at
  THEN
    RAISE EXCEPTION 'Private valuation source admission reconciliation ancestry is invalid';
  END IF;

  admission_content:=jsonb_build_object(
    'schemaVersion','afl-trade-private-valuation-source-admission/v1',
    'requestId',target_request_id,
    'captureBindingId',binding."binding_id",
    'sourceCaptureId',binding."source_capture_id",
    'normalizationRunId',binding."normalization_run_id",
    'factBatchId',fact_batch."fact_batch_id",
    'factualRunId',factual_run."factual_run_id",
    'admittedAt',to_char(trusted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'principalId','system:weekly-valuation-coordinator',
    'environment','non_production',
    'publicationEligible',false,
    'publicationProhibited',true,
    'limitation','Non-production private-calculation source admission only; it grants no model, public-display, redistribution, publication, or production authority.'
  );
  target_admission_id:="create_outcome_private_valuation_source_admission_id"(admission_content);
  target_admission_json:=jsonb_build_object(
    'admissionId',target_admission_id,'content',admission_content);
  INSERT INTO "outcome_private_valuation_source_admission"(
    "admission_id","request_id","capture_binding_id","source_capture_id",
    "normalization_run_id","fact_batch_id","factual_run_id","admitted_at","admission_json"
  ) VALUES (
    target_admission_id,target_request_id,binding."binding_id",binding."source_capture_id",
    binding."normalization_run_id",fact_batch."fact_batch_id",factual_run."factual_run_id",
    trusted_at,target_admission_json
  );
  UPDATE "outcome_source_capture" SET "status"='approved'
   WHERE "capture_id"=binding."source_capture_id" AND "status"='staged';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Private valuation source admission did not advance exact staged custody';
  END IF;
  RETURN jsonb_build_object(
    'state','admitted','admission',target_admission_json);
END $$;

DO $paths$ BEGIN
  EXECUTE format(
    'ALTER FUNCTION %I.admit_outcome_private_valuation_dispatch_source(TEXT,TEXT,TEXT) SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema());
END $paths$;

REVOKE ALL ON "outcome_private_valuation_source_admission"
  FROM PUBLIC,afl_trade_private_evaluation_coordinator;
GRANT SELECT ON "outcome_private_valuation_source_admission"
  TO afl_trade_private_evaluation_coordinator;
REVOKE ALL ON FUNCTION "admit_outcome_private_valuation_dispatch_source"(TEXT,TEXT,TEXT)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "admit_outcome_private_valuation_dispatch_source"(TEXT,TEXT,TEXT)
  TO afl_trade_private_evaluation_coordinator;

RESET ROLE;

DO $membership$ BEGIN
  EXECUTE format('REVOKE afl_trade_private_valuation_scheduler_owner FROM %I', session_user);
END $membership$;
