-- Authenticate automated private-evaluation transitions at the PostgreSQL boundary and retain
-- restart-safe cohort-operation authority. This remains non-production and publication-prohibited.

CREATE TABLE "outcome_current_valuation_cohort_operation" (
  "operation_id" TEXT NOT NULL,
  "scope_key" TEXT NOT NULL,
  "factual_release_id" TEXT NOT NULL,
  "factual_release_revision" INTEGER NOT NULL,
  "model_qualification_id" TEXT NOT NULL,
  "model_qualification_work_id" TEXT NOT NULL,
  "model_qualification_revision" INTEGER NOT NULL,
  "expected_prepared_input_revision" INTEGER NOT NULL,
  "captured_at" TIMESTAMPTZ(3) NOT NULL,
  "context_sha256" CHAR(64) NOT NULL,
  "context_canonical_json" TEXT NOT NULL,
  "context_json" JSONB NOT NULL,

  CONSTRAINT "outcome_current_valuation_cohort_operation_pkey" PRIMARY KEY ("operation_id"),
  CONSTRAINT "outcome_current_valuation_cohort_operation_id_check" CHECK (
    "operation_id" ~ '^valuation-cohort-preparation-operation:[a-f0-9]{64}$'
  ),
  CONSTRAINT "outcome_current_valuation_cohort_operation_revision_check" CHECK (
    "factual_release_revision">0 AND "model_qualification_revision">0
    AND "expected_prepared_input_revision">=0
  ),
  CONSTRAINT "outcome_current_valuation_cohort_operation_sha_check" CHECK (
    "context_sha256" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "outcome_current_valuation_cohort_operation_release_fkey"
    FOREIGN KEY ("factual_release_id") REFERENCES "outcome_release_manifest"("release_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_current_valuation_cohort_operation_qualification_fkey"
    FOREIGN KEY ("model_qualification_id")
    REFERENCES "outcome_governed_valuation_model_qualification"("qualification_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_current_valuation_cohort_operation_work_fkey"
    FOREIGN KEY ("model_qualification_work_id")
    REFERENCES "outcome_governed_model_qualification_work"("work_id")
    ON DELETE RESTRICT
);

CREATE TABLE "outcome_current_valuation_cohort_operation_result" (
  "operation_id" TEXT NOT NULL,
  "prepared_input_set_id" TEXT NOT NULL,
  "head_revision" INTEGER NOT NULL,
  "completed_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "outcome_current_valuation_cohort_operation_result_pkey"
    PRIMARY KEY ("operation_id"),
  CONSTRAINT "outcome_current_valuation_cohort_operation_result_prepared_key"
    UNIQUE ("prepared_input_set_id"),
  CONSTRAINT "outcome_current_valuation_cohort_operation_result_revision_check"
    CHECK ("head_revision">0),
  CONSTRAINT "outcome_current_cohort_result_operation_fkey"
    FOREIGN KEY ("operation_id")
    REFERENCES "outcome_current_valuation_cohort_operation"("operation_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_current_cohort_result_prepared_fkey"
    FOREIGN KEY ("prepared_input_set_id")
    REFERENCES "outcome_prepared_valuation_input_set"("prepared_input_set_id") ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION "validate_outcome_current_valuation_input_bundle"(
  bundle JSONB,
  bundle_artifact JSONB,
  requested_scope_key TEXT,
  requested_player_run_id TEXT,
  requested_pick_run_id TEXT,
  requested_player_gate_id TEXT,
  requested_pick_gate_id TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  content JSONB := bundle->'content';
  player_component JSONB := content->'components'->0;
  pick_component JSONB := content->'components'->1;
  player_run RECORD;
  pick_run RECORD;
  parent_ref JSONB;
  created_at TIMESTAMPTZ;
BEGIN
  SELECT * INTO player_run FROM "outcome_governed_valuation_component_run"
   WHERE "run_id"=requested_player_run_id FOR KEY SHARE;
  SELECT * INTO pick_run FROM "outcome_governed_valuation_component_run"
   WHERE "run_id"=requested_pick_run_id FOR KEY SHARE;
  created_at:=(content->>'createdAt')::TIMESTAMPTZ;
  IF jsonb_typeof(bundle)<>'object'
    OR (SELECT count(*) FROM jsonb_object_keys(bundle))<>2
    OR jsonb_typeof(content)<>'object'
    OR (SELECT count(*) FROM jsonb_object_keys(content))<>13
    OR content->>'schemaVersion' IS DISTINCT FROM 'afl-trade-valuation-input-bundle/v1'
    OR content->>'publicAssetBoundary' IS DISTINCT FROM
       'source_native_afl_assets_no_user_or_fantasy_ownership'
    OR content->>'environment' IS DISTINCT FROM 'non_production'
    OR content->>'scopeKey' IS DISTINCT FROM requested_scope_key
    OR content->>'valueUnitId' !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$'
    OR content->'publicationEligible' IS DISTINCT FROM 'false'::JSONB
    OR content->>'limitation' IS DISTINCT FROM
       'Approved calculation inputs only; not execution evidence, numerical validity, publication approval, or activation authority.'
    OR jsonb_typeof(content->'components')<>'array'
    OR jsonb_array_length(content->'components')<>2
    OR (SELECT count(*) FROM jsonb_object_keys(player_component))<>6
    OR (SELECT count(*) FROM jsonb_object_keys(pick_component))<>6
    OR player_component->>'role' IS DISTINCT FROM 'player_contribution_and_availability'
    OR player_component->>'modelKind' IS DISTINCT FROM
       'player_contribution_and_availability'
    OR player_component->>'runId' IS DISTINCT FROM requested_player_run_id
    OR player_component->>'protocolId' IS DISTINCT FROM player_run."protocol_id"
    OR player_component->>'datasetId' IS DISTINCT FROM player_run."dataset_id"
    OR player_component->>'gate3DecisionId' IS DISTINCT FROM requested_player_gate_id
    OR pick_component->>'role' IS DISTINCT FROM
       'draft_pick_and_future_pick_distribution'
    OR pick_component->>'modelKind' IS DISTINCT FROM
       'draft_pick_and_future_pick_distribution'
    OR pick_component->>'runId' IS DISTINCT FROM requested_pick_run_id
    OR pick_component->>'protocolId' IS DISTINCT FROM pick_run."protocol_id"
    OR pick_component->>'datasetId' IS DISTINCT FROM pick_run."dataset_id"
    OR pick_component->>'gate3DecisionId' IS DISTINCT FROM requested_pick_gate_id
    OR player_component->>'protocolId'=pick_component->>'protocolId'
    OR player_component->>'datasetId'=pick_component->>'datasetId'
    OR player_component->>'gate3DecisionId'=pick_component->>'gate3DecisionId'
    OR (SELECT count(*) FROM jsonb_object_keys(content->'viewPolicy'))<>3
    OR (SELECT count(*) FROM jsonb_object_keys(content->'viewPolicy'->'atTrade'))<>2
    OR content->'viewPolicy'->'atTrade'->>'modelVintage' IS DISTINCT FROM
       'historical_restatement'
    OR content->'viewPolicy'->'atTrade'->>'knowledgeCutoff' IS DISTINCT FROM
       'transaction_effective_at_exclusive'
    OR (SELECT count(*) FROM jsonb_object_keys(content->'viewPolicy'->'current'))<>4
    OR content->'viewPolicy'->'current'->>'modelVintage' IS DISTINCT FROM 'current'
    OR (content->'viewPolicy'->'current'->>'effectiveAt')::TIMESTAMPTZ>
       (content->'viewPolicy'->'current'->>'valuationAsOf')::TIMESTAMPTZ
    OR (content->'viewPolicy'->'current'->>'knowledgeCutoffAt')::TIMESTAMPTZ>
       (content->'viewPolicy'->'current'->>'valuationAsOf')::TIMESTAMPTZ
    OR content->'viewPolicy'->'currentViewsShareOneTemporalContext'
       IS DISTINCT FROM 'true'::JSONB
    OR (SELECT count(*) FROM jsonb_object_keys(content->'packagePolicy'))<>8
    OR content->'packagePolicy'->>'calculationUnit' IS DISTINCT FROM
       'complete_multi_party_trade'
    OR content->'packagePolicy'->>'attribution' IS DISTINCT FROM
       'lineage_frontier_exactly_once'
    OR content->'packagePolicy'->>'aggregation' IS DISTINCT FROM
       'joint_simulation_not_independent_point_sum'
    OR content->'packagePolicy'->>'currentOutcomeIdentity' IS DISTINCT FROM
       'realized_club_value_plus_remaining_asset_value'
    OR content->'packagePolicy'->>'unresolvedAssetTreatment' IS DISTINCT FROM
       'exclude_with_explicit_reason_no_fallback_value'
    OR (SELECT count(*) FROM jsonb_object_keys(content->'simulation'))<>10
    OR content->'simulation'->>'mode' IS DISTINCT FROM 'deterministic_counter_sample'
    OR (content->'simulation'->>'draws')::INTEGER NOT BETWEEN 1 AND 100000
    OR content->'simulation'->>'seed' !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$'
    OR content->'simulation'->>'samplingAlgorithmVersion' IS DISTINCT FROM
       'counter_sha256_rejection_v1'
    OR (content->'simulation'->>'centralIntervalLevel')::NUMERIC<>0.8
    OR (content->'simulation'->>'downsideQuantile')::NUMERIC<>0.1
    OR (content->'simulation'->>'upsideQuantile')::NUMERIC<>0.9
    OR bundle->>'valuationInputBundleId' IS DISTINCT FROM 'valuation-input-bundle:' ||
       encode(sha256(convert_to(outcome_afl_trade_canonical_json(content),'UTF8')),'hex')
    OR bundle_artifact->>'contentSha256' IS DISTINCT FROM
       encode(sha256(convert_to(outcome_afl_trade_canonical_json(bundle),'UTF8')),'hex')
    OR (bundle_artifact->>'byteLength')::BIGINT IS DISTINCT FROM
       octet_length(convert_to(outcome_afl_trade_canonical_json(bundle),'UTF8'))
    OR (bundle_artifact->>'createdAt')::TIMESTAMPTZ IS DISTINCT FROM created_at
    OR validate_outcome_prepared_valuation_input_v2_artifact(
         bundle_artifact,'non_production'::"OutcomeEnvironment"
       ) IS DISTINCT FROM TRUE
  THEN RETURN FALSE;
  END IF;
  FOR parent_ref IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
    content->'packagePolicy'->'listSpotPolicyArtifact',
    content->'packagePolicy'->'scarcityPolicyArtifact',
    content->'packagePolicy'->'roleCongestionPolicyArtifact',
    content->'simulation'->'lowReturnDefinitionArtifact',
    content->'simulation'->'eliteOutcomeDefinitionArtifact',
    content->'simulation'->'practicalEquivalenceDefinitionArtifact',
    content->'explanationPolicyArtifact'
  )) LOOP
    IF validate_outcome_prepared_valuation_input_v2_artifact(
         parent_ref,'non_production'::"OutcomeEnvironment"
       ) IS DISTINCT FROM TRUE
      OR (parent_ref->>'createdAt')::TIMESTAMPTZ>created_at
    THEN RETURN FALSE;
    END IF;
  END LOOP;
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END $$;

CREATE OR REPLACE FUNCTION "validate_outcome_current_valuation_cohort_operation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  identity_json JSONB;
  release_row RECORD;
  active_release_row RECORD;
  model_pair_row RECORD;
  qualification_row RECORD;
  qualification_work_row RECORD;
  source_qualification_row RECORD;
  prepared_head_revision INTEGER;
  release_canonical_text TEXT;
  membership_canonical_text TEXT;
  source_qualification_canonical_text TEXT;
  bundle_canonical_text TEXT;
  expected_trade_ids JSONB;
  expected_release_artifact JSONB;
  expected_membership_artifact JSONB;
  expected_source_qualification_artifact JSONB;
  bundle JSONB;
BEGIN
  identity_json:=jsonb_build_object(
    'scopeKey',NEW."scope_key",
    'factualReleaseId',NEW."factual_release_id",
    'factualReleaseRevision',NEW."factual_release_revision",
    'modelQualificationId',NEW."model_qualification_id",
    'modelQualificationWorkId',NEW."model_qualification_work_id",
    'modelQualificationRevision',NEW."model_qualification_revision",
    'expectedPreparedInputRevision',NEW."expected_prepared_input_revision"
  );
  SELECT * INTO release_row FROM "outcome_release_manifest"
   WHERE "release_id"=NEW."factual_release_id" FOR KEY SHARE;
  SELECT * INTO active_release_row FROM "outcome_active_release"
   WHERE "scope_key"=NEW."context_json"->>'factualReleaseScopeKey' FOR KEY SHARE;
  SELECT * INTO model_pair_row FROM "outcome_current_governed_valuation_model_pair"
   WHERE "scope_key"=NEW."scope_key" FOR KEY SHARE;
  SELECT * INTO qualification_row FROM "outcome_governed_valuation_model_qualification"
   WHERE "qualification_id"=NEW."model_qualification_id" FOR KEY SHARE;
  SELECT * INTO qualification_work_row FROM "outcome_governed_model_qualification_work"
   WHERE "work_id"=NEW."model_qualification_work_id" FOR KEY SHARE;
  SELECT * INTO source_qualification_row FROM "outcome_valuation_source_qualification_report"
   WHERE "qualification_report_id"=NEW."context_json"->>'sourceQualificationReportId'
   FOR KEY SHARE;
  SELECT COALESCE("revision",0) INTO prepared_head_revision
    FROM "outcome_current_prepared_valuation_input_set"
   WHERE "scope_key"=NEW."scope_key" FOR KEY SHARE;
  prepared_head_revision:=COALESCE(prepared_head_revision,0);

  release_canonical_text:=outcome_afl_trade_canonical_json(release_row."manifest_json");
  membership_canonical_text:=outcome_afl_trade_canonical_json(
    release_row."manifest_json"->'content'->'canonicalMembers'
  );
  source_qualification_canonical_text:=outcome_afl_trade_canonical_json(
    source_qualification_row."report_json"
  );
  SELECT jsonb_agg(to_jsonb(member->>'canonicalRecordId') ORDER BY member->>'canonicalRecordId')
    INTO expected_trade_ids
    FROM jsonb_array_elements(
      release_row."manifest_json"->'content'->'canonicalMembers'
    ) members(member)
   WHERE member->>'recordKind'='transaction';
  expected_release_artifact:=jsonb_build_object(
    'artifactId','artifact:'||encode(sha256(convert_to(release_canonical_text,'UTF8')),'hex'),
    'contentSha256',encode(sha256(convert_to(release_canonical_text,'UTF8')),'hex'),
    'storageUri','artifact://sha256/'||encode(sha256(convert_to(release_canonical_text,'UTF8')),'hex'),
    'mediaType','application/json',
    'byteLength',octet_length(convert_to(release_canonical_text,'UTF8')),
    'createdAt',to_char(release_row."created_at" AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  expected_membership_artifact:=jsonb_build_object(
    'artifactId','artifact:'||encode(sha256(convert_to(membership_canonical_text,'UTF8')),'hex'),
    'contentSha256',encode(sha256(convert_to(membership_canonical_text,'UTF8')),'hex'),
    'storageUri','artifact://sha256/'||encode(sha256(convert_to(membership_canonical_text,'UTF8')),'hex'),
    'mediaType','application/json',
    'byteLength',octet_length(convert_to(membership_canonical_text,'UTF8')),
    'createdAt',to_char(release_row."created_at" AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  expected_source_qualification_artifact:=jsonb_build_object(
    'artifactId','artifact:'||encode(sha256(convert_to(source_qualification_canonical_text,'UTF8')),'hex'),
    'contentSha256',encode(sha256(convert_to(source_qualification_canonical_text,'UTF8')),'hex'),
    'storageUri','artifact://sha256/'||encode(sha256(convert_to(source_qualification_canonical_text,'UTF8')),'hex'),
    'mediaType','application/json',
    'byteLength',octet_length(convert_to(source_qualification_canonical_text,'UTF8')),
    'createdAt',to_char(source_qualification_row."finalized_at" AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  bundle:=NEW."context_json"->'valuationInputBundle';
  bundle_canonical_text:=outcome_afl_trade_canonical_json(bundle);
  IF release_row."release_id" IS NULL
    OR release_row."scope_key" IS DISTINCT FROM NEW."context_json"->>'factualReleaseScopeKey'
    OR active_release_row."release_id" IS DISTINCT FROM NEW."factual_release_id"
    OR active_release_row."revision" IS DISTINCT FROM NEW."factual_release_revision"
    OR NEW."context_json"->'factualReleaseArtifact' IS DISTINCT FROM expected_release_artifact
    OR NEW."context_json"->'releaseMembershipArtifact' IS DISTINCT FROM expected_membership_artifact
    OR NEW."context_json"->'releaseTradeIds' IS DISTINCT FROM expected_trade_ids
  THEN RAISE EXCEPTION 'Current valuation cohort factual release authority mismatch'; END IF;
  IF source_qualification_row."qualification_report_id" IS NULL
    OR source_qualification_row."valuation_scope_key" IS DISTINCT FROM NEW."scope_key"
    OR source_qualification_row."factual_release_id" IS DISTINCT FROM NEW."factual_release_id"
    OR NEW."context_json"->'sourceQualificationReportArtifact'
       IS DISTINCT FROM expected_source_qualification_artifact
    OR NEW."context_json"->'sourceQualificationEvidenceRefs'
       IS DISTINCT FROM source_qualification_row."report_json"->'content'->'sourceRightsEvidenceRefs'
  THEN RAISE EXCEPTION 'Current valuation cohort source qualification authority mismatch'; END IF;
  IF model_pair_row."revision" IS DISTINCT FROM NEW."model_qualification_revision"
    OR model_pair_row."qualification_id" IS DISTINCT FROM NEW."model_qualification_id"
    OR model_pair_row."work_id" IS DISTINCT FROM NEW."model_qualification_work_id"
    OR qualification_row."outcome" IS DISTINCT FROM 'qualified'
    OR qualification_work_row."qualification_id" IS DISTINCT FROM NEW."model_qualification_id"
    OR prepared_head_revision IS DISTINCT FROM NEW."expected_prepared_input_revision"
  THEN RAISE EXCEPTION 'Current valuation cohort model or head authority mismatch'; END IF;
  IF bundle->>'valuationInputBundleId' IS DISTINCT FROM
       NEW."context_json"->>'valuationInputBundleId'
    OR bundle->>'valuationInputBundleId' IS DISTINCT FROM 'valuation-input-bundle:' ||
       encode(sha256(convert_to(outcome_afl_trade_canonical_json(bundle->'content'),'UTF8')),'hex')
    OR bundle->'content'->>'scopeKey' IS DISTINCT FROM NEW."scope_key"
    OR bundle->'content'->'components'->0->>'runId' IS DISTINCT FROM model_pair_row."player_run_id"
    OR bundle->'content'->'components'->1->>'runId' IS DISTINCT FROM model_pair_row."pick_run_id"
    OR NEW."context_json"->'valuationInputBundleArtifact'->>'contentSha256'
       IS DISTINCT FROM encode(sha256(convert_to(bundle_canonical_text,'UTF8')),'hex')
    OR (NEW."context_json"->'valuationInputBundleArtifact'->>'byteLength')::INTEGER
       IS DISTINCT FROM octet_length(convert_to(bundle_canonical_text,'UTF8'))
  THEN RAISE EXCEPTION 'Current valuation cohort valuation bundle authority mismatch'; END IF;
  IF NEW."context_canonical_json" IS DISTINCT FROM
       outcome_afl_trade_canonical_json(NEW."context_json")
    OR NEW."context_sha256" IS DISTINCT FROM encode(sha256(convert_to(
       NEW."context_canonical_json",'UTF8')),'hex')
    OR NEW."operation_id" IS DISTINCT FROM 'valuation-cohort-preparation-operation:' ||
       encode(sha256(convert_to(outcome_afl_trade_canonical_json(identity_json),'UTF8')),'hex')
    OR NEW."context_json"->>'operationId' IS DISTINCT FROM NEW."operation_id"
    OR NEW."context_json"->>'scopeKey' IS DISTINCT FROM NEW."scope_key"
    OR NEW."context_json"->>'factualReleaseId' IS DISTINCT FROM NEW."factual_release_id"
    OR (NEW."context_json"->>'factualReleaseRevision')::INTEGER
       IS DISTINCT FROM NEW."factual_release_revision"
    OR NEW."context_json"->>'modelQualificationId'
       IS DISTINCT FROM NEW."model_qualification_id"
    OR NEW."context_json"->>'modelQualificationWorkId'
       IS DISTINCT FROM NEW."model_qualification_work_id"
    OR (NEW."context_json"->>'modelQualificationRevision')::INTEGER
       IS DISTINCT FROM NEW."model_qualification_revision"
    OR (NEW."context_json"->>'expectedPreparedInputRevision')::INTEGER
       IS DISTINCT FROM NEW."expected_prepared_input_revision"
    OR (NEW."context_json"->>'capturedAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."captured_at"
    OR (SELECT count(*) FROM jsonb_object_keys(NEW."context_json"))<>21
    OR release_row."release_id" IS NULL
    OR release_row."scope_key" IS DISTINCT FROM NEW."context_json"->>'factualReleaseScopeKey'
    OR release_row."environment" IS DISTINCT FROM 'non_production'
    OR active_release_row."release_id" IS DISTINCT FROM NEW."factual_release_id"
    OR active_release_row."revision" IS DISTINCT FROM NEW."factual_release_revision"
    OR NEW."context_json"->'factualReleaseArtifact' IS DISTINCT FROM expected_release_artifact
    OR NEW."context_json"->'releaseMembershipArtifact' IS DISTINCT FROM expected_membership_artifact
    OR NEW."context_json"->'releaseTradeIds' IS DISTINCT FROM expected_trade_ids
    OR validate_outcome_prepared_valuation_input_v2_artifact(
         NEW."context_json"->'factualReleaseArtifact','non_production'::"OutcomeEnvironment"
       ) IS DISTINCT FROM TRUE
    OR validate_outcome_prepared_valuation_input_v2_artifact(
         NEW."context_json"->'releaseMembershipArtifact','non_production'::"OutcomeEnvironment"
       ) IS DISTINCT FROM TRUE
    OR source_qualification_row."qualification_report_id" IS NULL
    OR source_qualification_row."valuation_scope_key" IS DISTINCT FROM NEW."scope_key"
    OR source_qualification_row."factual_release_scope_key" IS DISTINCT FROM release_row."scope_key"
    OR source_qualification_row."factual_release_id" IS DISTINCT FROM NEW."factual_release_id"
    OR source_qualification_row."decision_state" IS DISTINCT FROM 'eligible_for_dataset_admission'
    OR source_qualification_row."report_json"->'content'->'releaseTradeIds'
       IS DISTINCT FROM expected_trade_ids
    OR NEW."context_json"->'sourceQualificationReportArtifact'
       IS DISTINCT FROM expected_source_qualification_artifact
    OR NEW."context_json"->'sourceQualificationEvidenceRefs'
       IS DISTINCT FROM source_qualification_row."report_json"->'content'->'sourceRightsEvidenceRefs'
    OR EXISTS (
      SELECT 1
        FROM jsonb_array_elements(
          NEW."context_json"->'sourceQualificationEvidenceRefs'
        ) evidence(reference)
       WHERE validate_outcome_prepared_valuation_input_v2_artifact(
         evidence.reference,'non_production'::"OutcomeEnvironment"
       ) IS DISTINCT FROM TRUE
    )
    OR validate_outcome_prepared_valuation_input_v2_artifact(
         NEW."context_json"->'sourceQualificationReportArtifact',
         'non_production'::"OutcomeEnvironment"
       ) IS DISTINCT FROM TRUE
    OR model_pair_row."revision" IS DISTINCT FROM NEW."model_qualification_revision"
    OR model_pair_row."qualification_id" IS DISTINCT FROM NEW."model_qualification_id"
    OR model_pair_row."work_id" IS DISTINCT FROM NEW."model_qualification_work_id"
    OR model_pair_row."player_run_id" IS DISTINCT FROM NEW."context_json"->>'playerRunId'
    OR model_pair_row."pick_run_id" IS DISTINCT FROM NEW."context_json"->>'pickRunId'
    OR qualification_row."scope_key" IS DISTINCT FROM NEW."scope_key"
    OR qualification_row."outcome" IS DISTINCT FROM 'qualified'
    OR qualification_row."player_run_id" IS DISTINCT FROM model_pair_row."player_run_id"
    OR qualification_row."pick_run_id" IS DISTINCT FROM model_pair_row."pick_run_id"
    OR qualification_work_row."scope_key" IS DISTINCT FROM NEW."scope_key"
    OR qualification_work_row."qualification_id" IS DISTINCT FROM NEW."model_qualification_id"
    OR prepared_head_revision IS DISTINCT FROM NEW."expected_prepared_input_revision"
    OR bundle->>'valuationInputBundleId' IS DISTINCT FROM
       NEW."context_json"->>'valuationInputBundleId'
    OR bundle->>'valuationInputBundleId' IS DISTINCT FROM 'valuation-input-bundle:' ||
       encode(sha256(convert_to(outcome_afl_trade_canonical_json(bundle->'content'),'UTF8')),'hex')
    OR bundle->'content'->>'schemaVersion' IS DISTINCT FROM
       'afl-trade-valuation-input-bundle/v1'
    OR bundle->'content'->>'environment' IS DISTINCT FROM 'non_production'
    OR bundle->'content'->>'scopeKey' IS DISTINCT FROM NEW."scope_key"
    OR bundle->'content'->'publicationEligible' IS DISTINCT FROM 'false'::JSONB
    OR bundle->'content'->'components'->0->>'role' IS DISTINCT FROM
       'player_contribution_and_availability'
    OR bundle->'content'->'components'->0->>'runId' IS DISTINCT FROM
       model_pair_row."player_run_id"
    OR bundle->'content'->'components'->1->>'role' IS DISTINCT FROM
       'draft_pick_and_future_pick_distribution'
    OR bundle->'content'->'components'->1->>'runId' IS DISTINCT FROM
       model_pair_row."pick_run_id"
    OR NEW."context_json"->'valuationInputBundleArtifact'->>'contentSha256'
       IS DISTINCT FROM encode(sha256(convert_to(bundle_canonical_text,'UTF8')),'hex')
    OR (NEW."context_json"->'valuationInputBundleArtifact'->>'byteLength')::INTEGER
       IS DISTINCT FROM octet_length(convert_to(bundle_canonical_text,'UTF8'))
    OR validate_outcome_prepared_valuation_input_v2_artifact(
         NEW."context_json"->'valuationInputBundleArtifact',
         'non_production'::"OutcomeEnvironment"
       ) IS DISTINCT FROM TRUE
    OR (NEW."context_json"->'valuationInputBundleArtifact'->>'createdAt')::TIMESTAMPTZ
       IS DISTINCT FROM (bundle->'content'->>'createdAt')::TIMESTAMPTZ
    OR (NEW."context_json"->'valuationInputBundleArtifact'->>'createdAt')::TIMESTAMPTZ
       > NEW."captured_at"
    OR validate_outcome_current_valuation_input_bundle(
         bundle,
         NEW."context_json"->'valuationInputBundleArtifact',
         NEW."scope_key",
         model_pair_row."player_run_id",
         model_pair_row."pick_run_id",
         model_pair_row."player_gate3_decision_id",
         model_pair_row."pick_gate3_decision_id"
       ) IS DISTINCT FROM TRUE
  THEN
    RAISE EXCEPTION 'Current valuation cohort operation identity disagrees with its context';
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Current valuation cohort operation contains invalid typed context';
END $$;

CREATE TRIGGER "outcome_current_valuation_cohort_operation_validate"
BEFORE INSERT ON "outcome_current_valuation_cohort_operation"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_current_valuation_cohort_operation"();

CREATE OR REPLACE FUNCTION "reject_outcome_current_valuation_cohort_operation_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Current valuation cohort operation records are append-only';
END $$;

CREATE TRIGGER "outcome_current_valuation_cohort_operation_append_only"
BEFORE UPDATE OR DELETE ON "outcome_current_valuation_cohort_operation"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_current_valuation_cohort_operation_mutation"();
CREATE TRIGGER "outcome_current_valuation_cohort_result_append_only"
BEFORE UPDATE OR DELETE ON "outcome_current_valuation_cohort_operation_result"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_current_valuation_cohort_operation_mutation"();

CREATE OR REPLACE FUNCTION "validate_outcome_current_valuation_cohort_result"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  operation RECORD;
  head RECORD;
BEGIN
  SELECT * INTO operation FROM "outcome_current_valuation_cohort_operation"
   WHERE "operation_id"=NEW."operation_id" FOR KEY SHARE;
  SELECT * INTO head FROM "outcome_current_prepared_valuation_input_set"
   WHERE "scope_key"=operation."scope_key" FOR KEY SHARE;
  IF operation."operation_id" IS NULL
    OR NEW."head_revision" IS DISTINCT FROM
       operation."expected_prepared_input_revision"+1
    OR head."prepared_input_set_id" IS DISTINCT FROM NEW."prepared_input_set_id"
    OR head."revision" IS DISTINCT FROM NEW."head_revision"
    OR head."activated_at" IS DISTINCT FROM NEW."completed_at"
  THEN
    RAISE EXCEPTION 'Current valuation cohort result does not match its exact activated head';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_current_valuation_cohort_result_validate"
BEFORE INSERT ON "outcome_current_valuation_cohort_operation_result"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_current_valuation_cohort_result"();

CREATE OR REPLACE FUNCTION "validate_outcome_automated_ready_calculation_authority"(
  authority JSONB, requested_scope_key TEXT, requested_trade_id TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  prepared_head RECORD;
  prepared_set RECORD;
  prepared_entry RECORD;
  manifest RECORD;
  model_pair RECORD;
  qualification RECORD;
  player_component RECORD;
  pick_component RECORD;
  player_gate RECORD;
  pick_gate RECORD;
BEGIN
  SELECT * INTO prepared_head FROM "outcome_current_prepared_valuation_input_set"
   WHERE "scope_key"=requested_scope_key FOR KEY SHARE;
  SELECT * INTO prepared_set FROM "outcome_prepared_valuation_input_set"
   WHERE "prepared_input_set_id"=authority->>'preparedInputSetId' FOR KEY SHARE;
  SELECT * INTO prepared_entry FROM "outcome_prepared_valuation_input_entry"
   WHERE "prepared_input_set_id"=authority->>'preparedInputSetId'
     AND "trade_id"=requested_trade_id FOR KEY SHARE;
  SELECT * INTO manifest FROM "outcome_private_evaluation_materialization_manifest"
   WHERE "materialization_manifest_id"=authority->>'materializationManifestId'
   FOR KEY SHARE;
  SELECT * INTO model_pair FROM "outcome_current_governed_valuation_model_pair"
   WHERE "scope_key"=requested_scope_key FOR KEY SHARE;
  SELECT * INTO qualification FROM "outcome_governed_valuation_model_qualification"
   WHERE "qualification_id"=model_pair."qualification_id" FOR KEY SHARE;
  SELECT * INTO player_component FROM "outcome_governed_valuation_component_run"
   WHERE "run_id"=model_pair."player_run_id" FOR KEY SHARE;
  SELECT * INTO pick_component FROM "outcome_governed_valuation_component_run"
   WHERE "run_id"=model_pair."pick_run_id" FOR KEY SHARE;
  SELECT * INTO player_gate FROM "outcome_gate_decision"
   WHERE "decision_id"=model_pair."player_gate3_decision_id" FOR KEY SHARE;
  SELECT * INTO pick_gate FROM "outcome_gate_decision"
   WHERE "decision_id"=model_pair."pick_gate3_decision_id" FOR KEY SHARE;
  RETURN COALESCE(
    jsonb_typeof(authority)='object'
    AND (SELECT count(*) FROM jsonb_object_keys(authority))=14
    AND jsonb_typeof(authority->'components')='array'
    AND jsonb_array_length(authority->'components')=2
    AND jsonb_typeof(authority->'components'->0)='object'
    AND jsonb_typeof(authority->'components'->1)='object'
    AND (SELECT count(*) FROM jsonb_object_keys(authority->'components'->0))=10
    AND (SELECT count(*) FROM jsonb_object_keys(authority->'components'->1))=10
    AND authority->>'state'='ready'
    AND prepared_head."prepared_input_set_id"=authority->>'preparedInputSetId'
    AND prepared_head."revision"=(authority->>'preparedInputHeadRevision')::INTEGER
    AND prepared_set."schema_version"='afl-trade-prepared-valuation-input-set/v3'
    AND prepared_set."finalized_at" IS NOT NULL
    AND prepared_entry."state"='ready'
    AND prepared_entry."entry_json"->>'materializationManifestId'=
        authority->>'materializationManifestId'
    AND manifest."valuation_scope_key"=requested_scope_key
    AND manifest."trade_id"=requested_trade_id
    AND manifest."artifact_id"=authority->'materializationManifestArtifact'->>'artifactId'
    AND manifest."manifest_json"->'content'->>'valuationInputBundleId'=
        authority->>'valuationInputBundleId'
    AND manifest."manifest_json"->'content'->'valuationInputBundleArtifact'=
        authority->'valuationInputBundleArtifact'
    AND model_pair."qualification_id"=authority->'components'->0->>'qualificationId'
    AND model_pair."qualification_id"=authority->'components'->1->>'qualificationId'
    AND qualification."outcome"='qualified'
    AND authority->'components'->0->>'qualificationPolicyVersion'=
        qualification."qualification_json"->'content'->'policy'->>'policyVersion'
    AND authority->'components'->1->>'qualificationPolicyVersion'=
        qualification."qualification_json"->'content'->'policy'->>'policyVersion'
    AND model_pair."player_run_id"=authority->'components'->0->>'runId'
    AND model_pair."pick_run_id"=authority->'components'->1->>'runId'
    AND authority->'components'->0->>'role'='player_contribution_and_availability'
    AND authority->'components'->1->>'role'='draft_pick_and_future_pick_distribution'
    AND authority->'components'->0->>'protocolId'=player_component."protocol_id"
    AND authority->'components'->1->>'protocolId'=pick_component."protocol_id"
    AND authority->'components'->0->>'datasetId'=player_component."dataset_id"
    AND authority->'components'->1->>'datasetId'=pick_component."dataset_id"
    AND authority->'components'->0->>'datasetAdmissionId'=
        player_component."dataset_admission_id"
    AND authority->'components'->1->>'datasetAdmissionId'=
        pick_component."dataset_admission_id"
    AND (authority->'components'->0->>'datasetAdmissionGateLedgerRevision')::INTEGER=
        player_component."dataset_admission_gate_ledger_revision"
    AND (authority->'components'->1->>'datasetAdmissionGateLedgerRevision')::INTEGER=
        pick_component."dataset_admission_gate_ledger_revision"
    AND authority->'components'->0->>'gate3DecisionId'=player_gate."decision_id"
    AND authority->'components'->1->>'gate3DecisionId'=pick_gate."decision_id"
    AND (authority->'components'->0->>'gate3DecisionVersion')::INTEGER=
        player_gate."version"
    AND (authority->'components'->1->>'gate3DecisionVersion')::INTEGER=
        pick_gate."version"
    AND player_gate."gate"='gate_3_model_approval'
    AND pick_gate."gate"='gate_3_model_approval'
    AND player_gate."environment"='non_production'::"OutcomeEnvironment"
    AND pick_gate."environment"='non_production'::"OutcomeEnvironment"
    AND player_gate."state"='approved'
    AND pick_gate."state"='approved'
    AND NOT EXISTS (SELECT 1 FROM "outcome_gate_decision" successor
      WHERE successor."supersedes_decision_id"=player_gate."decision_id")
    AND NOT EXISTS (SELECT 1 FROM "outcome_gate_decision" successor
      WHERE successor."supersedes_decision_id"=pick_gate."decision_id")
    AND validate_outcome_prepared_valuation_input_v2_artifact(
      authority->'materializationManifestArtifact','non_production'::"OutcomeEnvironment"
    )
    AND validate_outcome_prepared_valuation_input_v2_artifact(
      authority->'valuationInputBundleArtifact','non_production'::"OutcomeEnvironment"
    ),FALSE);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN FALSE;
END $$;

CREATE OR REPLACE FUNCTION "validate_outcome_automated_private_intent"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  content JSONB := NEW."intent_json"->'content';
  custody RECORD;
  snapshot RECORD;
  inspection RECORD;
  snapshot_custody RECORD;
  inspection_custody RECORD;
  prior_transition_id TEXT;
  operator_authority_id TEXT;
BEGIN
  IF content->>'schemaVersion' NOT IN (
    'private-evaluation-transition-intent/v1','private-evaluation-transition-intent/v2'
  ) THEN
    RAISE EXCEPTION 'Unsupported private evaluation intent schema version';
  END IF;
  SELECT * INTO custody FROM "outcome_artifact_custody"
   WHERE "artifact_id"=NEW."artifact_id" FOR KEY SHARE;
  SELECT * INTO snapshot FROM "outcome_private_evaluation_authority_snapshot"
   WHERE "snapshot_id"=NEW."authority_snapshot_id" FOR KEY SHARE;
  SELECT * INTO inspection FROM "outcome_private_evaluation_inspection_receipt"
   WHERE "inspection_id"=NEW."inspection_id" FOR KEY SHARE;
  SELECT * INTO snapshot_custody FROM "outcome_artifact_custody"
   WHERE "artifact_id"=snapshot."artifact_id" FOR KEY SHARE;
  SELECT * INTO inspection_custody FROM "outcome_artifact_custody"
   WHERE "artifact_id"=inspection."artifact_id" FOR KEY SHARE;
  SELECT "last_transition_id" INTO prior_transition_id
    FROM "outcome_local_private_trade_evaluation_head"
   WHERE "valuation_scope_key"=NEW."valuation_scope_key" AND "trade_id"=NEW."trade_id"
   FOR KEY SHARE;
  IF content->>'schemaVersion'='private-evaluation-transition-intent/v1' THEN
    SELECT authority."authority_evidence_id" INTO operator_authority_id
      FROM "outcome_operational_principal_authority" authority
      JOIN "outcome_governed_evidence_reference" evidence
        ON evidence."reference_id"=authority."authority_evidence_id"
      JOIN "outcome_review_decision" approval
        ON approval."decision_id"=evidence."approval_decision_id"
     WHERE authority."principal_ref"=content->'review'->>'principalId'
       AND authority."role"='afl_trade_private_evaluation_operator'
       AND authority."scope_key"=NEW."valuation_scope_key"
       AND authority."provider"='statly_modeling'
       AND authority."capability_id"='manage_private_trade_evaluation'
       AND authority."competition"='AFLM'
       AND authority."valid_from"<=NEW."requested_at"
       AND (authority."valid_through" IS NULL OR
            authority."valid_through">NEW."requested_at")
       AND evidence."environment"='test_fixture'::"OutcomeEnvironment"
       AND evidence."status"='approved'::"OutcomeRecordStatus"
       AND approval."decision"='approved'
       AND NOT EXISTS (
         SELECT 1 FROM "outcome_review_decision" successor
          WHERE successor."supersedes_decision_id"=approval."decision_id"
       )
     LIMIT 1;
    IF custody."artifact_id" IS NULL
      OR operator_authority_id IS NULL
      OR inspection."inspection_id" IS NULL
      OR content->>'environment' IS DISTINCT FROM 'test_fixture'
      OR content->'publicationProhibited' IS DISTINCT FROM 'true'::JSONB
      OR (SELECT count(*) FROM jsonb_object_keys(NEW."intent_json"))<>2
      OR (SELECT count(*) FROM jsonb_object_keys(content))<>13
      OR content->>'limitation' IS DISTINCT FROM
         'Private test-fixture lifecycle evidence only; it grants no factual, model, production, or publication authority.'
      OR content->'selector'->>'valuationScopeKey' IS DISTINCT FROM NEW."valuation_scope_key"
      OR content->'selector'->>'tradeId' IS DISTINCT FROM NEW."trade_id"
      OR content->>'inspectionId' IS DISTINCT FROM NEW."inspection_id"
      OR content->>'authoritySnapshotId' IS DISTINCT FROM NEW."authority_snapshot_id"
      OR content->>'operationId' IS DISTINCT FROM NEW."operation_id"
      OR content->'action'->>'kind' IS DISTINCT FROM NEW."action"
      OR content->'expectedHead'->>'status' IS DISTINCT FROM NEW."expected_head_status"
      OR (content->'expectedHead'->>'revision')::INTEGER
         IS DISTINCT FROM NEW."expected_head_revision"
      OR content->'expectedHead'->>'generationId'
         IS DISTINCT FROM NEW."expected_head_generation_id"
      OR content->'action'->>'targetGenerationId' IS DISTINCT FROM NEW."target_generation_id"
      OR (content->>'requestedAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."requested_at"
      OR (content->>'expiresAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."expires_at"
      OR content->'review' IS NULL
      OR (SELECT count(*) FROM jsonb_object_keys(content->'review'))<>2
      OR NEW."content_canonical_json" IS DISTINCT FROM outcome_afl_trade_canonical_json(content)
      OR NEW."content_sha256" IS DISTINCT FROM encode(sha256(convert_to(
         NEW."content_canonical_json",'UTF8')),'hex')
      OR NEW."transition_intent_id" IS DISTINCT FROM
         'private-evaluation-transition-intent:'||NEW."content_sha256"
      OR NEW."intent_json"->>'transitionIntentId' IS DISTINCT FROM NEW."transition_intent_id"
      OR custody."content_sha256" IS DISTINCT FROM substring(NEW."artifact_id" FROM 10)
      OR custody."storage_uri" IS DISTINCT FROM 'artifact://sha256/'||custody."content_sha256"
      OR custody."media_type" IS DISTINCT FROM 'application/json'
      OR custody."byte_length" IS DISTINCT FROM octet_length(convert_to(
         outcome_afl_trade_canonical_json(NEW."intent_json"),'UTF8'))
      OR custody."environment" IS DISTINCT FROM 'test_fixture'::"OutcomeEnvironment"
      OR custody."created_at" IS DISTINCT FROM NEW."requested_at"
      OR inspection."valuation_scope_key" IS DISTINCT FROM NEW."valuation_scope_key"
      OR inspection."trade_id" IS DISTINCT FROM NEW."trade_id"
      OR inspection."content_canonical_json" IS DISTINCT FROM
         outcome_afl_trade_canonical_json(inspection."receipt_json"->'content')
      OR inspection."content_sha256" IS DISTINCT FROM encode(sha256(convert_to(
         inspection."content_canonical_json",'UTF8')),'hex')
      OR inspection_custody."content_sha256" IS DISTINCT FROM
         substring(inspection."artifact_id" FROM 10)
    THEN
      RAISE EXCEPTION 'Legacy private intent failed exact test-fixture authentication';
    END IF;
    RETURN NEW;
  END IF;
  IF custody."artifact_id" IS NULL
    OR snapshot."snapshot_id" IS NULL
    OR inspection."inspection_id" IS NULL
    OR content->>'environment' IS DISTINCT FROM 'non_production'
    OR content->'publicationProhibited' IS DISTINCT FROM 'true'::JSONB
    OR (SELECT count(*) FROM jsonb_object_keys(NEW."intent_json"))<>2
    OR (SELECT count(*) FROM jsonb_object_keys(content))<>13
    OR content->>'limitation' IS DISTINCT FROM
       'Automated private calculation only; it grants no source approval, production, publication, withdrawal, rollback, or recovery authority.'
    OR content->'action'->>'kind' IS DISTINCT FROM 'construct_and_activate'
    OR content->'constructionAuthority'->>'kind'
       IS DISTINCT FROM 'automated_private_calculation_agent'
    OR content->'constructionAuthority'->>'principalId'
       IS DISTINCT FROM 'system:weekly-valuation-coordinator'
    OR content->'selector'->>'valuationScopeKey' IS DISTINCT FROM NEW."valuation_scope_key"
    OR content->'selector'->>'tradeId' IS DISTINCT FROM NEW."trade_id"
    OR content->>'inspectionId' IS DISTINCT FROM NEW."inspection_id"
    OR content->>'authoritySnapshotId' IS DISTINCT FROM NEW."authority_snapshot_id"
    OR content->>'operationId' IS DISTINCT FROM NEW."operation_id"
    OR content->'expectedHead'->>'status' IS DISTINCT FROM NEW."expected_head_status"
    OR (content->'expectedHead'->>'revision')::INTEGER
       IS DISTINCT FROM NEW."expected_head_revision"
    OR content->'expectedHead'->>'generationId'
       IS DISTINCT FROM NEW."expected_head_generation_id"
    OR (content->>'requestedAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."requested_at"
    OR (content->>'expiresAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."expires_at"
    OR NEW."target_generation_id" IS NOT NULL
  THEN
    RAISE EXCEPTION 'Automated private intent has invalid shape or column binding';
  END IF;
  IF NEW."content_canonical_json" IS DISTINCT FROM outcome_afl_trade_canonical_json(content)
    OR NEW."content_sha256" IS DISTINCT FROM encode(sha256(convert_to(
       NEW."content_canonical_json",'UTF8')),'hex')
    OR NEW."transition_intent_id" IS DISTINCT FROM 'private-evaluation-transition-intent:' ||
       NEW."content_sha256"
    OR NEW."intent_json"->>'transitionIntentId' IS DISTINCT FROM NEW."transition_intent_id"
  THEN
    RAISE EXCEPTION 'Automated private intent has invalid content address';
  END IF;
  IF custody."content_sha256" IS DISTINCT FROM substring(NEW."artifact_id" FROM 10)
    OR custody."storage_uri" IS DISTINCT FROM 'artifact://sha256/' || custody."content_sha256"
    OR custody."media_type" IS DISTINCT FROM 'application/json'
    OR custody."byte_length" IS DISTINCT FROM octet_length(convert_to(
       outcome_afl_trade_canonical_json(NEW."intent_json"),'UTF8'))
    OR custody."environment" IS DISTINCT FROM 'non_production'::"OutcomeEnvironment"
    OR custody."created_at" IS DISTINCT FROM NEW."requested_at"
  THEN
    RAISE EXCEPTION 'Automated private intent has invalid artifact custody';
  END IF;
  IF snapshot."valuation_scope_key" IS DISTINCT FROM NEW."valuation_scope_key"
    OR snapshot."trade_id" IS DISTINCT FROM NEW."trade_id"
    OR snapshot."content_canonical_json" IS DISTINCT FROM
       outcome_afl_trade_canonical_json(snapshot."snapshot_json"->'content')
    OR snapshot."snapshot_json"->'content'->>'schemaVersion'
       IS DISTINCT FROM 'private-evaluation-authority-snapshot/v3'
    OR snapshot."snapshot_json"->'content'->>'environment' IS DISTINCT FROM 'non_production'
    OR snapshot."snapshot_json"->'content'->'publicationProhibited'
       IS DISTINCT FROM 'true'::JSONB
    OR (SELECT count(*) FROM jsonb_object_keys(snapshot."snapshot_json"))<>2
    OR (SELECT count(*) FROM jsonb_object_keys(snapshot."snapshot_json"->'content'))<>11
    OR snapshot."snapshot_json"->'content'->>'limitation' IS DISTINCT FROM
       'Authenticated private non-production calculation authority only; publication and production use remain prohibited.'
    OR snapshot."snapshot_json"->'content'->'selector' IS DISTINCT FROM content->'selector'
    OR snapshot."snapshot_json"->'content'->'head' IS DISTINCT FROM content->'expectedHead'
    OR snapshot."snapshot_json"->'content'->>'lastTransitionId' IS DISTINCT FROM
       prior_transition_id
    OR snapshot."snapshot_json"->'content'->'calculationAuthority'->>'state'
       IS DISTINCT FROM 'ready'
    OR snapshot."content_sha256" IS DISTINCT FROM encode(sha256(convert_to(
       snapshot."content_canonical_json",'UTF8')),'hex')
    OR snapshot."snapshot_id" IS DISTINCT FROM 'private-evaluation-authority-snapshot:' ||
       snapshot."content_sha256"
    OR snapshot."snapshot_json"->>'snapshotId' IS DISTINCT FROM snapshot."snapshot_id"
    OR snapshot_custody."content_sha256" IS DISTINCT FROM
       substring(snapshot."artifact_id" FROM 10)
    OR snapshot_custody."storage_uri" IS DISTINCT FROM
       'artifact://sha256/' || snapshot_custody."content_sha256"
    OR snapshot_custody."media_type" IS DISTINCT FROM 'application/json'
    OR snapshot_custody."byte_length" IS DISTINCT FROM octet_length(convert_to(
       outcome_afl_trade_canonical_json(snapshot."snapshot_json"),'UTF8'))
    OR snapshot_custody."environment" IS DISTINCT FROM
       'non_production'::"OutcomeEnvironment"
    OR snapshot_custody."created_at" IS DISTINCT FROM snapshot."captured_at"
    OR snapshot."expected_head_status" IS DISTINCT FROM NEW."expected_head_status"
    OR snapshot."expected_head_revision" IS DISTINCT FROM NEW."expected_head_revision"
    OR snapshot."expected_head_generation_id" IS DISTINCT FROM NEW."expected_head_generation_id"
  THEN
    RAISE EXCEPTION 'Automated private intent has invalid snapshot authority';
  END IF;
  IF inspection."snapshot_id" IS DISTINCT FROM NEW."authority_snapshot_id"
    OR inspection."valuation_scope_key" IS DISTINCT FROM NEW."valuation_scope_key"
    OR inspection."trade_id" IS DISTINCT FROM NEW."trade_id"
    OR inspection."state" IS DISTINCT FROM 'ready'
    OR inspection."content_canonical_json" IS DISTINCT FROM
       outcome_afl_trade_canonical_json(inspection."receipt_json"->'content')
    OR inspection."receipt_json"->'content'->>'schemaVersion'
       IS DISTINCT FROM 'private-evaluation-inspection/v3'
    OR inspection."receipt_json"->'content'->>'environment' IS DISTINCT FROM 'non_production'
    OR inspection."receipt_json"->'content'->'publicationProhibited'
       IS DISTINCT FROM 'true'::JSONB
    OR (SELECT count(*) FROM jsonb_object_keys(inspection."receipt_json"))<>2
    OR (SELECT count(*) FROM jsonb_object_keys(inspection."receipt_json"->'content'))<>13
    OR inspection."receipt_json"->'content'->>'limitation' IS DISTINCT FROM
       'Authenticated private non-production calculation authority only; publication and production use remain prohibited.'
    OR inspection."receipt_json"->'content'->>'snapshotId' IS DISTINCT FROM snapshot."snapshot_id"
    OR inspection."receipt_json"->'content'->'selector' IS DISTINCT FROM content->'selector'
    OR inspection."receipt_json"->'content'->'head' IS DISTINCT FROM content->'expectedHead'
    OR inspection."receipt_json"->'content'->'calculationAuthority' IS DISTINCT FROM
       snapshot."snapshot_json"->'content'->'calculationAuthority'
    OR inspection."receipt_json"->'content'->'blockers' IS DISTINCT FROM '[]'::JSONB
    OR inspection."content_sha256" IS DISTINCT FROM encode(sha256(convert_to(
       inspection."content_canonical_json",'UTF8')),'hex')
    OR inspection."inspection_id" IS DISTINCT FROM 'private-evaluation-inspection:' ||
       inspection."content_sha256"
    OR inspection."receipt_json"->>'inspectionId' IS DISTINCT FROM inspection."inspection_id"
    OR inspection_custody."content_sha256" IS DISTINCT FROM
       substring(inspection."artifact_id" FROM 10)
    OR inspection_custody."storage_uri" IS DISTINCT FROM
       'artifact://sha256/' || inspection_custody."content_sha256"
    OR inspection_custody."media_type" IS DISTINCT FROM 'application/json'
    OR inspection_custody."byte_length" IS DISTINCT FROM octet_length(convert_to(
       outcome_afl_trade_canonical_json(inspection."receipt_json"),'UTF8'))
    OR inspection_custody."environment" IS DISTINCT FROM
       'non_production'::"OutcomeEnvironment"
    OR inspection_custody."created_at" IS DISTINCT FROM inspection."inspected_at"
    OR inspection."expected_head_status" IS DISTINCT FROM NEW."expected_head_status"
    OR inspection."expected_head_revision" IS DISTINCT FROM NEW."expected_head_revision"
    OR inspection."expected_head_generation_id" IS DISTINCT FROM NEW."expected_head_generation_id"
    OR validate_outcome_automated_ready_calculation_authority(
      snapshot."snapshot_json"->'content'->'calculationAuthority',
      NEW."valuation_scope_key",NEW."trade_id"
    ) IS DISTINCT FROM TRUE
    OR (content->>'requestedAt')::TIMESTAMPTZ < snapshot."captured_at"
    OR (content->>'requestedAt')::TIMESTAMPTZ > snapshot."valid_through"
  THEN
    RAISE EXCEPTION 'Automated private intent has invalid inspection authority';
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Automated private intent contains invalid typed evidence';
END $$;

CREATE TRIGGER "outcome_automated_private_intent_validate"
BEFORE INSERT ON "outcome_private_evaluation_transition_intent"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_automated_private_intent"();

CREATE OR REPLACE FUNCTION "validate_outcome_automated_private_generation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  content JSONB := NEW."generation_json"->'content';
  intent RECORD;
  custody RECORD;
BEGIN
  IF content->>'schemaVersion' NOT IN (
    'local-private-trade-evaluation-generation/v1',
    'local-private-trade-evaluation-generation/v2'
  ) THEN
    RAISE EXCEPTION 'Unsupported private evaluation generation schema version';
  END IF;
  SELECT * INTO intent FROM "outcome_private_evaluation_transition_intent"
   WHERE "transition_intent_id"=NEW."transition_intent_id" FOR KEY SHARE;
  SELECT * INTO custody FROM "outcome_artifact_custody"
   WHERE "artifact_id"=NEW."generation_artifact_id" FOR KEY SHARE;
  IF content->>'schemaVersion'='local-private-trade-evaluation-generation/v1' THEN
    IF intent."transition_intent_id" IS NULL
      OR custody."artifact_id" IS NULL
      OR content->>'environment' IS DISTINCT FROM 'test_fixture'
      OR content->'publicationProhibited' IS DISTINCT FROM 'true'::JSONB
      OR (SELECT count(*) FROM jsonb_object_keys(NEW."generation_json"))<>2
      OR (SELECT count(*) FROM jsonb_object_keys(content))<>11
      OR content->'selector'->>'valuationScopeKey' IS DISTINCT FROM NEW."valuation_scope_key"
      OR content->'selector'->>'tradeId' IS DISTINCT FROM NEW."trade_id"
      OR content->>'transitionIntentId' IS DISTINCT FROM NEW."transition_intent_id"
      OR content->'narrativeArtifact'->>'artifactId' IS DISTINCT FROM NEW."narrative_artifact_id"
      OR content->'projectionManifestArtifact'->>'artifactId'
         IS DISTINCT FROM NEW."projection_manifest_artifact_id"
      OR (content->>'generatedAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."generated_at"
      OR NEW."content_canonical_json" IS DISTINCT FROM outcome_afl_trade_canonical_json(content)
      OR NEW."content_sha256" IS DISTINCT FROM encode(sha256(convert_to(
         NEW."content_canonical_json",'UTF8')),'hex')
      OR NEW."generation_id" IS DISTINCT FROM
         'local-private-trade-evaluation-generation:'||NEW."content_sha256"
      OR NEW."generation_json"->>'generationId' IS DISTINCT FROM NEW."generation_id"
      OR custody."content_sha256" IS DISTINCT FROM substring(NEW."generation_artifact_id" FROM 10)
      OR custody."storage_uri" IS DISTINCT FROM 'artifact://sha256/'||custody."content_sha256"
      OR custody."media_type" IS DISTINCT FROM 'application/json'
      OR custody."byte_length" IS DISTINCT FROM octet_length(convert_to(
         outcome_afl_trade_canonical_json(NEW."generation_json"),'UTF8'))
      OR custody."environment" IS DISTINCT FROM 'test_fixture'::"OutcomeEnvironment"
      OR custody."created_at" IS DISTINCT FROM NEW."generated_at"
      OR validate_outcome_prepared_valuation_input_v2_artifact(
         content->'narrativeArtifact','test_fixture'::"OutcomeEnvironment"
      ) IS DISTINCT FROM TRUE
      OR validate_outcome_prepared_valuation_input_v2_artifact(
         content->'projectionManifestArtifact','test_fixture'::"OutcomeEnvironment"
      ) IS DISTINCT FROM TRUE
    THEN
      RAISE EXCEPTION 'Legacy private generation failed exact test-fixture authentication';
    END IF;
    RETURN NEW;
  END IF;
  IF intent."transition_intent_id" IS NULL
    OR custody."artifact_id" IS NULL
    OR content->>'environment' IS DISTINCT FROM 'non_production'
    OR content->'publicationProhibited' IS DISTINCT FROM 'true'::JSONB
    OR (SELECT count(*) FROM jsonb_object_keys(NEW."generation_json"))<>2
    OR (SELECT count(*) FROM jsonb_object_keys(content))<>12
    OR content->>'activationReceipt' IS DISTINCT FROM 'separate_append_only_transition'
    OR content->'constructionAuthority'->>'kind'
       IS DISTINCT FROM 'automated_private_calculation_agent'
    OR content->'constructionAuthority'->>'principalId'
       IS DISTINCT FROM 'system:weekly-valuation-coordinator'
    OR content->'constructionAuthority' IS DISTINCT FROM
       intent."intent_json"->'content'->'constructionAuthority'
    OR content->'selector'->>'valuationScopeKey' IS DISTINCT FROM NEW."valuation_scope_key"
    OR content->'selector'->>'tradeId' IS DISTINCT FROM NEW."trade_id"
    OR content->>'transitionIntentId' IS DISTINCT FROM NEW."transition_intent_id"
    OR content->'narrativeArtifact'->>'artifactId' IS DISTINCT FROM NEW."narrative_artifact_id"
    OR content->'projectionManifestArtifact'->>'artifactId'
       IS DISTINCT FROM NEW."projection_manifest_artifact_id"
    OR (content->>'generatedAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."generated_at"
    OR NEW."content_canonical_json" IS DISTINCT FROM outcome_afl_trade_canonical_json(content)
    OR NEW."content_sha256" IS DISTINCT FROM encode(sha256(convert_to(
       NEW."content_canonical_json",'UTF8')),'hex')
    OR NEW."generation_id" IS DISTINCT FROM 'local-private-trade-evaluation-generation:' ||
       NEW."content_sha256"
    OR NEW."generation_json"->>'generationId' IS DISTINCT FROM NEW."generation_id"
    OR custody."content_sha256" IS DISTINCT FROM substring(NEW."generation_artifact_id" FROM 10)
    OR custody."storage_uri" IS DISTINCT FROM 'artifact://sha256/' || custody."content_sha256"
    OR custody."media_type" IS DISTINCT FROM 'application/json'
    OR custody."byte_length" IS DISTINCT FROM octet_length(convert_to(
       outcome_afl_trade_canonical_json(NEW."generation_json"),'UTF8'))
    OR custody."environment" IS DISTINCT FROM 'non_production'::"OutcomeEnvironment"
    OR custody."created_at" IS DISTINCT FROM NEW."generated_at"
    OR validate_outcome_prepared_valuation_input_v2_artifact(
       content->'narrativeArtifact','non_production'::"OutcomeEnvironment") IS DISTINCT FROM TRUE
    OR validate_outcome_prepared_valuation_input_v2_artifact(
       content->'projectionManifestArtifact','non_production'::"OutcomeEnvironment")
       IS DISTINCT FROM TRUE
  THEN
    RAISE EXCEPTION 'Automated private generation failed PostgreSQL authority authentication';
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Automated private generation contains invalid typed evidence';
END $$;

CREATE TRIGGER "outcome_automated_private_generation_validate"
BEFORE INSERT ON "outcome_local_private_trade_evaluation_generation"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_automated_private_generation"();

CREATE OR REPLACE FUNCTION "validate_outcome_automated_private_receipt"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  content JSONB := NEW."receipt_json"->'content';
  intent RECORD;
  generation RECORD;
  custody RECORD;
  prior RECORD;
  operator_authority_id TEXT;
BEGIN
  IF content->>'schemaVersion' NOT IN (
    'private-evaluation-transition-receipt/v1','private-evaluation-transition-receipt/v2'
  ) THEN
    RAISE EXCEPTION 'Unsupported private evaluation receipt schema version';
  END IF;
  SELECT * INTO intent FROM "outcome_private_evaluation_transition_intent"
   WHERE "transition_intent_id"=NEW."transition_intent_id" FOR KEY SHARE;
  SELECT * INTO generation FROM "outcome_local_private_trade_evaluation_generation"
   WHERE "generation_id"=NEW."to_generation_id" FOR KEY SHARE;
  SELECT * INTO custody FROM "outcome_artifact_custody"
   WHERE "artifact_id"=NEW."artifact_id" FOR KEY SHARE;
  SELECT * INTO prior FROM "outcome_local_private_trade_evaluation_head"
   WHERE "valuation_scope_key"=NEW."valuation_scope_key" AND "trade_id"=NEW."trade_id"
   FOR KEY SHARE;
  IF content->>'schemaVersion'='private-evaluation-transition-receipt/v1' THEN
    SELECT authority."authority_evidence_id" INTO operator_authority_id
      FROM "outcome_operational_principal_authority" authority
      JOIN "outcome_governed_evidence_reference" evidence
        ON evidence."reference_id"=authority."authority_evidence_id"
      JOIN "outcome_review_decision" approval
        ON approval."decision_id"=evidence."approval_decision_id"
     WHERE authority."principal_ref"=content->'intent'->'content'->'review'->>'principalId'
       AND authority."role"='afl_trade_private_evaluation_operator'
       AND authority."scope_key"=NEW."valuation_scope_key"
       AND authority."provider"='statly_modeling'
       AND authority."capability_id"='manage_private_trade_evaluation'
       AND authority."competition"='AFLM'
       AND authority."valid_from"<=NEW."transitioned_at"
       AND (authority."valid_through" IS NULL OR
            authority."valid_through">NEW."transitioned_at")
       AND authority."valid_from"<=transaction_timestamp()
       AND (authority."valid_through" IS NULL OR
            authority."valid_through">transaction_timestamp())
       AND evidence."environment"='test_fixture'::"OutcomeEnvironment"
       AND evidence."status"='approved'::"OutcomeRecordStatus"
       AND approval."decision"='approved'
       AND NOT EXISTS (
         SELECT 1 FROM "outcome_review_decision" successor
          WHERE successor."supersedes_decision_id"=approval."decision_id"
       )
     LIMIT 1;
    IF intent."transition_intent_id" IS NULL
      OR operator_authority_id IS NULL
      OR custody."artifact_id" IS NULL
      OR content->>'environment' IS DISTINCT FROM 'test_fixture'
      OR content->'publicationProhibited' IS DISTINCT FROM 'true'::JSONB
      OR (SELECT count(*) FROM jsonb_object_keys(NEW."receipt_json"))<>2
      OR (SELECT count(*) FROM jsonb_object_keys(content))<>11
      OR content->>'limitation' IS DISTINCT FROM
         'Private test-fixture lifecycle evidence only; it grants no factual, model, production, or publication authority.'
      OR content->'intent' IS DISTINCT FROM intent."intent_json"
      OR content->'selector'->>'valuationScopeKey' IS DISTINCT FROM NEW."valuation_scope_key"
      OR content->'selector'->>'tradeId' IS DISTINCT FROM NEW."trade_id"
      OR content->'action'->>'kind' IS DISTINCT FROM NEW."action"
      OR content->'fromHead'->>'status' IS DISTINCT FROM NEW."from_status"
      OR (content->'fromHead'->>'revision')::INTEGER IS DISTINCT FROM NEW."from_revision"
      OR content->'fromHead'->>'generationId' IS DISTINCT FROM NEW."from_generation_id"
      OR content->'toHead'->>'status' IS DISTINCT FROM NEW."to_status"
      OR (content->'toHead'->>'revision')::INTEGER IS DISTINCT FROM NEW."to_revision"
      OR content->'toHead'->>'generationId' IS DISTINCT FROM NEW."to_generation_id"
      OR content->>'previousTransitionId' IS DISTINCT FROM prior."last_transition_id"
      OR (prior."revision" IS NULL AND content->>'previousTransitionId' IS NOT NULL)
      OR (content->>'transitionedAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."transitioned_at"
      OR NEW."operation_id" IS DISTINCT FROM intent."operation_id"
      OR NEW."to_revision" IS DISTINCT FROM NEW."from_revision"+1
      OR (NEW."action"='withdraw' AND (
        NEW."to_status" IS DISTINCT FROM 'withdrawn' OR NEW."to_generation_id" IS NOT NULL))
      OR (NEW."action"<>'withdraw' AND NEW."to_status" IS DISTINCT FROM 'active')
      OR (NEW."action"='rollback' AND NEW."to_generation_id" IS DISTINCT FROM
          content->'action'->>'targetGenerationId')
      OR (NEW."action"='construct_and_activate' AND (
        generation."generation_id" IS NULL
        OR generation."transition_intent_id" IS DISTINCT FROM NEW."transition_intent_id"
        OR generation."valuation_scope_key" IS DISTINCT FROM NEW."valuation_scope_key"
        OR generation."trade_id" IS DISTINCT FROM NEW."trade_id"
      ))
      OR NEW."content_canonical_json" IS DISTINCT FROM outcome_afl_trade_canonical_json(content)
      OR NEW."content_sha256" IS DISTINCT FROM encode(sha256(convert_to(
         NEW."content_canonical_json",'UTF8')),'hex')
      OR NEW."transition_id" IS DISTINCT FROM 'private-evaluation-transition:'||NEW."content_sha256"
      OR NEW."receipt_json"->>'transitionId' IS DISTINCT FROM NEW."transition_id"
      OR custody."content_sha256" IS DISTINCT FROM substring(NEW."artifact_id" FROM 10)
      OR custody."storage_uri" IS DISTINCT FROM 'artifact://sha256/'||custody."content_sha256"
      OR custody."media_type" IS DISTINCT FROM 'application/json'
      OR custody."byte_length" IS DISTINCT FROM octet_length(convert_to(
         outcome_afl_trade_canonical_json(NEW."receipt_json"),'UTF8'))
      OR custody."environment" IS DISTINCT FROM 'test_fixture'::"OutcomeEnvironment"
      OR custody."created_at" IS DISTINCT FROM NEW."transitioned_at"
      OR (content->>'transitionedAt')::TIMESTAMPTZ < intent."requested_at"
      OR (content->>'transitionedAt')::TIMESTAMPTZ > intent."expires_at"
      OR transaction_timestamp()<NEW."transitioned_at"
      OR transaction_timestamp()>intent."expires_at"
    THEN
      RAISE EXCEPTION 'Legacy private receipt failed exact test-fixture authentication';
    END IF;
    RETURN NEW;
  END IF;
  IF intent."transition_intent_id" IS NULL
    OR generation."generation_id" IS NULL
    OR custody."artifact_id" IS NULL
    OR content->>'environment' IS DISTINCT FROM 'non_production'
    OR content->'publicationProhibited' IS DISTINCT FROM 'true'::JSONB
    OR (SELECT count(*) FROM jsonb_object_keys(NEW."receipt_json"))<>2
    OR (SELECT count(*) FROM jsonb_object_keys(content))<>11
    OR content->>'limitation' IS DISTINCT FROM
       'Automated private calculation only; it grants no source approval, production, publication, withdrawal, rollback, or recovery authority.'
    OR content->'intent' IS DISTINCT FROM intent."intent_json"
    OR content->'intent'->'content'->'constructionAuthority'->>'principalId'
       IS DISTINCT FROM 'system:weekly-valuation-coordinator'
    OR content->'action'->>'kind' IS DISTINCT FROM 'construct_and_activate'
    OR content->'selector'->>'valuationScopeKey' IS DISTINCT FROM NEW."valuation_scope_key"
    OR content->'selector'->>'tradeId' IS DISTINCT FROM NEW."trade_id"
    OR content->'fromHead'->>'status' IS DISTINCT FROM NEW."from_status"
    OR (content->'fromHead'->>'revision')::INTEGER IS DISTINCT FROM NEW."from_revision"
    OR content->'fromHead'->>'generationId' IS DISTINCT FROM NEW."from_generation_id"
    OR content->'toHead'->>'status' IS DISTINCT FROM NEW."to_status"
    OR (content->'toHead'->>'revision')::INTEGER IS DISTINCT FROM NEW."to_revision"
    OR content->'toHead'->>'generationId' IS DISTINCT FROM NEW."to_generation_id"
    OR content->>'previousTransitionId' IS DISTINCT FROM prior."last_transition_id"
    OR (prior."revision" IS NULL AND content->>'previousTransitionId' IS NOT NULL)
    OR (content->>'transitionedAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."transitioned_at"
    OR NEW."operation_id" IS DISTINCT FROM intent."operation_id"
    OR NEW."action" IS DISTINCT FROM 'construct_and_activate'
    OR NEW."to_status" IS DISTINCT FROM 'active'
    OR generation."transition_intent_id" IS DISTINCT FROM NEW."transition_intent_id"
    OR generation."valuation_scope_key" IS DISTINCT FROM NEW."valuation_scope_key"
    OR generation."trade_id" IS DISTINCT FROM NEW."trade_id"
    OR NEW."content_canonical_json" IS DISTINCT FROM outcome_afl_trade_canonical_json(content)
    OR NEW."content_sha256" IS DISTINCT FROM encode(sha256(convert_to(
       NEW."content_canonical_json",'UTF8')),'hex')
    OR NEW."transition_id" IS DISTINCT FROM 'private-evaluation-transition:' || NEW."content_sha256"
    OR NEW."receipt_json"->>'transitionId' IS DISTINCT FROM NEW."transition_id"
    OR custody."content_sha256" IS DISTINCT FROM substring(NEW."artifact_id" FROM 10)
    OR custody."storage_uri" IS DISTINCT FROM 'artifact://sha256/' || custody."content_sha256"
    OR custody."media_type" IS DISTINCT FROM 'application/json'
    OR custody."byte_length" IS DISTINCT FROM octet_length(convert_to(
       outcome_afl_trade_canonical_json(NEW."receipt_json"),'UTF8'))
    OR custody."environment" IS DISTINCT FROM 'non_production'::"OutcomeEnvironment"
    OR custody."created_at" IS DISTINCT FROM NEW."transitioned_at"
    OR (content->>'transitionedAt')::TIMESTAMPTZ < intent."requested_at"
    OR (content->>'transitionedAt')::TIMESTAMPTZ > intent."expires_at"
    OR transaction_timestamp()<NEW."transitioned_at"
    OR transaction_timestamp()>intent."expires_at"
  THEN
    RAISE EXCEPTION 'Automated private receipt failed PostgreSQL authority authentication';
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Automated private receipt contains invalid typed evidence';
END $$;

CREATE TRIGGER "outcome_automated_private_receipt_validate"
BEFORE INSERT ON "outcome_private_evaluation_transition_receipt"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_automated_private_receipt"();

CREATE OR REPLACE FUNCTION "validate_outcome_private_evaluation_head_transition"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  receipt RECORD;
  prior RECORD;
  prior_exists BOOLEAN;
BEGIN
  SELECT * INTO receipt FROM "outcome_private_evaluation_transition_receipt"
   WHERE "transition_id"=NEW."last_transition_id" FOR KEY SHARE;
  IF receipt."transition_id" IS NULL
    OR receipt."valuation_scope_key" IS DISTINCT FROM NEW."valuation_scope_key"
    OR receipt."trade_id" IS DISTINCT FROM NEW."trade_id"
    OR receipt."to_revision" IS DISTINCT FROM NEW."revision"
    OR receipt."to_status" IS DISTINCT FROM NEW."status"
    OR receipt."to_generation_id" IS DISTINCT FROM NEW."generation_id"
  THEN
    RAISE EXCEPTION 'Private evaluation head must advance through its exact retained receipt';
  END IF;

  IF TG_OP='INSERT' THEN
    SELECT * INTO prior FROM "outcome_local_private_trade_evaluation_head"
     WHERE "valuation_scope_key"=NEW."valuation_scope_key"
       AND "trade_id"=NEW."trade_id" FOR KEY SHARE;
    prior_exists := FOUND;
    IF NOT prior_exists AND (
      receipt."from_revision" IS DISTINCT FROM 0
      OR receipt."from_status" IS DISTINCT FROM 'absent'
      OR receipt."from_generation_id" IS NOT NULL
      OR receipt."receipt_json"->'content'->>'previousTransitionId' IS NOT NULL)
    THEN
      RAISE EXCEPTION 'Private evaluation head must advance through its exact retained receipt';
    ELSIF prior_exists AND (
      receipt."from_revision" IS DISTINCT FROM prior."revision"
      OR receipt."from_status" IS DISTINCT FROM prior."status"
      OR receipt."from_generation_id" IS DISTINCT FROM prior."generation_id"
      OR receipt."receipt_json"->'content'->>'previousTransitionId'
         IS DISTINCT FROM prior."last_transition_id")
    THEN
      RAISE EXCEPTION 'Private evaluation head must advance through its exact retained receipt';
    END IF;
  ELSIF TG_OP='UPDATE' AND (
      receipt."from_revision" IS DISTINCT FROM OLD."revision"
      OR receipt."from_status" IS DISTINCT FROM OLD."status"
      OR receipt."from_generation_id" IS DISTINCT FROM OLD."generation_id"
      OR receipt."receipt_json"->'content'->>'previousTransitionId'
         IS DISTINCT FROM OLD."last_transition_id")
  THEN
    RAISE EXCEPTION 'Private evaluation head must advance through its exact retained receipt';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_private_evaluation_head_transition_validate"
BEFORE INSERT OR UPDATE ON "outcome_local_private_trade_evaluation_head"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_evaluation_head_transition"();
