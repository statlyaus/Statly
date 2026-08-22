-- Durable local-only triggers for weekly, newly-qualified, and ad-hoc private valuation execution.

CREATE TABLE "outcome_private_valuation_dispatch_request" (
  "request_id" TEXT PRIMARY KEY,
  "scope_key" TEXT NOT NULL,
  "trigger_kind" TEXT NOT NULL CHECK ("trigger_kind" IN ('weekly','model_qualified','ad_hoc')),
  "scheduled_for" TIMESTAMPTZ(3) NOT NULL,
  "authority_key" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','claimed','completed')),
  "available_at" TIMESTAMPTZ(3) NOT NULL,
  "claim_id" TEXT,
  "lease_token_sha256" CHAR(64),
  "lease_expires_at" TIMESTAMPTZ(3),
  "claimed_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "result_json" JSONB,
  "request_json" JSONB NOT NULL,
  CONSTRAINT "outcome_private_valuation_dispatch_claim_shape" CHECK (
    ("status"='claimed')=("claim_id" IS NOT NULL AND "lease_token_sha256" IS NOT NULL AND "lease_expires_at" IS NOT NULL AND "claimed_at" IS NOT NULL)
  ),
  CONSTRAINT "outcome_private_valuation_dispatch_result_shape" CHECK (
    ("status"='completed')=("completed_at" IS NOT NULL AND "result_json" IS NOT NULL)
  )
);

CREATE INDEX "outcome_private_valuation_dispatch_due_idx"
  ON "outcome_private_valuation_dispatch_request"("status","available_at","scope_key");
CREATE UNIQUE INDEX "outcome_private_valuation_dispatch_ad_hoc_operation_idx"
  ON "outcome_private_valuation_dispatch_request"("scope_key","authority_key")
  WHERE "trigger_kind"='ad_hoc';

CREATE OR REPLACE FUNCTION "create_outcome_private_valuation_dispatch_id"(
  target_scope_key TEXT,target_trigger TEXT,target_scheduled_for TIMESTAMPTZ,target_authority_key TEXT
) RETURNS TEXT LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT 'private-valuation-dispatch:'||encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(jsonb_build_object(
      'scopeKey',target_scope_key,'trigger',target_trigger,
      'scheduledFor',to_char(target_scheduled_for AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'authorityKey',target_authority_key)), 'UTF8')), 'hex')
$$;

