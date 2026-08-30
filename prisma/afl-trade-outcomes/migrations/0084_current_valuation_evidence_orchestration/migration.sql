-- Retain terminal, private evidence-orchestration outcomes. Review-required is immutable for
-- one stable operation key; continuation after review requires a new operation key.
CREATE TABLE "outcome_current_valuation_evidence_orchestration_operation" (
  "operation_id" TEXT PRIMARY KEY CHECK ("operation_id" ~ '^current-valuation-evidence-orchestration-operation:[a-f0-9]{64}$'),
  "scope_key" TEXT NOT NULL,
  "trigger_kind" TEXT NOT NULL CHECK ("trigger_kind" IN ('weekly','model_qualified','ad_hoc')),
  "stable_operation_key" TEXT NOT NULL UNIQUE,
  "state" TEXT NOT NULL CHECK ("state" IN ('unavailable','complete')),
  "stage" TEXT NOT NULL CHECK ("stage" IN ('capture_authority','capture','normalization_authority','normalization','reconciliation_authority','reconciliation','reviewed_authority','private_factual_authority')),
  "cause" TEXT CHECK ("cause" IN ('missing','stale','mismatched','unauthenticated','review_required')),
  "downstream_operation_id" TEXT,
  "captured_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3) NOT NULL,
  "operation_json" JSONB NOT NULL,
  "result_json" JSONB NOT NULL,
  CHECK ("completed_at">="captured_at"),
  CHECK (("state"='unavailable' AND "stage"<>'private_factual_authority' AND "cause" IS NOT NULL AND "downstream_operation_id" IS NULL)
      OR ("state"='complete' AND "stage"='private_factual_authority' AND "cause" IS NULL AND "downstream_operation_id" IS NOT NULL))
);
CREATE TABLE "outcome_current_valuation_evidence_orchestration_stage_receipt" (
  "receipt_id" TEXT PRIMARY KEY CHECK ("receipt_id" ~ '^current-valuation-evidence-orchestration-stage-receipt:[a-f0-9]{64}$'),
  "scope_key" TEXT NOT NULL,
  "trigger_kind" TEXT NOT NULL CHECK ("trigger_kind" IN ('weekly','model_qualified','ad_hoc')),
  "stable_operation_key" TEXT NOT NULL,
  "source_key" TEXT NOT NULL,
  "observed_capture_id" TEXT NOT NULL,
  "effective_capture_id" TEXT NOT NULL,
  "normalization_run_id" TEXT NOT NULL,
  "receipt_json" JSONB NOT NULL,
  "retained_at" TIMESTAMPTZ(3) NOT NULL,
  UNIQUE ("stable_operation_key","source_key")
);
CREATE TABLE "outcome_current_valuation_evidence_source_work" (
  "stable_operation_key" TEXT NOT NULL,
  "scope_key" TEXT NOT NULL,
  "trigger_kind" TEXT NOT NULL CHECK ("trigger_kind" IN ('weekly','model_qualified','ad_hoc')),
  "source_key" TEXT NOT NULL,
  "observed_capture_id" TEXT NOT NULL UNIQUE REFERENCES "outcome_source_capture"("capture_id") ON DELETE RESTRICT,
  "source_content_sha256" CHAR(64) NOT NULL CHECK ("source_content_sha256" ~ '^[a-f0-9]{64}$'),
  "authority_sha256" CHAR(64) NOT NULL CHECK ("authority_sha256" ~ '^[a-f0-9]{64}$'),
  "retained_at" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("stable_operation_key","source_key")
);
CREATE TABLE "outcome_current_valuation_evidence_normalization_claim" (
  "source_key" TEXT NOT NULL,
  "source_content_sha256" CHAR(64) NOT NULL CHECK ("source_content_sha256" ~ '^[a-f0-9]{64}$'),
  "authority_sha256" CHAR(64) NOT NULL CHECK ("authority_sha256" ~ '^[a-f0-9]{64}$'),
  "effective_capture_id" TEXT NOT NULL REFERENCES "outcome_source_capture"("capture_id") ON DELETE RESTRICT,
  "normalization_run_id" TEXT NOT NULL UNIQUE REFERENCES "outcome_provider_normalization_run"("normalization_run_id") ON DELETE RESTRICT,
  "claimed_at" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("source_key","source_content_sha256","authority_sha256")
);

DO $membership$ BEGIN
  EXECUTE format('GRANT afl_trade_current_valuation_refresh_owner TO %I',current_user);
  EXECUTE format(
    'GRANT USAGE ON SCHEMA %I TO afl_trade_private_evaluation_coordinator',
    current_schema()
  );
END $membership$;

CREATE FUNCTION "reject_outcome_current_valuation_evidence_orchestration_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Current valuation evidence orchestration custody is append-only';
END $$;

CREATE TRIGGER "outcome_current_valuation_evidence_operation_no_mutation"
  BEFORE UPDATE OR DELETE
  ON "outcome_current_valuation_evidence_orchestration_operation"
  FOR EACH ROW
  EXECUTE FUNCTION "reject_outcome_current_valuation_evidence_orchestration_mutation"();
CREATE TRIGGER "outcome_current_valuation_evidence_stage_no_mutation"
  BEFORE UPDATE OR DELETE
  ON "outcome_current_valuation_evidence_orchestration_stage_receipt"
  FOR EACH ROW
  EXECUTE FUNCTION "reject_outcome_current_valuation_evidence_orchestration_mutation"();
