CREATE TABLE "outcome_valuation_source_qualification_report" (
  "qualification_report_id" TEXT PRIMARY KEY,
  "content_sha256" CHAR(64) NOT NULL,
  "schema_version" TEXT NOT NULL,
  "environment" "OutcomeEnvironment" NOT NULL,
  "operation" TEXT NOT NULL,
  "valuation_scope_key" TEXT NOT NULL,
  "factual_release_scope_key" TEXT NOT NULL,
  "factual_release_id" TEXT NOT NULL REFERENCES "outcome_release_manifest"("release_id") ON DELETE RESTRICT,
  "decision_state" TEXT NOT NULL,
  "evaluated_at" TIMESTAMPTZ(3) NOT NULL,
  "content_canonical_json" TEXT NOT NULL,
  "report_canonical_json" TEXT NOT NULL,
  "report_json" JSONB NOT NULL,
  "finalized_at" TIMESTAMPTZ(3) NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT transaction_timestamp(),
  "registered_by" TEXT NOT NULL DEFAULT CURRENT_USER,
  CONSTRAINT "outcome_valuation_source_qualification_identity_check" CHECK (
    "qualification_report_id" = 'valuation-source-qualification:' || "content_sha256" AND
    "content_sha256" ~ '^[a-f0-9]{64}$' AND
    "schema_version" = 'afl-trade-valuation-source-qualification-report/v1' AND
    "environment" = 'non_production' AND
    "operation" = 'valuation_model_training_and_derived_feature_creation' AND
    "decision_state" IN ('blocked','eligible_for_dataset_admission') AND
    "factual_release_id" ~ '^outcome-release:[a-f0-9]{64}$'
  ),
  CONSTRAINT "outcome_valuation_source_qualification_chronology_check" CHECK (
    "evaluated_at" = "finalized_at" AND "finalized_at" <= "registered_at"
  ),
  CONSTRAINT "outcome_valuation_source_qualification_json_check" CHECK (
    jsonb_typeof("report_json")='object'
  )
);

CREATE INDEX "outcome_valuation_source_qualification_scope_idx"
  ON "outcome_valuation_source_qualification_report"(
    "environment","valuation_scope_key","evaluated_at"
  );
CREATE INDEX "outcome_valuation_source_qualification_release_idx"
  ON "outcome_valuation_source_qualification_report"("factual_release_id","evaluated_at");

CREATE FUNCTION "validate_outcome_valuation_source_qualification_insert"() RETURNS TRIGGER AS $$
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
  release_rights_ids JSONB;
  expected_blocked_register_ids JSONB;
  reported_blocked_register_ids JSONB;
