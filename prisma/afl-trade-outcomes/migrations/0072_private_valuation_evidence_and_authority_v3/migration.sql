-- Private valuation v3 separates three authority roles that v2 incorrectly
-- conflated: the evaluated transaction, evaluation-time factual evidence, and
-- independently governed model-training ancestry. Both records are immutable,
-- content addressed, local/non-production only, and grant no publication right.

CREATE TABLE "outcome_private_valuation_evidence_bundle" (
  "evidence_bundle_id" TEXT PRIMARY KEY,
  "valuation_scope_key" TEXT NOT NULL,
  "trade_id" TEXT NOT NULL,
  "factual_release_id" TEXT NOT NULL REFERENCES "outcome_release_manifest"("release_id") ON DELETE RESTRICT,
  "factual_candidate_id" TEXT NOT NULL REFERENCES "outcome_factual_release_candidate"("candidate_id") ON DELETE RESTRICT,
  "corpus_factual_lineage_id" TEXT NOT NULL REFERENCES "outcome_corpus_factual_lineage"("lineage_id") ON DELETE RESTRICT,
  "source_qualification_report_id" TEXT NOT NULL REFERENCES "outcome_valuation_source_qualification_report"("qualification_report_id") ON DELETE RESTRICT,
  "private_evaluation_decision_id" TEXT NOT NULL REFERENCES "outcome_private_valuation_evaluation_decision"("decision_id") ON DELETE RESTRICT,
  "member_set_sha256" CHAR(64) NOT NULL,
  "knowledge_cutoff_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "bundle_content_canonical_json" TEXT NOT NULL,
  "bundle_json" JSONB NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "registered_by" TEXT NOT NULL DEFAULT CURRENT_USER,
  CONSTRAINT "outcome_private_valuation_evidence_bundle_identity_check" CHECK (
    "evidence_bundle_id" ~ '^valuation-evidence-bundle:[a-f0-9]{64}$' AND
    "factual_release_id" ~ '^outcome-release:[a-f0-9]{64}$' AND
    "factual_candidate_id" ~ '^factual-release-candidate:[a-f0-9]{64}$' AND
    "corpus_factual_lineage_id" ~ '^corpus-factual-lineage:[a-f0-9]{64}$' AND
    "source_qualification_report_id" ~ '^valuation-source-qualification:[a-f0-9]{64}$' AND
    "private_evaluation_decision_id" ~ '^private-valuation-evaluation-decision:[a-f0-9]{64}$' AND
    "member_set_sha256" ~ '^[a-f0-9]{64}$' AND
    "knowledge_cutoff_at" <= "created_at"
  )
);

CREATE INDEX "outcome_private_valuation_evidence_bundle_scope_idx"
  ON "outcome_private_valuation_evidence_bundle"("valuation_scope_key","trade_id","created_at");

