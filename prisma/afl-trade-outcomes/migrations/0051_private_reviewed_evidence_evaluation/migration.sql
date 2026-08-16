CREATE TABLE "outcome_private_reviewed_evidence_bundle" (
  "evidence_bundle_id" TEXT PRIMARY KEY,
  "evidence_scope_key" TEXT NOT NULL,
  "candidate_count" INTEGER NOT NULL CHECK ("candidate_count" > 0),
  "decision_count" INTEGER NOT NULL CHECK ("decision_count" > 0),
  "source_capture_count" INTEGER NOT NULL CHECK ("source_capture_count" > 0),
  "source_rights_count" INTEGER NOT NULL CHECK ("source_rights_count" > 0),
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "bundle_sha256" CHAR(64) NOT NULL CHECK ("bundle_sha256" ~ '^[a-f0-9]{64}$'),
  "bundle_content_canonical_json" TEXT NOT NULL,
  "bundle_json" JSONB NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT "outcome_private_reviewed_evidence_bundle_id_check"
    CHECK ("evidence_bundle_id"='private-reviewed-evidence-bundle:'||"bundle_sha256")
);

CREATE INDEX "outcome_private_reviewed_evidence_bundle_scope_idx"
  ON "outcome_private_reviewed_evidence_bundle"("evidence_scope_key","created_at");

CREATE FUNCTION "outcome_private_reviewed_evidence_is_current"()
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE
  historical_candidates INTEGER;
  historical_identity INTEGER;
  historical_match INTEGER;
  historical_facts INTEGER;
  official_expected INTEGER;
  official_approved INTEGER;
  official_identity INTEGER;
  official_match INTEGER;
  official_facts INTEGER;
  capture_count INTEGER;
