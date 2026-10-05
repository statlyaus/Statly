CREATE TABLE "outcome_pick_pav_observation_admission" (
  "observation_admission_id" TEXT PRIMARY KEY,
  "observation_set_id" TEXT NOT NULL REFERENCES "outcome_pick_pav_observation_set"("observation_set_id") ON DELETE RESTRICT,
  "observation_set_sha256" CHAR(64) NOT NULL,
  "release_id" TEXT NOT NULL,
  "policy_id" TEXT NOT NULL,
  "source_qualification_report_id" TEXT NOT NULL,
  "gate2_decision_id" TEXT NOT NULL,
  "admitted_at" TIMESTAMPTZ(3) NOT NULL,
  "admission_content_canonical_json" TEXT NOT NULL,
  "admission_json" JSONB NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "registered_by" TEXT NOT NULL DEFAULT CURRENT_USER,
  CONSTRAINT "outcome_pick_pav_observation_admission_identity_check" CHECK (
    "observation_admission_id" ~ '^pick-pav-observation-admission:[a-f0-9]{64}$' AND
    "observation_set_id" ~ '^pick-pav-observation-set:[a-f0-9]{64}$' AND
    "observation_set_sha256" ~ '^[a-f0-9]{64}$' AND
    "release_id" ~ '^outcome-release:[a-f0-9]{64}$' AND
    "policy_id" ~ '^pick-pav-policy:[a-f0-9]{64}$' AND
    "source_qualification_report_id" ~ '^valuation-source-qualification:[a-f0-9]{64}$' AND
    "gate2_decision_id" ~ '^gate-decision:[a-f0-9]{64}$'
  )
);

CREATE INDEX "outcome_pick_pav_observation_admission_scope_idx"
  ON "outcome_pick_pav_observation_admission"("observation_set_id","admitted_at");

CREATE TABLE "outcome_pick_pav_model_run_intent" (
  "run_intent_id" TEXT PRIMARY KEY,
  "observation_admission_id" TEXT NOT NULL REFERENCES "outcome_pick_pav_observation_admission"("observation_admission_id") ON DELETE RESTRICT,
  "observation_set_id" TEXT NOT NULL REFERENCES "outcome_pick_pav_observation_set"("observation_set_id") ON DELETE RESTRICT,
  "model_id" TEXT NOT NULL,
  "model_version" TEXT NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "intent_content_canonical_json" TEXT NOT NULL,
  "intent_json" JSONB NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "registered_by" TEXT NOT NULL DEFAULT CURRENT_USER,
  CONSTRAINT "outcome_pick_pav_model_run_intent_identity_check" CHECK (
    "run_intent_id" ~ '^pick-pav-model-run-intent:[a-f0-9]{64}$' AND
    "observation_admission_id" ~ '^pick-pav-observation-admission:[a-f0-9]{64}$' AND
    "observation_set_id" ~ '^pick-pav-observation-set:[a-f0-9]{64}$'
  ),
  CONSTRAINT "outcome_pick_pav_model_run_intent_admission_key"
    UNIQUE ("run_intent_id","observation_admission_id","observation_set_id")
);

CREATE INDEX "outcome_pick_pav_model_run_intent_scope_idx"
  ON "outcome_pick_pav_model_run_intent"("observation_set_id","started_at");

