-- Explicit evaluation-cohort authority is neither player training nor pick training.
-- Only a selected, currently admitted promotion-backed lineage can supply trades.
CREATE TABLE outcome_private_valuation_cohort_binding (
  request_id TEXT PRIMARY KEY,
  lineage_admission_id TEXT NOT NULL,
  binding_json JSONB NOT NULL,
  CONSTRAINT outcome_cohort_binding_request_fkey FOREIGN KEY (request_id)
    REFERENCES outcome_private_valuation_dispatch_request(request_id) ON DELETE RESTRICT,
  CONSTRAINT outcome_cohort_binding_admission_fkey FOREIGN KEY (lineage_admission_id)
    REFERENCES outcome_corpus_factual_lineage_admission(admission_id) ON DELETE RESTRICT
);
CREATE TRIGGER outcome_cohort_binding_no_update_delete
  BEFORE UPDATE OR DELETE ON outcome_private_valuation_cohort_binding
  FOR EACH ROW EXECUTE FUNCTION reject_outcome_current_valuation_factual_refresh_mutation();
GRANT SELECT,INSERT ON outcome_private_valuation_cohort_binding TO afl_trade_private_valuation_scheduler_owner;
GRANT SELECT ON outcome_corpus_factual_lineage,outcome_corpus_factual_lineage_admission,
  outcome_promotion_backed_corpus,outcome_release_source_capture,outcome_release_event_version,
  outcome_event_version,outcome_event,outcome_source_rights_proposal,outcome_gate_proposal,
  outcome_gate_decision TO afl_trade_private_valuation_scheduler_owner;

DO $membership$ BEGIN
  EXECUTE format('GRANT afl_trade_private_valuation_scheduler_owner TO %I',session_user);
END $membership$;
SET ROLE afl_trade_private_valuation_scheduler_owner;

