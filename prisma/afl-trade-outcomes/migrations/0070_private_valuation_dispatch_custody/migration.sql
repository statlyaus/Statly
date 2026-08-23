-- Durable dispatch attempt custody and a bounded outer technical-failure budget.
-- Cohort retry_pending work remains owned and bounded by migration 0068.

DO $roles$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "outcome_private_valuation_dispatch_request" WHERE "status"='claimed'
  ) THEN
    RAISE EXCEPTION 'Private valuation dispatch migration cannot authenticate an active legacy claim';
  END IF;
  EXECUTE format(
    'GRANT afl_trade_private_valuation_scheduler_owner TO %I',
    session_user
  );
END $roles$;

SET ROLE afl_trade_private_valuation_scheduler_owner;

ALTER TABLE "outcome_private_valuation_dispatch_request"
  ADD COLUMN "claim_sequence" INTEGER NOT NULL DEFAULT 0 CHECK ("claim_sequence">=0),
  ADD COLUMN "transient_failure_count" INTEGER NOT NULL DEFAULT 0
    CHECK ("transient_failure_count" BETWEEN 0 AND 3),
  ADD CONSTRAINT "outcome_private_valuation_dispatch_exhaustion_shape" CHECK (
    "transient_failure_count"<3 OR "status"='completed'
  );

CREATE TABLE "outcome_private_valuation_dispatch_attempt" (
  "claim_id" TEXT PRIMARY KEY,
  "request_id" TEXT NOT NULL
    REFERENCES "outcome_private_valuation_dispatch_request"("request_id") ON DELETE RESTRICT,
  "attempt_sequence" INTEGER NOT NULL CHECK ("attempt_sequence">0),
  "attempt_number" INTEGER NOT NULL CHECK ("attempt_number" BETWEEN 1 AND 3),
  "worker_id" TEXT NOT NULL,
  "lease_token_sha256" CHAR(64) NOT NULL
    CHECK ("lease_token_sha256" ~ '^[a-f0-9]{64}$'),
  "claimed_at" TIMESTAMPTZ(3) NOT NULL,
  "lease_expires_at" TIMESTAMPTZ(3) NOT NULL,
  "heartbeat_at" TIMESTAMPTZ(3) NOT NULL,
  "finished_at" TIMESTAMPTZ(3),
  "outcome" TEXT CHECK (
    "outcome" IN (
      'completed','retry_pending','stale_authority','transient_failure',
      'lease_expired','superseded'
    )
  ),
  "result_json" JSONB,
  CONSTRAINT "outcome_private_valuation_dispatch_attempt_sequence"
    UNIQUE ("request_id","attempt_sequence"),
  CONSTRAINT "outcome_private_valuation_dispatch_attempt_fence"
    UNIQUE ("request_id","attempt_sequence","claim_id"),
  CONSTRAINT "outcome_private_valuation_dispatch_attempt_chronology" CHECK (
    "lease_expires_at">"claimed_at" AND "heartbeat_at">="claimed_at"
      AND ("finished_at" IS NULL OR "finished_at">="claimed_at")
  ),
  CONSTRAINT "outcome_private_valuation_dispatch_attempt_result_shape" CHECK (
    ("finished_at" IS NULL)=("outcome" IS NULL AND "result_json" IS NULL)
  )
);

CREATE INDEX "outcome_private_valuation_dispatch_attempt_request_idx"
  ON "outcome_private_valuation_dispatch_attempt"("request_id","attempt_sequence");

CREATE OR REPLACE FUNCTION "create_outcome_private_valuation_dispatch_claim_id"(
  target_request_id TEXT,
  target_attempt_sequence INTEGER,
  target_worker_id TEXT,
  target_lease_token_sha256 TEXT
) RETURNS TEXT LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT 'private-valuation-dispatch-claim:'||encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(jsonb_build_object(
      'requestId',target_request_id,
      'attemptSequence',target_attempt_sequence,
      'workerId',target_worker_id,
      'leaseTokenSha256',target_lease_token_sha256
    )), 'UTF8')), 'hex')