CREATE TABLE "outcome_pick_pav_model_run_authorization" (
  "run_authorization_id" TEXT PRIMARY KEY,
  "run_intent_id" TEXT NOT NULL UNIQUE REFERENCES "outcome_pick_pav_model_run_intent"("run_intent_id") ON DELETE RESTRICT,
  "observation_admission_id" TEXT NOT NULL REFERENCES "outcome_pick_pav_observation_admission"("observation_admission_id") ON DELETE RESTRICT,
  "observation_set_id" TEXT NOT NULL REFERENCES "outcome_pick_pav_observation_set"("observation_set_id") ON DELETE RESTRICT,
  "operational_principal_authority_id" TEXT NOT NULL,
  "gate_ledger_revision" INTEGER NOT NULL,
  "authorized_at" TIMESTAMPTZ(3) NOT NULL,
  "valid_through" TIMESTAMPTZ(3) NOT NULL,
  "authorization_content_canonical_json" TEXT NOT NULL,
  "authorization_json" JSONB NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "registered_by" TEXT NOT NULL DEFAULT CURRENT_USER,
  CONSTRAINT "outcome_pick_pav_model_run_authorization_identity_check" CHECK (
    "run_authorization_id" ~ '^pick-pav-model-run-authorization:[a-f0-9]{64}$' AND
    "run_intent_id" ~ '^pick-pav-model-run-intent:[a-f0-9]{64}$' AND
    "observation_admission_id" ~ '^pick-pav-observation-admission:[a-f0-9]{64}$' AND
    "observation_set_id" ~ '^pick-pav-observation-set:[a-f0-9]{64}$' AND
    "operational_principal_authority_id" ~ '^operational-principal-authority:[a-f0-9]{64}$' AND
    "gate_ledger_revision" > 0 AND
    "authorized_at" < "valid_through"
  )
);

CREATE INDEX "outcome_pick_pav_model_run_authorization_validity_idx"
  ON "outcome_pick_pav_model_run_authorization"("valid_through","authorized_at");

CREATE TABLE "outcome_governed_pick_pav_model_candidate" (
  "candidate_id" TEXT PRIMARY KEY,
  "observation_set_id" TEXT NOT NULL REFERENCES "outcome_pick_pav_observation_set"("observation_set_id") ON DELETE RESTRICT,
  "observation_admission_id" TEXT NOT NULL REFERENCES "outcome_pick_pav_observation_admission"("observation_admission_id") ON DELETE RESTRICT,
  "run_intent_id" TEXT NOT NULL UNIQUE REFERENCES "outcome_pick_pav_model_run_intent"("run_intent_id") ON DELETE RESTRICT,
  "run_authorization_id" TEXT NOT NULL UNIQUE REFERENCES "outcome_pick_pav_model_run_authorization"("run_authorization_id") ON DELETE RESTRICT,
  "consumption_id" TEXT NOT NULL UNIQUE,
  "model_id" TEXT NOT NULL,
  "model_version" TEXT NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "candidate_locked_at" TIMESTAMPTZ(3) NOT NULL,
  "final_test_evaluated_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3) NOT NULL,
  "candidate_content_canonical_json" TEXT NOT NULL,
  "candidate_json" JSONB NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "registered_by" TEXT NOT NULL DEFAULT CURRENT_USER,
  CONSTRAINT "outcome_governed_pick_pav_model_candidate_identity_check" CHECK (
    "candidate_id" ~ '^pick-pav-model-candidate:[a-f0-9]{64}$' AND
    "observation_set_id" ~ '^pick-pav-observation-set:[a-f0-9]{64}$' AND
    "observation_admission_id" ~ '^pick-pav-observation-admission:[a-f0-9]{64}$' AND
    "run_intent_id" ~ '^pick-pav-model-run-intent:[a-f0-9]{64}$' AND
    "run_authorization_id" ~ '^pick-pav-model-run-authorization:[a-f0-9]{64}$' AND
    "consumption_id" ~ '^pick-pav-model-run-consumption:[a-f0-9]{64}$' AND
    "started_at" <= "candidate_locked_at" AND
    "candidate_locked_at" <= "final_test_evaluated_at" AND
    "final_test_evaluated_at" <= "completed_at"
  )
);

CREATE INDEX "outcome_governed_pick_pav_model_candidate_scope_idx"
  ON "outcome_governed_pick_pav_model_candidate"("observation_set_id","completed_at");

