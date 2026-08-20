-- Authenticate prepared-v3 relational ancestry as strictly as the retained document.
-- Migration 0060 remains immutable; this forward migration replaces only its v3 insert validator.

CREATE OR REPLACE FUNCTION "validate_outcome_prepared_valuation_input_set_v3_insert"()
RETURNS TRIGGER AS $$
DECLARE
  content JSONB;
  release_scope TEXT;
  release_environment TEXT;
  release_manifest JSONB;
  canonical_members JSONB;
  expected_trade_ids JSONB;
  release_created_at TIMESTAMPTZ;
  release_canonical_text TEXT;
  membership_canonical_text TEXT;
  release_sha256 TEXT;
  membership_sha256 TEXT;
  qualification_report JSONB;
  qualification_finalized_at TIMESTAMPTZ;
  qualification_canonical_text TEXT;
  qualification_sha256 TEXT;
BEGIN
  IF NEW."finalized_at" IS NOT NULL THEN
    RAISE EXCEPTION 'Prepared valuation input v3 must be assembled before finalization';
  END IF;

  content:=NEW."prepared_set_json"->'content';
  SELECT "scope_key","environment","manifest_json","created_at"
    INTO release_scope,release_environment,release_manifest,release_created_at
    FROM "outcome_release_manifest"
   WHERE "release_id"=NEW."factual_release_id" FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Prepared valuation input v3 factual release does not exist';
  END IF;

  canonical_members:=release_manifest->'content'->'canonicalMembers';
  SELECT jsonb_agg(to_jsonb(member->>'canonicalRecordId') ORDER BY member->>'canonicalRecordId')
    INTO expected_trade_ids
    FROM jsonb_array_elements(canonical_members) members(member)
   WHERE member->>'recordKind'='transaction';
  release_canonical_text:="outcome_afl_trade_canonical_json"(release_manifest);
  membership_canonical_text:="outcome_afl_trade_canonical_json"(canonical_members);
  release_sha256:=encode(sha256(convert_to(release_canonical_text,'UTF8')),'hex');
  membership_sha256:=encode(sha256(convert_to(membership_canonical_text,'UTF8')),'hex');

  SELECT "report_json","finalized_at"
    INTO qualification_report,qualification_finalized_at
    FROM "outcome_valuation_source_qualification_report"
   WHERE "qualification_report_id"=NEW."qualification_report_id" FOR KEY SHARE;
  qualification_canonical_text:="outcome_afl_trade_canonical_json"(qualification_report);
  qualification_sha256:=encode(
    sha256(convert_to(qualification_canonical_text,'UTF8')),'hex'
  );

  IF NEW."content_canonical_json" IS DISTINCT FROM
       "outcome_afl_trade_canonical_json"(content) OR
     NEW."prepared_set_canonical_json" IS DISTINCT FROM
       "outcome_afl_trade_canonical_json"(NEW."prepared_set_json") OR
     NEW."content_canonical_json"::jsonb IS DISTINCT FROM content OR
     NEW."prepared_set_canonical_json"::jsonb IS DISTINCT FROM NEW."prepared_set_json" OR
     NEW."content_sha256" IS DISTINCT FROM
       encode(sha256(convert_to(NEW."content_canonical_json",'UTF8')),'hex') OR
     NEW."prepared_set_json"->>'preparedInputSetId' IS DISTINCT FROM
       NEW."prepared_input_set_id" OR
     (SELECT count(*) FROM jsonb_object_keys(NEW."prepared_set_json"))<>2 OR
     (SELECT count(*) FROM jsonb_object_keys(content))<>22 OR
     content->>'schemaVersion' IS DISTINCT FROM NEW."schema_version" OR
     content->>'environment' IS DISTINCT FROM NEW."environment"::text OR
     content->>'scopeKey' IS DISTINCT FROM NEW."scope_key" OR
     content->>'factualReleaseScopeKey' IS DISTINCT FROM NEW."factual_release_scope_key" OR
     content->>'factualReleaseId' IS DISTINCT FROM NEW."factual_release_id" OR
     content->>'preparationAuthority' IS DISTINCT FROM
       'authenticated_calculation_evidence_snapshot' OR
     content->>'qualificationOperation' IS DISTINCT FROM
       'valuation_model_training_and_derived_feature_creation' OR
     content->>'qualificationReportId' IS DISTINCT FROM NEW."qualification_report_id" OR
     content->>'valuationInputBundleId' !~ '^valuation-input-bundle:[a-f0-9]{64}$' OR
     (content->>'tradeCount')::integer IS DISTINCT FROM NEW."trade_count" OR
     (content->>'readyCount')::integer IS DISTINCT FROM NEW."ready_count" OR
     (content->>'blockedCount')::integer IS DISTINCT FROM NEW."blocked_count" OR
     (content->>'preparedAt')::timestamptz IS DISTINCT FROM NEW."prepared_at" OR
     content->'publicationEligible' IS DISTINCT FROM 'false'::jsonb OR
     content->'releaseTradeIds' IS DISTINCT FROM expected_trade_ids OR
     jsonb_array_length(content->'releaseTradeIds') IS DISTINCT FROM NEW."trade_count" OR
     jsonb_array_length(content->'entries') IS DISTINCT FROM NEW."trade_count" OR
     release_scope IS DISTINCT FROM NEW."factual_release_scope_key" OR
     release_environment IS DISTINCT FROM NEW."environment"::text OR
     qualification_report IS NULL OR qualification_finalized_at IS NULL OR
     qualification_report->'content'->>'factualReleaseId' IS DISTINCT FROM
       NEW."factual_release_id" OR
     qualification_report->'content'->>'valuationScopeKey' IS DISTINCT FROM
       NEW."scope_key" OR
     qualification_report->'content'->>'factualReleaseScopeKey' IS DISTINCT FROM
       NEW."factual_release_scope_key" OR
     qualification_report->'content'->'releaseTradeIds' IS DISTINCT FROM
       content->'releaseTradeIds' OR
     qualification_report->'content'->'sourceRightsEvidenceRefs' IS DISTINCT FROM
       content->'sourceQualificationEvidenceRefs' OR
     qualification_report->'content'->'decision'->>'state' IS DISTINCT FROM
       'eligible_for_dataset_admission' OR
     content->'qualificationReportArtifact'->>'artifactId' IS DISTINCT FROM
       'artifact:'||qualification_sha256 OR
     content->'qualificationReportArtifact'->>'contentSha256' IS DISTINCT FROM
       qualification_sha256 OR
     content->'qualificationReportArtifact'->>'storageUri' IS DISTINCT FROM
       'artifact://sha256/'||qualification_sha256 OR
     content->'qualificationReportArtifact'->>'mediaType' IS DISTINCT FROM
       'application/json' OR
     (content->'qualificationReportArtifact'->>'byteLength')::integer IS DISTINCT FROM
       octet_length(convert_to(qualification_canonical_text,'UTF8')) OR
     (content->'qualificationReportArtifact'->>'createdAt')::timestamptz IS DISTINCT FROM
       qualification_finalized_at OR
     content->'factualReleaseArtifact'->>'artifactId' IS DISTINCT FROM
       'artifact:'||release_sha256 OR
     content->'factualReleaseArtifact'->>'contentSha256' IS DISTINCT FROM release_sha256 OR
     content->'factualReleaseArtifact'->>'storageUri' IS DISTINCT FROM
       'artifact://sha256/'||release_sha256 OR
     content->'factualReleaseArtifact'->>'mediaType' IS DISTINCT FROM 'application/json' OR
     (content->'factualReleaseArtifact'->>'byteLength')::integer IS DISTINCT FROM
       octet_length(convert_to(release_canonical_text,'UTF8')) OR
     (content->'factualReleaseArtifact'->>'createdAt')::timestamptz IS DISTINCT FROM
       release_created_at OR
     content->'releaseMembershipArtifact'->>'artifactId' IS DISTINCT FROM
       'artifact:'||membership_sha256 OR
     content->'releaseMembershipArtifact'->>'contentSha256' IS DISTINCT FROM
       membership_sha256 OR
     content->'releaseMembershipArtifact'->>'storageUri' IS DISTINCT FROM
       'artifact://sha256/'||membership_sha256 OR
     content->'releaseMembershipArtifact'->>'mediaType' IS DISTINCT FROM
       'application/json' OR
     (content->'releaseMembershipArtifact'->>'byteLength')::integer IS DISTINCT FROM
       octet_length(convert_to(membership_canonical_text,'UTF8')) OR
     (content->'releaseMembershipArtifact'->>'createdAt')::timestamptz IS DISTINCT FROM
       release_created_at OR
     NOT "validate_outcome_prepared_valuation_input_v2_artifact"(
       content->'valuationInputBundleArtifact',NEW."environment"
     ) OR
     (content->'valuationInputBundleArtifact'->>'createdAt')::timestamptz>NEW."prepared_at" THEN
    RAISE EXCEPTION 'Prepared valuation input v3 identity, authority, or factual ancestry mismatch';
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Prepared valuation input v3 contains invalid typed evidence';
END;
$$ LANGUAGE plpgsql;
