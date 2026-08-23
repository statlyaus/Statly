-- Allow one authenticated source-capture binding per dispatch source role.
-- Existing v1 bindings remain factual_input. HPN roles are exact fixed source lanes.

DO $roles$ BEGIN
  EXECUTE format(
    'GRANT afl_trade_private_valuation_scheduler_owner TO %I',
    session_user
  );
END $roles$;

SET ROLE afl_trade_private_valuation_scheduler_owner;

ALTER TABLE "outcome_private_valuation_capture_binding"
  ADD COLUMN "source_role" TEXT NOT NULL DEFAULT 'factual_input';

ALTER TABLE "outcome_private_valuation_capture_binding"
  DROP CONSTRAINT "outcome_private_valuation_capture_binding_request_id_key";

ALTER TABLE "outcome_private_valuation_capture_binding"
  ADD CONSTRAINT "outcome_private_valuation_capture_binding_source_role_check" CHECK (
    "source_role" IN (
      'factual_input',
      'hpn_completed_results',
      'hpn_primary_player_stats',
      'hpn_corroborating_player_stats'
    )
  ),
  ADD CONSTRAINT "outcome_private_valuation_capture_binding_request_role_key"
    UNIQUE ("request_id","source_role");

CREATE OR REPLACE FUNCTION "accept_outcome_private_valuation_dispatch_capture"(
  target_request_id TEXT,
  target_claim_id TEXT,
  target_lease_token_sha256 TEXT,
  target_source_role TEXT,
  target_normalization_run_id TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  trusted_at TIMESTAMPTZ(3);
  dispatch_authority RECORD;
  authority RECORD;
  retained RECORD;
  expected_source_attempt_id TEXT;
  expected_snapshot_id TEXT;
  expected_capture_receipt_id TEXT;
  expected_gate_receipt_id TEXT;
  expected_rights_artifact_id TEXT;
  expected_capture_id TEXT;
  expected_normalization_run_id TEXT;
  expected_field_map_sha256 TEXT;
  source_plan JSONB;
  binding_content JSONB;
  target_binding_id TEXT;
  target_binding_json JSONB;
BEGIN
  IF target_request_id !~ '^private-valuation-dispatch:[a-f0-9]{64}$'
    OR target_claim_id !~ '^private-valuation-dispatch-claim:[a-f0-9]{64}$'
    OR target_lease_token_sha256 !~ '^[a-f0-9]{64}$'
    OR target_source_role NOT IN (
      'factual_input',
      'hpn_completed_results',
      'hpn_primary_player_stats',
      'hpn_corroborating_player_stats'
    )
    OR target_normalization_run_id !~ '^provider-normalization-run:[a-f0-9]{64}$'
  THEN
    RAISE EXCEPTION 'Private valuation capture acceptance is malformed';
  END IF;

  SELECT
    request."request_id",request."request_json",request."scheduled_for",
    request."claim_id" AS "current_claim_id",
    request."claim_sequence" AS "current_claim_sequence",
    request."lease_token_sha256" AS "current_lease_token_sha256",
    request."lease_expires_at" AS "current_lease_expires_at",
    dispatch_attempt."attempt_sequence",dispatch_attempt."attempt_number",
    dispatch_attempt."lease_token_sha256" AS "attempt_lease_token_sha256",
    dispatch_attempt."lease_expires_at" AS "attempt_lease_expires_at",
    dispatch_attempt."finished_at" AS "attempt_finished_at"
  INTO dispatch_authority
  FROM "outcome_private_valuation_dispatch_request" request
  JOIN "outcome_private_valuation_dispatch_attempt" dispatch_attempt
    ON dispatch_attempt."request_id"=request."request_id"
   AND dispatch_attempt."claim_id"=target_claim_id
  WHERE request."request_id"=target_request_id
    AND request."claim_id"=target_claim_id
  FOR UPDATE OF request,dispatch_attempt;

  -- The dispatch and attempt locks fence acceptance. Judge expiry after they are held.
  trusted_at:=date_trunc('milliseconds',clock_timestamp());

  IF NOT FOUND
    OR dispatch_authority."request_id" IS DISTINCT FROM target_request_id
    OR dispatch_authority."current_claim_id" IS DISTINCT FROM target_claim_id
    OR dispatch_authority."current_claim_sequence"
      IS DISTINCT FROM dispatch_authority."attempt_sequence"
    OR dispatch_authority."current_lease_token_sha256"
      IS DISTINCT FROM target_lease_token_sha256
    OR dispatch_authority."attempt_lease_token_sha256"
      IS DISTINCT FROM target_lease_token_sha256
    OR dispatch_authority."current_lease_expires_at"<trusted_at
    OR dispatch_authority."attempt_lease_expires_at"<trusted_at
    OR dispatch_authority."attempt_finished_at" IS NOT NULL
  THEN
    RAISE EXCEPTION 'Private valuation capture acceptance lost its live dispatch claim fence or requested dispatch';
  END IF;

  -- The factual admission owner still resolves its single v1 capture by request. Requiring that
  -- admission before any HPN lane makes that lookup unambiguous without duplicating its function.
  IF target_source_role<>'factual_input' AND NOT EXISTS (
    SELECT 1 FROM "outcome_private_valuation_source_admission" admission
     WHERE admission."request_id"=target_request_id
  ) THEN
    RAISE EXCEPTION 'Private valuation HPN capture requires the exact factual admission first';
  END IF;
  IF target_source_role<>'factual_input'
    AND dispatch_authority."request_json"->>'scopeKey'
      IS DISTINCT FROM 'afl-men:2026-trades'
  THEN
    RAISE EXCEPTION 'Private valuation HPN capture scope is unsupported';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-private-valuation-capture-binding:'||dispatch_authority."request_id"||':'||target_source_role,0));
  SELECT * INTO retained
    FROM "outcome_private_valuation_capture_binding"
   WHERE "request_id"=dispatch_authority."request_id"
     AND "source_role"=target_source_role FOR SHARE;
  -- Binding-lock waits consume lease time; recheck before exact replay or fresh acceptance.
  trusted_at:=date_trunc('milliseconds',clock_timestamp());
  IF dispatch_authority."current_lease_expires_at"<trusted_at
    OR dispatch_authority."attempt_lease_expires_at"<trusted_at
    OR dispatch_authority."attempt_finished_at" IS NOT NULL
  THEN
    RAISE EXCEPTION 'Private valuation capture acceptance lost its live dispatch claim fence or requested dispatch';
  END IF;
  IF FOUND THEN
    IF retained."dispatch_claim_id" IS DISTINCT FROM target_claim_id
      OR retained."source_role" IS DISTINCT FROM target_source_role
      OR retained."normalization_run_id" IS DISTINCT FROM target_normalization_run_id
    THEN
      RAISE EXCEPTION 'Private valuation dispatch already accepted different source custody';
    END IF;
    RETURN retained."binding_json";
  END IF;

  SELECT
    normalization."normalization_run_id",normalization."capture_id",
    normalization."field_map_id",normalization."decoder_version",
    normalization."normalizer_version",normalization."decoded_sha256",
    normalization."receipt_sha256",normalization."staging_sha256",
    normalization."status" AS "normalization_status",
    normalization."completed_at" AS "normalization_completed_at",
    normalization."finalized_at" AS "normalization_finalized_at",
    capture."attempt_id" AS "source_capture_attempt_id",
    capture."source_snapshot_id",capture."source_artifact_id",
    capture."environment" AS "capture_environment",
    capture."provider",capture."dataset",capture."capability_id",
    capture."competition",capture."anchor_season_year",
    capture."captured_at",capture."status" AS "capture_status",
    capture."manifest_json",
    source_attempt."environment" AS "source_attempt_environment",
    source_attempt."provider" AS "source_attempt_provider",
    source_attempt."dataset" AS "source_attempt_dataset",
    source_attempt."capability_id" AS "source_attempt_capability_id",
    source_attempt."status" AS "source_attempt_status",
    source_attempt."started_at" AS "source_attempt_started_at",
    source_attempt."completed_at" AS "source_attempt_completed_at",
    source_attempt."attempt_json",
    field_map."capability_id" AS "field_map_capability_id",
    field_map."approval_decision_id" AS "field_map_approval_decision_id",
    field_map."field_map_sha256",field_map."approved_at" AS "field_map_approved_at",
    field_map."map_json"
  INTO authority
  FROM "outcome_provider_normalization_run" normalization
  JOIN "outcome_source_capture" capture
    ON capture."capture_id"=normalization."capture_id"
  JOIN "outcome_source_capture_attempt" source_attempt
    ON source_attempt."attempt_id"=capture."attempt_id"
  JOIN "outcome_provider_field_map" field_map
    ON field_map."field_map_id"=normalization."field_map_id"
  WHERE normalization."normalization_run_id"=target_normalization_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Private valuation capture normalization is absent from source custody';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-review-subject:provider_field_map:'||authority."field_map_id",0));
  IF NOT EXISTS (
    SELECT 1
      FROM "outcome_review_decision" approval
     WHERE approval."decision_id"=authority."field_map_approval_decision_id"
       AND approval."subject_type"='provider_field_map'
       AND approval."subject_id"=authority."field_map_id"
       AND approval."decision"='approved'
       AND approval."decided_at"=authority."field_map_approved_at"
       AND approval."evidence_json"->>'fieldMapSha256'=authority."field_map_sha256"
       AND NOT EXISTS (
         SELECT 1 FROM "outcome_review_decision" successor
          WHERE successor."supersedes_decision_id"=approval."decision_id")
  ) THEN
    RAISE EXCEPTION 'Private valuation capture field map is no longer currently approved';
  END IF;

  -- Review-lock waits also consume lease time; recheck immediately before fresh acceptance.
  trusted_at:=date_trunc('milliseconds',clock_timestamp());
  IF dispatch_authority."current_lease_expires_at"<trusted_at
    OR dispatch_authority."attempt_lease_expires_at"<trusted_at
    OR dispatch_authority."attempt_finished_at" IS NOT NULL
  THEN
    RAISE EXCEPTION 'Private valuation capture acceptance lost its live dispatch claim fence or requested dispatch';
  END IF;

  expected_source_attempt_id:='source-capture-attempt:'||encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(authority."attempt_json"),'UTF8')),'hex');
  expected_snapshot_id:='source-snapshot:'||encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(authority."manifest_json"),'UTF8')),'hex');
  expected_capture_receipt_id:='fitzroy-capture:'||encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(
      authority."manifest_json"->'fitzRoyCaptureReceipt'->'content'),'UTF8')),'hex');
  expected_gate_receipt_id:='gate0a-evaluation:'||encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(
      authority."manifest_json"->'gate0aReceipt'->'content'),'UTF8')),'hex');
  expected_rights_artifact_id:=
    authority."manifest_json"->'sourceRightsProposal'->>'rightsArtifactId';
  expected_capture_id:='source-capture:'||encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(jsonb_build_object(
      'sourceSnapshotId',authority."source_snapshot_id",
      'attemptId',authority."source_capture_attempt_id",
      'sourceArtifactId',authority."source_artifact_id")),'UTF8')),'hex');
  expected_normalization_run_id:='provider-normalization-run:'||encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(jsonb_build_object(
      'captureId',authority."capture_id",
      'fieldMapId',authority."field_map_id",
      'decoderVersion',authority."decoder_version",
      'normalizerVersion',authority."normalizer_version",
      'decodedSha256',authority."decoded_sha256",
      'receiptSha256',authority."receipt_sha256",
      'stagingSha256',authority."staging_sha256")),'UTF8')),'hex');
  expected_field_map_sha256:=encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(authority."map_json"),'UTF8')),'hex');

      IF (target_source_role='hpn_completed_results' AND (
        authority."provider" IS DISTINCT FROM 'afl_tables'
        OR authority."dataset" IS DISTINCT FROM 'AFL Tables completed match results through fitzRoy'
        OR authority."capability_id" IS DISTINCT FROM 'afl-tables-results'))
    OR (target_source_role='hpn_primary_player_stats' AND (
        authority."provider" IS DISTINCT FROM 'afl_tables'
        OR authority."dataset" IS DISTINCT FROM 'AFL Tables historical player match statistics'
        OR authority."capability_id" IS DISTINCT FROM 'afl-tables-player-stats'))
    OR (target_source_role='hpn_corroborating_player_stats' AND (
        authority."provider" IS DISTINCT FROM 'official_afl'
        OR authority."dataset" IS DISTINCT FROM 'Official AFL 2026 player match statistics'
        OR authority."capability_id" IS DISTINCT FROM 'official-afl-player-stats'))
    OR authority."capture_environment" IS DISTINCT FROM 'non_production'::"OutcomeEnvironment"
    OR authority."source_attempt_environment" IS DISTINCT FROM 'non_production'::"OutcomeEnvironment"
    OR authority."source_attempt_status" IS DISTINCT FROM 'captured'
    OR authority."capture_status" IN ('rejected','superseded')
    OR authority."normalization_finalized_at" IS NULL
    OR authority."normalization_finalized_at" IS DISTINCT FROM authority."normalization_completed_at"
    OR dispatch_authority."scheduled_for">trusted_at
    OR authority."source_attempt_started_at"<dispatch_authority."scheduled_for"
    OR authority."source_attempt_completed_at">trusted_at
    OR authority."captured_at">trusted_at
    OR authority."normalization_completed_at">trusted_at
    OR authority."field_map_approved_at">trusted_at
    OR authority."source_capture_attempt_id" IS DISTINCT FROM expected_source_attempt_id
    OR authority."source_snapshot_id" IS DISTINCT FROM expected_snapshot_id
    OR authority."manifest_json"->'fitzRoyCaptureReceipt'->>'captureReceiptId'
      IS DISTINCT FROM expected_capture_receipt_id
    OR authority."attempt_json"->>'captureReceiptId'
      IS DISTINCT FROM expected_capture_receipt_id
    OR authority."manifest_json"->'gate0aReceipt'->>'receiptId'
      IS DISTINCT FROM expected_gate_receipt_id
    OR authority."attempt_json"->>'authorizationReceiptId'
      IS DISTINCT FROM expected_gate_receipt_id
    OR authority."capture_id" IS DISTINCT FROM expected_capture_id
    OR authority."normalization_run_id" IS DISTINCT FROM expected_normalization_run_id
    OR authority."field_map_sha256" IS DISTINCT FROM expected_field_map_sha256
    OR authority."attempt_json"->>'schemaVersion'
      IS DISTINCT FROM 'afl-trade-source-capture-attempt/v1'
    OR authority."attempt_json"->>'sourceSnapshotId'
      IS DISTINCT FROM authority."source_snapshot_id"
    OR authority."attempt_json"->>'status' IS DISTINCT FROM 'captured'
    OR (authority."attempt_json"->>'completedAt')::timestamptz
      IS DISTINCT FROM authority."source_attempt_completed_at"
    OR authority."manifest_json"->>'schemaVersion'
      IS DISTINCT FROM 'afl-trade-source-snapshot/v3'
    OR authority."manifest_json"->'capture'->>'kind' IS DISTINCT FROM 'fitzroy'
    OR authority."manifest_json"->'capture'->>'upstreamProvider'
      IS DISTINCT FROM authority."provider"
    OR authority."manifest_json"->'capture'->>'upstreamDataset'
      IS DISTINCT FROM authority."dataset"
    OR authority."manifest_json"->'capture'->>'capabilityId'
      IS DISTINCT FROM authority."capability_id"
    OR authority."manifest_json"->'sourceArtifact'->>'artifactId'
      IS DISTINCT FROM authority."source_artifact_id"
    OR authority."manifest_json"->'gate0aReceipt'->'content'->'request'->>'environment'
      IS DISTINCT FROM 'non_production'
    OR authority."manifest_json"->'gate0aReceipt'->'content'->'request'->>'competition'
      IS DISTINCT FROM authority."competition"
    OR (authority."manifest_json"->'gate0aReceipt'->'content'->'request'->>'season')::integer
      IS DISTINCT FROM authority."anchor_season_year"
    OR authority."manifest_json"->'gate0aReceipt'->'content'->'request'->>'capabilityId'
      IS DISTINCT FROM authority."capability_id"
    OR expected_rights_artifact_id !~ '^source-rights:[a-f0-9]{64}$'
    OR authority."manifest_json"->'gate0aReceipt'->'content'->'request'->>'rightsArtifactId'
      IS DISTINCT FROM expected_rights_artifact_id
    OR authority."manifest_json"->'gate0aReceipt'->'content'->'result'->>'status'
      IS DISTINCT FROM 'mechanically_eligible'
    OR authority."manifest_json"->'gate0aReceipt'->'content'->'result'->>'decisionId' IS NULL
    OR authority."manifest_json"->'fitzRoyCaptureReceipt'->'content'->'authorizationReceipt'->>'receiptId'
      IS DISTINCT FROM expected_gate_receipt_id
    OR authority."manifest_json"->'fitzRoyCaptureReceipt'->'content'->'invocation'->>'provider'
      IS DISTINCT FROM authority."provider"
    OR authority."manifest_json"->'fitzRoyCaptureReceipt'->'content'->'invocation'->>'capabilityId'
      IS DISTINCT FROM authority."capability_id"
    OR (authority."manifest_json"->'fitzRoyCaptureReceipt'->'content'->'invocation'->>'authorizationSeason')::integer
      IS DISTINCT FROM authority."anchor_season_year"
    OR authority."source_attempt_provider" IS DISTINCT FROM authority."provider"
    OR authority."source_attempt_dataset" IS DISTINCT FROM authority."dataset"
    OR authority."source_attempt_capability_id" IS DISTINCT FROM authority."capability_id"
    OR authority."field_map_capability_id" IS DISTINCT FROM authority."capability_id"
    OR authority."map_json"->>'mapId' IS DISTINCT FROM authority."field_map_id"
    OR authority."map_json"->>'capabilityId' IS DISTINCT FROM authority."capability_id"
    OR authority."map_json"->>'competition' IS DISTINCT FROM authority."competition"
    OR (authority."map_json"->>'validFromSeason')::integer>authority."anchor_season_year"
    OR (authority."map_json"->>'validThroughSeason')::integer<authority."anchor_season_year"
  THEN
    RAISE EXCEPTION 'Private valuation capture source custody is invalid';
  END IF;

  source_plan:=jsonb_build_object(
    'provider',authority."provider",
    'dataset',authority."dataset",
    'capabilityId',authority."capability_id",
    'competition',authority."competition",
    'seasonYear',authority."anchor_season_year",
    'fieldMapId',authority."field_map_id",
    'gate0AReceiptId',expected_gate_receipt_id,
    'rightsArtifactId',expected_rights_artifact_id
  );
  binding_content:=jsonb_build_object(
    'schemaVersion','afl-trade-private-valuation-capture-binding/v2',
    'request',dispatch_authority."request_json",
    'sourceRole',target_source_role,
    'dispatchClaimId',target_claim_id,
    'attemptSequence',dispatch_authority."attempt_sequence",
    'attemptNumber',dispatch_authority."attempt_number",
    'sourcePlan',source_plan,
    'sourceCaptureAttemptId',authority."source_capture_attempt_id",
    'captureReceiptId',expected_capture_receipt_id,
    'snapshotId',authority."source_snapshot_id",
    'sourceCaptureId',authority."capture_id",
    'normalizationRunId',authority."normalization_run_id",
    'acceptedAt',to_char(trusted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'environment','non_production',
    'publicationEligible',false,
    'limitation','Accepted non-production source custody only; it grants no factual, model, private-evaluation, or publication authority.'
  );
  target_binding_id:="create_outcome_private_valuation_capture_binding_id"(binding_content);
  target_binding_json:=jsonb_build_object(
    'bindingId',target_binding_id,
    'content',binding_content
  );

  INSERT INTO "outcome_private_valuation_capture_binding"(
    "binding_id","request_id","source_role","dispatch_claim_id","attempt_sequence","attempt_number",
    "source_capture_id","source_capture_attempt_id","source_snapshot_id",
    "capture_receipt_id","normalization_run_id","accepted_at","binding_json"
  ) VALUES (
    target_binding_id,dispatch_authority."request_id",target_source_role,target_claim_id,
    dispatch_authority."attempt_sequence",dispatch_authority."attempt_number",
    authority."capture_id",authority."source_capture_attempt_id",authority."source_snapshot_id",
    expected_capture_receipt_id,authority."normalization_run_id",trusted_at,target_binding_json
  );
  RETURN target_binding_json;
END $$;


CREATE OR REPLACE FUNCTION "accept_outcome_private_valuation_dispatch_capture"(
  target_request_id TEXT,
  target_claim_id TEXT,
  target_lease_token_sha256 TEXT,
  target_normalization_run_id TEXT
) RETURNS JSONB LANGUAGE SQL SECURITY DEFINER AS $$
  SELECT "accept_outcome_private_valuation_dispatch_capture"(
    target_request_id,
    target_claim_id,
    target_lease_token_sha256,
    'factual_input',
    target_normalization_run_id
  )
$$;

CREATE OR REPLACE FUNCTION "load_outcome_private_valuation_dispatch_request_for_claim"(
  target_request_id TEXT,
  target_claim_id TEXT,
  target_lease_token_sha256 TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  retained RECORD;
  trusted_at TIMESTAMPTZ(3);
BEGIN
  IF target_request_id !~ '^private-valuation-dispatch:[a-f0-9]{64}$'
    OR target_claim_id !~ '^private-valuation-dispatch-claim:[a-f0-9]{64}$'
    OR target_lease_token_sha256 !~ '^[a-f0-9]{64}$'
  THEN
    RAISE EXCEPTION 'Private valuation dispatch request lookup is malformed';
  END IF;

  SELECT request."request_json",request."status",request."claim_id",
         request."lease_token_sha256",request."lease_expires_at",
         attempt."finished_at",attempt."lease_token_sha256" AS "attempt_lease_token_sha256",
         attempt."lease_expires_at" AS "attempt_lease_expires_at"
    INTO retained
    FROM "outcome_private_valuation_dispatch_request" request
    JOIN "outcome_private_valuation_dispatch_attempt" attempt
      ON attempt."request_id"=request."request_id"
     AND attempt."claim_id"=target_claim_id
   WHERE request."request_id"=target_request_id
     AND request."claim_id"=target_claim_id
   FOR SHARE OF request,attempt;
  trusted_at:=date_trunc('milliseconds',clock_timestamp());

  IF NOT FOUND
    OR retained."status" IS DISTINCT FROM 'claimed'
    OR retained."claim_id" IS DISTINCT FROM target_claim_id
    OR retained."lease_token_sha256" IS DISTINCT FROM target_lease_token_sha256
    OR retained."attempt_lease_token_sha256" IS DISTINCT FROM target_lease_token_sha256
    OR retained."finished_at" IS NOT NULL
    OR retained."lease_expires_at"<trusted_at
    OR retained."attempt_lease_expires_at"<trusted_at
  THEN
    RAISE EXCEPTION 'Private valuation dispatch request lookup lost its live claim fence';
  END IF;
  RETURN retained."request_json";
END $$;

DO $paths$ BEGIN
  EXECUTE format(
    'ALTER FUNCTION %I.accept_outcome_private_valuation_dispatch_capture(TEXT,TEXT,TEXT,TEXT,TEXT) SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema());
  EXECUTE format(
    'ALTER FUNCTION %I.accept_outcome_private_valuation_dispatch_capture(TEXT,TEXT,TEXT,TEXT) SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema());
  EXECUTE format(
    'ALTER FUNCTION %I.load_outcome_private_valuation_dispatch_request_for_claim(TEXT,TEXT,TEXT) SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema());
END $paths$;

REVOKE ALL ON FUNCTION "accept_outcome_private_valuation_dispatch_capture"(TEXT,TEXT,TEXT,TEXT,TEXT)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "accept_outcome_private_valuation_dispatch_capture"(TEXT,TEXT,TEXT,TEXT,TEXT)
  TO afl_trade_private_evaluation_coordinator;
REVOKE ALL ON FUNCTION "load_outcome_private_valuation_dispatch_request_for_claim"(TEXT,TEXT,TEXT)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "load_outcome_private_valuation_dispatch_request_for_claim"(TEXT,TEXT,TEXT)
  TO afl_trade_private_evaluation_coordinator;

RESET ROLE;

DO $membership$ BEGIN
  EXECUTE format(
    'REVOKE afl_trade_private_valuation_scheduler_owner FROM %I',
    session_user
  );
END $membership$;