CREATE TABLE "outcome_pick_pav_model_run_consumption" (
  "consumption_id" TEXT PRIMARY KEY,
  "run_authorization_id" TEXT NOT NULL UNIQUE REFERENCES "outcome_pick_pav_model_run_authorization"("run_authorization_id") ON DELETE RESTRICT,
  "candidate_id" TEXT NOT NULL UNIQUE,
  "consumed_at" TIMESTAMPTZ(3) NOT NULL,
  "consumption_content_canonical_json" TEXT NOT NULL,
  "consumption_json" JSONB NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "registered_by" TEXT NOT NULL DEFAULT CURRENT_USER,
  CONSTRAINT "outcome_pick_pav_model_run_consumption_identity_check" CHECK (
    "consumption_id" ~ '^pick-pav-model-run-consumption:[a-f0-9]{64}$' AND
    "run_authorization_id" ~ '^pick-pav-model-run-authorization:[a-f0-9]{64}$' AND
    "candidate_id" ~ '^pick-pav-model-candidate:[a-f0-9]{64}$'
  )
);

ALTER TABLE "outcome_governed_pick_pav_model_candidate"
  ADD CONSTRAINT "outcome_governed_pick_candidate_consumption_fk"
  FOREIGN KEY ("consumption_id") REFERENCES "outcome_pick_pav_model_run_consumption"("consumption_id")
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "outcome_pick_pav_model_run_consumption"
  ADD CONSTRAINT "outcome_pick_pav_consumption_candidate_fk"
  FOREIGN KEY ("candidate_id") REFERENCES "outcome_governed_pick_pav_model_candidate"("candidate_id")
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE "outcome_private_valuation_authority_bundle" (
  "valuation_bundle_id" TEXT PRIMARY KEY,
  "valuation_scope_key" TEXT NOT NULL,
  "at_trade_player_run_id" TEXT NOT NULL REFERENCES "outcome_valuation_model_run"("run_id") ON DELETE RESTRICT,
  "at_trade_player_gate3_decision_id" TEXT NOT NULL,
  "at_trade_pick_candidate_id" TEXT NOT NULL REFERENCES "outcome_governed_pick_pav_model_candidate"("candidate_id") ON DELETE RESTRICT,
  "at_trade_pick_gate3_decision_id" TEXT NOT NULL,
  "current_player_run_id" TEXT NOT NULL REFERENCES "outcome_valuation_model_run"("run_id") ON DELETE RESTRICT,
  "current_player_gate3_decision_id" TEXT NOT NULL,
  "current_pick_candidate_id" TEXT NOT NULL REFERENCES "outcome_governed_pick_pav_model_candidate"("candidate_id") ON DELETE RESTRICT,
  "current_pick_gate3_decision_id" TEXT NOT NULL,
  "hpn_pav_method_id" TEXT NOT NULL REFERENCES "outcome_hpn_pav_method"("method_id") ON DELETE RESTRICT,
  "transaction_effective_at" TIMESTAMPTZ(3) NOT NULL,
  "current_valuation_as_of" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "bundle_content_canonical_json" TEXT NOT NULL,
  "bundle_json" JSONB NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "registered_by" TEXT NOT NULL DEFAULT CURRENT_USER,
  CONSTRAINT "outcome_private_valuation_authority_bundle_identity_check" CHECK (
    "valuation_bundle_id" ~ '^valuation-bundle:[a-f0-9]{64}$' AND
    "at_trade_player_run_id" ~ '^model-run:[a-f0-9]{64}$' AND
    "at_trade_player_gate3_decision_id" ~ '^gate-decision:[a-f0-9]{64}$' AND
    "at_trade_pick_candidate_id" ~ '^pick-pav-model-candidate:[a-f0-9]{64}$' AND
    "at_trade_pick_gate3_decision_id" ~ '^gate-decision:[a-f0-9]{64}$' AND
    "current_player_run_id" ~ '^model-run:[a-f0-9]{64}$' AND
    "current_player_gate3_decision_id" ~ '^gate-decision:[a-f0-9]{64}$' AND
    "current_pick_candidate_id" ~ '^pick-pav-model-candidate:[a-f0-9]{64}$' AND
    "current_pick_gate3_decision_id" ~ '^gate-decision:[a-f0-9]{64}$' AND
    "hpn_pav_method_id" ~ '^hpn-pav-method:[a-f0-9]{64}$' AND
    "at_trade_player_gate3_decision_id" <> "at_trade_pick_gate3_decision_id" AND
    "current_player_gate3_decision_id" <> "current_pick_gate3_decision_id" AND
    "at_trade_player_gate3_decision_id" <> "current_pick_gate3_decision_id" AND
    "at_trade_pick_gate3_decision_id" <> "current_player_gate3_decision_id" AND
    ("at_trade_player_gate3_decision_id" <> "current_player_gate3_decision_id" OR
      "at_trade_player_run_id" = "current_player_run_id") AND
    ("at_trade_pick_gate3_decision_id" <> "current_pick_gate3_decision_id" OR
      "at_trade_pick_candidate_id" = "current_pick_candidate_id") AND
    "transaction_effective_at" <= "current_valuation_as_of" AND
    "current_valuation_as_of" <= "created_at"
  )
);