BEGIN
  content := NEW."report_json"->'content';
  SELECT "scope_key","environment","manifest_json","created_at"
    INTO release_scope,release_environment,release_manifest,release_created_at
    FROM "outcome_release_manifest" WHERE "release_id"=NEW."factual_release_id" FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source qualification factual release does not exist';
  END IF;
  canonical_members := release_manifest->'content'->'canonicalMembers';
  release_canonical_text := "outcome_afl_trade_canonical_json"(release_manifest);
  membership_canonical_text := "outcome_afl_trade_canonical_json"(canonical_members);
  release_sha256 := encode(sha256(convert_to(release_canonical_text,'UTF8')),'hex');
  membership_sha256 := encode(sha256(convert_to(membership_canonical_text,'UTF8')),'hex');

  SELECT jsonb_agg(to_jsonb(member->>'canonicalRecordId') ORDER BY member->>'canonicalRecordId')
    INTO expected_trade_ids
    FROM jsonb_array_elements(canonical_members) AS members(member)
    WHERE member->>'recordKind'='transaction';
  SELECT jsonb_agg(to_jsonb(rights_artifact_id) ORDER BY rights_artifact_id)
    INTO release_rights_ids
    FROM (
      SELECT DISTINCT capture->>'rightsArtifactId' AS rights_artifact_id
        FROM jsonb_array_elements(release_manifest->'content'->'sourceCaptures') captures(capture)
    ) release_rights;
  SELECT COALESCE(jsonb_agg(to_jsonb(rights."content_json"->'content'->>'registerId')
                            ORDER BY rights."content_json"->'content'->>'registerId'),'[]'::jsonb)
    INTO expected_blocked_register_ids
    FROM "outcome_source_rights_proposal" rights
   WHERE rights."rights_artifact_id" IN (
           SELECT jsonb_array_elements_text(release_rights_ids)
         )
     AND (
       rights."content_json"->'content'->>'termsEffectiveAt' IS NULL OR
       (rights."content_json"->'content'->>'termsEffectiveAt')::timestamptz > NEW."evaluated_at" OR
       (
         rights."content_json"->'content'->>'termsExpireAt' IS NOT NULL AND
         (rights."content_json"->'content'->>'termsExpireAt')::timestamptz <= NEW."evaluated_at"
       ) OR
       rights."content_json"->'content'->'operations'->>'model_training'<>'allowed' OR
       rights."content_json"->'content'->'operations'->>'derived_feature_creation'<>'allowed' OR
       EXISTS (
         SELECT 1 FROM jsonb_array_elements(rights."content_json"->'content'->'fields') field
          WHERE field->'uses'->>'model_training'<>'allowed'
             OR field->'uses'->>'derived_feature'<>'allowed'
       )
     );
  IF content->'decision'->>'state'='blocked' THEN
    SELECT jsonb_agg(to_jsonb(blocker->'subject'->>'id')
                     ORDER BY blocker->'subject'->>'id')
      INTO reported_blocked_register_ids
      FROM jsonb_array_elements(content->'decision'->'blockers') blockers(blocker);
  ELSE
    reported_blocked_register_ids := '[]'::jsonb;
  END IF;

  IF NEW."content_canonical_json" IS DISTINCT FROM
       "outcome_afl_trade_canonical_json"(content) OR
     NEW."report_canonical_json" IS DISTINCT FROM
       "outcome_afl_trade_canonical_json"(NEW."report_json") OR
     NEW."content_canonical_json"::jsonb IS DISTINCT FROM content OR
     NEW."report_canonical_json"::jsonb IS DISTINCT FROM NEW."report_json" OR
     NEW."content_sha256" IS DISTINCT FROM
       encode(sha256(convert_to(NEW."content_canonical_json",'UTF8')),'hex') OR
     NEW."report_json"->>'qualificationReportId' IS DISTINCT FROM NEW."qualification_report_id" OR
     content->>'schemaVersion' IS DISTINCT FROM NEW."schema_version" OR
     content->>'environment' IS DISTINCT FROM NEW."environment"::text OR
     content->>'operation' IS DISTINCT FROM NEW."operation" OR
     content->>'valuationScopeKey' IS DISTINCT FROM NEW."valuation_scope_key" OR
     content->>'factualReleaseScopeKey' IS DISTINCT FROM NEW."factual_release_scope_key" OR
     content->>'factualReleaseId' IS DISTINCT FROM NEW."factual_release_id" OR
     content->'decision'->>'state' IS DISTINCT FROM NEW."decision_state" OR
     (content->>'evaluatedAt')::timestamptz IS DISTINCT FROM NEW."evaluated_at" OR
     content->'publicationEligible' IS DISTINCT FROM 'false'::jsonb OR
     content->'releaseTradeIds' IS DISTINCT FROM expected_trade_ids OR
     expected_trade_ids IS NULL OR release_rights_ids IS NULL OR
     release_scope IS DISTINCT FROM NEW."factual_release_scope_key" OR
     release_environment IS DISTINCT FROM NEW."environment"::text OR
     reported_blocked_register_ids IS DISTINCT FROM expected_blocked_register_ids OR
     (
       (jsonb_array_length(expected_blocked_register_ids)>0 AND NEW."decision_state"<>'blocked') OR
       (jsonb_array_length(expected_blocked_register_ids)=0 AND
        NEW."decision_state"<>'eligible_for_dataset_admission')
     ) OR
     (
       SELECT jsonb_agg(to_jsonb(rights."rights_artifact_id") ORDER BY rights."rights_artifact_id")
         FROM jsonb_array_elements(content->'sourceRightsEvidenceRefs') evidence_ref
         JOIN "outcome_source_rights_proposal" rights
           ON evidence_ref->>'artifactId'='artifact:'||encode(sha256(convert_to(
                "outcome_afl_trade_canonical_json"(rights."content_json"),'UTF8')),'hex')
          AND evidence_ref->>'contentSha256'=encode(sha256(convert_to(
                "outcome_afl_trade_canonical_json"(rights."content_json"),'UTF8')),'hex')
          AND evidence_ref->>'storageUri'='artifact://sha256/'||encode(sha256(convert_to(
                "outcome_afl_trade_canonical_json"(rights."content_json"),'UTF8')),'hex')
          AND evidence_ref->>'mediaType'='application/json'
          AND (evidence_ref->>'byteLength')::integer=octet_length(convert_to(
                "outcome_afl_trade_canonical_json"(rights."content_json"),'UTF8'))
          AND (evidence_ref->>'createdAt')::timestamptz=rights."proposed_at"
     ) IS DISTINCT FROM release_rights_ids OR
     jsonb_array_length(content->'sourceRightsEvidenceRefs')<>
       jsonb_array_length(release_rights_ids) OR
     EXISTS (
       SELECT 1 FROM jsonb_array_elements(
         CASE WHEN NEW."decision_state"='blocked' THEN content->'decision'->'blockers'
              ELSE '[]'::jsonb END
       ) blockers(blocker)
       WHERE blocker->>'code'<>'source_blocked' OR blocker->'subject'->>'kind'<>'source' OR
             jsonb_array_length(blocker->'evidenceRefs')<>1 OR NOT EXISTS (
               SELECT 1 FROM "outcome_source_rights_proposal" rights
               CROSS JOIN LATERAL (
                 SELECT "outcome_afl_trade_canonical_json"(rights."content_json") canonical_text
               ) canonical
               CROSS JOIN LATERAL (
                 SELECT encode(sha256(convert_to(canonical.canonical_text,'UTF8')),'hex') digest
               ) identity
               WHERE rights."content_json"->'content'->>'registerId'=blocker->'subject'->>'id'
                 AND blocker->'evidenceRefs'->0->>'artifactId'='artifact:'||identity.digest
                 AND blocker->'evidenceRefs'->0->>'contentSha256'=identity.digest
                 AND blocker->'evidenceRefs'->0->>'storageUri'='artifact://sha256/'||identity.digest
                 AND blocker->'evidenceRefs'->0->>'mediaType'='application/json'
                 AND (blocker->'evidenceRefs'->0->>'byteLength')::integer=
                   octet_length(convert_to(canonical.canonical_text,'UTF8'))
                 AND (blocker->'evidenceRefs'->0->>'createdAt')::timestamptz=rights."proposed_at"
             )
     ) OR
     content->'factualReleaseArtifact'->>'artifactId' IS DISTINCT FROM 'artifact:'||release_sha256 OR
     content->'factualReleaseArtifact'->>'contentSha256' IS DISTINCT FROM release_sha256 OR
     content->'factualReleaseArtifact'->>'storageUri' IS DISTINCT FROM 'artifact://sha256/'||release_sha256 OR
     content->'factualReleaseArtifact'->>'mediaType' IS DISTINCT FROM 'application/json' OR
     (content->'factualReleaseArtifact'->>'byteLength')::integer IS DISTINCT FROM
       octet_length(convert_to(release_canonical_text,'UTF8')) OR
     (content->'factualReleaseArtifact'->>'createdAt')::timestamptz IS DISTINCT FROM release_created_at OR
     content->'releaseMembershipArtifact'->>'artifactId' IS DISTINCT FROM 'artifact:'||membership_sha256 OR
     content->'releaseMembershipArtifact'->>'contentSha256' IS DISTINCT FROM membership_sha256 OR
     content->'releaseMembershipArtifact'->>'storageUri' IS DISTINCT FROM 'artifact://sha256/'||membership_sha256 OR
     content->'releaseMembershipArtifact'->>'mediaType' IS DISTINCT FROM 'application/json' OR
     (content->'releaseMembershipArtifact'->>'byteLength')::integer IS DISTINCT FROM
       octet_length(convert_to(membership_canonical_text,'UTF8')) OR
     (content->'releaseMembershipArtifact'->>'createdAt')::timestamptz IS DISTINCT FROM release_created_at THEN
    RAISE EXCEPTION 'Source qualification report identity, policy, or factual ancestry mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_valuation_source_qualification_insert_guard"
