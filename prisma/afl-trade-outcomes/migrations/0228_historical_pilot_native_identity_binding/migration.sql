-- The retained pilot uses native content-addressed player and club IDs. Authenticate the
-- selected spell against the unique approved player asset in the exact Cameron event.
DO $membership$ BEGIN
  EXECUTE format('GRANT afl_trade_private_valuation_scheduler_owner TO %I',session_user);
END $membership$;
SET ROLE afl_trade_private_valuation_scheduler_owner;

CREATE OR REPLACE FUNCTION authenticate_outcome_private_valuation_historical_cohort_input(
  target_request_id TEXT,target_admission_id TEXT,target_context JSONB
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE
  pilot_scope CONSTANT TEXT:='afl-men:historical-pilot:2020-jeremy-cameron';
  pilot_trade CONSTANT TEXT:='external-transaction:40cb6950856a32a389022fa2dfb2e7c988781ca6646a0dfaa56387e13f4a408b';
  request RECORD; parent RECORD; source RECORD; review RECORD; spell RECORD; start_member RECORD;
  context_content JSONB; review_content JSONB; expected_context JSONB;
  authority_content JSONB; authority JSONB; binding JSONB; receipt JSONB;
  trade_ids JSONB; target_member_count INTEGER; lock_key TEXT;
  trusted_at TIMESTAMPTZ:=clock_timestamp();
BEGIN
  IF jsonb_typeof(target_context) IS DISTINCT FROM 'object'
    OR target_context->>'contextId' !~ '^postseason-year-context:[a-f0-9]{64}$'
    OR jsonb_typeof(target_context->'content') IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION 'Historical cohort requires one exact postseason context'; END IF;
  context_content:=target_context->'content';
  IF context_content->>'schemaVersion' IS DISTINCT FROM 'afl-trade-postseason-year-context/v1'
    OR context_content->>'environment' IS DISTINCT FROM 'non_production'
    OR context_content->>'competition' IS DISTINCT FROM 'AFLM'
    OR context_content->>'tradeId' IS DISTINCT FROM pilot_trade
    OR context_content->>'tradeYear' IS DISTINCT FROM '2020'
    OR context_content->>'period' IS DISTINCT FROM 'established_postseason'
    OR jsonb_typeof(context_content->'knowledgeCutoffAt') IS DISTINCT FROM 'string'
    OR context_content->>'knowledgePolicy' IS DISTINCT FROM 'retrospective_as_recorded_by_dataset_creation'
    OR target_context->>'contextId' IS DISTINCT FROM
      outcome_postseason_address('postseason-year-context',context_content)
    OR (context_content->>'knowledgeCutoffAt')::TIMESTAMPTZ>trusted_at
  THEN RAISE EXCEPTION 'Historical cohort postseason context is outside the exact pilot'; END IF;

  SELECT * INTO request FROM outcome_private_valuation_dispatch_request
   WHERE request_id=target_request_id AND scope_key=pilot_scope;
  IF NOT FOUND THEN RAISE EXCEPTION 'Historical cohort requires the exact pilot dispatch'; END IF;

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
     AND candidate.environment='non_production' AND candidate.scope_key=pilot_scope
     AND candidate.status='approved' AND candidate.finalized_at IS NOT NULL
     AND candidate.source_member_set_sha256=lineage.source_member_set_sha256
     AND candidate.canonical_member_set_sha256=lineage.canonical_member_set_sha256
     AND candidate.candidate_json#>>'{content,schemaVersion}'='afl-trade-factual-release-candidate/v4'
    JOIN outcome_release_manifest release ON release.release_id=lineage.release_id
     AND release.environment='non_production' AND release.scope_key=pilot_scope
     AND release.manifest_json=candidate.candidate_json#>'{content,targetReleaseManifest}'
     AND release.manifest_json#>>'{content,schemaVersion}'='afl-draft-trade-factual-release/v3'
    JOIN outcome_promotion_backed_corpus corpus ON corpus.corpus_id=lineage.corpus_id
     AND corpus.environment='non_production' AND corpus.competition='AFLM'
     AND corpus.status='finalized' AND corpus.finalized_at IS NOT NULL
     AND corpus.member_set_sha256=lineage.source_member_set_sha256
   WHERE admission.admission_id=target_admission_id AND lineage.environment='non_production'
     AND lineage.scope_key=pilot_scope AND lineage.competition='AFLM'
     AND lineage.valid_from_season=2021 AND lineage.valid_through_season=2021;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Historical cohort lineage admission is unavailable or mismatched';
  END IF;

  SELECT * INTO review FROM outcome_review_decision
   WHERE decision_id=context_content->>'reviewDecisionId'
     AND subject_type='postseason_materialization' AND decision='approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'Historical cohort postseason review is unavailable'; END IF;
  review_content:=review.evidence_json->'content';

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-review-subject:postseason_materialization:'||review.subject_id,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-release-membership:'||parent.release_id,0));
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
    OR parent.effective_through>(context_content->>'knowledgeCutoffAt')::TIMESTAMPTZ
    OR parent.release_created_at>(context_content->>'knowledgeCutoffAt')::TIMESTAMPTZ
    OR parent.candidate_finalized_at>(context_content->>'knowledgeCutoffAt')::TIMESTAMPTZ
    OR parent.manifest_json#>>'{content,corpusId}' IS DISTINCT FROM parent.corpus_id
    OR parent.manifest_json#>>'{content,sourceMemberSetSha256}' IS DISTINCT FROM parent.source_member_set_sha256::TEXT
    OR parent.manifest_json#>>'{content,canonicalMemberSetSha256}' IS DISTINCT FROM parent.canonical_member_set_sha256::TEXT
    OR 'outcome-release:'||encode(sha256(convert_to(parent.manifest_canonical_json,'UTF8')),'hex')
      IS DISTINCT FROM parent.release_id
    OR parent.manifest_canonical_json::JSONB IS DISTINCT FROM parent.manifest_json->'content'
    OR EXISTS (SELECT 1 FROM outcome_active_release WHERE release_id=parent.release_id)
    OR EXISTS (SELECT 1 FROM outcome_record_state_commitment state
      WHERE state.release_id=parent.release_id AND state.event_revision=(
        SELECT max(latest.event_revision) FROM outcome_record_state_commitment latest
        WHERE latest.release_id=parent.release_id)
      AND state.record_state_json->>'state'<>'approved')
  THEN RAISE EXCEPTION 'Historical cohort release is unavailable, active, or outside its cutoff'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM outcome_gate_decision gate JOIN outcome_gate_proposal proposal
      ON proposal.proposal_id=gate.proposal_id AND proposal.proposal_id=parent.gate_proposal_id
     AND proposal.gate=gate.gate AND proposal.environment=gate.environment
     AND proposal.decision_key=gate.decision_key
    WHERE gate.decision_id=parent.gate_decision_id AND gate.gate='gate_2_corpus_lineage'
      AND gate.decision_key='gate2:'||parent.lineage_id AND gate.environment='non_production'
      AND gate.state='approved' AND gate.effective_at<=trusted_at AND gate.revalidate_at>trusted_at
      AND proposal.scope_key=pilot_scope
      AND NOT EXISTS (SELECT 1 FROM outcome_gate_decision successor
        WHERE successor.supersedes_decision_id=gate.decision_id)
      AND proposal.proposal_json#>'{content,affectedArtifacts}'=jsonb_build_array(
        jsonb_build_object('kind','corpus_manifest','artifactId',parent.corpus_id),
        jsonb_build_object('kind','factual_release','artifactId',parent.release_id),
        jsonb_build_object('kind','factual_release_candidate','artifactId',parent.candidate_id),
        jsonb_build_object('kind','corpus_factual_lineage','artifactId',parent.lineage_id))
      AND gate.decision_json#>'{content,affectedArtifacts}'=
        proposal.proposal_json#>'{content,affectedArtifacts}'
  ) THEN RAISE EXCEPTION 'Historical cohort Gate 2 admission is not current'; END IF;

  IF jsonb_array_length(parent.manifest_json#>'{content,sourceCaptures}') IS NULL
    OR jsonb_array_length(parent.manifest_json#>'{content,sourceCaptures}')=0
    OR (SELECT jsonb_agg(membership_json ORDER BY capture_id) FROM outcome_release_source_capture
      WHERE release_id=parent.release_id) IS DISTINCT FROM
      (SELECT jsonb_agg(item ORDER BY item->>'captureId') FROM jsonb_array_elements(
        parent.manifest_json#>'{content,sourceCaptures}') entries(item))
  THEN RAISE EXCEPTION 'Historical cohort source capture membership is incomplete'; END IF;
  FOR source IN
    SELECT member.*,capture.source_snapshot_id,capture.environment,capture.competition,
      capture.status,capture.captured_at,capture.manifest_json
      FROM outcome_release_source_capture member
      LEFT JOIN outcome_source_capture capture USING (capture_id)
     WHERE member.release_id=parent.release_id ORDER BY member.capture_id
  LOOP
    receipt:=source.manifest_json#>'{executionReceipt,content}';
    IF source.status IS DISTINCT FROM 'approved'
      OR source.environment IS DISTINCT FROM 'non_production'
      OR source.competition IS DISTINCT FROM 'AFLM'
      OR source.captured_at>parent.knowledge_cutoff_at
      OR source.membership_json->>'sourceSnapshotId' IS DISTINCT FROM source.source_snapshot_id
      OR source.record_canonical_json::JSONB IS DISTINCT FROM source.manifest_json
      OR encode(sha256(convert_to(source.record_canonical_json,'UTF8')),'hex')
        IS DISTINCT FROM source.record_sha256::TEXT
      OR receipt->>'schemaVersion' IS DISTINCT FROM 'afl-trade-external-capture-execution/v2'
      OR receipt#>>'{request,environment}' IS DISTINCT FROM 'non_production'
      OR receipt#>>'{request,competition}' IS DISTINCT FROM 'AFLM'
      OR receipt#>>'{gate0aReceipt,content,result,status}' IS DISTINCT FROM 'mechanically_eligible'
      OR receipt#>>'{gate0aReceipt,content,result,decisionId}'
        IS DISTINCT FROM source.membership_json->>'gateDecisionId'
      OR receipt#>>'{sourceRights,rightsArtifactId}'
        IS DISTINCT FROM source.membership_json->>'rightsArtifactId'
    THEN RAISE EXCEPTION 'Historical cohort source capture authority is mismatched'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM outcome_source_rights_proposal rights
      JOIN outcome_gate_decision gate ON gate.decision_id=source.membership_json->>'gateDecisionId'
      JOIN outcome_gate_proposal proposal ON proposal.proposal_id=gate.proposal_id
       AND proposal.gate=gate.gate AND proposal.environment=gate.environment
       AND proposal.decision_key=gate.decision_key
      WHERE rights.rights_artifact_id=source.membership_json->>'rightsArtifactId'
        AND rights.content_json=receipt->'sourceRights'
        AND gate.gate='gate_0a_permission_to_evaluate' AND gate.environment='non_production'
        AND gate.decision_key=receipt#>>'{gate0aReceipt,content,request,decisionKey}'
        AND gate.state='approved' AND gate.effective_at<=trusted_at AND gate.revalidate_at>trusted_at
        AND proposal.proposal_json#>'{content,affectedArtifacts}' @> jsonb_build_array(
          jsonb_build_object('kind','source_rights','artifactId',rights.rights_artifact_id))
        AND NOT EXISTS (SELECT 1 FROM outcome_gate_decision successor
          WHERE successor.supersedes_decision_id=gate.decision_id)
    ) THEN RAISE EXCEPTION 'Historical cohort source Gate 0A permission is not current'; END IF;
  END LOOP;

  SELECT count(*) INTO target_member_count
    FROM jsonb_array_elements(parent.manifest_json#>'{content,canonicalMembers}') members(item)
   WHERE item->>'recordKind'='transaction'
     AND item->>'canonicalRecordId'=context_content->>'eventVersionId';
  IF target_member_count<>1
    OR context_content->>'tradeId'=context_content->>'eventVersionId'
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(parent.manifest_json#>'{content,canonicalMembers}') members(item)
      LEFT JOIN outcome_release_event_version member ON member.release_id=parent.release_id
        AND member.event_version_id=item->>'canonicalRecordId' AND member.membership_json=item
      LEFT JOIN outcome_event_version version ON version.event_version_id=member.event_version_id
      LEFT JOIN outcome_event event ON event.event_id=version.event_id
      WHERE item->>'recordKind'='transaction'
        AND item->>'canonicalRecordId'=context_content->>'eventVersionId'
        AND (member.event_version_id IS NULL
        OR version.kind IS DISTINCT FROM 'trade' OR version.status IS DISTINCT FROM 'approved'
        OR event.competition IS DISTINCT FROM 'AFLM' OR event.season_year IS DISTINCT FROM 2020
        OR event.event_id IS DISTINCT FROM pilot_trade
        OR version.event_version_id IS DISTINCT FROM context_content->>'eventVersionId'
        OR version.event_date IS DISTINCT FROM (context_content->>'tradeDate')::DATE
        OR version.recorded_at>(context_content->>'knowledgeCutoffAt')::TIMESTAMPTZ
        OR (version.event_date IS NOT NULL
          AND version.event_date>(context_content->>'knowledgeCutoffAt')::DATE)
        OR EXISTS (SELECT 1 FROM outcome_event_version successor
          WHERE successor.supersedes_version_id=version.event_version_id))
    )
  THEN RAISE EXCEPTION 'Historical cohort requires the exact approved 2020 pilot transaction'; END IF;
  trade_ids:=jsonb_build_array(context_content->>'eventVersionId');

  IF review.subject_id IS DISTINCT FROM outcome_postseason_address(
      'postseason-materialization-review',review_content)
    OR review_content->>'schemaVersion' IS DISTINCT FROM
      'afl-trade-postseason-materialization-review/v1'
    OR review_content->>'authorityBoundary' IS DISTINCT FROM
      'private_factual_materialization_no_numerical_admission'
    OR review_content->>'environment' IS DISTINCT FROM 'non_production'
    OR review_content->>'competition' IS DISTINCT FROM 'AFLM'
    OR review_content->>'scopeKey' IS DISTINCT FROM pilot_scope
    OR review_content->>'releaseId' IS DISTINCT FROM parent.release_id
    OR review_content->>'tradeId' IS DISTINCT FROM pilot_trade
    OR review_content->>'eventVersionId' IS DISTINCT FROM context_content->>'eventVersionId'
    OR review_content->>'tradeYear' IS DISTINCT FROM '2020'
    OR review_content->'tradeDate' IS DISTINCT FROM context_content->'tradeDate'
    OR review_content->>'period' IS DISTINCT FROM 'established_postseason'
    OR review_content->'reviewEvidence' IS DISTINCT FROM context_content->'reviewEvidence'
    OR review.decided_at>(context_content->>'knowledgeCutoffAt')::TIMESTAMPTZ
    OR NOT outcome_acquisition_registration_review_current(
      review.decision_id,'postseason_materialization',review.subject_id,review.evidence_json,
      (review_content->>'createdAt')::TIMESTAMPTZ,review.decided_at,trusted_at)
    OR NOT outcome_acquisition_registration_evidence_exact(
      jsonb_build_array(review_content->'reviewEvidence'),'non_production',
      (review_content->>'createdAt')::TIMESTAMPTZ,review.decided_at)
  THEN RAISE EXCEPTION 'Historical cohort postseason review is not current or exact'; END IF;

  SELECT * INTO spell FROM outcome_acquisition_spell_version
   WHERE spell_version_id=review_content->>'spellVersionId' FOR SHARE;
  IF FOUND THEN
    SELECT * INTO start_member FROM outcome_release_event_asset
     WHERE release_id=parent.release_id
       AND asset_version_id=spell.start_asset_version_id
       AND record_sha256=encode(sha256(convert_to(record_canonical_json,'UTF8')),'hex');
  END IF;
  IF NOT FOUND
    OR start_member.record_canonical_json::JSONB#>>'{record,eventVersionId}'
      IS DISTINCT FROM context_content->>'eventVersionId'
    OR start_member.record_canonical_json::JSONB#>>'{record,kind}' IS DISTINCT FROM 'player'
    OR start_member.record_canonical_json::JSONB#>>'{record,status}' IS DISTINCT FROM 'approved'
    OR spell.player_id IS DISTINCT FROM start_member.record_canonical_json::JSONB#>>'{record,playerId}'
    OR spell.club_id IS DISTINCT FROM start_member.record_canonical_json::JSONB#>>'{record,toClubId}'
    OR (SELECT count(*) FROM outcome_release_event_asset candidate
         WHERE candidate.release_id=parent.release_id
           AND candidate.record_canonical_json::JSONB#>>'{record,eventVersionId}'=
             context_content->>'eventVersionId'
           AND candidate.record_canonical_json::JSONB#>>'{record,kind}'='player'
           AND candidate.record_canonical_json::JSONB#>>'{record,status}'='approved')<>1
    OR NOT outcome_acquisition_spell_registration_current(spell.spell_version_id,trusted_at)
    OR spell.registration_canonical_json::JSONB#>>'{entry,promotionId}'
      IS DISTINCT FROM review_content->>'promotionId'
    OR spell.registration_canonical_json::JSONB#>>'{entry,eventVersionId}'
      IS DISTINCT FROM context_content->>'eventVersionId'
    OR spell.registration_canonical_json::JSONB#>'{entry,eventDate}'
      IS DISTINCT FROM context_content->'tradeDate'
    OR (spell.registration_canonical_json::JSONB->>'createdAt')::TIMESTAMPTZ>
      (context_content->>'knowledgeCutoffAt')::TIMESTAMPTZ
    OR NOT EXISTS (
      SELECT 1 FROM outcome_release_event_asset asset
       WHERE asset.release_id=parent.release_id
         AND asset.asset_version_id=spell.start_asset_version_id
         AND asset.record_sha256=encode(sha256(convert_to(asset.record_canonical_json,'UTF8')),'hex'))
  THEN RAISE EXCEPTION 'Historical cohort acquisition spell is not current or exact'; END IF;

  expected_context:=jsonb_build_object(
    'schemaVersion','afl-trade-postseason-year-context/v1','environment','non_production',
    'competition','AFLM','tradeId',pilot_trade,'promotionId',review_content->>'promotionId',
    'eventVersionId',review_content->>'eventVersionId','tradeYear',2020,
    'tradeDate',review_content->'tradeDate','period','established_postseason',
    'reviewDecisionId',review.decision_id,'reviewEvidence',review_content->'reviewEvidence',
    'recordedAt',to_char(review.decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'knowledgeCutoffAt',context_content->>'knowledgeCutoffAt',
    'knowledgePolicy','retrospective_as_recorded_by_dataset_creation');
  IF context_content IS DISTINCT FROM expected_context THEN
    RAISE EXCEPTION 'Historical cohort postseason context content differs';
  END IF;

  authority_content:=jsonb_build_object(
    'schemaVersion','afl-trade-private-historical-factual-authority/v1',
    'authorityBoundary','promotion_backed_postseason_factual_only',
    'requestId',target_request_id,'cohortScopeKey',pilot_scope,
    'lineageAdmissionId',target_admission_id,'cohortReleaseId',parent.release_id,
    'reviewDecisionId',review.decision_id,'postseasonContextId',target_context->>'contextId',
    'transactionId',pilot_trade,'eventVersionId',context_content->>'eventVersionId',
    'tradeYear',2020,'revision',1,
    'knowledgeCutoffAt',context_content->>'knowledgeCutoffAt');
  authority:=jsonb_build_object('authorityId',
    'private-valuation-historical-factual-authority:'||encode(sha256(convert_to(
      outcome_afl_trade_canonical_json(authority_content),'UTF8')),'hex'),'content',authority_content);
  binding:=jsonb_build_object(
    'schemaVersion','afl-trade-private-valuation-cohort-binding/v2',
    'requestId',target_request_id,'historicalFactualAuthority',authority,
    'lineageAdmissionId',target_admission_id,'lineageId',parent.lineage_id,
    'corpusId',parent.corpus_id,'cohortCandidateId',parent.candidate_id,
    'cohortReleaseId',parent.release_id,'cohortScopeKey',pilot_scope,
    'sourceMemberSetSha256',parent.source_member_set_sha256,
    'canonicalMemberSetSha256',parent.canonical_member_set_sha256,
    'sourceCaptureSetSha256',parent.manifest_json#>>'{content,sourceCaptureSetSha256}',
    'promotionSourceSetSha256',parent.manifest_json#>>'{content,promotionSourceSetSha256}',
    'effectiveThrough',to_char(parent.effective_through AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'cohortTransactionId',pilot_trade,'tradeYear',2020,'cohortTradeIds',trade_ids,
    'postseasonYearContexts',jsonb_build_array(target_context));
  PERFORM load_outcome_private_valuation_dispatch_request_for_claim(
    target_request_id,request.claim_id,request.lease_token_sha256);
  RETURN binding;
END $$;

DO $path$ BEGIN
  EXECUTE format(
    'ALTER FUNCTION %I.authenticate_outcome_private_valuation_historical_cohort_input(TEXT,TEXT,JSONB) SET search_path TO %I,pg_catalog,pg_temp',
    current_schema(),current_schema());
  EXECUTE format(
    'REVOKE ALL ON FUNCTION %I.authenticate_outcome_private_valuation_historical_cohort_input(TEXT,TEXT,JSONB) FROM PUBLIC',
    current_schema());
END $path$;
RESET ROLE;
DO $membership$ BEGIN
  EXECUTE format('REVOKE afl_trade_private_valuation_scheduler_owner FROM %I',session_user);
END $membership$;
