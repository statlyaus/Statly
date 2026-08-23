-- Admit the three exact role-aware HPN captures for non-production private calculation.
-- This authority is narrower than factual admission and never changes public release custody.

DO $roles$ BEGIN
  EXECUTE format(
    'GRANT afl_trade_private_valuation_scheduler_owner TO %I',
    session_user
  );
END $roles$;

GRANT SELECT ON
  "outcome_private_valuation_dispatch_request",
  "outcome_private_valuation_dispatch_attempt",
  "outcome_private_valuation_capture_binding",
  "outcome_private_valuation_source_admission",
  "outcome_private_valuation_factual_output",
  "outcome_source_capture",
  "outcome_provider_normalization_run",
  "outcome_provider_field_map",
  "outcome_review_decision",
  "outcome_hpn_projected_field_map",
  "outcome_hpn_field_map_candidate",
  "outcome_hpn_field_map_review_decision",
  "outcome_private_reviewed_evaluation_decision",
  "outcome_private_reviewed_evaluation_head",
  "outcome_private_reviewed_evidence_bundle",
  "outcome_source_rights_proposal"
TO afl_trade_private_valuation_scheduler_owner;

GRANT REFERENCES ON
  "outcome_private_valuation_dispatch_request",
  "outcome_private_valuation_dispatch_attempt",
  "outcome_private_valuation_capture_binding",
  "outcome_source_capture",
  "outcome_provider_normalization_run",
  "outcome_hpn_projected_field_map"
TO afl_trade_private_valuation_scheduler_owner;

SET ROLE afl_trade_private_valuation_scheduler_owner;

CREATE TABLE "outcome_private_valuation_hpn_source_admission" (
  "admission_id" TEXT PRIMARY KEY,
  "request_id" TEXT NOT NULL
    REFERENCES "outcome_private_valuation_dispatch_request"("request_id") ON DELETE RESTRICT,
  "source_role" TEXT NOT NULL,
  "dispatch_claim_id" TEXT NOT NULL,
  "attempt_sequence" INTEGER NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "capture_binding_id" TEXT NOT NULL UNIQUE
    REFERENCES "outcome_private_valuation_capture_binding"("binding_id") ON DELETE RESTRICT,
  "source_capture_id" TEXT NOT NULL UNIQUE
    REFERENCES "outcome_source_capture"("capture_id") ON DELETE RESTRICT,
  "normalization_run_id" TEXT NOT NULL UNIQUE
    REFERENCES "outcome_provider_normalization_run"("normalization_run_id") ON DELETE RESTRICT,
  "projected_field_map_id" TEXT NOT NULL
    REFERENCES "outcome_hpn_projected_field_map"("field_map_id") ON DELETE RESTRICT,
  "admitted_at" TIMESTAMPTZ(3) NOT NULL,
  "admission_json" JSONB NOT NULL,
  CONSTRAINT "outcome_private_valuation_hpn_source_admission_attempt_fkey"
    FOREIGN KEY ("request_id","attempt_sequence","dispatch_claim_id")
    REFERENCES "outcome_private_valuation_dispatch_attempt"(
      "request_id","attempt_sequence","claim_id"
    ) ON DELETE RESTRICT,
  CONSTRAINT "outcome_private_valuation_hpn_source_admission_request_role_key"
    UNIQUE ("request_id","source_role"),
  CONSTRAINT "outcome_private_valuation_hpn_source_admission_role_check" CHECK (
    "source_role" IN (
      'hpn_completed_results',
      'hpn_primary_player_stats',
      'hpn_corroborating_player_stats'
    )
  ),
  CONSTRAINT "outcome_private_valuation_hpn_source_admission_attempt_check" CHECK (
    "attempt_sequence">0 AND "attempt_number" BETWEEN 1 AND 3
    AND "attempt_number"<="attempt_sequence"
  ),
  CONSTRAINT "outcome_private_valuation_hpn_source_admission_id_check" CHECK (
    "admission_id" ~ '^private-valuation-hpn-source-admission:[a-f0-9]{64}$'
  ),
  CONSTRAINT "outcome_private_valuation_hpn_source_admission_json_check" CHECK (
    jsonb_typeof("admission_json")='object'
  )
);