CREATE TRIGGER "outcome_current_valuation_evidence_source_work_no_mutation"
  BEFORE UPDATE OR DELETE ON "outcome_current_valuation_evidence_source_work"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_current_valuation_evidence_orchestration_mutation"();
CREATE TRIGGER "outcome_current_valuation_evidence_normalization_claim_no_mutation"
  BEFORE UPDATE OR DELETE ON "outcome_current_valuation_evidence_normalization_claim"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_current_valuation_evidence_orchestration_mutation"();

CREATE FUNCTION "load_outcome_current_valuation_evidence"(
  target_scope_key TEXT,
  target_trigger TEXT,
  target_stable_operation_key TEXT
)
RETURNS TABLE(result_json JSONB,retained_source_keys TEXT[])
LANGUAGE plpgsql AS $$
DECLARE
  retained RECORD;
BEGIN
  IF target_scope_key IS NULL
     OR target_scope_key<>btrim(target_scope_key)
     OR length(target_scope_key) NOT BETWEEN 1 AND 400
     OR target_stable_operation_key IS NULL
     OR target_stable_operation_key<>btrim(target_stable_operation_key)
     OR length(target_stable_operation_key) NOT BETWEEN 1 AND 400
     OR target_trigger IS NULL
     OR target_trigger NOT IN ('weekly','model_qualified','ad_hoc') THEN
    RAISE EXCEPTION 'Current valuation evidence orchestration request is malformed';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(target_stable_operation_key,0));

  SELECT * INTO retained
    FROM "outcome_current_valuation_evidence_orchestration_operation"
   WHERE "stable_operation_key"=target_stable_operation_key;
  IF FOUND THEN
    IF retained."scope_key"<>target_scope_key OR retained."trigger_kind"<>target_trigger THEN
      RAISE EXCEPTION 'Current valuation evidence orchestration request conflicts with retained custody';
    END IF;
    result_json:=retained."result_json";
  END IF;

  SELECT * INTO retained
    FROM "outcome_current_valuation_refresh_operation"
   WHERE "stable_operation_key"=target_stable_operation_key;
  IF FOUND THEN
    RAISE EXCEPTION 'Current valuation evidence orchestration key conflicts with retained refresh custody';
  END IF;
  SELECT * INTO retained
    FROM "outcome_current_valuation_factual_refresh_operation"
   WHERE "stable_operation_key"=target_stable_operation_key;
  IF FOUND THEN
    RAISE EXCEPTION 'Current valuation evidence orchestration key conflicts with retained factual refresh custody';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM "outcome_current_valuation_evidence_orchestration_stage_receipt"
     WHERE "stable_operation_key"=target_stable_operation_key
       AND ("scope_key"<>target_scope_key OR "trigger_kind"<>target_trigger)
  ) THEN
    RAISE EXCEPTION 'Current valuation evidence orchestration stage conflicts with retained custody';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "outcome_current_valuation_evidence_source_work"
     WHERE "stable_operation_key"=target_stable_operation_key
       AND ("scope_key"<>target_scope_key OR "trigger_kind"<>target_trigger)
  ) THEN
    RAISE EXCEPTION 'Current valuation evidence source work conflicts with retained custody';
  END IF;
  SELECT coalesce(array_agg("source_key" ORDER BY "source_key"),'{}'::text[])
    INTO retained_source_keys
    FROM "outcome_current_valuation_evidence_orchestration_stage_receipt"
   WHERE "stable_operation_key"=target_stable_operation_key;
  RETURN NEXT;
END $$;

CREATE FUNCTION "load_outcome_current_valuation_evidence_source_work"(
  target_scope_key TEXT,
  target_trigger TEXT,
  target_stable_operation_key TEXT,
  target_source_key TEXT
)
RETURNS TABLE(
  observed_capture_id TEXT,
  source_content_sha256 TEXT,
  authority_sha256 TEXT,
  source_snapshot_id TEXT,
  manifest_json JSONB
)
LANGUAGE plpgsql AS $$
DECLARE loaded RECORD;
BEGIN
  SELECT * INTO loaded FROM "load_outcome_current_valuation_evidence"(
    target_scope_key,target_trigger,target_stable_operation_key
  );
  IF EXISTS (
    SELECT 1 FROM "outcome_current_valuation_evidence_source_work" work
     WHERE work."stable_operation_key"=target_stable_operation_key
       AND work."source_key"=target_source_key
       AND (work."scope_key"<>target_scope_key OR work."trigger_kind"<>target_trigger)
  ) THEN
    RAISE EXCEPTION 'Current valuation evidence source work conflicts with retained custody';
  END IF;
  RETURN QUERY
  SELECT work."observed_capture_id",work."source_content_sha256"::TEXT,
         work."authority_sha256"::TEXT,capture."source_snapshot_id",capture."manifest_json"
    FROM "outcome_current_valuation_evidence_source_work" work
    JOIN "outcome_source_capture" capture ON capture."capture_id"=work."observed_capture_id"
   WHERE work."stable_operation_key"=target_stable_operation_key
     AND work."source_key"=target_source_key;
END $$;