CREATE FUNCTION authenticate_outcome_private_valuation_cohort_input(
  target_request_id TEXT,target_admission_id TEXT
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE request RECORD; parent RECORD; hpn JSONB; lock_key TEXT; source RECORD;
  receipt JSONB; trade_ids JSONB; trusted_at TIMESTAMPTZ:=clock_timestamp();
BEGIN
  SELECT dispatch.*,output.output_id INTO request
    FROM outcome_private_valuation_dispatch_request dispatch
    JOIN outcome_private_valuation_factual_output output ON output.request_id=dispatch.request_id
   WHERE dispatch.request_id=target_request_id AND dispatch.scope_key='afl-men:2025-trades';
  IF NOT FOUND THEN RAISE EXCEPTION 'Private cohort requires the exact 2025 dispatch output'; END IF;
  hpn:=load_outcome_private_valuation_hpn_factual_input(target_request_id,request.output_id);
  IF hpn IS NULL THEN RAISE EXCEPTION 'Private cohort requires current factual authority'; END IF;

  SELECT lineage.*,admission.gate_decision_id,admission.gate_proposal_id,
    candidate.candidate_json,candidate.candidate_sha256,candidate.finalized_at AS candidate_finalized_at,
    release.manifest_json,release.manifest_canonical_json,release.created_at AS release_created_at,
    release.effective_through,corpus.knowledge_cutoff_at,corpus.corpus_json
    INTO parent
    FROM outcome_corpus_factual_lineage_admission admission
    JOIN outcome_corpus_factual_lineage lineage ON lineage.lineage_id=admission.lineage_id
    JOIN outcome_factual_release_candidate candidate
      ON candidate.candidate_id=lineage.candidate_id AND candidate.target_release_id=lineage.release_id
     AND candidate.promotion_backed_corpus_id=lineage.corpus_id
     AND candidate.environment='non_production' AND candidate.scope_key=request.scope_key
     AND candidate.status='approved' AND candidate.finalized_at IS NOT NULL
     AND candidate.source_member_set_sha256=lineage.source_member_set_sha256
     AND candidate.canonical_member_set_sha256=lineage.canonical_member_set_sha256
     AND candidate.candidate_json#>>'{content,schemaVersion}'='afl-trade-factual-release-candidate/v4'
    JOIN outcome_release_manifest release ON release.release_id=lineage.release_id
     AND release.environment='non_production' AND release.scope_key=request.scope_key
     AND release.manifest_json=candidate.candidate_json#>'{content,targetReleaseManifest}'
     AND release.manifest_json#>>'{content,schemaVersion}'='afl-draft-trade-factual-release/v3'
    JOIN outcome_promotion_backed_corpus corpus ON corpus.corpus_id=lineage.corpus_id
     AND corpus.environment='non_production' AND corpus.competition='AFLM'
     AND corpus.status='finalized' AND corpus.finalized_at IS NOT NULL
     AND corpus.member_set_sha256=lineage.source_member_set_sha256
   WHERE admission.admission_id=target_admission_id AND lineage.environment='non_production'
     AND lineage.scope_key=request.scope_key AND lineage.competition='AFLM'
     AND 2025 BETWEEN lineage.valid_from_season AND lineage.valid_through_season;
  IF NOT FOUND THEN RAISE EXCEPTION 'Private cohort lineage admission is unavailable or mismatched'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-release-membership:'||parent.release_id,0));
  -- Capture and gate locks use the existing writers' namespaces, in deterministic order.
  FOR lock_key IN SELECT 'outcome-capture-scope:'||capture_id
    FROM outcome_release_source_capture WHERE release_id=parent.release_id ORDER BY capture_id
  LOOP PERFORM pg_advisory_xact_lock(hashtextextended(lock_key,0)); END LOOP;
  FOR lock_key IN
    SELECT DISTINCT 'afl-trade-gate:'||gate.gate||':'||gate.environment::TEXT||':'||gate.decision_key
      FROM outcome_gate_decision gate WHERE gate.decision_id=parent.gate_decision_id
       OR gate.decision_id IN (SELECT membership_json->>'gateDecisionId'
         FROM outcome_release_source_capture WHERE release_id=parent.release_id)
     ORDER BY 1
  LOOP PERFORM pg_advisory_xact_lock(hashtextextended(lock_key,0)); END LOOP;

  trusted_at:=clock_timestamp();
  PERFORM load_outcome_private_valuation_dispatch_request_for_claim(
    target_request_id,request.claim_id,request.lease_token_sha256);
  IF parent.knowledge_cutoff_at IS DISTINCT FROM parent.effective_through
    OR parent.effective_through>trusted_at OR parent.release_created_at>trusted_at
    OR parent.candidate_finalized_at>trusted_at
    OR parent.manifest_json#>>'{content,corpusId}' IS DISTINCT FROM parent.corpus_id
    OR parent.manifest_json#>>'{content,sourceMemberSetSha256}' IS DISTINCT FROM parent.source_member_set_sha256::TEXT
    OR parent.manifest_json#>>'{content,canonicalMemberSetSha256}' IS DISTINCT FROM parent.canonical_member_set_sha256::TEXT
    OR 'outcome-release:'||encode(sha256(convert_to(parent.manifest_canonical_json,'UTF8')),'hex') IS DISTINCT FROM parent.release_id
    OR parent.manifest_canonical_json::JSONB IS DISTINCT FROM parent.manifest_json->'content'
    OR EXISTS (SELECT 1 FROM outcome_active_release WHERE release_id=parent.release_id)
    OR (SELECT record_state_json->>'state' FROM outcome_record_state_commitment
      WHERE release_id=parent.release_id ORDER BY event_revision DESC LIMIT 1) IS DISTINCT FROM 'approved'
  THEN RAISE EXCEPTION 'Private cohort release is unavailable, active, or outside its cutoff'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM outcome_gate_decision gate JOIN outcome_gate_proposal proposal
      ON proposal.proposal_id=gate.proposal_id AND proposal.proposal_id=parent.gate_proposal_id
     AND proposal.gate=gate.gate AND proposal.environment=gate.environment
     AND proposal.decision_key=gate.decision_key
    WHERE gate.decision_id=parent.gate_decision_id AND gate.gate='gate_2_corpus_lineage'
      AND gate.decision_key='gate2:'||parent.lineage_id AND gate.environment='non_production'
      AND gate.state='approved' AND gate.effective_at<=trusted_at AND gate.revalidate_at>trusted_at
      AND proposal.scope_key=request.scope_key
      AND NOT EXISTS (SELECT 1 FROM outcome_gate_decision successor WHERE successor.supersedes_decision_id=gate.decision_id)
      AND proposal.proposal_json#>'{content,affectedArtifacts}'=jsonb_build_array(
        jsonb_build_object('kind','corpus_manifest','artifactId',parent.corpus_id),
        jsonb_build_object('kind','factual_release','artifactId',parent.release_id),
        jsonb_build_object('kind','factual_release_candidate','artifactId',parent.candidate_id),
        jsonb_build_object('kind','corpus_factual_lineage','artifactId',parent.lineage_id))
      AND gate.decision_json#>'{content,affectedArtifacts}'=proposal.proposal_json#>'{content,affectedArtifacts}'
  ) THEN RAISE EXCEPTION 'Private cohort Gate 2 admission is not current'; END IF;

  IF jsonb_array_length(parent.manifest_json#>'{content,sourceCaptures}') IS NULL
    OR jsonb_array_length(parent.manifest_json#>'{content,sourceCaptures}')=0
    OR (SELECT jsonb_agg(membership_json ORDER BY capture_id) FROM outcome_release_source_capture
      WHERE release_id=parent.release_id) IS DISTINCT FROM
      (SELECT jsonb_agg(item ORDER BY item->>'captureId') FROM jsonb_array_elements(
        parent.manifest_json#>'{content,sourceCaptures}') entries(item))
  THEN RAISE EXCEPTION 'Private cohort source capture membership is incomplete'; END IF;
  FOR source IN
    SELECT member.*,capture.source_snapshot_id,capture.environment,capture.competition,
      capture.status,capture.captured_at,capture.manifest_json
      FROM outcome_release_source_capture member
      LEFT JOIN outcome_source_capture capture USING (capture_id)
     WHERE member.release_id=parent.release_id ORDER BY member.capture_id
  LOOP
    receipt:=source.manifest_json#>'{executionReceipt,content}';
    IF source.status IS DISTINCT FROM 'approved' OR source.environment IS DISTINCT FROM 'non_production'
      OR source.competition IS DISTINCT FROM 'AFLM' OR source.captured_at>parent.knowledge_cutoff_at
      OR source.membership_json->>'sourceSnapshotId' IS DISTINCT FROM source.source_snapshot_id
      OR source.record_canonical_json::JSONB IS DISTINCT FROM source.manifest_json
      OR encode(sha256(convert_to(source.record_canonical_json,'UTF8')),'hex') IS DISTINCT FROM source.record_sha256::TEXT
      OR receipt->>'schemaVersion' IS DISTINCT FROM 'afl-trade-external-capture-execution/v2'
      OR receipt#>>'{request,environment}' IS DISTINCT FROM 'non_production'
      OR receipt#>>'{request,competition}' IS DISTINCT FROM 'AFLM'
      OR receipt#>>'{gate0aReceipt,content,result,status}' IS DISTINCT FROM 'mechanically_eligible'
      OR receipt#>>'{gate0aReceipt,content,result,decisionId}' IS DISTINCT FROM source.membership_json->>'gateDecisionId'
      OR receipt#>>'{sourceRights,rightsArtifactId}' IS DISTINCT FROM source.membership_json->>'rightsArtifactId'
    THEN RAISE EXCEPTION 'Private cohort source capture authority is mismatched'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM outcome_source_rights_proposal rights
      JOIN outcome_gate_decision gate ON gate.decision_id=source.membership_json->>'gateDecisionId'
      JOIN outcome_gate_proposal proposal ON proposal.proposal_id=gate.proposal_id
       AND proposal.gate=gate.gate AND proposal.environment=gate.environment AND proposal.decision_key=gate.decision_key
      WHERE rights.rights_artifact_id=source.membership_json->>'rightsArtifactId'
        AND rights.content_json=receipt->'sourceRights'
        AND gate.gate='gate_0a_permission_to_evaluate' AND gate.environment='non_production'
        AND gate.decision_key=receipt#>>'{gate0aReceipt,content,request,decisionKey}'
        AND gate.state='approved' AND gate.effective_at<=trusted_at AND gate.revalidate_at>trusted_at
        AND proposal.proposal_json#>'{content,affectedArtifacts}' @> jsonb_build_array(
          jsonb_build_object('kind','source_rights','artifactId',rights.rights_artifact_id))
        AND NOT EXISTS (SELECT 1 FROM outcome_gate_decision successor WHERE successor.supersedes_decision_id=gate.decision_id)
    ) THEN RAISE EXCEPTION 'Private cohort source Gate 0A permission is not current'; END IF;
  END LOOP;

  SELECT jsonb_agg(item->>'canonicalRecordId' ORDER BY item->>'canonicalRecordId') INTO trade_ids
    FROM jsonb_array_elements(parent.manifest_json#>'{content,canonicalMembers}') members(item)
   WHERE item->>'recordKind'='transaction';
  IF trade_ids IS NULL OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(parent.manifest_json#>'{content,canonicalMembers}') members(item)
    LEFT JOIN outcome_release_event_version member ON member.release_id=parent.release_id
      AND member.event_version_id=item->>'canonicalRecordId' AND member.membership_json=item
    LEFT JOIN outcome_event_version version ON version.event_version_id=member.event_version_id
    LEFT JOIN outcome_event event ON event.event_id=version.event_id
    WHERE item->>'recordKind'='transaction' AND (member.event_version_id IS NULL
      OR version.kind IS DISTINCT FROM 'trade' OR version.status IS DISTINCT FROM 'approved'
      OR event.competition IS DISTINCT FROM 'AFLM' OR event.season_year IS DISTINCT FROM 2025
      OR version.recorded_at>parent.knowledge_cutoff_at OR version.event_date>parent.knowledge_cutoff_at::DATE)
  ) THEN RAISE EXCEPTION 'Private cohort requires exhaustive approved AFLM 2025 trades'; END IF;

  RETURN jsonb_build_object('requestId',target_request_id,'factualOutputId',request.output_id,
    'factualOperationId',hpn->>'factualOperationId','privateFactualCandidateId',hpn->>'privateFactualCandidateId',
    'privateFactualRevision',(hpn->>'privateFactualRevision')::INTEGER,
    'lineageAdmissionId',target_admission_id,'lineageId',parent.lineage_id,'corpusId',parent.corpus_id,
    'cohortCandidateId',parent.candidate_id,'cohortReleaseId',parent.release_id,'cohortScopeKey',parent.scope_key,
    'sourceMemberSetSha256',parent.source_member_set_sha256,'canonicalMemberSetSha256',parent.canonical_member_set_sha256,
    'sourceCaptureSetSha256',parent.manifest_json#>>'{content,sourceCaptureSetSha256}',
    'promotionSourceSetSha256',parent.manifest_json#>>'{content,promotionSourceSetSha256}',
    'effectiveThrough',to_char(parent.effective_through AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'cohortTradeIds',trade_ids);
END $$;

CREATE FUNCTION load_outcome_private_valuation_cohort_input(target_request_id TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE retained RECORD; current_binding JSONB;
BEGIN
  SELECT * INTO retained FROM outcome_private_valuation_cohort_binding WHERE request_id=target_request_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  current_binding:=authenticate_outcome_private_valuation_cohort_input(target_request_id,retained.lineage_admission_id);
  IF current_binding IS DISTINCT FROM retained.binding_json THEN RAISE EXCEPTION 'Private cohort bound authority changed'; END IF;
  RETURN retained.binding_json;
END $$;

CREATE FUNCTION bind_outcome_private_valuation_cohort_input(
  target_request_id TEXT,target_claim_id TEXT,target_lease_sha256 TEXT,target_admission_id TEXT
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE retained JSONB; binding JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-private-cohort-binding:'||target_request_id,0));
  PERFORM load_outcome_private_valuation_dispatch_request_for_claim(target_request_id,target_claim_id,target_lease_sha256);
  binding:=authenticate_outcome_private_valuation_cohort_input(target_request_id,target_admission_id);
  retained:=load_outcome_private_valuation_cohort_input(target_request_id);
  IF retained IS NOT NULL THEN
    IF retained IS DISTINCT FROM binding THEN RAISE EXCEPTION 'Private cohort cannot substitute retained authority'; END IF;
    RETURN retained;
  END IF;
  INSERT INTO outcome_private_valuation_cohort_binding VALUES (target_request_id,target_admission_id,binding);
  RETURN binding;
END $$;

DO $paths$ DECLARE signature TEXT; BEGIN
  FOREACH signature IN ARRAY ARRAY['authenticate_outcome_private_valuation_cohort_input(TEXT,TEXT)',
    'load_outcome_private_valuation_cohort_input(TEXT)','bind_outcome_private_valuation_cohort_input(TEXT,TEXT,TEXT,TEXT)']
  LOOP
    EXECUTE format('ALTER FUNCTION %I.%s SET search_path TO %I,pg_catalog,pg_temp',current_schema(),signature,current_schema());
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%s FROM PUBLIC',current_schema(),signature);
  END LOOP;
END $paths$;
GRANT EXECUTE ON FUNCTION bind_outcome_private_valuation_cohort_input(TEXT,TEXT,TEXT,TEXT)
  TO afl_trade_private_evaluation_coordinator;
GRANT EXECUTE ON FUNCTION load_outcome_private_valuation_cohort_input(TEXT)
  TO afl_trade_private_evaluation_coordinator,afl_trade_private_prepared_v3_owner;
RESET ROLE;
DO $membership$ BEGIN
  EXECUTE format('REVOKE afl_trade_private_valuation_scheduler_owner FROM %I',session_user);
END $membership$;
