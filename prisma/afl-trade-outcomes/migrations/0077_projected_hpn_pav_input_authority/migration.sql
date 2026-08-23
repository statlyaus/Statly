-- Projected HPN field-map custody for the existing private PAV input builder.
-- Legacy v1 input sets retain their original columns, triggers, and validation path.

ALTER TABLE "outcome_hpn_pav_input_run"
  ALTER COLUMN "field_map_id" DROP NOT NULL,
  ADD COLUMN "projected_field_map_id" TEXT,
  ADD CONSTRAINT "outcome_hpn_pav_input_run_projected_map_fkey"
    FOREIGN KEY ("projected_field_map_id")
    REFERENCES "outcome_hpn_projected_field_map"("field_map_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "outcome_hpn_pav_input_run_exact_map_authority_check"
    CHECK (("field_map_id" IS NOT NULL)::INTEGER+
           ("projected_field_map_id" IS NOT NULL)::INTEGER=1);

CREATE INDEX "outcome_hpn_pav_input_run_projected_map_idx"
  ON "outcome_hpn_pav_input_run"("projected_field_map_id","input_set_id")
  WHERE "projected_field_map_id" IS NOT NULL;

-- The reviewed-evidence contract remains in the existing bundle/decision/head ledger. A successor
-- may add only the exact AFL Tables 2026 results capture and its distinct rights document to the
-- immutable six-capture authority that was current before this migration.
ALTER FUNCTION "outcome_private_reviewed_evidence_bundle_is_current"(TEXT)
  RENAME TO "outcome_private_reviewed_evidence_bundle_is_current_v1";

CREATE FUNCTION "outcome_private_reviewed_evidence_results_successor_is_exact"(
  target_evidence_bundle_id TEXT,
  base_evidence_bundle_id TEXT
) RETURNS BOOLEAN AS $$
DECLARE target_bundle RECORD; base_bundle RECORD; added_capture JSONB; added_rights JSONB;
  capture_record RECORD; custody_record RECORD; rights_record RECORD;
  rights_canonical TEXT; rights_sha256 TEXT;
BEGIN
  SELECT * INTO target_bundle FROM "outcome_private_reviewed_evidence_bundle"
   WHERE "evidence_bundle_id"=target_evidence_bundle_id;
  SELECT * INTO base_bundle FROM "outcome_private_reviewed_evidence_bundle"
   WHERE "evidence_bundle_id"=base_evidence_bundle_id;
  IF target_bundle."evidence_bundle_id" IS NULL OR base_bundle."evidence_bundle_id" IS NULL
    OR target_bundle."evidence_scope_key"<>base_bundle."evidence_scope_key"
    OR target_bundle."evidence_scope_key"<>'afl-player-match-reviewed-2021-2026'
    OR target_bundle."candidate_count"<>base_bundle."candidate_count"
    OR target_bundle."decision_count"<>base_bundle."decision_count"
    OR base_bundle."source_capture_count"<>6 OR base_bundle."source_rights_count"<>2
    OR target_bundle."source_capture_count"<>7 OR target_bundle."source_rights_count"<>3
    OR jsonb_typeof(base_bundle."bundle_json"->'content'->'sourceCaptures')<>'array'
    OR jsonb_array_length(base_bundle."bundle_json"->'content'->'sourceCaptures')<>6
    OR (SELECT count(DISTINCT item) FROM jsonb_array_elements(
      base_bundle."bundle_json"->'content'->'sourceCaptures') item)<>6
    OR jsonb_typeof(base_bundle."bundle_json"->'content'->'sourceRightsEvidenceRefs')<>'array'
    OR jsonb_array_length(base_bundle."bundle_json"->'content'->'sourceRightsEvidenceRefs')<>2
    OR (SELECT count(DISTINCT item) FROM jsonb_array_elements(
      base_bundle."bundle_json"->'content'->'sourceRightsEvidenceRefs') item)<>2
    OR jsonb_typeof(target_bundle."bundle_json"->'content'->'sourceCaptures')<>'array'
    OR jsonb_array_length(target_bundle."bundle_json"->'content'->'sourceCaptures')<>7
    OR (SELECT count(DISTINCT item) FROM jsonb_array_elements(
      target_bundle."bundle_json"->'content'->'sourceCaptures') item)<>7
    OR jsonb_typeof(target_bundle."bundle_json"->'content'->'sourceRightsEvidenceRefs')<>'array'
    OR jsonb_array_length(target_bundle."bundle_json"->'content'->'sourceRightsEvidenceRefs')<>3
    OR (SELECT count(DISTINCT item) FROM jsonb_array_elements(
      target_bundle."bundle_json"->'content'->'sourceRightsEvidenceRefs') item)<>3
    OR target_bundle."created_at"<=base_bundle."created_at"
    OR target_bundle."bundle_json"->>'evidenceBundleId'<>
      target_bundle."evidence_bundle_id"
    OR target_bundle."bundle_json"->'content'->>'schemaVersion'<>
      'afl-trade-private-reviewed-evidence-bundle/v1'
    OR target_bundle."bundle_json"->'content'->>'authorityBoundary'<>
      'exact_current_private_review_sets_and_retained_source_artifacts_for_internal_nonproduction_calculation_only'
    OR target_bundle."bundle_json"->'content'->>'environment'<>'non_production'
    OR target_bundle."bundle_json"->'content'->>'evidenceKind'<>'retained_private_review'
    OR target_bundle."bundle_json"->'content'->>'evidenceScopeKey'<>
      target_bundle."evidence_scope_key"
    OR target_bundle."bundle_json"->'content'->'publicationEligible'<>'false'::JSONB
    OR target_bundle."bundle_json"->'content'->'publicationProhibited'<>'true'::JSONB
    OR target_bundle."bundle_json"->'content'->>'limitation'<>
      'Exact retained private review evidence only; not a factual release, model-training input, public fact set, publication candidate, production authority, or live-capture authority.'
    OR (target_bundle."bundle_json"->'content'->>'candidateCount')::INTEGER<>
      target_bundle."candidate_count"
    OR (target_bundle."bundle_json"->'content'->>'decisionCount')::INTEGER<>
      target_bundle."decision_count"
    OR (target_bundle."bundle_json"->'content'->>'createdAt')::TIMESTAMPTZ<>
      target_bundle."created_at"
    OR target_bundle."bundle_content_canonical_json"<>
      "outcome_afl_trade_canonical_json"(target_bundle."bundle_json"->'content')
    OR target_bundle."bundle_sha256"<>encode(sha256(convert_to(
      target_bundle."bundle_content_canonical_json",'UTF8')),'hex')
    OR target_bundle."evidence_bundle_id"<>
      'private-reviewed-evidence-bundle:'||target_bundle."bundle_sha256"
    OR (target_bundle."bundle_json"->'content'->'reviewSets')<>
      (base_bundle."bundle_json"->'content'->'reviewSets')
    OR NOT ((target_bundle."bundle_json"->'content'->'sourceCaptures') @>
      (base_bundle."bundle_json"->'content'->'sourceCaptures'))
    OR NOT ((target_bundle."bundle_json"->'content'->'sourceRightsEvidenceRefs') @>
      (base_bundle."bundle_json"->'content'->'sourceRightsEvidenceRefs'))
  THEN RETURN FALSE; END IF;

  SELECT item INTO added_capture
    FROM jsonb_array_elements(target_bundle."bundle_json"->'content'->'sourceCaptures') item
   WHERE NOT ((base_bundle."bundle_json"->'content'->'sourceCaptures') @>
     jsonb_build_array(item));
  IF NOT FOUND OR added_capture IS NULL OR
    (SELECT count(*) FROM jsonb_array_elements(
      target_bundle."bundle_json"->'content'->'sourceCaptures') item
      WHERE NOT ((base_bundle."bundle_json"->'content'->'sourceCaptures') @>
        jsonb_build_array(item)))<>1
  THEN RETURN FALSE; END IF;
  SELECT capture.* INTO capture_record FROM "outcome_source_capture" capture
   WHERE capture."capture_id"=added_capture->>'captureId';
  SELECT custody.* INTO custody_record FROM "outcome_artifact_custody" custody
   WHERE custody."artifact_id"=capture_record."source_artifact_id";
  IF capture_record."capture_id" IS NULL OR custody_record."artifact_id" IS NULL
    OR capture_record."environment"<>'non_production'
    OR capture_record."status"<>'staged'
    OR capture_record."provider"<>'afl_tables'
    OR capture_record."capability_id"<>'afl-tables-results'
    OR capture_record."competition"<>'AFLM'
    OR capture_record."anchor_season_year"<>2026
    OR custody_record."environment"<>'non_production'
    OR custody_record."verified_at" IS NULL
    OR added_capture->>'provider'<>capture_record."provider"
    OR added_capture->>'capabilityId'<>capture_record."capability_id"
    OR (added_capture->>'seasonYear')::INTEGER<>capture_record."anchor_season_year"
    OR added_capture->'sourceArtifact'->>'artifactId'<>custody_record."artifact_id"
    OR added_capture->'sourceArtifact'->>'contentSha256'<>custody_record."content_sha256"
    OR added_capture->'sourceArtifact'->>'storageUri'<>custody_record."storage_uri"
    OR added_capture->'sourceArtifact'->>'mediaType'<>custody_record."media_type"
    OR (added_capture->'sourceArtifact'->>'byteLength')::BIGINT<>custody_record."byte_length"
    OR (added_capture->'sourceArtifact'->>'createdAt')::TIMESTAMPTZ<>
      custody_record."created_at"
    OR custody_record."created_at">target_bundle."created_at"
  THEN RETURN FALSE; END IF;

  SELECT item INTO added_rights
    FROM jsonb_array_elements(
      target_bundle."bundle_json"->'content'->'sourceRightsEvidenceRefs') item
   WHERE NOT ((base_bundle."bundle_json"->'content'->'sourceRightsEvidenceRefs') @>
     jsonb_build_array(item));
  IF NOT FOUND OR added_rights IS NULL OR
    (SELECT count(*) FROM jsonb_array_elements(
      target_bundle."bundle_json"->'content'->'sourceRightsEvidenceRefs') item
      WHERE NOT ((base_bundle."bundle_json"->'content'->'sourceRightsEvidenceRefs') @>
        jsonb_build_array(item)))<>1
  THEN RETURN FALSE; END IF;
  SELECT rights.* INTO rights_record FROM "outcome_source_rights_proposal" rights
   WHERE rights."rights_artifact_id"=
     capture_record."manifest_json"->'sourceRightsProposal'->>'rightsArtifactId';
  IF rights_record."rights_artifact_id" IS NULL THEN RETURN FALSE; END IF;
  rights_canonical:="outcome_afl_trade_canonical_json"(rights_record."content_json");
  rights_sha256:=encode(sha256(convert_to(rights_canonical,'UTF8')),'hex');
  RETURN COALESCE(
    rights_record."rights_artifact_id"='source-rights:'||encode(sha256(convert_to(
      "outcome_afl_trade_canonical_json"(rights_record."content_json"->'content'),'UTF8')),'hex')
    AND rights_record."rights_artifact_id"=
      rights_record."content_json"->>'rightsArtifactId'
    AND added_rights->>'artifactId'='artifact:'||rights_sha256
    AND added_rights->>'contentSha256'=rights_sha256
    AND added_rights->>'storageUri'='artifact://sha256/'||rights_sha256
    AND added_rights->>'mediaType'='application/json'
    AND (added_rights->>'byteLength')::INTEGER=
      octet_length(convert_to(rights_canonical,'UTF8'))
    AND (added_rights->>'createdAt')::TIMESTAMPTZ=rights_record."proposed_at"
    AND rights_record."proposed_at"<=target_bundle."created_at",
    FALSE
  );
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE STRICT;

CREATE FUNCTION "outcome_private_reviewed_evidence_bundle_is_current"(
  target_evidence_bundle_id TEXT
) RETURNS BOOLEAN AS $$
  SELECT "outcome_private_reviewed_evidence_bundle_is_current_v1"($1)
    OR EXISTS (
      SELECT 1
        FROM "outcome_private_reviewed_evaluation_head" head
        JOIN "outcome_private_reviewed_evaluation_decision" decision
          ON decision."decision_id"=head."decision_id"
        JOIN "outcome_private_reviewed_evaluation_decision" predecessor
          ON predecessor."decision_id"=decision."supersedes_decision_id"
       WHERE head."evidence_bundle_id"=$1
         AND head."status"='authorized' AND decision."status"='authorized'
         AND "outcome_private_reviewed_evidence_results_successor_is_exact"(
           decision."evidence_bundle_id",predecessor."evidence_bundle_id"));
$$ LANGUAGE sql STABLE STRICT;

DROP TRIGGER "outcome_private_reviewed_evidence_bundle_insert_guard"
  ON "outcome_private_reviewed_evidence_bundle";
CREATE TRIGGER "outcome_private_reviewed_evidence_bundle_insert_guard"
  BEFORE INSERT ON "outcome_private_reviewed_evidence_bundle"
  FOR EACH ROW
  WHEN (NEW."source_capture_count"=6 AND NEW."source_rights_count"=2)
  EXECUTE FUNCTION "validate_outcome_private_reviewed_evidence_bundle_insert"();

CREATE FUNCTION "validate_outcome_private_reviewed_evidence_results_successor_insert"()
RETURNS TRIGGER AS $$
DECLARE base_bundle_id TEXT;
BEGIN
  SELECT head."evidence_bundle_id" INTO base_bundle_id
    FROM "outcome_private_reviewed_evaluation_head" head
   WHERE head."valuation_scope_key"='afl-men:2026-trades'
     AND head."evidence_scope_key"=NEW."evidence_scope_key"
     AND head."status"='authorized';
  IF base_bundle_id IS NULL OR NOT
    "outcome_private_reviewed_evidence_results_successor_is_exact"(
      NEW."evidence_bundle_id",base_bundle_id) THEN
    RAISE EXCEPTION 'Private reviewed evidence results successor failed exact authentication';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_private_reviewed_evidence_results_successor_insert_guard"
  AFTER INSERT ON "outcome_private_reviewed_evidence_bundle"
  FOR EACH ROW
  WHEN (NEW."source_capture_count"=7 AND NEW."source_rights_count"=3)
  EXECUTE FUNCTION "validate_outcome_private_reviewed_evidence_results_successor_insert"();

CREATE FUNCTION "reject_outcome_private_reviewed_evidence_unsupported_shape"()
RETURNS TRIGGER AS $$ BEGIN
  RAISE EXCEPTION 'Private reviewed evidence bundle shape is unsupported';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "outcome_private_reviewed_evidence_unsupported_shape_guard"
  BEFORE INSERT ON "outcome_private_reviewed_evidence_bundle"
  FOR EACH ROW
  WHEN (NOT ((NEW."source_capture_count"=6 AND NEW."source_rights_count"=2)
          OR (NEW."source_capture_count"=7 AND NEW."source_rights_count"=3)))
  EXECUTE FUNCTION "reject_outcome_private_reviewed_evidence_unsupported_shape"();

CREATE OR REPLACE FUNCTION "validate_outcome_private_reviewed_evaluation_decision_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  content JSONB; bundle RECORD; bundle_canonical TEXT; bundle_sha TEXT;
  predecessor RECORD; current_head RECORD;
BEGIN
  content:=NEW."decision_json"->'content';
  SELECT * INTO bundle FROM "outcome_private_reviewed_evidence_bundle"
   WHERE "evidence_bundle_id"=NEW."evidence_bundle_id" FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Private reviewed-evidence evaluation decision failed exact authentication';
  END IF;
  bundle_canonical:="outcome_afl_trade_canonical_json"(bundle."bundle_json");
  bundle_sha:=encode(sha256(convert_to(bundle_canonical,'UTF8')),'hex');
  IF NEW."decision_json"->>'decisionId' IS DISTINCT FROM NEW."decision_id"
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
       'liveCapture',false)
     OR content->'publicationEligible' IS DISTINCT FROM 'false'::JSONB
     OR content->'publicationProhibited' IS DISTINCT FROM 'true'::JSONB
     OR content->>'limitation'<>
       'This decision authorizes only private local non-production derived calculations from the exact retained reviewed evidence bundle for internal evaluation. It grants no model-training, public-display, redistribution, production-activation, live-capture, factual-release, or publication authority.'
     OR jsonb_typeof(content->'revision')<>'number'
     OR (content->>'revision')::INTEGER<>NEW."revision"
     OR content->>'supersedesDecisionId' IS DISTINCT FROM NEW."supersedes_decision_id"
     OR content->>'reviewerId' IS DISTINCT FROM NEW."reviewer_id"
     OR length(btrim(content->>'rationale')) NOT BETWEEN 1 AND 2000
     OR jsonb_typeof(content->'decidedAt')<>'string'
     OR (content->>'decidedAt')::TIMESTAMPTZ<>NEW."decided_at"
     OR NEW."decided_at"<>NEW."registered_at"
     OR NEW."decision_content_canonical_json"::JSONB IS DISTINCT FROM content
     OR encode(sha256(convert_to(NEW."decision_content_canonical_json",'UTF8')),'hex')<>
       NEW."decision_sha256"
     OR NEW."decision_id"<>'private-reviewed-evidence-evaluation-decision:'||
       NEW."decision_sha256"
     OR content->'evidenceBundleArtifact'->>'artifactId' IS DISTINCT FROM
       'artifact:'||bundle_sha
     OR content->'evidenceBundleArtifact'->>'contentSha256' IS DISTINCT FROM bundle_sha
     OR content->'evidenceBundleArtifact'->>'storageUri' IS DISTINCT FROM
       'artifact://sha256/'||bundle_sha
     OR content->'evidenceBundleArtifact'->>'mediaType'<>'application/json'
     OR (content->'evidenceBundleArtifact'->>'byteLength')::INTEGER<>
       octet_length(convert_to(bundle_canonical,'UTF8'))
     OR (content->'evidenceBundleArtifact'->>'createdAt')::TIMESTAMPTZ<>
       bundle."created_at"
  THEN
    RAISE EXCEPTION 'Private reviewed-evidence evaluation decision failed exact authentication';
  END IF;

  IF NEW."supersedes_decision_id" IS NULL THEN
    IF NEW."revision"<>1 OR NOT
      "outcome_private_reviewed_evidence_bundle_is_current"(NEW."evidence_bundle_id") THEN
      RAISE EXCEPTION 'Private reviewed-evidence decision has invalid chronology';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO predecessor FROM "outcome_private_reviewed_evaluation_decision"
   WHERE "decision_id"=NEW."supersedes_decision_id" FOR KEY SHARE;
  SELECT * INTO current_head FROM "outcome_private_reviewed_evaluation_head"
   WHERE "valuation_scope_key"=NEW."valuation_scope_key"
     AND "decision_id"=NEW."supersedes_decision_id" FOR UPDATE;
  IF predecessor."decision_id" IS NULL OR current_head."decision_id" IS NULL
     OR predecessor."valuation_scope_key"<>NEW."valuation_scope_key"
     OR predecessor."revision"<>NEW."revision"-1
     OR predecessor."decided_at">NEW."decided_at"
     OR current_head."revision"<>predecessor."revision"
     OR current_head."evidence_bundle_id"<>predecessor."evidence_bundle_id"
     OR (
       predecessor."evidence_bundle_id"=NEW."evidence_bundle_id"
       AND predecessor."status"=NEW."status"
     )
     OR (
       predecessor."evidence_bundle_id"<>NEW."evidence_bundle_id"
       AND (
         predecessor."status"<>'authorized' OR NEW."status"<>'authorized'
         OR NOT "outcome_private_reviewed_evidence_results_successor_is_exact"(
           NEW."evidence_bundle_id",predecessor."evidence_bundle_id")
       )
     )
  THEN
    RAISE EXCEPTION 'Private reviewed-evidence decision has invalid chronology';
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Private reviewed-evidence evaluation decision failed exact authentication';
END $$;