CREATE FUNCTION "load_outcome_current_valuation_evidence_normalization_claim"(
  target_source_key TEXT,
  target_source_content_sha256 TEXT,
  target_authority_sha256 TEXT
)
RETURNS TABLE(effective_capture_id TEXT,normalization_run_id TEXT)
LANGUAGE plpgsql AS $$
BEGIN
  IF target_source_content_sha256 !~ '^[a-f0-9]{64}$'
     OR target_authority_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Current valuation normalization claim lookup is malformed';
  END IF;
  RETURN QUERY
  SELECT claim."effective_capture_id",claim."normalization_run_id"
    FROM "outcome_current_valuation_evidence_normalization_claim" claim
   WHERE claim."source_key"=target_source_key
     AND claim."source_content_sha256"=target_source_content_sha256
     AND claim."authority_sha256"=target_authority_sha256;
END $$;

CREATE FUNCTION "retain_outcome_current_valuation_evidence_observed_capture"(
  target_scope_key TEXT,
  target_trigger TEXT,
  target_stable_operation_key TEXT,
  target_source_key TEXT,
  target_observed_capture_id TEXT,
  target_source_content_sha256 TEXT,
  target_authority_sha256 TEXT
)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  loaded RECORD;
  retained RECORD;
  expected_provider TEXT;
  expected_capability TEXT;
  expected_season SMALLINT;
  trusted_at TIMESTAMPTZ(3):=statement_timestamp();
BEGIN
  SELECT * INTO loaded FROM "load_outcome_current_valuation_evidence"(
    target_scope_key,target_trigger,target_stable_operation_key
  );
  CASE target_source_key
    WHEN 'afl_tables:afl-tables-player-stats:2021' THEN expected_provider:='afl_tables'; expected_capability:='afl-tables-player-stats'; expected_season:=2021;
    WHEN 'afl_tables:afl-tables-player-stats:2022' THEN expected_provider:='afl_tables'; expected_capability:='afl-tables-player-stats'; expected_season:=2022;
    WHEN 'afl_tables:afl-tables-player-stats:2023' THEN expected_provider:='afl_tables'; expected_capability:='afl-tables-player-stats'; expected_season:=2023;
    WHEN 'afl_tables:afl-tables-player-stats:2024' THEN expected_provider:='afl_tables'; expected_capability:='afl-tables-player-stats'; expected_season:=2024;
    WHEN 'afl_tables:afl-tables-player-stats:2025' THEN expected_provider:='afl_tables'; expected_capability:='afl-tables-player-stats'; expected_season:=2025;
    WHEN 'official_afl:official-afl-player-stats:2026' THEN expected_provider:='official_afl'; expected_capability:='official-afl-player-stats'; expected_season:=2026;
    WHEN 'afl_tables:afl-tables-results:2026' THEN expected_provider:='afl_tables'; expected_capability:='afl-tables-results'; expected_season:=2026;
    ELSE RAISE EXCEPTION 'Current valuation evidence source key is unsupported';
  END CASE;
  IF target_source_content_sha256 !~ '^[a-f0-9]{64}$'
     OR target_authority_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Current valuation observed capture digests are malformed';
  END IF;
  SELECT * INTO retained FROM "outcome_current_valuation_evidence_source_work"
   WHERE "stable_operation_key"=target_stable_operation_key AND "source_key"=target_source_key;
  IF FOUND THEN
    IF retained."observed_capture_id"<>target_observed_capture_id
       OR retained."scope_key"<>target_scope_key
       OR retained."trigger_kind"<>target_trigger
       OR retained."source_content_sha256"<>target_source_content_sha256
       OR retained."authority_sha256"<>target_authority_sha256 THEN
      RAISE EXCEPTION 'Current valuation observed capture conflicts with retained custody';
    END IF;
    RETURN;
  END IF;
  IF loaded.result_json IS NOT NULL THEN
    RAISE EXCEPTION 'Terminal current valuation evidence custody cannot acquire new source work';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "outcome_source_capture" capture
    JOIN "outcome_artifact_custody" artifact ON artifact."artifact_id"=capture."source_artifact_id"
    WHERE capture."capture_id"=target_observed_capture_id
      AND capture."environment"='non_production' AND capture."provider"=expected_provider
      AND capture."capability_id"=expected_capability
      AND capture."anchor_season_year"=expected_season AND capture."status"='staged'
      AND artifact."content_sha256"=target_source_content_sha256
  ) THEN
    RAISE EXCEPTION 'Current valuation observed capture is missing or mismatched';
  END IF;
  INSERT INTO "outcome_current_valuation_evidence_source_work" VALUES (
    target_stable_operation_key,target_scope_key,target_trigger,target_source_key,target_observed_capture_id,
    target_source_content_sha256,target_authority_sha256,trusted_at
  );
END $$;

CREATE FUNCTION "claim_outcome_current_valuation_evidence_normalization"(
  target_source_key TEXT,
  target_source_content_sha256 TEXT,
  target_authority_sha256 TEXT,
  target_effective_capture_id TEXT,
  target_normalization_run_id TEXT
)
RETURNS TABLE(effective_capture_id TEXT,normalization_run_id TEXT)
LANGUAGE plpgsql AS $$
DECLARE
  expected_provider TEXT;
  expected_capability TEXT;
  expected_season SMALLINT;
  expected_field_map_id TEXT;
  retained RECORD;
