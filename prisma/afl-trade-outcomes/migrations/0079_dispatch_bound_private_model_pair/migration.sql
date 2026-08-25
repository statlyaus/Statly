-- Bind exact private dispatch inputs to existing immutable model and qualification custody.
-- Dispatch attempts remain the sole retry ledger.

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
       AND NOT EXISTS (
         SELECT 1 FROM "outcome_private_valuation_dispatch_request" live_request
          WHERE live_request."scope_key"=request."scope_key"
            AND live_request."request_id"<>request."request_id"
            AND live_request."status"='claimed'
            AND live_request."lease_expires_at">=trusted_at)
     ORDER BY request."scheduled_for",request."request_id"
     FOR UPDATE SKIP LOCKED LIMIT 1;
    IF NOT FOUND THEN RETURN; END IF;

    PERFORM pg_advisory_xact_lock(
      hashtextextended('private-valuation-dispatch-scope:'||candidate."scope_key",0)
    );
    -- Judge both the row lease and scope ownership only after their locks are held.
    trusted_at:=date_trunc('milliseconds',clock_timestamp());
    IF EXISTS (
      SELECT 1 FROM "outcome_private_valuation_dispatch_request" live_request
       WHERE live_request."scope_key"=candidate."scope_key"
         AND live_request."request_id"<>candidate."request_id"
         AND live_request."status"='claimed'
         AND live_request."lease_expires_at">=trusted_at
    ) THEN RETURN; END IF;

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

ALTER TABLE "outcome_valuation_model_run_operational_authorization"
  ALTER COLUMN "authority_evidence_id" DROP NOT NULL;

DROP TRIGGER "outcome_valuation_model_run_operation_insert_guard"
  ON "outcome_valuation_model_run_operational_authorization";

CREATE OR REPLACE FUNCTION "validate_outcome_valuation_model_run_operation_insert"()
RETURNS TRIGGER AS $$
DECLARE
  intent_row RECORD;
  dataset_row RECORD;
  authority_row RECORD;
  content JSONB;
  policy_owned BOOLEAN;
  trusted_now TIMESTAMPTZ(3):=clock_timestamp();
BEGIN
  SELECT * INTO intent_row FROM "outcome_valuation_model_run_intent"
   WHERE "intent_id"=NEW."intent_id" FOR SHARE;
  SELECT * INTO dataset_row FROM "outcome_valuation_dataset_candidate"
   WHERE "dataset_id"=NEW."dataset_id" FOR SHARE;
  content:=NEW."receipt_json"->'content';
  policy_owned:=COALESCE(
    content->>'authorityBoundary'=
      'policy_owned_local_private_valuation_for_one_exact_model_run_intent',
    FALSE
  );

  IF policy_owned THEN
    PERFORM "load_outcome_private_valuation_dispatch_request_for_claim"(
      content->>'dispatchRequestId',
      content->>'dispatchClaimId',
      content->>'dispatchLeaseTokenSha256'
    );
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'outcome-review-subject:governed_evidence_reference:' || NEW."authority_evidence_id", 0
    ));
    SELECT operational.*,evidence."environment" AS evidence_environment,
           evidence."reference_sha256",evidence."approval_decision_id",
           evidence."evidence_json"
      INTO authority_row
      FROM "outcome_operational_principal_authority" operational
      JOIN "outcome_governed_evidence_reference" evidence
        ON evidence."reference_id"=operational."authority_evidence_id"
     WHERE operational."authority_evidence_id"=NEW."authority_evidence_id" FOR SHARE;
  END IF;

  IF NEW."receipt_id" <> 'architecture-operation-receipt:' ||
       encode(sha256(convert_to(NEW."receipt_canonical_json",'UTF8')),'hex') OR
     intent_row."intent_id" IS NULL OR dataset_row."dataset_id" IS NULL OR
     NEW."environment"<>intent_row."environment" OR
     NEW."dataset_id"<>intent_row."dataset_id" OR
     NEW."admission_id"<>intent_row."admission_id" OR
     NEW."protocol_id"<>intent_row."protocol_id" OR
     NEW."observation_set_id"<>intent_row."observation_set_id" OR
     NEW."authorized_at">intent_row."started_at" OR
     NEW."authorized_at">trusted_now OR NEW."valid_through"<=trusted_now OR
     NEW."receipt_json"->>'receiptId'<>NEW."receipt_id" OR
     content->>'schemaVersion'<>'afl-trade-model-run-operational-authorization/v1' OR
     content->>'operation'<>'execute_model_run' OR
     content->'publicationEligible' IS DISTINCT FROM 'false'::JSONB OR
     content->>'environment' IS DISTINCT FROM NEW."environment"::TEXT OR
     content->>'runIntentId'<>NEW."intent_id" OR
     content->>'datasetId'<>NEW."dataset_id" OR
     content->>'datasetAdmissionId'<>NEW."admission_id" OR
     content->>'modelProtocolId'<>NEW."protocol_id" OR
     content->>'observationSetId'<>NEW."observation_set_id" OR
     (content->>'authorizedAt')::TIMESTAMPTZ<>NEW."authorized_at" OR
     (content->>'validThrough')::TIMESTAMPTZ<>NEW."valid_through" OR
     content->>'principalRef'<>NEW."principal_ref" THEN
    RAISE EXCEPTION 'Model-run operational authorization is invalid or misbound';
  END IF;

  IF policy_owned THEN
    IF NEW."environment"<>'non_production' OR
       NEW."authority_evidence_id" IS NOT NULL OR
       content->>'executionMode'<>'local' OR
       content->'publicationProhibited' IS DISTINCT FROM 'true'::JSONB OR
       content->>'principalRef'<>'system:weekly-valuation-coordinator' OR
       content->>'role'<>'afl_trade_private_evaluation_coordinator' OR
       NOT EXISTS (
         SELECT 1
           FROM "outcome_private_valuation_model_request_binding" binding
           JOIN "outcome_private_valuation_model_operation" operation
             ON operation."operation_id"=binding."operation_id"
           JOIN "outcome_private_valuation_dispatch_request" request
             ON request."request_id"=binding."request_id"
           JOIN "outcome_private_valuation_dispatch_attempt" attempt
             ON attempt."claim_id"=request."claim_id"
            AND attempt."request_id"=request."request_id"
          WHERE binding."request_id"=content->>'dispatchRequestId'
            AND binding."operation_id"=content->>'substantiveOperationId'
            AND binding."factual_output_id"=content->>'factualOutputId'
            AND binding."hpn_calculation_id"=content->>'hpnCalculationId'
            AND operation."factual_values_sha256"=content->>'factualValuesSha256'
            AND operation."hpn_values_sha256"=content->>'hpnValuesSha256'
            AND request."status"='claimed'
            AND request."claim_id"=content->>'dispatchClaimId'
            AND request."lease_token_sha256"=
              content->>'dispatchLeaseTokenSha256'
            AND request."lease_expires_at">trusted_now
            AND NEW."valid_through"<=request."lease_expires_at"
            AND attempt."attempt_number"=
              (content->>'dispatchAttemptNumber')::INTEGER
            AND attempt."lease_token_sha256"=
              content->>'dispatchLeaseTokenSha256'
            AND attempt."lease_expires_at">trusted_now
            AND NEW."valid_through"<=attempt."lease_expires_at"
            AND attempt."finished_at" IS NULL
       ) OR
       intent_row."intent_json"->'content'->'job'->>'initiatedBy'<>
         'system:weekly-valuation-coordinator' OR
       intent_row."intent_json"->'content'->'job'->>'workerIdentity'<>
         'system:weekly-valuation-coordinator'
    THEN
      RAISE EXCEPTION 'Model-run operational authorization is invalid or misbound';
    END IF;
  ELSE
    IF content->>'authorityBoundary' IS DISTINCT FROM
         'human_operational_authorization_for_one_exact_model_run_intent' OR
       authority_row."authority_evidence_id" IS NULL OR
       authority_row."principal_ref"<>NEW."principal_ref" OR
       authority_row."role"<>'afl_trade_model_run_operator' OR
       authority_row."scope_key"<>dataset_row."scope_key" OR
       authority_row."provider"<>'statly_modeling' OR
       authority_row."capability_id"<>'execute_model_run' OR
       authority_row."competition"<>dataset_row."competition" OR
       authority_row."evidence_environment"<>NEW."environment" OR
       (authority_row."evidence_json"->>'validFrom')::TIMESTAMPTZ IS DISTINCT FROM
         authority_row."valid_from" OR
       (authority_row."evidence_json"->>'validThrough')::TIMESTAMPTZ IS DISTINCT FROM
         authority_row."valid_through" OR
       authority_row."valid_from">trusted_now OR
       (authority_row."valid_through" IS NOT NULL AND
         authority_row."valid_through"<=trusted_now) OR
       (authority_row."valid_through" IS NOT NULL AND
         NEW."valid_through">authority_row."valid_through") OR
       EXISTS (SELECT 1 FROM "outcome_valuation_dataset_row" dataset_member
         WHERE dataset_member."dataset_id"=NEW."dataset_id"
           AND dataset_member."season_year" NOT BETWEEN
             authority_row."valid_from_season" AND authority_row."valid_through_season") OR
       EXISTS (SELECT 1 FROM "outcome_review_decision" successor
         WHERE successor."supersedes_decision_id"=authority_row."approval_decision_id") OR
       content->>'role'<>'afl_trade_model_run_operator' OR
       content->'authorityEvidence'->>'id'<>NEW."authority_evidence_id" OR
       content->'authorityEvidence'->>'sha256'<>authority_row."reference_sha256" OR
       (NEW."environment"<>'test_fixture' AND
         current_user<>'afl_trade_operational_authorization_registry_writer')
    THEN
      RAISE EXCEPTION 'Model-run operational authorization is invalid or misbound';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_valuation_model_run_operation_insert_guard"
  BEFORE INSERT ON "outcome_valuation_model_run_operational_authorization"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_valuation_model_run_operation_insert"();