CREATE TABLE "outcome_private_valuation_authority_bundle_v3" (
  "valuation_bundle_id" TEXT PRIMARY KEY,
  "valuation_scope_key" TEXT NOT NULL,
  "evaluated_trade_release_id" TEXT NOT NULL REFERENCES "outcome_release_manifest"("release_id") ON DELETE RESTRICT,
  "evaluated_trade_candidate_id" TEXT NOT NULL REFERENCES "outcome_factual_release_candidate"("candidate_id") ON DELETE RESTRICT,
  "evaluated_trade_source_qualification_report_id" TEXT NOT NULL REFERENCES "outcome_valuation_source_qualification_report"("qualification_report_id") ON DELETE RESTRICT,
  "evaluated_trade_private_evaluation_decision_id" TEXT NOT NULL REFERENCES "outcome_private_valuation_evaluation_decision"("decision_id") ON DELETE RESTRICT,
  "transaction_event_version_id" TEXT NOT NULL,
  "evaluated_trade_canonical_member_set_sha256" CHAR(64) NOT NULL,
  "evaluation_evidence_bundle_id" TEXT NOT NULL REFERENCES "outcome_private_valuation_evidence_bundle"("evidence_bundle_id") ON DELETE RESTRICT,
  "evaluation_evidence_release_id" TEXT NOT NULL REFERENCES "outcome_release_manifest"("release_id") ON DELETE RESTRICT,
  "evaluation_evidence_candidate_id" TEXT NOT NULL REFERENCES "outcome_factual_release_candidate"("candidate_id") ON DELETE RESTRICT,
  "evaluation_evidence_corpus_lineage_id" TEXT NOT NULL REFERENCES "outcome_corpus_factual_lineage"("lineage_id") ON DELETE RESTRICT,
  "evaluation_evidence_source_qualification_report_id" TEXT NOT NULL REFERENCES "outcome_valuation_source_qualification_report"("qualification_report_id") ON DELETE RESTRICT,
  "evaluation_evidence_private_evaluation_decision_id" TEXT NOT NULL REFERENCES "outcome_private_valuation_evaluation_decision"("decision_id") ON DELETE RESTRICT,
  "evaluation_evidence_gate3_decision_id" TEXT NOT NULL REFERENCES "outcome_gate_decision"("decision_id") ON DELETE RESTRICT,
  "evaluation_evidence_member_set_sha256" CHAR(64) NOT NULL,
  "evaluation_evidence_knowledge_cutoff_at" TIMESTAMPTZ(3) NOT NULL,
  "at_trade_player_run_id" TEXT NOT NULL REFERENCES "outcome_valuation_model_run"("run_id") ON DELETE RESTRICT,
  "at_trade_player_gate3_decision_id" TEXT NOT NULL REFERENCES "outcome_gate_decision"("decision_id") ON DELETE RESTRICT,
  "at_trade_pick_candidate_id" TEXT NOT NULL REFERENCES "outcome_governed_pick_pav_model_candidate"("candidate_id") ON DELETE RESTRICT,
  "at_trade_pick_gate3_decision_id" TEXT NOT NULL REFERENCES "outcome_gate_decision"("decision_id") ON DELETE RESTRICT,
  "current_player_run_id" TEXT NOT NULL REFERENCES "outcome_valuation_model_run"("run_id") ON DELETE RESTRICT,
  "current_player_gate3_decision_id" TEXT NOT NULL REFERENCES "outcome_gate_decision"("decision_id") ON DELETE RESTRICT,
  "current_pick_candidate_id" TEXT NOT NULL REFERENCES "outcome_governed_pick_pav_model_candidate"("candidate_id") ON DELETE RESTRICT,
  "current_pick_gate3_decision_id" TEXT NOT NULL REFERENCES "outcome_gate_decision"("decision_id") ON DELETE RESTRICT,
  "hpn_pav_method_id" TEXT NOT NULL REFERENCES "outcome_hpn_pav_method"("method_id") ON DELETE RESTRICT,
  "transaction_effective_at" TIMESTAMPTZ(3) NOT NULL,
  "current_valuation_as_of" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "bundle_content_canonical_json" TEXT NOT NULL,
  "bundle_json" JSONB NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "registered_by" TEXT NOT NULL DEFAULT CURRENT_USER,
  CONSTRAINT "outcome_private_valuation_authority_bundle_v3_identity_check" CHECK (
    "valuation_bundle_id" ~ '^valuation-bundle:[a-f0-9]{64}$' AND
    "evaluated_trade_canonical_member_set_sha256" ~ '^[a-f0-9]{64}$' AND
    "evaluation_evidence_member_set_sha256" ~ '^[a-f0-9]{64}$' AND
    "evaluation_evidence_knowledge_cutoff_at" <= "current_valuation_as_of" AND
    "transaction_effective_at" <= "current_valuation_as_of" AND
    "current_valuation_as_of" <= "created_at" AND
    "evaluation_evidence_gate3_decision_id" <> "at_trade_player_gate3_decision_id" AND
    "evaluation_evidence_gate3_decision_id" <> "at_trade_pick_gate3_decision_id" AND
    "evaluation_evidence_gate3_decision_id" <> "current_player_gate3_decision_id" AND
    "evaluation_evidence_gate3_decision_id" <> "current_pick_gate3_decision_id" AND
    "at_trade_player_gate3_decision_id" <> "at_trade_pick_gate3_decision_id" AND
    "at_trade_player_gate3_decision_id" <> "current_pick_gate3_decision_id" AND
    "at_trade_pick_gate3_decision_id" <> "current_player_gate3_decision_id" AND
    ("at_trade_player_gate3_decision_id" <> "current_player_gate3_decision_id" OR
      "at_trade_player_run_id" = "current_player_run_id") AND
    ("at_trade_pick_gate3_decision_id" <> "current_pick_gate3_decision_id" OR
      "at_trade_pick_candidate_id" = "current_pick_candidate_id")
  )
);