$$;

DROP TRIGGER "outcome_private_valuation_dispatch_request_validate"
  ON "outcome_private_valuation_dispatch_request";

CREATE OR REPLACE FUNCTION "validate_outcome_private_valuation_dispatch_request_v2"()
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
    OR NEW."status"<>'pending'
    OR NEW."claim_sequence"<>0 OR NEW."transient_failure_count"<>0
    OR NEW."claim_id" IS NOT NULL OR NEW."lease_token_sha256" IS NOT NULL
    OR NEW."lease_expires_at" IS NOT NULL OR NEW."claimed_at" IS NOT NULL
    OR NEW."completed_at" IS NOT NULL OR NEW."result_json" IS NOT NULL
  THEN
    RAISE EXCEPTION 'Private valuation dispatch request custody is invalid';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_private_valuation_dispatch_request_validate_v2"
BEFORE INSERT ON "outcome_private_valuation_dispatch_request"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_valuation_dispatch_request_v2"();

CREATE OR REPLACE FUNCTION "validate_outcome_private_valuation_dispatch_attempt_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE request RECORD; expected_claim_id TEXT;
BEGIN
  SELECT * INTO request
    FROM "outcome_private_valuation_dispatch_request"
   WHERE "request_id"=NEW."request_id" FOR KEY SHARE;
  expected_claim_id:="create_outcome_private_valuation_dispatch_claim_id"(
    NEW."request_id",NEW."attempt_sequence",NEW."worker_id",NEW."lease_token_sha256");
  IF current_user IS DISTINCT FROM 'afl_trade_private_valuation_scheduler_owner'
    OR NOT FOUND OR request."status"<>'pending'
    OR NEW."claim_id" IS DISTINCT FROM expected_claim_id
    OR NEW."attempt_sequence"<>request."claim_sequence"+1
    OR NEW."attempt_number"<>request."transient_failure_count"+1
    OR btrim(NEW."worker_id")='' OR length(NEW."worker_id")>240
    OR NEW."claimed_at">date_trunc('milliseconds',clock_timestamp())
    OR NEW."claimed_at"<date_trunc('milliseconds',clock_timestamp())-interval '1 second'
    OR NEW."heartbeat_at" IS DISTINCT FROM NEW."claimed_at"
    OR NEW."lease_expires_at"<=NEW."claimed_at"
    OR NEW."finished_at" IS NOT NULL OR NEW."outcome" IS NOT NULL
    OR NEW."result_json" IS NOT NULL
  THEN
    RAISE EXCEPTION 'Private valuation dispatch attempt lacks exact claim custody';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_private_valuation_dispatch_attempt_validate_insert"
BEFORE INSERT ON "outcome_private_valuation_dispatch_attempt"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_valuation_dispatch_attempt_insert"();