CREATE INDEX "outcome_private_valuation_authority_bundle_scope_idx"
  ON "outcome_private_valuation_authority_bundle"("valuation_scope_key","created_at");

CREATE FUNCTION "validate_outcome_pick_pav_observation_admission_insert"() RETURNS TRIGGER AS $$
DECLARE
  content JSONB := NEW."admission_json"->'content';
  observation RECORD;
BEGIN
  SELECT observation_set_sha256,environment,release_id,policy_id,observation_set_json,status,finalized_at
    INTO observation FROM outcome_pick_pav_observation_set
   WHERE observation_set_id=NEW."observation_set_id" FOR KEY SHARE;
  IF NOT FOUND OR observation.status <> 'finalized' OR observation.finalized_at IS NULL OR
     observation.environment <> 'non_production' OR
     NEW."admission_content_canonical_json" IS DISTINCT FROM outcome_afl_trade_canonical_json(content) OR
     NEW."observation_admission_id" IS DISTINCT FROM 'pick-pav-observation-admission:' || encode(sha256(convert_to(NEW."admission_content_canonical_json",'UTF8')),'hex') OR
     NEW."admission_json"->>'observationAdmissionId' IS DISTINCT FROM NEW."observation_admission_id" OR
     content->>'schemaVersion' IS DISTINCT FROM 'afl-trade-pick-pav-observation-admission/v1' OR
     content->>'authorityBoundary' IS DISTINCT FROM 'non_production_pick_observation_model_training_admission_not_run_gate_3_scoring_or_publication_authority' OR
     content->>'environment' IS DISTINCT FROM 'non_production' OR
     content->'publicationEligible' IS DISTINCT FROM 'false'::jsonb OR
     content->>'observationSetId' IS DISTINCT FROM NEW."observation_set_id" OR
     content->>'observationSetSha256' IS DISTINCT FROM NEW."observation_set_sha256" OR
     content->>'releaseId' IS DISTINCT FROM NEW."release_id" OR
     content->>'policyId' IS DISTINCT FROM NEW."policy_id" OR
     content->>'sourceQualificationReportId' IS DISTINCT FROM NEW."source_qualification_report_id" OR
     content->>'gate2DecisionId' IS DISTINCT FROM NEW."gate2_decision_id" OR
     content->>'admittedUse' IS DISTINCT FROM 'candidate_training_validation_and_final_test_only' OR
     content->>'tradeScoringAuthority' IS DISTINCT FROM 'not_granted' OR
     (content->>'admittedAt')::timestamptz IS DISTINCT FROM NEW."admitted_at" OR
     observation.observation_set_sha256 IS DISTINCT FROM NEW."observation_set_sha256" OR
     observation.release_id IS DISTINCT FROM NEW."release_id" OR
     observation.policy_id IS DISTINCT FROM NEW."policy_id" THEN
    RAISE EXCEPTION 'Pick-PAV observation admission identity or ancestry mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "validate_outcome_pick_pav_model_run_intent_insert"() RETURNS TRIGGER AS $$
DECLARE
  content JSONB := NEW."intent_json"->'content';
  admission RECORD;