CREATE INDEX "outcome_private_valuation_authority_bundle_v3_scope_idx"
  ON "outcome_private_valuation_authority_bundle_v3"("valuation_scope_key","created_at");

CREATE FUNCTION "validate_outcome_private_valuation_evidence_bundle_insert"()
RETURNS TRIGGER AS $$
DECLARE
  content JSONB := NEW."bundle_json"->'content';
  release_row RECORD;
  candidate_row RECORD;
  lineage_row RECORD;
  qualification_row RECORD;
  evaluation_row RECORD;
  expected_assets JSONB;
  actual_assets JSONB;
  actual_asset_ids JSONB;
BEGIN
  SELECT "scope_key","environment","effective_through","created_at"
    INTO release_row FROM "outcome_release_manifest"
   WHERE "release_id"=NEW."factual_release_id" FOR KEY SHARE;
  SELECT "target_release_id","scope_key","status","member_set_sha256","created_at","finalized_at"
    INTO candidate_row FROM "outcome_factual_release_candidate"
   WHERE "candidate_id"=NEW."factual_candidate_id" FOR KEY SHARE;
  SELECT "release_id","candidate_id","scope_key","source_member_set_sha256","created_at"
    INTO lineage_row FROM "outcome_corpus_factual_lineage"
   WHERE "lineage_id"=NEW."corpus_factual_lineage_id" FOR KEY SHARE;
  SELECT "factual_release_id","valuation_scope_key","decision_state","evaluated_at","finalized_at"
    INTO qualification_row FROM "outcome_valuation_source_qualification_report"
   WHERE "qualification_report_id"=NEW."source_qualification_report_id" FOR KEY SHARE;
  SELECT "factual_release_id","valuation_scope_key","status","decided_at"
    INTO evaluation_row FROM "outcome_private_valuation_evaluation_decision"
   WHERE "decision_id"=NEW."private_evaluation_decision_id" FOR KEY SHARE;

  SELECT jsonb_agg(to_jsonb(value) ORDER BY ordinal),
         jsonb_agg(to_jsonb(asset->>'assetVersionId') ORDER BY ordinal),
         jsonb_agg(to_jsonb(asset->>'assetId') ORDER BY ordinal)
    INTO expected_assets,actual_assets,actual_asset_ids
    FROM jsonb_array_elements_text(content->'expectedAssetVersionIds') WITH ORDINALITY expected(value,ordinal)
    FULL JOIN jsonb_array_elements(content->'assets') WITH ORDINALITY assets(asset,ordinal)
      USING (ordinal);

  IF NEW."bundle_content_canonical_json" IS DISTINCT FROM outcome_afl_trade_canonical_json(content) OR
     NEW."evidence_bundle_id" IS DISTINCT FROM 'valuation-evidence-bundle:' || encode(sha256(convert_to(NEW."bundle_content_canonical_json",'UTF8')),'hex') OR
     NEW."bundle_json"->>'evidenceBundleId' IS DISTINCT FROM NEW."evidence_bundle_id" OR
     content->>'schemaVersion' IS DISTINCT FROM 'afl-trade-private-valuation-evidence-bundle/v1' OR
     content->>'authorityBoundary' IS DISTINCT FROM
       'private_non_production_complete_factual_asset_evidence_no_score_grade_model_authority_or_publication' OR
     content->>'environment' IS DISTINCT FROM 'non_production' OR
     content->'publicationEligible' IS DISTINCT FROM 'false'::jsonb OR
     content->'publicationProhibited' IS DISTINCT FROM 'true'::jsonb OR
     content->>'valuationScopeKey' IS DISTINCT FROM NEW."valuation_scope_key" OR
     content->>'tradeId' IS DISTINCT FROM NEW."trade_id" OR
     (content->>'knowledgeCutoffAt')::timestamptz IS DISTINCT FROM NEW."knowledge_cutoff_at" OR
     (content->>'createdAt')::timestamptz IS DISTINCT FROM NEW."created_at" OR
     content->'factualRoot'->>'releaseId' IS DISTINCT FROM NEW."factual_release_id" OR
     content->'factualRoot'->>'candidateId' IS DISTINCT FROM NEW."factual_candidate_id" OR
     content->'factualRoot'->>'corpusToCandidateLineageId' IS DISTINCT FROM NEW."corpus_factual_lineage_id" OR
     content->'factualRoot'->>'sourceQualificationReportId' IS DISTINCT FROM NEW."source_qualification_report_id" OR
     content->'factualRoot'->>'privateEvaluationDecisionId' IS DISTINCT FROM NEW."private_evaluation_decision_id" OR
     content->'factualRoot'->>'memberSetSha256' IS DISTINCT FROM NEW."member_set_sha256" OR
     content->>'completeness' IS DISTINCT FROM 'every_expected_asset_has_exact_factual_evidence' OR
     content->>'missingValuePolicy' IS DISTINCT FROM 'unavailable_never_zero_and_no_incomplete_bundle' OR
     jsonb_array_length(content->'expectedAssetVersionIds')=0 OR
     content->'expectedAssetVersionIds' IS DISTINCT FROM expected_assets OR
     expected_assets IS DISTINCT FROM actual_assets OR
     jsonb_array_length(actual_assets)<>jsonb_array_length(
       (SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements(actual_assets) values(value))) OR
     jsonb_array_length(actual_asset_ids)<>jsonb_array_length(
       (SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements(actual_asset_ids) values(value))) OR
     EXISTS (
       SELECT 1 FROM jsonb_array_elements(content->'assets') WITH ORDINALITY assets(asset,ordinal)
        WHERE asset->>'assetId' IS NULL OR asset->>'receivingClubId' IS NULL OR
              (asset->>'assetKind'='player' AND
                asset->>'evidenceKind'<>'exhaustive_acquisition_spell_horizons') OR
              (asset->>'assetKind' IN ('pick','future_pick') AND
                asset->>'evidenceKind'<>'custody_aware_conserved_frontier') OR
              asset->>'assetKind' NOT IN ('player','pick','future_pick') OR
              jsonb_array_length(asset->'dependencyArtifacts')=0 OR
              (asset->'evidenceArtifact'->>'createdAt')::timestamptz>NEW."created_at" OR
              EXISTS (SELECT 1 FROM jsonb_array_elements(asset->'dependencyArtifacts') dependency
                       WHERE (dependency->>'createdAt')::timestamptz>NEW."created_at")
     ) OR
     (content->'evaluatedTradeCorrespondenceArtifact'->>'createdAt')::timestamptz>NEW."created_at" OR
     release_row."environment" IS DISTINCT FROM 'non_production' OR
     release_row."scope_key" IS DISTINCT FROM candidate_row."scope_key" OR
     release_row."effective_through" IS DISTINCT FROM NEW."knowledge_cutoff_at" OR
     release_row."created_at">NEW."created_at" OR
     candidate_row."target_release_id" IS DISTINCT FROM NEW."factual_release_id" OR
     candidate_row."status"::text IS DISTINCT FROM 'approved' OR
     candidate_row."finalized_at" IS NULL OR candidate_row."finalized_at">NEW."created_at" OR
     candidate_row."member_set_sha256" IS DISTINCT FROM NEW."member_set_sha256" OR
     lineage_row."release_id" IS DISTINCT FROM NEW."factual_release_id" OR
     lineage_row."candidate_id" IS DISTINCT FROM NEW."factual_candidate_id" OR
     lineage_row."scope_key" IS DISTINCT FROM candidate_row."scope_key" OR
     lineage_row."source_member_set_sha256" IS DISTINCT FROM NEW."member_set_sha256" OR
     lineage_row."created_at">NEW."created_at" OR
     qualification_row."factual_release_id" IS DISTINCT FROM NEW."factual_release_id" OR
     qualification_row."valuation_scope_key" IS DISTINCT FROM NEW."valuation_scope_key" OR
     qualification_row."decision_state" IS DISTINCT FROM 'eligible_for_dataset_admission' OR
     qualification_row."evaluated_at">NEW."created_at" OR
     qualification_row."finalized_at">NEW."created_at" OR
     evaluation_row."factual_release_id" IS DISTINCT FROM NEW."factual_release_id" OR
     evaluation_row."valuation_scope_key" IS DISTINCT FROM NEW."valuation_scope_key" OR
     evaluation_row."status" IS DISTINCT FROM 'authorized' OR
     evaluation_row."decided_at">NEW."created_at" THEN
    RAISE EXCEPTION 'Private valuation evidence bundle identity, completeness, or factual ancestry mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "validate_outcome_private_valuation_authority_bundle_v3_insert"()