BEFORE INSERT ON "outcome_valuation_source_qualification_report"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_valuation_source_qualification_insert"();

CREATE FUNCTION "reject_outcome_valuation_source_qualification_mutation"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Source qualification reports are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_valuation_source_qualification_update_guard"
BEFORE UPDATE OR DELETE ON "outcome_valuation_source_qualification_report"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_valuation_source_qualification_mutation"();

CREATE TABLE "outcome_prepared_valuation_input_set" (
  "prepared_input_set_id" TEXT PRIMARY KEY,
  "content_sha256" CHAR(64) NOT NULL,
  "schema_version" TEXT NOT NULL,
  "environment" "OutcomeEnvironment" NOT NULL,
  "scope_key" TEXT NOT NULL,
  "factual_release_scope_key" TEXT NOT NULL,
  "factual_release_id" TEXT NOT NULL REFERENCES "outcome_release_manifest"("release_id") ON DELETE RESTRICT,
  "qualification_report_id" TEXT NOT NULL REFERENCES "outcome_valuation_source_qualification_report"("qualification_report_id") ON DELETE RESTRICT,
  "trade_count" INTEGER NOT NULL,
  "ready_count" INTEGER NOT NULL,
  "blocked_count" INTEGER NOT NULL,
  "prepared_at" TIMESTAMPTZ(3) NOT NULL,
  "content_canonical_json" TEXT NOT NULL,
  "prepared_set_canonical_json" TEXT NOT NULL,
  "prepared_set_json" JSONB NOT NULL,
  "finalized_at" TIMESTAMPTZ(3),
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT transaction_timestamp(),
  "registered_by" TEXT NOT NULL DEFAULT CURRENT_USER,
  CONSTRAINT "outcome_prepared_valuation_input_set_identity_check" CHECK (
    "prepared_input_set_id" = 'prepared-valuation-input-set:' || "content_sha256" AND
    "content_sha256" ~ '^[a-f0-9]{64}$' AND
    "schema_version" = 'afl-trade-prepared-valuation-input-set/v1' AND
    "environment" = 'non_production' AND
    "factual_release_id" ~ '^outcome-release:[a-f0-9]{64}$'
  ),
  CONSTRAINT "outcome_prepared_valuation_input_set_count_check" CHECK (
    "trade_count" > 0 AND "ready_count" = 0 AND "blocked_count" > 0 AND
    "trade_count" = "ready_count" + "blocked_count"
  ),
  CONSTRAINT "outcome_prepared_valuation_input_set_chronology_check" CHECK (
    "finalized_at" IS NULL OR ("prepared_at" <= "finalized_at" AND "finalized_at" <= "registered_at")
  ),
  CONSTRAINT "outcome_prepared_valuation_input_set_json_check" CHECK (
    jsonb_typeof("prepared_set_json")='object'
  )
);