BEGIN
  SELECT observation_set_id,admitted_at INTO admission
    FROM outcome_pick_pav_observation_admission
   WHERE observation_admission_id=NEW."observation_admission_id" FOR KEY SHARE;
  IF NOT FOUND OR
     NEW."intent_content_canonical_json" IS DISTINCT FROM outcome_afl_trade_canonical_json(content) OR
     NEW."run_intent_id" IS DISTINCT FROM 'pick-pav-model-run-intent:' || encode(sha256(convert_to(NEW."intent_content_canonical_json",'UTF8')),'hex') OR
     NEW."intent_json"->>'runIntentId' IS DISTINCT FROM NEW."run_intent_id" OR
     content->>'schemaVersion' IS DISTINCT FROM 'afl-trade-pick-pav-model-run-intent/v1' OR
     content->>'environment' IS DISTINCT FROM 'non_production' OR
     content->'publicationEligible' IS DISTINCT FROM 'false'::jsonb OR
     content->>'observationAdmissionId' IS DISTINCT FROM NEW."observation_admission_id" OR
     content->>'observationSetId' IS DISTINCT FROM NEW."observation_set_id" OR
     content->>'modelId' IS DISTINCT FROM NEW."model_id" OR
     content->>'modelVersion' IS DISTINCT FROM NEW."model_version" OR
     content->'cleanWorktree' IS DISTINCT FROM 'true'::jsonb OR
     content->>'candidateOutputs' IS DISTINCT FROM 'not_yet_created' OR
     (content->>'startedAt')::timestamptz IS DISTINCT FROM NEW."started_at" OR
     admission.observation_set_id IS DISTINCT FROM NEW."observation_set_id" OR
     NEW."started_at" < admission.admitted_at THEN
    RAISE EXCEPTION 'Pick-PAV run intent identity or ancestry mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "validate_outcome_pick_pav_model_run_authorization_insert"() RETURNS TRIGGER AS $$
DECLARE
  content JSONB := NEW."authorization_json"->'content';
  intent RECORD;
BEGIN
  SELECT observation_admission_id,observation_set_id,started_at INTO intent
    FROM outcome_pick_pav_model_run_intent
   WHERE run_intent_id=NEW."run_intent_id" FOR KEY SHARE;
  IF NOT FOUND OR
     NEW."authorization_content_canonical_json" IS DISTINCT FROM outcome_afl_trade_canonical_json(content) OR
     NEW."run_authorization_id" IS DISTINCT FROM 'pick-pav-model-run-authorization:' || encode(sha256(convert_to(NEW."authorization_content_canonical_json",'UTF8')),'hex') OR
     NEW."authorization_json"->>'runAuthorizationId' IS DISTINCT FROM NEW."run_authorization_id" OR
     content->>'schemaVersion' IS DISTINCT FROM 'afl-trade-pick-pav-model-run-authorization/v1' OR
     content->>'environment' IS DISTINCT FROM 'non_production' OR
     content->'publicationEligible' IS DISTINCT FROM 'false'::jsonb OR
     content->>'runIntentId' IS DISTINCT FROM NEW."run_intent_id" OR
     content->>'observationAdmissionId' IS DISTINCT FROM NEW."observation_admission_id" OR
     content->>'observationSetId' IS DISTINCT FROM NEW."observation_set_id" OR
     content->>'operationalPrincipalAuthorityId' IS DISTINCT FROM NEW."operational_principal_authority_id" OR
     (content->>'gateLedgerRevision')::integer IS DISTINCT FROM NEW."gate_ledger_revision" OR
     (content->>'authorizedAt')::timestamptz IS DISTINCT FROM NEW."authorized_at" OR
     (content->>'validThrough')::timestamptz IS DISTINCT FROM NEW."valid_through" OR
     content->>'consumption' IS DISTINCT FROM 'exactly_once' OR
     content->>'gate3Authority' IS DISTINCT FROM 'not_granted' OR
     content->>'tradeScoringAuthority' IS DISTINCT FROM 'not_granted' OR
     intent.observation_admission_id IS DISTINCT FROM NEW."observation_admission_id" OR
     intent.observation_set_id IS DISTINCT FROM NEW."observation_set_id" OR
     NEW."authorized_at" < intent.started_at THEN
    RAISE EXCEPTION 'Pick-PAV run authorization identity or ancestry mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "validate_outcome_governed_pick_pav_model_candidate_insert"() RETURNS TRIGGER AS $$