BEGIN
  CASE target_source_key
    WHEN 'afl_tables:afl-tables-player-stats:2021' THEN expected_provider:='afl_tables'; expected_capability:='afl-tables-player-stats'; expected_season:=2021; expected_field_map_id:='afl-tables-player-stats-local-2021-v1';
    WHEN 'afl_tables:afl-tables-player-stats:2022' THEN expected_provider:='afl_tables'; expected_capability:='afl-tables-player-stats'; expected_season:=2022; expected_field_map_id:='afl-tables-player-stats-local-2022-v1';
    WHEN 'afl_tables:afl-tables-player-stats:2023' THEN expected_provider:='afl_tables'; expected_capability:='afl-tables-player-stats'; expected_season:=2023; expected_field_map_id:='afl-tables-player-stats-local-2023-v1';
    WHEN 'afl_tables:afl-tables-player-stats:2024' THEN expected_provider:='afl_tables'; expected_capability:='afl-tables-player-stats'; expected_season:=2024; expected_field_map_id:='afl-tables-player-stats-local-2024-v1';
    WHEN 'afl_tables:afl-tables-player-stats:2025' THEN expected_provider:='afl_tables'; expected_capability:='afl-tables-player-stats'; expected_season:=2025; expected_field_map_id:='afl-tables-player-stats-local-2025-v1';
    WHEN 'official_afl:official-afl-player-stats:2026' THEN expected_provider:='official_afl'; expected_capability:='official-afl-player-stats'; expected_season:=2026; expected_field_map_id:='official-afl-player-stats-local-2026-v1';
    WHEN 'afl_tables:afl-tables-results:2026' THEN expected_provider:='afl_tables'; expected_capability:='afl-tables-results'; expected_season:=2026; expected_field_map_id:='afl-tables-results-local-2026-v2';
    ELSE RAISE EXCEPTION 'Current valuation evidence source key is unsupported';
  END CASE;
  IF target_source_content_sha256 !~ '^[a-f0-9]{64}$'
     OR target_authority_sha256 !~ '^[a-f0-9]{64}$'
     OR NOT EXISTS (
       SELECT 1 FROM "outcome_source_capture" capture
       JOIN "outcome_artifact_custody" artifact ON artifact."artifact_id"=capture."source_artifact_id"
       JOIN "outcome_provider_normalization_run" run ON run."capture_id"=capture."capture_id"
       WHERE capture."capture_id"=target_effective_capture_id
         AND capture."environment"='non_production' AND capture."provider"=expected_provider
         AND capture."capability_id"=expected_capability AND capture."anchor_season_year"=expected_season
         AND capture."status"='staged' AND artifact."content_sha256"=target_source_content_sha256
         AND run."normalization_run_id"=target_normalization_run_id
         AND run."field_map_id"=expected_field_map_id
         AND run."status" IN ('staged','needs_review') AND run."finalized_at" IS NOT NULL
     )
     OR NOT EXISTS (
       SELECT 1 FROM "outcome_current_valuation_evidence_source_work" work
       WHERE work."source_key"=target_source_key
         AND work."source_content_sha256"=target_source_content_sha256
         AND work."authority_sha256"=target_authority_sha256
     ) THEN
    RAISE EXCEPTION 'Current valuation normalization claim is missing or mismatched';
  END IF;
  INSERT INTO "outcome_current_valuation_evidence_normalization_claim" VALUES (
    target_source_key,target_source_content_sha256,target_authority_sha256,
    target_effective_capture_id,target_normalization_run_id,statement_timestamp()
  ) ON CONFLICT ("source_key","source_content_sha256","authority_sha256") DO NOTHING;
  SELECT claim.* INTO retained FROM "outcome_current_valuation_evidence_normalization_claim" claim
   WHERE claim."source_key"=target_source_key
     AND claim."source_content_sha256"=target_source_content_sha256
     AND claim."authority_sha256"=target_authority_sha256;
  effective_capture_id:=retained."effective_capture_id";
  normalization_run_id:=retained."normalization_run_id";
  RETURN NEXT;
END $$;

CREATE FUNCTION "retain_outcome_current_valuation_evidence_source"(
  target_scope_key TEXT,
  target_trigger TEXT,
  target_stable_operation_key TEXT,
  target_source_key TEXT,
  target_observed_capture_id TEXT,
  target_effective_capture_id TEXT,
  target_normalization_run_id TEXT
)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  loaded RECORD;
  retained RECORD;
  trusted_at TIMESTAMPTZ(3):=statement_timestamp();
  content JSONB;
  rid TEXT;