CREATE OR REPLACE FUNCTION "validate_outcome_valuation_model_authorization_insert"() RETURNS TRIGGER AS $$
DECLARE
  intent_row RECORD;
  observation_row RECORD;
  protocol_row RECORD;
  analytical_authority RECORD;
  operational_authority RECORD;
  operator_trust RECORD;
  policy_owned BOOLEAN;
  admission_row RECORD;
  dataset_row RECORD;
  admission_gate2 RECORD;
  gate2 RECORD;
  trusted_now TIMESTAMPTZ(3):=clock_timestamp();
  current_revision INTEGER;
  requested_receipt_count INTEGER;
  current_receipt_count INTEGER;
  required_proposal_count INTEGER;
  covered_proposal_count INTEGER;
BEGIN
  SELECT * INTO intent_row FROM "outcome_valuation_model_run_intent"
   WHERE "intent_id"=NEW."intent_id" FOR SHARE;
  SELECT * INTO observation_row FROM "outcome_valuation_player_observation_set"
   WHERE "observation_set_id"=intent_row."observation_set_id" FOR SHARE;
  SELECT * INTO protocol_row FROM "outcome_valuation_model_protocol"
   WHERE "protocol_id"=intent_row."protocol_id" FOR SHARE;
  SELECT * INTO analytical_authority FROM "outcome_valuation_dataset_operation_authority"
   WHERE "receipt_id"=protocol_row."analytical_authority_receipt_id" FOR SHARE;
  SELECT * INTO operational_authority
    FROM "outcome_valuation_model_run_operational_authorization"
   WHERE "receipt_id"=NEW."operational_authorization_receipt_id" FOR SHARE;
  policy_owned:=COALESCE(
    operational_authority."receipt_json"->'content'->>'authorityBoundary'=
      'policy_owned_local_private_valuation_for_one_exact_model_run_intent',
    FALSE
  );
  IF policy_owned THEN
    PERFORM "load_outcome_private_valuation_dispatch_request_for_claim"(
      operational_authority."receipt_json"->'content'->>'dispatchRequestId',
      operational_authority."receipt_json"->'content'->>'dispatchClaimId',
      operational_authority."receipt_json"->'content'->>'dispatchLeaseTokenSha256'
    );
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'outcome-review-subject:governed_evidence_reference:' ||
        operational_authority."authority_evidence_id", 0
    ));
    SELECT operational.*,evidence."environment" AS evidence_environment,
           evidence."reference_sha256",evidence."approval_decision_id",
           evidence."evidence_json"
      INTO operator_trust
      FROM "outcome_operational_principal_authority" operational
      JOIN "outcome_governed_evidence_reference" evidence
        ON evidence."reference_id"=operational."authority_evidence_id"
     WHERE operational."authority_evidence_id"=operational_authority."authority_evidence_id"
     FOR SHARE;
  END IF;
  SELECT * INTO admission_row FROM "outcome_valuation_dataset_admission"
   WHERE "admission_id"=intent_row."admission_id" FOR SHARE;
  SELECT * INTO dataset_row FROM "outcome_valuation_dataset_candidate"
   WHERE "dataset_id"=intent_row."dataset_id" FOR SHARE;
  SELECT decision.* INTO admission_gate2
    FROM "outcome_valuation_dataset_admission" admission
    JOIN "outcome_gate_decision" decision ON decision."decision_id"=admission."gate2_decision_id"
   WHERE admission."admission_id"=intent_row."admission_id" FOR SHARE OF admission,decision;
  SELECT "revision" INTO current_revision FROM "outcome_gate_ledger_head"
   WHERE "singleton_id"=1 FOR SHARE;
  SELECT * INTO gate2 FROM "outcome_gate_decision"
   WHERE "decision_id"=NEW."authorization_json"->'content'->>'gate2DecisionId' FOR SHARE;
  SELECT jsonb_array_length(
    NEW."authorization_json"->'content'->'modelTrainingEvaluationReceiptIds'
  ) INTO requested_receipt_count;
  SELECT count(*) INTO current_receipt_count
    FROM jsonb_array_elements_text(
      NEW."authorization_json"->'content'->'modelTrainingEvaluationReceiptIds'
    ) requested("receipt_id")
    JOIN "outcome_valuation_dataset_gate0_evaluation" receipt
      ON receipt."receipt_id"=requested."receipt_id"
    JOIN "outcome_gate_decision" decision ON decision."decision_id"=receipt."decision_id"
    JOIN "outcome_source_rights_proposal" rights
      ON rights."rights_artifact_id"=receipt."rights_artifact_id"
    JOIN LATERAL jsonb_array_elements(
      admission_row."admission_json"->'content'->'sourceRightsEvaluations'
    ) required("evaluation")
      ON required."evaluation"->>'proposalId'=receipt."rights_artifact_id"
    JOIN "outcome_valuation_dataset_gate0_evaluation" admission_receipt
      ON admission_receipt."receipt_id"=
        required."evaluation"->>'admissionEvaluationReceiptId'
   WHERE receipt."environment"=intent_row."environment"
     AND receipt."operation_kind"='model_training'
     AND receipt."evaluated_at"=intent_row."started_at"
     AND receipt."recorded_at"=intent_row."started_at"
     AND decision."gate"='gate_0a_permission_to_evaluate'
     AND decision."state"='approved'
     AND decision."effective_at"<=trusted_now
     AND decision."revalidate_at">trusted_now
     AND NEW."valid_through"<=decision."revalidate_at"
     AND ((receipt."receipt_json"->'content'->'request') - 'evaluatedAt'::TEXT)
       IS NOT DISTINCT FROM
       ((admission_receipt."receipt_json"->'content'->'request') - 'evaluatedAt'::TEXT)
     AND receipt."receipt_json"->'content'->'request'->'operations' ? 'model_training'
     AND EXISTS (SELECT 1
       FROM jsonb_array_elements(
         receipt."receipt_json"->'content'->'request'->'fieldUses'
       ) field_use WHERE field_use->>'use'='model_training')
     AND NOT EXISTS (SELECT 1 FROM "outcome_gate_decision" successor
       WHERE successor."supersedes_decision_id"=decision."decision_id")
     AND (rights."content_json"->'content'->>'termsExpireAt' IS NULL OR
       ((rights."content_json"->'content'->>'termsExpireAt')::TIMESTAMPTZ>trusted_now AND
        NEW."valid_through"<=
          (rights."content_json"->'content'->>'termsExpireAt')::TIMESTAMPTZ));
  SELECT jsonb_array_length(
    admission_row."admission_json"->'content'->'sourceRightsEvaluations'
  ) INTO required_proposal_count;
  SELECT count(*) INTO covered_proposal_count
    FROM jsonb_array_elements(
      admission_row."admission_json"->'content'->'sourceRightsEvaluations'
    ) required("evaluation")
   WHERE EXISTS (
     SELECT 1
       FROM jsonb_array_elements_text(
         NEW."authorization_json"->'content'->'modelTrainingEvaluationReceiptIds'
       ) requested("receipt_id")
       JOIN "outcome_valuation_dataset_gate0_evaluation" receipt
         ON receipt."receipt_id"=requested."receipt_id"
      WHERE receipt."rights_artifact_id"=required."evaluation"->>'proposalId'
   );
  IF NEW."authorization_id" <> 'model-run-authorization:' ||
       encode(sha256(convert_to(NEW."authorization_canonical_json",'UTF8')),'hex') OR
     NEW."gate_ledger_revision"<>current_revision OR
     NEW."authorized_at">trusted_now OR trusted_now>=NEW."valid_through" OR
     trusted_now-intent_row."started_at">INTERVAL '5 seconds' OR
     trusted_now<intent_row."started_at" OR
     analytical_authority."authority_kind"<>'analytical_authority' OR
     analytical_authority."environment"<>intent_row."environment" OR
     analytical_authority."dataset_id"<>intent_row."dataset_id" OR
     analytical_authority."authorized_at">trusted_now OR
     analytical_authority."valid_through"<=trusted_now OR
     NEW."valid_through">analytical_authority."valid_through" OR
     operational_authority."receipt_id" IS NULL OR
     operational_authority."intent_id"<>intent_row."intent_id" OR
     operational_authority."environment"<>intent_row."environment" OR
     operational_authority."dataset_id"<>intent_row."dataset_id" OR
     operational_authority."admission_id"<>intent_row."admission_id" OR
     operational_authority."protocol_id"<>intent_row."protocol_id" OR
     operational_authority."observation_set_id"<>intent_row."observation_set_id" OR
     operational_authority."authorized_at">intent_row."started_at" OR
     operational_authority."authorized_at">trusted_now OR
     operational_authority."valid_through"<=trusted_now OR
     NEW."valid_through">operational_authority."valid_through" THEN
    RAISE EXCEPTION 'Model-run authorization is invalid, stale, or misbound';
  END IF;

  IF policy_owned THEN
    IF operational_authority."environment"<>'non_production' OR
       operational_authority."authority_evidence_id" IS NOT NULL OR
       operational_authority."principal_ref"<>'system:weekly-valuation-coordinator' OR
       operational_authority."receipt_json"->'content'->>'role'<>
         'afl_trade_private_evaluation_coordinator' OR
       operational_authority."receipt_json"->'content'->>'executionMode'<>'local' OR
       operational_authority."receipt_json"->'content'->'publicationProhibited'
         IS DISTINCT FROM 'true'::JSONB OR
       NOT EXISTS (
         SELECT 1
           FROM "outcome_private_valuation_model_request_binding" binding
           JOIN "outcome_private_valuation_model_operation" operation
             ON operation."operation_id"=binding."operation_id"
           JOIN "outcome_private_valuation_dispatch_request" request
             ON request."request_id"=binding."request_id"
           JOIN "outcome_private_valuation_dispatch_attempt" attempt
             ON attempt."claim_id"=request."claim_id"
            AND attempt."request_id"=request."request_id"
          WHERE binding."request_id"=
              operational_authority."receipt_json"->'content'->>'dispatchRequestId'
            AND binding."operation_id"=
              operational_authority."receipt_json"->'content'->>'substantiveOperationId'
            AND binding."factual_output_id"=
              operational_authority."receipt_json"->'content'->>'factualOutputId'
            AND binding."hpn_calculation_id"=
              operational_authority."receipt_json"->'content'->>'hpnCalculationId'
            AND operation."factual_values_sha256"=
              operational_authority."receipt_json"->'content'->>'factualValuesSha256'
            AND operation."hpn_values_sha256"=
              operational_authority."receipt_json"->'content'->>'hpnValuesSha256'
            AND request."status"='claimed'
            AND request."claim_id"=
              operational_authority."receipt_json"->'content'->>'dispatchClaimId'
            AND request."lease_token_sha256"=
              operational_authority."receipt_json"->'content'->>'dispatchLeaseTokenSha256'
            AND request."lease_expires_at">trusted_now
            AND NEW."valid_through"<=request."lease_expires_at"
            AND attempt."attempt_number"=
              (operational_authority."receipt_json"->'content'->>'dispatchAttemptNumber')::INTEGER
            AND attempt."lease_token_sha256"=
              operational_authority."receipt_json"->'content'->>'dispatchLeaseTokenSha256'
            AND attempt."lease_expires_at">trusted_now
            AND NEW."valid_through"<=attempt."lease_expires_at"
            AND attempt."finished_at" IS NULL
       )
    THEN
      RAISE EXCEPTION 'Model-run authorization is invalid, stale, or misbound';
    END IF;
  ELSE
    IF operator_trust."authority_evidence_id" IS NULL OR
       operator_trust."principal_ref"<>operational_authority."principal_ref" OR
       operator_trust."role"<>'afl_trade_model_run_operator' OR
       operator_trust."scope_key"<>dataset_row."scope_key" OR
       operator_trust."provider"<>'statly_modeling' OR
       operator_trust."capability_id"<>'execute_model_run' OR
       operator_trust."competition"<>dataset_row."competition" OR
       operator_trust."evidence_environment"<>intent_row."environment" OR
       operator_trust."valid_from">trusted_now OR
       (operator_trust."valid_through" IS NOT NULL AND
         operator_trust."valid_through"<=trusted_now) OR
       (operator_trust."valid_through" IS NOT NULL AND
         NEW."valid_through">operator_trust."valid_through") OR
       (operator_trust."evidence_json"->>'validFrom')::TIMESTAMPTZ IS DISTINCT FROM
         operator_trust."valid_from" OR
       (operator_trust."evidence_json"->>'validThrough')::TIMESTAMPTZ IS DISTINCT FROM
         operator_trust."valid_through" OR
       EXISTS (SELECT 1 FROM "outcome_valuation_dataset_row" dataset_member
         WHERE dataset_member."dataset_id"=intent_row."dataset_id"
           AND dataset_member."season_year" NOT BETWEEN
             operator_trust."valid_from_season" AND operator_trust."valid_through_season") OR
       EXISTS (SELECT 1 FROM "outcome_review_decision" successor
         WHERE successor."supersedes_decision_id"=operator_trust."approval_decision_id")
    THEN
      RAISE EXCEPTION 'Model-run authorization is invalid, stale, or misbound';
    END IF;
  END IF;

  IF gate2."gate"<>'gate_2_corpus_lineage' OR gate2."state"<>'approved' OR
     gate2."environment"<>intent_row."environment" OR
     gate2."decision_key"<>admission_gate2."decision_key" OR
     gate2."decision_json"->'content'->'scope'->>'scopeKey'<>dataset_row."scope_key" OR
     (SELECT count(*) FROM jsonb_array_elements(
       gate2."decision_json"->'content'->'scope'->'dimensions') dimension
       WHERE dimension->>'name'='scope'
         AND dimension->'values'=jsonb_build_array(dataset_row."scope_key"))<>1 OR
     (SELECT count(*) FROM jsonb_array_elements(
       gate2."decision_json"->'content'->'scope'->'dimensions') dimension
       WHERE dimension->>'name'='competition'
         AND dimension->'values'=jsonb_build_array(dataset_row."competition"))<>1 OR
     gate2."effective_at">trusted_now OR gate2."revalidate_at" IS NULL OR
     gate2."revalidate_at"<=trusted_now OR
     NEW."valid_through">gate2."revalidate_at" OR
     EXISTS (SELECT 1 FROM "outcome_gate_decision" successor
       WHERE successor."supersedes_decision_id"=gate2."decision_id") OR
     jsonb_array_length(gate2."decision_json"->'content'->'affectedArtifacts')<>4 OR
     NOT EXISTS (SELECT 1
       FROM jsonb_array_elements(gate2."decision_json"->'content'->'affectedArtifacts') artifact
      WHERE artifact->>'kind'='corpus_manifest'
        AND artifact->>'artifactId'=admission_row."admission_json"->'content'->>'corpusId') OR
     NOT EXISTS (SELECT 1
       FROM jsonb_array_elements(gate2."decision_json"->'content'->'affectedArtifacts') artifact
      WHERE artifact->>'kind'='corpus_factual_lineage'
        AND artifact->>'artifactId'=
          admission_row."admission_json"->'content'->>'corpusToCandidateLineageId') OR
     NOT EXISTS (SELECT 1
       FROM jsonb_array_elements(gate2."decision_json"->'content'->'affectedArtifacts') artifact
      WHERE artifact->>'kind'='factual_release'
        AND artifact->>'artifactId'=
          admission_row."admission_json"->'content'->>'factualReleaseId') OR
     NOT EXISTS (SELECT 1
       FROM jsonb_array_elements(gate2."decision_json"->'content'->'affectedArtifacts') artifact
      WHERE artifact->>'kind'='factual_release_candidate'
        AND artifact->>'artifactId'=
          admission_row."admission_json"->'content'->>'factualCandidateId') OR
     requested_receipt_count<1 OR requested_receipt_count<>current_receipt_count OR
     required_proposal_count<1 OR required_proposal_count<>covered_proposal_count OR
     required_proposal_count<>requested_receipt_count OR
     EXISTS (
       SELECT 1
         FROM jsonb_array_elements_text(
           NEW."authorization_json"->'content'->'modelTrainingEvaluationReceiptIds'
         ) requested("receipt_id")
         JOIN "outcome_valuation_dataset_gate0_evaluation" receipt
           ON receipt."receipt_id"=requested."receipt_id"
        WHERE NOT EXISTS (
          SELECT 1
            FROM jsonb_array_elements(
              admission_row."admission_json"->'content'->'sourceRightsEvaluations'
            ) required("evaluation")
           WHERE required."evaluation"->>'proposalId'=receipt."rights_artifact_id"
        )
     ) OR
     NEW."authorization_json"->>'authorizationId'<>NEW."authorization_id" OR
     NEW."authorization_json"->'content'->>'schemaVersion'<>
       'afl-trade-model-run-authorization/v1' OR
     NEW."authorization_json"->'content'->>'authorityBoundary' IS DISTINCT FROM
       'model_run_start_authority_no_grade_publication_or_fantasy_ownership' OR
     NEW."authorization_json"->'content'->>'publicationEligible'<>'false' OR
     NEW."authorization_json"->'content'->>'runIntentId'<>NEW."intent_id" OR
     (NEW."authorization_json"->'content'->>'gateLedgerRevision')::INTEGER<>
       NEW."gate_ledger_revision" OR
     NEW."authorization_json"->'content'->>'environment' IS DISTINCT FROM
       intent_row."environment"::TEXT OR
     NEW."authorization_json"->'content'->>'datasetId' IS DISTINCT FROM intent_row."dataset_id" OR
     NEW."authorization_json"->'content'->>'datasetAdmissionId' IS DISTINCT FROM
       intent_row."admission_id" OR
     NEW."authorization_json"->'content'->>'modelProtocolId' IS DISTINCT FROM
       intent_row."protocol_id" OR
     NEW."authorization_json"->'content'->>'observationSetId' IS DISTINCT FROM
       intent_row."observation_set_id" OR
     NEW."authorization_json"->'content'->>'operationalAuthorizationReceiptId' IS DISTINCT FROM
       operational_authority."receipt_id" OR
     NEW."authorization_json"->'content'->>'datasetRowSetSha256' IS DISTINCT FROM
       observation_row."dataset_row_set_sha256" OR
     NEW."authorization_json"->'content'->'modelTrainingEvaluationReceiptIds' IS DISTINCT FROM
       intent_row."intent_json"->'content'->'modelTrainingEvaluationReceiptIds' OR
     (NEW."authorization_json"->'content'->>'authorizedAt')::TIMESTAMPTZ<>NEW."authorized_at" OR
     (NEW."authorization_json"->'content'->>'validThrough')::TIMESTAMPTZ<>NEW."valid_through" THEN
    RAISE EXCEPTION 'Model-run authorization is invalid, stale, or misbound';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Preserve the existing governed pick and qualification validators while admitting only the
