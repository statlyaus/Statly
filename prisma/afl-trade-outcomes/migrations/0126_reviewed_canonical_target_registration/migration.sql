-- Canonical creation is separate from provider assignment. Only retained, current reviews
-- may supply the record; callers cannot supply a target body or self-issue an approval.
CREATE FUNCTION register_outcome_reviewed_canonical_target(
  target_decision_id TEXT, target_snapshot_id TEXT, actor TEXT, target_environment TEXT
) RETURNS TABLE(entity_kind TEXT,canonical_id TEXT,idempotent_replay BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE review RECORD; snapshot RECORD; source RECORD; authority RECORD;
  envelope JSONB; body JSONB; resolution JSONB; proposal JSONB; staging JSONB; target JSONB;
  record JSONB; existing JSONB; expected JSONB; kind TEXT; identifier TEXT;
  reference JSONB; lock_key TEXT; inserted_count INTEGER; source_candidate JSONB; issue RECORD; match_side TEXT;
BEGIN
  IF target_decision_id IS NULL OR target_decision_id !~ '^canonical-target-registration:[a-f0-9]{64}$'
    OR target_snapshot_id IS NULL OR target_snapshot_id !~ '^canonical-target-snapshot:[a-f0-9]{64}$'
    OR actor IS NULL OR btrim(actor)='' OR target_environment NOT IN ('test_fixture','non_production')
    OR target_environment IS NULL THEN RAISE EXCEPTION 'Invalid private canonical registration request'; END IF;
  SELECT * INTO review FROM outcome_review_decision WHERE decision_id=target_decision_id;
  IF review.decision_id IS NULL THEN RAISE EXCEPTION 'Canonical creation review is missing'; END IF;
  envelope:=review.evidence_json; body:=envelope->'content';
  resolution:=body#>'{resolutionDecision,content}'; proposal:=resolution#>'{proposal,content}';
  staging:=proposal->'staging'; record:=body#>'{targetSnapshot,record}';
  kind:=record->>'entityKind'; identifier:=record->>'canonicalId'; target:=proposal->'proposedTarget';
  IF kind IS NULL OR kind NOT IN ('player','club','match') OR identifier IS NULL OR btrim(identifier)='' THEN
    RAISE EXCEPTION 'Canonical creation target is malformed'; END IF;
  FOR lock_key IN SELECT DISTINCT value FROM unnest(ARRAY[
    'outcome-canonical-target:'||kind||':'||identifier,
    'outcome-review-subject:canonical_target_creation:'||target_snapshot_id,
    'outcome-review-subject:governed_evidence_reference:'||target_snapshot_id,
    'outcome-review-subject:governed_evidence_reference:'||(resolution#>>'{reviewerAuthority,authorityEvidence,id}'),
    'provider-resolution:'||(proposal->>'resolutionCaseId')]) AS keys(value) ORDER BY value LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(lock_key,0));
  END LOOP;
  SELECT * INTO review FROM outcome_review_decision WHERE decision_id=target_decision_id FOR SHARE;
  IF review.subject_type IS DISTINCT FROM 'canonical_target_creation' OR review.subject_id IS DISTINCT FROM target_snapshot_id
    OR review.decision IS DISTINCT FROM 'approved' OR review.decided_by IS DISTINCT FROM actor
    OR review.canonical_record_type IS DISTINCT FROM kind OR review.canonical_record_id IS DISTINCT FROM identifier
    OR review.decided_at>clock_timestamp() OR EXISTS(SELECT 1 FROM outcome_review_decision WHERE supersedes_decision_id=target_decision_id)
    OR envelope IS DISTINCT FROM jsonb_build_object('registrationDecisionId',target_decision_id,'content',body)
    OR target_decision_id IS DISTINCT FROM 'canonical-target-registration:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(body),'UTF8')),'hex')
    OR body->>'schemaVersion' IS DISTINCT FROM 'afl-trade-canonical-target-registration/v1'
    OR body->>'authorityBoundary' IS DISTINCT FROM 'reviewed_canonical_creation_no_provider_assignment'
    OR body IS DISTINCT FROM jsonb_build_object('schemaVersion',body->'schemaVersion','authorityBoundary',body->'authorityBoundary','targetSnapshot',body->'targetSnapshot','resolutionDecision',body->'resolutionDecision')
    OR body->'targetSnapshot' IS DISTINCT FROM jsonb_build_object('evidenceKind','canonical_target_snapshot','schemaVersion','afl-trade-canonical-target-snapshot/v1','environment',target_environment,'staging',staging,'record',record)
    OR body->'resolutionDecision' IS DISTINCT FROM jsonb_build_object('decisionId','provider-resolution-decision:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(resolution),'UTF8')),'hex'),'decisionSha256',encode(sha256(convert_to(outcome_afl_trade_canonical_json(resolution),'UTF8')),'hex'),'content',resolution)
    OR resolution->'proposal' IS DISTINCT FROM jsonb_build_object('proposalId','provider-resolution-proposal:'||encode(sha256(convert_to(outcome_afl_trade_canonical_json(proposal),'UTF8')),'hex'),'proposalSha256',encode(sha256(convert_to(outcome_afl_trade_canonical_json(proposal),'UTF8')),'hex'),'content',proposal)
    OR resolution->>'outcome' IS DISTINCT FROM 'approved'
    OR resolution#>>'{reviewerAuthority,principalRef}' IS DISTINCT FROM actor
    OR (resolution->>'decidedAt')::TIMESTAMPTZ IS DISTINCT FROM review.decided_at
    OR proposal#>>'{canonicalTargetSnapshot,id}' IS DISTINCT FROM target_snapshot_id
    OR staging->>'environment' IS DISTINCT FROM target_environment
    OR body#>>'{targetSnapshot,environment}' IS DISTINCT FROM target_environment
    OR body#>'{targetSnapshot,staging}' IS DISTINCT FROM staging
  THEN RAISE EXCEPTION 'Canonical creation review does not bind exact current target authority'; END IF;
  SELECT evidence.*,custody.content_sha256,custody.byte_length INTO snapshot
    FROM outcome_governed_evidence_reference evidence JOIN outcome_artifact_custody custody ON custody.artifact_id=evidence.artifact_id
    WHERE evidence.reference_id=target_snapshot_id AND evidence.evidence_kind='canonical_target_snapshot'
      AND evidence.status='approved' AND evidence.environment::TEXT=target_environment
      AND custody.environment=evidence.environment AND custody.artifact_class IN ('capture_metadata','derived_private')
      AND NOT EXISTS(SELECT 1 FROM outcome_review_decision WHERE supersedes_decision_id=evidence.approval_decision_id)
    FOR SHARE OF evidence,custody;
  IF snapshot.reference_id IS NULL OR snapshot.evidence_json IS DISTINCT FROM body->'targetSnapshot'
    OR snapshot.evidence_canonical_json IS DISTINCT FROM outcome_afl_trade_canonical_json(snapshot.evidence_json)
    OR snapshot.reference_sha256 IS DISTINCT FROM encode(sha256(convert_to(snapshot.evidence_canonical_json,'UTF8')),'hex')
    OR target_snapshot_id IS DISTINCT FROM 'canonical-target-snapshot:'||snapshot.reference_sha256
    OR snapshot.content_sha256 IS DISTINCT FROM snapshot.reference_sha256
    OR snapshot.byte_length IS DISTINCT FROM octet_length(convert_to(snapshot.evidence_canonical_json,'UTF8'))
  THEN RAISE EXCEPTION 'Canonical target snapshot requires exact retained custody'; END IF;
  SELECT principal.* INTO authority FROM outcome_operational_principal_authority principal
    JOIN outcome_governed_evidence_reference evidence ON evidence.reference_id=principal.authority_evidence_id
    WHERE principal.authority_evidence_id=resolution#>>'{reviewerAuthority,authorityEvidence,id}'
      AND evidence.reference_sha256=resolution#>>'{reviewerAuthority,authorityEvidence,sha256}'
      AND evidence.environment::TEXT=target_environment AND evidence.status='approved'
      AND principal.principal_ref=actor AND principal.role='afl_trade_identity_reviewer'
      AND principal.scope_key=resolution#>>'{reviewerAuthority,scopeKey}'
      AND principal.provider=staging->>'provider' AND principal.capability_id=staging->>'capabilityId'
      AND principal.competition=staging->>'competition'
      AND (staging->>'seasonYear')::INTEGER BETWEEN principal.valid_from_season AND principal.valid_through_season
      AND principal.valid_from<=clock_timestamp() AND (principal.valid_through IS NULL OR principal.valid_through>clock_timestamp())
      AND NOT EXISTS(SELECT 1 FROM outcome_review_decision WHERE supersedes_decision_id=evidence.approval_decision_id)
    FOR SHARE OF principal,evidence;
  IF authority.authority_evidence_id IS NULL THEN RAISE EXCEPTION 'Canonical creation reviewer authority is not current'; END IF;
  FOR reference IN SELECT value FROM jsonb_array_elements(
    jsonb_build_array(proposal->'method',proposal->'canonicalTargetSnapshot',resolution#>'{reviewerAuthority,authorityEvidence}')
    ||coalesce(proposal->'supportingEvidence','[]'::JSONB)
    ||CASE WHEN target ? 'evidencePolicy' THEN jsonb_build_array(target->'evidencePolicy') ELSE '[]'::JSONB END
    ||CASE WHEN target ? 'normalizationPolicy' THEN jsonb_build_array(target->'normalizationPolicy') ELSE '[]'::JSONB END) LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('outcome-review-subject:governed_evidence_reference:'||(reference->>'id'),0));
    IF NOT EXISTS(SELECT 1 FROM outcome_governed_evidence_reference evidence
      JOIN outcome_artifact_custody custody ON custody.artifact_id=evidence.artifact_id
      WHERE evidence.reference_id=reference->>'id' AND evidence.reference_sha256=reference->>'sha256'
        AND evidence.environment::TEXT=target_environment AND custody.environment=evidence.environment
        AND evidence.status='approved' AND NOT EXISTS(SELECT 1 FROM outcome_review_decision WHERE supersedes_decision_id=evidence.approval_decision_id))
    THEN RAISE EXCEPTION 'Canonical creation governed evidence is no longer current'; END IF;
  END LOOP;
  reference:=staging->'nativeIdNamespace';
  IF reference IS NOT NULL AND reference<>'null'::JSONB THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('outcome-review-subject:provider_native_id_namespace:'||(reference->>'namespaceId'),0));
  END IF;
  IF reference IS NOT NULL AND reference<>'null'::JSONB AND NOT EXISTS(
    SELECT 1 FROM outcome_provider_native_id_namespace namespace WHERE namespace.namespace_id=reference->>'namespaceId'
      AND namespace.status='approved' AND namespace.environment::TEXT=target_environment
      AND namespace.provider=staging->>'provider' AND namespace.capability_id=staging->>'capabilityId'
      AND namespace.entity_kind=reference->>'entityKind' AND namespace.definition_sha256=reference->>'definitionSha256'
      AND namespace.approval_decision_id=reference#>>'{approvalDecision,id}'
      AND namespace.approval_decision_sha256=reference#>>'{approvalDecision,sha256}'
      AND (staging->>'seasonYear')::INTEGER BETWEEN namespace.valid_from_season AND namespace.valid_through_season
      AND (namespace.identity_scope='global' OR namespace.competition=staging->>'competition')
      AND NOT EXISTS(SELECT 1 FROM outcome_review_decision WHERE supersedes_decision_id=namespace.approval_decision_id))
  THEN RAISE EXCEPTION 'Canonical creation native namespace is not current'; END IF;
  SELECT run.finalized_at,run.staging_sha256,field_map.field_map_sha256,
    row.source_row_sha256,row.row_status,row.competition,row.season_year,
    capture.environment,capture.provider,capture.capability_id,
    identity.identity_candidate_id,match.match_candidate_id,
    identity.candidate_json AS identity_json,match.candidate_json AS match_json INTO source
    FROM outcome_provider_normalization_run run JOIN outcome_source_capture capture ON capture.capture_id=run.capture_id
    JOIN outcome_provider_field_map field_map ON field_map.field_map_id=run.field_map_id
    JOIN outcome_provider_decoded_row row ON row.normalization_run_id=run.normalization_run_id
    LEFT JOIN outcome_provider_identity_candidate identity ON identity.provider_decoded_row_id=row.provider_decoded_row_id
    LEFT JOIN outcome_provider_match_candidate match ON match.provider_decoded_row_id=row.provider_decoded_row_id
    WHERE run.normalization_run_id=staging->>'normalizationRunId' AND row.provider_decoded_row_id=staging->>'providerDecodedRowId'
      AND NOT EXISTS(SELECT 1 FROM outcome_review_decision WHERE supersedes_decision_id=field_map.approval_decision_id)
    FOR SHARE OF run,row,field_map,capture;
  source_candidate:=CASE WHEN proposal->>'subjectType'='provider_match_candidate' OR proposal#>>'{occurrence,source}'='match_side'
    THEN source.match_json ELSE source.identity_json END;
  IF source.finalized_at IS NULL OR source.staging_sha256 IS DISTINCT FROM staging->>'stagingSha256'
    OR source.field_map_sha256 IS DISTINCT FROM staging->>'fieldMapSha256'
    OR source.source_row_sha256 IS DISTINCT FROM staging->>'sourceRowSha256'
    OR source.row_status::TEXT IS DISTINCT FROM staging->>'rowStatus'
    OR source.environment::TEXT IS DISTINCT FROM target_environment OR source.provider IS DISTINCT FROM staging->>'provider'
    OR source.capability_id IS DISTINCT FROM staging->>'capabilityId' OR source.competition IS DISTINCT FROM staging->>'competition'
    OR source.season_year IS DISTINCT FROM (staging->>'seasonYear')::INTEGER OR source_candidate IS NULL
    OR (CASE WHEN proposal->>'subjectType'='provider_match_candidate'
      THEN proposal->>'matchCandidateId' IS DISTINCT FROM source.match_candidate_id
      WHEN proposal#>>'{occurrence,source}'='match_side'
      THEN proposal#>>'{occurrence,matchCandidateId}' IS DISTINCT FROM source.match_candidate_id
      WHEN proposal#>>'{occurrence,source}'='player_affiliation'
      THEN proposal#>>'{occurrence,identityCandidateId}' IS DISTINCT FROM source.identity_candidate_id
      ELSE proposal->>'identityCandidateId' IS DISTINCT FROM source.identity_candidate_id END)
    OR encode(sha256(convert_to(outcome_afl_trade_canonical_json(source_candidate),'UTF8')),'hex') IS DISTINCT FROM staging->>'candidateSha256'
  THEN RAISE EXCEPTION 'Canonical target requires exact finalized source evidence'; END IF;
  IF coalesce((staging->>'openBlockingIssueCount')::INTEGER,-1)<>0 THEN RAISE EXCEPTION 'Canonical creation has open blocking issues'; END IF;
  FOR issue IN SELECT issue_id FROM outcome_provider_normalization_issue normalization_issue
    JOIN outcome_provider_decoded_row decoded ON decoded.normalization_run_id=normalization_issue.normalization_run_id
      AND decoded.source_row_number=normalization_issue.source_row_number
    WHERE decoded.provider_decoded_row_id=staging->>'providerDecodedRowId' LOOP
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(staging->'blockingIssueClosures') closure
      JOIN outcome_review_decision decision ON decision.decision_id=closure#>>'{decision,id}'
      WHERE closure->>'issueId'=issue.issue_id AND decision.subject_type='provider_normalization_issue'
        AND decision.subject_id=issue.issue_id AND decision.decision='approved'
        AND NOT EXISTS(SELECT 1 FROM outcome_review_decision WHERE supersedes_decision_id=decision.decision_id))
    THEN RAISE EXCEPTION 'Canonical creation lacks current issue closure'; END IF;
  END LOOP;
  IF kind='player' THEN
    IF target->>'playerId' IS DISTINCT FROM identifier THEN RAISE EXCEPTION 'Canonical player target mismatch'; END IF;
    expected:=jsonb_build_object('entityKind','player','canonicalId',identifier,'displayName',record->'displayName','birthDate',record->'birthDate');
    IF record IS DISTINCT FROM expected OR jsonb_typeof(record->'displayName') IS DISTINCT FROM 'string'
      OR btrim(record->>'displayName')='' OR NOT(record ? 'birthDate')
      OR (record->'birthDate'<>'null'::JSONB AND (jsonb_typeof(record->'birthDate')<>'string' OR record->>'birthDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'))
      THEN RAISE EXCEPTION 'Canonical player record invalid'; END IF;
    SELECT jsonb_build_object('entityKind','player','canonicalId',player_id,'displayName',display_name,'birthDate',to_char(birth_date,'YYYY-MM-DD'))
      INTO existing FROM outcome_player WHERE player_id=identifier AND status='approved' FOR UPDATE;
    IF existing IS NULL THEN
      INSERT INTO outcome_player(player_id,display_name,birth_date,status) VALUES(identifier,record->>'displayName',(record->>'birthDate')::DATE,'approved') ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS inserted_count=ROW_COUNT;
    END IF;
  ELSIF kind='club' THEN
    IF target->>'clubId' IS DISTINCT FROM identifier THEN RAISE EXCEPTION 'Canonical club target mismatch'; END IF;
    expected:=jsonb_build_object('entityKind','club','canonicalId',identifier,'currentName',record->'currentName','abbreviation',record->'abbreviation',
      'activeFromYear',record->'activeFromYear','activeThroughYear',record->'activeThroughYear');
    IF record IS DISTINCT FROM expected OR jsonb_typeof(record->'currentName') IS DISTINCT FROM 'string'
      OR btrim(record->>'currentName')=''
      OR (record->'abbreviation'<>'null'::JSONB AND (jsonb_typeof(record->'abbreviation')<>'string' OR btrim(record->>'abbreviation')=''))
      OR (record->'activeFromYear'<>'null'::JSONB AND (jsonb_typeof(record->'activeFromYear')<>'number' OR (record->>'activeFromYear')::INTEGER NOT BETWEEN 1897 AND 2200))
      OR (record->'activeThroughYear'<>'null'::JSONB AND (jsonb_typeof(record->'activeThroughYear')<>'number' OR (record->>'activeThroughYear')::INTEGER NOT BETWEEN 1897 AND 2200))
      OR (record->>'activeFromYear')::INTEGER>(record->>'activeThroughYear')::INTEGER
      THEN RAISE EXCEPTION 'Canonical club record invalid'; END IF;
    SELECT jsonb_build_object('entityKind','club','canonicalId',club_id,'currentName',current_name,'abbreviation',abbreviation,
      'activeFromYear',active_from_year,'activeThroughYear',active_through_year) INTO existing FROM outcome_club WHERE club_id=identifier AND status='approved' FOR UPDATE;
    IF existing IS NULL THEN
      INSERT INTO outcome_club(club_id,current_name,abbreviation,active_from_year,active_through_year,status)
        VALUES(identifier,record->>'currentName',record->>'abbreviation',(record->>'activeFromYear')::INTEGER,(record->>'activeThroughYear')::INTEGER,'approved') ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS inserted_count=ROW_COUNT;
    END IF;
  ELSE
    expected:=jsonb_build_object('entityKind','match','canonicalId',identifier,'competition',record->'competition','seasonYear',record->'seasonYear',
      'roundLabel',record->'roundLabel','matchDate',record->'matchDate','sourceDateText',record->'sourceDateText',
      'dateInterpretation',record->'dateInterpretation','homeClubId',record->'homeClubId','awayClubId',record->'awayClubId');
    IF record IS DISTINCT FROM expected OR coalesce(record->>'matchDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$'
      THEN RAISE EXCEPTION 'Canonical match record invalid'; END IF;
    IF target->>'matchId' IS DISTINCT FROM identifier OR target->>'canonicalMatchDate' IS DISTINCT FROM record->>'matchDate'
      OR target->>'canonicalRoundLabel' IS DISTINCT FROM record->>'roundLabel'
      OR target->>'homeClubId' IS DISTINCT FROM record->>'homeClubId' OR target->>'awayClubId' IS DISTINCT FROM record->>'awayClubId'
      OR record->>'competition' IS DISTINCT FROM source.competition OR (record->>'seasonYear')::INTEGER IS DISTINCT FROM source.season_year
      OR record->>'sourceDateText' IS DISTINCT FROM source_candidate->>'matchDateText'
      OR record->>'homeClubId' IS NOT DISTINCT FROM record->>'awayClubId'
    THEN RAISE EXCEPTION 'Canonical match source interpretation mismatch'; END IF;
    IF record->>'dateInterpretation'='source_calendar_date_as_utc_midnight' THEN
      IF record->>'sourceDateText' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR record->>'matchDate' IS DISTINCT FROM (record->>'sourceDateText')||'T00:00:00.000Z'
      THEN RAISE EXCEPTION 'Canonical calendar date interpretation mismatch'; END IF;
    ELSIF record->>'dateInterpretation'='source_instant' THEN
      IF coalesce(record->>'sourceDateText','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]+)?)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$'
        OR (record->>'sourceDateText')::TIMESTAMPTZ IS DISTINCT FROM (record->>'matchDate')::TIMESTAMPTZ THEN RAISE EXCEPTION 'Canonical instant interpretation mismatch'; END IF;
    ELSE RAISE EXCEPTION 'Canonical match date precision is missing'; END IF;
    IF NOT EXISTS(SELECT 1 FROM outcome_club WHERE club_id=record->>'homeClubId' AND status='approved') OR
       NOT EXISTS(SELECT 1 FROM outcome_club WHERE club_id=record->>'awayClubId' AND status='approved') THEN RAISE EXCEPTION 'Canonical match clubs are not approved'; END IF;
    PERFORM 1 FROM outcome_club WHERE club_id IN (record->>'homeClubId',record->>'awayClubId') FOR SHARE;
    FOREACH match_side IN ARRAY ARRAY['home','away'] LOOP
      PERFORM 1 FROM outcome_provider_club_resolution resolution
        JOIN outcome_provider_club_resolution_head head ON head.resolution_id=resolution.resolution_id
        JOIN outcome_provider_identity_assignment_head assignment ON assignment.assignment_case_id=resolution.assignment_case_id
          AND assignment.decision_id=resolution.decision_id AND assignment.status='active'
        WHERE resolution.decision_id=target->>(match_side||'ClubResolutionDecisionId') AND resolution.outcome='approved'
          AND resolution.match_candidate_id=proposal->>'matchCandidateId' AND resolution.side=match_side
          AND resolution.club_id=record->>(match_side||'ClubId') AND resolution.assignment_status='active'
        FOR SHARE OF head,assignment;
      IF NOT FOUND THEN RAISE EXCEPTION 'Canonical match requires current reviewed club assignments'; END IF;
    END LOOP;
    expected:=record;
    SELECT record || jsonb_build_object('competition',competition,'seasonYear',season_year,'roundLabel',round_label,
      'matchDate',to_char(match_date AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'homeClubId',home_club_id,'awayClubId',away_club_id)
      INTO existing FROM outcome_match WHERE match_id=identifier FOR UPDATE;
    IF existing IS NULL THEN
      INSERT INTO outcome_match(match_id,competition,season_year,round_label,match_date,home_club_id,away_club_id)
        VALUES(identifier,record->>'competition',(record->>'seasonYear')::INTEGER,record->>'roundLabel',(record->>'matchDate')::TIMESTAMPTZ,record->>'homeClubId',record->>'awayClubId') ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS inserted_count=ROW_COUNT;
    END IF;
  END IF;
  IF existing IS DISTINCT FROM expected AND coalesce(inserted_count,0)<>1 THEN RAISE EXCEPTION 'Canonical target conflicts with retained record'; END IF;
  RETURN QUERY SELECT kind,identifier,coalesce(inserted_count,0)=0;
END $$;
DO $path$ BEGIN EXECUTE format('ALTER FUNCTION register_outcome_reviewed_canonical_target(TEXT,TEXT,TEXT,TEXT) SET search_path TO %I,pg_catalog,pg_temp',current_schema()); END $path$;
REVOKE ALL ON FUNCTION register_outcome_reviewed_canonical_target(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_outcome_reviewed_canonical_target(TEXT,TEXT,TEXT,TEXT) TO afl_trade_private_evaluation_coordinator;