CREATE OR REPLACE FUNCTION "validate_outcome_private_valuation_dispatch_attempt_update"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IS DISTINCT FROM 'afl_trade_private_valuation_scheduler_owner'
    OR NEW."claim_id" IS DISTINCT FROM OLD."claim_id"
    OR NEW."request_id" IS DISTINCT FROM OLD."request_id"
    OR NEW."attempt_sequence" IS DISTINCT FROM OLD."attempt_sequence"
    OR NEW."attempt_number" IS DISTINCT FROM OLD."attempt_number"
    OR NEW."worker_id" IS DISTINCT FROM OLD."worker_id"
    OR NEW."lease_token_sha256" IS DISTINCT FROM OLD."lease_token_sha256"
    OR NEW."claimed_at" IS DISTINCT FROM OLD."claimed_at"
    OR OLD."finished_at" IS NOT NULL
    OR NEW."heartbeat_at"<OLD."heartbeat_at"
    OR NEW."lease_expires_at"<OLD."lease_expires_at"
    OR NEW."heartbeat_at">date_trunc('milliseconds',clock_timestamp())
    OR NEW."finished_at">date_trunc('milliseconds',clock_timestamp())
    OR (NEW."finished_at" IS NULL AND (
      NEW."outcome" IS NOT NULL OR NEW."result_json" IS NOT NULL))
    OR (NEW."finished_at" IS NOT NULL AND (
      NEW."outcome" IS NULL OR jsonb_typeof(NEW."result_json") IS DISTINCT FROM 'object'))
    OR (NEW."outcome"='completed' AND (
      NEW."result_json"->>'state' NOT IN ('activated','already_current','exhausted','unexpected_failure')
      OR NEW."result_json" IS DISTINCT FROM jsonb_build_object('state',NEW."result_json"->>'state')))
    OR (NEW."outcome"='retry_pending'
      AND NEW."result_json" IS DISTINCT FROM jsonb_build_object('state','retry_pending'))
    OR (NEW."outcome"='stale_authority'
      AND NEW."result_json" IS DISTINCT FROM jsonb_build_object('state','stale_authority'))
    OR (NEW."outcome"='transient_failure'
      AND NEW."result_json" IS DISTINCT FROM jsonb_build_object('state','transient_failure'))
    OR (NEW."outcome"='lease_expired'
      AND NEW."result_json" IS DISTINCT FROM jsonb_build_object('state','lease_expired'))
    OR (NEW."outcome"='superseded' AND (
      NEW."result_json"->>'state' IS DISTINCT FROM 'superseded_by_startup_catch_up'
      OR NEW."result_json"->>'latestRequestId' !~ '^private-valuation-dispatch:[a-f0-9]{64}$'
      OR NEW."result_json" IS DISTINCT FROM jsonb_build_object(
        'state','superseded_by_startup_catch_up',
        'latestRequestId',NEW."result_json"->>'latestRequestId')))
  THEN
    RAISE EXCEPTION 'Private valuation dispatch attempt transition is invalid';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_private_valuation_dispatch_attempt_validate_update"
BEFORE UPDATE ON "outcome_private_valuation_dispatch_attempt"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_valuation_dispatch_attempt_update"();

CREATE TRIGGER "outcome_private_valuation_dispatch_attempt_no_delete"
BEFORE DELETE ON "outcome_private_valuation_dispatch_attempt"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_valuation_dispatch_delete"();

