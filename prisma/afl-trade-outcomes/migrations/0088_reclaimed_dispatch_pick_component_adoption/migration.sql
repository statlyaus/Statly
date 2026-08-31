-- A retained pick component is immutable evidence of the claim that created it.
-- A later live claim for the same request may adopt that exact evidence after a
-- crash, but must not rewrite its historical claim ancestry.

DO $patch_reclaimed_pick_adoption$
DECLARE
  current_definition TEXT;
  updated_definition TEXT;
  old_claim_match TEXT:=$old$
          AND native_execution."execution_json"->'content'->'privateInput'->>'claimId'=
            NEW."pick_claim_id"
          AND native_execution."execution_json"->'content'->'privateInput'->>'leaseTokenSha256'=
            bound_request."lease_token_sha256"
          AND (native_execution."execution_json"->'content'->'privateInput'->>'attemptNumber')::INTEGER=
            NEW."pick_attempt_number"$old$;
  retained_attempt_match TEXT:=$new$
          AND EXISTS (
            SELECT 1 FROM "outcome_private_valuation_dispatch_attempt" retained_attempt
             WHERE retained_attempt."request_id"=binding."request_id"
               AND retained_attempt."claim_id"=
                 native_execution."execution_json"->'content'->'privateInput'->>'claimId'
               AND retained_attempt."attempt_number"=
                 (native_execution."execution_json"->'content'->'privateInput'->>'attemptNumber')::INTEGER
               AND retained_attempt."lease_token_sha256"=
                 native_execution."execution_json"->'content'->'privateInput'->>'leaseTokenSha256'
          )$new$;
BEGIN
  SELECT pg_get_functiondef(
    'validate_outcome_private_valuation_model_operation_update()'::regprocedure
  ) INTO current_definition;
  updated_definition:=replace(current_definition,old_claim_match,retained_attempt_match);
  IF updated_definition=current_definition THEN
    RAISE EXCEPTION 'Expected dispatch-bound pick claim matcher was not found';
  END IF;
  EXECUTE updated_definition;
END
$patch_reclaimed_pick_adoption$;

ALTER FUNCTION "validate_outcome_private_valuation_model_operation_update"()
  OWNER TO afl_trade_private_valuation_scheduler_owner;