DECLARE
  content JSONB := NEW."candidate_json"->'content';
  authorization_row RECORD;
BEGIN
  SELECT run_intent_id,observation_admission_id,observation_set_id,authorized_at,valid_through
    INTO authorization_row FROM outcome_pick_pav_model_run_authorization
   WHERE run_authorization_id=NEW."run_authorization_id" FOR KEY SHARE;
  IF NOT FOUND OR
     NEW."candidate_content_canonical_json" IS DISTINCT FROM outcome_afl_trade_canonical_json(content) OR
     NEW."candidate_id" IS DISTINCT FROM 'pick-pav-model-candidate:' || encode(sha256(convert_to(NEW."candidate_content_canonical_json",'UTF8')),'hex') OR
     NEW."candidate_json"->>'candidateId' IS DISTINCT FROM NEW."candidate_id" OR
     content->>'schemaVersion' IS DISTINCT FROM 'afl-trade-governed-pick-pav-model-candidate/v1' OR
     content->>'environment' IS DISTINCT FROM 'non_production' OR
     content->'publicationEligible' IS DISTINCT FROM 'false'::jsonb OR
     content->>'gate3Authority' IS DISTINCT FROM 'not_granted' OR
     content->>'tradeScoringAuthority' IS DISTINCT FROM 'not_granted' OR
     content->>'observationSetId' IS DISTINCT FROM NEW."observation_set_id" OR
     content->>'observationAdmissionId' IS DISTINCT FROM NEW."observation_admission_id" OR
     content->>'runIntentId' IS DISTINCT FROM NEW."run_intent_id" OR
     content->>'runAuthorizationId' IS DISTINCT FROM NEW."run_authorization_id" OR
     content->>'modelId' IS DISTINCT FROM NEW."model_id" OR
     content->>'modelVersion' IS DISTINCT FROM NEW."model_version" OR
     (content->>'startedAt')::timestamptz IS DISTINCT FROM NEW."started_at" OR
     (content->>'candidateLockedAt')::timestamptz IS DISTINCT FROM NEW."candidate_locked_at" OR
     (content->>'finalTestEvaluatedAt')::timestamptz IS DISTINCT FROM NEW."final_test_evaluated_at" OR
     (content->>'completedAt')::timestamptz IS DISTINCT FROM NEW."completed_at" OR
     authorization_row.run_intent_id IS DISTINCT FROM NEW."run_intent_id" OR
     authorization_row.observation_admission_id IS DISTINCT FROM NEW."observation_admission_id" OR
     authorization_row.observation_set_id IS DISTINCT FROM NEW."observation_set_id" OR
     NEW."started_at" < authorization_row.authorized_at OR
     NEW."completed_at" > authorization_row.valid_through THEN
    RAISE EXCEPTION 'Governed pick-PAV candidate identity, ancestry, or authority-window mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "validate_outcome_pick_pav_model_run_consumption_insert"() RETURNS TRIGGER AS $$
DECLARE
  content JSONB := NEW."consumption_json"->'content';
  authorization_row RECORD;
  candidate RECORD;
  authorization_found BOOLEAN;
  candidate_found BOOLEAN;
