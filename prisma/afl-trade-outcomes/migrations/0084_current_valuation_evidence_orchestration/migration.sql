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
  "capture_id" TEXT NOT NULL,
  "normalization_run_id" TEXT NOT NULL,
  "receipt_json" JSONB NOT NULL,
  "retained_at" TIMESTAMPTZ(3) NOT NULL,
  UNIQUE ("stable_operation_key","source_key")
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
  SELECT coalesce(array_agg("source_key" ORDER BY "source_key"),'{}'::text[])
    INTO retained_source_keys
    FROM "outcome_current_valuation_evidence_orchestration_stage_receipt"
   WHERE "stable_operation_key"=target_stable_operation_key;
  RETURN NEXT;
END $$;

CREATE FUNCTION "retain_outcome_current_valuation_evidence_source"(
  target_scope_key TEXT,
  target_trigger TEXT,
  target_stable_operation_key TEXT,
  target_source_key TEXT,
  target_capture_id TEXT,
  target_normalization_run_id TEXT
)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  loaded RECORD;
  retained RECORD;
  expected_provider TEXT;
  expected_capability TEXT;
  expected_season SMALLINT;
  expected_field_map_id TEXT;
  trusted_at TIMESTAMPTZ(3):=statement_timestamp();
  content JSONB;
  rid TEXT;
BEGIN
  SELECT * INTO loaded FROM "load_outcome_current_valuation_evidence"(
    target_scope_key,target_trigger,target_stable_operation_key
  );
  IF loaded.result_json IS NOT NULL THEN RETURN; END IF;

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

  SELECT * INTO retained
    FROM "outcome_current_valuation_evidence_orchestration_stage_receipt"
   WHERE "stable_operation_key"=target_stable_operation_key
     AND "source_key"=target_source_key;
  IF FOUND THEN
    IF retained."capture_id"<>target_capture_id
       OR retained."normalization_run_id"<>target_normalization_run_id THEN
      RAISE EXCEPTION 'Current valuation evidence source conflicts with retained custody';
    END IF;
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM "outcome_source_capture" capture
      JOIN "outcome_provider_normalization_run" run
        ON run."capture_id"=capture."capture_id"
     WHERE capture."capture_id"=target_capture_id
       AND capture."provider"=expected_provider
       AND capture."capability_id"=expected_capability
       AND capture."anchor_season_year"=expected_season
       AND capture."status"='staged'
       AND run."normalization_run_id"=target_normalization_run_id
       AND run."field_map_id"=expected_field_map_id
       AND run."status" IN ('staged','needs_review')
       AND run."finalized_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Current valuation normalized source custody is missing or mismatched';
  END IF;
  content:=jsonb_build_object(
    'schemaVersion','afl-current-valuation-evidence-source-receipt/v1',
    'scopeKey',target_scope_key,'trigger',target_trigger,
    'stableOperationKey',target_stable_operation_key,'sourceKey',target_source_key,
    'captureId',target_capture_id,'normalizationRunId',target_normalization_run_id,
    'retainedAt',to_char(trusted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  rid:='current-valuation-evidence-orchestration-stage-receipt:'||
    encode(sha256(convert_to("outcome_afl_trade_canonical_json"(content),'UTF8')),'hex');
  INSERT INTO "outcome_current_valuation_evidence_orchestration_stage_receipt" VALUES (
    rid,target_scope_key,target_trigger,target_stable_operation_key,target_source_key,
    target_capture_id,target_normalization_run_id,
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

ALTER TABLE "outcome_current_valuation_evidence_orchestration_operation"
  OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER TABLE "outcome_current_valuation_evidence_orchestration_stage_receipt"
  OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER FUNCTION "reject_outcome_current_valuation_evidence_orchestration_mutation"()
  OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER FUNCTION "load_outcome_current_valuation_evidence"(TEXT,TEXT,TEXT)
  OWNER TO afl_trade_current_valuation_refresh_owner;
ALTER FUNCTION "retain_outcome_current_valuation_evidence_source"(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)
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
    'ALTER FUNCTION %I.retain_outcome_current_valuation_evidence_source(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) SECURITY DEFINER SET search_path TO %I,pg_catalog,pg_temp',
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
  "outcome_current_valuation_evidence_orchestration_stage_receipt"
  FROM PUBLIC,afl_trade_private_evaluation_coordinator;
REVOKE ALL ON FUNCTION "load_outcome_current_valuation_evidence"(TEXT,TEXT,TEXT),
  "retain_outcome_current_valuation_evidence_source"(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT),
  "retain_outcome_current_valuation_evidence_unavailable"(TEXT,TEXT,TEXT,TEXT,TEXT),
  "retain_outcome_current_valuation_evidence_complete"(TEXT,TEXT,TEXT,JSONB)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "load_outcome_current_valuation_evidence"(TEXT,TEXT,TEXT),
  "retain_outcome_current_valuation_evidence_source"(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT),
  "retain_outcome_current_valuation_evidence_unavailable"(TEXT,TEXT,TEXT,TEXT,TEXT),
  "retain_outcome_current_valuation_evidence_complete"(TEXT,TEXT,TEXT,JSONB)
  TO afl_trade_private_evaluation_coordinator;
GRANT SELECT ON "outcome_current_valuation_refresh_operation",
  "outcome_current_valuation_factual_refresh_operation",
  "outcome_current_valuation_evidence_orchestration_operation",
  "outcome_current_valuation_evidence_orchestration_stage_receipt",
  "outcome_source_capture","outcome_provider_normalization_run"
  TO afl_trade_current_valuation_refresh_owner;
GRANT INSERT ON "outcome_current_valuation_evidence_orchestration_operation",
  "outcome_current_valuation_evidence_orchestration_stage_receipt"
  TO afl_trade_current_valuation_refresh_owner;
GRANT EXECUTE ON FUNCTION "outcome_afl_trade_canonical_json"(JSONB)
  TO afl_trade_current_valuation_refresh_owner;
DO $membership$ BEGIN
  EXECUTE format('REVOKE afl_trade_current_valuation_refresh_owner FROM %I',current_user);
END $membership$;
