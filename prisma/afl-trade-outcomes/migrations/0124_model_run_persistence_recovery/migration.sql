-- Persistence-only terminal recovery. Existing intent/authorization and live-claim
-- fences remain in force; this format grants no evaluation or qualification authority.
DO $patch$ DECLARE definition TEXT;
  old TEXT:=$old$run_content->>'schemaVersion'<>'afl-trade-model-run/v3'$old$;
BEGIN
  SELECT pg_get_functiondef('validate_outcome_valuation_model_run_insert()'::regprocedure) INTO definition;
  IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN
    RAISE EXCEPTION 'Persistence recovery expected one original terminal version guard'; END IF;
  EXECUTE replace(definition,old,$new$run_content->>'schemaVersion' NOT IN
    ('afl-trade-model-run/v3','afl-trade-model-run/v4')$new$);
END $patch$;

CREATE FUNCTION validate_outcome_model_run_persistence_recovery() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE content JSONB:=NEW.run_json->'content'; recovery JSONB:=content->'recovery';
  retained RECORD; intents JSONB; checkpoints JSONB; report JSONB; reference JSONB;
  report_bytes TEXT; expected JSONB; output JSONB; field RECORD;
BEGIN
  IF content->>'schemaVersion'='afl-trade-model-run/v3' THEN RETURN NEW; END IF;
  IF content->>'schemaVersion' IS DISTINCT FROM 'afl-trade-model-run/v4' THEN
    RAISE EXCEPTION 'Unsupported terminal recovery version'; END IF;
  SELECT intent.*,protocol.protocol_json,authority.consumed_at,operational.receipt_json INTO retained
    FROM outcome_valuation_model_run_intent intent
    JOIN outcome_valuation_model_protocol protocol ON protocol.protocol_id=intent.protocol_id
    JOIN outcome_valuation_model_run_authorization authority ON authority.intent_id=intent.intent_id
      AND authority.authorization_id=NEW.authorization_id
    JOIN outcome_valuation_model_run_operational_authorization operational
      ON operational.receipt_id=authority.operational_authorization_receipt_id
    WHERE intent.intent_id=NEW.intent_id FOR SHARE OF intent,protocol,authority,operational;
  IF retained.intent_id IS NULL OR retained.root_intent_id IS NULL OR retained.consumed_at IS NULL
    OR retained.environment IS DISTINCT FROM 'non_production'
    OR retained.intent_json#>>'{content,schemaVersion}' IS DISTINCT FROM 'afl-trade-model-run-intent/v2'
    OR retained.protocol_json#>>'{content,schemaVersion}' IS DISTINCT FROM 'afl-trade-model-protocol/v3'
    OR retained.receipt_json#>>'{content,authorityBoundary}' IS DISTINCT FROM
      'policy_owned_local_private_valuation_for_one_exact_model_run_intent'
  THEN RAISE EXCEPTION 'Persistence recovery requires a consumed private native continuation'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('valuation-model-root:'||retained.root_intent_id,0));
  WITH RECURSIVE chain AS (
    SELECT intent_json,previous_intent_id,0 AS depth FROM outcome_valuation_model_run_intent
      WHERE intent_id=NEW.intent_id
    UNION ALL
    SELECT parent.intent_json,parent.previous_intent_id,child.depth+1
      FROM outcome_valuation_model_run_intent parent JOIN chain child ON parent.intent_id=child.previous_intent_id
      WHERE child.depth<1000
  ) SELECT jsonb_agg(intent_json ORDER BY depth DESC) INTO intents FROM chain;
  SELECT jsonb_agg(checkpoint_json ORDER BY CASE stage WHEN 'started' THEN 1
    WHEN 'candidate_locked' THEN 2 WHEN 'final_test_started' THEN 3 ELSE 4 END)
    INTO checkpoints FROM outcome_valuation_model_run_checkpoint WHERE root_intent_id=retained.root_intent_id;
  IF jsonb_array_length(intents) NOT BETWEEN 2 AND 1000
    OR intents#>>'{0,intentId}' IS DISTINCT FROM retained.root_intent_id
    OR jsonb_array_length(checkpoints) IS DISTINCT FROM 4
    OR retained.predecessor_checkpoint_id IS DISTINCT FROM checkpoints#>>'{3,checkpointId}'
    OR recovery->'intentChain' IS DISTINCT FROM intents OR recovery->'checkpoints' IS DISTINCT FROM checkpoints
    OR recovery IS DISTINCT FROM jsonb_build_object('intentChain',intents,'checkpoints',checkpoints,
      'completionEvidence',recovery->'completionEvidence')
  THEN RAISE EXCEPTION 'Persistence recovery requires exact retained complete ancestry'; END IF;
  report:=recovery->'completionEvidence';
  reference:=checkpoints#>'{3,content,evidenceArtifact}';
  report_bytes:=outcome_afl_trade_canonical_json(report);
  IF report IS NULL OR report IS DISTINCT FROM jsonb_build_object(
      'schemaVersion','afl-trade-native-final-test-completion/v1',
      'authorityBoundary','retained_execution_evidence_no_execution_or_qualification_authority',
      'publicationEligible',false,'environment','non_production',
      'finalTestStartedCheckpoint',checkpoints->2,'evaluatedAt',report->'evaluatedAt',
      'recordedAt',report->'recordedAt','outcome',report->'outcome')
    OR reference->>'contentSha256' IS DISTINCT FROM encode(sha256(convert_to(report_bytes,'UTF8')),'hex')
    OR (reference->>'byteLength')::BIGINT IS DISTINCT FROM octet_length(convert_to(report_bytes,'UTF8'))
    OR report->>'recordedAt' IS DISTINCT FROM reference->>'createdAt'
    OR report#>'{outcome,modelArtifact}' IS DISTINCT FROM checkpoints#>'{1,content,candidateArtifact}'
    OR coalesce(report->>'evaluatedAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]+)?)?(Z|[+-][0-9]{2}:[0-5][0-9])$'
    OR (report->>'evaluatedAt')::TIMESTAMPTZ < (checkpoints#>>'{2,content,recordedAt}')::TIMESTAMPTZ
    OR (report->>'evaluatedAt')::TIMESTAMPTZ > (report->>'recordedAt')::TIMESTAMPTZ
    OR (report->>'recordedAt')::TIMESTAMPTZ > (checkpoints#>>'{3,content,recordedAt}')::TIMESTAMPTZ
    OR (checkpoints#>>'{3,content,recordedAt}')::TIMESTAMPTZ > NEW.started_at
    OR NEW.finished_at < NEW.started_at OR NEW.finished_at < retained.consumed_at
    OR NEW.finished_at > clock_timestamp()
    OR coalesce(content->>'finishedAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]+)?)?(Z|[+-][0-9]{2}:[0-5][0-9])$'
    OR (content->>'finishedAt')::TIMESTAMPTZ IS DISTINCT FROM NEW.finished_at
  THEN RAISE EXCEPTION 'Persistence recovery requires exact completed evaluation custody and chronology'; END IF;
  output:=report->'outcome';
  IF jsonb_typeof(output) IS DISTINCT FROM 'object' OR output->>'status' IS DISTINCT FROM 'succeeded'
    OR NOT (output ?& ARRAY['status','modelArtifact','validationReportArtifact','baselineComparisonArtifact',
      'calibrationReportArtifact','intervalCoverageArtifact','subgroupReportArtifact','sensitivityReportArtifact',
      'leakageAuditArtifact','modelCardArtifact','diagnosticsArtifact'])
    OR (output-ARRAY['status','modelArtifact','selectionValidationReportArtifact','validationReportArtifact',
      'baselineComparisonArtifact','calibrationReportArtifact','intervalCoverageArtifact','subgroupReportArtifact',
      'sensitivityReportArtifact','leakageAuditArtifact','modelCardArtifact','diagnosticsArtifact'])<>'{}'::JSONB
  THEN RAISE EXCEPTION 'Persistence recovery requires complete successful execution outputs'; END IF;
  FOR field IN SELECT key,value FROM jsonb_each(output) WHERE key<>'status' LOOP
    reference:=field.value;
    IF jsonb_typeof(reference) IS DISTINCT FROM 'object'
      OR reference IS DISTINCT FROM jsonb_build_object('artifactId',reference->>'artifactId',
        'contentSha256',reference->>'contentSha256','storageUri',reference->>'storageUri',
        'mediaType',reference->>'mediaType','byteLength',(reference->>'byteLength')::BIGINT,'createdAt',reference->>'createdAt')
      OR reference->>'artifactId' IS DISTINCT FROM 'artifact:'||(reference->>'contentSha256')
      OR reference->>'storageUri' IS DISTINCT FROM 'artifact://sha256/'||(reference->>'contentSha256')
      OR coalesce(reference->>'contentSha256','') !~ '^[a-f0-9]{64}$'
      OR length(coalesce(reference->>'mediaType','')) NOT BETWEEN 1 AND 160
      OR reference->>'mediaType' IS DISTINCT FROM btrim(reference->>'mediaType')
      OR coalesce(reference->>'mediaType','') !~ '[^[:space:]]'
      OR (reference->>'byteLength')::BIGINT IS NULL OR (reference->>'byteLength')::BIGINT<0
      OR coalesce(reference->>'createdAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]+)?)?(Z|[+-][0-9]{2}:[0-5][0-9])$'
      OR (reference->>'createdAt')::TIMESTAMPTZ > (report->>'recordedAt')::TIMESTAMPTZ
    THEN RAISE EXCEPTION 'Persistence recovery output reference is invalid'; END IF;
  END LOOP;
  expected:=((retained.intent_json->'content')-ARRAY['schemaVersion','authorityBoundary','publicationEligible','continuation'])
    || jsonb_build_object('schemaVersion','afl-trade-model-run/v4',
      'authorityBoundary','persistence_recovery_only_no_execution_or_qualification_authority',
      'publicationEligible',false,'runIntentId',NEW.intent_id,'runAuthorizationId',NEW.authorization_id,
      'candidateLockedAt',checkpoints#>'{1,content,recordedAt}','finalTestEvaluatedAt',report->'evaluatedAt',
      'finishedAt',content->'finishedAt','outcome',output,'recovery',recovery);
  IF content IS DISTINCT FROM expected
    OR NEW.run_canonical_json IS DISTINCT FROM outcome_afl_trade_canonical_json(expected)
    OR NEW.run_json IS DISTINCT FROM jsonb_build_object('runId',NEW.run_id,'content',expected)
  THEN RAISE EXCEPTION 'Persistence recovery terminal does not match its exact child and evidence'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outcome_valuation_model_run_recovery_guard BEFORE INSERT ON outcome_valuation_model_run
  FOR EACH ROW EXECUTE FUNCTION validate_outcome_model_run_persistence_recovery();
DO $paths$ BEGIN
  EXECUTE format('ALTER FUNCTION validate_outcome_model_run_persistence_recovery() SET search_path TO %I,pg_catalog,pg_temp',current_schema());
END $paths$;
REVOKE ALL ON FUNCTION validate_outcome_model_run_persistence_recovery() FROM PUBLIC;