BEGIN
  SELECT authorized_at,valid_through INTO authorization_row
    FROM outcome_pick_pav_model_run_authorization
   WHERE run_authorization_id=NEW."run_authorization_id" FOR KEY SHARE;
  authorization_found := FOUND;
  SELECT run_authorization_id,completed_at,consumption_id INTO candidate
    FROM outcome_governed_pick_pav_model_candidate
   WHERE candidate_id=NEW."candidate_id" FOR KEY SHARE;
  candidate_found := FOUND;
  IF NOT authorization_found OR NOT candidate_found OR
     NEW."consumption_content_canonical_json" IS DISTINCT FROM outcome_afl_trade_canonical_json(content) OR
     NEW."consumption_id" IS DISTINCT FROM 'pick-pav-model-run-consumption:' || encode(sha256(convert_to(NEW."consumption_content_canonical_json",'UTF8')),'hex') OR
     NEW."consumption_json"->>'consumptionId' IS DISTINCT FROM NEW."consumption_id" OR
     content->>'schemaVersion' IS DISTINCT FROM 'afl-trade-pick-pav-model-run-consumption/v1' OR
     content->>'authorityBoundary' IS DISTINCT FROM 'exactly_once_non_production_candidate_consumption_not_gate_3_trade_scoring_or_publication_authority' OR
     content->>'environment' IS DISTINCT FROM 'non_production' OR
     content->'publicationEligible' IS DISTINCT FROM 'false'::jsonb OR
     content->>'runAuthorizationId' IS DISTINCT FROM NEW."run_authorization_id" OR
     content->>'candidateId' IS DISTINCT FROM NEW."candidate_id" OR
     (content->>'consumedAt')::timestamptz IS DISTINCT FROM NEW."consumed_at" OR
     content->>'consumptionState' IS DISTINCT FROM 'consumed' OR
     content->>'gate3Authority' IS DISTINCT FROM 'not_granted' OR
     content->>'tradeScoringAuthority' IS DISTINCT FROM 'not_granted' OR
     candidate.run_authorization_id IS DISTINCT FROM NEW."run_authorization_id" OR
     candidate.consumption_id IS DISTINCT FROM NEW."consumption_id" OR
     NEW."consumed_at" < candidate.completed_at OR
     NEW."consumed_at" < authorization_row.authorized_at OR
     NEW."consumed_at" > authorization_row.valid_through THEN
    RAISE EXCEPTION 'Pick-PAV run consumption identity, candidate, or authority-window mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "validate_outcome_private_valuation_authority_bundle_insert"() RETURNS TRIGGER AS $$
DECLARE
  content JSONB := NEW."bundle_json"->'content';
BEGIN
  IF NEW."bundle_content_canonical_json" IS DISTINCT FROM outcome_afl_trade_canonical_json(content) OR
     NEW."valuation_bundle_id" IS DISTINCT FROM 'valuation-bundle:' || encode(sha256(convert_to(NEW."bundle_content_canonical_json",'UTF8')),'hex') OR
     NEW."bundle_json"->>'valuationBundleId' IS DISTINCT FROM NEW."valuation_bundle_id" OR
     content->>'schemaVersion' IS DISTINCT FROM 'afl-trade-private-valuation-authority-bundle/v2' OR
     content->>'environment' IS DISTINCT FROM 'non_production' OR
     content->'publicationEligible' IS DISTINCT FROM 'false'::jsonb OR
     content->'publicationProhibited' IS DISTINCT FROM 'true'::jsonb OR
     content->>'valuationScopeKey' IS DISTINCT FROM NEW."valuation_scope_key" OR
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
     content->'modelAuthorities'->'atTrade'->'player'->>'knowledgeCutoffAt' IS NULL OR
     content->'modelAuthorities'->'atTrade'->'pick'->>'knowledgeCutoffAt' IS NULL OR
     content->'modelAuthorities'->'currentRemaining'->'player'->>'knowledgeCutoffAt' IS NULL OR
     content->'modelAuthorities'->'currentRemaining'->'pick'->>'knowledgeCutoffAt' IS NULL OR
     (content->'modelAuthorities'->'atTrade'->'player'->>'knowledgeCutoffAt')::timestamptz > NEW."transaction_effective_at" OR
     (content->'modelAuthorities'->'atTrade'->'pick'->>'knowledgeCutoffAt')::timestamptz > NEW."transaction_effective_at" OR
     (content->'modelAuthorities'->'currentRemaining'->'player'->>'knowledgeCutoffAt')::timestamptz > NEW."current_valuation_as_of" OR
     (content->'modelAuthorities'->'currentRemaining'->'pick'->>'knowledgeCutoffAt')::timestamptz > NEW."current_valuation_as_of" OR
     (content->'modelAuthorities'->'atTrade'->'player' = content->'modelAuthorities'->'currentRemaining'->'player' AND
       content->'authorityReuse'->>'player' IS DISTINCT FROM 'same_authority_cutoff_safe_for_both') OR
     (content->'modelAuthorities'->'atTrade'->'player' <> content->'modelAuthorities'->'currentRemaining'->'player' AND
       content->'authorityReuse'->>'player' IS DISTINCT FROM 'distinct_authorities') OR
     (content->'modelAuthorities'->'atTrade'->'pick' = content->'modelAuthorities'->'currentRemaining'->'pick' AND
       content->'authorityReuse'->>'pick' IS DISTINCT FROM 'same_authority_cutoff_safe_for_both') OR
     (content->'modelAuthorities'->'atTrade'->'pick' <> content->'modelAuthorities'->'currentRemaining'->'pick' AND
       content->'authorityReuse'->>'pick' IS DISTINCT FROM 'distinct_authorities') OR
     content->>'hpnPavMethodId' IS DISTINCT FROM NEW."hpn_pav_method_id" OR
     (content->>'transactionEffectiveAt')::timestamptz IS DISTINCT FROM NEW."transaction_effective_at" OR
     (content->>'currentValuationAsOf')::timestamptz IS DISTINCT FROM NEW."current_valuation_as_of" OR
     (content->>'createdAt')::timestamptz IS DISTINCT FROM NEW."created_at" OR
     content->>'gate3Authority' IS DISTINCT FROM 'requires_exact_current_component_and_bundle_decisions' THEN
    RAISE EXCEPTION 'Private valuation authority bundle identity or ancestry mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "reject_outcome_private_model_authority_mutation"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Private model authority evidence is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_pick_pav_observation_admission_insert_guard" BEFORE INSERT ON "outcome_pick_pav_observation_admission" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_pick_pav_observation_admission_insert"();