-- dispatch-bound v4 successor. The surrounding ancestry and evidence checks remain unchanged.
DO $patch_governed_pick_v4$
DECLARE
  current_definition TEXT;
  updated_definition TEXT;
  old_pick_state TEXT :=
    $old$content->>'schemaVersion'='afl-trade-pick-pav-model-execution/v3'$old$;
  new_pick_state TEXT := $new$content->>'schemaVersion' IN (
       'afl-trade-pick-pav-model-execution/v3',
       'afl-trade-pick-pav-model-execution/v4'
     )$new$;
  old_evidence_state TEXT := $old$execution_content->>'schemaVersion' IS DISTINCT FROM
         'afl-trade-pick-pav-model-execution/v3'$old$;
  new_evidence_state TEXT := $new$execution_content->>'schemaVersion' NOT IN (
         'afl-trade-pick-pav-model-execution/v3',
         'afl-trade-pick-pav-model-execution/v4'
       )$new$;
BEGIN
  SELECT pg_get_functiondef(
    'validate_outcome_governed_pick_pav_model_execution_insert()'::regprocedure
  ) INTO current_definition;
  updated_definition:=replace(current_definition,old_pick_state,new_pick_state);
  IF updated_definition=current_definition THEN
    RAISE EXCEPTION 'Expected governed pick v3 validator was not found';
  END IF;
  EXECUTE updated_definition;

  SELECT pg_get_functiondef(
    'validate_outcome_governed_component_validation_evidence()'::regprocedure
  ) INTO current_definition;
  updated_definition:=replace(current_definition,old_evidence_state,new_evidence_state);
  IF updated_definition=current_definition THEN
    RAISE EXCEPTION 'Expected governed pick qualification evidence validator was not found';
  END IF;
  EXECUTE updated_definition;
