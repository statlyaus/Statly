-- A v2 player output and the selected pick dataset have independent factual parents.
-- Only an authenticated current-factual/HPN input binding enables that private lane.
-- Preserve the existing v1 and public paths and all observation integrity checks.
DO $membership$ BEGIN
  EXECUTE format('GRANT afl_trade_private_valuation_scheduler_owner TO %I', session_user);
END $membership$;
GRANT SELECT (calculation_id,calculation_json) ON "outcome_hpn_pav_calculation"
  TO afl_trade_private_valuation_scheduler_owner;
SET ROLE afl_trade_private_valuation_scheduler_owner;
CREATE FUNCTION "outcome_private_valuation_pick_parent_is_current"(
  target_request_id TEXT,target_output_id TEXT,target_dataset_id TEXT,target_admission_id TEXT,
  selected_release_id TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF "load_outcome_private_valuation_hpn_factual_input"(
    target_request_id,target_output_id) IS NULL THEN RETURN FALSE; END IF;
  -- Registry events, including withdrawal, acquire this same membership lock.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-release-membership:'||selected_release_id,0));
  RETURN EXISTS (
    SELECT 1 FROM "outcome_private_valuation_model_request_binding" binding
    JOIN "outcome_private_valuation_model_operation" operation
      ON operation."operation_id"=binding."operation_id"
     AND operation."pick_dataset_id"=target_dataset_id
     AND operation."pick_dataset_admission_id"=target_admission_id
    JOIN "outcome_valuation_dataset_candidate" dataset
      ON dataset."dataset_id"=target_dataset_id AND dataset."factual_release_id"=selected_release_id
     AND dataset."scope_key"=operation."scope_key" AND dataset."environment"='non_production'
     AND dataset."status"='finalized' AND dataset."finalized_at" IS NOT NULL
    JOIN "outcome_valuation_dataset_admission" admission
      ON admission."admission_id"=target_admission_id AND admission."dataset_id"=dataset."dataset_id"
     AND admission."environment"='non_production'
     AND admission."status"='finalized' AND admission."finalized_at" IS NOT NULL
    JOIN "outcome_factual_release_candidate" candidate
      ON candidate."candidate_id"=dataset."factual_candidate_id"
     AND candidate."target_release_id"=selected_release_id
     AND candidate."scope_key"=operation."scope_key"
     AND candidate."environment"='non_production'
     AND candidate."status"='approved' AND candidate."finalized_at" IS NOT NULL
    JOIN "outcome_hpn_pav_calculation" hpn ON hpn."calculation_id"=binding."hpn_calculation_id"
    WHERE binding."request_id"=target_request_id AND binding."factual_output_id"=target_output_id
      AND admission."admission_json"#>>'{content,factualReleaseId}'=selected_release_id
      AND admission."admission_json"#>>'{content,factualCandidateId}'=candidate."candidate_id"
      AND admission."admission_json"#>>'{content,sourceMemberSetSha256}'=dataset."source_member_set_sha256"
      AND candidate."member_set_sha256"=dataset."source_member_set_sha256"
      AND "load_outcome_private_valuation_hpn_factual_input"(
        target_request_id,target_output_id)->>'hpnFactualRunId'=hpn."calculation_json"#>>'{content,factualRunId}'
      AND NOT EXISTS (SELECT 1 FROM "outcome_active_release" active
        WHERE active."release_id"=selected_release_id)
      AND (SELECT commitment."record_state_json"->>'state'
        FROM "outcome_record_state_commitment" commitment
        WHERE commitment."release_id"=selected_release_id
        ORDER BY commitment."event_revision" DESC LIMIT 1)='approved'
  );
END $$;
DO $path$ BEGIN
  EXECUTE format('ALTER FUNCTION %I.outcome_private_valuation_pick_parent_is_current(TEXT,TEXT,TEXT,TEXT,TEXT) SET search_path TO %I,pg_catalog,pg_temp',current_schema(),current_schema());
END $path$;
REVOKE ALL ON FUNCTION "outcome_private_valuation_pick_parent_is_current"(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "outcome_private_valuation_pick_parent_is_current"(TEXT,TEXT,TEXT,TEXT,TEXT) TO afl_trade_private_evaluation_coordinator;
RESET ROLE;
DO $membership$ BEGIN
  EXECUTE format('REVOKE afl_trade_private_valuation_scheduler_owner FROM %I', session_user);
END $membership$;

DO $migration$
DECLARE
  definition TEXT;
  original TEXT := $old$AND factual."factual_release_id"=NEW."release_id"$old$;
  replacement TEXT := $new$AND (
           (factual."output_json"#>>'{content,schemaVersion}'=
              'afl-trade-private-valuation-factual-output/v1'
            AND factual."factual_release_id"=NEW."release_id")
           OR (factual."output_json"#>>'{content,schemaVersion}'=
                 'afl-trade-private-valuation-factual-output/v2'
             AND "outcome_private_valuation_pick_parent_is_current"(
               binding."request_id",binding."factual_output_id",operation."pick_dataset_id",
               operation."pick_dataset_admission_id",NEW."release_id"))
         )$new$;
BEGIN
  SELECT pg_get_functiondef('validate_outcome_pick_pav_finalization()'::regprocedure)
    INTO definition;
  IF (length(definition)-length(replace(definition,original,'')))/length(original)<>1 THEN
    RAISE EXCEPTION 'Expected exact dispatch-bound pick release finalization fragment';
  END IF;
  EXECUTE replace(definition,original,replacement);
END $migration$;
