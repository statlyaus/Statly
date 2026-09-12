-- Match Gate 0A: absent terms dates do not imply a provider terms start date.
-- Explicit effective/expiry dates and current Gate/custody checks remain mandatory.
CREATE OR REPLACE FUNCTION outcome_external_retained_target_is_current(target JSONB, env TEXT, competition TEXT, at_time TIMESTAMPTZ)
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
 OR (rights->>'termsEffectiveAt' IS NOT NULL AND NOT COALESCE((rights->>'termsEffectiveAt')::TIMESTAMPTZ<=at_time,FALSE))
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