CREATE TABLE "outcome_prepared_valuation_input_entry" (
  "prepared_input_set_id" TEXT NOT NULL REFERENCES "outcome_prepared_valuation_input_set"("prepared_input_set_id") ON DELETE RESTRICT,
  "ordinal" INTEGER NOT NULL,
  "trade_id" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "entry_canonical_json" TEXT NOT NULL,
  "entry_json" JSONB NOT NULL,
  PRIMARY KEY ("prepared_input_set_id","ordinal"),
  CONSTRAINT "outcome_prepared_valuation_input_entry_trade_key" UNIQUE ("prepared_input_set_id","trade_id"),
  CONSTRAINT "outcome_prepared_valuation_input_entry_value_check" CHECK (
    "ordinal" > 0 AND "state" = 'blocked' AND jsonb_typeof("entry_json")='object'
  )
);

CREATE INDEX "outcome_prepared_valuation_input_set_scope_idx"
  ON "outcome_prepared_valuation_input_set"("environment","scope_key","prepared_at");
CREATE INDEX "outcome_prepared_valuation_input_set_release_idx"
  ON "outcome_prepared_valuation_input_set"("factual_release_id","prepared_at");
CREATE INDEX "outcome_prepared_valuation_input_set_qualification_idx"
  ON "outcome_prepared_valuation_input_set"("qualification_report_id");

CREATE FUNCTION "validate_outcome_prepared_valuation_input_set_insert"() RETURNS TRIGGER AS $$
DECLARE
  content JSONB;
  release_scope TEXT;
  release_environment TEXT;
  release_manifest JSONB;
  canonical_members JSONB;
  expected_trade_ids JSONB;
  release_found BOOLEAN;
  release_created_at TIMESTAMPTZ;
  release_canonical_text TEXT;
  membership_canonical_text TEXT;
  release_sha256 TEXT;
  membership_sha256 TEXT;
  release_rights_ids JSONB;
  qualification_report_json JSONB;
  qualification_report_created_at TIMESTAMPTZ;
  qualification_report_canonical_text TEXT;
  qualification_report_sha256 TEXT;
