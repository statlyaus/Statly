-- Checkpoints are immutable children of the existing execution-intent registry.
-- They preserve consumed authority and never grant fitting or qualification authority.
ALTER TABLE outcome_valuation_model_run_intent
  ADD COLUMN root_intent_id TEXT REFERENCES outcome_valuation_model_run_intent(intent_id),
  ADD COLUMN previous_intent_id TEXT UNIQUE REFERENCES outcome_valuation_model_run_intent(intent_id),
  ADD COLUMN predecessor_checkpoint_id TEXT,
  ADD CONSTRAINT outcome_model_continuation_links CHECK (
    (root_intent_id IS NULL AND previous_intent_id IS NULL AND predecessor_checkpoint_id IS NULL)
    OR (root_intent_id IS NOT NULL AND previous_intent_id IS NOT NULL AND predecessor_checkpoint_id IS NOT NULL));

CREATE TABLE outcome_valuation_model_run_checkpoint (
  checkpoint_id TEXT PRIMARY KEY CHECK (checkpoint_id ~ '^model-run-checkpoint:[a-f0-9]{64}$'),
  intent_id TEXT NOT NULL REFERENCES outcome_valuation_model_run_intent(intent_id),
  root_intent_id TEXT NOT NULL REFERENCES outcome_valuation_model_run_intent(intent_id),
  authorization_id TEXT NOT NULL REFERENCES outcome_valuation_model_run_authorization(authorization_id),
  request_id TEXT NOT NULL REFERENCES outcome_private_valuation_dispatch_request(request_id),
  operation_id TEXT NOT NULL REFERENCES outcome_private_valuation_model_operation(operation_id),
  claim_id TEXT NOT NULL REFERENCES outcome_private_valuation_dispatch_attempt(claim_id),
  attempt_number INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
  stage TEXT NOT NULL CHECK (stage IN ('started','candidate_locked','final_test_started','final_test_completed')),
  previous_checkpoint_id TEXT REFERENCES outcome_valuation_model_run_checkpoint(checkpoint_id),
  recorded_at TIMESTAMPTZ(3) NOT NULL,
  candidate_artifact JSONB,
  evidence_artifact JSONB,
  checkpoint_canonical_json TEXT NOT NULL,
  checkpoint_json JSONB NOT NULL,
  UNIQUE(root_intent_id,stage)
);
ALTER TABLE outcome_valuation_model_run_intent ADD CONSTRAINT outcome_model_continuation_checkpoint
  FOREIGN KEY(predecessor_checkpoint_id) REFERENCES outcome_valuation_model_run_checkpoint(checkpoint_id);