CREATE FUNCTION "outcome_hpn_pav_projected_reviewed_fields"(map_json JSONB)
RETURNS JSONB AS $$
  SELECT COALESCE(jsonb_agg(field ORDER BY field COLLATE "C"),'[]'::JSONB)
    FROM (
      SELECT DISTINCT CASE mapping->>'kind'
        WHEN 'direct' THEN mapping->>'sourceField'
        ELSE NULL END AS field
        FROM jsonb_array_elements(map_json#>'{content,semanticBindings}') binding
        CROSS JOIN LATERAL (SELECT binding->'mapping' AS mapping) selected
      UNION
      SELECT DISTINCT source_field
        FROM jsonb_array_elements(map_json#>'{content,semanticBindings}') binding
        CROSS JOIN LATERAL jsonb_array_elements_text(
          CASE WHEN binding#>>'{mapping,kind}'='composite_key'
            THEN binding#>'{mapping,sourceFields}' ELSE '[]'::JSONB END
        ) source_field
      UNION
      SELECT DISTINCT binding#>>'{mapping,goals}'
        FROM jsonb_array_elements(map_json#>'{content,semanticBindings}') binding
       WHERE binding#>>'{mapping,kind}'='goals_plus_behinds'
      UNION
      SELECT DISTINCT binding#>>'{mapping,behinds}'
        FROM jsonb_array_elements(map_json#>'{content,semanticBindings}') binding
       WHERE binding#>>'{mapping,kind}'='goals_plus_behinds'
      UNION
      SELECT DISTINCT binding#>>'{mapping,matchDateField}'
        FROM jsonb_array_elements(map_json#>'{content,semanticBindings}') binding
       WHERE binding#>>'{mapping,kind}'='reviewed_final_scores'
      UNION
      SELECT DISTINCT binding#>>'{mapping,homePointsField}'
        FROM jsonb_array_elements(map_json#>'{content,semanticBindings}') binding
       WHERE binding#>>'{mapping,kind}'='reviewed_final_scores'
      UNION
      SELECT DISTINCT binding#>>'{mapping,awayPointsField}'
        FROM jsonb_array_elements(map_json#>'{content,semanticBindings}') binding
       WHERE binding#>>'{mapping,kind}'='reviewed_final_scores'
    ) fields
   WHERE field IS NOT NULL;
$$ LANGUAGE sql IMMUTABLE STRICT;

CREATE FUNCTION "outcome_hpn_json_artifact_ref_is_exact"(
  artifact_ref JSONB,document JSONB
) RETURNS BOOLEAN AS $$
DECLARE canonical_document TEXT; document_sha256 TEXT;
BEGIN
  IF jsonb_typeof(artifact_ref)<>'object'
    OR (SELECT count(*) FROM jsonb_object_keys(artifact_ref))<>6 THEN
    RETURN FALSE;
  END IF;
  canonical_document:="outcome_afl_trade_canonical_json"(document);
  document_sha256:=encode(sha256(convert_to(canonical_document,'UTF8')),'hex');
  RETURN COALESCE(
    artifact_ref->>'artifactId'='artifact:'||document_sha256
    AND artifact_ref->>'contentSha256'=document_sha256
    AND artifact_ref->>'storageUri'='artifact://sha256/'||document_sha256
    AND artifact_ref->>'mediaType'='application/json'
    AND jsonb_typeof(artifact_ref->'byteLength')='number'
    AND (artifact_ref->>'byteLength')::INTEGER=
      octet_length(convert_to(canonical_document,'UTF8'))
    AND jsonb_typeof(artifact_ref->'createdAt')='string'
    AND (artifact_ref->>'createdAt')::TIMESTAMPTZ IS NOT NULL,
    FALSE
  );
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

CREATE FUNCTION "outcome_hpn_projected_candidate_is_exact"(candidate_json JSONB)
RETURNS BOOLEAN AS $$
DECLARE content JSONB; bindings JSONB; completion_rule JSONB;
  expected_fields JSONB; binding JSONB; mapping JSONB; mapping_kind TEXT;
  semantic_field TEXT; consumed_fields TEXT[]:=ARRAY[]::TEXT[];
BEGIN
  IF jsonb_typeof(candidate_json)<>'object'
    OR (SELECT count(*) FROM jsonb_object_keys(candidate_json))<>2
    OR jsonb_typeof(candidate_json->'content')<>'object'
    OR (SELECT count(*) FROM jsonb_object_keys(candidate_json->'content'))<>19 THEN
    RETURN FALSE;
  END IF;
  content:=candidate_json->'content';
  bindings:=content->'semanticBindings';
  completion_rule:=content->'completionRule';
  IF content->>'schemaVersion'<>'afl-trade-hpn-field-map-candidate/v2'
    OR content->>'environment'<>'non_production'
    OR content->>'purpose'<>'private_confirmed_realized_hpn_pav_review'
    OR content->>'competition'<>'AFLM'
    OR content->>'reviewState'<>'requires_review'
    OR content->'publicationEligible' IS DISTINCT FROM 'false'::JSONB
    OR content->'publicationProhibited' IS DISTINCT FROM 'true'::JSONB
    OR content->>'limitation'<>
      'Unapproved field-map candidate for private local review only; it cannot satisfy HPN input admission until an exact current review decision creates a governed HPN field map.'
    OR content->>'provider' !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,239}$'
    OR content->>'capabilityId' !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,239}$'
    OR content->>'providerDecodeMapId' !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,239}$'
    OR content->>'sourceSchemaSha256' !~ '^[a-f0-9]{64}$'
    OR content->>'inputKind' NOT IN ('completed_match_result','player_match_stats')
    OR jsonb_typeof(content->'validFromSeason')<>'number'
    OR jsonb_typeof(content->'validThroughSeason')<>'number'
    OR (content->>'validFromSeason')::INTEGER NOT BETWEEN 1998 AND 2200
    OR (content->>'validThroughSeason')::INTEGER NOT BETWEEN
      (content->>'validFromSeason')::INTEGER AND 2200
    OR jsonb_typeof(content->'createdAt')<>'string'
    OR (content->>'createdAt')::TIMESTAMPTZ IS NULL
    OR NOT "outcome_hpn_json_artifact_ref_is_exact"(
      content->'providerDecodeMapArtifact',
      (SELECT map_json FROM "outcome_provider_field_map"
        WHERE field_map_id=content->>'providerDecodeMapId')
    )
    OR NOT EXISTS (
      SELECT 1 FROM "outcome_provider_field_map" decode_map
       WHERE decode_map."field_map_id"=content->>'providerDecodeMapId'
         AND decode_map."capability_id"=content->>'capabilityId'
         AND decode_map."source_schema_sha256"=content->>'sourceSchemaSha256'
    )
    OR (content#>>'{providerDecodeMapArtifact,createdAt}')::TIMESTAMPTZ>
      (content->>'createdAt')::TIMESTAMPTZ
    OR jsonb_typeof(bindings)<>'array' THEN
    RETURN FALSE;
  END IF;

  expected_fields:=CASE content->>'inputKind'
    WHEN 'completed_match_result' THEN
      '["awayClub","awayPoints","completionStatus","homeClub","homePoints","match"]'::JSONB
    ELSE
      '["clearances","club","freeKicksAgainst","freeKicksFor","goalAssists","hitOuts","inside50s","marks","marksInside50","match","onePercenters","player","rebound50s","tackles","totalPoints"]'::JSONB
  END;
  IF (SELECT jsonb_agg(value->'semanticField' ORDER BY ordinal)
        FROM jsonb_array_elements(bindings) WITH ORDINALITY item(value,ordinal))
      IS DISTINCT FROM expected_fields THEN
    RETURN FALSE;
  END IF;

  FOR binding IN SELECT value FROM jsonb_array_elements(bindings) item(value)
  LOOP
    IF jsonb_typeof(binding)<>'object'
      OR (SELECT count(*) FROM jsonb_object_keys(binding))<>2
      OR jsonb_typeof(binding->'semanticField')<>'string'
      OR jsonb_typeof(binding->'mapping')<>'object' THEN
      RETURN FALSE;
    END IF;
    semantic_field:=binding->>'semanticField';
    mapping:=binding->'mapping';
    mapping_kind:=mapping->>'kind';
    IF mapping_kind='direct' THEN
      IF (SELECT count(*) FROM jsonb_object_keys(mapping))<>2
        OR mapping->>'sourceField' IS NULL
        OR length(btrim(mapping->>'sourceField')) NOT BETWEEN 1 AND 200
        OR mapping->>'sourceField'<>btrim(mapping->>'sourceField') THEN
        RETURN FALSE;
      END IF;
      consumed_fields:=array_append(consumed_fields,mapping->>'sourceField');
    ELSIF mapping_kind='goals_plus_behinds' THEN
      IF semantic_field<>'totalPoints'
        OR (SELECT count(*) FROM jsonb_object_keys(mapping))<>3
        OR length(btrim(mapping->>'goals')) NOT BETWEEN 1 AND 200
        OR length(btrim(mapping->>'behinds')) NOT BETWEEN 1 AND 200
        OR mapping->>'goals'<>btrim(mapping->>'goals')
        OR mapping->>'behinds'<>btrim(mapping->>'behinds') THEN
        RETURN FALSE;
      END IF;
      consumed_fields:=array_append(consumed_fields,mapping->>'goals');
      consumed_fields:=array_append(consumed_fields,mapping->>'behinds');
    ELSIF mapping_kind='composite_key' THEN
      IF semantic_field<>'match'
        OR (SELECT count(*) FROM jsonb_object_keys(mapping))<>2
        OR jsonb_typeof(mapping->'sourceFields')<>'array'
        OR jsonb_array_length(mapping->'sourceFields') NOT BETWEEN 2 AND 10
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(mapping->'sourceFields') source(value)
           WHERE jsonb_typeof(value)<>'string'
             OR length(btrim(value#>>'{}')) NOT BETWEEN 1 AND 200
             OR value#>>'{}'<>btrim(value#>>'{}'))
        OR (SELECT count(*) FROM jsonb_array_elements_text(mapping->'sourceFields'))<>
           (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(
             mapping->'sourceFields') source(value)) THEN
        RETURN FALSE;
      END IF;
    ELSIF mapping_kind='reviewed_final_scores' THEN
      IF semantic_field<>'completionStatus'
        OR (SELECT count(*) FROM jsonb_object_keys(mapping))<>4
        OR length(btrim(mapping->>'matchDateField')) NOT BETWEEN 1 AND 200
        OR length(btrim(mapping->>'homePointsField')) NOT BETWEEN 1 AND 200
        OR length(btrim(mapping->>'awayPointsField')) NOT BETWEEN 1 AND 200 THEN
        RETURN FALSE;
      END IF;
    ELSE
      RETURN FALSE;
    END IF;
    IF semantic_field='totalPoints' AND mapping_kind NOT IN ('direct','goals_plus_behinds')
      OR semantic_field='match' AND mapping_kind NOT IN ('direct','composite_key')
      OR semantic_field='completionStatus' AND mapping_kind NOT IN ('direct','reviewed_final_scores')
      OR semantic_field NOT IN ('totalPoints','match','completionStatus')
         AND mapping_kind<>'direct' THEN
      RETURN FALSE;
    END IF;
  END LOOP;
  IF cardinality(consumed_fields)<>(SELECT count(DISTINCT field)
      FROM unnest(consumed_fields) field) THEN
    RETURN FALSE;
  END IF;

  IF content->>'inputKind'='player_match_stats' THEN
    RETURN completion_rule='null'::JSONB;
  END IF;
  IF jsonb_typeof(completion_rule)<>'object' THEN RETURN FALSE; END IF;
  IF completion_rule->>'kind'='source_status' THEN
    RETURN (SELECT count(*) FROM jsonb_object_keys(completion_rule))=2
      AND jsonb_typeof(completion_rule->'completedValues')='array'
      AND jsonb_array_length(completion_rule->'completedValues') BETWEEN 1 AND 20
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(completion_rule->'completedValues') item(value)
         WHERE jsonb_typeof(value)<>'string'
           OR length(btrim(value#>>'{}')) NOT BETWEEN 1 AND 120)
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(bindings) item(value)
         WHERE value->>'semanticField'='completionStatus'
           AND value#>>'{mapping,kind}'='direct');
  END IF;
  RETURN completion_rule->>'kind'='reviewed_final_score_presence'
    AND (SELECT count(*) FROM jsonb_object_keys(completion_rule))=2
    AND completion_rule->'decisionRequired' IS NOT DISTINCT FROM 'true'::JSONB
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(bindings) item(value)
       WHERE value->>'semanticField'='completionStatus'
         AND value#>>'{mapping,kind}'='reviewed_final_scores');
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE STRICT;

CREATE FUNCTION "outcome_hpn_private_source_rights_permit"(
  rights_json JSONB,
  source_fields JSONB,
  target_competition TEXT,
  target_season_year INTEGER,
  target_effective_at TIMESTAMPTZ
) RETURNS BOOLEAN AS $$
DECLARE rights_sha256 TEXT;
BEGIN
  rights_sha256:=encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(rights_json->'content'),'UTF8')),'hex');
  RETURN COALESCE(
    jsonb_typeof(rights_json)='object'
    AND rights_json->>'rightsArtifactId'='source-rights:'||rights_sha256
    AND rights_json#>>'{content,schemaVersion}'='afl-trade-source-rights/v2'
    AND (rights_json#>'{content,scope,competitions}') ? target_competition
    AND EXISTS (
      SELECT 1
        FROM jsonb_array_elements(rights_json#>'{content,scope,seasonRanges}') item(range)
       WHERE target_season_year BETWEEN
         (range->>'from')::INTEGER AND (range->>'to')::INTEGER)
    AND (
      jsonb_array_length(rights_json#>'{content,restrictions,commercial}')=0
      OR (rights_json#>'{content,restrictions,commercial}') ? 'internal-evaluation')
    AND (
      jsonb_array_length(rights_json#>'{content,restrictions,audience}')=0
      OR (rights_json#>'{content,restrictions,audience}') ? 'internal')
    AND (rights_json#>>'{content,termsEffectiveAt}' IS NULL
      OR target_effective_at>=(rights_json#>>'{content,termsEffectiveAt}')::TIMESTAMPTZ)
    AND (rights_json#>>'{content,termsExpireAt}' IS NULL
      OR target_effective_at<(rights_json#>>'{content,termsExpireAt}')::TIMESTAMPTZ)
    AND rights_json#>>'{content,operations,derived_feature_creation}'='allowed'
    AND rights_json#>>'{content,retention,derivedArtifacts,disposition}'<>'prohibited'
    AND (rights_json#>'{content,retention,derivedArtifacts,deleteOnWithdrawal}')=
      'true'::JSONB
    AND (rights_json#>'{content,withdrawalDuties,stopNewDerivedWork}')='true'::JSONB
    AND jsonb_typeof(source_fields)='array'
    AND jsonb_array_length(source_fields)>0
    AND (SELECT count(*) FROM jsonb_array_elements_text(source_fields))=
      (SELECT count(DISTINCT field) FROM jsonb_array_elements_text(source_fields) item(field))
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(source_fields) item(field)
       WHERE NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(rights_json#>'{content,fields}') item(rights_field)
          WHERE rights_field->>'sourceField'=field
            AND rights_field#>>'{uses,derived_feature}'='allowed')),
    FALSE
  );
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

CREATE FUNCTION "outcome_hpn_projected_field_map_authority_is_exact"(
  target_field_map_id TEXT,
  target_effective_at TIMESTAMPTZ
) RETURNS BOOLEAN AS $$
DECLARE candidate RECORD; decision RECORD; projected RECORD;
  reviewed RECORD;
  assessment JSONB; assessment_content JSONB; expected_map_content JSONB;
  candidate_sha256 TEXT; decision_sha256 TEXT; assessment_sha256 TEXT;
  field_map_sha256 TEXT; rights_content_sha256 TEXT;
  assessed_fields JSONB; rights_overbroad BOOLEAN;
BEGIN
  SELECT * INTO projected FROM "outcome_hpn_projected_field_map"
   WHERE "field_map_id"=target_field_map_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  SELECT * INTO candidate FROM "outcome_hpn_field_map_candidate"
   WHERE "candidate_id"=projected."candidate_id";
  IF NOT FOUND THEN RETURN FALSE; END IF;
  SELECT * INTO decision FROM "outcome_hpn_field_map_review_decision"
   WHERE "decision_id"=projected."approval_decision_id";
  IF NOT FOUND THEN RETURN FALSE; END IF;
  assessment:=decision."source_use_assessment_json";
  assessment_content:=assessment->'content';
  SELECT evaluation.*,head."evidence_scope_key" AS head_evidence_scope_key,
         head."revision" AS head_revision,head."status" AS head_status,
         bundle."bundle_json",bundle."bundle_content_canonical_json",
         bundle."bundle_sha256",bundle."created_at" AS bundle_created_at,
         rights."rights_artifact_id",rights."content_json" AS rights_json,
         rights."proposed_at" AS rights_proposed_at
    INTO reviewed
    FROM "outcome_private_reviewed_evaluation_decision" evaluation
    JOIN "outcome_private_reviewed_evaluation_head" head
      ON head."decision_id"=evaluation."decision_id"
     AND head."valuation_scope_key"=evaluation."valuation_scope_key"
     AND head."evidence_bundle_id"=evaluation."evidence_bundle_id"
    JOIN "outcome_private_reviewed_evidence_bundle" bundle
      ON bundle."evidence_bundle_id"=evaluation."evidence_bundle_id"
     AND bundle."evidence_scope_key"=head."evidence_scope_key"
    JOIN "outcome_source_rights_proposal" rights
      ON rights."rights_artifact_id"=assessment_content->>'rightsArtifactId'
   WHERE evaluation."decision_id"=assessment_content->>'evaluationDecisionId'
     AND evaluation."evidence_bundle_id"=assessment_content->>'evidenceBundleId'
     AND evaluation."valuation_scope_key"=assessment_content->>'valuationScopeKey';
  IF NOT FOUND THEN RETURN FALSE; END IF;
  rights_overbroad:=
    reviewed."rights_json"#>>'{content,operations,model_training}'<>'blocked'
    OR reviewed."rights_json"#>>'{content,operations,public_derived_output}'<>'blocked'
    OR reviewed."rights_json"#>>'{content,operations,public_fact_display}'<>'blocked'
    OR reviewed."rights_json"#>>'{content,operations,raw_field_redistribution}'<>'blocked'
    OR reviewed."rights_json"#>'{content,redistribution,rawFieldsPermitted}'<>'false'::JSONB
    OR reviewed."rights_json"#>'{content,redistribution,publicDerivedOutputPermitted}'<>
      'false'::JSONB
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(reviewed."rights_json"#>'{content,fields}') item(field)
       WHERE field#>>'{uses,model_training}'<>'blocked'
          OR field#>>'{uses,public_display}'<>'blocked');

  candidate_sha256:=encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(candidate."candidate_json"->'content'),'UTF8')),'hex');
  decision_sha256:=encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(decision."decision_json"->'content'),'UTF8')),'hex');
  assessment_sha256:=encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(assessment_content),'UTF8')),'hex');
  field_map_sha256:=encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(projected."map_json"->'content'),'UTF8')),'hex');
  rights_content_sha256:=encode(sha256(convert_to(
    "outcome_afl_trade_canonical_json"(reviewed."rights_json"->'content'),'UTF8')),'hex');
  SELECT COALESCE(jsonb_agg(field->'sourceField' ORDER BY field->>'sourceField'),'[]'::JSONB)
    INTO assessed_fields
    FROM jsonb_array_elements(assessment_content->'fields') item(field);

  expected_map_content:=jsonb_build_object(
    'schemaVersion','afl-trade-hpn-projected-field-map/v1',
    'environment','non_production',
    'purpose','private_confirmed_realized_hpn_pav',
    'competition',candidate."candidate_json"#>>'{content,competition}',
    'provider',candidate."candidate_json"#>>'{content,provider}',
    'capabilityId',candidate."candidate_json"#>>'{content,capabilityId}',
    'sourceSchemaSha256',candidate."candidate_json"#>>'{content,sourceSchemaSha256}',
    'inputKind',candidate."candidate_json"#>>'{content,inputKind}',
    'validFromSeason',candidate."candidate_json"#>'{content,validFromSeason}',
    'validThroughSeason',candidate."candidate_json"#>'{content,validThroughSeason}',
    'candidateId',candidate."candidate_id",
    'candidateArtifact',candidate."candidate_artifact_json",
    'approvalDecisionId',decision."decision_id",
    'approvalDecisionArtifact',decision."decision_artifact_json",
    'semanticBindings',candidate."candidate_json"#>'{content,semanticBindings}',
    'completionRule',candidate."candidate_json"#>'{content,completionRule}',
    'createdAt',decision."decision_json"#>'{content,decidedAt}',
    'publicationEligible',false,
    'publicationProhibited',true,
    'limitation',
      'Private non-production projection map only; it grants no factual release, model training, publication, production, activation, or live-capture authority.'
  );

  RETURN COALESCE(
    "outcome_hpn_projected_candidate_is_exact"(candidate."candidate_json")
    AND candidate."candidate_id"='hpn-field-map-candidate:'||candidate_sha256
    AND candidate."candidate_sha256"=candidate_sha256
    AND candidate."candidate_canonical_json"=
      "outcome_afl_trade_canonical_json"(candidate."candidate_json")
    AND "outcome_hpn_json_artifact_ref_is_exact"(
      candidate."candidate_artifact_json",candidate."candidate_json")
    AND decision."decision_id"='hpn-field-map-review-decision:'||decision_sha256
    AND decision."decision_sha256"=decision_sha256
    AND decision."decision_canonical_json"=
      "outcome_afl_trade_canonical_json"(decision."decision_json")
    AND decision."decision"='approved'
    AND decision."decision_json"#>>'{content,schemaVersion}'=
      'afl-trade-hpn-field-map-review-decision/v2'
    AND decision."decision_json"#>>'{content,environment}'='non_production'
    AND decision."decision_json"#>>'{content,purpose}'=
      'private_confirmed_realized_hpn_pav_review'
    AND decision."decision_json"#>>'{content,candidateId}'=candidate."candidate_id"
    AND decision."decision_json"#>'{content,candidateArtifact}'=
      candidate."candidate_artifact_json"
    AND decision."decision_json"#>>'{content,sourceUseAssessmentId}'=
      decision."source_use_assessment_id"
    AND decision."decision_json"#>'{content,sourceUseAssessmentArtifact}'=
      decision."source_use_assessment_artifact_json"
    AND decision."decision_json"#>'{content,publicationEligible}'='false'::JSONB
    AND decision."decision_json"#>'{content,publicationProhibited}'='true'::JSONB
    AND (SELECT count(*) FROM jsonb_object_keys(decision."decision_json"))=2
    AND (SELECT count(*) FROM jsonb_object_keys(
      decision."decision_json"->'content'))=14
    AND "outcome_hpn_json_artifact_ref_is_exact"(
      decision."decision_artifact_json",decision."decision_json")
    AND decision."source_use_assessment_id"=
      'hpn-private-source-use-assessment:'||assessment_sha256
    AND decision."source_use_assessment_canonical_json"=
      "outcome_afl_trade_canonical_json"(assessment)
    AND "outcome_hpn_json_artifact_ref_is_exact"(
      decision."source_use_assessment_artifact_json",assessment)
    AND jsonb_typeof(assessment)='object'
    AND (SELECT count(*) FROM jsonb_object_keys(assessment))=2
    AND jsonb_typeof(assessment_content)='object'
    AND (SELECT count(*) FROM jsonb_object_keys(assessment_content))=17
    AND assessment_content->>'schemaVersion'=
      'afl-trade-hpn-private-source-use-assessment/v1'
    AND assessment_content->>'environment'='non_production'
    AND assessment_content->>'purpose'='private_confirmed_realized_hpn_pav'
    AND assessment_content->>'valuationScopeKey'='afl-men:2026-trades'
    AND assessment_content->>'evaluationDecisionId'=reviewed."decision_id"
    AND assessment_content->>'evidenceBundleId'=reviewed."evidence_bundle_id"
    AND assessment_content->>'competition'=
      candidate."candidate_json"#>>'{content,competition}'
    AND (assessment_content->>'seasonYear')::INTEGER BETWEEN
      candidate."valid_from_season" AND candidate."valid_through_season"
    AND assessment_content->>'state'='permitted_private_calculation'
    AND assessment_content->'reasons'='[]'::JSONB
    AND assessment_content->'publicationEligible'='false'::JSONB
    AND assessment_content->'publicationProhibited'='true'::JSONB
    AND reviewed."status"='authorized'
    AND reviewed."head_status"='authorized'
    AND reviewed."revision"=reviewed."head_revision"
    AND reviewed."head_evidence_scope_key"='afl-player-match-reviewed-2021-2026'
    AND reviewed."decision_json"#>>'{content,schemaVersion}'=
      'afl-trade-private-reviewed-evidence-evaluation-decision/v1'
    AND reviewed."decision_json"#>>'{content,status}'='authorized'
    AND reviewed."decision_json"#>>'{content,valuationScopeKey}'=
      assessment_content->>'valuationScopeKey'
    AND reviewed."decision_json"#>>'{content,evidenceBundleId}'=
      assessment_content->>'evidenceBundleId'
    AND reviewed."decision_json"#>'{content,permissions,derivedCalculations}'='true'::JSONB
    AND reviewed."decision_json"#>'{content,permissions,internalEvaluation}'='true'::JSONB
    AND reviewed."decision_json"#>'{content,permissions,modelTraining}'='false'::JSONB
    AND reviewed."decision_json"#>'{content,publicationEligible}'='false'::JSONB
    AND reviewed."decision_json"#>'{content,publicationProhibited}'='true'::JSONB
    AND reviewed."rights_artifact_id"='source-rights:'||rights_content_sha256
    AND reviewed."rights_json"->>'rightsArtifactId'=reviewed."rights_artifact_id"
    AND reviewed."decision_id"='private-reviewed-evidence-evaluation-decision:'||
      encode(sha256(convert_to("outcome_afl_trade_canonical_json"(
        reviewed."decision_json"->'content'),'UTF8')),'hex')
    AND reviewed."bundle_content_canonical_json"=
      "outcome_afl_trade_canonical_json"(reviewed."bundle_json"->'content')
    AND reviewed."bundle_sha256"=encode(sha256(convert_to(
      reviewed."bundle_content_canonical_json",'UTF8')),'hex')
    AND reviewed."evidence_bundle_id"='private-reviewed-evidence-bundle:'||
      reviewed."bundle_sha256"
    AND "outcome_hpn_json_artifact_ref_is_exact"(
      reviewed."decision_json"#>'{content,evidenceBundleArtifact}',
      reviewed."bundle_json")
    AND jsonb_typeof(assessment_content->'evidenceRefs')='array'
    AND jsonb_array_length(assessment_content->'evidenceRefs')=2
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(assessment_content->'evidenceRefs') item(reference)
       WHERE reference=reviewed."decision_json"#>'{content,evidenceBundleArtifact}')
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(assessment_content->'evidenceRefs') item(reference)
       WHERE "outcome_hpn_json_artifact_ref_is_exact"(reference,reviewed."rights_json"))
    AND EXISTS (
      SELECT 1
        FROM jsonb_array_elements(
          reviewed."bundle_json"#>'{content,sourceRightsEvidenceRefs}') item(reference)
       WHERE "outcome_hpn_json_artifact_ref_is_exact"(reference,reviewed."rights_json"))
    AND (assessment_content->>'evaluatedAt')::TIMESTAMPTZ>=reviewed."decided_at"
    AND (assessment_content->>'evaluatedAt')::TIMESTAMPTZ>=reviewed."rights_proposed_at"
    AND (reviewed."rights_json"#>>'{content,termsEffectiveAt}' IS NULL
      OR (assessment_content->>'evaluatedAt')::TIMESTAMPTZ>=
         (reviewed."rights_json"#>>'{content,termsEffectiveAt}')::TIMESTAMPTZ)
    AND (reviewed."rights_json"#>>'{content,termsExpireAt}' IS NULL
      OR (assessment_content->>'evaluatedAt')::TIMESTAMPTZ<
         (reviewed."rights_json"#>>'{content,termsExpireAt}')::TIMESTAMPTZ)
    AND (
      (NOT rights_overbroad AND assessment_content->'effectiveRestriction'='null'::JSONB)
      OR (rights_overbroad AND assessment_content->'effectiveRestriction'=
        jsonb_build_object(
          'mode','narrowed_private_evaluation',
          'baseRightsArtifactId',assessment_content->>'rightsArtifactId',
          'evaluationDecisionId',reviewed."decision_id",
          'operation','derived_feature_creation',
          'commercialContext','internal-evaluation','audience','internal',
          'modelTraining','blocked','publicDerivedOutput','blocked',
          'publicFactDisplay','blocked','rawFieldRedistribution','blocked')))
    AND jsonb_typeof(assessment_content->'fields')='array'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(assessment_content->'fields') item(field)
       WHERE jsonb_typeof(field)<>'object'
         OR (SELECT count(*) FROM jsonb_object_keys(field))<>3
         OR field->>'state'<>'permitted_private_calculation'
         OR field->'reasons'<>'[]'::JSONB)
    AND assessed_fields="outcome_hpn_pav_projected_reviewed_fields"(
      candidate."candidate_json")
    AND "outcome_hpn_private_source_rights_permit"(
      reviewed."rights_json",assessed_fields,
      assessment_content->>'competition',(assessment_content->>'seasonYear')::INTEGER,
      target_effective_at)
    AND projected."field_map_id"='hpn-pav-field-map:'||field_map_sha256
    AND projected."field_map_sha256"=field_map_sha256
    AND projected."field_map_canonical_json"=
      "outcome_afl_trade_canonical_json"(projected."map_json")
    AND projected."map_json"=jsonb_build_object(
      'fieldMapId',projected."field_map_id",'content',expected_map_content),
    FALSE
  );
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE STRICT;

CREATE FUNCTION "outcome_hpn_pav_projected_scalar"(
  payload JSONB,map_json JSONB,semantic_field TEXT
) RETURNS JSONB AS $$
DECLARE mapping JSONB; mapping_kind TEXT; observed JSONB; goals JSONB; behinds JSONB;
BEGIN
  SELECT binding->'mapping' INTO mapping
    FROM jsonb_array_elements(map_json#>'{content,semanticBindings}') binding
   WHERE binding->>'semanticField'=semantic_field;
  IF NOT FOUND THEN RETURN NULL; END IF;
  mapping_kind:=mapping->>'kind';
  IF mapping_kind='direct' THEN
    observed:="outcome_hpn_pav_scalar"(payload,mapping->>'sourceField');
    IF observed IS NULL OR jsonb_typeof(observed)='null' THEN RETURN NULL; END IF;
    RETURN observed;
  ELSIF mapping_kind='goals_plus_behinds' AND semantic_field='totalPoints' THEN
    goals:="outcome_hpn_pav_scalar"(payload,mapping->>'goals');
    behinds:="outcome_hpn_pav_scalar"(payload,mapping->>'behinds');
    IF goals IS NULL OR behinds IS NULL
      OR jsonb_typeof(goals)<>'number' OR jsonb_typeof(behinds)<>'number' THEN
      RETURN NULL;
    END IF;
    RETURN to_jsonb((goals#>>'{}')::NUMERIC*6+(behinds#>>'{}')::NUMERIC);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

CREATE FUNCTION "outcome_hpn_pav_nonnegative_integer"(observed JSONB)
RETURNS BOOLEAN AS $$
DECLARE numeric_value NUMERIC;
BEGIN
  IF observed IS NULL OR jsonb_typeof(observed)<>'number' THEN RETURN FALSE; END IF;
  numeric_value:=(observed#>>'{}')::NUMERIC;
  RETURN numeric_value>=0 AND numeric_value<=10000000 AND trunc(numeric_value)=numeric_value;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

CREATE FUNCTION "outcome_hpn_pav_iso_date"(observed JSONB)
RETURNS BOOLEAN AS $$
DECLARE date_value TEXT;
BEGIN
  IF observed IS NULL OR jsonb_typeof(observed)<>'string' THEN RETURN FALSE; END IF;
  date_value:=observed#>>'{}';
  RETURN date_value~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    AND to_char(date_value::DATE,'YYYY-MM-DD')=date_value;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

CREATE FUNCTION "outcome_hpn_pav_projected_expected_player_stats"(
  payload JSONB,map_json JSONB
) RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'totalPoints',"outcome_hpn_pav_projected_scalar"(payload,map_json,'totalPoints'),
    'hitOuts',"outcome_hpn_pav_projected_scalar"(payload,map_json,'hitOuts'),
    'goalAssists',"outcome_hpn_pav_projected_scalar"(payload,map_json,'goalAssists'),
    'inside50s',"outcome_hpn_pav_projected_scalar"(payload,map_json,'inside50s'),
    'marks',"outcome_hpn_pav_projected_scalar"(payload,map_json,'marks'),
    'marksInside50',"outcome_hpn_pav_projected_scalar"(payload,map_json,'marksInside50'),
    'freeKicksFor',"outcome_hpn_pav_projected_scalar"(payload,map_json,'freeKicksFor'),
    'freeKicksAgainst',"outcome_hpn_pav_projected_scalar"(payload,map_json,'freeKicksAgainst'),
    'rebound50s',"outcome_hpn_pav_projected_scalar"(payload,map_json,'rebound50s'),
    'onePercenters',"outcome_hpn_pav_projected_scalar"(payload,map_json,'onePercenters'),
    'clearances',"outcome_hpn_pav_projected_scalar"(payload,map_json,'clearances'),
    'tackles',"outcome_hpn_pav_projected_scalar"(payload,map_json,'tackles'));
$$ LANGUAGE sql IMMUTABLE STRICT;

CREATE FUNCTION "outcome_hpn_pav_projected_result_completed"(
  payload JSONB,map_json JSONB
) RETURNS BOOLEAN AS $$
DECLARE completion_rule JSONB; completion_mapping JSONB; observed JSONB;
  match_date JSONB; home_points JSONB; away_points JSONB;
BEGIN
  completion_rule:=map_json#>'{content,completionRule}';
  SELECT binding->'mapping' INTO completion_mapping
    FROM jsonb_array_elements(map_json#>'{content,semanticBindings}') binding
   WHERE binding->>'semanticField'='completionStatus';
  IF completion_rule->>'kind'='source_status'
    AND completion_mapping->>'kind'='direct' THEN
    observed:="outcome_hpn_pav_scalar"(payload,completion_mapping->>'sourceField');
    RETURN COALESCE(
      jsonb_typeof(observed)='string'
      AND jsonb_typeof(completion_rule->'completedValues')='array'
      AND completion_rule->'completedValues' ? (observed#>>'{}'),FALSE);
  END IF;
  IF completion_rule->>'kind'='reviewed_final_score_presence'
    AND completion_mapping->>'kind'='reviewed_final_scores' THEN
    match_date:="outcome_hpn_pav_scalar"(
      payload,completion_mapping->>'matchDateField');
    home_points:="outcome_hpn_pav_scalar"(
      payload,completion_mapping->>'homePointsField');
    away_points:="outcome_hpn_pav_scalar"(
      payload,completion_mapping->>'awayPointsField');
    RETURN COALESCE("outcome_hpn_pav_iso_date"(match_date),FALSE)
      AND COALESCE("outcome_hpn_pav_nonnegative_integer"(home_points),FALSE)
      AND COALESCE("outcome_hpn_pav_nonnegative_integer"(away_points),FALSE);
  END IF;
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

CREATE OR REPLACE FUNCTION "validate_outcome_hpn_pav_input_set_insert"()
RETURNS TRIGGER AS $$
DECLARE schema_version TEXT;
BEGIN
  schema_version:=NEW."input_set_json"#>>'{content,schemaVersion}';
  IF NEW."status"<>'building' OR NEW."finalized_at" IS NOT NULL
    OR NEW."created_at"<>date_trunc('milliseconds',transaction_timestamp())
    OR NEW."input_set_json"->>'inputSetId'<>NEW."input_set_id"
    OR schema_version NOT IN (
      'afl-trade-hpn-pav-input-set/v1','afl-trade-hpn-pav-input-set/v2')
    OR (schema_version='afl-trade-hpn-pav-input-set/v2'
      AND NEW."environment"<>'non_production')
    OR NEW."input_set_json"#>>'{content,authorityBoundary}'<>
      'private_exact_finalized_provider_rows_current_resolutions_no_publication_or_fantasy_ownership'
    OR NEW."input_set_json"#>'{content,publicationEligible}' IS DISTINCT FROM 'false'::JSONB
    OR NEW."input_set_json"#>>'{content,environment}'<>NEW."environment"::TEXT
    OR NEW."input_set_json"#>>'{content,competition}'<>NEW."competition"
    OR (NEW."input_set_json"#>>'{content,seasonYear}')::INTEGER<>NEW."season_year"
    OR NEW."input_set_json"#>>'{content,methodId}'<>NEW."method_id"
    OR NEW."input_set_json"#>>'{content,factualUniverse,factualRunId}'<>NEW."factual_run_id"
    OR NEW."input_set_json"#>>'{content,factualUniverse,inputSetSha256}'<>
      NEW."factual_input_set_sha256"
    OR (NEW."input_set_json"#>>'{content,factualUniverse,finalizedAt}')::TIMESTAMPTZ<>
      NEW."factual_finalized_at"
    OR (NEW."input_set_json"#>>'{content,effectiveThrough}')::TIMESTAMPTZ<>
      NEW."effective_through"
    OR (NEW."input_set_json"#>>'{content,createdAt}')::TIMESTAMPTZ<>NEW."created_at" THEN
    RAISE EXCEPTION 'HPN PAV input-set envelope mismatch';
  END IF;
  IF encode(sha256(convert_to(NEW."input_set_canonical_json",'UTF8')),'hex')<>
      NEW."input_set_sha256"
    OR NEW."input_set_canonical_json"::JSONB IS DISTINCT FROM
      NEW."input_set_json"->'content' THEN
    RAISE EXCEPTION 'HPN PAV input-set canonical bytes mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "guard_outcome_hpn_pav_input_run_insert"() RETURNS TRIGGER AS $$
DECLARE parent_record RECORD; projected_record RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-hpn-pav-input:'||NEW."input_set_id",0));
  SELECT "status","environment","competition","season_year","created_at","effective_through",
         "input_set_json"
    INTO parent_record
    FROM "outcome_hpn_pav_input_set"
   WHERE "input_set_id"=NEW."input_set_id" FOR NO KEY UPDATE;
  IF NOT FOUND OR parent_record."status"<>'building' THEN
    RAISE EXCEPTION 'HPN PAV input members require an open input set';
  END IF;
  IF parent_record."input_set_json"#>>'{content,schemaVersion}'=
      'afl-trade-hpn-pav-input-set/v1' THEN
    IF NEW."field_map_id" IS NULL OR NEW."projected_field_map_id" IS NOT NULL THEN
      RAISE EXCEPTION 'Legacy HPN PAV input runs require legacy map authority';
    END IF;
    RETURN NEW;
  END IF;
  IF parent_record."input_set_json"#>>'{content,schemaVersion}'<>
      'afl-trade-hpn-pav-input-set/v2'
    OR NEW."field_map_id" IS NOT NULL OR NEW."projected_field_map_id" IS NULL THEN
    RAISE EXCEPTION 'Projected HPN PAV input runs require projected map authority';
  END IF;
  SELECT map.*,decision."decision",decision."source_use_assessment_json",
         current_decision."decision_id" AS current_decision_id
    INTO projected_record
    FROM "outcome_hpn_projected_field_map" map
    JOIN "outcome_hpn_field_map_review_decision" decision
      ON decision."decision_id"=map."approval_decision_id"
    JOIN LATERAL (
      SELECT latest."decision_id"
        FROM "outcome_hpn_field_map_review_decision" latest
       WHERE latest."candidate_id"=map."candidate_id"
       ORDER BY latest."registered_at" DESC,latest."decision_id" DESC LIMIT 1
    ) current_decision ON TRUE
   WHERE map."field_map_id"=NEW."projected_field_map_id" FOR SHARE OF map,decision;
  IF NOT FOUND OR projected_record."decision"<>'approved'
    OR NOT COALESCE(
      "outcome_hpn_projected_field_map_authority_is_exact"(
        NEW."projected_field_map_id",parent_record."created_at"
      ),FALSE
    )
    OR projected_record."current_decision_id"<>projected_record."approval_decision_id"
    OR projected_record."environment"<>parent_record."environment"
    OR projected_record."competition"<>parent_record."competition"
    OR projected_record."input_kind"<>NEW."input_kind"
    OR parent_record."season_year" NOT BETWEEN
      projected_record."valid_from_season" AND projected_record."valid_through_season"
    OR projected_record."source_use_assessment_json"#>>'{content,state}'<>
      'permitted_private_calculation'
    OR NOT (parent_record."input_set_json"#>'{content,fieldMaps}' @>
      jsonb_build_array(projected_record."map_json"))
    OR NOT EXISTS (
      SELECT 1
        FROM "outcome_provider_normalization_run" run
        JOIN "outcome_provider_field_map" decode_map
          ON decode_map."field_map_id"=run."field_map_id"
        JOIN "outcome_source_capture" capture ON capture."capture_id"=run."capture_id"
       WHERE run."normalization_run_id"=NEW."normalization_run_id"
         AND run."status"='staged' AND run."finalized_at" IS NOT NULL
         AND run."source_row_count"=run."accepted_row_count"
         AND run."quarantined_row_count"=0 AND run."issue_count"=0
         AND capture."environment"=parent_record."environment"
         AND capture."provider"=projected_record."provider"
         AND capture."capability_id"=projected_record."capability_id"
         AND decode_map."capability_id"=projected_record."capability_id"
         AND decode_map."source_schema_sha256"=projected_record."source_schema_sha256"
         AND run."field_map_id"=
           (SELECT candidate."candidate_json"#>>'{content,providerDecodeMapId}'
              FROM "outcome_hpn_field_map_candidate" candidate
             WHERE candidate."candidate_id"=projected_record."candidate_id")
         AND projected_record."source_use_assessment_json"#>>'{content,rightsArtifactId}'=
           capture."manifest_json"#>>'{gate0aReceipt,content,request,rightsArtifactId}'
         AND run."finalized_at"<=parent_record."created_at"
         AND capture."captured_at"<=parent_record."effective_through"
         AND EXISTS (
           SELECT 1 FROM "outcome_source_capture_season" scope
            WHERE scope."capture_id"=capture."capture_id"
              AND scope."competition"=parent_record."competition"
              AND scope."season_year"=parent_record."season_year")
    ) THEN
    RAISE EXCEPTION 'Projected HPN PAV input run lacks exact current source authority';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER "outcome_hpn_pav_input_run_insert_guard"
  ON "outcome_hpn_pav_input_run";
CREATE TRIGGER "outcome_hpn_pav_input_run_insert_guard"
  BEFORE INSERT ON "outcome_hpn_pav_input_run"
  FOR EACH ROW EXECUTE FUNCTION "guard_outcome_hpn_pav_input_run_insert"();

CREATE FUNCTION "finalize_outcome_hpn_pav_input_set_v2"() RETURNS TRIGGER AS $$
DECLARE actual_runs INTEGER; actual_rows INTEGER; actual_matches INTEGER;
  actual_results INTEGER; actual_primary INTEGER; actual_corroborating INTEGER;
  actual_factual_matches INTEGER; actual_factual_appearances INTEGER;
  json_factual_matches INTEGER; json_factual_appearances INTEGER; eligible_spell_count INTEGER;
  lock_subject TEXT; row_record RECORD;
BEGIN
  IF OLD."status"<>'building' OR NEW."status"<>'finalized' OR OLD."finalized_at" IS NOT NULL
    OR NEW."finalized_at" IS NULL OR NEW."finalized_at"<>NEW."created_at"
    OR (to_jsonb(NEW)-'status'-'finalized_at') IS DISTINCT FROM
       (to_jsonb(OLD)-'status'-'finalized_at') THEN
    RAISE EXCEPTION 'HPN PAV input sets permit only one exact finalization transition';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-hpn-pav-input:'||NEW."input_set_id",0));
  IF NEW."input_set_json"#>>'{content,schemaVersion}'<>'afl-trade-hpn-pav-input-set/v2'
    OR NEW."environment"<>'non_production' THEN
    RAISE EXCEPTION 'Projected HPN PAV finalization requires the v2 non-production contract';
  END IF;
  FOR lock_subject IN
    SELECT DISTINCT map."candidate_id"
      FROM "outcome_hpn_pav_input_run" member
      JOIN "outcome_hpn_projected_field_map" map
        ON map."field_map_id"=member."projected_field_map_id"
     WHERE member."input_set_id"=NEW."input_set_id"
     ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'hpn-field-map-candidate:'||lock_subject,0));
  END LOOP;

  FOR lock_subject IN
    SELECT DISTINCT decision."subject_type"||':'||decision."subject_id"
    FROM "outcome_review_decision" decision
    WHERE decision."decision_id" IN (
      SELECT map."approval_decision_id" FROM "outcome_hpn_pav_input_run" member
       JOIN "outcome_hpn_projected_field_map" map ON map."field_map_id"=member."projected_field_map_id"
       WHERE member."input_set_id"=NEW."input_set_id"
      UNION
      SELECT policy."approval_decision_id"
        FROM "outcome_factual_reconciliation_run" factual_run
        JOIN "outcome_factual_reconciliation_policy" policy
          ON policy."policy_id"=factual_run."policy_id"
       WHERE factual_run."factual_run_id"=NEW."factual_run_id"
      UNION
      SELECT value FROM "outcome_hpn_pav_input_row" member
       CROSS JOIN LATERAL jsonb_array_elements_text(jsonb_build_array(
         member."row_json"#>>'{player,resolutionDecision,id}',
         member."row_json"#>>'{club,resolutionDecision,id}',
         member."row_json"#>>'{match,resolutionDecision,id}',
         member."row_json"#>>'{homeClub,resolutionDecision,id}',
         member."row_json"#>>'{awayClub,resolutionDecision,id}'
       )) ids(value)
       WHERE member."input_set_id"=NEW."input_set_id" AND value IS NOT NULL
    )
    ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('outcome-review-subject:'||lock_subject,0));
  END LOOP;
  FOR lock_subject IN
    SELECT DISTINCT (member."row_json"#>>'{player,canonicalId}')||':'||
      (member."row_json"#>>'{club,canonicalId}')
      FROM "outcome_hpn_pav_input_row" member
     WHERE member."input_set_id"=NEW."input_set_id"
       AND member."row_kind"='player_match_stats'
     ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended('outcome-acquisition-spell-scope:'||lock_subject,0));
  END LOOP;
  FOR lock_subject IN
    SELECT DISTINCT member."row_json"#>>'{acquisitionSpell,spellId}'
      FROM "outcome_hpn_pav_input_row" member
     WHERE member."input_set_id"=NEW."input_set_id"
       AND member."row_kind"='player_match_stats'
     ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('outcome-acquisition-spell:'||lock_subject,0));
  END LOOP;

  SELECT count(*) INTO actual_runs FROM "outcome_hpn_pav_input_run"
   WHERE "input_set_id"=NEW."input_set_id";
  SELECT count(*),count(*) FILTER (WHERE "row_kind"='completed_match_result'),
    count(*) FILTER (WHERE "row_kind"='player_match_stats' AND "role"='primary'),
    count(*) FILTER (WHERE "row_kind"='player_match_stats' AND "role"='corroborating')
    INTO actual_rows,actual_results,actual_primary,actual_corroborating
    FROM "outcome_hpn_pav_input_row" WHERE "input_set_id"=NEW."input_set_id";
  SELECT count(*) INTO actual_matches FROM "outcome_hpn_pav_input_match"
   WHERE "input_set_id"=NEW."input_set_id";
  SELECT count(*) INTO actual_factual_matches
    FROM "outcome_hpn_pav_input_factual_match_member"
   WHERE "input_set_id"=NEW."input_set_id";
  SELECT count(*) INTO actual_factual_appearances
    FROM "outcome_hpn_pav_input_factual_appearance_member"
   WHERE "input_set_id"=NEW."input_set_id";
  SELECT COALESCE(sum(jsonb_array_length(value->'factIds')),0)::INTEGER
    INTO json_factual_matches
    FROM jsonb_array_elements(
      NEW."input_set_json"#>'{content,factualUniverse,completedMatchFacts}') value;
  SELECT COALESCE(sum(jsonb_array_length(value->'factIds')),0)::INTEGER
    INTO json_factual_appearances
    FROM jsonb_array_elements(
      NEW."input_set_json"#>'{content,factualUniverse,playerAppearanceFacts}') value;
  IF actual_runs<>NEW."source_run_count" OR actual_rows<>NEW."source_row_count"
    OR actual_matches<>NEW."completed_match_count" OR actual_results<>NEW."result_row_count"
    OR actual_primary<>NEW."primary_player_row_count"
    OR actual_corroborating<>NEW."corroborating_player_row_count"
    OR jsonb_array_length(NEW."input_set_json"#>'{content,fieldMaps}')<>actual_runs
    OR jsonb_array_length(NEW."input_set_json"#>'{content,sourceRuns}')<>actual_runs
    OR jsonb_array_length(NEW."input_set_json"#>'{content,rows}')<>actual_rows
    OR jsonb_array_length(NEW."input_set_json"#>'{content,completedMatches}')<>actual_matches
    OR actual_factual_matches=0 OR actual_factual_appearances=0
    OR actual_factual_matches<>json_factual_matches
    OR actual_factual_appearances<>json_factual_appearances THEN
    RAISE EXCEPTION 'HPN PAV input counts do not match durable membership';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM "outcome_factual_reconciliation_run" factual_run
      JOIN "outcome_factual_reconciliation_policy" policy
        ON policy."policy_id"=factual_run."policy_id"
      JOIN "outcome_review_decision" decision
        ON decision."decision_id"=policy."approval_decision_id"
     WHERE factual_run."factual_run_id"=NEW."factual_run_id"
       AND factual_run."input_set_sha256"=NEW."factual_input_set_sha256"
       AND factual_run."environment"=NEW."environment"
       AND factual_run."competition"=NEW."competition"
       AND factual_run."season_year"=NEW."season_year"
       AND factual_run."status"='approved' AND factual_run."conflict_count"=0
       AND factual_run."finalized_at"=NEW."factual_finalized_at"
       AND factual_run."finalized_at"<=NEW."created_at"
       AND policy."status"='approved'
       AND NEW."input_set_json"#>>'{content,factualUniverse,policyId}'=policy."policy_id"
       AND NEW."input_set_json"#>>'{content,factualUniverse,status}'='approved'
       AND decision."decision"='approved'
       AND NOT EXISTS (SELECT 1 FROM "outcome_review_decision" successor
         WHERE successor."supersedes_decision_id"=decision."decision_id")
  ) THEN
    RAISE EXCEPTION 'HPN PAV factual universe is not an exact current approved finalization';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM "outcome_hpn_pav_input_factual_match_member" member
      JOIN "outcome_provider_match_universe_fact" fact ON fact."match_fact_id"=member."fact_id"
      LEFT JOIN "outcome_factual_reconciliation_match_input" factual_input
        ON factual_input."factual_run_id"=NEW."factual_run_id"
       AND factual_input."match_fact_id"=member."fact_id"
      LEFT JOIN LATERAL (
        SELECT value FROM jsonb_array_elements(
          NEW."input_set_json"#>'{content,factualUniverse,completedMatchFacts}') value
         WHERE value->'factIds' ? member."fact_id"
      ) envelope ON TRUE
     WHERE member."input_set_id"=NEW."input_set_id" AND (
       factual_input."match_fact_id" IS NULL OR fact."availability"<>'measured'
       OR fact."completion_state"<>'completed' OR fact."competition"<>NEW."competition"
       OR fact."season_year"<>NEW."season_year" OR envelope.value IS NULL
       OR envelope.value->>'matchId'<>fact."match_id"
       OR (envelope.value->>'effectiveAt')::TIMESTAMPTZ<>fact."effective_at"
       OR envelope.value->>'homeClubId'<>fact."fact_json"#>>'{content,match,homeClub,clubId}'
       OR envelope.value->>'awayClubId'<>fact."fact_json"#>>'{content,match,awayClub,clubId}'
     )
  ) OR EXISTS (
    SELECT 1 FROM "outcome_factual_reconciliation_match_input" factual_input
    JOIN "outcome_provider_match_universe_fact" fact
      ON fact."match_fact_id"=factual_input."match_fact_id"
    LEFT JOIN "outcome_hpn_pav_input_factual_match_member" member
      ON member."input_set_id"=NEW."input_set_id" AND member."fact_id"=fact."match_fact_id"
    WHERE factual_input."factual_run_id"=NEW."factual_run_id"
      AND fact."availability"='measured' AND fact."completion_state"='completed'
      AND member."fact_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'HPN PAV completed-match facts do not equal the approved factual universe';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM "outcome_hpn_pav_input_factual_appearance_member" member
      JOIN "outcome_provider_player_appearance_fact" fact
        ON fact."appearance_fact_id"=member."fact_id"
      LEFT JOIN "outcome_factual_reconciliation_appearance_input" factual_input
        ON factual_input."factual_run_id"=NEW."factual_run_id"
       AND factual_input."appearance_fact_id"=member."fact_id"
      LEFT JOIN LATERAL (
        SELECT value FROM jsonb_array_elements(
          NEW."input_set_json"#>'{content,factualUniverse,playerAppearanceFacts}') value
         WHERE value->'factIds' ? member."fact_id"
      ) envelope ON TRUE
     WHERE member."input_set_id"=NEW."input_set_id" AND (
       factual_input."appearance_fact_id" IS NULL OR fact."availability"<>'measured'
       OR fact."appeared" IS DISTINCT FROM TRUE OR fact."competition"<>NEW."competition"
       OR fact."season_year"<>NEW."season_year" OR envelope.value IS NULL
       OR envelope.value->>'matchId'<>fact."match_id"
       OR envelope.value->>'playerId'<>fact."player_id"
       OR envelope.value->>'clubId'<>fact."represented_club_id"
     )
  ) OR EXISTS (
    SELECT 1 FROM "outcome_factual_reconciliation_appearance_input" factual_input
    JOIN "outcome_provider_player_appearance_fact" fact
      ON fact."appearance_fact_id"=factual_input."appearance_fact_id"
    LEFT JOIN "outcome_hpn_pav_input_factual_appearance_member" member
      ON member."input_set_id"=NEW."input_set_id"
     AND member."fact_id"=fact."appearance_fact_id"
    WHERE factual_input."factual_run_id"=NEW."factual_run_id"
      AND fact."availability"='measured' AND fact."appeared"=TRUE
      AND member."fact_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'HPN PAV appearance facts do not equal the approved factual universe';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "outcome_hpn_pav_input_run" member
    JOIN "outcome_provider_normalization_run" run
      ON run."normalization_run_id"=member."normalization_run_id"
    JOIN "outcome_provider_field_map" decode_map ON decode_map."field_map_id"=run."field_map_id"
    JOIN "outcome_source_capture" capture ON capture."capture_id"=run."capture_id"
    JOIN "outcome_hpn_projected_field_map" map ON map."field_map_id"=member."projected_field_map_id"
    JOIN "outcome_hpn_field_map_review_decision" decision
      ON decision."decision_id"=map."approval_decision_id"
    LEFT JOIN LATERAL (
      SELECT value FROM jsonb_array_elements(NEW."input_set_json"#>'{content,sourceRuns}') value
       WHERE value->>'normalizationRunId'=member."normalization_run_id"
    ) source_json ON TRUE
    WHERE member."input_set_id"=NEW."input_set_id" AND (
      run."status"<>'staged' OR run."finalized_at" IS NULL
      OR run."source_row_count"<>run."accepted_row_count" OR run."quarantined_row_count"<>0
      OR run."issue_count"<>0 OR capture."environment"<>NEW."environment"
      OR capture."provider" IS DISTINCT FROM map."provider"
      OR capture."capability_id" IS DISTINCT FROM map."capability_id"
      OR decode_map."capability_id"<>map."capability_id"
      OR decode_map."source_schema_sha256"<>map."source_schema_sha256"
      OR run."field_map_id" IS DISTINCT FROM (
        SELECT candidate."candidate_json"#>>'{content,providerDecodeMapId}'
          FROM "outcome_hpn_field_map_candidate" candidate
         WHERE candidate."candidate_id"=map."candidate_id")
      OR map."environment"<>NEW."environment" OR map."competition"<>NEW."competition"
      OR NOT COALESCE(
        "outcome_hpn_projected_field_map_authority_is_exact"(
          map."field_map_id",clock_timestamp()),FALSE
      )
      OR map."input_kind"<>member."input_kind" OR NEW."season_year" NOT BETWEEN
        map."valid_from_season" AND map."valid_through_season"
      OR NOT (NEW."input_set_json"#>'{content,fieldMaps}' @> jsonb_build_array(map."map_json"))
      OR source_json.value IS NULL
      OR source_json.value->>'captureId'<>run."capture_id"
      OR source_json.value->>'sourceSnapshotId'<>capture."source_snapshot_id"
      OR source_json.value->>'sourceArtifactId'<>capture."source_artifact_id"
      OR source_json.value->>'provider'<>map."provider"
      OR source_json.value->>'capabilityId'<>map."capability_id"
      OR source_json.value->>'fieldMapId'<>map."field_map_id"
      OR source_json.value->>'competition'<>NEW."competition"
      OR (source_json.value->>'seasonYear')::INTEGER<>NEW."season_year"
      OR source_json.value->>'stagingSha256'<>run."staging_sha256"
      OR (source_json.value->>'sourceRowCount')::INTEGER<>run."source_row_count"
      OR (source_json.value->>'acceptedRowCount')::INTEGER<>run."accepted_row_count"
      OR (source_json.value->>'issueCount')::INTEGER<>run."issue_count"
      OR source_json.value->>'status'<>run."status"::TEXT
      OR (source_json.value->>'capturedAt')::TIMESTAMPTZ<>capture."captured_at"
      OR (source_json.value->>'finalizedAt')::TIMESTAMPTZ<>run."finalized_at"
      OR decision."decision"<>'approved'
      OR decision."decision_id" IS DISTINCT FROM (
        SELECT latest."decision_id"
          FROM "outcome_hpn_field_map_review_decision" latest
         WHERE latest."candidate_id"=map."candidate_id"
         ORDER BY latest."registered_at" DESC,latest."decision_id" DESC LIMIT 1)
      OR decision."source_use_assessment_json"#>>'{content,state}'<>
        'permitted_private_calculation'
      OR decision."source_use_assessment_json"#>>'{content,rightsArtifactId}'<>
        capture."manifest_json"#>>'{gate0aReceipt,content,request,rightsArtifactId}'
      OR NOT EXISTS (SELECT 1 FROM "outcome_source_capture_season" scope
        WHERE scope."capture_id"=capture."capture_id" AND scope."competition"=NEW."competition"
          AND scope."season_year"=NEW."season_year")
      OR run."finalized_at">NEW."created_at" OR capture."captured_at">NEW."effective_through"
    )
  ) THEN RAISE EXCEPTION 'HPN PAV source run is incomplete, stale, or outside reviewed scope'; END IF;

  IF EXISTS (
    SELECT 1 FROM "outcome_hpn_pav_input_run" run_member
    JOIN "outcome_provider_decoded_row" decoded
      ON decoded."normalization_run_id"=run_member."normalization_run_id"
    LEFT JOIN "outcome_hpn_pav_input_row" row_member
      ON row_member."input_set_id"=run_member."input_set_id"
      AND row_member."provider_decoded_row_id"=decoded."provider_decoded_row_id"
    WHERE run_member."input_set_id"=NEW."input_set_id"
      AND (row_member."provider_decoded_row_id" IS NULL OR decoded."row_status"<>'staged'
        OR decoded."competition"<>NEW."competition" OR decoded."season_year"<>NEW."season_year")
  ) OR EXISTS (
    SELECT 1 FROM "outcome_hpn_pav_input_row" row_member
    JOIN "outcome_provider_decoded_row" decoded
      ON decoded."provider_decoded_row_id"=row_member."provider_decoded_row_id"
    WHERE row_member."input_set_id"=NEW."input_set_id" AND (
      decoded."normalization_run_id"<>row_member."normalization_run_id"
      OR decoded."source_row_sha256"<>row_member."source_row_sha256"
      OR row_member."row_json"#>>'{source,normalizationRunId}'<>row_member."normalization_run_id"
      OR row_member."row_json"#>>'{source,providerDecodedRowId}'<>
        row_member."provider_decoded_row_id"
      OR row_member."row_json"#>>'{source,sourceRowSha256}'<>row_member."source_row_sha256"
      OR row_member."row_json"#>>'{source,typedPayloadSha256}'<>
        row_member."typed_payload_sha256"
      OR row_member."row_json"->>'kind'<>row_member."row_kind"
      OR row_member."row_json"->>'role' IS DISTINCT FROM row_member."role"
      OR encode(sha256(convert_to(row_member."row_canonical_json",'UTF8')),'hex')<>
        row_member."row_sha256"
      OR row_member."row_canonical_json"::JSONB IS DISTINCT FROM row_member."row_json"
      OR NOT (NEW."input_set_json"#>'{content,rows}' @> jsonb_build_array(row_member."row_json"))
    )
  ) THEN RAISE EXCEPTION 'HPN PAV rows do not exactly conserve finalized decoded rows'; END IF;

  IF EXISTS (
    SELECT 1 FROM "outcome_hpn_pav_input_row" row_member
    JOIN "outcome_provider_decoded_row" decoded
      ON decoded."provider_decoded_row_id"=row_member."provider_decoded_row_id"
    JOIN "outcome_hpn_pav_input_run" run_member
      ON run_member."input_set_id"=row_member."input_set_id"
     AND run_member."normalization_run_id"=row_member."normalization_run_id"
    JOIN "outcome_hpn_projected_field_map" map ON map."field_map_id"=run_member."projected_field_map_id"
    CROSS JOIN LATERAL (
      SELECT COALESCE(jsonb_agg(field ORDER BY field COLLATE "C"),'[]'::JSONB) fields
      FROM jsonb_object_keys(row_member."row_json"#>'{source,sourceValues}') field
    ) source_keys
    WHERE row_member."input_set_id"=NEW."input_set_id" AND (
      row_member."typed_payload_sha256"<>
        encode(sha256(convert_to("outcome_hpn_pav_canonical_json"(decoded."typed_payload"),'UTF8')),'hex')
      OR row_member."row_json"#>'{source,sourceFields}' IS DISTINCT FROM
        "outcome_hpn_pav_projected_reviewed_fields"(map."map_json")
      OR source_keys.fields IS DISTINCT FROM "outcome_hpn_pav_projected_reviewed_fields"(map."map_json")
      OR EXISTS (
        SELECT 1
        FROM jsonb_each(row_member."row_json"#>'{source,sourceValues}') value
        WHERE "outcome_hpn_pav_scalar"(decoded."typed_payload",value.key)
          IS DISTINCT FROM value.value
      )
      OR (row_member."row_kind"='player_match_stats' AND (
        map."input_kind"<>'player_match_stats'
        OR row_member."row_json"->'stats' IS DISTINCT FROM
          "outcome_hpn_pav_projected_expected_player_stats"(decoded."typed_payload",map."map_json")
        OR EXISTS (
          SELECT 1 FROM jsonb_each(row_member."row_json"->'stats') stat
           WHERE NOT COALESCE("outcome_hpn_pav_nonnegative_integer"(stat.value),FALSE)
        )
      ))
      OR (row_member."row_kind"='completed_match_result' AND (
        map."input_kind"<>'completed_match_result'
        OR row_member."row_json"->'homePoints' IS DISTINCT FROM
          "outcome_hpn_pav_projected_scalar"(
            decoded."typed_payload",map."map_json",'homePoints')
        OR row_member."row_json"->'awayPoints' IS DISTINCT FROM
          "outcome_hpn_pav_projected_scalar"(
            decoded."typed_payload",map."map_json",'awayPoints')
        OR row_member."row_json"->>'completionStatus'<>'completed'
        OR "outcome_hpn_pav_projected_result_completed"(
          decoded."typed_payload",map."map_json") IS DISTINCT FROM TRUE
      ))
    )
  ) THEN
    RAISE EXCEPTION 'HPN PAV rows differ from reviewed immutable typed payloads';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "outcome_hpn_pav_input_row" row_member
    JOIN "outcome_hpn_pav_input_run" run_member
      ON run_member."input_set_id"=row_member."input_set_id"
      AND run_member."normalization_run_id"=row_member."normalization_run_id"
    JOIN "outcome_hpn_projected_field_map" map ON map."field_map_id"=run_member."projected_field_map_id"
    LEFT JOIN "outcome_provider_match_candidate" match_candidate
      ON match_candidate."provider_decoded_row_id"=row_member."provider_decoded_row_id"
    LEFT JOIN "outcome_provider_identity_candidate" identity_candidate
      ON identity_candidate."provider_decoded_row_id"=row_member."provider_decoded_row_id"
    WHERE row_member."input_set_id"=NEW."input_set_id" AND (
      match_candidate."provider" IS DISTINCT FROM map."provider"
      OR (row_member."row_kind"='player_match_stats'
        AND identity_candidate."provider" IS DISTINCT FROM map."provider")
    )
  ) THEN RAISE EXCEPTION 'HPN PAV decoded-row provider differs from its reviewed map'; END IF;

  FOR row_record IN SELECT * FROM "outcome_hpn_pav_input_row"
    WHERE "input_set_id"=NEW."input_set_id"
  LOOP
    IF row_record."row_kind"='completed_match_result' THEN
      IF NOT "outcome_hpn_pav_match_resolution_current"(
          row_record."provider_decoded_row_id",row_record."row_json"->'match')
        OR NOT "outcome_hpn_pav_club_resolution_current"(
          row_record."provider_decoded_row_id",row_record."row_json"->'homeClub','home')
        OR NOT "outcome_hpn_pav_club_resolution_current"(
          row_record."provider_decoded_row_id",row_record."row_json"->'awayClub','away') THEN
        RAISE EXCEPTION 'HPN PAV completed-match resolution is not current';
      END IF;
    ELSE
      IF NOT "outcome_hpn_pav_player_resolution_current"(
          row_record."provider_decoded_row_id",row_record."row_json"->'player')
        OR NOT "outcome_hpn_pav_match_resolution_current"(
          row_record."provider_decoded_row_id",row_record."row_json"->'match')
        OR NOT (
          "outcome_hpn_pav_club_resolution_current"(
            row_record."provider_decoded_row_id",row_record."row_json"->'club','home')
          OR "outcome_hpn_pav_club_resolution_current"(
            row_record."provider_decoded_row_id",row_record."row_json"->'club','away')
        ) THEN
        RAISE EXCEPTION 'HPN PAV player, match, or represented-club resolution is not current';
      END IF;
      SELECT count(*) INTO eligible_spell_count
        FROM "outcome_acquisition_spell_version" eligible
        JOIN "outcome_hpn_pav_input_match" eligible_match
          ON eligible_match."input_set_id"=row_record."input_set_id"
         AND eligible_match."match_id"=row_record."row_json"#>>'{match,canonicalId}'
        JOIN "outcome_event_asset" eligible_asset
          ON eligible_asset."asset_version_id"=eligible."start_asset_version_id"
        JOIN "outcome_acquisition_spell_rule" eligible_rule
          ON eligible_rule."rule_id"=eligible."rule_id"
       WHERE eligible."player_id"=row_record."row_json"#>>'{player,canonicalId}'
         AND eligible."club_id"=row_record."row_json"#>>'{club,canonicalId}'
         AND eligible."status"='approved'
         AND eligible."recorded_at"<=NEW."created_at"
         AND eligible."start_date"<=eligible_match."effective_at"::DATE
         AND (eligible."end_date" IS NULL
           OR eligible."end_date">=eligible_match."effective_at"::DATE)
         AND eligible_asset."event_version_id"=eligible."start_event_version_id"
         AND eligible_asset."kind"='player'::"OutcomeAssetKind"
         AND eligible_asset."player_id"=eligible."player_id"
         AND eligible_asset."to_club_id"=eligible."club_id"
         AND eligible_asset."status"='approved'::"OutcomeRecordStatus"
         AND eligible_rule."status"='approved'::"OutcomeRecordStatus"
         AND NOT EXISTS (SELECT 1 FROM "outcome_acquisition_spell_version" successor
           WHERE successor."supersedes_spell_version_id"=eligible."spell_version_id");
      IF eligible_spell_count<>1 OR NOT EXISTS (
        SELECT 1
          FROM "outcome_acquisition_spell_version" spell
          JOIN "outcome_hpn_pav_input_match" match_member
            ON match_member."input_set_id"=row_record."input_set_id"
           AND match_member."match_id"=row_record."row_json"#>>'{match,canonicalId}'
         WHERE spell."spell_version_id"=
             row_record."row_json"#>>'{acquisitionSpell,spellVersionId}'
           AND spell."spell_id"=row_record."row_json"#>>'{acquisitionSpell,spellId}'
           AND spell."version"=
             (row_record."row_json"#>>'{acquisitionSpell,version}')::INTEGER
           AND spell."player_id"=row_record."row_json"#>>'{player,canonicalId}'
           AND spell."player_id"=row_record."row_json"#>>'{acquisitionSpell,playerId}'
           AND spell."club_id"=row_record."row_json"#>>'{club,canonicalId}'
           AND spell."club_id"=row_record."row_json"#>>'{acquisitionSpell,clubId}'
           AND spell."start_event_version_id"=
             row_record."row_json"#>>'{acquisitionSpell,startEventVersionId}'
           AND spell."start_asset_version_id"=
             row_record."row_json"#>>'{acquisitionSpell,startAssetVersionId}'
           AND spell."start_date"=
             (row_record."row_json"#>>'{acquisitionSpell,startDate}')::DATE
           AND spell."end_date" IS NOT DISTINCT FROM
             (row_record."row_json"#>>'{acquisitionSpell,endDate}')::DATE
           AND spell."end_reason" IS NOT DISTINCT FROM
             row_record."row_json"#>>'{acquisitionSpell,endReason}'
           AND spell."rule_id"=row_record."row_json"#>>'{acquisitionSpell,ruleId}'
           AND spell."status"='approved'
           AND row_record."row_json"#>>'{acquisitionSpell,status}'='approved'
           AND spell."supersedes_spell_version_id" IS NOT DISTINCT FROM
             row_record."row_json"#>>'{acquisitionSpell,supersedesSpellVersionId}'
           AND spell."recorded_at"=
             (row_record."row_json"#>>'{acquisitionSpell,recordedAt}')::TIMESTAMPTZ
           AND spell."recorded_at"<=NEW."created_at"
           AND spell."start_date"<=match_member."effective_at"::DATE
           AND (spell."end_date" IS NULL OR spell."end_date">=match_member."effective_at"::DATE)
           AND EXISTS (
             SELECT 1 FROM "outcome_event_asset" asset
             JOIN "outcome_acquisition_spell_rule" rule ON rule."rule_id"=spell."rule_id"
             WHERE asset."asset_version_id"=spell."start_asset_version_id"
               AND asset."event_version_id"=spell."start_event_version_id"
               AND asset."kind"='player'::"OutcomeAssetKind"
               AND asset."player_id"=spell."player_id"
               AND asset."to_club_id"=spell."club_id"
               AND asset."status"='approved'::"OutcomeRecordStatus"
               AND rule."status"='approved'::"OutcomeRecordStatus"
           )
           AND NOT EXISTS (SELECT 1 FROM "outcome_acquisition_spell_version" successor
             WHERE successor."supersedes_spell_version_id"=spell."spell_version_id")
         FOR SHARE OF spell
      ) THEN
        RAISE EXCEPTION 'HPN PAV player row acquisition spell is not exact and current';
      END IF;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM "outcome_hpn_pav_input_match" member
    JOIN "outcome_match" match ON match."match_id"=member."match_id"
    JOIN "outcome_hpn_pav_input_row" result
      ON result."input_set_id"=member."input_set_id"
      AND result."provider_decoded_row_id"=member."result_provider_decoded_row_id"
    WHERE member."input_set_id"=NEW."input_set_id" AND (
      match."competition"<>NEW."competition" OR match."season_year"<>NEW."season_year"
      OR match."home_club_id"<>member."home_club_id"
      OR match."away_club_id"<>member."away_club_id"
      OR result."row_json"#>>'{match,canonicalId}'<>member."match_id"
      OR result."row_json"#>>'{homeClub,canonicalId}'<>member."home_club_id"
      OR result."row_json"#>>'{awayClub,canonicalId}'<>member."away_club_id"
      OR (result."row_json"->>'effectiveAt')::TIMESTAMPTZ<>member."effective_at"
      OR encode(sha256(convert_to(member."match_canonical_json",'UTF8')),'hex')<>member."match_sha256"
      OR member."match_canonical_json"::JSONB IS DISTINCT FROM jsonb_build_object(
        'matchId',member."match_id",'effectiveAt',to_char(member."effective_at" AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'homeClubId',member."home_club_id",
        'awayClubId',member."away_club_id")
      OR NOT (NEW."input_set_json"#>'{content,completedMatches}' @>
        jsonb_build_array(jsonb_build_object('matchId',member."match_id",
          'effectiveAt',to_char(member."effective_at" AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'homeClubId',member."home_club_id",'awayClubId',member."away_club_id")))
    )
  ) THEN RAISE EXCEPTION 'HPN PAV completed-match membership mismatch'; END IF;

  IF EXISTS (
    (SELECT member."match_id",member."effective_at",member."home_club_id",member."away_club_id"
       FROM "outcome_hpn_pav_input_match" member
      WHERE member."input_set_id"=NEW."input_set_id"
     EXCEPT
     SELECT DISTINCT fact."match_id",fact."effective_at",
       fact."fact_json"#>>'{content,match,homeClub,clubId}',
       fact."fact_json"#>>'{content,match,awayClub,clubId}'
       FROM "outcome_hpn_pav_input_factual_match_member" factual_member
       JOIN "outcome_provider_match_universe_fact" fact
         ON fact."match_fact_id"=factual_member."fact_id"
      WHERE factual_member."input_set_id"=NEW."input_set_id")
    UNION ALL
    (SELECT DISTINCT fact."match_id",fact."effective_at",
       fact."fact_json"#>>'{content,match,homeClub,clubId}',
       fact."fact_json"#>>'{content,match,awayClub,clubId}'
       FROM "outcome_hpn_pav_input_factual_match_member" factual_member
       JOIN "outcome_provider_match_universe_fact" fact
         ON fact."match_fact_id"=factual_member."fact_id"
      WHERE factual_member."input_set_id"=NEW."input_set_id"
     EXCEPT
     SELECT member."match_id",member."effective_at",member."home_club_id",member."away_club_id"
       FROM "outcome_hpn_pav_input_match" member
      WHERE member."input_set_id"=NEW."input_set_id")
  ) THEN
    RAISE EXCEPTION 'HPN PAV match set differs from the factual completed-match universe';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "outcome_hpn_pav_input_match" match_member
    CROSS JOIN LATERAL (VALUES (match_member."home_club_id"),(match_member."away_club_id"))
      club("club_id")
    WHERE match_member."input_set_id"=NEW."input_set_id" AND (
      EXISTS (
        (SELECT DISTINCT fact."player_id"
           FROM "outcome_hpn_pav_input_factual_appearance_member" factual_member
           JOIN "outcome_provider_player_appearance_fact" fact
             ON fact."appearance_fact_id"=factual_member."fact_id"
          WHERE factual_member."input_set_id"=NEW."input_set_id"
            AND fact."match_id"=match_member."match_id"
            AND fact."represented_club_id"=club."club_id"
         EXCEPT
         SELECT row_member."row_json"#>>'{player,canonicalId}'
           FROM "outcome_hpn_pav_input_row" row_member
          WHERE row_member."input_set_id"=NEW."input_set_id"
            AND row_member."row_kind"='player_match_stats' AND row_member."role"='primary'
            AND row_member."row_json"#>>'{match,canonicalId}'=match_member."match_id"
            AND row_member."row_json"#>>'{club,canonicalId}'=club."club_id")
        UNION ALL
        (SELECT row_member."row_json"#>>'{player,canonicalId}'
           FROM "outcome_hpn_pav_input_row" row_member
          WHERE row_member."input_set_id"=NEW."input_set_id"
            AND row_member."row_kind"='player_match_stats' AND row_member."role"='primary'
            AND row_member."row_json"#>>'{match,canonicalId}'=match_member."match_id"
            AND row_member."row_json"#>>'{club,canonicalId}'=club."club_id"
         EXCEPT
         SELECT DISTINCT fact."player_id"
           FROM "outcome_hpn_pav_input_factual_appearance_member" factual_member
           JOIN "outcome_provider_player_appearance_fact" fact
             ON fact."appearance_fact_id"=factual_member."fact_id"
          WHERE factual_member."input_set_id"=NEW."input_set_id"
            AND fact."match_id"=match_member."match_id"
            AND fact."represented_club_id"=club."club_id")
      )
      OR
      (SELECT count(*) FROM "outcome_hpn_pav_input_row" row_member
        WHERE row_member."input_set_id"=NEW."input_set_id"
          AND row_member."row_kind"='player_match_stats' AND row_member."role"='primary'
          AND row_member."row_json"#>>'{match,canonicalId}'=match_member."match_id"
          AND row_member."row_json"#>>'{club,canonicalId}'=club."club_id")=0
      OR (SELECT count(*) FROM "outcome_hpn_pav_input_row" row_member
        WHERE row_member."input_set_id"=NEW."input_set_id"
          AND row_member."row_kind"='player_match_stats' AND row_member."role"='primary'
          AND row_member."row_json"#>>'{match,canonicalId}'=match_member."match_id"
          AND row_member."row_json"#>>'{club,canonicalId}'=club."club_id")
        <> (SELECT count(DISTINCT row_member."row_json"#>>'{player,canonicalId}')
          FROM "outcome_hpn_pav_input_row" row_member
          WHERE row_member."input_set_id"=NEW."input_set_id"
            AND row_member."row_kind"='player_match_stats' AND row_member."role"='primary'
            AND row_member."row_json"#>>'{match,canonicalId}'=match_member."match_id"
            AND row_member."row_json"#>>'{club,canonicalId}'=club."club_id")
      OR (SELECT count(DISTINCT map."provider")
        FROM "outcome_hpn_pav_input_row" row_member
        JOIN "outcome_hpn_pav_input_run" run_member
          ON run_member."input_set_id"=row_member."input_set_id"
          AND run_member."normalization_run_id"=row_member."normalization_run_id"
        JOIN "outcome_hpn_projected_field_map" map ON map."field_map_id"=run_member."projected_field_map_id"
        WHERE row_member."input_set_id"=NEW."input_set_id"
          AND row_member."row_kind"='player_match_stats' AND row_member."role"='primary'
          AND row_member."row_json"#>>'{match,canonicalId}'=match_member."match_id"
          AND row_member."row_json"#>>'{club,canonicalId}'=club."club_id")<>1
      OR (SELECT count(DISTINCT map."provider")
        FROM "outcome_hpn_pav_input_row" row_member
        JOIN "outcome_hpn_pav_input_run" run_member
          ON run_member."input_set_id"=row_member."input_set_id"
          AND run_member."normalization_run_id"=row_member."normalization_run_id"
        JOIN "outcome_hpn_projected_field_map" map ON map."field_map_id"=run_member."projected_field_map_id"
        WHERE row_member."input_set_id"=NEW."input_set_id"
          AND row_member."row_kind"='player_match_stats' AND row_member."role"='corroborating'
          AND row_member."row_json"#>>'{match,canonicalId}'=match_member."match_id"
          AND row_member."row_json"#>>'{club,canonicalId}'=club."club_id")<1
      OR EXISTS (
        SELECT 1
        FROM "outcome_hpn_pav_input_row" primary_row
        JOIN "outcome_hpn_pav_input_run" primary_run
          ON primary_run."input_set_id"=primary_row."input_set_id"
          AND primary_run."normalization_run_id"=primary_row."normalization_run_id"
        JOIN "outcome_hpn_projected_field_map" primary_map
          ON primary_map."field_map_id"=primary_run."projected_field_map_id"
        JOIN "outcome_hpn_pav_input_row" corroborating_row
          ON corroborating_row."input_set_id"=primary_row."input_set_id"
          AND corroborating_row."row_kind"='player_match_stats'
          AND corroborating_row."role"='corroborating'
          AND corroborating_row."row_json"#>>'{match,canonicalId}'=match_member."match_id"
          AND corroborating_row."row_json"#>>'{club,canonicalId}'=club."club_id"
        JOIN "outcome_hpn_pav_input_run" corroborating_run
          ON corroborating_run."input_set_id"=corroborating_row."input_set_id"
          AND corroborating_run."normalization_run_id"=corroborating_row."normalization_run_id"
        JOIN "outcome_hpn_projected_field_map" corroborating_map
          ON corroborating_map."field_map_id"=corroborating_run."projected_field_map_id"
        WHERE primary_row."input_set_id"=NEW."input_set_id"
          AND primary_row."row_kind"='player_match_stats' AND primary_row."role"='primary'
          AND primary_row."row_json"#>>'{match,canonicalId}'=match_member."match_id"
          AND primary_row."row_json"#>>'{club,canonicalId}'=club."club_id"
          AND primary_map."provider"=corroborating_map."provider"
      )
      OR EXISTS (
        SELECT corroborating_map."provider"
        FROM "outcome_hpn_pav_input_row" corroborating_row
        JOIN "outcome_hpn_pav_input_run" corroborating_run
          ON corroborating_run."input_set_id"=corroborating_row."input_set_id"
          AND corroborating_run."normalization_run_id"=corroborating_row."normalization_run_id"
        JOIN "outcome_hpn_projected_field_map" corroborating_map
          ON corroborating_map."field_map_id"=corroborating_run."projected_field_map_id"
        WHERE corroborating_row."input_set_id"=NEW."input_set_id"
          AND corroborating_row."row_kind"='player_match_stats'
          AND corroborating_row."role"='corroborating'
          AND corroborating_row."row_json"#>>'{match,canonicalId}'=match_member."match_id"
          AND corroborating_row."row_json"#>>'{club,canonicalId}'=club."club_id"
        GROUP BY corroborating_map."provider"
        HAVING count(*)<>count(DISTINCT corroborating_row."row_json"#>>'{player,canonicalId}')
          OR EXISTS (
          (SELECT primary_row."row_json"#>>'{player,canonicalId}'
             FROM "outcome_hpn_pav_input_row" primary_row
            WHERE primary_row."input_set_id"=NEW."input_set_id"
              AND primary_row."row_kind"='player_match_stats' AND primary_row."role"='primary'
              AND primary_row."row_json"#>>'{match,canonicalId}'=match_member."match_id"
              AND primary_row."row_json"#>>'{club,canonicalId}'=club."club_id"
           EXCEPT
           SELECT provider_row."row_json"#>>'{player,canonicalId}'
             FROM "outcome_hpn_pav_input_row" provider_row
             JOIN "outcome_hpn_pav_input_run" provider_run
               ON provider_run."input_set_id"=provider_row."input_set_id"
               AND provider_run."normalization_run_id"=provider_row."normalization_run_id"
             JOIN "outcome_hpn_projected_field_map" provider_map
               ON provider_map."field_map_id"=provider_run."projected_field_map_id"
            WHERE provider_row."input_set_id"=NEW."input_set_id"
              AND provider_row."row_kind"='player_match_stats'
              AND provider_row."role"='corroborating'
              AND provider_map."provider"=corroborating_map."provider"
              AND provider_row."row_json"#>>'{match,canonicalId}'=match_member."match_id"
              AND provider_row."row_json"#>>'{club,canonicalId}'=club."club_id")
          UNION ALL
          (SELECT provider_row."row_json"#>>'{player,canonicalId}'
             FROM "outcome_hpn_pav_input_row" provider_row
             JOIN "outcome_hpn_pav_input_run" provider_run
               ON provider_run."input_set_id"=provider_row."input_set_id"
               AND provider_run."normalization_run_id"=provider_row."normalization_run_id"
             JOIN "outcome_hpn_projected_field_map" provider_map
               ON provider_map."field_map_id"=provider_run."projected_field_map_id"
            WHERE provider_row."input_set_id"=NEW."input_set_id"
              AND provider_row."row_kind"='player_match_stats'
              AND provider_row."role"='corroborating'
              AND provider_map."provider"=corroborating_map."provider"
              AND provider_row."row_json"#>>'{match,canonicalId}'=match_member."match_id"
              AND provider_row."row_json"#>>'{club,canonicalId}'=club."club_id"
           EXCEPT
           SELECT primary_row."row_json"#>>'{player,canonicalId}'
             FROM "outcome_hpn_pav_input_row" primary_row
            WHERE primary_row."input_set_id"=NEW."input_set_id"
              AND primary_row."row_kind"='player_match_stats' AND primary_row."role"='primary'
              AND primary_row."row_json"#>>'{match,canonicalId}'=match_member."match_id"
              AND primary_row."row_json"#>>'{club,canonicalId}'=club."club_id")
        )
      )
    )
  ) THEN RAISE EXCEPTION 'HPN PAV player membership is not independently corroborated'; END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER "outcome_hpn_pav_input_set_finalize_guard"
  ON "outcome_hpn_pav_input_set";
CREATE TRIGGER "outcome_hpn_pav_input_set_finalize_guard_v1"
  BEFORE UPDATE ON "outcome_hpn_pav_input_set"
  FOR EACH ROW
  WHEN (NEW."input_set_json"#>>'{content,schemaVersion}'=
    'afl-trade-hpn-pav-input-set/v1')
  EXECUTE FUNCTION "finalize_outcome_hpn_pav_input_set"();
CREATE TRIGGER "outcome_hpn_pav_input_set_finalize_guard_v2"
  BEFORE UPDATE ON "outcome_hpn_pav_input_set"
  FOR EACH ROW
  WHEN (NEW."input_set_json"#>>'{content,schemaVersion}'=
    'afl-trade-hpn-pav-input-set/v2')
  EXECUTE FUNCTION "finalize_outcome_hpn_pav_input_set_v2"();
