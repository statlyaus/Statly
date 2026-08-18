-- Keep the exhaustive raw-candidate proof at the governance transition, then make interactive
-- reads authenticate the immutable bundle and the compact events that could invalidate it.
DO $$
DECLARE
  has_target_private_evidence BOOLEAN;
BEGIN
  SELECT EXISTS (
           SELECT 1
             FROM "outcome_source_capture" capture
            WHERE capture."environment"='non_production'
              AND ((capture."provider"='afl_tables'
                    AND capture."capability_id"='afl-tables-player-stats'
                    AND capture."anchor_season_year" BETWEEN 2021 AND 2025)
                OR (capture."provider"='official_afl'
                    AND capture."capability_id"='official-afl-player-stats'
                    AND capture."anchor_season_year"=2026))
         ) OR EXISTS (
           SELECT 1
             FROM "outcome_review_decision" decision
            WHERE decision."decided_by" IN (
                    'local-five-season-evidence-reviewer',
                    'local-workbook-evidence-reviewer'
                  )
              AND decision."evidence_json"->>'evidenceSetSha256' IN (
                    'aef663452e66a433048605a71fb4178ed1a5e1d9610c6d3ed75bfb796308b5cb',
                    '4e58a390b7088d50b119bdd2c945a1f66ba2025fd8bbbf8710fc8a270dad2dca'
                  )
         ) OR EXISTS (
           SELECT 1 FROM "outcome_private_reviewed_evidence_bundle"
         )
    INTO has_target_private_evidence;

  IF has_target_private_evidence
     AND NOT "outcome_private_reviewed_evidence_is_current"()
  THEN
    RAISE EXCEPTION 'Private reviewed evidence is not current before optimization';
  END IF;
END $$;

CREATE INDEX "outcome_review_decision_private_set_current_idx"
  ON "outcome_review_decision"(
    ("evidence_json"->>'evidenceSetSha256'),"decided_by","decision","subject_type"
  )
  WHERE "evidence_json"->>'evidenceSetSha256' IN (
    'aef663452e66a433048605a71fb4178ed1a5e1d9610c6d3ed75bfb796308b5cb',
    '4e58a390b7088d50b119bdd2c945a1f66ba2025fd8bbbf8710fc8a270dad2dca'
  );

CREATE FUNCTION "reject_outcome_private_review_set_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (
    OLD."decided_by" IN (
      'local-five-season-evidence-reviewer',
      'local-workbook-evidence-reviewer'
    )
    AND OLD."evidence_json"->>'evidenceSetSha256' IN (
      'aef663452e66a433048605a71fb4178ed1a5e1d9610c6d3ed75bfb796308b5cb',
      '4e58a390b7088d50b119bdd2c945a1f66ba2025fd8bbbf8710fc8a270dad2dca'
    )
  ) THEN
    RAISE EXCEPTION 'Admitted private review-set decisions are append-only';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER "outcome_review_decision_private_set_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_review_decision"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_review_set_mutation"();