CREATE OR REPLACE FUNCTION "validate_outcome_private_valuation_dispatch_request_update"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IS DISTINCT FROM 'afl_trade_private_valuation_scheduler_owner'
    OR OLD."status"='completed'
    OR NEW."request_id" IS DISTINCT FROM OLD."request_id"
    OR NEW."scope_key" IS DISTINCT FROM OLD."scope_key"
    OR NEW."trigger_kind" IS DISTINCT FROM OLD."trigger_kind"
    OR NEW."scheduled_for" IS DISTINCT FROM OLD."scheduled_for"
    OR NEW."authority_key" IS DISTINCT FROM OLD."authority_key"
    OR NEW."request_json" IS DISTINCT FROM OLD."request_json"
    OR NEW."claim_sequence"<OLD."claim_sequence"
    OR NEW."claim_sequence">OLD."claim_sequence"+1
    OR NEW."transient_failure_count"<OLD."transient_failure_count"
    OR NEW."transient_failure_count">OLD."transient_failure_count"+1
    OR (OLD."status"='pending' AND NEW."status" NOT IN ('pending','claimed','completed'))
    OR (OLD."status"='claimed' AND NEW."status" NOT IN ('claimed','pending','completed'))
    OR (NEW."status"='claimed' AND OLD."status"<>'claimed'
      AND NEW."claim_sequence"<>OLD."claim_sequence"+1)
    OR (NEW."status"='claimed' AND OLD."status"='claimed'
      AND NEW."claim_sequence"<>OLD."claim_sequence")
    OR (NEW."status"<>'claimed' AND NEW."claim_sequence"<>OLD."claim_sequence")
    OR (NEW."transient_failure_count">OLD."transient_failure_count" AND NOT EXISTS (
      SELECT 1 FROM "outcome_private_valuation_dispatch_attempt" attempt
       WHERE attempt."claim_id"=OLD."claim_id" AND attempt."request_id"=OLD."request_id"
         AND attempt."finished_at" IS NOT NULL
         AND attempt."outcome" IN ('transient_failure','lease_expired')))
    OR (NEW."status"='claimed' AND NOT EXISTS (
      SELECT 1 FROM "outcome_private_valuation_dispatch_attempt" attempt
       WHERE attempt."claim_id"=NEW."claim_id" AND attempt."request_id"=NEW."request_id"
         AND attempt."attempt_sequence"=NEW."claim_sequence"
         AND attempt."attempt_number"=NEW."transient_failure_count"+1
         AND attempt."lease_token_sha256"=NEW."lease_token_sha256"
         AND attempt."claimed_at"=NEW."claimed_at"
         AND attempt."lease_expires_at"=NEW."lease_expires_at"
         AND attempt."finished_at" IS NULL))
    OR (OLD."status"='claimed' AND NEW."status"<>'claimed' AND NOT EXISTS (
      SELECT 1 FROM "outcome_private_valuation_dispatch_attempt" attempt
       WHERE attempt."claim_id"=OLD."claim_id" AND attempt."request_id"=OLD."request_id"
         AND attempt."finished_at" IS NOT NULL))
  THEN
    RAISE EXCEPTION 'Private valuation dispatch request transition is invalid';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_private_valuation_dispatch_request_validate_update"
BEFORE UPDATE ON "outcome_private_valuation_dispatch_request"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_valuation_dispatch_request_update"();

