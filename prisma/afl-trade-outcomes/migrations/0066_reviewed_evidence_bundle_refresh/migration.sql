CREATE OR REPLACE FUNCTION "outcome_private_reviewed_evidence_bundle_is_current"(
  target_evidence_bundle_id TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE
  content JSONB;
  expected_capture_ids JSONB;
  recorded_capture_ids JSONB;
  expected_rights_ids JSONB;
  recorded_rights_ids JSONB;
BEGIN
  SELECT bundle.bundle_json->'content'
    INTO content
    FROM outcome_private_reviewed_evidence_bundle bundle
   WHERE bundle.evidence_bundle_id=target_evidence_bundle_id;
  IF NOT FOUND
     OR NOT outcome_private_reviewed_evidence_is_current()
     OR content->>'schemaVersion'<>'afl-trade-private-reviewed-evidence-bundle/v1'
     OR content->>'environment'<>'non_production'
     OR content->>'evidenceKind'<>'retained_private_review'
     OR content->>'evidenceScopeKey'<>'afl-player-match-reviewed-2021-2026'
     OR content->>'authorityBoundary'<>
       'exact_current_private_review_sets_and_retained_source_artifacts_for_internal_nonproduction_calculation_only'
     OR content->'publicationEligible'<>'false'::jsonb
     OR content->'publicationProhibited'<>'true'::jsonb
     OR (content->>'candidateCount')::integer<>48781
     OR (content->>'decisionCount')::integer<>146343
     OR jsonb_array_length(content->'sourceCaptures')<>6
     OR jsonb_array_length(content->'sourceRightsEvidenceRefs')<>2
  THEN
    RETURN FALSE;
  END IF;

  SELECT jsonb_agg(to_jsonb(capture.capture_id) ORDER BY capture.capture_id)
    INTO expected_capture_ids
    FROM outcome_source_capture capture
   WHERE capture.environment='non_production' AND capture.status='staged'
     AND ((capture.provider='afl_tables'
           AND capture.capability_id='afl-tables-player-stats'
           AND capture.anchor_season_year BETWEEN 2021 AND 2025)
       OR (capture.provider='official_afl'
           AND capture.capability_id='official-afl-player-stats'
           AND capture.anchor_season_year=2026));
  SELECT jsonb_agg(to_jsonb(item->>'captureId') ORDER BY item->>'captureId')
    INTO recorded_capture_ids
    FROM jsonb_array_elements(content->'sourceCaptures') captures(item);
  IF recorded_capture_ids IS DISTINCT FROM expected_capture_ids THEN
    RETURN FALSE;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(content->'sourceCaptures') captures(item)
      LEFT JOIN outcome_source_capture capture ON capture.capture_id=item->>'captureId'
      LEFT JOIN outcome_artifact_custody custody
        ON custody.artifact_id=capture.source_artifact_id
     WHERE capture.capture_id IS NULL OR custody.artifact_id IS NULL
        OR capture.environment<>'non_production' OR capture.status<>'staged'
        OR custody.environment<>'non_production' OR custody.verified_at IS NULL
        OR item->>'provider' IS DISTINCT FROM capture.provider
        OR item->>'capabilityId' IS DISTINCT FROM capture.capability_id
        OR (item->>'seasonYear')::integer<>capture.anchor_season_year
        OR item->'sourceArtifact'->>'artifactId' IS DISTINCT FROM custody.artifact_id
        OR item->'sourceArtifact'->>'contentSha256' IS DISTINCT FROM custody.content_sha256
        OR item->'sourceArtifact'->>'storageUri' IS DISTINCT FROM custody.storage_uri
        OR item->'sourceArtifact'->>'mediaType' IS DISTINCT FROM custody.media_type
        OR (item->'sourceArtifact'->>'byteLength')::bigint<>custody.byte_length
        OR (item->'sourceArtifact'->>'createdAt')::timestamptz<>custody.created_at
  ) THEN
    RETURN FALSE;
  END IF;

  SELECT jsonb_agg(to_jsonb(value) ORDER BY value)
    INTO expected_rights_ids
    FROM (
      SELECT DISTINCT capture.manifest_json->'sourceRightsProposal'->>'rightsArtifactId' AS value
        FROM outcome_source_capture capture
       WHERE capture.capture_id IN (
         SELECT jsonb_array_elements_text(expected_capture_ids)
       )
    ) rights;
  SELECT jsonb_agg(to_jsonb(rights.rights_artifact_id) ORDER BY rights.rights_artifact_id)
    INTO recorded_rights_ids
    FROM jsonb_array_elements(content->'sourceRightsEvidenceRefs') evidence(item)
    JOIN outcome_source_rights_proposal rights
      ON item->>'artifactId'='artifact:'||encode(sha256(convert_to(
           outcome_afl_trade_canonical_json(rights.content_json),'UTF8')),'hex')
     AND item->>'contentSha256'=encode(sha256(convert_to(
           outcome_afl_trade_canonical_json(rights.content_json),'UTF8')),'hex')
     AND item->>'storageUri'='artifact://sha256/'||encode(sha256(convert_to(
           outcome_afl_trade_canonical_json(rights.content_json),'UTF8')),'hex')
     AND item->>'mediaType'='application/json'
     AND (item->>'byteLength')::integer=octet_length(convert_to(
           outcome_afl_trade_canonical_json(rights.content_json),'UTF8'))
     AND (item->>'createdAt')::timestamptz=rights.proposed_at;
  IF recorded_rights_ids IS DISTINCT FROM expected_rights_ids THEN
    RETURN FALSE;
  END IF;

  IF (SELECT jsonb_agg(to_jsonb(item->>'reviewSetId') ORDER BY item->>'reviewSetId')
        FROM jsonb_array_elements(content->'reviewSets') sets(item))
       IS DISTINCT FROM jsonb_build_array(
         '4e58a390b7088d50b119bdd2c945a1f66ba2025fd8bbbf8710fc8a270dad2dca',
         'aef663452e66a433048605a71fb4178ed1a5e1d9610c6d3ed75bfb796308b5cb'
       )
     OR EXISTS (
       SELECT 1
         FROM jsonb_array_elements(content->'reviewSets') sets(item)
         LEFT JOIN outcome_review_decision marker
           ON marker.subject_id=item->>'reviewSetId'
          AND marker.decision_id=item->>'reviewSetDecisionId'
         CROSS JOIN LATERAL (
           SELECT jsonb_build_object(
             'decisionId',marker.decision_id,'subjectType',marker.subject_type,
             'subjectId',marker.subject_id,'decision',marker.decision,
             'canonicalRecordType',marker.canonical_record_type,
             'canonicalRecordId',marker.canonical_record_id,
             'supersedesDecisionId',marker.supersedes_decision_id,
             'rationale',marker.rationale,'evidence',marker.evidence_json,
             'decidedBy',marker.decided_by,
             'decidedAt',to_char(marker.decided_at AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           ) AS snapshot
         ) snapshot
         CROSS JOIN LATERAL (
           SELECT outcome_afl_trade_canonical_json(snapshot.snapshot) AS canonical
         ) canonical
         CROSS JOIN LATERAL (
           SELECT encode(sha256(convert_to(canonical.canonical,'UTF8')),'hex') AS value
         ) artifact_sha
        WHERE marker.decision_id IS NULL
           OR marker.subject_type<>'local_review_set'
           OR marker.decision<>'approved'
           OR marker.canonical_record_type<>'local_review_set'
           OR marker.canonical_record_id<>marker.subject_id
           OR marker.evidence_json->>'evidenceSetSha256'<>marker.subject_id
           OR marker.decided_by<>item->>'reviewerId'
           OR (item->>'candidateCount')::integer<>
             CASE marker.subject_id
               WHEN 'aef663452e66a433048605a71fb4178ed1a5e1d9610c6d3ed75bfb796308b5cb'
                 THEN 48769 ELSE 12 END
           OR (item->>'decisionCount')::integer<>
             CASE marker.subject_id
               WHEN 'aef663452e66a433048605a71fb4178ed1a5e1d9610c6d3ed75bfb796308b5cb'
                 THEN 146307 ELSE 36 END
           OR item->'reviewSetArtifact'->>'artifactId'<>'artifact:'||artifact_sha.value
           OR item->'reviewSetArtifact'->>'contentSha256'<>artifact_sha.value
           OR item->'reviewSetArtifact'->>'storageUri'<>
             'artifact://sha256/'||artifact_sha.value
           OR item->'reviewSetArtifact'->>'mediaType'<>'application/json'
           OR (item->'reviewSetArtifact'->>'byteLength')::integer<>
             octet_length(convert_to(canonical.canonical,'UTF8'))
           OR (item->'reviewSetArtifact'->>'createdAt')::timestamptz<>marker.decided_at
           OR EXISTS (
             SELECT 1 FROM outcome_review_decision successor
              WHERE successor.supersedes_decision_id=marker.decision_id
           )
     )
  THEN
    RETURN FALSE;
  END IF;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION "validate_outcome_private_reviewed_evaluation_decision_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  content JSONB;
  bundle RECORD;
  bundle_canonical TEXT;
  bundle_sha TEXT;
  predecessor RECORD;
BEGIN
  content:=NEW.decision_json->'content';
  SELECT * INTO bundle FROM outcome_private_reviewed_evidence_bundle
   WHERE evidence_bundle_id=NEW.evidence_bundle_id FOR KEY SHARE;
  bundle_canonical:=outcome_afl_trade_canonical_json(bundle.bundle_json);
  bundle_sha:=encode(sha256(convert_to(bundle_canonical,'UTF8')),'hex');
  IF NOT FOUND
     OR NOT outcome_private_reviewed_evidence_bundle_is_current(NEW.evidence_bundle_id)
     OR NEW.decision_json->>'decisionId' IS DISTINCT FROM NEW.decision_id
     OR content->>'schemaVersion'<>
       'afl-trade-private-reviewed-evidence-evaluation-decision/v1'
     OR content->>'authorityBoundary'<>
       'exact_current_private_review_sets_and_retained_source_artifacts_for_internal_nonproduction_calculation_only'
     OR content->>'environment'<>'non_production'
     OR content->>'operation'<>'private_nonproduction_derived_calculation'
     OR content->>'evidenceKind'<>'retained_private_review'
     OR content->>'status' IS DISTINCT FROM NEW.status
     OR content->>'valuationScopeKey' IS DISTINCT FROM NEW.valuation_scope_key
     OR content->>'evidenceBundleId' IS DISTINCT FROM NEW.evidence_bundle_id
     OR content->>'sourceRightsEffect'<>
       'supplemental_evaluation_authority_does_not_amend_source_rights'
     OR content->'permissions' IS DISTINCT FROM jsonb_build_object(
       'derivedCalculations',true,'internalEvaluation',true,'modelTraining',false,
       'publicDisplay',false,'redistribution',false,'productionActivation',false,
       'liveCapture',false
     )
     OR content->'publicationEligible'<>'false'::jsonb
     OR content->'publicationProhibited'<>'true'::jsonb
     OR content->>'limitation'<>
       'This decision authorizes only private local non-production derived calculations from the exact retained reviewed evidence bundle for internal evaluation. It grants no model-training, public-display, redistribution, production-activation, live-capture, factual-release, or publication authority.'
     OR (content->>'revision')::integer<>NEW.revision
     OR content->>'supersedesDecisionId' IS DISTINCT FROM NEW.supersedes_decision_id
     OR content->>'reviewerId' IS DISTINCT FROM NEW.reviewer_id
     OR length(btrim(content->>'rationale')) NOT BETWEEN 1 AND 2000
     OR (content->>'decidedAt')::timestamptz<>NEW.decided_at
     OR NEW.decided_at<>NEW.registered_at
     OR NEW.decision_content_canonical_json::jsonb IS DISTINCT FROM content
     OR encode(sha256(convert_to(NEW.decision_content_canonical_json,'UTF8')),'hex')<>
       NEW.decision_sha256
     OR content->'evidenceBundleArtifact'->>'artifactId' IS DISTINCT FROM 'artifact:'||bundle_sha
     OR content->'evidenceBundleArtifact'->>'contentSha256' IS DISTINCT FROM bundle_sha
     OR content->'evidenceBundleArtifact'->>'storageUri' IS DISTINCT FROM
       'artifact://sha256/'||bundle_sha
     OR content->'evidenceBundleArtifact'->>'mediaType'<>'application/json'
     OR (content->'evidenceBundleArtifact'->>'byteLength')::integer<>
       octet_length(convert_to(bundle_canonical,'UTF8'))
     OR (content->'evidenceBundleArtifact'->>'createdAt')::timestamptz<>bundle.created_at
  THEN
    RAISE EXCEPTION 'Private reviewed-evidence evaluation decision failed exact authentication';
  END IF;
  IF NEW.supersedes_decision_id IS NOT NULL THEN
    SELECT * INTO predecessor FROM outcome_private_reviewed_evaluation_decision
     WHERE decision_id=NEW.supersedes_decision_id FOR KEY SHARE;
    IF NOT FOUND OR predecessor.valuation_scope_key<>NEW.valuation_scope_key
       OR predecessor.revision<>NEW.revision-1 OR predecessor.decided_at>NEW.decided_at
       OR (
         predecessor.evidence_bundle_id<>NEW.evidence_bundle_id
         AND outcome_private_reviewed_evidence_bundle_is_current(predecessor.evidence_bundle_id)
       )
    THEN
      RAISE EXCEPTION 'Private reviewed-evidence decision has invalid chronology';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
