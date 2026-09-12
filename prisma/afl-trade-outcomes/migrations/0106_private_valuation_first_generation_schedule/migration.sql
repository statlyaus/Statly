-- Weekly startup catch-up may begin from either an existing prepared cohort or exact
-- current private factual authority. It must not discover caller-supplied scopes.
GRANT SELECT ON "outcome_current_private_factual_authority"
  TO "afl_trade_private_valuation_scheduler_owner";

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
    OR NOT (
      EXISTS (SELECT 1 FROM "outcome_current_prepared_valuation_input_set"
               WHERE scope_key=target_scope_key)
      OR EXISTS (SELECT 1 FROM "outcome_current_private_factual_authority"
                  WHERE valuation_scope_key=target_scope_key)
    )
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
    'ALTER FUNCTION %I.coalesce_outcome_private_valuation_weekly_dispatch(TEXT,TIMESTAMPTZ) SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema());
END $paths$;