END;
$patch_governed_pick_v4$;


CREATE TABLE "outcome_private_valuation_model_operation" (
  "operation_id" TEXT PRIMARY KEY,
  "scope_key" TEXT NOT NULL,
  "factual_values_sha256" CHAR(64) NOT NULL,
  "hpn_values_sha256" CHAR(64) NOT NULL,
  "hpn_method_id" TEXT NOT NULL
    REFERENCES "outcome_hpn_pav_method"("method_id") ON DELETE RESTRICT,
  "player_model_id" TEXT NOT NULL,
  "player_model_version" TEXT NOT NULL,
  "player_protocol_id" TEXT NOT NULL,
  "player_dataset_id" TEXT NOT NULL,
  "player_dataset_admission_id" TEXT NOT NULL,
  "pick_protocol_id" TEXT NOT NULL,
  "pick_dataset_id" TEXT NOT NULL,
  "pick_dataset_admission_id" TEXT NOT NULL,
  "pick_policy_id" TEXT NOT NULL,
  "qualification_policy_id" TEXT NOT NULL,
  "operation_canonical_json" TEXT NOT NULL,
  "operation_json" JSONB NOT NULL,
  "player_run_id" TEXT
    REFERENCES "outcome_governed_valuation_component_run"("run_id") ON DELETE RESTRICT,
  "player_claim_id" TEXT
    REFERENCES "outcome_private_valuation_dispatch_attempt"("claim_id") ON DELETE RESTRICT,
  "player_attempt_number" INTEGER CHECK ("player_attempt_number" BETWEEN 1 AND 3),
  "player_accepted_at" TIMESTAMPTZ(3),
  "pick_run_id" TEXT
    REFERENCES "outcome_governed_valuation_component_run"("run_id") ON DELETE RESTRICT,
  "pick_claim_id" TEXT
    REFERENCES "outcome_private_valuation_dispatch_attempt"("claim_id") ON DELETE RESTRICT,
  "pick_attempt_number" INTEGER CHECK ("pick_attempt_number" BETWEEN 1 AND 3),
  "pick_accepted_at" TIMESTAMPTZ(3),
  "pair_accepted_at" TIMESTAMPTZ(3),
  "qualification_id" TEXT
    REFERENCES "outcome_governed_valuation_model_qualification"("qualification_id")
    ON DELETE RESTRICT,
  "qualification_outcome" TEXT CHECK ("qualification_outcome" IN ('qualified','failed')),
  "qualification_claim_id" TEXT
    REFERENCES "outcome_private_valuation_dispatch_attempt"("claim_id") ON DELETE RESTRICT,
  "qualification_bound_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "outcome_private_valuation_model_operation_id_check" CHECK (
    "operation_id" ~ '^private-valuation-model-operation:[a-f0-9]{64}$'
  ),
  CONSTRAINT "outcome_private_valuation_model_operation_component_shape" CHECK (
    ("player_run_id" IS NULL)=("player_claim_id" IS NULL AND
      "player_attempt_number" IS NULL AND "player_accepted_at" IS NULL)
    AND ("pick_run_id" IS NULL)=("pick_claim_id" IS NULL AND
      "pick_attempt_number" IS NULL AND "pick_accepted_at" IS NULL)
    AND ("pair_accepted_at" IS NULL OR
      ("player_run_id" IS NOT NULL AND "pick_run_id" IS NOT NULL))
    AND ("qualification_id" IS NULL)=("qualification_outcome" IS NULL AND
      "qualification_claim_id" IS NULL AND "qualification_bound_at" IS NULL)
    AND ("qualification_id" IS NULL OR "pair_accepted_at" IS NOT NULL)
  )
);