BEGIN
  IF NEW."finalized_at" IS NOT NULL THEN
    RAISE EXCEPTION 'Prepared valuation input set must be assembled before finalization';
  END IF;

  content := NEW."prepared_set_json"->'content';
  SELECT "scope_key","environment","manifest_json","created_at"
    INTO release_scope,release_environment,release_manifest,release_created_at
    FROM "outcome_release_manifest" WHERE "release_id"=NEW."factual_release_id" FOR KEY SHARE;
  release_found := FOUND;
  canonical_members := release_manifest->'content'->'canonicalMembers';
  release_canonical_text := "outcome_afl_trade_canonical_json"(release_manifest);
  membership_canonical_text := "outcome_afl_trade_canonical_json"(canonical_members);
  release_sha256 := encode(sha256(convert_to(release_canonical_text,'UTF8')),'hex');
  membership_sha256 := encode(sha256(convert_to(membership_canonical_text,'UTF8')),'hex');
  SELECT "report_json","finalized_at" INTO qualification_report_json,qualification_report_created_at
    FROM "outcome_valuation_source_qualification_report"
   WHERE "qualification_report_id"=NEW."qualification_report_id" FOR KEY SHARE;
  qualification_report_canonical_text :=
    "outcome_afl_trade_canonical_json"(qualification_report_json);
  qualification_report_sha256 :=
    encode(sha256(convert_to(qualification_report_canonical_text,'UTF8')),'hex');
  IF jsonb_typeof(canonical_members) = 'array' THEN
    SELECT jsonb_agg(to_jsonb(member->>'canonicalRecordId') ORDER BY member->>'canonicalRecordId')
      INTO expected_trade_ids
      FROM jsonb_array_elements(canonical_members) AS members(member)
      WHERE member->>'recordKind' = 'transaction';
  END IF;
  IF jsonb_typeof(release_manifest->'content'->'sourceCaptures') = 'array' THEN
    SELECT jsonb_agg(to_jsonb(rights_artifact_id) ORDER BY rights_artifact_id)
      INTO release_rights_ids
      FROM (
        SELECT DISTINCT source_capture->>'rightsArtifactId' AS rights_artifact_id
          FROM jsonb_array_elements(release_manifest->'content'->'sourceCaptures')
            AS captures(source_capture)
      ) release_rights;
  END IF;
  IF NOT release_found OR
     NEW."content_canonical_json" IS DISTINCT FROM "outcome_afl_trade_canonical_json"(content) OR
     NEW."prepared_set_canonical_json" IS DISTINCT FROM
       "outcome_afl_trade_canonical_json"(NEW."prepared_set_json") OR
     NEW."content_canonical_json"::jsonb IS DISTINCT FROM content OR
     NEW."prepared_set_canonical_json"::jsonb IS DISTINCT FROM NEW."prepared_set_json" OR
     NEW."content_sha256" IS DISTINCT FROM
       encode(sha256(convert_to(NEW."content_canonical_json",'UTF8')),'hex') OR
     NEW."prepared_set_json"->>'preparedInputSetId' IS DISTINCT FROM NEW."prepared_input_set_id" OR
     content->>'schemaVersion' IS DISTINCT FROM NEW."schema_version" OR
     content->>'environment' IS DISTINCT FROM NEW."environment"::text OR
     content->>'scopeKey' IS DISTINCT FROM NEW."scope_key" OR
     content->>'factualReleaseScopeKey' IS DISTINCT FROM NEW."factual_release_scope_key" OR
     content->>'factualReleaseId' IS DISTINCT FROM NEW."factual_release_id" OR
     content->>'preparationAuthority' IS DISTINCT FROM 'source_policy_preflight_only' OR
     content->>'qualificationOperation' IS DISTINCT FROM
       'valuation_model_training_and_derived_feature_creation' OR
     content->>'qualificationReportId' IS DISTINCT FROM NEW."qualification_report_id" OR
     (content->>'tradeCount')::integer IS DISTINCT FROM NEW."trade_count" OR
     (content->>'readyCount')::integer IS DISTINCT FROM NEW."ready_count" OR
     (content->>'blockedCount')::integer IS DISTINCT FROM NEW."blocked_count" OR
     (content->>'preparedAt')::timestamptz IS DISTINCT FROM NEW."prepared_at" OR
     content->'publicationEligible' IS DISTINCT FROM 'false'::jsonb OR
     jsonb_typeof(content->'releaseTradeIds') IS DISTINCT FROM 'array' OR
     jsonb_typeof(content->'entries') IS DISTINCT FROM 'array' OR
     jsonb_typeof(content->'sourceQualificationEvidenceRefs') IS DISTINCT FROM 'array' OR
     jsonb_array_length(content->'releaseTradeIds') IS DISTINCT FROM NEW."trade_count" OR
     jsonb_array_length(content->'entries') IS DISTINCT FROM NEW."trade_count" OR
     expected_trade_ids IS NULL OR
     release_rights_ids IS NULL OR
     content->'releaseTradeIds' IS DISTINCT FROM expected_trade_ids OR
     qualification_report_json IS NULL OR
     qualification_report_json->'content'->>'factualReleaseId' IS DISTINCT FROM NEW."factual_release_id" OR
     qualification_report_json->'content'->>'valuationScopeKey' IS DISTINCT FROM NEW."scope_key" OR
     qualification_report_json->'content'->>'factualReleaseScopeKey' IS DISTINCT FROM
       NEW."factual_release_scope_key" OR
     qualification_report_json->'content'->'releaseTradeIds' IS DISTINCT FROM
       content->'releaseTradeIds' OR
     qualification_report_json->'content'->'sourceRightsEvidenceRefs' IS DISTINCT FROM
       content->'sourceQualificationEvidenceRefs' OR
     qualification_report_json->'content'->'decision'->>'state'<>'blocked' OR
     EXISTS (
       SELECT 1 FROM jsonb_array_elements(content->'entries') prepared_entry
        WHERE prepared_entry->'blockers' IS DISTINCT FROM
          qualification_report_json->'content'->'decision'->'blockers'
     ) OR
     content->'qualificationReportArtifact'->>'artifactId' IS DISTINCT FROM
       'artifact:'||qualification_report_sha256 OR
     content->'qualificationReportArtifact'->>'contentSha256' IS DISTINCT FROM
       qualification_report_sha256 OR
     content->'qualificationReportArtifact'->>'storageUri' IS DISTINCT FROM
       'artifact://sha256/'||qualification_report_sha256 OR
     content->'qualificationReportArtifact'->>'mediaType' IS DISTINCT FROM 'application/json' OR
     (content->'qualificationReportArtifact'->>'byteLength')::integer IS DISTINCT FROM
       octet_length(convert_to(qualification_report_canonical_text,'UTF8')) OR
     (content->'qualificationReportArtifact'->>'createdAt')::timestamptz IS DISTINCT FROM
       qualification_report_created_at OR
     (
       SELECT jsonb_agg(to_jsonb(rights."rights_artifact_id") ORDER BY rights."rights_artifact_id")
         FROM jsonb_array_elements(content->'sourceQualificationEvidenceRefs') evidence_ref
         JOIN "outcome_source_rights_proposal" rights
           ON evidence_ref->>'artifactId'='artifact:'||encode(sha256(convert_to(
                "outcome_afl_trade_canonical_json"(rights."content_json"),'UTF8')),'hex')
          AND evidence_ref->>'contentSha256'=encode(sha256(convert_to(
                "outcome_afl_trade_canonical_json"(rights."content_json"),'UTF8')),'hex')
          AND evidence_ref->>'storageUri'='artifact://sha256/'||encode(sha256(convert_to(
                "outcome_afl_trade_canonical_json"(rights."content_json"),'UTF8')),'hex')
          AND evidence_ref->>'mediaType'='application/json'
          AND (evidence_ref->>'byteLength')::integer=octet_length(convert_to(
                "outcome_afl_trade_canonical_json"(rights."content_json"),'UTF8'))
          AND (evidence_ref->>'createdAt')::timestamptz=rights."proposed_at"
     ) IS DISTINCT FROM release_rights_ids OR
     jsonb_array_length(content->'sourceQualificationEvidenceRefs')<>
       jsonb_array_length(release_rights_ids) OR
     EXISTS (
       SELECT 1
         FROM jsonb_array_elements(content->'entries') prepared_entry
        WHERE EXISTS (
          SELECT 1
            FROM jsonb_array_elements(prepared_entry->'blockers') blocker
           WHERE blocker->>'code'<>'source_blocked'
              OR blocker->'subject'->>'kind'<>'source'
              OR jsonb_array_length(blocker->'evidenceRefs')<>1
        )
     ) OR
     content->'factualReleaseArtifact'->>'artifactId' IS DISTINCT FROM 'artifact:'||release_sha256 OR
     content->'factualReleaseArtifact'->>'contentSha256' IS DISTINCT FROM release_sha256 OR
     content->'factualReleaseArtifact'->>'storageUri' IS DISTINCT FROM 'artifact://sha256/'||release_sha256 OR
     content->'factualReleaseArtifact'->>'mediaType' IS DISTINCT FROM 'application/json' OR
     (content->'factualReleaseArtifact'->>'byteLength')::integer IS DISTINCT FROM
       octet_length(convert_to(release_canonical_text,'UTF8')) OR
     (content->'factualReleaseArtifact'->>'createdAt')::timestamptz IS DISTINCT FROM release_created_at OR
     content->'releaseMembershipArtifact'->>'artifactId' IS DISTINCT FROM 'artifact:'||membership_sha256 OR
     content->'releaseMembershipArtifact'->>'contentSha256' IS DISTINCT FROM membership_sha256 OR
     content->'releaseMembershipArtifact'->>'storageUri' IS DISTINCT FROM 'artifact://sha256/'||membership_sha256 OR
     content->'releaseMembershipArtifact'->>'mediaType' IS DISTINCT FROM 'application/json' OR
     (content->'releaseMembershipArtifact'->>'byteLength')::integer IS DISTINCT FROM
       octet_length(convert_to(membership_canonical_text,'UTF8')) OR
     (content->'releaseMembershipArtifact'->>'createdAt')::timestamptz IS DISTINCT FROM release_created_at OR
     release_scope IS DISTINCT FROM NEW."factual_release_scope_key" OR
     release_environment IS DISTINCT FROM NEW."environment"::text THEN
    RAISE EXCEPTION 'Prepared valuation input set identity or factual ancestry mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "validate_outcome_prepared_valuation_input_entry_insert"() RETURNS TRIGGER AS $$