CREATE TRIGGER "outcome_pick_pav_model_run_intent_insert_guard" BEFORE INSERT ON "outcome_pick_pav_model_run_intent" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_pick_pav_model_run_intent_insert"();
CREATE TRIGGER "outcome_pick_pav_model_run_authorization_insert_guard" BEFORE INSERT ON "outcome_pick_pav_model_run_authorization" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_pick_pav_model_run_authorization_insert"();
CREATE TRIGGER "outcome_governed_pick_pav_model_candidate_insert_guard" BEFORE INSERT ON "outcome_governed_pick_pav_model_candidate" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_governed_pick_pav_model_candidate_insert"();
CREATE TRIGGER "outcome_pick_pav_model_run_consumption_insert_guard" BEFORE INSERT ON "outcome_pick_pav_model_run_consumption" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_pick_pav_model_run_consumption_insert"();
CREATE TRIGGER "outcome_private_valuation_authority_bundle_insert_guard" BEFORE INSERT ON "outcome_private_valuation_authority_bundle" FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_valuation_authority_bundle_insert"();

CREATE TRIGGER "outcome_pick_pav_observation_admission_mutation_guard" BEFORE UPDATE OR DELETE ON "outcome_pick_pav_observation_admission" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_model_authority_mutation"();
CREATE TRIGGER "outcome_pick_pav_model_run_intent_mutation_guard" BEFORE UPDATE OR DELETE ON "outcome_pick_pav_model_run_intent" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_model_authority_mutation"();
CREATE TRIGGER "outcome_pick_pav_model_run_authorization_mutation_guard" BEFORE UPDATE OR DELETE ON "outcome_pick_pav_model_run_authorization" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_model_authority_mutation"();
CREATE TRIGGER "outcome_governed_pick_pav_model_candidate_mutation_guard" BEFORE UPDATE OR DELETE ON "outcome_governed_pick_pav_model_candidate" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_model_authority_mutation"();
CREATE TRIGGER "outcome_pick_pav_model_run_consumption_mutation_guard" BEFORE UPDATE OR DELETE ON "outcome_pick_pav_model_run_consumption" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_model_authority_mutation"();
CREATE TRIGGER "outcome_private_valuation_authority_bundle_mutation_guard" BEFORE UPDATE OR DELETE ON "outcome_private_valuation_authority_bundle" FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_model_authority_mutation"();
