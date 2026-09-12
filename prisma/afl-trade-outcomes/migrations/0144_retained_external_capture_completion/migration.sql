-- Retained captures share the existing plan/completion owners. No invented index or dispatch.
ALTER TABLE outcome_external_historical_capture_plan ALTER COLUMN inventory_id DROP NOT NULL;
ALTER TABLE outcome_external_historical_capture_plan DROP CONSTRAINT outcome_external_historical_plan_schema_check;
ALTER TABLE outcome_external_historical_capture_plan ADD CONSTRAINT outcome_external_historical_plan_schema_check
 CHECK (COALESCE((plan_json->'content'->>'schemaVersion'='afl-trade-external-historical-capture-plan/v1' AND inventory_id IS NOT NULL)
 OR (plan_json->'content'->>'schemaVersion'='afl-trade-external-historical-capture-plan/v2' AND inventory_id IS NULL
 AND environment IN ('test_fixture','non_production')),FALSE));
ALTER TABLE outcome_external_historical_capture_target ALTER COLUMN schedule_id DROP NOT NULL;
ALTER TABLE outcome_external_historical_capture_target DROP CONSTRAINT outcome_external_historical_target_capability_check;
ALTER TABLE outcome_external_historical_capture_target ADD CONSTRAINT outcome_external_historical_target_capability_check
 CHECK (capability_id IN ('draftguru-trade-detail','draftguru-player-trade-detail','draftguru-year-page',
 'draftguru-national-year-page','official-afl-completed-draft-session'));
ALTER TABLE outcome_external_historical_capture_completion_result
 ALTER COLUMN schedule_id DROP NOT NULL, ALTER COLUMN dispatch_key DROP NOT NULL,
 ALTER COLUMN occurrence_event_id DROP NOT NULL, ALTER COLUMN occurrence_revision DROP NOT NULL;
ALTER TABLE outcome_external_historical_capture_completion_result DROP CONSTRAINT outcome_external_historical_completion_mode_check;
ALTER TABLE outcome_external_historical_capture_completion_result ADD CONSTRAINT outcome_external_historical_completion_mode_check
 CHECK ((capture_mode='retained' AND schedule_id IS NULL AND dispatch_key IS NULL AND occurrence_event_id IS NULL AND occurrence_revision IS NULL)
 OR (capture_mode IN ('captured','not_modified') AND schedule_id IS NOT NULL AND dispatch_key IS NOT NULL
 AND occurrence_event_id IS NOT NULL AND occurrence_revision IS NOT NULL));