DECLARE
  parent RECORD;
  expected_entry JSONB;
  expected_trade_id TEXT;
BEGIN
  SELECT "prepared_set_json","trade_count","finalized_at" INTO parent
    FROM "outcome_prepared_valuation_input_set"
    WHERE "prepared_input_set_id"=NEW."prepared_input_set_id" FOR KEY SHARE;
  IF NOT FOUND OR parent."finalized_at" IS NOT NULL OR NEW."ordinal" > parent."trade_count" THEN
    RAISE EXCEPTION 'Prepared valuation input entry has no open parent set';
  END IF;
  expected_entry := parent."prepared_set_json"->'content'->'entries'->(NEW."ordinal"-1);
  expected_trade_id := parent."prepared_set_json"->'content'->'releaseTradeIds'->>(NEW."ordinal"-1);
  IF NEW."entry_canonical_json" IS DISTINCT FROM "outcome_afl_trade_canonical_json"(NEW."entry_json") OR
     NEW."entry_canonical_json"::jsonb IS DISTINCT FROM NEW."entry_json" OR
     NEW."entry_json" IS DISTINCT FROM expected_entry OR
     NEW."entry_json"->>'tradeId' IS DISTINCT FROM NEW."trade_id" OR
     NEW."entry_json"->>'state' IS DISTINCT FROM NEW."state" OR
     NEW."trade_id" IS DISTINCT FROM expected_trade_id OR
     EXISTS (
       SELECT 1
         FROM jsonb_array_elements(NEW."entry_json"->'blockers') blocker
        WHERE blocker->>'code'='source_blocked' AND (
          jsonb_array_length(blocker->'evidenceRefs')<>1 OR NOT EXISTS (
            SELECT 1
              FROM "outcome_source_rights_proposal" rights
             CROSS JOIN LATERAL (
               SELECT "outcome_afl_trade_canonical_json"(rights."content_json") AS canonical_text
             ) canonical
             CROSS JOIN LATERAL (
               SELECT encode(sha256(convert_to(canonical.canonical_text,'UTF8')),'hex') AS digest
             ) identity
             WHERE blocker->'subject'->>'id'=rights."content_json"->'content'->>'registerId'
               AND blocker->'evidenceRefs'->0->>'artifactId'='artifact:'||identity.digest
               AND blocker->'evidenceRefs'->0->>'contentSha256'=identity.digest
               AND blocker->'evidenceRefs'->0->>'storageUri'='artifact://sha256/'||identity.digest
               AND blocker->'evidenceRefs'->0->>'mediaType'='application/json'
               AND (blocker->'evidenceRefs'->0->>'byteLength')::integer=
                 octet_length(convert_to(canonical.canonical_text,'UTF8'))
               AND (blocker->'evidenceRefs'->0->>'createdAt')::timestamptz=rights."proposed_at"
          )
        )
     ) THEN
    RAISE EXCEPTION 'Prepared valuation input entry identity or ordinal mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "finalize_outcome_prepared_valuation_input_set"() RETURNS TRIGGER AS $$