CREATE TABLE "outcome_private_valuation_model_request_binding" (
  "request_id" TEXT PRIMARY KEY
    REFERENCES "outcome_private_valuation_dispatch_request"("request_id") ON DELETE RESTRICT,
  "operation_id" TEXT NOT NULL
    REFERENCES "outcome_private_valuation_model_operation"("operation_id") ON DELETE RESTRICT,
  "factual_output_id" TEXT NOT NULL
    REFERENCES "outcome_private_valuation_factual_output"("output_id") ON DELETE RESTRICT,
  "hpn_calculation_id" TEXT NOT NULL
    REFERENCES "outcome_hpn_pav_calculation"("calculation_id") ON DELETE RESTRICT,
  "claim_id" TEXT NOT NULL
    REFERENCES "outcome_private_valuation_dispatch_attempt"("claim_id") ON DELETE RESTRICT,
  "attempt_number" INTEGER NOT NULL CHECK ("attempt_number" BETWEEN 1 AND 3),
  "bound_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "outcome_private_model_request_operation_key"
    UNIQUE ("request_id","operation_id"),
  CONSTRAINT "outcome_private_model_request_input_key"
    UNIQUE ("request_id","factual_output_id","hpn_calculation_id")
);

CREATE INDEX "outcome_private_valuation_model_request_operation_idx"
  ON "outcome_private_valuation_model_request_binding"("operation_id","request_id");

CREATE OR REPLACE FUNCTION "validate_outcome_private_valuation_model_operation_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE content JSONB:=NEW."operation_json"->'content';
BEGIN
  IF current_user<>'afl_trade_private_evaluation_coordinator'
    OR NEW."operation_id"<>'private-valuation-model-operation:' ||
      encode(sha256(convert_to(NEW."operation_canonical_json",'UTF8')),'hex')
    OR NEW."operation_json"->>'operationId'<>NEW."operation_id"
    OR content->>'schemaVersion'<>'afl-trade-private-valuation-model-operation/v1'
    OR content->>'scopeKey'<>NEW."scope_key"
    OR content->>'factualValuesSha256'<>NEW."factual_values_sha256"
    OR content->>'hpnValuesSha256'<>NEW."hpn_values_sha256"
    OR content->>'hpnMethodId'<>NEW."hpn_method_id"
    OR content->'player'->>'modelId'<>NEW."player_model_id"
    OR content->'player'->>'modelVersion'<>NEW."player_model_version"
    OR content->'player'->>'protocolId'<>NEW."player_protocol_id"
    OR content->'player'->>'datasetId'<>NEW."player_dataset_id"
    OR content->'player'->>'datasetAdmissionId'<>NEW."player_dataset_admission_id"
    OR content->'pick'->>'protocolId'<>NEW."pick_protocol_id"
    OR content->'pick'->>'datasetId'<>NEW."pick_dataset_id"
    OR content->'pick'->>'datasetAdmissionId'<>NEW."pick_dataset_admission_id"
    OR content->'pick'->>'policyId'<>NEW."pick_policy_id"
    OR content->>'qualificationPolicyId'<>NEW."qualification_policy_id"
    OR NEW."player_run_id" IS NOT NULL OR NEW."pick_run_id" IS NOT NULL
    OR NEW."pair_accepted_at" IS NOT NULL OR NEW."qualification_id" IS NOT NULL
  THEN RAISE EXCEPTION 'Private valuation substantive model operation is invalid'; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_private_valuation_model_operation_insert_guard"
BEFORE INSERT ON "outcome_private_valuation_model_operation"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_valuation_model_operation_insert"();