CREATE OR REPLACE FUNCTION "enqueue_outcome_private_valuation_dispatch"(
  target_scope_key TEXT,target_trigger TEXT,target_scheduled_for TIMESTAMPTZ,target_authority_key TEXT
) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE target_id TEXT; target_json JSONB;
BEGIN
  IF target_scope_key IS NULL OR btrim(target_scope_key)='' OR length(target_scope_key)>400
    OR target_trigger NOT IN ('weekly','model_qualified','ad_hoc')
    OR target_scheduled_for IS NULL OR target_authority_key IS NULL
    OR btrim(target_authority_key)='' OR length(target_authority_key)>400
  THEN RAISE EXCEPTION 'Private valuation dispatch request is malformed'; END IF;
  target_id:="create_outcome_private_valuation_dispatch_id"(
    target_scope_key,target_trigger,target_scheduled_for,target_authority_key);
  target_json:=jsonb_build_object(
    'requestId',target_id,'scopeKey',target_scope_key,'trigger',target_trigger,
    'scheduledFor',to_char(target_scheduled_for AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'authorityKey',target_authority_key);
  INSERT INTO "outcome_private_valuation_dispatch_request"
    (request_id,scope_key,trigger_kind,scheduled_for,authority_key,available_at,request_json)
  VALUES (target_id,target_scope_key,target_trigger,target_scheduled_for,target_authority_key,target_scheduled_for,target_json)
  ON CONFLICT (request_id) DO NOTHING;
  RETURN target_id;
END $$;

CREATE OR REPLACE FUNCTION "validate_outcome_private_valuation_dispatch_request"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE expected_id TEXT;
BEGIN
  expected_id:="create_outcome_private_valuation_dispatch_id"(
    NEW."scope_key",NEW."trigger_kind",NEW."scheduled_for",NEW."authority_key");
  IF NEW."request_id" IS DISTINCT FROM expected_id
    OR NEW."request_json" IS DISTINCT FROM jsonb_build_object(
      'requestId',expected_id,'scopeKey',NEW."scope_key",'trigger',NEW."trigger_kind",
      'scheduledFor',to_char(NEW."scheduled_for" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'authorityKey',NEW."authority_key")
    OR NEW."available_at" IS DISTINCT FROM NEW."scheduled_for"
    OR NEW."status"<>'pending' OR NEW."claim_id" IS NOT NULL
    OR NEW."lease_token_sha256" IS NOT NULL OR NEW."lease_expires_at" IS NOT NULL
    OR NEW."claimed_at" IS NOT NULL OR NEW."completed_at" IS NOT NULL OR NEW."result_json" IS NOT NULL
  THEN RAISE EXCEPTION 'Private valuation dispatch request custody is invalid'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "outcome_private_valuation_dispatch_request_validate"
BEFORE INSERT ON "outcome_private_valuation_dispatch_request"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_valuation_dispatch_request"();

CREATE OR REPLACE FUNCTION "coalesce_outcome_private_valuation_weekly_dispatch"(
  target_scope_key TEXT,target_scheduled_for TIMESTAMPTZ
) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE target_id TEXT; trusted_at TIMESTAMPTZ(3):=date_trunc('milliseconds',transaction_timestamp());
BEGIN
  IF target_scheduled_for>trusted_at
    OR extract(isodow FROM target_scheduled_for AT TIME ZONE 'Australia/Melbourne')<>1
    OR extract(hour FROM target_scheduled_for AT TIME ZONE 'Australia/Melbourne')<>19
    OR extract(minute FROM target_scheduled_for AT TIME ZONE 'Australia/Melbourne')<>0
    OR date_trunc('minute',target_scheduled_for) IS DISTINCT FROM target_scheduled_for
    OR NOT EXISTS (SELECT 1 FROM "outcome_current_prepared_valuation_input_set"
                    WHERE scope_key=target_scope_key)
  THEN RAISE EXCEPTION 'Weekly private valuation occurrence is not exact current schedule'; END IF;
  target_id:="enqueue_outcome_private_valuation_dispatch"(
    target_scope_key,'weekly',target_scheduled_for,'scheduled');
  UPDATE "outcome_private_valuation_dispatch_request" SET
    status='completed',completed_at=trusted_at,
    result_json=jsonb_build_object('state','superseded_by_startup_catch_up','latestRequestId',target_id),
    claim_id=NULL,lease_token_sha256=NULL,lease_expires_at=NULL,claimed_at=NULL
   WHERE scope_key=target_scope_key AND trigger_kind='weekly'
     AND scheduled_for<target_scheduled_for
     AND (status='pending' OR (status='claimed' AND lease_expires_at<trusted_at));
  RETURN target_id;
END $$;

CREATE OR REPLACE FUNCTION "enqueue_outcome_private_valuation_ad_hoc_dispatch"(
  target_scope_key TEXT,target_operation_key TEXT
) RETURNS TABLE(request_id TEXT,request_json JSONB) LANGUAGE plpgsql AS $$
DECLARE trusted_at TIMESTAMPTZ(3):=date_trunc('milliseconds',transaction_timestamp()); target_id TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "outcome_current_prepared_valuation_input_set"
                  WHERE scope_key=target_scope_key)
  THEN RAISE EXCEPTION 'Ad-hoc private valuation scope is not current'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(target_scope_key||chr(31)||target_operation_key,0));
  RETURN QUERY SELECT request.request_id,request.request_json
    FROM "outcome_private_valuation_dispatch_request" request
   WHERE request.scope_key=target_scope_key AND request.trigger_kind='ad_hoc'
     AND request.authority_key=target_operation_key;
  IF FOUND THEN RETURN; END IF;
  target_id:="enqueue_outcome_private_valuation_dispatch"(
    target_scope_key,'ad_hoc',trusted_at,target_operation_key);
  RETURN QUERY SELECT target_id,request.request_json
    FROM "outcome_private_valuation_dispatch_request" request WHERE request.request_id=target_id;
END $$;