DECLARE
  actual_count INTEGER;
  actual_ready_count INTEGER;
  actual_blocked_count INTEGER;
BEGIN
  IF OLD."finalized_at" IS NOT NULL OR
     NEW."prepared_input_set_id" IS DISTINCT FROM OLD."prepared_input_set_id" OR
     NEW."content_sha256" IS DISTINCT FROM OLD."content_sha256" OR
     NEW."schema_version" IS DISTINCT FROM OLD."schema_version" OR
     NEW."environment" IS DISTINCT FROM OLD."environment" OR
     NEW."scope_key" IS DISTINCT FROM OLD."scope_key" OR
     NEW."factual_release_scope_key" IS DISTINCT FROM OLD."factual_release_scope_key" OR
     NEW."factual_release_id" IS DISTINCT FROM OLD."factual_release_id" OR
     NEW."qualification_report_id" IS DISTINCT FROM OLD."qualification_report_id" OR
     NEW."trade_count" IS DISTINCT FROM OLD."trade_count" OR
     NEW."ready_count" IS DISTINCT FROM OLD."ready_count" OR
     NEW."blocked_count" IS DISTINCT FROM OLD."blocked_count" OR
     NEW."prepared_at" IS DISTINCT FROM OLD."prepared_at" OR
     NEW."content_canonical_json" IS DISTINCT FROM OLD."content_canonical_json" OR
     NEW."prepared_set_canonical_json" IS DISTINCT FROM OLD."prepared_set_canonical_json" OR
     NEW."prepared_set_json" IS DISTINCT FROM OLD."prepared_set_json" OR
     NEW."registered_at" IS DISTINCT FROM OLD."registered_at" OR
     NEW."registered_by" IS DISTINCT FROM OLD."registered_by" THEN
    RAISE EXCEPTION 'Prepared valuation input evidence is append-only';
  END IF;

  SELECT count(*)::integer,
         count(*) FILTER (WHERE "state"='ready')::integer,
         count(*) FILTER (WHERE "state"='blocked')::integer
    INTO actual_count,actual_ready_count,actual_blocked_count
    FROM "outcome_prepared_valuation_input_entry"
    WHERE "prepared_input_set_id"=OLD."prepared_input_set_id";
  IF actual_count IS DISTINCT FROM OLD."trade_count" OR
     actual_ready_count IS DISTINCT FROM OLD."ready_count" OR
     actual_blocked_count IS DISTINCT FROM OLD."blocked_count" THEN
    RAISE EXCEPTION 'Prepared valuation input set cannot finalize without exact entry coverage';
  END IF;

  NEW."finalized_at" := date_trunc('milliseconds',transaction_timestamp());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "reject_outcome_prepared_valuation_input_mutation"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Prepared valuation input evidence is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_prepared_valuation_input_set_validate_insert"
  BEFORE INSERT ON "outcome_prepared_valuation_input_set"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_prepared_valuation_input_set_insert"();
CREATE TRIGGER "outcome_prepared_valuation_input_entry_validate_insert"
  BEFORE INSERT ON "outcome_prepared_valuation_input_entry"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_prepared_valuation_input_entry_insert"();
CREATE TRIGGER "outcome_prepared_valuation_input_set_finalize"
  BEFORE UPDATE ON "outcome_prepared_valuation_input_set"
  FOR EACH ROW EXECUTE FUNCTION "finalize_outcome_prepared_valuation_input_set"();
CREATE TRIGGER "outcome_prepared_valuation_input_set_reject_delete"
  BEFORE DELETE ON "outcome_prepared_valuation_input_set"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_prepared_valuation_input_mutation"();
CREATE TRIGGER "outcome_prepared_valuation_input_entry_append_only"
  BEFORE UPDATE OR DELETE ON "outcome_prepared_valuation_input_entry"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_prepared_valuation_input_mutation"();