CREATE OR REPLACE FUNCTION "outcome_private_valuation_hpn_substantive_sha256"(
  calculation_json JSONB
) RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT AS $$
  WITH stable AS (
    SELECT (calculation_json->'content') - ARRAY[
      'effectiveThrough','calculatedAt','inputSetId','inputSetSha256','factualRunId',
      'factualInputSetSha256','primaryProviders','corroboratingProviders','resultSourceRowIds'
    ]::TEXT[] AS value
  ), players AS (
    SELECT COALESCE(
      jsonb_agg(
        (player.value - 'spellVersionId' - 'source') ||
          jsonb_build_object('source',(player.value->'source') - 'sourceRowIds')
        ORDER BY player.ordinality
      ),
      '[]'::JSONB
    ) AS value
      FROM stable
      LEFT JOIN LATERAL jsonb_array_elements(stable.value->'players')
        WITH ORDINALITY AS player(value,ordinality) ON TRUE
     WHERE player.value IS NOT NULL
  ), substantive AS (
    SELECT (stable.value - 'players') || jsonb_build_object('players',players.value) AS value
      FROM stable CROSS JOIN players
  )
  SELECT encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(substantive.value),'UTF8'
  )),'hex') FROM substantive
$$;

CREATE OR REPLACE FUNCTION "validate_outcome_private_valuation_model_request_binding"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE request RECORD; attempt RECORD; operation RECORD; factual RECORD; calculation RECORD;
BEGIN
  SELECT * INTO request FROM "outcome_private_valuation_dispatch_request"
   WHERE "request_id"=NEW."request_id";
  SELECT * INTO attempt FROM "outcome_private_valuation_dispatch_attempt"
   WHERE "claim_id"=NEW."claim_id";
  SELECT * INTO operation FROM "outcome_private_valuation_model_operation"
   WHERE "operation_id"=NEW."operation_id";
  SELECT * INTO factual FROM "outcome_private_valuation_factual_output"
   WHERE "output_id"=NEW."factual_output_id";
  SELECT * INTO calculation FROM "outcome_hpn_pav_calculation"
   WHERE "calculation_id"=NEW."hpn_calculation_id";
  IF current_user<>'afl_trade_private_evaluation_coordinator'
    OR request."status"<>'claimed' OR request."claim_id"<>NEW."claim_id"
    OR request."lease_expires_at"<clock_timestamp()
    OR attempt."request_id"<>NEW."request_id" OR attempt."finished_at" IS NOT NULL
    OR attempt."attempt_number"<>NEW."attempt_number"
    OR operation."operation_id" IS NULL OR operation."scope_key"<>request."scope_key"
    OR factual."output_id" IS NULL OR factual."request_id"<>NEW."request_id"
    OR operation."factual_values_sha256"<>
      factual."output_json"->'content'->'candidate'->>'memberSetSha256'
    OR calculation."status"<>'finalized' OR calculation."finalized_at" IS NULL
    OR operation."hpn_method_id"<>calculation."method_id"
    OR operation."hpn_values_sha256"<>
      "outcome_private_valuation_hpn_substantive_sha256"(calculation."calculation_json")
    OR calculation."calculation_json"->'content'->>'factualRunId'<>
      factual."factual_run_id"
  THEN RAISE EXCEPTION 'Private valuation model input lacks exact live dispatch custody'; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_private_valuation_model_request_binding_guard"
BEFORE INSERT ON "outcome_private_valuation_model_request_binding"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_valuation_model_request_binding"();

CREATE OR REPLACE FUNCTION "fence_outcome_dispatch_bound_pick_execution"()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE content JSONB:=NEW."execution_json"->'content';
BEGIN
  IF content->>'schemaVersion'='afl-trade-pick-pav-model-execution/v4' THEN
    PERFORM "load_outcome_private_valuation_dispatch_request_for_claim"(
      content->'privateInput'->>'requestId',
      content->'privateInput'->>'claimId',
      content->'privateInput'->>'leaseTokenSha256'
    );
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_dispatch_bound_pick_execution_claim_fence"
BEFORE INSERT ON "outcome_governed_pick_pav_model_execution"
FOR EACH ROW EXECUTE FUNCTION "fence_outcome_dispatch_bound_pick_execution"();

CREATE OR REPLACE FUNCTION "fence_outcome_dispatch_bound_component"()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE execution_content JSONB;
BEGIN
  IF NEW."native_execution_kind"='governed_pick_pav_model_execution' THEN
    SELECT "execution_json"->'content' INTO execution_content
      FROM "outcome_governed_pick_pav_model_execution"
     WHERE "execution_id"=NEW."native_execution_id";
    IF execution_content->>'schemaVersion'='afl-trade-pick-pav-model-execution/v4' THEN
      PERFORM "load_outcome_private_valuation_dispatch_request_for_claim"(
        execution_content->'privateInput'->>'requestId',
        execution_content->'privateInput'->>'claimId',
        execution_content->'privateInput'->>'leaseTokenSha256'
      );
    END IF;
  ELSIF NEW."native_execution_kind"='admitted_player_model_run' THEN
    SELECT operational."receipt_json"->'content' INTO execution_content
      FROM "outcome_valuation_model_run" native_run
      JOIN "outcome_valuation_model_run_authorization" run_authorization
        ON run_authorization."authorization_id"=native_run."authorization_id"
      JOIN "outcome_valuation_model_run_operational_authorization" operational
        ON operational."receipt_id"=run_authorization."operational_authorization_receipt_id"
     WHERE native_run."run_id"=NEW."native_execution_id";
    IF execution_content->>'authorityBoundary'=
      'policy_owned_local_private_valuation_for_one_exact_model_run_intent'
    THEN
      PERFORM "load_outcome_private_valuation_dispatch_request_for_claim"(
        execution_content->>'dispatchRequestId',
        execution_content->>'dispatchClaimId',
        execution_content->>'dispatchLeaseTokenSha256'
      );
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_dispatch_bound_component_claim_fence"
BEFORE INSERT ON "outcome_governed_valuation_component_run"
FOR EACH ROW EXECUTE FUNCTION "fence_outcome_dispatch_bound_component"();

CREATE OR REPLACE FUNCTION "fence_outcome_dispatch_bound_model_qualification"()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  dispatch_operation_exists BOOLEAN;
  target_request_id TEXT:=current_setting('statly.private_valuation_request_id',true);
  target_claim_id TEXT:=current_setting('statly.private_valuation_claim_id',true);
  target_lease_sha256 TEXT:=current_setting('statly.private_valuation_lease_sha256',true);
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM "outcome_private_valuation_model_operation" operation
     WHERE operation."player_run_id"=NEW."player_run_id"
       AND operation."pick_run_id"=NEW."pick_run_id"
       AND operation."pair_accepted_at" IS NOT NULL
  ) INTO dispatch_operation_exists;
  IF dispatch_operation_exists THEN
    IF target_request_id IS NULL OR target_claim_id IS NULL OR target_lease_sha256 IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM "outcome_private_valuation_model_operation" operation
        JOIN "outcome_private_valuation_model_request_binding" binding
          ON binding."operation_id"=operation."operation_id"
        WHERE binding."request_id"=target_request_id
          AND operation."scope_key"=NEW."scope_key"
          AND operation."player_run_id"=NEW."player_run_id"
          AND operation."pick_run_id"=NEW."pick_run_id"
          AND operation."pair_accepted_at" IS NOT NULL
          AND operation."qualification_policy_id"=
            NEW."qualification_json"->'content'->'policy'->>'policyVersion'
      )
    THEN
      RAISE EXCEPTION 'Dispatch-bound model qualification lost its live claim fence';
    END IF;
    PERFORM "load_outcome_private_valuation_dispatch_request_for_claim"(
      target_request_id,target_claim_id,target_lease_sha256
    );
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_dispatch_bound_model_qualification_claim_fence"
BEFORE INSERT ON "outcome_governed_valuation_model_qualification"
FOR EACH ROW EXECUTE FUNCTION "fence_outcome_dispatch_bound_model_qualification"();