BEGIN
  WITH candidates AS MATERIALIZED (
    SELECT decoded.provider_decoded_row_id,identity.identity_candidate_id,
           match.match_candidate_id,metric.availability::text AS availability,
           metric.numeric_value,metric.definition_version
      FROM outcome_provider_decoded_row decoded
      JOIN outcome_source_capture capture ON capture.capture_id=decoded.capture_id
      JOIN outcome_provider_normalization_run run
        ON run.normalization_run_id=decoded.normalization_run_id
       AND run.capture_id=decoded.capture_id
      JOIN outcome_provider_identity_candidate identity USING (provider_decoded_row_id)
      JOIN outcome_provider_match_candidate match USING (provider_decoded_row_id)
      JOIN outcome_provider_metric_candidate metric USING (provider_decoded_row_id)
     WHERE capture.provider='afl_tables'
       AND capture.capability_id='afl-tables-player-stats'
       AND capture.environment='non_production'
       AND capture.status='staged'
       AND decoded.season_year BETWEEN 2021 AND 2025
       AND run.finalized_at IS NOT NULL
       AND identity.native_entity_id IS NOT NULL
       AND metric.metric_code='goals'
  )
  SELECT count(*)::integer,
         count(identity_review.decision_id)::integer,
         count(match_review.decision_id)::integer,
         count(factual_review.decision_id)::integer
    INTO historical_candidates,historical_identity,historical_match,historical_facts
    FROM candidates candidate
    LEFT JOIN outcome_review_decision identity_review
      ON identity_review.decision_id=
           'local-afl-tables-review:identity:'||candidate.identity_candidate_id
     AND identity_review.subject_type='provider_identity_candidate'
     AND identity_review.subject_id=candidate.identity_candidate_id
     AND identity_review.decision='approved'
     AND identity_review.decided_by='local-five-season-evidence-reviewer'
     AND identity_review.evidence_json->>'evidenceSetSha256'=
       'aef663452e66a433048605a71fb4178ed1a5e1d9610c6d3ed75bfb796308b5cb'
     AND NOT EXISTS (
       SELECT 1 FROM outcome_review_decision successor
        WHERE successor.supersedes_decision_id=identity_review.decision_id
     )
    LEFT JOIN outcome_review_decision match_review
      ON match_review.decision_id='local-afl-tables-review:match:'||candidate.match_candidate_id
     AND match_review.subject_type='provider_match_candidate'
     AND match_review.subject_id=candidate.match_candidate_id
     AND match_review.decision='approved'
     AND match_review.decided_by='local-five-season-evidence-reviewer'
     AND match_review.evidence_json->>'evidenceSetSha256'=
       'aef663452e66a433048605a71fb4178ed1a5e1d9610c6d3ed75bfb796308b5cb'
     AND NOT EXISTS (
       SELECT 1 FROM outcome_review_decision successor
        WHERE successor.supersedes_decision_id=match_review.decision_id
     )
    LEFT JOIN outcome_review_decision factual_review
      ON factual_review.decision_id=
           'local-afl-tables-review:fact:'||candidate.provider_decoded_row_id
     AND factual_review.subject_type='local_reconciled_player_match_fact'
     AND factual_review.subject_id=candidate.provider_decoded_row_id
     AND factual_review.decision='approved'
     AND factual_review.decided_by='local-five-season-evidence-reviewer'
     AND factual_review.evidence_json->>'evidenceSetSha256'=
       'aef663452e66a433048605a71fb4178ed1a5e1d9610c6d3ed75bfb796308b5cb'
     AND factual_review.evidence_json->>'identityCandidateId'=candidate.identity_candidate_id
     AND factual_review.evidence_json->>'matchCandidateId'=candidate.match_candidate_id
     AND factual_review.evidence_json->>'metricCode'='goals'
     AND factual_review.evidence_json->>'definitionVersion'=candidate.definition_version
     AND factual_review.evidence_json->>'metricAvailability'=candidate.availability
     AND (factual_review.evidence_json->>'numericValue')::numeric
           IS NOT DISTINCT FROM candidate.numeric_value
     AND NOT EXISTS (
       SELECT 1 FROM outcome_review_decision successor
        WHERE successor.supersedes_decision_id=factual_review.decision_id
     );

  WITH marker AS MATERIALIZED (
    SELECT evidence_json FROM outcome_review_decision marker
     WHERE marker.decision_id=
       'local-official-afl-review:set:4e58a390b7088d50b119bdd2c945a1f66ba2025fd8bbbf8710fc8a270dad2dca'
       AND marker.subject_type='local_review_set'
       AND marker.subject_id='4e58a390b7088d50b119bdd2c945a1f66ba2025fd8bbbf8710fc8a270dad2dca'
       AND marker.decision='approved'
       AND marker.decided_by='local-workbook-evidence-reviewer'
       AND NOT EXISTS (
         SELECT 1 FROM outcome_review_decision successor
          WHERE successor.supersedes_decision_id=marker.decision_id
       )
  ), expected AS MATERIALIZED (
    SELECT value AS decision_id
      FROM marker,jsonb_array_elements_text(marker.evidence_json->'decisionIds') ids(value)
  ), approved AS MATERIALIZED (
    SELECT decision.*
      FROM expected
      JOIN outcome_review_decision decision USING (decision_id)
     WHERE decision.decision='approved'
       AND decision.decided_by='local-workbook-evidence-reviewer'
       AND decision.evidence_json->>'evidenceSetSha256'=
         '4e58a390b7088d50b119bdd2c945a1f66ba2025fd8bbbf8710fc8a270dad2dca'
       AND decision.subject_type=ANY(ARRAY[
         'provider_identity_candidate','provider_match_candidate',
         'local_reconciled_player_match_fact'
       ]::text[])
       AND NOT EXISTS (
         SELECT 1 FROM outcome_review_decision successor
          WHERE successor.supersedes_decision_id=decision.decision_id
       )
  ), exact_facts AS MATERIALIZED (
    SELECT approved.decision_id
      FROM approved
      JOIN outcome_provider_decoded_row decoded
        ON decoded.provider_decoded_row_id=approved.subject_id
      JOIN outcome_source_capture capture ON capture.capture_id=decoded.capture_id
      JOIN outcome_provider_identity_candidate identity USING (provider_decoded_row_id)
      JOIN outcome_provider_match_candidate match USING (provider_decoded_row_id)
      JOIN outcome_provider_metric_candidate metric USING (provider_decoded_row_id)
     WHERE approved.subject_type='local_reconciled_player_match_fact'
       AND capture.provider='official_afl'
       AND capture.capability_id='official-afl-player-stats'
       AND capture.environment='non_production'
       AND capture.status='staged'
       AND decoded.season_year=2026
       AND match.provider_status='CONCLUDED'
       AND metric.metric_code='goals'
       AND approved.evidence_json->>'identityCandidateId'=identity.identity_candidate_id
       AND approved.evidence_json->>'matchCandidateId'=match.match_candidate_id
       AND approved.evidence_json->>'definitionVersion'=metric.definition_version
       AND approved.evidence_json->>'metricAvailability'=metric.availability::text
       AND (approved.evidence_json->>'numericValue')::numeric
             IS NOT DISTINCT FROM metric.numeric_value
  )
  SELECT (SELECT count(*) FROM expected)::integer,
         (SELECT count(*) FROM approved)::integer,
         count(*) FILTER (WHERE subject_type='provider_identity_candidate')::integer,
         count(*) FILTER (WHERE subject_type='provider_match_candidate')::integer,
         (SELECT count(*) FROM exact_facts)::integer
    INTO official_expected,official_approved,official_identity,official_match,official_facts
    FROM approved;

  SELECT count(*)::integer INTO capture_count
    FROM outcome_source_capture capture
    JOIN outcome_artifact_custody custody
      ON custody.artifact_id=capture.source_artifact_id
     AND custody.environment='non_production'
     AND custody.verified_at IS NOT NULL
    JOIN outcome_source_rights_proposal rights
      ON rights.rights_artifact_id=
           capture.manifest_json->'sourceRightsProposal'->>'rightsArtifactId'
   WHERE capture.environment='non_production' AND capture.status='staged'
     AND ((capture.provider='afl_tables'
           AND capture.capability_id='afl-tables-player-stats'
           AND capture.anchor_season_year BETWEEN 2021 AND 2025)
       OR (capture.provider='official_afl'
           AND capture.capability_id='official-afl-player-stats'
           AND capture.anchor_season_year=2026));

  RETURN historical_candidates=48769
     AND historical_identity=48769
     AND historical_match=48769
     AND historical_facts=48769
     AND official_expected=36
     AND official_approved=36
     AND official_identity=12
     AND official_match=12
     AND official_facts=12
     AND capture_count=6;
