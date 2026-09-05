-- Materialize existing admitted-player custody for one live dispatch. This loader
-- grants no source admission, model execution, registry or publication authority.
DO $membership$ BEGIN
  EXECUTE format('GRANT afl_trade_private_valuation_scheduler_owner TO %I', session_user);
END $membership$;

SET ROLE afl_trade_private_valuation_scheduler_owner;

CREATE FUNCTION "load_outcome_admitted_player_factual_parent"(
  target_request_id TEXT,
  target_claim_id TEXT,
  target_lease_token_sha256 TEXT,
  target_dataset_id TEXT,
  target_admission_id TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  parent RECORD;
  sources JSONB;
  batches JSONB;
BEGIN
  PERFORM "load_outcome_private_valuation_dispatch_request_for_claim"(
    target_request_id,target_claim_id,target_lease_token_sha256);
  IF target_dataset_id IS NULL OR target_dataset_id !~ '^dataset:[a-f0-9]{64}$'
    OR target_admission_id IS NULL OR target_admission_id !~ '^dataset-admission:[a-f0-9]{64}$'
  THEN RAISE EXCEPTION 'Exact admitted-player factual parent is unavailable'; END IF;

  SELECT request."scope_key",candidate."candidate_id",candidate."candidate_sha256",
         candidate."member_set_sha256",candidate."target_release_id",admission."admission_json"
    INTO parent
    FROM "outcome_private_valuation_dispatch_request" request
    JOIN "outcome_valuation_dataset_candidate" dataset
      ON dataset."dataset_id"=target_dataset_id AND dataset."scope_key"=request."scope_key"
     AND dataset."environment"='non_production'
     AND dataset."status"='finalized' AND dataset."finalized_at" IS NOT NULL
    JOIN "outcome_valuation_dataset_admission" admission
      ON admission."admission_id"=target_admission_id AND admission."dataset_id"=dataset."dataset_id"
     AND admission."environment"='non_production'
     AND admission."status"='finalized' AND admission."finalized_at" IS NOT NULL
    JOIN "outcome_factual_release_candidate" candidate
      ON candidate."candidate_id"=dataset."factual_candidate_id"
     AND candidate."target_release_id"=dataset."factual_release_id"
     AND candidate."scope_key"=request."scope_key" AND candidate."environment"='non_production'
     AND candidate."status"='approved' AND candidate."finalized_at" IS NOT NULL
    JOIN "outcome_release_manifest" release
      ON release."release_id"=candidate."target_release_id"
     AND release."scope_key"=request."scope_key" AND release."environment"='non_production'
   WHERE request."request_id"=target_request_id
     AND NOT EXISTS (
       SELECT 1 FROM "outcome_active_release" active
        WHERE active."release_id"=release."release_id")
     AND (SELECT commitment."record_state_json"->>'state'
            FROM "outcome_record_state_commitment" commitment
           WHERE commitment."release_id"=release."release_id"
           ORDER BY commitment."event_revision" DESC LIMIT 1)='approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exact admitted-player factual parent is unavailable';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'captureId',source.value->>'captureId',
    'sourceSnapshotId',source.value->>'sourceSnapshotId',
    'consumedFieldSetId',source.value->>'consumedFieldSetId',
    'consumedFieldSetSha256',source.value->>'consumedFieldSetSha256'
  ) ORDER BY source.value->>'captureId'),'[]'::JSONB)
    INTO sources
    FROM jsonb_array_elements(parent."admission_json"->'content'->'sourceRightsEvaluations') source(value);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'batchId',batch."batch_id",'batchSha256',batch."batch_sha256"
  ) ORDER BY batch."batch_id"),'[]'::JSONB)
    INTO batches
    FROM (
      SELECT DISTINCT metric_batch."batch_id",metric_batch."batch_sha256"
        FROM "outcome_release_spell_metric_member" member
        JOIN "outcome_acquisition_spell_metric_version" version
          ON version."spell_metric_version_id"=member."spell_metric_version_id"
        JOIN "outcome_acquisition_spell_metric_batch" metric_batch
          ON metric_batch."batch_id"=version."batch_id"
       WHERE member."candidate_id"=parent."candidate_id"
         AND metric_batch."status"='approved' AND metric_batch."finalized_at" IS NOT NULL
    ) batch;
  IF jsonb_array_length(sources)=0 OR jsonb_array_length(batches)=0 THEN
    RAISE EXCEPTION 'Exact admitted-player factual parent is unavailable';
  END IF;

  RETURN jsonb_build_object(
    'requestId',target_request_id,'valuationScopeKey',parent."scope_key",
    'admittedPlayerDataset',jsonb_build_object('datasetId',target_dataset_id,'admissionId',target_admission_id),
    'sourceCaptures',sources,'spellMetricBatches',batches,
    'candidate',jsonb_build_object('candidateId',parent."candidate_id",'candidateSha256',parent."candidate_sha256",
      'memberSetSha256',parent."member_set_sha256"),
    'factualRelease',jsonb_build_object('releaseId',parent."target_release_id",
      'releaseSha256',substring(parent."target_release_id" from length('outcome-release:')+1)),
    'preparedAt',to_char(date_trunc('milliseconds',clock_timestamp()) AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END $$;

DO $path$ BEGIN
  EXECUTE format(
    'ALTER FUNCTION %I.load_outcome_admitted_player_factual_parent(TEXT,TEXT,TEXT,TEXT,TEXT) SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema());
END $path$;
REVOKE ALL ON FUNCTION "load_outcome_admitted_player_factual_parent"(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "load_outcome_admitted_player_factual_parent"(TEXT,TEXT,TEXT,TEXT,TEXT)
  TO afl_trade_private_evaluation_coordinator;

RESET ROLE;
DO $membership$ BEGIN
  EXECUTE format('REVOKE afl_trade_private_valuation_scheduler_owner FROM %I', session_user);
END $membership$;