RETURNS TRIGGER AS $$
DECLARE
  content JSONB := NEW."bundle_json"->'content';
  evaluated_release RECORD;
  evaluated_candidate RECORD;
  evaluated_qualification RECORD;
  evaluated_decision RECORD;
  evidence_row RECORD;
  method_row RECORD;
  player_runs_succeeded INTEGER;
  valid_component_gates INTEGER;
BEGIN
  SELECT "scope_key","environment","created_at" INTO evaluated_release
    FROM "outcome_release_manifest" WHERE "release_id"=NEW."evaluated_trade_release_id" FOR KEY SHARE;
  SELECT "target_release_id","scope_key","status","canonical_member_set_sha256","finalized_at"
    INTO evaluated_candidate FROM "outcome_factual_release_candidate"
   WHERE "candidate_id"=NEW."evaluated_trade_candidate_id" FOR KEY SHARE;
  SELECT "factual_release_id","valuation_scope_key","decision_state","finalized_at"
    INTO evaluated_qualification FROM "outcome_valuation_source_qualification_report"
   WHERE "qualification_report_id"=NEW."evaluated_trade_source_qualification_report_id" FOR KEY SHARE;
  SELECT "factual_release_id","valuation_scope_key","status","decided_at"
    INTO evaluated_decision FROM "outcome_private_valuation_evaluation_decision"
   WHERE "decision_id"=NEW."evaluated_trade_private_evaluation_decision_id" FOR KEY SHARE;
  SELECT * INTO evidence_row FROM "outcome_private_valuation_evidence_bundle"
   WHERE "evidence_bundle_id"=NEW."evaluation_evidence_bundle_id" FOR KEY SHARE;
  SELECT "environment","registered_at" INTO method_row FROM "outcome_hpn_pav_method"
   WHERE "method_id"=NEW."hpn_pav_method_id" FOR KEY SHARE;
  SELECT count(*) INTO player_runs_succeeded FROM "outcome_valuation_model_run"
   WHERE "run_id" IN (NEW."at_trade_player_run_id",NEW."current_player_run_id")
     AND "status"='succeeded' AND "finished_at"<=NEW."created_at";
  SELECT count(*) INTO valid_component_gates FROM "outcome_gate_decision" decision
   WHERE decision."decision_id" IN (
       NEW."evaluation_evidence_gate3_decision_id",
       NEW."at_trade_player_gate3_decision_id",NEW."at_trade_pick_gate3_decision_id",
       NEW."current_player_gate3_decision_id",NEW."current_pick_gate3_decision_id")
     AND decision."gate"='gate_3_model_validity'
     AND decision."environment"='non_production'
     AND decision."state"='approved'
     AND decision."effective_at"<=NEW."created_at"
     AND decision."revalidate_at">NEW."created_at"
     AND decision."decision_json"->'content'->'scope'->>'scopeKey'=NEW."valuation_scope_key";

  IF NEW."bundle_content_canonical_json" IS DISTINCT FROM outcome_afl_trade_canonical_json(content) OR
     NEW."valuation_bundle_id" IS DISTINCT FROM 'valuation-bundle:' || encode(sha256(convert_to(NEW."bundle_content_canonical_json",'UTF8')),'hex') OR
     NEW."bundle_json"->>'valuationBundleId' IS DISTINCT FROM NEW."valuation_bundle_id" OR
     content->>'schemaVersion' IS DISTINCT FROM 'afl-trade-private-valuation-authority-bundle/v3' OR
     content->>'authorityBoundary' IS DISTINCT FROM
       'private_non_production_separated_trade_evidence_evaluation_evidence_and_model_training_authority_no_grade_publication_or_fantasy_ownership' OR
     content->>'environment' IS DISTINCT FROM 'non_production' OR
     content->'publicationEligible' IS DISTINCT FROM 'false'::jsonb OR
     content->'publicationProhibited' IS DISTINCT FROM 'true'::jsonb OR
     content->>'valuationScopeKey' IS DISTINCT FROM NEW."valuation_scope_key" OR
     content->'authorityRoles' IS DISTINCT FROM jsonb_build_object(
       'evaluatedTrade','canonical_transaction_and_root_assets',
       'evaluationEvidence','realized_lineage_horizons_and_remaining_state',
       'modelTraining','component_owned_independent_ancestry') OR
     content->'evaluatedTrade'->>'authorityRole' IS DISTINCT FROM 'canonical_transaction_and_root_assets' OR
     content->'evaluatedTrade'->>'factualReleaseId' IS DISTINCT FROM NEW."evaluated_trade_release_id" OR
     content->'evaluatedTrade'->>'factualCandidateId' IS DISTINCT FROM NEW."evaluated_trade_candidate_id" OR
     content->'evaluatedTrade'->>'sourceQualificationReportId' IS DISTINCT FROM NEW."evaluated_trade_source_qualification_report_id" OR
     content->'evaluatedTrade'->>'privateEvaluationDecisionId' IS DISTINCT FROM NEW."evaluated_trade_private_evaluation_decision_id" OR
     content->'evaluatedTrade'->>'transactionEventVersionId' IS DISTINCT FROM NEW."transaction_event_version_id" OR
     content->'evaluatedTrade'->>'canonicalMemberSetSha256' IS DISTINCT FROM NEW."evaluated_trade_canonical_member_set_sha256" OR
     jsonb_array_length(content->'evaluatedTrade'->'assetVersionIds')=0 OR
     content->'evaluationEvidence'->>'authorityRole' IS DISTINCT FROM 'realized_lineage_horizons_and_remaining_state' OR
     content->'evaluationEvidence'->>'evidenceBundleId' IS DISTINCT FROM NEW."evaluation_evidence_bundle_id" OR
     content->'evaluationEvidence'->>'factualReleaseId' IS DISTINCT FROM NEW."evaluation_evidence_release_id" OR
     content->'evaluationEvidence'->>'factualCandidateId' IS DISTINCT FROM NEW."evaluation_evidence_candidate_id" OR
     content->'evaluationEvidence'->>'corpusToCandidateLineageId' IS DISTINCT FROM NEW."evaluation_evidence_corpus_lineage_id" OR
     content->'evaluationEvidence'->>'sourceQualificationReportId' IS DISTINCT FROM NEW."evaluation_evidence_source_qualification_report_id" OR
     content->'evaluationEvidence'->>'privateEvaluationDecisionId' IS DISTINCT FROM NEW."evaluation_evidence_private_evaluation_decision_id" OR
     content->'evaluationEvidence'->>'gate3DecisionId' IS DISTINCT FROM NEW."evaluation_evidence_gate3_decision_id" OR
     content->'evaluationEvidence'->>'memberSetSha256' IS DISTINCT FROM NEW."evaluation_evidence_member_set_sha256" OR
     (content->'evaluationEvidence'->>'knowledgeCutoffAt')::timestamptz IS DISTINCT FROM NEW."evaluation_evidence_knowledge_cutoff_at" OR
     content->'modelAuthorities'->'atTrade'->>'modelVintage' IS DISTINCT FROM 'historical_restatement' OR
     content->'modelAuthorities'->'atTrade'->>'knowledgePolicy' IS DISTINCT FROM 'component_cutoffs_not_after_transaction_effective_at' OR
     content->'modelAuthorities'->'atTrade'->'player'->>'runId' IS DISTINCT FROM NEW."at_trade_player_run_id" OR
     content->'modelAuthorities'->'atTrade'->'player'->>'gate3DecisionId' IS DISTINCT FROM NEW."at_trade_player_gate3_decision_id" OR
     content->'modelAuthorities'->'atTrade'->'pick'->>'candidateId' IS DISTINCT FROM NEW."at_trade_pick_candidate_id" OR
     content->'modelAuthorities'->'atTrade'->'pick'->>'gate3DecisionId' IS DISTINCT FROM NEW."at_trade_pick_gate3_decision_id" OR
     content->'modelAuthorities'->'currentRemaining'->>'modelVintage' IS DISTINCT FROM 'current' OR
     content->'modelAuthorities'->'currentRemaining'->>'knowledgePolicy' IS DISTINCT FROM 'component_cutoffs_not_after_current_valuation_as_of' OR
     content->'modelAuthorities'->'currentRemaining'->'player'->>'runId' IS DISTINCT FROM NEW."current_player_run_id" OR
     content->'modelAuthorities'->'currentRemaining'->'player'->>'gate3DecisionId' IS DISTINCT FROM NEW."current_player_gate3_decision_id" OR
     content->'modelAuthorities'->'currentRemaining'->'pick'->>'candidateId' IS DISTINCT FROM NEW."current_pick_candidate_id" OR
     content->'modelAuthorities'->'currentRemaining'->'pick'->>'gate3DecisionId' IS DISTINCT FROM NEW."current_pick_gate3_decision_id" OR
     content->>'hpnPavMethodId' IS DISTINCT FROM NEW."hpn_pav_method_id" OR
     (content->>'transactionEffectiveAt')::timestamptz IS DISTINCT FROM NEW."transaction_effective_at" OR
     (content->>'currentValuationAsOf')::timestamptz IS DISTINCT FROM NEW."current_valuation_as_of" OR
     (content->>'createdAt')::timestamptz IS DISTINCT FROM NEW."created_at" OR
     content->>'gate3Authority' IS DISTINCT FROM
       'requires_exact_current_evaluation_evidence_component_and_bundle_decisions' OR
     (content->'modelAuthorities'->'atTrade'->'player'->>'knowledgeCutoffAt')::timestamptz>NEW."transaction_effective_at" OR
     (content->'modelAuthorities'->'atTrade'->'pick'->>'knowledgeCutoffAt')::timestamptz>NEW."transaction_effective_at" OR
     (content->'modelAuthorities'->'currentRemaining'->'player'->>'knowledgeCutoffAt')::timestamptz>NEW."current_valuation_as_of" OR
     (content->'modelAuthorities'->'currentRemaining'->'pick'->>'knowledgeCutoffAt')::timestamptz>NEW."current_valuation_as_of" OR
     (content->'evaluationEvidence'->'tradeCorrespondenceArtifact'->>'createdAt')::timestamptz>NEW."created_at" OR
     (content->'componentCompatibilityArtifact'->>'createdAt')::timestamptz>NEW."created_at" OR
     (content->'jointSimulationProtocolArtifact'->>'createdAt')::timestamptz>NEW."created_at" OR
     (content->'gradePolicyArtifact'->>'createdAt')::timestamptz>NEW."created_at" OR
     evaluated_release."environment" IS DISTINCT FROM 'non_production' OR
     evaluated_release."scope_key" IS DISTINCT FROM evaluated_candidate."scope_key" OR
     evaluated_release."created_at">NEW."created_at" OR
     evaluated_candidate."target_release_id" IS DISTINCT FROM NEW."evaluated_trade_release_id" OR
     evaluated_candidate."status"::text IS DISTINCT FROM 'approved' OR
     evaluated_candidate."finalized_at" IS NULL OR evaluated_candidate."finalized_at">NEW."created_at" OR
     evaluated_candidate."canonical_member_set_sha256" IS DISTINCT FROM NEW."evaluated_trade_canonical_member_set_sha256" OR
     evaluated_qualification."factual_release_id" IS DISTINCT FROM NEW."evaluated_trade_release_id" OR
     evaluated_qualification."valuation_scope_key" IS DISTINCT FROM NEW."valuation_scope_key" OR
     evaluated_qualification."decision_state" IS DISTINCT FROM 'eligible_for_dataset_admission' OR
     evaluated_qualification."finalized_at">NEW."created_at" OR
     evaluated_decision."factual_release_id" IS DISTINCT FROM NEW."evaluated_trade_release_id" OR
     evaluated_decision."valuation_scope_key" IS DISTINCT FROM NEW."valuation_scope_key" OR
     evaluated_decision."status" IS DISTINCT FROM 'authorized' OR
     evaluated_decision."decided_at">NEW."created_at" OR
     evidence_row."valuation_scope_key" IS DISTINCT FROM NEW."valuation_scope_key" OR
     evidence_row."factual_release_id" IS DISTINCT FROM NEW."evaluation_evidence_release_id" OR
     evidence_row."factual_candidate_id" IS DISTINCT FROM NEW."evaluation_evidence_candidate_id" OR
     evidence_row."corpus_factual_lineage_id" IS DISTINCT FROM NEW."evaluation_evidence_corpus_lineage_id" OR
     evidence_row."source_qualification_report_id" IS DISTINCT FROM NEW."evaluation_evidence_source_qualification_report_id" OR
     evidence_row."private_evaluation_decision_id" IS DISTINCT FROM NEW."evaluation_evidence_private_evaluation_decision_id" OR
     evidence_row."member_set_sha256" IS DISTINCT FROM NEW."evaluation_evidence_member_set_sha256" OR
     evidence_row."knowledge_cutoff_at" IS DISTINCT FROM NEW."evaluation_evidence_knowledge_cutoff_at" OR
     evidence_row."created_at">NEW."created_at" OR
     method_row."environment"::text IS DISTINCT FROM 'non_production' OR
     method_row."registered_at">NEW."created_at" OR
     player_runs_succeeded<>(CASE WHEN NEW."at_trade_player_run_id"=NEW."current_player_run_id" THEN 1 ELSE 2 END) OR
     valid_component_gates<>(
       SELECT count(DISTINCT decision_id) FROM unnest(ARRAY[
         NEW."evaluation_evidence_gate3_decision_id",
         NEW."at_trade_player_gate3_decision_id",NEW."at_trade_pick_gate3_decision_id",
         NEW."current_player_gate3_decision_id",NEW."current_pick_gate3_decision_id"]) decision_id
     ) OR
     NOT EXISTS (
       SELECT 1 FROM "outcome_gate_decision" decision
        WHERE decision."decision_id"=NEW."evaluation_evidence_gate3_decision_id"
          AND decision."decision_json"->'content'->'affectedArtifacts'=jsonb_build_array(
            jsonb_build_object('kind','valuation_evidence_bundle','artifactId',NEW."evaluation_evidence_bundle_id"))
     ) OR
     NOT EXISTS (
       SELECT 1 FROM "outcome_gate_decision" decision
        WHERE decision."decision_id"=NEW."at_trade_player_gate3_decision_id"
          AND decision."decision_json"->'content'->'affectedArtifacts'=jsonb_build_array(
            jsonb_build_object('kind','model_run','artifactId',NEW."at_trade_player_run_id"))
     ) OR
     NOT EXISTS (
       SELECT 1 FROM "outcome_gate_decision" decision
        WHERE decision."decision_id"=NEW."at_trade_pick_gate3_decision_id"
          AND decision."decision_json"->'content'->'affectedArtifacts'=jsonb_build_array(
            jsonb_build_object('kind','pick_model_candidate','artifactId',NEW."at_trade_pick_candidate_id"))
     ) OR
     NOT EXISTS (
       SELECT 1 FROM "outcome_gate_decision" decision
        WHERE decision."decision_id"=NEW."current_player_gate3_decision_id"
          AND decision."decision_json"->'content'->'affectedArtifacts'=jsonb_build_array(
            jsonb_build_object('kind','model_run','artifactId',NEW."current_player_run_id"))
     ) OR
     NOT EXISTS (
       SELECT 1 FROM "outcome_gate_decision" decision
        WHERE decision."decision_id"=NEW."current_pick_gate3_decision_id"
          AND decision."decision_json"->'content'->'affectedArtifacts'=jsonb_build_array(
            jsonb_build_object('kind','pick_model_candidate','artifactId',NEW."current_pick_candidate_id"))
     ) THEN
    RAISE EXCEPTION 'Private valuation v3 authority identity, role separation, or retained ancestry mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_private_valuation_evidence_bundle_insert_guard"
  BEFORE INSERT ON "outcome_private_valuation_evidence_bundle"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_valuation_evidence_bundle_insert"();
CREATE TRIGGER "outcome_private_valuation_authority_bundle_v3_insert_guard"
  BEFORE INSERT ON "outcome_private_valuation_authority_bundle_v3"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_valuation_authority_bundle_v3_insert"();

CREATE TRIGGER "outcome_private_valuation_evidence_bundle_mutation_guard"
  BEFORE UPDATE OR DELETE ON "outcome_private_valuation_evidence_bundle"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_model_authority_mutation"();
CREATE TRIGGER "outcome_private_valuation_authority_bundle_v3_mutation_guard"
  BEFORE UPDATE OR DELETE ON "outcome_private_valuation_authority_bundle_v3"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_model_authority_mutation"();