CREATE INDEX "outcome_private_valuation_hpn_source_admission_map_idx"
  ON "outcome_private_valuation_hpn_source_admission"(
    "projected_field_map_id","admitted_at"
  );

CREATE FUNCTION "create_outcome_private_valuation_hpn_source_admission_id"(
  target_content JSONB
) RETURNS TEXT LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT 'private-valuation-hpn-source-admission:'||encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(target_content),'UTF8')),'hex')
$$;

CREATE FUNCTION "outcome_private_valuation_hpn_source_authority_is_current"(
  target_request_id TEXT,
  target_capture_binding_id TEXT,
  target_projected_field_map_id TEXT,
  target_source_role TEXT,
  target_at TIMESTAMPTZ
) RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
  SELECT EXISTS (
    SELECT 1
      FROM "outcome_private_valuation_dispatch_request" request
      JOIN "outcome_private_valuation_dispatch_attempt" attempt
        ON attempt."request_id"=request."request_id"
       AND attempt."claim_id"=request."claim_id"
       AND attempt."attempt_sequence"=request."claim_sequence"
      JOIN "outcome_private_valuation_factual_output" factual_output
        ON factual_output."request_id"=request."request_id"
      JOIN "outcome_private_valuation_source_admission" factual_admission
        ON factual_admission."admission_id"=factual_output."source_admission_id"
       AND factual_admission."request_id"=request."request_id"
      JOIN "outcome_private_valuation_capture_binding" binding
        ON binding."binding_id"=target_capture_binding_id
       AND binding."request_id"=request."request_id"
       AND binding."source_role"=target_source_role
      JOIN "outcome_source_capture" capture
        ON capture."capture_id"=binding."source_capture_id"
      JOIN "outcome_provider_normalization_run" normalization
        ON normalization."normalization_run_id"=binding."normalization_run_id"
       AND normalization."capture_id"=binding."source_capture_id"
      JOIN "outcome_provider_field_map" decode_map
        ON decode_map."field_map_id"=normalization."field_map_id"
      JOIN "outcome_review_decision" decode_approval
        ON decode_approval."decision_id"=decode_map."approval_decision_id"
      JOIN "outcome_hpn_projected_field_map" projected
        ON projected."field_map_id"=target_projected_field_map_id
      JOIN "outcome_hpn_field_map_candidate" candidate
        ON candidate."candidate_id"=projected."candidate_id"
      JOIN "outcome_hpn_field_map_review_decision" projected_approval
        ON projected_approval."decision_id"=projected."approval_decision_id"
      JOIN LATERAL (
        SELECT decision."decision_id"
          FROM "outcome_hpn_field_map_review_decision" decision
         WHERE decision."candidate_id"=projected."candidate_id"
         ORDER BY decision."registered_at" DESC,decision."decision_id" DESC
         LIMIT 1
      ) latest_projected ON TRUE
     WHERE request."request_id"=target_request_id
       AND request."scope_key"='afl-men:2026-trades'
       AND request."status"='claimed'
       AND request."lease_expires_at">=target_at
       AND attempt."lease_expires_at">=target_at
       AND attempt."finished_at" IS NULL
       AND binding."binding_json"#>>'{content,schemaVersion}'=
         'afl-trade-private-valuation-capture-binding/v2'
       AND binding."binding_json"#>>'{content,request,requestId}'=target_request_id
       AND binding."binding_json"#>>'{content,sourceRole}'=target_source_role
       AND binding."binding_json"#>>'{content,dispatchClaimId}'=binding."dispatch_claim_id"
       AND (binding."binding_json"#>>'{content,attemptSequence}')::integer=
         binding."attempt_sequence"
       AND (binding."binding_json"#>>'{content,attemptNumber}')::integer=
         binding."attempt_number"
       AND binding."binding_json"#>>'{content,sourceCaptureId}'=
         binding."source_capture_id"
       AND binding."binding_json"#>>'{content,normalizationRunId}'=
         binding."normalization_run_id"
       AND capture."status" IN ('staged','approved')
       AND normalization."status"='staged'
       AND normalization."finalized_at" IS NOT NULL
       AND normalization."source_row_count"=normalization."accepted_row_count"
       AND normalization."quarantined_row_count"=0
       AND normalization."issue_count"=0
       AND decode_map."capability_id"=
         binding."binding_json"#>>'{content,sourcePlan,capabilityId}'
       AND decode_approval."subject_type"='provider_field_map'
       AND decode_approval."subject_id"=decode_map."field_map_id"
       AND decode_approval."decision"='approved'
       AND decode_approval."decided_at"=decode_map."approved_at"
       AND NOT EXISTS (
         SELECT 1 FROM "outcome_review_decision" successor
          WHERE successor."supersedes_decision_id"=decode_approval."decision_id"
       )
       AND projected_approval."decision"='approved'
       AND latest_projected."decision_id"=projected."approval_decision_id"
       AND projected."provider"=
         binding."binding_json"#>>'{content,sourcePlan,provider}'
       AND projected."capability_id"=
         binding."binding_json"#>>'{content,sourcePlan,capabilityId}'
       AND projected."competition"='AFLM'
       AND projected."input_kind"=CASE target_source_role
         WHEN 'hpn_completed_results' THEN 'completed_match_result'
         ELSE 'player_match_stats'
       END
       AND 2026 BETWEEN projected."valid_from_season" AND projected."valid_through_season"
       AND projected."source_schema_sha256"=decode_map."source_schema_sha256"
       AND candidate."candidate_json"#>>'{content,providerDecodeMapId}'=
         binding."binding_json"#>>'{content,sourcePlan,fieldMapId}'
       AND projected_approval."source_use_assessment_json"#>>'{content,valuationScopeKey}'=
         request."scope_key"
       AND projected_approval."source_use_assessment_json"#>>'{content,rightsArtifactId}'=
         binding."binding_json"#>>'{content,sourcePlan,rightsArtifactId}'
       AND "outcome_hpn_projected_field_map_authority_is_exact"(
         projected."field_map_id",target_at
       )
  )
$$;

CREATE FUNCTION "validate_outcome_private_valuation_hpn_source_admission"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  expected_content JSONB;
  projected_candidate_id TEXT;
  decode_map_id TEXT;
  trusted_at TIMESTAMPTZ(3);
BEGIN
  expected_content:=NEW."admission_json"->'content';
  PERFORM 1
    FROM "outcome_private_valuation_dispatch_request" request
    JOIN "outcome_private_valuation_dispatch_attempt" attempt
      ON attempt."request_id"=request."request_id"
     AND attempt."claim_id"=request."claim_id"
   WHERE request."request_id"=NEW."request_id"
   FOR SHARE OF request,attempt;
  SELECT map."candidate_id",normalization."field_map_id"
    INTO projected_candidate_id,decode_map_id
    FROM "outcome_hpn_projected_field_map" map
    JOIN "outcome_private_valuation_capture_binding" binding
      ON binding."binding_id"=NEW."capture_binding_id"
    JOIN "outcome_provider_normalization_run" normalization
      ON normalization."normalization_run_id"=binding."normalization_run_id"
   WHERE map."field_map_id"=NEW."projected_field_map_id";
  IF FOUND THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'outcome-review-subject:provider_field_map:'||decode_map_id,0));
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'hpn-field-map-candidate:'||projected_candidate_id,0));
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'private-reviewed-evaluation:afl-men:2026-trades:'||
        'afl-player-match-reviewed-2021-2026',0));
  END IF;
  trusted_at:=date_trunc('milliseconds',clock_timestamp());
  IF (SELECT count(*) FROM jsonb_object_keys(NEW."admission_json"))<>2
    OR (SELECT count(*) FROM jsonb_object_keys(expected_content))<>16
    OR NEW."admission_json"->>'admissionId' IS DISTINCT FROM NEW."admission_id"
    OR NEW."admission_id" IS DISTINCT FROM
       "create_outcome_private_valuation_hpn_source_admission_id"(expected_content)
    OR expected_content->>'schemaVersion' IS DISTINCT FROM
       'afl-trade-private-valuation-hpn-source-admission/v1'
    OR expected_content->>'requestId' IS DISTINCT FROM NEW."request_id"
    OR expected_content->>'dispatchClaimId' IS DISTINCT FROM NEW."dispatch_claim_id"
    OR (expected_content->>'attemptSequence')::integer
       IS DISTINCT FROM NEW."attempt_sequence"
    OR (expected_content->>'attemptNumber')::integer
       IS DISTINCT FROM NEW."attempt_number"
    OR expected_content->>'sourceRole' IS DISTINCT FROM NEW."source_role"
    OR expected_content->>'captureBindingId' IS DISTINCT FROM NEW."capture_binding_id"
    OR expected_content->>'sourceCaptureId' IS DISTINCT FROM NEW."source_capture_id"
    OR expected_content->>'normalizationRunId' IS DISTINCT FROM NEW."normalization_run_id"
    OR expected_content->>'projectedFieldMapId'
       IS DISTINCT FROM NEW."projected_field_map_id"
    OR (expected_content->>'admittedAt')::timestamptz IS DISTINCT FROM NEW."admitted_at"
    OR expected_content->>'principalId' IS DISTINCT FROM
       'system:weekly-valuation-coordinator'
    OR expected_content->>'environment' IS DISTINCT FROM 'non_production'
    OR expected_content->'publicationEligible' IS DISTINCT FROM 'false'::jsonb
    OR expected_content->'publicationProhibited' IS DISTINCT FROM 'true'::jsonb
    OR expected_content->>'limitation' IS DISTINCT FROM
       'Non-production private HPN source admission only; it grants no factual, model-training, public-display, redistribution, publication, production, or activation authority.'
    OR NOT EXISTS (
      SELECT 1 FROM "outcome_private_valuation_capture_binding" binding
       WHERE binding."binding_id"=NEW."capture_binding_id"
         AND binding."request_id"=NEW."request_id"
         AND binding."source_role"=NEW."source_role"
         AND binding."dispatch_claim_id"=NEW."dispatch_claim_id"
         AND binding."attempt_sequence"=NEW."attempt_sequence"
         AND binding."attempt_number"=NEW."attempt_number"
         AND binding."source_capture_id"=NEW."source_capture_id"
         AND binding."normalization_run_id"=NEW."normalization_run_id"
    )
    OR NOT "outcome_private_valuation_hpn_source_authority_is_current"(
      NEW."request_id",NEW."capture_binding_id",NEW."projected_field_map_id",
      NEW."source_role",trusted_at
    )
  THEN
    RAISE EXCEPTION 'Private valuation HPN source admission custody is invalid';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_private_valuation_hpn_source_admission_validate"