CREATE OR REPLACE FUNCTION "claim_outcome_private_valuation_dispatch"(
  target_worker_id TEXT,target_lease_token_sha256 TEXT,target_lease_seconds INTEGER,
  target_request_id TEXT DEFAULT NULL
) RETURNS TABLE(request_id TEXT,request_json JSONB,claim_id TEXT,lease_expires_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
DECLARE candidate "outcome_private_valuation_dispatch_request"%ROWTYPE; trusted_at TIMESTAMPTZ(3);
BEGIN
  trusted_at:=date_trunc('milliseconds',transaction_timestamp());
  IF target_worker_id IS NULL OR btrim(target_worker_id)='' OR length(target_worker_id)>240
    OR target_lease_token_sha256 !~ '^[a-f0-9]{64}$' OR target_lease_seconds NOT BETWEEN 5 AND 3600
  THEN RAISE EXCEPTION 'Private valuation dispatch claim is malformed'; END IF;
  SELECT * INTO candidate FROM "outcome_private_valuation_dispatch_request" request
     WHERE request."available_at"<=trusted_at
     AND (request."status"='pending' OR (request."status"='claimed' AND request."lease_expires_at"<trusted_at))
     AND (target_request_id IS NULL OR request."request_id"=target_request_id)
   ORDER BY request."scheduled_for",request."request_id" FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  request_id:=candidate."request_id";
  claim_id:='private-valuation-dispatch-claim:'||encode(sha256(convert_to(
    candidate."request_id"||E'\n'||target_worker_id||E'\n'||trusted_at::TEXT,'UTF8')),'hex');
  lease_expires_at:=trusted_at+make_interval(secs=>target_lease_seconds);
  UPDATE "outcome_private_valuation_dispatch_request" SET
    status='claimed',claim_id=claim_outcome_private_valuation_dispatch.claim_id,
    lease_token_sha256=target_lease_token_sha256,claimed_at=trusted_at,
    lease_expires_at=claim_outcome_private_valuation_dispatch.lease_expires_at,
    completed_at=NULL,result_json=NULL
   WHERE outcome_private_valuation_dispatch_request.request_id=candidate.request_id;
  request_json:=candidate."request_json";
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION "complete_outcome_private_valuation_dispatch"(
  target_claim_id TEXT,target_lease_token_sha256 TEXT,target_result JSONB
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE trusted_at TIMESTAMPTZ(3):=date_trunc('milliseconds',transaction_timestamp());
BEGIN
  IF jsonb_typeof(target_result) IS DISTINCT FROM 'object'
    OR target_result->>'state' NOT IN ('activated','already_current','exhausted','unexpected_failure')
    OR target_result IS DISTINCT FROM jsonb_build_object('state',target_result->>'state')
  THEN RAISE EXCEPTION 'Private valuation dispatch result is invalid'; END IF;
  UPDATE "outcome_private_valuation_dispatch_request" SET
    status='completed',completed_at=trusted_at,result_json=target_result,
    claim_id=NULL,lease_token_sha256=NULL,lease_expires_at=NULL,claimed_at=NULL
   WHERE claim_id=target_claim_id AND lease_token_sha256=target_lease_token_sha256
     AND status='claimed' AND lease_expires_at>=trusted_at;
  IF NOT FOUND THEN RAISE EXCEPTION 'Private valuation dispatch claim was lost'; END IF;
END $$;

CREATE OR REPLACE FUNCTION "reschedule_outcome_private_valuation_dispatch"(
  target_claim_id TEXT,target_lease_token_sha256 TEXT,target_state TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE trusted_at TIMESTAMPTZ(3):=date_trunc('milliseconds',transaction_timestamp());
BEGIN
  IF target_state NOT IN ('retry_pending','stale_authority')
  THEN RAISE EXCEPTION 'Private valuation dispatch reschedule state is invalid'; END IF;
  UPDATE "outcome_private_valuation_dispatch_request" SET
    status='pending',available_at=trusted_at+CASE target_state
      WHEN 'retry_pending' THEN interval '5 seconds' ELSE interval '30 seconds' END,
    claim_id=NULL,lease_token_sha256=NULL,lease_expires_at=NULL,claimed_at=NULL
   WHERE claim_id=target_claim_id AND lease_token_sha256=target_lease_token_sha256
     AND status='claimed' AND lease_expires_at>=trusted_at;
  IF NOT FOUND THEN RAISE EXCEPTION 'Private valuation dispatch claim was lost'; END IF;
END $$;

CREATE OR REPLACE FUNCTION "heartbeat_outcome_private_valuation_dispatch"(
  target_claim_id TEXT,target_lease_token_sha256 TEXT
) RETURNS TIMESTAMPTZ LANGUAGE plpgsql AS $$
DECLARE trusted_at TIMESTAMPTZ(3):=date_trunc('milliseconds',transaction_timestamp()); renewed_until TIMESTAMPTZ(3);
BEGIN
  renewed_until:=trusted_at+interval '120 seconds';
  UPDATE "outcome_private_valuation_dispatch_request" SET lease_expires_at=renewed_until
   WHERE claim_id=target_claim_id AND lease_token_sha256=target_lease_token_sha256
     AND status='claimed' AND lease_expires_at>=trusted_at;
  IF NOT FOUND THEN RAISE EXCEPTION 'Private valuation dispatch claim was lost'; END IF;
  RETURN renewed_until;
END $$;

CREATE OR REPLACE FUNCTION "enqueue_outcome_private_valuation_after_model_pair"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' OR OLD."work_id" IS DISTINCT FROM NEW."work_id"
    OR OLD."revision" IS DISTINCT FROM NEW."revision"
  THEN
    PERFORM "enqueue_outcome_private_valuation_dispatch"(
      NEW."scope_key",'model_qualified',date_trunc('milliseconds',transaction_timestamp()),NEW."work_id");
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "outcome_current_model_pair_enqueue_private_valuation"
AFTER INSERT OR UPDATE ON "outcome_current_governed_valuation_model_pair"
FOR EACH ROW EXECUTE FUNCTION "enqueue_outcome_private_valuation_after_model_pair"();

CREATE OR REPLACE FUNCTION "reject_outcome_private_valuation_dispatch_delete"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Private valuation dispatch history is append-only'; END $$;
CREATE TRIGGER "outcome_private_valuation_dispatch_no_delete"
BEFORE DELETE ON "outcome_private_valuation_dispatch_request"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_valuation_dispatch_delete"();

DO $roles$ BEGIN
  BEGIN CREATE ROLE afl_trade_private_valuation_scheduler_owner NOLOGIN;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  EXECUTE format('GRANT afl_trade_private_valuation_scheduler_owner TO %I',current_user);
  EXECUTE format('GRANT USAGE,CREATE ON SCHEMA %I TO afl_trade_private_valuation_scheduler_owner',current_schema());
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO afl_trade_private_evaluation_coordinator',current_schema());
END $roles$;
ALTER TABLE "outcome_private_valuation_dispatch_request" OWNER TO afl_trade_private_valuation_scheduler_owner;
ALTER FUNCTION "enqueue_outcome_private_valuation_dispatch"(TEXT,TEXT,TIMESTAMPTZ,TEXT) OWNER TO afl_trade_private_valuation_scheduler_owner;
ALTER FUNCTION "coalesce_outcome_private_valuation_weekly_dispatch"(TEXT,TIMESTAMPTZ) OWNER TO afl_trade_private_valuation_scheduler_owner;
ALTER FUNCTION "enqueue_outcome_private_valuation_ad_hoc_dispatch"(TEXT,TEXT) OWNER TO afl_trade_private_valuation_scheduler_owner;
ALTER FUNCTION "claim_outcome_private_valuation_dispatch"(TEXT,TEXT,INTEGER,TEXT) OWNER TO afl_trade_private_valuation_scheduler_owner;
ALTER FUNCTION "complete_outcome_private_valuation_dispatch"(TEXT,TEXT,JSONB) OWNER TO afl_trade_private_valuation_scheduler_owner;
ALTER FUNCTION "reschedule_outcome_private_valuation_dispatch"(TEXT,TEXT,TEXT) OWNER TO afl_trade_private_valuation_scheduler_owner;
ALTER FUNCTION "heartbeat_outcome_private_valuation_dispatch"(TEXT,TEXT) OWNER TO afl_trade_private_valuation_scheduler_owner;
ALTER FUNCTION "enqueue_outcome_private_valuation_after_model_pair"() OWNER TO afl_trade_private_valuation_scheduler_owner;
DO $paths$ BEGIN
  EXECUTE format('ALTER FUNCTION %I.enqueue_outcome_private_valuation_dispatch(TEXT,TEXT,TIMESTAMPTZ,TEXT) SECURITY DEFINER SET search_path TO %I,pg_catalog,pg_temp',current_schema(),current_schema());
  EXECUTE format('ALTER FUNCTION %I.coalesce_outcome_private_valuation_weekly_dispatch(TEXT,TIMESTAMPTZ) SECURITY DEFINER SET search_path TO %I,pg_catalog,pg_temp',current_schema(),current_schema());
  EXECUTE format('ALTER FUNCTION %I.enqueue_outcome_private_valuation_ad_hoc_dispatch(TEXT,TEXT) SECURITY DEFINER SET search_path TO %I,pg_catalog,pg_temp',current_schema(),current_schema());
  EXECUTE format('ALTER FUNCTION %I.claim_outcome_private_valuation_dispatch(TEXT,TEXT,INTEGER,TEXT) SECURITY DEFINER SET search_path TO %I,pg_catalog,pg_temp',current_schema(),current_schema());
  EXECUTE format('ALTER FUNCTION %I.complete_outcome_private_valuation_dispatch(TEXT,TEXT,JSONB) SECURITY DEFINER SET search_path TO %I,pg_catalog,pg_temp',current_schema(),current_schema());
  EXECUTE format('ALTER FUNCTION %I.reschedule_outcome_private_valuation_dispatch(TEXT,TEXT,TEXT) SECURITY DEFINER SET search_path TO %I,pg_catalog,pg_temp',current_schema(),current_schema());
  EXECUTE format('ALTER FUNCTION %I.heartbeat_outcome_private_valuation_dispatch(TEXT,TEXT) SECURITY DEFINER SET search_path TO %I,pg_catalog,pg_temp',current_schema(),current_schema());
  EXECUTE format('ALTER FUNCTION %I.enqueue_outcome_private_valuation_after_model_pair() SECURITY DEFINER SET search_path TO %I,pg_catalog,pg_temp',current_schema(),current_schema());
END $paths$;
REVOKE ALL ON "outcome_private_valuation_dispatch_request" FROM PUBLIC,afl_trade_private_evaluation_coordinator;
GRANT SELECT ON "outcome_private_valuation_dispatch_request" TO afl_trade_private_evaluation_coordinator;
GRANT SELECT ON "outcome_current_prepared_valuation_input_set"
  TO afl_trade_private_evaluation_coordinator,afl_trade_private_valuation_scheduler_owner;
REVOKE ALL ON FUNCTION "enqueue_outcome_private_valuation_dispatch"(TEXT,TEXT,TIMESTAMPTZ,TEXT),
  "coalesce_outcome_private_valuation_weekly_dispatch"(TEXT,TIMESTAMPTZ),
  "enqueue_outcome_private_valuation_ad_hoc_dispatch"(TEXT,TEXT),
  "claim_outcome_private_valuation_dispatch"(TEXT,TEXT,INTEGER,TEXT),
  "complete_outcome_private_valuation_dispatch"(TEXT,TEXT,JSONB),
  "reschedule_outcome_private_valuation_dispatch"(TEXT,TEXT,TEXT),
  "heartbeat_outcome_private_valuation_dispatch"(TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "coalesce_outcome_private_valuation_weekly_dispatch"(TEXT,TIMESTAMPTZ),
  "enqueue_outcome_private_valuation_ad_hoc_dispatch"(TEXT,TEXT),
  "claim_outcome_private_valuation_dispatch"(TEXT,TEXT,INTEGER,TEXT),
  "complete_outcome_private_valuation_dispatch"(TEXT,TEXT,JSONB),
  "reschedule_outcome_private_valuation_dispatch"(TEXT,TEXT,TEXT),
  "heartbeat_outcome_private_valuation_dispatch"(TEXT,TEXT)
  TO afl_trade_private_evaluation_coordinator;
DO $membership$ BEGIN
  EXECUTE format('REVOKE afl_trade_private_valuation_scheduler_owner FROM %I',current_user);
END $membership$;