DO $paths$ BEGIN
  EXECUTE format(
    'ALTER FUNCTION %I.claim_outcome_private_valuation_dispatch(TEXT,TEXT,INTEGER,TEXT) SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema());
  EXECUTE format(
    'ALTER FUNCTION %I.fence_outcome_dispatch_bound_pick_execution() SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema());
  EXECUTE format(
    'ALTER FUNCTION %I.fence_outcome_dispatch_bound_component() SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema());
  EXECUTE format(
    'ALTER FUNCTION %I.fence_outcome_dispatch_bound_model_qualification() SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema());
END $paths$;

CREATE OR REPLACE FUNCTION "validate_outcome_private_valuation_model_operation_update"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE player RECORD; pick RECORD; qualification RECORD;
BEGIN
  IF current_user<>'afl_trade_private_evaluation_coordinator'
    OR NEW."operation_id"<>OLD."operation_id"
    OR (to_jsonb(NEW)-ARRAY[
      'player_run_id','player_claim_id','player_attempt_number','player_accepted_at',
      'pick_run_id','pick_claim_id','pick_attempt_number','pick_accepted_at',
      'pair_accepted_at','qualification_id','qualification_outcome',
      'qualification_claim_id','qualification_bound_at'
    ]) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY[
      'player_run_id','player_claim_id','player_attempt_number','player_accepted_at',
      'pick_run_id','pick_claim_id','pick_attempt_number','pick_accepted_at',
      'pair_accepted_at','qualification_id','qualification_outcome',
      'qualification_claim_id','qualification_bound_at'
    ])
    OR (OLD."player_run_id" IS NOT NULL AND (
      NEW."player_run_id" IS DISTINCT FROM OLD."player_run_id"
      OR NEW."player_claim_id" IS DISTINCT FROM OLD."player_claim_id"
      OR NEW."player_attempt_number" IS DISTINCT FROM OLD."player_attempt_number"
      OR NEW."player_accepted_at" IS DISTINCT FROM OLD."player_accepted_at"))
    OR (OLD."pick_run_id" IS NOT NULL AND (
      NEW."pick_run_id" IS DISTINCT FROM OLD."pick_run_id"
      OR NEW."pick_claim_id" IS DISTINCT FROM OLD."pick_claim_id"
      OR NEW."pick_attempt_number" IS DISTINCT FROM OLD."pick_attempt_number"
      OR NEW."pick_accepted_at" IS DISTINCT FROM OLD."pick_accepted_at"))
    OR (OLD."pair_accepted_at" IS NOT NULL AND NEW."pair_accepted_at" IS DISTINCT FROM OLD."pair_accepted_at")
    OR (OLD."qualification_id" IS NOT NULL AND (
      NEW."qualification_id" IS DISTINCT FROM OLD."qualification_id"
      OR NEW."qualification_outcome" IS DISTINCT FROM OLD."qualification_outcome"
      OR NEW."qualification_claim_id" IS DISTINCT FROM OLD."qualification_claim_id"
      OR NEW."qualification_bound_at" IS DISTINCT FROM OLD."qualification_bound_at"))
  THEN RAISE EXCEPTION 'Private valuation model operation is immutable after acceptance'; END IF;

  IF OLD."player_run_id" IS NULL AND NEW."player_run_id" IS NOT NULL THEN
    SELECT * INTO player FROM "outcome_governed_valuation_component_run"
     WHERE "run_id"=NEW."player_run_id";
    IF player."role"<>'player_contribution_and_availability'
      OR player."protocol_id"<>NEW."player_protocol_id"
      OR player."dataset_id"<>NEW."player_dataset_id"
      OR player."dataset_admission_id"<>NEW."player_dataset_admission_id"
      OR NOT EXISTS (
        SELECT 1 FROM "outcome_valuation_model_run" native_run
        JOIN "outcome_valuation_model_run_intent" native_intent
          ON native_intent."intent_id"=native_run."intent_id"
        JOIN "outcome_valuation_model_run_authorization" native_authorization
          ON native_authorization."authorization_id"=native_run."authorization_id"
        JOIN "outcome_valuation_model_run_operational_authorization" operational
          ON operational."receipt_id"=
            native_authorization."operational_authorization_receipt_id"
        JOIN "outcome_private_valuation_model_request_binding" binding
          ON binding."operation_id"=NEW."operation_id"
        JOIN "outcome_private_valuation_dispatch_request" bound_request
          ON bound_request."request_id"=binding."request_id"
        WHERE native_run."run_id"=player."native_execution_id"
          AND native_intent."intent_json"->'content'->>'modelId'=
            NEW."player_model_id"
          AND native_intent."intent_json"->'content'->>'modelVersion'=
            NEW."player_model_version"
          AND operational."receipt_json"->'content'->>'authorityBoundary'=
            'policy_owned_local_private_valuation_for_one_exact_model_run_intent'
          AND operational."receipt_json"->'content'->>'dispatchRequestId'=
            binding."request_id"
          AND operational."receipt_json"->'content'->>'substantiveOperationId'=
            NEW."operation_id"
          AND operational."receipt_json"->'content'->>'dispatchClaimId'=
            NEW."player_claim_id"
          AND operational."receipt_json"->'content'->>'dispatchLeaseTokenSha256'=
            bound_request."lease_token_sha256"
          AND (operational."receipt_json"->'content'->>'dispatchAttemptNumber')::INTEGER=
            NEW."player_attempt_number"
          AND operational."receipt_json"->'content'->>'factualOutputId'=
            binding."factual_output_id"
          AND operational."receipt_json"->'content'->>'hpnCalculationId'=
            binding."hpn_calculation_id"
          AND operational."receipt_json"->'content'->>'factualValuesSha256'=
            NEW."factual_values_sha256"
          AND operational."receipt_json"->'content'->>'hpnValuesSha256'=
            NEW."hpn_values_sha256")
      OR NOT EXISTS (
        SELECT 1 FROM "outcome_private_valuation_model_request_binding" binding
        JOIN "outcome_private_valuation_dispatch_request" request
          ON request."request_id"=binding."request_id"
        JOIN "outcome_private_valuation_dispatch_attempt" attempt
          ON attempt."claim_id"=NEW."player_claim_id"
         AND attempt."request_id"=request."request_id"
        WHERE binding."operation_id"=NEW."operation_id"
          AND request."status"='claimed' AND request."claim_id"=NEW."player_claim_id"
          AND request."lease_expires_at">=clock_timestamp()
          AND attempt."attempt_number"=NEW."player_attempt_number"
          AND attempt."finished_at" IS NULL)
    THEN RAISE EXCEPTION 'Accepted private player output has wrong ancestry'; END IF;
  END IF;
  IF OLD."pick_run_id" IS NULL AND NEW."pick_run_id" IS NOT NULL THEN
    SELECT * INTO pick FROM "outcome_governed_valuation_component_run"
     WHERE "run_id"=NEW."pick_run_id";
    IF pick."role"<>'draft_pick_and_future_pick_distribution'
      OR pick."protocol_id"<>NEW."pick_protocol_id"
      OR pick."dataset_id"<>NEW."pick_dataset_id"
      OR pick."dataset_admission_id"<>NEW."pick_dataset_admission_id"
      OR NOT EXISTS (
        SELECT 1 FROM "outcome_governed_pick_pav_model_execution" native_execution
        JOIN "outcome_private_valuation_model_request_binding" binding
          ON binding."operation_id"=NEW."operation_id"
        JOIN "outcome_private_valuation_dispatch_request" bound_request
          ON bound_request."request_id"=binding."request_id"
        WHERE native_execution."execution_id"=pick."native_execution_id"
          AND native_execution."execution_json"->'content'->>'policyId'=
            NEW."pick_policy_id"
          AND native_execution."execution_json"->'content'->>'schemaVersion'=
            'afl-trade-pick-pav-model-execution/v4'
          AND native_execution."execution_json"->'content'->'privateInput'->>'requestId'=
            binding."request_id"
          AND native_execution."execution_json"->'content'->'privateInput'->>'operationId'=
            NEW."operation_id"
          AND native_execution."execution_json"->'content'->'privateInput'->>'claimId'=
            NEW."pick_claim_id"
          AND native_execution."execution_json"->'content'->'privateInput'->>'leaseTokenSha256'=
            bound_request."lease_token_sha256"
          AND (native_execution."execution_json"->'content'->'privateInput'->>'attemptNumber')::INTEGER=
            NEW."pick_attempt_number"
          AND native_execution."execution_json"->'content'->'privateInput'->>'factualOutputId'=
            binding."factual_output_id"
          AND native_execution."execution_json"->'content'->'privateInput'->>'hpnCalculationId'=
            binding."hpn_calculation_id"
          AND native_execution."execution_json"->'content'->'privateInput'->>'factualValuesSha256'=
            NEW."factual_values_sha256"
          AND native_execution."execution_json"->'content'->'privateInput'->>'hpnValuesSha256'=
            NEW."hpn_values_sha256")
      OR NOT EXISTS (
        SELECT 1 FROM "outcome_private_valuation_model_request_binding" binding
        JOIN "outcome_private_valuation_dispatch_request" request
          ON request."request_id"=binding."request_id"
        JOIN "outcome_private_valuation_dispatch_attempt" attempt
          ON attempt."claim_id"=NEW."pick_claim_id"
         AND attempt."request_id"=request."request_id"
        WHERE binding."operation_id"=NEW."operation_id"
          AND request."status"='claimed' AND request."claim_id"=NEW."pick_claim_id"
          AND request."lease_expires_at">=clock_timestamp()
          AND attempt."attempt_number"=NEW."pick_attempt_number"
          AND attempt."finished_at" IS NULL)
    THEN RAISE EXCEPTION 'Accepted private pick output has wrong ancestry'; END IF;
  END IF;
  IF OLD."qualification_id" IS NULL AND NEW."qualification_id" IS NOT NULL THEN
    SELECT * INTO qualification FROM "outcome_governed_valuation_model_qualification"
     WHERE "qualification_id"=NEW."qualification_id";
    IF qualification."scope_key"<>NEW."scope_key"
      OR qualification."player_run_id"<>NEW."player_run_id"
      OR qualification."pick_run_id"<>NEW."pick_run_id"
      OR qualification."outcome"<>NEW."qualification_outcome"
      OR qualification."qualification_json"->'content'->'policy'->>'policyVersion'<>
        NEW."qualification_policy_id"
      OR NOT EXISTS (
        SELECT 1 FROM "outcome_private_valuation_model_request_binding" binding
        JOIN "outcome_private_valuation_dispatch_request" request
          ON request."request_id"=binding."request_id"
        JOIN "outcome_private_valuation_dispatch_attempt" attempt
          ON attempt."claim_id"=NEW."qualification_claim_id"
         AND attempt."request_id"=request."request_id"
        WHERE binding."operation_id"=NEW."operation_id"
          AND request."status"='claimed'
          AND request."claim_id"=NEW."qualification_claim_id"
          AND request."lease_expires_at">=clock_timestamp()
          AND attempt."finished_at" IS NULL)
    THEN RAISE EXCEPTION 'Private model qualification has wrong accepted pair'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_private_valuation_model_operation_update_guard"
BEFORE UPDATE ON "outcome_private_valuation_model_operation"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_valuation_model_operation_update"();

CREATE TRIGGER "outcome_private_valuation_model_operation_no_delete"
BEFORE DELETE ON "outcome_private_valuation_model_operation"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_valuation_dispatch_delete"();
CREATE TRIGGER "outcome_private_model_request_binding_no_write"
BEFORE UPDATE OR DELETE ON "outcome_private_valuation_model_request_binding"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_valuation_dispatch_delete"();

ALTER TABLE "outcome_private_valuation_model_operation"
  OWNER TO afl_trade_private_valuation_scheduler_owner;
ALTER TABLE "outcome_private_valuation_model_request_binding"
  OWNER TO afl_trade_private_valuation_scheduler_owner;
ALTER FUNCTION "validate_outcome_valuation_model_run_operation_insert"()
  OWNER TO afl_trade_private_valuation_scheduler_owner;
ALTER FUNCTION "validate_outcome_private_valuation_model_request_binding"()
  OWNER TO afl_trade_private_valuation_scheduler_owner;
ALTER FUNCTION "validate_outcome_private_valuation_model_operation_insert"()
  OWNER TO afl_trade_private_valuation_scheduler_owner;
ALTER FUNCTION "outcome_private_valuation_hpn_substantive_sha256"(JSONB)
  OWNER TO afl_trade_private_valuation_scheduler_owner;
ALTER FUNCTION "validate_outcome_private_valuation_model_operation_update"()
  OWNER TO afl_trade_private_valuation_scheduler_owner;
ALTER FUNCTION "fence_outcome_dispatch_bound_pick_execution"()
  OWNER TO afl_trade_private_valuation_scheduler_owner;
ALTER FUNCTION "fence_outcome_dispatch_bound_component"()
  OWNER TO afl_trade_private_valuation_scheduler_owner;
ALTER FUNCTION "fence_outcome_dispatch_bound_model_qualification"()
  OWNER TO afl_trade_private_valuation_scheduler_owner;

REVOKE ALL ON FUNCTION "fence_outcome_dispatch_bound_pick_execution"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "fence_outcome_dispatch_bound_component"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "fence_outcome_dispatch_bound_model_qualification"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "outcome_private_valuation_hpn_substantive_sha256"(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "outcome_private_valuation_hpn_substantive_sha256"(JSONB)
  TO afl_trade_private_evaluation_coordinator;
GRANT SELECT ON "outcome_governed_pick_pav_model_execution",
  "outcome_valuation_model_run",
  "outcome_valuation_model_run_authorization",
  "outcome_valuation_model_run_operational_authorization"
  TO afl_trade_private_valuation_scheduler_owner;

REVOKE ALL ON "outcome_private_valuation_model_operation",
  "outcome_private_valuation_model_request_binding" FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON "outcome_private_valuation_model_operation"
  TO afl_trade_private_evaluation_coordinator;
GRANT SELECT,INSERT ON "outcome_private_valuation_model_request_binding"
  TO afl_trade_private_evaluation_coordinator;
GRANT SELECT ON "outcome_private_valuation_dispatch_request",
  "outcome_private_valuation_dispatch_attempt",
  "outcome_private_valuation_factual_output",
  "outcome_hpn_pav_calculation",
  "outcome_governed_valuation_component_run",
  "outcome_valuation_model_run",
  "outcome_valuation_model_run_intent",
  "outcome_valuation_model_run_authorization",
  "outcome_valuation_model_run_operational_authorization",
  "outcome_governed_pick_pav_model_execution",
  "outcome_governed_valuation_model_qualification"
  TO afl_trade_private_evaluation_coordinator;