CREATE OR REPLACE FUNCTION "claim_outcome_private_valuation_dispatch"(
  target_worker_id TEXT,target_lease_token_sha256 TEXT,target_lease_seconds INTEGER,
  target_request_id TEXT DEFAULT NULL
) RETURNS TABLE(request_id TEXT,request_json JSONB,claim_id TEXT,lease_expires_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  candidate "outcome_private_valuation_dispatch_request"%ROWTYPE;
  trusted_at TIMESTAMPTZ(3):=date_trunc('milliseconds',clock_timestamp());
  next_sequence INTEGER;
  next_attempt INTEGER;
  new_claim_id TEXT;
  new_lease_expires_at TIMESTAMPTZ(3);
BEGIN
  IF target_worker_id IS NULL OR btrim(target_worker_id)='' OR length(target_worker_id)>240
    OR target_lease_token_sha256 !~ '^[a-f0-9]{64}$'
    OR target_lease_seconds NOT BETWEEN 5 AND 3600
  THEN RAISE EXCEPTION 'Private valuation dispatch claim is malformed'; END IF;

  LOOP
    SELECT * INTO candidate FROM "outcome_private_valuation_dispatch_request" request
     WHERE request."available_at"<=trusted_at
       AND (request."status"='pending'
         OR (request."status"='claimed' AND request."lease_expires_at"<trusted_at))
       AND (target_request_id IS NULL OR request."request_id"=target_request_id)
     ORDER BY request."scheduled_for",request."request_id"
     FOR UPDATE SKIP LOCKED LIMIT 1;
    IF NOT FOUND THEN RETURN; END IF;

    -- The row lock is the authority boundary. Take trusted time only after it is held.
    trusted_at:=date_trunc('milliseconds',clock_timestamp());

    IF candidate."status"='claimed' THEN
      UPDATE "outcome_private_valuation_dispatch_attempt" expired_attempt SET
        "finished_at"=trusted_at,"outcome"='lease_expired',
        "result_json"=jsonb_build_object('state','lease_expired')
       WHERE expired_attempt."claim_id"=candidate."claim_id"
         AND expired_attempt."finished_at" IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Private valuation dispatch expired claim lacks attempt custody';
      END IF;
      IF candidate."transient_failure_count"+1>=3 THEN
        UPDATE "outcome_private_valuation_dispatch_request" exhausted_request SET
          "status"='completed',"completed_at"=trusted_at,
          "result_json"=jsonb_build_object('state','exhausted'),
          "transient_failure_count"="transient_failure_count"+1,
          "claim_id"=NULL,"lease_token_sha256"=NULL,
          "lease_expires_at"=NULL,"claimed_at"=NULL
         WHERE exhausted_request."request_id"=candidate."request_id";
        IF target_request_id IS NULL THEN CONTINUE; END IF;
        RETURN;
      END IF;
      UPDATE "outcome_private_valuation_dispatch_request" retry_request SET
        "status"='pending',"available_at"=trusted_at,
        "transient_failure_count"="transient_failure_count"+1,
        "claim_id"=NULL,"lease_token_sha256"=NULL,
        "lease_expires_at"=NULL,"claimed_at"=NULL
       WHERE retry_request."request_id"=candidate."request_id";
      candidate."transient_failure_count":=candidate."transient_failure_count"+1;
    END IF;
    EXIT;
  END LOOP;

  next_sequence:=candidate."claim_sequence"+1;
  next_attempt:=candidate."transient_failure_count"+1;
  new_claim_id:="create_outcome_private_valuation_dispatch_claim_id"(
    candidate."request_id",next_sequence,target_worker_id,target_lease_token_sha256);
  new_lease_expires_at:=trusted_at+make_interval(secs=>target_lease_seconds);
  INSERT INTO "outcome_private_valuation_dispatch_attempt"(
    "claim_id","request_id","attempt_sequence","attempt_number","worker_id",
    "lease_token_sha256","claimed_at","lease_expires_at","heartbeat_at"
  ) VALUES (
    new_claim_id,candidate."request_id",next_sequence,next_attempt,target_worker_id,
    target_lease_token_sha256,trusted_at,new_lease_expires_at,trusted_at
  );
  UPDATE "outcome_private_valuation_dispatch_request" SET
    "status"='claimed',"claim_sequence"=next_sequence,"claim_id"=new_claim_id,
    "lease_token_sha256"=target_lease_token_sha256,"claimed_at"=trusted_at,
    "lease_expires_at"=new_lease_expires_at,"completed_at"=NULL,"result_json"=NULL
   WHERE "outcome_private_valuation_dispatch_request"."request_id"=candidate."request_id";
  request_id:=candidate."request_id";
  request_json:=candidate."request_json";
  claim_id:=new_claim_id;
  lease_expires_at:=new_lease_expires_at;
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION "complete_outcome_private_valuation_dispatch"(
  target_claim_id TEXT,target_lease_token_sha256 TEXT,target_result JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  trusted_at TIMESTAMPTZ(3);
  request RECORD;
BEGIN
  IF jsonb_typeof(target_result) IS DISTINCT FROM 'object'
    OR target_result->>'state' NOT IN ('activated','already_current','exhausted','unexpected_failure')
    OR target_result IS DISTINCT FROM jsonb_build_object('state',target_result->>'state')
  THEN RAISE EXCEPTION 'Private valuation dispatch result is invalid'; END IF;
  SELECT * INTO request FROM "outcome_private_valuation_dispatch_request"
   WHERE "claim_id"=target_claim_id FOR UPDATE;
  trusted_at:=date_trunc('milliseconds',clock_timestamp());
  IF NOT FOUND OR request."status"<>'claimed'
    OR request."lease_token_sha256" IS DISTINCT FROM target_lease_token_sha256
    OR request."lease_expires_at"<trusted_at
  THEN RAISE EXCEPTION 'Private valuation dispatch claim was lost'; END IF;
  UPDATE "outcome_private_valuation_dispatch_attempt" SET
    "finished_at"=trusted_at,"outcome"='completed',"result_json"=target_result
   WHERE "claim_id"=target_claim_id AND "finished_at" IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Private valuation dispatch claim was lost'; END IF;
  UPDATE "outcome_private_valuation_dispatch_request" SET
    "status"='completed',"completed_at"=trusted_at,"result_json"=target_result,
    "claim_id"=NULL,"lease_token_sha256"=NULL,"lease_expires_at"=NULL,"claimed_at"=NULL
   WHERE "request_id"=request."request_id";
END $$;

CREATE OR REPLACE FUNCTION "reschedule_outcome_private_valuation_dispatch"(
  target_claim_id TEXT,target_lease_token_sha256 TEXT,target_state TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  trusted_at TIMESTAMPTZ(3);
  request RECORD;
  attempt_outcome TEXT;
  attempt_result JSONB;
  next_failure_count INTEGER;
BEGIN
  IF target_state NOT IN ('retry_pending','stale_authority','transient_failure')
  THEN RAISE EXCEPTION 'Private valuation dispatch reschedule state is invalid'; END IF;
  SELECT * INTO request FROM "outcome_private_valuation_dispatch_request"
   WHERE "claim_id"=target_claim_id FOR UPDATE;
  trusted_at:=date_trunc('milliseconds',clock_timestamp());
  IF NOT FOUND OR request."status"<>'claimed'
    OR request."lease_token_sha256" IS DISTINCT FROM target_lease_token_sha256
    OR request."lease_expires_at"<trusted_at
  THEN RAISE EXCEPTION 'Private valuation dispatch claim was lost'; END IF;
  attempt_outcome:=target_state;
  attempt_result:=jsonb_build_object('state',target_state);
  UPDATE "outcome_private_valuation_dispatch_attempt" SET
    "finished_at"=trusted_at,"outcome"=attempt_outcome,"result_json"=attempt_result
   WHERE "claim_id"=target_claim_id AND "finished_at" IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Private valuation dispatch claim was lost'; END IF;

  next_failure_count:=request."transient_failure_count"
    +CASE WHEN target_state='transient_failure' THEN 1 ELSE 0 END;
  IF next_failure_count>=3 THEN
    UPDATE "outcome_private_valuation_dispatch_request" SET
      "status"='completed',"completed_at"=trusted_at,
      "result_json"=jsonb_build_object('state','exhausted'),
      "transient_failure_count"=next_failure_count,
      "claim_id"=NULL,"lease_token_sha256"=NULL,
      "lease_expires_at"=NULL,"claimed_at"=NULL
     WHERE "request_id"=request."request_id";
    RETURN;
  END IF;
  UPDATE "outcome_private_valuation_dispatch_request" SET
    "status"='pending',
    "available_at"=trusted_at+CASE target_state
      WHEN 'retry_pending' THEN interval '5 seconds'
      WHEN 'stale_authority' THEN interval '30 seconds'
      ELSE make_interval(secs=>LEAST(60,5*(2^request."transient_failure_count"))) END,
    "transient_failure_count"=next_failure_count,
    "claim_id"=NULL,"lease_token_sha256"=NULL,
    "lease_expires_at"=NULL,"claimed_at"=NULL
   WHERE "request_id"=request."request_id";
END $$;

CREATE OR REPLACE FUNCTION "heartbeat_outcome_private_valuation_dispatch"(
  target_claim_id TEXT,target_lease_token_sha256 TEXT
) RETURNS TIMESTAMPTZ LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  trusted_at TIMESTAMPTZ(3);
  renewed_until TIMESTAMPTZ(3);
  request RECORD;
BEGIN
  SELECT * INTO request FROM "outcome_private_valuation_dispatch_request"
   WHERE "claim_id"=target_claim_id FOR UPDATE;
  trusted_at:=date_trunc('milliseconds',clock_timestamp());
  IF NOT FOUND OR request."status"<>'claimed'
    OR request."lease_token_sha256" IS DISTINCT FROM target_lease_token_sha256
    OR request."lease_expires_at"<trusted_at
  THEN RAISE EXCEPTION 'Private valuation dispatch claim was lost'; END IF;
  renewed_until:=GREATEST(request."lease_expires_at",trusted_at+interval '120 seconds');
  UPDATE "outcome_private_valuation_dispatch_attempt" SET
    "heartbeat_at"=trusted_at,"lease_expires_at"=renewed_until
   WHERE "claim_id"=target_claim_id AND "finished_at" IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Private valuation dispatch claim was lost'; END IF;
  UPDATE "outcome_private_valuation_dispatch_request" SET
    "lease_expires_at"=renewed_until
   WHERE "request_id"=request."request_id";
  RETURN renewed_until;
END $$;

CREATE OR REPLACE FUNCTION "coalesce_outcome_private_valuation_weekly_dispatch"(
  target_scope_key TEXT,target_scheduled_for TIMESTAMPTZ
) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  target_id TEXT;
  trusted_at TIMESTAMPTZ(3):=date_trunc('milliseconds',transaction_timestamp());
  prior RECORD;
  superseded_result JSONB;
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
  superseded_result:=jsonb_build_object(
    'state','superseded_by_startup_catch_up','latestRequestId',target_id);
  FOR prior IN
    SELECT * FROM "outcome_private_valuation_dispatch_request"
     WHERE "scope_key"=target_scope_key AND "trigger_kind"='weekly'
       AND "scheduled_for"<target_scheduled_for
       AND ("status"='pending' OR ("status"='claimed' AND "lease_expires_at"<trusted_at))
     FOR UPDATE
  LOOP
    IF prior."status"='claimed' THEN
      UPDATE "outcome_private_valuation_dispatch_attempt" SET
        "finished_at"=trusted_at,"outcome"='superseded',"result_json"=superseded_result
       WHERE "claim_id"=prior."claim_id" AND "finished_at" IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Private valuation dispatch supersession lacks attempt custody';
      END IF;
    END IF;
    UPDATE "outcome_private_valuation_dispatch_request" SET
      "status"='completed',"completed_at"=trusted_at,"result_json"=superseded_result,
      "claim_id"=NULL,"lease_token_sha256"=NULL,
      "lease_expires_at"=NULL,"claimed_at"=NULL
     WHERE "request_id"=prior."request_id";
  END LOOP;
  RETURN target_id;
END $$;

DO $paths$ BEGIN
  EXECUTE format(
    'ALTER FUNCTION %I.claim_outcome_private_valuation_dispatch(TEXT,TEXT,INTEGER,TEXT) SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema());
  EXECUTE format(
    'ALTER FUNCTION %I.complete_outcome_private_valuation_dispatch(TEXT,TEXT,JSONB) SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema());
  EXECUTE format(
    'ALTER FUNCTION %I.reschedule_outcome_private_valuation_dispatch(TEXT,TEXT,TEXT) SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema());
  EXECUTE format(
    'ALTER FUNCTION %I.heartbeat_outcome_private_valuation_dispatch(TEXT,TEXT) SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema());
  EXECUTE format(
    'ALTER FUNCTION %I.coalesce_outcome_private_valuation_weekly_dispatch(TEXT,TIMESTAMPTZ) SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema());
END $paths$;

REVOKE ALL ON "outcome_private_valuation_dispatch_attempt"
  FROM PUBLIC,afl_trade_private_evaluation_coordinator;
REVOKE SELECT ON "outcome_private_valuation_dispatch_request"
  FROM afl_trade_private_evaluation_coordinator;
GRANT SELECT (
  "request_id","scope_key","trigger_kind","scheduled_for","status","result_json"
) ON "outcome_private_valuation_dispatch_request"
  TO afl_trade_private_evaluation_coordinator;

RESET ROLE;

DO $membership$ BEGIN
  EXECUTE format(
    'REVOKE afl_trade_private_valuation_scheduler_owner FROM %I',
    session_user
  );
END $membership$;