CREATE FUNCTION outcome_external_retained_artifact_current(ref JSONB, env TEXT, class TEXT, at_time TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
 SELECT EXISTS (SELECT 1 FROM outcome_artifact_custody c
 WHERE c.artifact_id=ref->>'artifactId' AND c.artifact_id='artifact:'||(ref->>'contentSha256')
 AND c.content_sha256=ref->>'contentSha256' AND c.storage_uri=ref->>'storageUri'
 AND c.storage_uri='artifact://sha256/'||(ref->>'contentSha256') AND c.media_type=ref->>'mediaType'
 AND c.byte_length=(ref->>'byteLength')::BIGINT AND c.created_at=(ref->>'createdAt')::TIMESTAMPTZ
 AND c.environment::TEXT=env AND c.artifact_class::TEXT=class AND c.verified_at<=at_time)
$$;

CREATE FUNCTION outcome_external_retained_target_is_current(target JSONB, env TEXT, competition TEXT, at_time TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE c outcome_source_capture%ROWTYPE; b outcome_external_evidence_batch%ROWTYPE;
 t JSONB:=target->'content'; req JSONB:=t->'request'; receipt JSONB; execution JSONB; rights JSONB;
BEGIN
 IF target IS DISTINCT FROM jsonb_build_object('targetId',target->'targetId','content',t)
 OR (t-ARRAY['ordinal','captureId','evidenceBatchId','executionReceiptId','rightsArtifactId','gateDecisionId','sourceArtifact','request']) IS DISTINCT FROM '{}'::JSONB
 OR env NOT IN ('test_fixture','non_production') OR req->>'environment' IS DISTINCT FROM env
 OR req->>'competition' IS DISTINCT FROM competition
 OR target->>'targetId' IS DISTINCT FROM 'external-capture-target:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(t),'UTF8')),'hex') THEN RETURN FALSE; END IF;
 SELECT * INTO c FROM outcome_source_capture WHERE capture_id=t->>'captureId';
 SELECT * INTO b FROM outcome_external_evidence_batch WHERE batch_id=t->>'evidenceBatchId';
 receipt:=c.manifest_json->'executionReceipt'; execution:=receipt->'content'; rights:=execution->'sourceRights'->'content';
 IF c.capture_id IS NULL OR b.batch_id IS NULL OR b.capture_id IS DISTINCT FROM c.capture_id
 OR c.status::TEXT IS DISTINCT FROM 'approved' OR b.status IS DISTINCT FROM 'finalized' OR b.issue_count<>0 OR b.evidence_count<1
 OR b.finalized_at IS NULL OR b.finalized_at>at_time OR c.captured_at>at_time
 OR c.environment::TEXT IS DISTINCT FROM env OR c.competition IS DISTINCT FROM competition
 OR c.provider IS DISTINCT FROM req->>'provider' OR c.dataset IS DISTINCT FROM req->>'dataset'
 OR c.dataset_version IS DISTINCT FROM req->>'datasetVersion' OR c.capability_id IS DISTINCT FROM req->>'capabilityId'
 OR c.access_mechanism IS DISTINCT FROM req->>'accessMechanism'
 OR c.anchor_season_year IS DISTINCT FROM (req->>'anchorSeasonYear')::INTEGER
 OR c.captured_at IS DISTINCT FROM (req->>'capturedAt')::TIMESTAMPTZ OR c.effective_at IS DISTINCT FROM (req->>'effectiveAt')::TIMESTAMPTZ
 OR c.manifest_json->'artifact' IS DISTINCT FROM t->'sourceArtifact'
 OR c.manifest_json->>'sourceUrl' IS DISTINCT FROM req->>'sourceUrl'
 OR c.manifest_json->>'parserVersion' IS DISTINCT FROM req->>'parserVersion'
 OR c.manifest_json->>'fieldManifestSha256' IS DISTINCT FROM req->>'fieldManifestSha256'
 OR receipt->>'receiptId' IS DISTINCT FROM t->>'executionReceiptId'
 OR receipt->>'receiptId' IS DISTINCT FROM 'external-capture-execution:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(execution),'UTF8')),'hex')
 OR execution->>'schemaVersion' IS DISTINCT FROM 'afl-trade-external-capture-execution/v2'
 OR execution->'request' IS DISTINCT FROM req
 OR execution->>'requestSha256' IS DISTINCT FROM encode(sha256(convert_to(outcome_afl_trade_canonical_json(req),'UTF8')),'hex')
 OR execution->'sourceRights'->>'rightsArtifactId' IS DISTINCT FROM t->>'rightsArtifactId'
 OR execution->'gate0aReceipt'->'content'->'result'->>'decisionId' IS DISTINCT FROM t->>'gateDecisionId'
 OR execution->'gate0aReceipt'->'content'->'result'->>'status' IS DISTINCT FROM 'mechanically_eligible'
 OR execution->'outcome'->>'status' IS DISTINCT FROM 'captured'
 OR execution->'outcome'->>'observedArtifactId' IS DISTINCT FROM t->'sourceArtifact'->>'artifactId'
 OR execution->'outcome'->>'contentSha256' IS DISTINCT FROM t->'sourceArtifact'->>'contentSha256'
 OR (execution->'admission'->>'startedAt')::TIMESTAMPTZ > (execution->'outcome'->>'completedAt')::TIMESTAMPTZ
 OR (execution->'outcome'->>'completedAt')::TIMESTAMPTZ > (execution->'admission'->>'leaseExpiresAt')::TIMESTAMPTZ
 OR (t->'sourceArtifact'->>'byteLength')::BIGINT > (req->>'maximumBytes')::BIGINT
 OR NOT outcome_external_retained_artifact_current(t->'sourceArtifact',env,'raw_source',at_time)
 OR NOT COALESCE(at_time < c.captured_at + make_interval(days=>(execution->'admission'->>'rawRetentionDays')::INTEGER),FALSE)
 OR NOT COALESCE((rights->>'termsEffectiveAt')::TIMESTAMPTZ<=at_time,FALSE)
 OR (rights->>'termsExpireAt' IS NOT NULL AND (rights->>'termsExpireAt')::TIMESTAMPTZ<=at_time)
 THEN RETURN FALSE; END IF;
 -- Historical admission remains historical; unrelated later ledger entries do not invalidate it.
 RETURN EXISTS (SELECT 1 FROM outcome_source_rights_proposal r
 JOIN outcome_gate_decision d ON d.decision_id=t->>'gateDecisionId'
 JOIN outcome_gate_proposal p ON p.proposal_id=d.proposal_id
 WHERE r.rights_artifact_id=t->>'rightsArtifactId' AND r.content_json=execution->'sourceRights'
 AND d.gate='gate_0a_permission_to_evaluate' AND d.environment::TEXT=env AND d.state='approved'
 AND d.decision_key=execution->'gate0aReceipt'->'content'->'request'->>'decisionKey'
 AND d.effective_at<=at_time AND d.revalidate_at>at_time
 AND p.proposal_json->'content'->'affectedArtifacts' @> jsonb_build_array(jsonb_build_object('kind','source_rights','artifactId',r.rights_artifact_id))
 AND NOT EXISTS (SELECT 1 FROM outcome_gate_decision successor WHERE successor.supersedes_decision_id=d.decision_id));
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN RETURN FALSE;
END $$;

CREATE FUNCTION outcome_external_retained_plan_is_current(plan JSONB, at_time TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE content JSONB:=plan->'content'; target JSONB; ref JSONB; n INTEGER:=0; ids JSONB:='[]';
 min_year INTEGER:=2200; max_year INTEGER:=0; seen_captures TEXT[]:='{}'; seen_batches TEXT[]:='{}'; prior_artifact TEXT:='';
BEGIN
 IF plan IS DISTINCT FROM jsonb_build_object('planId',plan->'planId','content',content)
 OR (content-ARRAY['schemaVersion','environment','competition','fromYear','throughYear','plannedAt','scopeEvidence','targets','targetCount','targetSetSha256','publicationEligible']) IS DISTINCT FROM '{}'::JSONB
 OR content->>'schemaVersion' IS DISTINCT FROM 'afl-trade-external-historical-capture-plan/v2'
 OR plan->>'planId' IS DISTINCT FROM 'external-historical-capture-plan:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(content),'UTF8')),'hex')
 OR content->>'environment' NOT IN ('test_fixture','non_production') OR content->>'competition' IS DISTINCT FROM 'AFLM'
 OR content->>'publicationEligible' IS DISTINCT FROM 'false'
 OR NOT COALESCE((content->>'plannedAt')::TIMESTAMPTZ<=at_time,FALSE)
 OR jsonb_typeof(content->'scopeEvidence') IS DISTINCT FROM 'array' OR jsonb_array_length(content->'scopeEvidence') NOT BETWEEN 1 AND 1000
 OR jsonb_typeof(content->'targets') IS DISTINCT FROM 'array' OR jsonb_array_length(content->'targets') NOT BETWEEN 1 AND 200000
 THEN RETURN FALSE; END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(content->'scopeEvidence') LOOP
  IF NOT outcome_external_retained_artifact_current(ref,content->>'environment','capture_metadata',at_time)
  OR NOT COALESCE((ref->>'createdAt')::TIMESTAMPTZ<=(content->>'plannedAt')::TIMESTAMPTZ,FALSE)
  OR ref->>'artifactId'<=prior_artifact THEN RETURN FALSE; END IF;
  prior_artifact:=ref->>'artifactId';
 END LOOP;
 FOR target IN SELECT value FROM jsonb_array_elements(content->'targets') LOOP
  n:=n+1;
  IF (target->'content'->>'ordinal')::INTEGER IS DISTINCT FROM n
  OR target->'content'->>'captureId'=ANY(seen_captures) OR target->'content'->>'evidenceBatchId'=ANY(seen_batches)
  OR NOT EXISTS (SELECT 1 FROM outcome_external_evidence_batch batch WHERE batch.batch_id=target->'content'->>'evidenceBatchId'
    AND batch.finalized_at<=(content->>'plannedAt')::TIMESTAMPTZ)
  OR NOT outcome_external_retained_target_is_current(target,content->>'environment',content->>'competition',at_time)
  OR NOT COALESCE((target->'content'->'request'->>'capturedAt')::TIMESTAMPTZ<=(content->>'plannedAt')::TIMESTAMPTZ,FALSE)
  OR NOT COALESCE((target->'content'->'sourceArtifact'->>'createdAt')::TIMESTAMPTZ<=(content->>'plannedAt')::TIMESTAMPTZ,FALSE)
  THEN RETURN FALSE; END IF;
  ids:=ids||jsonb_build_array(target->>'targetId');
  seen_captures:=array_append(seen_captures,target->'content'->>'captureId');
  seen_batches:=array_append(seen_batches,target->'content'->>'evidenceBatchId');
  min_year:=LEAST(min_year,(target->'content'->'request'->>'anchorSeasonYear')::INTEGER);
  max_year:=GREATEST(max_year,(target->'content'->'request'->>'anchorSeasonYear')::INTEGER);
 END LOOP;
 RETURN COALESCE(n=(content->>'targetCount')::INTEGER AND min_year=(content->>'fromYear')::INTEGER
 AND max_year=(content->>'throughYear')::INTEGER AND min_year>=1988 AND max_year<=2200 AND max_year-min_year<=100
 AND content->>'targetSetSha256'=encode(sha256(convert_to(outcome_afl_trade_canonical_json(ids),'UTF8')),'hex'),FALSE);
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN RETURN FALSE;
END $$;

CREATE FUNCTION outcome_external_retained_completion_is_current(id TEXT, at_time TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
 SELECT COALESCE((SELECT c.finalized_at IS NOT NULL AND p.finalized_at IS NOT NULL AND
 CASE c.completion_json->'content'->>'schemaVersion'
 WHEN 'afl-trade-external-historical-capture-completion/v1' THEN
 p.plan_json->'content'->>'schemaVersion'='afl-trade-external-historical-capture-plan/v1'
 WHEN 'afl-trade-external-historical-capture-completion/v2' THEN outcome_external_retained_plan_is_current(p.plan_json,at_time)
 ELSE FALSE END FROM outcome_external_historical_capture_completion c
 JOIN outcome_external_historical_capture_plan p USING(plan_id) WHERE c.completion_id=id),FALSE)
$$;

CREATE FUNCTION validate_outcome_external_retained_plan_insert() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.plan_json->'content'->>'schemaVersion'='afl-trade-external-historical-capture-plan/v2' THEN
  PERFORM 1 FROM outcome_gate_ledger_head WHERE singleton_id=1 FOR SHARE;
  IF NEW.finalized_at IS NOT NULL OR NOT outcome_external_retained_plan_is_current(NEW.plan_json,clock_timestamp())
  OR NEW.plan_id IS DISTINCT FROM NEW.plan_json->>'planId'
  OR NEW.environment::TEXT IS DISTINCT FROM NEW.plan_json->'content'->>'environment'
  OR NEW.competition IS DISTINCT FROM NEW.plan_json->'content'->>'competition'
  OR NEW.from_year IS DISTINCT FROM (NEW.plan_json->'content'->>'fromYear')::INTEGER
  OR NEW.through_year IS DISTINCT FROM (NEW.plan_json->'content'->>'throughYear')::INTEGER
  OR NEW.target_count IS DISTINCT FROM (NEW.plan_json->'content'->>'targetCount')::INTEGER
  OR NEW.target_set_sha256 IS DISTINCT FROM NEW.plan_json->'content'->>'targetSetSha256'
  OR NEW.planned_at IS DISTINCT FROM (NEW.plan_json->'content'->>'plannedAt')::TIMESTAMPTZ
  THEN RAISE EXCEPTION 'Retained plan requires exact current source ancestry and typed content'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER outcome_external_retained_plan_insert_guard BEFORE INSERT ON outcome_external_historical_capture_plan
 FOR EACH ROW EXECUTE FUNCTION validate_outcome_external_retained_plan_insert();

-- Prepend a fully checked retained variant, preserving every legacy validation body.
DO $patch$
DECLARE definition TEXT; insertion INTEGER; patch RECORD;
BEGIN
 FOR patch IN SELECT * FROM (VALUES
 ('validate_outcome_external_historical_target_insert', $body$
 IF EXISTS (SELECT 1 FROM outcome_external_historical_capture_plan p WHERE p.plan_id=NEW.plan_id
 AND p.plan_json->'content'->>'schemaVersion'='afl-trade-external-historical-capture-plan/v2') THEN
  IF NEW.schedule_id IS NOT NULL OR NEW.discovery_evidence_id IS NOT NULL OR NOT EXISTS (
   SELECT 1 FROM outcome_external_historical_capture_plan p WHERE p.plan_id=NEW.plan_id AND p.finalized_at IS NULL
   AND NEW.target_json=p.plan_json->'content'->'targets'->(NEW.ordinal-1)
   AND NEW.target_id=NEW.target_json->>'targetId' AND NEW.ordinal=(NEW.target_json->'content'->>'ordinal')::INTEGER
   AND NEW.capability_id=NEW.target_json->'content'->'request'->>'capabilityId'
   AND NEW.anchor_season_year=(NEW.target_json->'content'->'request'->>'anchorSeasonYear')::INTEGER
   AND NEW.source_url=NEW.target_json->'content'->'request'->>'sourceUrl'
   AND outcome_external_retained_target_is_current(NEW.target_json,p.environment::TEXT,p.competition,clock_timestamp())
  ) THEN RAISE EXCEPTION 'Retained target requires its exact open plan and current capture'; END IF;
  RETURN NEW;
 END IF;
$body$),
 ('finalize_outcome_external_historical_plan', $body$
 IF NEW.plan_json->'content'->>'schemaVersion'='afl-trade-external-historical-capture-plan/v2' THEN
  PERFORM 1 FROM outcome_gate_ledger_head WHERE singleton_id=1 FOR SHARE;
  IF OLD.finalized_at IS NOT NULL OR NEW.finalized_at IS DISTINCT FROM NEW.planned_at
  OR (to_jsonb(NEW)-'finalized_at') IS DISTINCT FROM (to_jsonb(OLD)-'finalized_at')
  OR NOT outcome_external_retained_plan_is_current(NEW.plan_json,clock_timestamp())
  OR (SELECT jsonb_agg(t.target_json ORDER BY t.ordinal) FROM outcome_external_historical_capture_target t WHERE t.plan_id=NEW.plan_id)
    IS DISTINCT FROM NEW.plan_json->'content'->'targets'
  THEN RAISE EXCEPTION 'Retained plan finalization requires exact current target conservation'; END IF;
  RETURN NEW;
 END IF;
$body$),
 ('validate_outcome_external_historical_completion_insert', $body$
 IF NEW.completion_json->'content'->>'schemaVersion'='afl-trade-external-historical-capture-completion/v2' THEN
  PERFORM 1 FROM outcome_gate_ledger_head WHERE singleton_id=1 FOR SHARE;
  SELECT * INTO plan_row FROM outcome_external_historical_capture_plan WHERE plan_id=NEW.plan_id FOR SHARE;
  content:=NEW.completion_json->'content';
  IF NOT FOUND OR plan_row.finalized_at IS NULL OR NOT outcome_external_retained_plan_is_current(plan_row.plan_json,clock_timestamp())
  OR (content-ARRAY['schemaVersion','environment','competition','planId','planSha256','targetCount','targetSetSha256','results','sourceBatchIds','resultSetSha256','sourceBatchSetSha256','completedAt','status','reconciliationEligible','publicationEligible']) IS DISTINCT FROM '{}'::JSONB
  OR NEW.completion_json IS DISTINCT FROM jsonb_build_object('completionId',NEW.completion_id,'content',content)
  OR NEW.finalized_at IS NOT NULL OR NEW.completion_json->>'completionId' IS DISTINCT FROM NEW.completion_id
  OR NEW.completion_canonical_json::JSONB IS DISTINCT FROM content
  OR NEW.completion_canonical_json IS DISTINCT FROM outcome_afl_trade_canonical_json(content)
  OR NEW.completion_id IS DISTINCT FROM 'external-historical-capture-completion:'||encode(sha256(convert_to(NEW.completion_canonical_json,'UTF8')),'hex')
  OR content->>'planId' IS DISTINCT FROM NEW.plan_id
  OR content->>'planSha256' IS DISTINCT FROM substring(NEW.plan_id from '([a-f0-9]{64})$')
  OR content->>'environment' IS DISTINCT FROM NEW.environment::TEXT OR NEW.environment IS DISTINCT FROM plan_row.environment
  OR content->>'competition' IS DISTINCT FROM NEW.competition OR NEW.competition IS DISTINCT FROM plan_row.competition
  OR (content->>'targetCount')::INTEGER IS DISTINCT FROM NEW.target_count OR NEW.target_count IS DISTINCT FROM plan_row.target_count
  OR content->>'targetSetSha256' IS DISTINCT FROM plan_row.target_set_sha256
  OR content->>'resultSetSha256' IS DISTINCT FROM NEW.result_set_sha256
  OR content->>'sourceBatchSetSha256' IS DISTINCT FROM NEW.source_batch_set_sha256
  OR NEW.result_set_sha256 IS DISTINCT FROM encode(sha256(convert_to(outcome_afl_trade_canonical_json(content->'results'),'UTF8')),'hex')
  OR NEW.source_batch_set_sha256 IS DISTINCT FROM encode(sha256(convert_to(outcome_afl_trade_canonical_json(content->'sourceBatchIds'),'UTF8')),'hex')
  OR (content->>'completedAt')::TIMESTAMPTZ IS DISTINCT FROM NEW.completed_at
  OR NEW.completed_at<plan_row.planned_at OR NEW.completed_at>clock_timestamp()
  OR content->>'status' IS DISTINCT FROM NEW.status OR content->>'reconciliationEligible' IS DISTINCT FROM 'true'
  OR content->>'publicationEligible' IS DISTINCT FROM 'false'
  THEN RAISE EXCEPTION 'Retained completion requires exact canonical content and current finalized plan'; END IF;
  RETURN NEW;
 END IF;
$body$),
 ('validate_outcome_external_historical_completion_result_insert', $body$
 IF NEW.capture_mode='retained' THEN
  SELECT * INTO parent_row FROM outcome_external_historical_capture_completion WHERE completion_id=NEW.completion_id FOR SHARE;
  SELECT * INTO target_row FROM outcome_external_historical_capture_target WHERE plan_id=NEW.plan_id AND ordinal=NEW.ordinal FOR SHARE;
  SELECT * INTO batch_row FROM outcome_external_evidence_batch WHERE batch_id=NEW.evidence_batch_id FOR SHARE;
  IF parent_row.completion_id IS NULL OR parent_row.finalized_at IS NOT NULL OR parent_row.plan_id IS DISTINCT FROM NEW.plan_id
  OR parent_row.completion_json->'content'->>'schemaVersion' IS DISTINCT FROM 'afl-trade-external-historical-capture-completion/v2'
  OR target_row.target_id IS DISTINCT FROM NEW.target_id OR target_row.schedule_id IS NOT NULL
  OR NEW.capture_id IS DISTINCT FROM target_row.target_json->'content'->>'captureId'
  OR NEW.evidence_batch_id IS DISTINCT FROM target_row.target_json->'content'->>'evidenceBatchId'
  OR NEW.result_id IS DISTINCT FROM NEW.evidence_batch_id
  OR batch_row.batch_id IS NULL OR batch_row.capture_id IS DISTINCT FROM NEW.capture_id
  OR batch_row.evidence_count IS DISTINCT FROM NEW.evidence_count OR batch_row.finalized_at IS DISTINCT FROM NEW.finalized_at
  OR NEW.finalized_at>parent_row.completed_at
  OR NOT outcome_external_retained_target_is_current(target_row.target_json,parent_row.environment::TEXT,parent_row.competition,clock_timestamp())
  THEN RAISE EXCEPTION 'Retained completion result requires exact current target and evidence'; END IF;
  expected_result:=jsonb_build_object('ordinal',NEW.ordinal,'targetId',NEW.target_id,'captureMode','retained',
   'resultId',NEW.result_id,'captureId',NEW.capture_id,'executionReceiptId',target_row.target_json->'content'->>'executionReceiptId',
   'evidenceBatchId',NEW.evidence_batch_id,'evidenceBatchSha256',substring(NEW.evidence_batch_id from '([a-f0-9]{64})$'),
   'evidenceCount',NEW.evidence_count,'finalizedAt',to_char(NEW.finalized_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  IF NEW.result_json IS DISTINCT FROM expected_result OR NEW.result_json IS DISTINCT FROM parent_row.completion_json->'content'->'results'->(NEW.ordinal-1)
  THEN RAISE EXCEPTION 'Retained result JSON must equal its typed columns and parent result'; END IF;
  RETURN NEW;
 END IF;
 IF EXISTS (SELECT 1 FROM outcome_external_historical_capture_completion c WHERE c.completion_id=NEW.completion_id
 AND c.completion_json->'content'->>'schemaVersion'<>'afl-trade-external-historical-capture-completion/v1')
 THEN RAISE EXCEPTION 'Scheduled result requires a legacy completion'; END IF;
$body$),
 ('validate_outcome_external_historical_completion_finalize', $body$
 IF NEW.completion_json->'content'->>'schemaVersion'='afl-trade-external-historical-capture-completion/v2' THEN
  PERFORM 1 FROM outcome_gate_ledger_head WHERE singleton_id=1 FOR SHARE;
  IF NOT EXISTS (SELECT 1 FROM outcome_external_historical_capture_plan p WHERE p.plan_id=NEW.plan_id AND p.finalized_at IS NOT NULL
   AND outcome_external_retained_plan_is_current(p.plan_json,clock_timestamp()))
  THEN RAISE EXCEPTION 'Retained completion finalization requires current source authority'; END IF;
 END IF;
$body$)
 ) AS patches(name,body) LOOP
  SELECT pg_get_functiondef((patch.name||'()')::REGPROCEDURE) INTO definition;
  insertion:=strpos(definition,E'\nBEGIN\n');
  IF insertion=0 THEN RAISE EXCEPTION 'Expected trigger entry in %',patch.name; END IF;
  EXECUTE overlay(definition placing E'\nBEGIN\n'||patch.body from insertion for 7);
 END LOOP;
END $patch$;
-- NULL scheduling ancestry is meaningful only for the retained variant.
DO $$ DECLARE original TEXT; old_fragment TEXT:='result.schedule_id=target.schedule_id';
BEGIN
 SELECT pg_get_functiondef('validate_outcome_external_historical_completion_finalize()'::REGPROCEDURE) INTO original;
 IF strpos(original,old_fragment)=0 THEN RAISE EXCEPTION 'Expected exact completion target membership guard'; END IF;
 EXECUTE replace(original,old_fragment,'result.schedule_id IS NOT DISTINCT FROM target.schedule_id');
END $$;

CREATE FUNCTION outcome_external_retained_batch_is_current(id TEXT, at_time TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE c outcome_source_capture%ROWTYPE; t JSONB;
BEGIN
 SELECT capture.* INTO c FROM outcome_source_capture capture
 JOIN outcome_external_evidence_batch batch ON batch.capture_id=capture.capture_id WHERE batch.batch_id=id;
 IF c.capture_id IS NULL THEN RETURN FALSE; END IF;
 t:=jsonb_build_object('ordinal',1,'captureId',c.capture_id,'evidenceBatchId',id,
 'executionReceiptId',c.manifest_json#>>'{executionReceipt,receiptId}',
 'rightsArtifactId',c.manifest_json#>>'{executionReceipt,content,sourceRights,rightsArtifactId}',
 'gateDecisionId',c.manifest_json#>>'{executionReceipt,content,gate0aReceipt,content,result,decisionId}',
 'sourceArtifact',c.manifest_json->'artifact','request',c.manifest_json#>'{executionReceipt,content,request}');
 RETURN outcome_external_retained_target_is_current(jsonb_build_object('content',t,
 'targetId','external-capture-target:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(t),'UTF8')),'hex')),
 c.environment::TEXT,c.competition,at_time);
END $$;
CREATE FUNCTION outcome_external_candidate_retained_sources_current(id TEXT, at_time TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
 SELECT COALESCE((SELECT (historical_completion_id IS NULL OR
 outcome_external_retained_completion_is_current(historical_completion_id,at_time))
 AND NOT EXISTS (SELECT 1 FROM outcome_external_reconciliation_source_batch source
 JOIN outcome_external_evidence_batch batch ON batch.batch_id=source.batch_id
 JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
 WHERE source.candidate_id=id
 AND capture.capability_id IN ('draftguru-national-year-page','official-afl-completed-draft-session')
 AND NOT outcome_external_retained_batch_is_current(batch.batch_id,at_time))
 FROM outcome_external_reconciliation_candidate WHERE candidate_id=id),FALSE)
$$;
CREATE FUNCTION guard_outcome_external_retained_identity_source() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM outcome_gate_ledger_head WHERE singleton_id=1 FOR SHARE;
 IF NEW.outcome='approved' AND NOT outcome_external_retained_completion_is_current(NEW.historical_completion_id,clock_timestamp())
 THEN RAISE EXCEPTION 'Identity review requires current retained completion sources'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER outcome_external_retained_identity_source_guard BEFORE INSERT ON outcome_external_identity_review_decision
 FOR EACH ROW EXECUTE FUNCTION guard_outcome_external_retained_identity_source();
CREATE FUNCTION guard_outcome_external_retained_candidate_source() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM outcome_gate_ledger_head WHERE singleton_id=1 FOR SHARE;
 IF (NEW.historical_completion_id IS NOT NULL AND NOT outcome_external_retained_completion_is_current(NEW.historical_completion_id,clock_timestamp()))
 OR (TG_OP='UPDATE' AND NOT outcome_external_candidate_retained_sources_current(NEW.candidate_id,clock_timestamp()))
 THEN RAISE EXCEPTION 'Reconciliation requires current retained completion sources'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER outcome_external_retained_candidate_source_guard BEFORE INSERT OR UPDATE ON outcome_external_reconciliation_candidate
 FOR EACH ROW EXECUTE FUNCTION guard_outcome_external_retained_candidate_source();
CREATE FUNCTION guard_outcome_external_retained_promotion_source() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM outcome_gate_ledger_head WHERE singleton_id=1 FOR SHARE;
 IF NOT outcome_external_candidate_retained_sources_current(NEW.candidate_id,clock_timestamp())
 THEN RAISE EXCEPTION 'Promotion requires current retained candidate sources'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER outcome_external_retained_promotion_review_source_guard BEFORE INSERT ON outcome_external_canonical_promotion_review_decision
 FOR EACH ROW WHEN (NEW.outcome='approved') EXECUTE FUNCTION guard_outcome_external_retained_promotion_source();
CREATE TRIGGER outcome_external_retained_promotion_source_guard BEFORE INSERT OR UPDATE ON outcome_external_canonical_promotion
 FOR EACH ROW EXECUTE FUNCTION guard_outcome_external_retained_promotion_source();
-- Shared acquisition predicate carries withdrawal into current spell and HPN reads.
DO $$ DECLARE original TEXT; fragment TEXT:=$old$candidate.status='finalized'$old$;
BEGIN
 SELECT pg_get_functiondef('outcome_acquisition_registration_event_current(JSONB,TEXT,TEXT,TEXT,TEXT,BOOLEAN,TIMESTAMPTZ,TIMESTAMPTZ)'::REGPROCEDURE) INTO original;
 IF (length(original)-length(replace(original,fragment,'')))/length(fragment)<>1
 THEN RAISE EXCEPTION 'Expected exact acquisition candidate status predicate'; END IF;
 EXECUTE replace(original,fragment,fragment||' AND outcome_external_candidate_retained_sources_current(candidate.candidate_id,cutoff)');
END $$;