CREATE FUNCTION validate_outcome_model_run_checkpoint_insert() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE retained RECORD; latest RECORD; content JSONB:=NEW.checkpoint_json->'content';
  expected JSONB; reference JSONB; expected_stage TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('valuation-model-root:'||NEW.root_intent_id,0));
  SELECT intent.*,authority.consumed_at,operational.receipt_json,
    operational.authorized_at AS operational_authorized_at,operational.valid_through AS operational_valid_through,
    protocol.protocol_json INTO retained
    FROM outcome_valuation_model_run_intent intent
    JOIN outcome_valuation_model_run_authorization authority
      ON authority.intent_id=intent.intent_id AND authority.authorization_id=NEW.authorization_id
    JOIN outcome_valuation_model_run_operational_authorization operational
      ON operational.receipt_id=authority.operational_authorization_receipt_id
    JOIN outcome_valuation_model_protocol protocol ON protocol.protocol_id=intent.protocol_id
    WHERE intent.intent_id=NEW.intent_id FOR SHARE OF intent,authority,operational,protocol;
  IF retained.intent_id IS NULL OR retained.consumed_at IS NULL
    OR retained.environment IS DISTINCT FROM 'non_production'
    OR retained.protocol_json#>>'{content,schemaVersion}' IS DISTINCT FROM 'afl-trade-model-protocol/v3'
    OR retained.receipt_json#>>'{content,authorityBoundary}' IS DISTINCT FROM
      'policy_owned_local_private_valuation_for_one_exact_model_run_intent'
    OR coalesce(retained.root_intent_id,retained.intent_id) IS DISTINCT FROM NEW.root_intent_id
    OR EXISTS (SELECT 1 FROM outcome_valuation_model_run_intent WHERE previous_intent_id=NEW.intent_id)
    OR EXISTS (SELECT 1 FROM outcome_valuation_model_run WHERE intent_id=NEW.intent_id)
    OR retained.receipt_json#>>'{content,dispatchRequestId}' IS DISTINCT FROM NEW.request_id
    OR retained.receipt_json#>>'{content,substantiveOperationId}' IS DISTINCT FROM NEW.operation_id
    OR retained.receipt_json#>>'{content,dispatchClaimId}' IS DISTINCT FROM NEW.claim_id
    OR (retained.receipt_json#>>'{content,dispatchAttemptNumber}')::INTEGER IS DISTINCT FROM NEW.attempt_number
  THEN RAISE EXCEPTION 'Checkpoint requires exact consumed private run authority'; END IF;
  PERFORM load_outcome_private_valuation_dispatch_request_for_claim(NEW.request_id,NEW.claim_id,
    retained.receipt_json#>>'{content,dispatchLeaseTokenSha256}');
  IF retained.operational_authorized_at > clock_timestamp()
    OR retained.operational_valid_through <= clock_timestamp()
  THEN RAISE EXCEPTION 'Checkpoint requires current operational receipt'; END IF;
  IF NOT EXISTS (SELECT 1 FROM outcome_private_valuation_model_request_binding
    WHERE request_id=NEW.request_id AND operation_id=NEW.operation_id)
  THEN RAISE EXCEPTION 'Checkpoint requires exact request operation binding'; END IF;
  SELECT * INTO latest FROM outcome_valuation_model_run_checkpoint
    WHERE root_intent_id=NEW.root_intent_id ORDER BY CASE stage
      WHEN 'started' THEN 1 WHEN 'candidate_locked' THEN 2 WHEN 'final_test_started' THEN 3 ELSE 4 END DESC LIMIT 1;
  expected_stage:=CASE latest.stage WHEN 'started' THEN 'candidate_locked'
    WHEN 'candidate_locked' THEN 'final_test_started' WHEN 'final_test_started' THEN 'final_test_completed'
    WHEN 'final_test_completed' THEN NULL ELSE 'started' END;
  IF NEW.stage IS DISTINCT FROM expected_stage
    OR NEW.previous_checkpoint_id IS DISTINCT FROM latest.checkpoint_id
    OR (NEW.stage='started' AND (NEW.intent_id<>NEW.root_intent_id OR NEW.candidate_artifact IS NOT NULL OR NEW.evidence_artifact IS NOT NULL))
    OR (NEW.stage<>'started' AND (NEW.candidate_artifact IS NULL OR NEW.evidence_artifact IS NULL))
    OR (NEW.stage IN ('final_test_started','final_test_completed') AND NEW.candidate_artifact IS DISTINCT FROM latest.candidate_artifact)
    OR NEW.recorded_at<retained.consumed_at OR NEW.recorded_at>clock_timestamp()
    OR NEW.recorded_at<clock_timestamp()-interval '5 seconds'
  THEN RAISE EXCEPTION 'Checkpoint stage cannot regress, repeat or change the locked candidate'; END IF;
  FOR reference IN SELECT NEW.candidate_artifact UNION ALL SELECT NEW.evidence_artifact LOOP
    IF reference IS NOT NULL AND (
      reference IS DISTINCT FROM jsonb_build_object('artifactId',reference->>'artifactId',
        'contentSha256',reference->>'contentSha256','storageUri',reference->>'storageUri',
        'mediaType',reference->>'mediaType','byteLength',(reference->>'byteLength')::BIGINT,'createdAt',reference->>'createdAt')
      OR reference->>'artifactId' IS DISTINCT FROM 'artifact:'||(reference->>'contentSha256')
      OR reference->>'storageUri' IS DISTINCT FROM 'artifact://sha256/'||(reference->>'contentSha256')
      OR coalesce(reference->>'contentSha256','') !~ '^[a-f0-9]{64}$'
      OR reference->>'mediaType' IS DISTINCT FROM 'application/json'
      OR (reference->>'byteLength')::BIGINT IS NULL OR (reference->>'byteLength')::BIGINT<=0
      OR coalesce(reference->>'createdAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]+)?)?(Z|[+-][0-9]{2}:[0-5][0-9])$'
      OR (reference->>'createdAt')::TIMESTAMPTZ IS NULL OR (reference->>'createdAt')::TIMESTAMPTZ>NEW.recorded_at)
    THEN RAISE EXCEPTION 'Checkpoint requires exact retained stage artifact references'; END IF;
  END LOOP;
  expected:=jsonb_build_object('schemaVersion','afl-trade-model-run-checkpoint/v1',
    'authorityBoundary','durable_model_run_stage_no_execution_or_qualification_authority',
    'publicationEligible',false,'environment','non_production','intentId',NEW.intent_id,
    'rootIntentId',NEW.root_intent_id,'authorizationId',NEW.authorization_id,'dispatchRequestId',NEW.request_id,
    'substantiveOperationId',NEW.operation_id,'dispatchClaimId',NEW.claim_id,'dispatchAttemptNumber',NEW.attempt_number,
    'stage',NEW.stage,'previousCheckpointId',NEW.previous_checkpoint_id,'recordedAt',content->'recordedAt',
    'candidateArtifact',NEW.candidate_artifact,'evidenceArtifact',NEW.evidence_artifact);
  IF content IS DISTINCT FROM expected OR (content->>'recordedAt')::TIMESTAMPTZ IS DISTINCT FROM NEW.recorded_at
    OR NEW.checkpoint_canonical_json IS DISTINCT FROM outcome_afl_trade_canonical_json(expected)
    OR NEW.checkpoint_id IS DISTINCT FROM 'model-run-checkpoint:'||encode(sha256(convert_to(NEW.checkpoint_canonical_json,'UTF8')),'hex')
    OR NEW.checkpoint_json IS DISTINCT FROM jsonb_build_object('checkpointId',NEW.checkpoint_id,'content',expected)
  THEN RAISE EXCEPTION 'Checkpoint canonical identity mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outcome_model_checkpoint_insert_guard BEFORE INSERT ON outcome_valuation_model_run_checkpoint
  FOR EACH ROW EXECUTE FUNCTION validate_outcome_model_run_checkpoint_insert();
CREATE TRIGGER outcome_model_checkpoint_append_only BEFORE UPDATE OR DELETE ON outcome_valuation_model_run_checkpoint
  FOR EACH ROW EXECUTE FUNCTION reject_outcome_valuation_dataset_mutation();

DO $paths$ BEGIN
  EXECUTE format('ALTER FUNCTION validate_outcome_model_run_checkpoint_insert() SET search_path TO %I,pg_catalog,pg_temp',current_schema());
END $paths$;
REVOKE ALL ON FUNCTION validate_outcome_model_run_checkpoint_insert() FROM PUBLIC;

-- Keep the complete original intent guard and allow only the explicit v2 successor.
DO $patch$ DECLARE definition TEXT; old TEXT:=$old$NEW."intent_json"->'content'->>'schemaVersion'<>
       'afl-trade-model-run-intent/v1'$old$;
BEGIN
  SELECT pg_get_functiondef('validate_outcome_valuation_model_intent_insert()'::regprocedure) INTO definition;
  IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN
    RAISE EXCEPTION 'Continuation expected one original intent version guard'; END IF;
  EXECUTE replace(definition,old,$new$NEW."intent_json"->'content'->>'schemaVersion' NOT IN
       ('afl-trade-model-run-intent/v1','afl-trade-model-run-intent/v2')$new$);
END $patch$;

CREATE FUNCTION validate_outcome_model_run_continuation_insert() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE content JSONB:=NEW.intent_json->'content'; binding JSONB:=content->'continuation';
  root RECORD; previous RECORD; latest RECORD; historical RECORD;
BEGIN
  IF content->>'schemaVersion'='afl-trade-model-run-intent/v1' THEN
    IF binding IS NOT NULL OR NEW.root_intent_id IS NOT NULL OR NEW.previous_intent_id IS NOT NULL
      OR NEW.predecessor_checkpoint_id IS NOT NULL THEN
      RAISE EXCEPTION 'Original intent cannot contain continuation links'; END IF;
    RETURN NEW;
  END IF;
  IF content->>'schemaVersion' IS DISTINCT FROM 'afl-trade-model-run-intent/v2'
    OR jsonb_typeof(binding) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Continuation requires explicit versioned binding'; END IF;
  IF binding IS DISTINCT FROM jsonb_build_object(
      'rootIntentId',binding->>'rootIntentId','previousIntentId',binding->>'previousIntentId',
      'checkpointId',binding->>'checkpointId','dispatchRequestId',binding->>'dispatchRequestId',
      'substantiveOperationId',binding->>'substantiveOperationId','dispatchClaimId',binding->>'dispatchClaimId',
      'dispatchLeaseTokenSha256',binding->>'dispatchLeaseTokenSha256','dispatchAttemptNumber',binding->'dispatchAttemptNumber')
    OR (binding->>'rootIntentId' ~ '^model-run-intent:[a-f0-9]{64}$') IS DISTINCT FROM TRUE
    OR (binding->>'previousIntentId' ~ '^model-run-intent:[a-f0-9]{64}$') IS DISTINCT FROM TRUE
    OR (binding->>'checkpointId' ~ '^model-run-checkpoint:[a-f0-9]{64}$') IS DISTINCT FROM TRUE
    OR (binding->>'dispatchRequestId' ~ '^private-valuation-dispatch:[a-f0-9]{64}$') IS DISTINCT FROM TRUE
    OR (binding->>'substantiveOperationId' ~ '^private-valuation-model-operation:[a-f0-9]{64}$') IS DISTINCT FROM TRUE
    OR (binding->>'dispatchClaimId' ~ '^private-valuation-dispatch-claim:[a-f0-9]{64}$') IS DISTINCT FROM TRUE
    OR (binding->>'dispatchLeaseTokenSha256' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM TRUE
    OR NOT coalesce(binding->'dispatchAttemptNumber' IN ('1'::jsonb,'2'::jsonb,'3'::jsonb),FALSE)
  THEN RAISE EXCEPTION 'Continuation requires exact binding shape'; END IF;
  IF (NEW.root_intent_id IS NOT NULL AND NEW.root_intent_id IS DISTINCT FROM binding->>'rootIntentId')
    OR (NEW.previous_intent_id IS NOT NULL AND NEW.previous_intent_id IS DISTINCT FROM binding->>'previousIntentId')
    OR (NEW.predecessor_checkpoint_id IS NOT NULL AND NEW.predecessor_checkpoint_id IS DISTINCT FROM binding->>'checkpointId') THEN
    RAISE EXCEPTION 'Continuation relational links mismatch'; END IF;
  NEW.root_intent_id:=binding->>'rootIntentId'; NEW.previous_intent_id:=binding->>'previousIntentId';
  NEW.predecessor_checkpoint_id:=binding->>'checkpointId';
  PERFORM pg_advisory_xact_lock(hashtextextended('valuation-model-root:'||NEW.root_intent_id,0));
  SELECT intent.*,authority.consumed_at,operational.receipt_json,protocol.protocol_json INTO root
    FROM outcome_valuation_model_run_intent intent
    JOIN outcome_valuation_model_run_authorization authority ON authority.intent_id=intent.intent_id
    JOIN outcome_valuation_model_run_operational_authorization operational
      ON operational.receipt_id=authority.operational_authorization_receipt_id
    JOIN outcome_valuation_model_protocol protocol ON protocol.protocol_id=intent.protocol_id
    WHERE intent.intent_id=NEW.root_intent_id FOR SHARE OF intent,authority,operational,protocol;
  SELECT * INTO previous FROM outcome_valuation_model_run_intent
    WHERE intent_id=NEW.previous_intent_id FOR SHARE;
  SELECT * INTO latest FROM outcome_valuation_model_run_checkpoint WHERE root_intent_id=NEW.root_intent_id
    ORDER BY CASE stage WHEN 'started' THEN 1 WHEN 'candidate_locked' THEN 2 WHEN 'final_test_started' THEN 3 ELSE 4 END DESC LIMIT 1;
  IF root.intent_id IS NULL OR root.root_intent_id IS NOT NULL OR root.consumed_at IS NULL
    OR root.environment IS DISTINCT FROM 'non_production' OR NEW.environment IS DISTINCT FROM root.environment
    OR root.protocol_json#>>'{content,schemaVersion}' IS DISTINCT FROM 'afl-trade-model-protocol/v3'
    OR root.receipt_json#>>'{content,authorityBoundary}' IS DISTINCT FROM 'policy_owned_local_private_valuation_for_one_exact_model_run_intent'
    OR previous.intent_id IS NULL OR coalesce(previous.root_intent_id,previous.intent_id) IS DISTINCT FROM root.intent_id
    OR latest.checkpoint_id IS NULL OR latest.checkpoint_id IS DISTINCT FROM NEW.predecessor_checkpoint_id
    OR latest.stage='final_test_started'
    OR EXISTS (SELECT 1 FROM outcome_valuation_model_run_intent WHERE previous_intent_id=NEW.previous_intent_id)
    OR EXISTS (SELECT 1 FROM outcome_valuation_model_run completed
      JOIN outcome_valuation_model_run_intent intent ON intent.intent_id=completed.intent_id
      WHERE coalesce(intent.root_intent_id,intent.intent_id)=root.intent_id)
    OR (content-ARRAY['schemaVersion','continuation','startedAt','job','modelTrainingEvaluationReceiptIds'])
      IS DISTINCT FROM ((root.intent_json->'content')-ARRAY['schemaVersion','startedAt','job','modelTrainingEvaluationReceiptIds'])
    OR NEW.intent_canonical_json IS DISTINCT FROM outcome_afl_trade_canonical_json(content)
    OR NEW.started_at<previous.started_at OR NEW.started_at>clock_timestamp()
    OR NEW.started_at<clock_timestamp()-interval '5 seconds'
    OR binding->>'dispatchRequestId' IS DISTINCT FROM root.receipt_json#>>'{content,dispatchRequestId}'
    OR binding->>'substantiveOperationId' IS DISTINCT FROM root.receipt_json#>>'{content,substantiveOperationId}'
  THEN RAISE EXCEPTION 'Continuation requires the latest unambiguous checkpoint and exact unfinished native root'; END IF;
  -- Historical root receipt proves custody, not current execution permission.
  SELECT * INTO historical FROM outcome_private_valuation_dispatch_attempt
    WHERE claim_id=root.receipt_json#>>'{content,dispatchClaimId}'
      AND request_id=binding->>'dispatchRequestId'
      AND attempt_number=(root.receipt_json#>>'{content,dispatchAttemptNumber}')::INTEGER
      AND lease_token_sha256=root.receipt_json#>>'{content,dispatchLeaseTokenSha256}';
  IF historical.claim_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM outcome_private_valuation_model_request_binding
    WHERE request_id=binding->>'dispatchRequestId' AND operation_id=binding->>'substantiveOperationId') THEN
    RAISE EXCEPTION 'Continuation lost original dispatch operation custody'; END IF;
  PERFORM load_outcome_private_valuation_dispatch_request_for_claim(binding->>'dispatchRequestId',
    binding->>'dispatchClaimId',binding->>'dispatchLeaseTokenSha256');
  IF NOT EXISTS (SELECT 1 FROM outcome_private_valuation_dispatch_attempt
    WHERE claim_id=binding->>'dispatchClaimId' AND request_id=binding->>'dispatchRequestId'
      AND attempt_number=(binding->>'dispatchAttemptNumber')::INTEGER AND finished_at IS NULL) THEN
    RAISE EXCEPTION 'Continuation current attempt mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outcome_model_continuation_insert_guard BEFORE INSERT ON outcome_valuation_model_run_intent
  FOR EACH ROW EXECUTE FUNCTION validate_outcome_model_run_continuation_insert();

CREATE FUNCTION fence_outcome_native_model_consumption() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE retained RECORD; binding JSONB;
BEGIN
  SELECT intent.*,protocol.protocol_json,operational.receipt_json INTO retained
    FROM outcome_valuation_model_run_intent intent
    JOIN outcome_valuation_model_protocol protocol ON protocol.protocol_id=intent.protocol_id
    JOIN outcome_valuation_model_run_operational_authorization operational
      ON operational.receipt_id=NEW.operational_authorization_receipt_id
    WHERE intent.intent_id=NEW.intent_id;
  IF retained.protocol_json#>>'{content,schemaVersion}' IS DISTINCT FROM 'afl-trade-model-protocol/v3'
    OR retained.receipt_json#>>'{content,authorityBoundary}' IS DISTINCT FROM 'policy_owned_local_private_valuation_for_one_exact_model_run_intent'
  THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('valuation-model-root:'||coalesce(retained.root_intent_id,retained.intent_id),0));
  IF EXISTS (SELECT 1 FROM outcome_valuation_model_run_intent WHERE previous_intent_id=NEW.intent_id) THEN
    RAISE EXCEPTION 'Native execution intent already has a continuation'; END IF;
  binding:=retained.intent_json#>'{content,continuation}';
  IF retained.root_intent_id IS NOT NULL AND (
    binding->>'dispatchClaimId' IS DISTINCT FROM retained.receipt_json#>>'{content,dispatchClaimId}'
    OR binding->>'dispatchRequestId' IS DISTINCT FROM retained.receipt_json#>>'{content,dispatchRequestId}'
    OR binding->>'substantiveOperationId' IS DISTINCT FROM retained.receipt_json#>>'{content,substantiveOperationId}'
    OR binding->>'dispatchLeaseTokenSha256' IS DISTINCT FROM retained.receipt_json#>>'{content,dispatchLeaseTokenSha256}'
    OR binding->>'dispatchAttemptNumber' IS DISTINCT FROM retained.receipt_json#>>'{content,dispatchAttemptNumber}') THEN
    RAISE EXCEPTION 'Continuation requires its fresh exact operational receipt'; END IF;
  PERFORM load_outcome_private_valuation_dispatch_request_for_claim(
    retained.receipt_json#>>'{content,dispatchRequestId}',retained.receipt_json#>>'{content,dispatchClaimId}',
    retained.receipt_json#>>'{content,dispatchLeaseTokenSha256}');
  RETURN NEW;
END $$;
CREATE TRIGGER outcome_native_model_consumption_fence BEFORE UPDATE ON outcome_valuation_model_run_authorization
  FOR EACH ROW EXECUTE FUNCTION fence_outcome_native_model_consumption();

CREATE FUNCTION require_outcome_native_model_started_checkpoint() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE retained RECORD;
BEGIN
  SELECT intent.*,protocol.protocol_json,operational.receipt_json INTO retained
    FROM outcome_valuation_model_run_intent intent
    JOIN outcome_valuation_model_protocol protocol ON protocol.protocol_id=intent.protocol_id
    JOIN outcome_valuation_model_run_operational_authorization operational
      ON operational.receipt_id=NEW.operational_authorization_receipt_id
    WHERE intent.intent_id=NEW.intent_id;
  IF retained.protocol_json#>>'{content,schemaVersion}'='afl-trade-model-protocol/v3'
    AND retained.receipt_json#>>'{content,authorityBoundary}'='policy_owned_local_private_valuation_for_one_exact_model_run_intent'
    AND NOT EXISTS (SELECT 1 FROM outcome_valuation_model_run_checkpoint
      WHERE root_intent_id=coalesce(retained.root_intent_id,retained.intent_id) AND stage='started'
        AND (retained.root_intent_id IS NOT NULL OR authorization_id=NEW.authorization_id)) THEN
    RAISE EXCEPTION 'Native root consumption requires its atomic started checkpoint'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER outcome_native_model_atomic_started AFTER UPDATE ON outcome_valuation_model_run_authorization
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_outcome_native_model_started_checkpoint();

DO $paths$ DECLARE name TEXT; BEGIN
  FOREACH name IN ARRAY ARRAY['validate_outcome_model_run_continuation_insert',
    'fence_outcome_native_model_consumption','require_outcome_native_model_started_checkpoint'] LOOP
    EXECUTE format('ALTER FUNCTION %I() SET search_path TO %I,pg_catalog,pg_temp',name,current_schema());
    EXECUTE format('REVOKE ALL ON FUNCTION %I() FROM PUBLIC',name);
  END LOOP;
END $paths$;
GRANT SELECT,INSERT ON outcome_valuation_model_run_checkpoint TO afl_trade_private_evaluation_coordinator;

-- Terminal writes participate in the same root fence as handoff and consumption.
CREATE FUNCTION fence_outcome_native_model_terminal_run() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE retained RECORD;
BEGIN
  SELECT intent.intent_id,intent.root_intent_id,protocol.protocol_json,operational.receipt_json,
    operational.authorized_at AS operational_authorized_at,operational.valid_through AS operational_valid_through INTO retained
    FROM outcome_valuation_model_run_intent intent
    JOIN outcome_valuation_model_protocol protocol ON protocol.protocol_id=intent.protocol_id
    JOIN outcome_valuation_model_run_authorization authority
      ON authority.intent_id=intent.intent_id AND authority.authorization_id=NEW.authorization_id
    JOIN outcome_valuation_model_run_operational_authorization operational
      ON operational.receipt_id=authority.operational_authorization_receipt_id
    WHERE intent.intent_id=NEW.intent_id;
  IF retained.protocol_json#>>'{content,schemaVersion}' IS DISTINCT FROM 'afl-trade-model-protocol/v3'
    OR retained.receipt_json#>>'{content,authorityBoundary}' IS DISTINCT FROM 'policy_owned_local_private_valuation_for_one_exact_model_run_intent'
  THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('valuation-model-root:'||coalesce(retained.root_intent_id,retained.intent_id),0));
  IF EXISTS (SELECT 1 FROM outcome_valuation_model_run completed
    WHERE completed.run_id=NEW.run_id AND completed.intent_id=NEW.intent_id
      AND completed.authorization_id=NEW.authorization_id AND completed.status=NEW.status
      AND completed.started_at=NEW.started_at AND completed.finished_at=NEW.finished_at
      AND completed.run_canonical_json=NEW.run_canonical_json AND completed.run_json=NEW.run_json)
  THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM outcome_valuation_model_run_intent WHERE previous_intent_id=NEW.intent_id)
    OR EXISTS (SELECT 1 FROM outcome_valuation_model_run completed
      JOIN outcome_valuation_model_run_intent intent ON intent.intent_id=completed.intent_id
      WHERE coalesce(intent.root_intent_id,intent.intent_id)=coalesce(retained.root_intent_id,retained.intent_id)
        AND (completed.run_id<>NEW.run_id OR completed.run_json IS DISTINCT FROM NEW.run_json)) THEN
    RAISE EXCEPTION 'Native terminal run has been handed off or already completed'; END IF;
  PERFORM load_outcome_private_valuation_dispatch_request_for_claim(
    retained.receipt_json#>>'{content,dispatchRequestId}',
    retained.receipt_json#>>'{content,dispatchClaimId}',
    retained.receipt_json#>>'{content,dispatchLeaseTokenSha256}');
  IF retained.operational_authorized_at > clock_timestamp()
    OR retained.operational_valid_through <= clock_timestamp()
  THEN RAISE EXCEPTION 'Native terminal run requires current operational receipt'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outcome_native_model_terminal_fence BEFORE INSERT ON outcome_valuation_model_run
  FOR EACH ROW EXECUTE FUNCTION fence_outcome_native_model_terminal_run();
DO $paths$ BEGIN
  EXECUTE format('ALTER FUNCTION fence_outcome_native_model_terminal_run() SET search_path TO %I,pg_catalog,pg_temp',current_schema());
END $paths$;
REVOKE ALL ON FUNCTION fence_outcome_native_model_terminal_run() FROM PUBLIC;