END $$;

CREATE FUNCTION "validate_outcome_private_reviewed_evidence_bundle_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  content JSONB;
  expected_review_set_ids JSONB;
  expected_capture_ids JSONB;
  expected_rights_ids JSONB;
BEGIN
  content:=NEW."bundle_json"->'content';
  SELECT jsonb_agg(to_jsonb(value) ORDER BY value) INTO expected_review_set_ids
    FROM (VALUES
      ('4e58a390b7088d50b119bdd2c945a1f66ba2025fd8bbbf8710fc8a270dad2dca'),
      ('aef663452e66a433048605a71fb4178ed1a5e1d9610c6d3ed75bfb796308b5cb')
    ) expected(value);
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
  SELECT jsonb_agg(to_jsonb(value) ORDER BY value) INTO expected_rights_ids
    FROM (
      SELECT DISTINCT capture.manifest_json->'sourceRightsProposal'->>'rightsArtifactId' AS value
        FROM outcome_source_capture capture
       WHERE capture.capture_id IN (
         SELECT jsonb_array_elements_text(expected_capture_ids)
       )
    ) rights;

  IF NOT "outcome_private_reviewed_evidence_is_current"()
     OR NEW."bundle_json"->>'evidenceBundleId' IS DISTINCT FROM NEW."evidence_bundle_id"
     OR content->>'schemaVersion'<>'afl-trade-private-reviewed-evidence-bundle/v1'
     OR content->>'authorityBoundary'<>
       'exact_current_private_review_sets_and_retained_source_artifacts_for_internal_nonproduction_calculation_only'
     OR content->>'environment'<>'non_production'
     OR content->>'evidenceKind'<>'retained_private_review'
     OR content->>'evidenceScopeKey' IS DISTINCT FROM NEW."evidence_scope_key"
     OR content->>'evidenceScopeKey'<>'afl-player-match-reviewed-2021-2026'
     OR (content->>'candidateCount')::integer<>NEW."candidate_count"
     OR (content->>'decisionCount')::integer<>NEW."decision_count"
     OR jsonb_array_length(content->'sourceCaptures')<>NEW."source_capture_count"
     OR jsonb_array_length(content->'sourceRightsEvidenceRefs')<>NEW."source_rights_count"
     OR NEW."candidate_count"<>48781
     OR NEW."decision_count"<>146343
     OR NEW."source_capture_count"<>6
     OR NEW."source_rights_count"<>2
     OR (content->>'createdAt')::timestamptz<>NEW."created_at"
     OR NEW."created_at"<>NEW."registered_at"
     OR content->'publicationEligible'<>'false'::jsonb
     OR content->'publicationProhibited'<>'true'::jsonb
     OR content->>'limitation'<>
       'Exact retained private review evidence only; not a factual release, model-training input, public fact set, publication candidate, production authority, or live-capture authority.'
     OR NEW."bundle_content_canonical_json"::jsonb IS DISTINCT FROM content
     OR encode(sha256(convert_to(NEW."bundle_content_canonical_json",'UTF8')),'hex')<>
       NEW."bundle_sha256"
     OR (SELECT jsonb_agg(to_jsonb(item->>'reviewSetId') ORDER BY item->>'reviewSetId')
           FROM jsonb_array_elements(content->'reviewSets') sets(item))
          IS DISTINCT FROM expected_review_set_ids
     OR (SELECT jsonb_agg(to_jsonb(item->>'captureId') ORDER BY item->>'captureId')
           FROM jsonb_array_elements(content->'sourceCaptures') captures(item))
          IS DISTINCT FROM expected_capture_ids
     OR (SELECT jsonb_agg(to_jsonb(rights.rights_artifact_id) ORDER BY rights.rights_artifact_id)
           FROM jsonb_array_elements(content->'sourceRightsEvidenceRefs') evidence(item)
           JOIN outcome_source_rights_proposal rights
             ON item->>'artifactId'='artifact:'||encode(sha256(convert_to(
                  "outcome_afl_trade_canonical_json"(rights.content_json),'UTF8')),'hex')
            AND item->>'contentSha256'=encode(sha256(convert_to(
                  "outcome_afl_trade_canonical_json"(rights.content_json),'UTF8')),'hex')
            AND item->>'storageUri'='artifact://sha256/'||encode(sha256(convert_to(
                  "outcome_afl_trade_canonical_json"(rights.content_json),'UTF8')),'hex')
            AND item->>'mediaType'='application/json'
            AND (item->>'byteLength')::integer=octet_length(convert_to(
                  "outcome_afl_trade_canonical_json"(rights.content_json),'UTF8'))
            AND (item->>'createdAt')::timestamptz=rights.proposed_at)
          IS DISTINCT FROM expected_rights_ids
     OR EXISTS (
       SELECT 1
         FROM jsonb_array_elements(content->'sourceCaptures') captures(item)
         LEFT JOIN outcome_source_capture capture ON capture.capture_id=item->>'captureId'
         LEFT JOIN outcome_artifact_custody custody
           ON custody.artifact_id=capture.source_artifact_id
        WHERE capture.capture_id IS NULL OR custody.artifact_id IS NULL
           OR item->>'provider' IS DISTINCT FROM capture.provider
           OR item->>'capabilityId' IS DISTINCT FROM capture.capability_id
           OR (item->>'seasonYear')::integer<>capture.anchor_season_year
           OR item->'sourceArtifact'->>'artifactId' IS DISTINCT FROM custody.artifact_id
           OR item->'sourceArtifact'->>'contentSha256' IS DISTINCT FROM custody.content_sha256
           OR item->'sourceArtifact'->>'storageUri' IS DISTINCT FROM custody.storage_uri
           OR item->'sourceArtifact'->>'mediaType' IS DISTINCT FROM custody.media_type
           OR (item->'sourceArtifact'->>'byteLength')::bigint<>custody.byte_length
           OR (item->'sourceArtifact'->>'createdAt')::timestamptz<>custody.created_at
     )
     OR EXISTS (
       SELECT 1
         FROM jsonb_array_elements(content->'reviewSets') sets(item)
         LEFT JOIN outcome_review_decision marker
           ON marker.subject_id=item->>'reviewSetId'
          AND marker.decision_id=item->>'reviewSetDecisionId'
         CROSS JOIN LATERAL (
           SELECT jsonb_build_object(
             'decisionId',marker.decision_id,
             'subjectType',marker.subject_type,
             'subjectId',marker.subject_id,
             'decision',marker.decision,
             'canonicalRecordType',marker.canonical_record_type,
             'canonicalRecordId',marker.canonical_record_id,
             'supersedesDecisionId',marker.supersedes_decision_id,
             'rationale',marker.rationale,
             'evidence',marker.evidence_json,
             'decidedBy',marker.decided_by,
             'decidedAt',to_char(marker.decided_at AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           ) AS snapshot
         ) snapshot
         CROSS JOIN LATERAL (
           SELECT "outcome_afl_trade_canonical_json"(snapshot.snapshot) AS canonical
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
           OR item->'reviewSetArtifact'->>'storageUri'<>'artifact://sha256/'||artifact_sha.value
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
    RAISE EXCEPTION 'Private reviewed evidence bundle failed exact current-set authentication';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_private_reviewed_evidence_bundle_insert_guard"
BEFORE INSERT ON "outcome_private_reviewed_evidence_bundle"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_reviewed_evidence_bundle_insert"();

CREATE TABLE "outcome_private_reviewed_evaluation_decision" (
  "decision_id" TEXT PRIMARY KEY,
  "valuation_scope_key" TEXT NOT NULL,
  "evidence_bundle_id" TEXT NOT NULL REFERENCES "outcome_private_reviewed_evidence_bundle"("evidence_bundle_id") ON DELETE RESTRICT,
  "status" TEXT NOT NULL CHECK ("status" IN ('authorized','withdrawn')),
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "supersedes_decision_id" TEXT UNIQUE,
  "reviewer_id" TEXT NOT NULL CHECK (length(btrim("reviewer_id")) BETWEEN 1 AND 240),
  "decided_at" TIMESTAMPTZ(3) NOT NULL,
  "decision_sha256" CHAR(64) NOT NULL CHECK ("decision_sha256" ~ '^[a-f0-9]{64}$'),
  "decision_content_canonical_json" TEXT NOT NULL,
  "decision_json" JSONB NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT "outcome_private_reviewed_evaluation_decision_id_check"
    CHECK ("decision_id"='private-reviewed-evidence-evaluation-decision:'||"decision_sha256"),
  CONSTRAINT "outcome_private_reviewed_evaluation_decision_chain_shape_check"
    CHECK (("revision"=1)=("supersedes_decision_id" IS NULL)),
  CONSTRAINT "outcome_private_reviewed_evaluation_decision_supersedes_fkey"
    FOREIGN KEY ("supersedes_decision_id")
      REFERENCES "outcome_private_reviewed_evaluation_decision"("decision_id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outcome_private_reviewed_evaluation_decision_revision_key"
    UNIQUE ("valuation_scope_key","evidence_bundle_id","revision")
);

CREATE TABLE "outcome_private_reviewed_evaluation_head" (
  "valuation_scope_key" TEXT NOT NULL,
  "evidence_scope_key" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "decision_id" TEXT NOT NULL UNIQUE,
  "evidence_bundle_id" TEXT NOT NULL REFERENCES "outcome_private_reviewed_evidence_bundle"("evidence_bundle_id") ON DELETE RESTRICT,
  "status" TEXT NOT NULL CHECK ("status" IN ('authorized','withdrawn')),
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("valuation_scope_key","evidence_scope_key"),
  FOREIGN KEY ("decision_id") REFERENCES "outcome_private_reviewed_evaluation_decision"("decision_id") ON DELETE RESTRICT
);

CREATE FUNCTION "validate_outcome_private_reviewed_evaluation_decision_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  content JSONB;
  bundle RECORD;
  bundle_canonical TEXT;
  bundle_sha TEXT;
  predecessor RECORD;
BEGIN
  content:=NEW."decision_json"->'content';
  SELECT * INTO bundle FROM outcome_private_reviewed_evidence_bundle
   WHERE evidence_bundle_id=NEW.evidence_bundle_id FOR KEY SHARE;
  bundle_canonical:="outcome_afl_trade_canonical_json"(bundle.bundle_json);
  bundle_sha:=encode(sha256(convert_to(bundle_canonical,'UTF8')),'hex');
  IF NOT FOUND OR NOT "outcome_private_reviewed_evidence_is_current"()
     OR NEW."decision_json"->>'decisionId' IS DISTINCT FROM NEW."decision_id"
     OR content->>'schemaVersion'<>
       'afl-trade-private-reviewed-evidence-evaluation-decision/v1'
     OR content->>'authorityBoundary'<>
       'exact_current_private_review_sets_and_retained_source_artifacts_for_internal_nonproduction_calculation_only'
     OR content->>'environment'<>'non_production'
     OR content->>'operation'<>'private_nonproduction_derived_calculation'
     OR content->>'evidenceKind'<>'retained_private_review'
     OR content->>'status' IS DISTINCT FROM NEW."status"
     OR content->>'valuationScopeKey' IS DISTINCT FROM NEW."valuation_scope_key"
     OR content->>'evidenceBundleId' IS DISTINCT FROM NEW."evidence_bundle_id"
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
     OR (content->>'revision')::integer<>NEW."revision"
     OR content->>'supersedesDecisionId' IS DISTINCT FROM NEW."supersedes_decision_id"
     OR content->>'reviewerId' IS DISTINCT FROM NEW."reviewer_id"
     OR length(btrim(content->>'rationale')) NOT BETWEEN 1 AND 2000
     OR (content->>'decidedAt')::timestamptz<>NEW."decided_at"
     OR NEW."decided_at"<>NEW."registered_at"
     OR NEW."decision_content_canonical_json"::jsonb IS DISTINCT FROM content
     OR encode(sha256(convert_to(NEW."decision_content_canonical_json",'UTF8')),'hex')<>
       NEW."decision_sha256"
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
       OR predecessor.evidence_bundle_id<>NEW.evidence_bundle_id
       OR predecessor.revision<>NEW.revision-1 OR predecessor.decided_at>NEW.decided_at
    THEN
      RAISE EXCEPTION 'Private reviewed-evidence decision has invalid chronology';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_private_reviewed_evaluation_decision_insert_guard"
BEFORE INSERT ON "outcome_private_reviewed_evaluation_decision"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_reviewed_evaluation_decision_insert"();

CREATE FUNCTION "validate_outcome_private_reviewed_evaluation_head_write"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE decision RECORD;
DECLARE bundle RECORD;
BEGIN
  SELECT * INTO decision FROM outcome_private_reviewed_evaluation_decision
   WHERE decision_id=NEW.decision_id FOR KEY SHARE;
  SELECT * INTO bundle FROM outcome_private_reviewed_evidence_bundle
   WHERE evidence_bundle_id=NEW.evidence_bundle_id FOR KEY SHARE;
  IF decision.decision_id IS NULL OR bundle.evidence_bundle_id IS NULL
     OR decision.valuation_scope_key<>NEW.valuation_scope_key
     OR decision.evidence_bundle_id<>NEW.evidence_bundle_id
     OR bundle.evidence_scope_key<>NEW.evidence_scope_key
     OR decision.revision<>NEW.revision OR decision.status<>NEW.status
     OR decision.decided_at<>NEW.updated_at
     OR (TG_OP='INSERT' AND (NEW.revision<>1 OR decision.supersedes_decision_id IS NOT NULL))
     OR (TG_OP='UPDATE' AND (
       NEW.revision<>OLD.revision+1 OR decision.supersedes_decision_id<>OLD.decision_id
     ))
  THEN
    RAISE EXCEPTION 'Private reviewed-evidence head must advance one exact decision revision';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_private_reviewed_evaluation_head_write_guard"
BEFORE INSERT OR UPDATE ON "outcome_private_reviewed_evaluation_head"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_reviewed_evaluation_head_write"();

CREATE FUNCTION "reject_outcome_private_reviewed_evaluation_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'Private reviewed evidence and decisions are append-only';
END $$;

CREATE TRIGGER "outcome_private_reviewed_evidence_bundle_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_private_reviewed_evidence_bundle"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_reviewed_evaluation_mutation"();
CREATE TRIGGER "outcome_private_reviewed_evaluation_decision_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_private_reviewed_evaluation_decision"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_reviewed_evaluation_mutation"();
CREATE TRIGGER "outcome_private_reviewed_evaluation_head_delete_guard"
BEFORE DELETE ON "outcome_private_reviewed_evaluation_head"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_reviewed_evaluation_mutation"();