CREATE FUNCTION "outcome_private_reviewed_evidence_bundle_is_current"(
  target_evidence_bundle_id TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE
  bundle_content JSONB;
  bundle_candidate_count INTEGER;
  bundle_decision_count INTEGER;
  bundle_source_capture_count INTEGER;
  bundle_source_rights_count INTEGER;
  historical_decision_count INTEGER;
  official_decision_count INTEGER;
  expected_capture_ids JSONB;
  recorded_capture_ids JSONB;
  expected_rights_ids JSONB;
  recorded_rights_ids JSONB;
  expected_review_set_ids JSONB;
  recorded_review_set_ids JSONB;
BEGIN
  SELECT bundle."bundle_json"->'content',bundle."candidate_count",bundle."decision_count",
         bundle."source_capture_count",bundle."source_rights_count"
    INTO bundle_content,bundle_candidate_count,bundle_decision_count,
         bundle_source_capture_count,bundle_source_rights_count
    FROM "outcome_private_reviewed_evidence_bundle" bundle
   WHERE bundle."evidence_bundle_id"=target_evidence_bundle_id;

  IF NOT FOUND
     OR bundle_content->>'schemaVersion'<>'afl-trade-private-reviewed-evidence-bundle/v1'
     OR bundle_content->>'environment'<>'non_production'
     OR bundle_content->>'evidenceKind'<>'retained_private_review'
     OR bundle_content->>'evidenceScopeKey'<>'afl-player-match-reviewed-2021-2026'
     OR bundle_content->>'authorityBoundary'<>
       'exact_current_private_review_sets_and_retained_source_artifacts_for_internal_nonproduction_calculation_only'
     OR bundle_content->'publicationEligible'<>'false'::jsonb
     OR bundle_content->'publicationProhibited'<>'true'::jsonb
     OR bundle_candidate_count<>48781
     OR bundle_decision_count<>146343
     OR bundle_source_capture_count<>6
     OR bundle_source_rights_count<>2
     OR (bundle_content->>'candidateCount')::integer<>bundle_candidate_count
     OR (bundle_content->>'decisionCount')::integer<>bundle_decision_count
     OR jsonb_array_length(bundle_content->'sourceCaptures')<>bundle_source_capture_count
     OR jsonb_array_length(bundle_content->'sourceRightsEvidenceRefs')<>
       bundle_source_rights_count
  THEN
    RETURN FALSE;
  END IF;

  SELECT count(*) FILTER (
           WHERE decision."evidence_json"->>'evidenceSetSha256'=
             'aef663452e66a433048605a71fb4178ed1a5e1d9610c6d3ed75bfb796308b5cb'
             AND decision."decided_by"='local-five-season-evidence-reviewer'
             AND decision."decision"='approved'
             AND decision."subject_type"<>'local_review_set'
         )::integer,
         count(*) FILTER (
           WHERE decision."evidence_json"->>'evidenceSetSha256'=
             '4e58a390b7088d50b119bdd2c945a1f66ba2025fd8bbbf8710fc8a270dad2dca'
             AND decision."decided_by"='local-workbook-evidence-reviewer'
             AND decision."decision"='approved'
             AND decision."subject_type"<>'local_review_set'
         )::integer
    INTO historical_decision_count,official_decision_count
    FROM "outcome_review_decision" decision
   WHERE decision."evidence_json"->>'evidenceSetSha256' IN (
     'aef663452e66a433048605a71fb4178ed1a5e1d9610c6d3ed75bfb796308b5cb',
     '4e58a390b7088d50b119bdd2c945a1f66ba2025fd8bbbf8710fc8a270dad2dca'
   );

  IF historical_decision_count<>146307 OR official_decision_count<>36 THEN
    RETURN FALSE;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM "outcome_review_decision" successor
      JOIN "outcome_review_decision" predecessor
        ON successor."supersedes_decision_id"=predecessor."decision_id"
     WHERE predecessor."evidence_json"->>'evidenceSetSha256' IN (
       'aef663452e66a433048605a71fb4178ed1a5e1d9610c6d3ed75bfb796308b5cb',
       '4e58a390b7088d50b119bdd2c945a1f66ba2025fd8bbbf8710fc8a270dad2dca'
     )
  ) THEN
    RETURN FALSE;
  END IF;

  SELECT jsonb_agg(to_jsonb(capture."capture_id") ORDER BY capture."capture_id")
    INTO expected_capture_ids
    FROM "outcome_source_capture" capture
   WHERE capture."environment"='non_production' AND capture."status"='staged'
     AND ((capture."provider"='afl_tables'
           AND capture."capability_id"='afl-tables-player-stats'
           AND capture."anchor_season_year" BETWEEN 2021 AND 2025)
       OR (capture."provider"='official_afl'
           AND capture."capability_id"='official-afl-player-stats'
           AND capture."anchor_season_year"=2026));
  SELECT jsonb_agg(to_jsonb(item->>'captureId') ORDER BY item->>'captureId')
    INTO recorded_capture_ids
    FROM jsonb_array_elements(bundle_content->'sourceCaptures') captures(item);
  IF recorded_capture_ids IS DISTINCT FROM expected_capture_ids THEN
    RETURN FALSE;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(bundle_content->'sourceCaptures') captures(item)
      LEFT JOIN "outcome_source_capture" capture
        ON capture."capture_id"=item->>'captureId'
      LEFT JOIN "outcome_artifact_custody" custody
        ON custody."artifact_id"=capture."source_artifact_id"
     WHERE capture."capture_id" IS NULL OR custody."artifact_id" IS NULL
        OR capture."environment"<>'non_production' OR capture."status"<>'staged'
        OR custody."environment"<>'non_production' OR custody."verified_at" IS NULL
        OR item->>'provider' IS DISTINCT FROM capture."provider"
        OR item->>'capabilityId' IS DISTINCT FROM capture."capability_id"
        OR (item->>'seasonYear')::integer<>capture."anchor_season_year"
        OR item->'sourceArtifact'->>'artifactId' IS DISTINCT FROM custody."artifact_id"
        OR item->'sourceArtifact'->>'contentSha256' IS DISTINCT FROM custody."content_sha256"
        OR item->'sourceArtifact'->>'storageUri' IS DISTINCT FROM custody."storage_uri"
        OR item->'sourceArtifact'->>'mediaType' IS DISTINCT FROM custody."media_type"
        OR (item->'sourceArtifact'->>'byteLength')::bigint<>custody."byte_length"
        OR (item->'sourceArtifact'->>'createdAt')::timestamptz<>custody."created_at"
  ) THEN
    RETURN FALSE;
  END IF;

  SELECT jsonb_agg(to_jsonb(value) ORDER BY value)
    INTO expected_rights_ids
    FROM (
      SELECT DISTINCT capture."manifest_json"->'sourceRightsProposal'->>'rightsArtifactId'
        AS value
        FROM "outcome_source_capture" capture
       WHERE capture."capture_id" IN (
         SELECT jsonb_array_elements_text(expected_capture_ids)
       )
    ) rights;
  SELECT jsonb_agg(to_jsonb(rights."rights_artifact_id") ORDER BY rights."rights_artifact_id")
    INTO recorded_rights_ids
    FROM jsonb_array_elements(bundle_content->'sourceRightsEvidenceRefs') evidence(item)
    JOIN "outcome_source_rights_proposal" rights
      ON item->>'artifactId'='artifact:'||encode(sha256(convert_to(
           "outcome_afl_trade_canonical_json"(rights."content_json"),'UTF8')),'hex')
     AND item->>'contentSha256'=encode(sha256(convert_to(
           "outcome_afl_trade_canonical_json"(rights."content_json"),'UTF8')),'hex')
     AND item->>'storageUri'='artifact://sha256/'||encode(sha256(convert_to(
           "outcome_afl_trade_canonical_json"(rights."content_json"),'UTF8')),'hex')
     AND item->>'mediaType'='application/json'
     AND (item->>'byteLength')::integer=octet_length(convert_to(
           "outcome_afl_trade_canonical_json"(rights."content_json"),'UTF8'))
     AND (item->>'createdAt')::timestamptz=rights."proposed_at";
  IF recorded_rights_ids IS DISTINCT FROM expected_rights_ids THEN
    RETURN FALSE;
  END IF;

  SELECT jsonb_agg(to_jsonb(value) ORDER BY value)
    INTO expected_review_set_ids
    FROM (VALUES
      ('4e58a390b7088d50b119bdd2c945a1f66ba2025fd8bbbf8710fc8a270dad2dca'),
      ('aef663452e66a433048605a71fb4178ed1a5e1d9610c6d3ed75bfb796308b5cb')
    ) expected(value);
  SELECT jsonb_agg(to_jsonb(item->>'reviewSetId') ORDER BY item->>'reviewSetId')
    INTO recorded_review_set_ids
    FROM jsonb_array_elements(bundle_content->'reviewSets') sets(item);
  IF recorded_review_set_ids IS DISTINCT FROM expected_review_set_ids THEN
    RETURN FALSE;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(bundle_content->'reviewSets') sets(item)
      LEFT JOIN "outcome_review_decision" marker
        ON marker."subject_id"=item->>'reviewSetId'
       AND marker."decision_id"=item->>'reviewSetDecisionId'
      CROSS JOIN LATERAL (
        SELECT jsonb_build_object(
          'decisionId',marker."decision_id",
          'subjectType',marker."subject_type",
          'subjectId',marker."subject_id",
          'decision',marker."decision",
          'canonicalRecordType',marker."canonical_record_type",
          'canonicalRecordId',marker."canonical_record_id",
          'supersedesDecisionId',marker."supersedes_decision_id",
          'rationale',marker."rationale",
          'evidence',marker."evidence_json",
          'decidedBy',marker."decided_by",
          'decidedAt',to_char(marker."decided_at" AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        ) AS snapshot
      ) snapshot
      CROSS JOIN LATERAL (
        SELECT "outcome_afl_trade_canonical_json"(snapshot.snapshot) AS canonical
      ) canonical
      CROSS JOIN LATERAL (
        SELECT encode(sha256(convert_to(canonical.canonical,'UTF8')),'hex') AS value
      ) artifact_sha
     WHERE marker."decision_id" IS NULL
        OR marker."subject_type"<>'local_review_set'
        OR marker."decision"<>'approved'
        OR marker."canonical_record_type"<>'local_review_set'
        OR marker."canonical_record_id"<>marker."subject_id"
        OR marker."evidence_json"->>'evidenceSetSha256'<>marker."subject_id"
        OR marker."decided_by"<>item->>'reviewerId'
        OR (item->>'candidateCount')::integer<>
          CASE marker."subject_id"
            WHEN 'aef663452e66a433048605a71fb4178ed1a5e1d9610c6d3ed75bfb796308b5cb'
              THEN 48769 ELSE 12 END
        OR (item->>'decisionCount')::integer<>
          CASE marker."subject_id"
            WHEN 'aef663452e66a433048605a71fb4178ed1a5e1d9610c6d3ed75bfb796308b5cb'
              THEN 146307 ELSE 36 END
        OR item->'reviewSetArtifact'->>'artifactId'<>'artifact:'||artifact_sha.value
        OR item->'reviewSetArtifact'->>'contentSha256'<>artifact_sha.value
        OR item->'reviewSetArtifact'->>'storageUri'<>
          'artifact://sha256/'||artifact_sha.value
        OR item->'reviewSetArtifact'->>'mediaType'<>'application/json'
        OR (item->'reviewSetArtifact'->>'byteLength')::integer<>
          octet_length(convert_to(canonical.canonical,'UTF8'))
        OR (item->'reviewSetArtifact'->>'createdAt')::timestamptz<>marker."decided_at"
  ) THEN
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END $$;

COMMENT ON FUNCTION "outcome_private_reviewed_evidence_bundle_is_current"(TEXT) IS
  'Authenticates one immutable private reviewed-evidence bundle against exact compact currentness signals; exhaustive raw-candidate validation remains a write-time transition.';