BEGIN
  SELECT * INTO loaded FROM "load_outcome_current_valuation_evidence"(
    target_scope_key,target_trigger,target_stable_operation_key
  );
  IF loaded.result_json IS NOT NULL THEN RETURN; END IF;

  SELECT * INTO retained
    FROM "outcome_current_valuation_evidence_orchestration_stage_receipt"
   WHERE "stable_operation_key"=target_stable_operation_key
     AND "source_key"=target_source_key;
  IF FOUND THEN
    IF retained."observed_capture_id"<>target_observed_capture_id
       OR retained."effective_capture_id"<>target_effective_capture_id
       OR retained."normalization_run_id"<>target_normalization_run_id THEN
      RAISE EXCEPTION 'Current valuation evidence source conflicts with retained custody';
    END IF;
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "outcome_current_valuation_evidence_source_work" work
    JOIN "outcome_current_valuation_evidence_normalization_claim" claim
      ON claim."source_key"=work."source_key"
     AND claim."source_content_sha256"=work."source_content_sha256"
     AND claim."authority_sha256"=work."authority_sha256"
    WHERE work."stable_operation_key"=target_stable_operation_key
      AND work."source_key"=target_source_key
      AND work."observed_capture_id"=target_observed_capture_id
      AND claim."effective_capture_id"=target_effective_capture_id
      AND claim."normalization_run_id"=target_normalization_run_id
  ) THEN
    RAISE EXCEPTION 'Current valuation normalized source custody is missing or mismatched';
  END IF;
  content:=jsonb_build_object(
    'schemaVersion','afl-current-valuation-evidence-source-receipt/v1',
    'scopeKey',target_scope_key,'trigger',target_trigger,
    'stableOperationKey',target_stable_operation_key,'sourceKey',target_source_key,
    'observedCaptureId',target_observed_capture_id,
    'effectiveCaptureId',target_effective_capture_id,
    'normalizationRunId',target_normalization_run_id,
    'retainedAt',to_char(trusted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  rid:='current-valuation-evidence-orchestration-stage-receipt:'||
    encode(sha256(convert_to("outcome_afl_trade_canonical_json"(content),'UTF8')),'hex');
  INSERT INTO "outcome_current_valuation_evidence_orchestration_stage_receipt" VALUES (
    rid,target_scope_key,target_trigger,target_stable_operation_key,target_source_key,
    target_observed_capture_id,target_effective_capture_id,target_normalization_run_id,
    jsonb_build_object('receiptId',rid,'content',content),trusted_at
  );
END $$;

CREATE FUNCTION "retain_outcome_current_valuation_evidence_unavailable"(
  target_scope_key TEXT,
  target_trigger TEXT,
  target_stable_operation_key TEXT,
  target_stage TEXT,
  target_cause TEXT
)
RETURNS TABLE(operation_id TEXT,operation_json JSONB,result_json JSONB)
LANGUAGE plpgsql AS $$
DECLARE
  trusted_at TIMESTAMPTZ(3):=statement_timestamp();
  loaded RECORD;
  retained RECORD;
  content JSONB;
  oid TEXT;
  limitation CONSTANT TEXT:='Private local non-production evidence orchestration only; human review, public release, production activation, and publication authority are not granted.';
BEGIN
  SELECT * INTO loaded FROM "load_outcome_current_valuation_evidence"(
    target_scope_key,target_trigger,target_stable_operation_key
  );
  IF loaded.result_json IS NOT NULL THEN
    SELECT * INTO retained
      FROM "outcome_current_valuation_evidence_orchestration_operation"
     WHERE "stable_operation_key"=target_stable_operation_key;
    operation_id:=retained."operation_id";
    operation_json:=retained."operation_json";
    result_json:=retained."result_json";
    RETURN NEXT;
    RETURN;
  END IF;
  IF target_stage NOT IN ('capture_authority','capture','normalization_authority','normalization','reconciliation_authority','reconciliation','reviewed_authority')
     OR target_cause NOT IN ('missing','stale','mismatched','unauthenticated','review_required')
     OR (target_cause='review_required' AND target_stage<>'reviewed_authority') THEN
    RAISE EXCEPTION 'Current valuation evidence unavailable outcome is malformed';
  END IF;
  IF target_stage IN ('reconciliation_authority','reconciliation','reviewed_authority')
     AND cardinality(loaded.retained_source_keys)<>7 THEN
    RAISE EXCEPTION 'Current valuation evidence review boundary requires all seven source receipts';
  END IF;

  content:=jsonb_build_object(
    'schemaVersion','afl-current-valuation-evidence-orchestration-operation/v1',
    'scopeKey',target_scope_key,
    'trigger',target_trigger,
    'stableOperationKey',target_stable_operation_key,
    'state','unavailable',
    'stage',target_stage,
    'cause',target_cause,
    'capturedAt',to_char(trusted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  oid:='current-valuation-evidence-orchestration-operation:'||
    encode(sha256(convert_to("outcome_afl_trade_canonical_json"(content),'UTF8')),'hex');
  operation_json:=jsonb_build_object('operationId',oid,'content',content);
  result_json:=jsonb_build_object(
    'schemaVersion','afl-current-valuation-evidence-orchestration-result-v1',
    'operationId',oid,
    'scopeKey',target_scope_key,
    'trigger',target_trigger,
    'stableOperationKey',target_stable_operation_key,
    'state','unavailable',
    'stage',target_stage,
    'cause',target_cause,
    'capturedAt',to_char(trusted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'completedAt',to_char(trusted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'executionLocation','local',
    'visibility','private',
    'environment','non_production',
    'publicationEligible',false,
    'publicationProhibited',true,
    'limitation',limitation
  );
  INSERT INTO "outcome_current_valuation_evidence_orchestration_operation" VALUES (
    oid,target_scope_key,target_trigger,target_stable_operation_key,
    'unavailable',target_stage,target_cause,NULL,trusted_at,trusted_at,
    operation_json,result_json
  );
  operation_id:=oid;
  RETURN NEXT;
END $$;

CREATE FUNCTION "retain_outcome_current_valuation_evidence_complete"(
  target_scope_key TEXT,
  target_trigger TEXT,
  target_stable_operation_key TEXT,
  target_factual_refresh JSONB
)
RETURNS TABLE(operation_id TEXT,operation_json JSONB,result_json JSONB)
LANGUAGE plpgsql AS $$
DECLARE
  trusted_at TIMESTAMPTZ(3):=statement_timestamp();
  loaded RECORD;
  retained RECORD;
  downstream_id TEXT:=target_factual_refresh->>'operationId';
  downstream_state TEXT:=target_factual_refresh->>'state';
  content JSONB;
  oid TEXT;
  limitation CONSTANT TEXT:='Private local non-production evidence orchestration only; human review, public release, production activation, and publication authority are not granted.';
BEGIN
  SELECT * INTO loaded FROM "load_outcome_current_valuation_evidence"(
    target_scope_key,target_trigger,target_stable_operation_key
  );
  IF loaded.result_json IS NOT NULL THEN
    SELECT * INTO retained
      FROM "outcome_current_valuation_evidence_orchestration_operation"
     WHERE "stable_operation_key"=target_stable_operation_key;
    operation_id:=retained."operation_id";
    operation_json:=retained."operation_json";
    result_json:=retained."result_json";
    RETURN NEXT;
    RETURN;
  END IF;
  IF cardinality(loaded.retained_source_keys)<>7 THEN
    RAISE EXCEPTION 'Current valuation evidence orchestration requires all seven source receipts';
  END IF;
  IF jsonb_typeof(target_factual_refresh)<>'object'
     OR target_factual_refresh->>'scopeKey'<>target_scope_key
     OR target_factual_refresh->>'trigger'<>target_trigger
     OR target_factual_refresh->>'stableOperationKey'<>
       'current-valuation-evidence-factual-handoff:'||encode(sha256(convert_to(
         "outcome_afl_trade_canonical_json"(jsonb_build_object(
           'scopeKey',target_scope_key,'trigger',target_trigger,
           'stableOperationKey',target_stable_operation_key
         )),'UTF8')),'hex')
     OR coalesce((target_factual_refresh->>'publicationEligible')::boolean,true)
     OR coalesce((target_factual_refresh->>'publicationProhibited')::boolean,false) IS NOT TRUE
     OR downstream_state NOT IN ('no_change','factual_refresh_complete') THEN
    RAISE EXCEPTION 'Current valuation factual handoff is malformed or grants publication';
  END IF;
  IF downstream_state='factual_refresh_complete' THEN
    SELECT factual.* INTO retained
      FROM "outcome_current_valuation_factual_refresh_operation" factual
     WHERE factual."operation_id"=downstream_id
       AND factual."scope_key"=target_scope_key
       AND factual."trigger_kind"=target_trigger
       AND factual."stable_operation_key"=target_factual_refresh->>'stableOperationKey'
       AND factual."result_json"=target_factual_refresh;
  ELSE
    SELECT legacy.* INTO retained
      FROM "outcome_current_valuation_refresh_operation" legacy
     WHERE legacy."operation_id"=downstream_id
       AND legacy."scope_key"=target_scope_key
       AND legacy."trigger_kind"=target_trigger
       AND legacy."stable_operation_key"=target_factual_refresh->>'stableOperationKey'
       AND legacy."result_json"=target_factual_refresh;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Current valuation factual handoff is not retained exactly';
  END IF;
  content:=jsonb_build_object(
    'schemaVersion','afl-current-valuation-evidence-orchestration-operation/v1',
    'scopeKey',target_scope_key,'trigger',target_trigger,
    'stableOperationKey',target_stable_operation_key,'state','complete',
    'stage','private_factual_authority','downstreamOperationId',downstream_id,
    'capturedAt',to_char(trusted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  oid:='current-valuation-evidence-orchestration-operation:'||
    encode(sha256(convert_to("outcome_afl_trade_canonical_json"(content),'UTF8')),'hex');
  operation_json:=jsonb_build_object('operationId',oid,'content',content);
  result_json:=jsonb_build_object(
    'schemaVersion','afl-current-valuation-evidence-orchestration-result-v1',
    'operationId',oid,'scopeKey',target_scope_key,'trigger',target_trigger,
    'stableOperationKey',target_stable_operation_key,'state','complete',
    'stage','private_factual_authority','currentValuationRefresh',target_factual_refresh,
    'capturedAt',to_char(trusted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'completedAt',to_char(trusted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'executionLocation','local','visibility','private','environment','non_production',
    'publicationEligible',false,'publicationProhibited',true,'limitation',limitation
  );
  INSERT INTO "outcome_current_valuation_evidence_orchestration_operation" VALUES (
    oid,target_scope_key,target_trigger,target_stable_operation_key,
    'complete','private_factual_authority',NULL,downstream_id,trusted_at,trusted_at,
    operation_json,result_json
  );
  operation_id:=oid;
  RETURN NEXT;
END $$;

-- The original exhaustive historical health proof performs three repeated successor lookups for
-- every reviewed candidate. Preserve the exact proof while materializing the admitted current
-- review set once, so the unchanged bundle insert guard remains practical at the full corpus size.
DO $optimize_review_health$
DECLARE
  function_definition TEXT;
  historical_start INTEGER;
  official_start INTEGER;
  optimized_historical TEXT:=$optimized$
WITH candidates AS MATERIALIZED (
    SELECT decoded.provider_decoded_row_id,identity.identity_candidate_id,
           match.match_candidate_id,metric.availability::text AS availability,
           metric.numeric_value,metric.definition_version
      FROM outcome_provider_decoded_row decoded
      JOIN outcome_source_capture capture ON capture.capture_id=decoded.capture_id
      JOIN outcome_provider_normalization_run run
        ON run.normalization_run_id=decoded.normalization_run_id
       AND run.capture_id=decoded.capture_id
      JOIN outcome_provider_identity_candidate identity USING (provider_decoded_row_id)
      JOIN outcome_provider_match_candidate match USING (provider_decoded_row_id)
      JOIN outcome_provider_metric_candidate metric USING (provider_decoded_row_id)
     WHERE capture.provider='afl_tables'
       AND capture.capability_id='afl-tables-player-stats'
       AND capture.environment='non_production'
       AND capture.status='staged'
       AND decoded.season_year BETWEEN 2021 AND 2025
       AND run.finalized_at IS NOT NULL
       AND identity.native_entity_id IS NOT NULL
       AND metric.metric_code='goals'
  ), current_reviews AS MATERIALIZED (
    SELECT decision.decision_id,decision.subject_type,decision.subject_id,
           decision.evidence_json
      FROM outcome_review_decision decision
      LEFT JOIN outcome_review_decision successor
        ON successor.supersedes_decision_id=decision.decision_id
     WHERE decision.decision='approved'
       AND decision.decided_by='local-five-season-evidence-reviewer'
       AND decision.evidence_json->>'evidenceSetSha256'=
         '7ef741add1ae94133c597581f8a2175118058bedd2ffe8a107213630e1b0fd10'
       AND decision.subject_type=ANY(ARRAY[
         'provider_identity_candidate','provider_match_candidate',
         'local_reconciled_player_match_fact'
       ]::text[])
       AND successor.decision_id IS NULL
  )
  SELECT count(*)::integer,
         count(identity_review.decision_id)::integer,
         count(match_review.decision_id)::integer,
         count(factual_review.decision_id)::integer
    INTO historical_candidates,historical_identity,historical_match,historical_facts
    FROM candidates candidate
    LEFT JOIN current_reviews identity_review
      ON identity_review.decision_id=
           'local-afl-tables-review:identity:'||candidate.identity_candidate_id
     AND identity_review.subject_type='provider_identity_candidate'
     AND identity_review.subject_id=candidate.identity_candidate_id
    LEFT JOIN current_reviews match_review
      ON match_review.decision_id='local-afl-tables-review:match:'||candidate.match_candidate_id
     AND match_review.subject_type='provider_match_candidate'
     AND match_review.subject_id=candidate.match_candidate_id
    LEFT JOIN current_reviews factual_review
      ON factual_review.decision_id=
           'local-afl-tables-review:fact:'||candidate.provider_decoded_row_id
     AND factual_review.subject_type='local_reconciled_player_match_fact'
     AND factual_review.subject_id=candidate.provider_decoded_row_id
     AND factual_review.evidence_json->>'identityCandidateId'=candidate.identity_candidate_id
     AND factual_review.evidence_json->>'matchCandidateId'=candidate.match_candidate_id
     AND factual_review.evidence_json->>'metricCode'='goals'
     AND factual_review.evidence_json->>'definitionVersion'=candidate.definition_version
     AND factual_review.evidence_json->>'metricAvailability'=candidate.availability
     AND (factual_review.evidence_json->>'numericValue')::numeric
           IS NOT DISTINCT FROM candidate.numeric_value;

  $optimized$;
BEGIN
  SELECT pg_get_functiondef(to_regprocedure('outcome_private_reviewed_evidence_is_current()'))
    INTO function_definition;
  -- Lightweight repository-contract fixtures install only the orchestration prerequisites.
  IF function_definition IS NULL THEN RETURN; END IF;
  historical_start:=position('WITH candidates AS MATERIALIZED (' IN function_definition);
  official_start:=position('WITH marker AS MATERIALIZED (' IN function_definition);
  IF historical_start=0 OR official_start=0 OR historical_start>=official_start
     OR position('current_reviews AS MATERIALIZED' IN function_definition)>0 THEN
    RAISE EXCEPTION 'Private reviewed-evidence health has unexpected historical proof';
  END IF;
  function_definition:=substring(function_definition FROM 1 FOR historical_start-1)
    ||optimized_historical||substring(function_definition FROM official_start);
  IF position('current_reviews AS MATERIALIZED' IN function_definition)=0 THEN
    RAISE EXCEPTION 'Private reviewed-evidence historical health was not optimized';
  END IF;
  EXECUTE function_definition;
END $optimize_review_health$;

ALTER TABLE "outcome_current_valuation_evidence_orchestration_operation"
  OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER TABLE "outcome_current_valuation_evidence_orchestration_stage_receipt"
  OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER TABLE "outcome_current_valuation_evidence_source_work"
  OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER TABLE "outcome_current_valuation_evidence_normalization_claim"
  OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER FUNCTION "reject_outcome_current_valuation_evidence_orchestration_mutation"()
  OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER FUNCTION "load_outcome_current_valuation_evidence"(TEXT,TEXT,TEXT)
  OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER FUNCTION "load_outcome_current_valuation_evidence_source_work"(TEXT,TEXT,TEXT,TEXT)
  OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER FUNCTION "load_outcome_current_valuation_evidence_normalization_claim"(TEXT,TEXT,TEXT)
  OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER FUNCTION "retain_outcome_current_valuation_evidence_observed_capture"(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)
  OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER FUNCTION "claim_outcome_current_valuation_evidence_normalization"(TEXT,TEXT,TEXT,TEXT,TEXT)
  OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER FUNCTION "retain_outcome_current_valuation_evidence_source"(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)
  OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER FUNCTION "retain_outcome_current_valuation_evidence_unavailable"(TEXT,TEXT,TEXT,TEXT,TEXT)
  OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER FUNCTION "retain_outcome_current_valuation_evidence_complete"(TEXT,TEXT,TEXT,JSONB)
  OWNER TO afl_trade_current_valuation_refresh_owner;
DO $paths$ BEGIN
  EXECUTE format(
    'ALTER FUNCTION %I.load_outcome_current_valuation_evidence(TEXT,TEXT,TEXT) SECURITY DEFINER SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema()
  );
  EXECUTE format(
    'ALTER FUNCTION %I.load_outcome_current_valuation_evidence_source_work(TEXT,TEXT,TEXT,TEXT) SECURITY DEFINER SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema()
  );
  EXECUTE format(
    'ALTER FUNCTION %I.load_outcome_current_valuation_evidence_normalization_claim(TEXT,TEXT,TEXT) SECURITY DEFINER SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema()
  );
  EXECUTE format(
    'ALTER FUNCTION %I.retain_outcome_current_valuation_evidence_observed_capture(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) SECURITY DEFINER SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema()
  );
  EXECUTE format(
    'ALTER FUNCTION %I.claim_outcome_current_valuation_evidence_normalization(TEXT,TEXT,TEXT,TEXT,TEXT) SECURITY DEFINER SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema()
  );
  EXECUTE format(
    'ALTER FUNCTION %I.retain_outcome_current_valuation_evidence_source(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) SECURITY DEFINER SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema()
  );
  EXECUTE format(
    'ALTER FUNCTION %I.retain_outcome_current_valuation_evidence_unavailable(TEXT,TEXT,TEXT,TEXT,TEXT) SECURITY DEFINER SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema()
  );
  EXECUTE format(
    'ALTER FUNCTION %I.retain_outcome_current_valuation_evidence_complete(TEXT,TEXT,TEXT,JSONB) SECURITY DEFINER SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema()
  );
END $paths$;
REVOKE ALL ON "outcome_current_valuation_evidence_orchestration_operation",
  "outcome_current_valuation_evidence_orchestration_stage_receipt",
  "outcome_current_valuation_evidence_source_work",
  "outcome_current_valuation_evidence_normalization_claim"
  FROM PUBLIC,afl_trade_private_evaluation_coordinator;
REVOKE ALL ON FUNCTION "load_outcome_current_valuation_evidence"(TEXT,TEXT,TEXT),
  "load_outcome_current_valuation_evidence_source_work"(TEXT,TEXT,TEXT,TEXT),
  "load_outcome_current_valuation_evidence_normalization_claim"(TEXT,TEXT,TEXT),
  "retain_outcome_current_valuation_evidence_observed_capture"(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT),
  "claim_outcome_current_valuation_evidence_normalization"(TEXT,TEXT,TEXT,TEXT,TEXT),
  "retain_outcome_current_valuation_evidence_source"(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT),
  "retain_outcome_current_valuation_evidence_unavailable"(TEXT,TEXT,TEXT,TEXT,TEXT),
  "retain_outcome_current_valuation_evidence_complete"(TEXT,TEXT,TEXT,JSONB)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "load_outcome_current_valuation_evidence"(TEXT,TEXT,TEXT),
  "load_outcome_current_valuation_evidence_source_work"(TEXT,TEXT,TEXT,TEXT),
  "load_outcome_current_valuation_evidence_normalization_claim"(TEXT,TEXT,TEXT),
  "retain_outcome_current_valuation_evidence_observed_capture"(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT),
  "claim_outcome_current_valuation_evidence_normalization"(TEXT,TEXT,TEXT,TEXT,TEXT),
  "retain_outcome_current_valuation_evidence_source"(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT),
  "retain_outcome_current_valuation_evidence_unavailable"(TEXT,TEXT,TEXT,TEXT,TEXT),
  "retain_outcome_current_valuation_evidence_complete"(TEXT,TEXT,TEXT,JSONB)
  TO afl_trade_private_evaluation_coordinator;
GRANT SELECT ON "outcome_current_valuation_refresh_operation",
  "outcome_current_valuation_factual_refresh_operation",
  "outcome_current_valuation_evidence_orchestration_operation",
  "outcome_current_valuation_evidence_orchestration_stage_receipt",
  "outcome_current_valuation_evidence_source_work",
  "outcome_current_valuation_evidence_normalization_claim",
  "outcome_source_capture","outcome_provider_normalization_run","outcome_artifact_custody"
  TO afl_trade_current_valuation_refresh_owner;
GRANT INSERT ON "outcome_current_valuation_evidence_orchestration_operation",
  "outcome_current_valuation_evidence_orchestration_stage_receipt",
  "outcome_current_valuation_evidence_source_work",
  "outcome_current_valuation_evidence_normalization_claim"
  TO afl_trade_current_valuation_refresh_owner;
GRANT EXECUTE ON FUNCTION "outcome_afl_trade_canonical_json"(JSONB)
  TO afl_trade_current_valuation_refresh_owner;
DO $membership$ BEGIN
  EXECUTE format('REVOKE afl_trade_current_valuation_refresh_owner FROM %I',current_user);
END $membership$;