BEFORE INSERT ON "outcome_private_valuation_hpn_source_admission"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_valuation_hpn_source_admission"();

CREATE FUNCTION "reject_outcome_private_valuation_hpn_source_admission_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Private valuation HPN source admissions are immutable';
END $$;

CREATE TRIGGER "outcome_private_valuation_hpn_source_admission_no_update_delete"
BEFORE UPDATE OR DELETE ON "outcome_private_valuation_hpn_source_admission"
FOR EACH ROW EXECUTE FUNCTION
  "reject_outcome_private_valuation_hpn_source_admission_mutation"();

CREATE OR REPLACE FUNCTION "guard_outcome_private_valuation_source_admission_status"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Outcome analytical evidence is append-only';
  END IF;
  IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status')
    OR OLD."status" IS DISTINCT FROM 'staged'::"OutcomeRecordStatus"
    OR NEW."status" IS DISTINCT FROM 'approved'::"OutcomeRecordStatus"
    OR NOT (
      EXISTS (
        SELECT 1 FROM "outcome_private_valuation_source_admission" admission
         WHERE admission."source_capture_id"=NEW."capture_id"
      )
      OR EXISTS (
        SELECT 1 FROM "outcome_private_valuation_hpn_source_admission" admission
         WHERE admission."source_capture_id"=NEW."capture_id"
      )
    )
  THEN
    RAISE EXCEPTION 'Source capture status requires exact automated non-production admission';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION "admit_outcome_private_valuation_hpn_source"(
  target_request_id TEXT,
  target_claim_id TEXT,
  target_lease_token_sha256 TEXT,
  target_factual_output_id TEXT,
  target_source_role TEXT,
  target_capture_binding_id TEXT,
  target_projected_field_map_id TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  trusted_at TIMESTAMPTZ(3);
  dispatch_authority RECORD;
  binding RECORD;
  projected RECORD;
  retained RECORD;
  admission_content JSONB;
  target_admission_id TEXT;
  target_admission_json JSONB;
  expected_input_kind TEXT;
  projected_candidate_id TEXT;
BEGIN
  IF target_request_id !~ '^private-valuation-dispatch:[a-f0-9]{64}$'
    OR target_claim_id !~ '^private-valuation-dispatch-claim:[a-f0-9]{64}$'
    OR target_lease_token_sha256 !~ '^[a-f0-9]{64}$'
    OR target_factual_output_id
       !~ '^private-valuation-factual-output:[a-f0-9]{64}$'
    OR target_source_role NOT IN (
      'hpn_completed_results',
      'hpn_primary_player_stats',
      'hpn_corroborating_player_stats'
    )
    OR target_capture_binding_id
       !~ '^private-valuation-capture-binding:[a-f0-9]{64}$'
    OR target_projected_field_map_id !~ '^hpn-pav-field-map:[a-f0-9]{64}$'
  THEN
    RAISE EXCEPTION 'Private valuation HPN source admission request is malformed';
  END IF;

  SELECT request."request_id",request."scope_key",request."request_json",
         request."status",request."claim_id" AS "current_claim_id",
         request."claim_sequence" AS "current_claim_sequence",
         request."lease_token_sha256" AS "current_lease_token_sha256",
         request."lease_expires_at" AS "current_lease_expires_at",
         attempt."attempt_sequence",attempt."attempt_number",
         attempt."lease_token_sha256" AS "attempt_lease_token_sha256",
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
    OR dispatch_authority."status" IS DISTINCT FROM 'claimed'
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
    RAISE EXCEPTION 'Private valuation HPN source admission lost its live dispatch claim fence';
  END IF;
  IF dispatch_authority."scope_key" IS DISTINCT FROM 'afl-men:2026-trades'
    OR NOT EXISTS (
      SELECT 1 FROM "outcome_private_valuation_factual_output" output
      JOIN "outcome_private_valuation_source_admission" factual
        ON factual."admission_id"=output."source_admission_id"
       WHERE output."request_id"=target_request_id
         AND output."output_id"=target_factual_output_id
         AND factual."request_id"=target_request_id
    )
  THEN
    RAISE EXCEPTION 'Private valuation HPN source admission lacks exact factual authority';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-private-valuation-hpn-source-admission:'||target_request_id||':'||
      target_source_role,0));

  SELECT capture_binding.*,capture."status" AS "capture_status",
         normalization."status" AS "normalization_status",
         normalization."finalized_at" AS "normalization_finalized_at",
         normalization."source_row_count",normalization."accepted_row_count",
         normalization."quarantined_row_count",normalization."issue_count",
         decode_map."capability_id" AS "decode_capability_id",
         decode_map."source_schema_sha256" AS "decode_source_schema_sha256",
         decode_map."approval_decision_id" AS "decode_approval_decision_id",
         decode_map."approved_at" AS "decode_approved_at"
    INTO binding
    FROM "outcome_private_valuation_capture_binding" capture_binding
    JOIN "outcome_source_capture" capture
      ON capture."capture_id"=capture_binding."source_capture_id"
    JOIN "outcome_provider_normalization_run" normalization
      ON normalization."normalization_run_id"=capture_binding."normalization_run_id"
     AND normalization."capture_id"=capture_binding."source_capture_id"
    JOIN "outcome_provider_field_map" decode_map
      ON decode_map."field_map_id"=normalization."field_map_id"
   WHERE capture_binding."binding_id"=target_capture_binding_id
     AND capture_binding."request_id"=target_request_id
     AND capture_binding."source_role"=target_source_role
   FOR UPDATE OF capture;
  IF NOT FOUND
    OR binding."binding_json"#>>'{content,schemaVersion}' IS DISTINCT FROM
       'afl-trade-private-valuation-capture-binding/v2'
    OR binding."binding_json"#>>'{content,request,requestId}'
       IS DISTINCT FROM target_request_id
    OR binding."binding_json"#>>'{content,sourceRole}' IS DISTINCT FROM target_source_role
    OR binding."binding_json"#>>'{content,dispatchClaimId}'
       IS DISTINCT FROM binding."dispatch_claim_id"
    OR (binding."binding_json"#>>'{content,attemptSequence}')::integer
       IS DISTINCT FROM binding."attempt_sequence"
    OR (binding."binding_json"#>>'{content,attemptNumber}')::integer
       IS DISTINCT FROM binding."attempt_number"
    OR binding."binding_json"#>>'{content,sourceCaptureId}'
       IS DISTINCT FROM binding."source_capture_id"
    OR binding."binding_json"#>>'{content,normalizationRunId}'
       IS DISTINCT FROM binding."normalization_run_id"
    OR binding."normalization_status" IS DISTINCT FROM 'staged'::"OutcomeRecordStatus"
    OR binding."normalization_finalized_at" IS NULL
    OR binding."source_row_count" IS DISTINCT FROM binding."accepted_row_count"
    OR binding."quarantined_row_count"<>0 OR binding."issue_count"<>0
    OR binding."capture_status" NOT IN ('staged','approved')
  THEN
    RAISE EXCEPTION 'Private valuation HPN source admission capture ancestry is invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-review-subject:provider_field_map:'||
      (binding."binding_json"#>>'{content,sourcePlan,fieldMapId}'),0));
  IF binding."binding_json"#>>'{content,sourcePlan,fieldMapId}' IS DISTINCT FROM
       (SELECT run."field_map_id" FROM "outcome_provider_normalization_run" run
         WHERE run."normalization_run_id"=binding."normalization_run_id")
    OR binding."decode_capability_id" IS DISTINCT FROM
       binding."binding_json"#>>'{content,sourcePlan,capabilityId}'
    OR NOT EXISTS (
      SELECT 1 FROM "outcome_review_decision" approval
       WHERE approval."decision_id"=binding."decode_approval_decision_id"
         AND approval."subject_type"='provider_field_map'
         AND approval."subject_id"=
           binding."binding_json"#>>'{content,sourcePlan,fieldMapId}'
         AND approval."decision"='approved'
         AND approval."decided_at"=binding."decode_approved_at"
         AND NOT EXISTS (
           SELECT 1 FROM "outcome_review_decision" successor
            WHERE successor."supersedes_decision_id"=approval."decision_id"
         )
    )
  THEN
    RAISE EXCEPTION 'Private valuation HPN source admission decode map is not current';
  END IF;

  expected_input_kind:=CASE target_source_role
    WHEN 'hpn_completed_results' THEN 'completed_match_result'
    ELSE 'player_match_stats'
  END;
  SELECT map."candidate_id" INTO projected_candidate_id
    FROM "outcome_hpn_projected_field_map" map
   WHERE map."field_map_id"=target_projected_field_map_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Private valuation HPN source admission projected authority is not current';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'hpn-field-map-candidate:'||projected_candidate_id,0));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'private-reviewed-evaluation:'||dispatch_authority."scope_key"||
      ':afl-player-match-reviewed-2021-2026',0));
  SELECT map.*,candidate."candidate_json",decision."decision",
         decision."source_use_assessment_json",
         latest."decision_id" AS "latest_decision_id"
    INTO projected
    FROM "outcome_hpn_projected_field_map" map
    JOIN "outcome_hpn_field_map_candidate" candidate
      ON candidate."candidate_id"=map."candidate_id"
    JOIN "outcome_hpn_field_map_review_decision" decision
      ON decision."decision_id"=map."approval_decision_id"
    JOIN LATERAL (
      SELECT current_decision."decision_id"
        FROM "outcome_hpn_field_map_review_decision" current_decision
       WHERE current_decision."candidate_id"=map."candidate_id"
       ORDER BY current_decision."registered_at" DESC,current_decision."decision_id" DESC
       LIMIT 1
    ) latest ON TRUE
   WHERE map."field_map_id"=target_projected_field_map_id;
  trusted_at:=date_trunc('milliseconds',clock_timestamp());
  IF NOT FOUND
    OR projected."decision" IS DISTINCT FROM 'approved'
    OR projected."latest_decision_id" IS DISTINCT FROM projected."approval_decision_id"
    OR projected."provider" IS DISTINCT FROM
       binding."binding_json"#>>'{content,sourcePlan,provider}'
    OR projected."capability_id" IS DISTINCT FROM
       binding."binding_json"#>>'{content,sourcePlan,capabilityId}'
    OR projected."competition" IS DISTINCT FROM 'AFLM'
    OR projected."input_kind" IS DISTINCT FROM expected_input_kind
    OR 2026 NOT BETWEEN projected."valid_from_season" AND projected."valid_through_season"
    OR projected."source_schema_sha256" IS DISTINCT FROM
       binding."decode_source_schema_sha256"
    OR projected."candidate_json"#>>'{content,providerDecodeMapId}' IS DISTINCT FROM
       binding."binding_json"#>>'{content,sourcePlan,fieldMapId}'
    OR projected."source_use_assessment_json"#>>'{content,valuationScopeKey}'
       IS DISTINCT FROM dispatch_authority."scope_key"
    OR projected."source_use_assessment_json"#>>'{content,rightsArtifactId}'
       IS DISTINCT FROM binding."binding_json"#>>'{content,sourcePlan,rightsArtifactId}'
    OR NOT COALESCE(
      "outcome_hpn_projected_field_map_authority_is_exact"(
        target_projected_field_map_id,trusted_at
      ),FALSE
    )
    OR dispatch_authority."current_lease_expires_at"<trusted_at
    OR dispatch_authority."attempt_lease_expires_at"<trusted_at
    OR dispatch_authority."attempt_finished_at" IS NOT NULL
  THEN
    RAISE EXCEPTION 'Private valuation HPN source admission projected authority is not current';
  END IF;
  IF NOT "outcome_private_valuation_hpn_source_authority_is_current"(
    target_request_id,target_capture_binding_id,target_projected_field_map_id,
    target_source_role,trusted_at
  ) THEN
    RAISE EXCEPTION 'Private valuation HPN source admission authority is not current';
  END IF;

  SELECT * INTO retained
    FROM "outcome_private_valuation_hpn_source_admission"
   WHERE "request_id"=target_request_id AND "source_role"=target_source_role
   FOR SHARE;
  IF FOUND THEN
    IF retained."dispatch_claim_id" IS DISTINCT FROM binding."dispatch_claim_id"
      OR retained."capture_binding_id" IS DISTINCT FROM target_capture_binding_id
      OR retained."source_capture_id" IS DISTINCT FROM binding."source_capture_id"
      OR retained."normalization_run_id" IS DISTINCT FROM binding."normalization_run_id"
      OR retained."projected_field_map_id" IS DISTINCT FROM target_projected_field_map_id
      OR binding."capture_status" IS DISTINCT FROM 'approved'::"OutcomeRecordStatus"
    THEN
      RAISE EXCEPTION 'Private valuation HPN source admission conflicts with retained custody';
    END IF;
    RETURN jsonb_build_object(
      'state','already_admitted','admission',retained."admission_json"
    );
  END IF;
  IF binding."attempt_sequence">dispatch_authority."attempt_sequence"
    OR binding."capture_status" IS DISTINCT FROM 'staged'::"OutcomeRecordStatus"
  THEN
    RAISE EXCEPTION 'Private valuation HPN source admission requires exact staged custody';
  END IF;

  admission_content:=jsonb_build_object(
    'schemaVersion','afl-trade-private-valuation-hpn-source-admission/v1',
    'requestId',target_request_id,
    'dispatchClaimId',binding."dispatch_claim_id",
    'attemptSequence',binding."attempt_sequence",
    'attemptNumber',binding."attempt_number",
    'sourceRole',target_source_role,
    'captureBindingId',target_capture_binding_id,
    'sourceCaptureId',binding."source_capture_id",
    'normalizationRunId',binding."normalization_run_id",
    'projectedFieldMapId',target_projected_field_map_id,
    'admittedAt',to_char(trusted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'principalId','system:weekly-valuation-coordinator',
    'environment','non_production',
    'publicationEligible',false,
    'publicationProhibited',true,
    'limitation','Non-production private HPN source admission only; it grants no factual, model-training, public-display, redistribution, publication, production, or activation authority.'
  );
  target_admission_id:=
    "create_outcome_private_valuation_hpn_source_admission_id"(admission_content);
  target_admission_json:=jsonb_build_object(
    'admissionId',target_admission_id,'content',admission_content
  );
  INSERT INTO "outcome_private_valuation_hpn_source_admission"(
    "admission_id","request_id","source_role","dispatch_claim_id",
    "attempt_sequence","attempt_number","capture_binding_id","source_capture_id",
    "normalization_run_id","projected_field_map_id","admitted_at","admission_json"
  ) VALUES (
    target_admission_id,target_request_id,target_source_role,binding."dispatch_claim_id",
    binding."attempt_sequence",binding."attempt_number",
    target_capture_binding_id,binding."source_capture_id",binding."normalization_run_id",
    target_projected_field_map_id,trusted_at,target_admission_json
  );
  UPDATE "outcome_source_capture" SET "status"='approved'
   WHERE "capture_id"=binding."source_capture_id" AND "status"='staged';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Private valuation HPN source admission did not advance exact staged custody';
  END IF;
  RETURN jsonb_build_object('state','admitted','admission',target_admission_json);
END $$;

DO $paths$ BEGIN
  EXECUTE format(
    'ALTER FUNCTION %I.outcome_private_valuation_hpn_source_authority_is_current(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema()
  );
  EXECUTE format(
    'ALTER FUNCTION %I.admit_outcome_private_valuation_hpn_source(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema()
  );
END $paths$;

REVOKE ALL ON FUNCTION "outcome_private_valuation_hpn_source_authority_is_current"(
  TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ
) FROM PUBLIC;

REVOKE ALL ON "outcome_private_valuation_hpn_source_admission"
  FROM PUBLIC,afl_trade_private_evaluation_coordinator;
GRANT SELECT ON "outcome_private_valuation_hpn_source_admission"
  TO afl_trade_private_evaluation_coordinator;
REVOKE ALL ON FUNCTION "admit_outcome_private_valuation_hpn_source"(
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "admit_outcome_private_valuation_hpn_source"(
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT
) TO afl_trade_private_evaluation_coordinator;

RESET ROLE;

DO $membership$ BEGIN
  EXECUTE format(
    'REVOKE afl_trade_private_valuation_scheduler_owner FROM %I',
    session_user
  );
END $membership$;
