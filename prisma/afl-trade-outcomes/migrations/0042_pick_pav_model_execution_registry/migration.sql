CREATE TABLE "outcome_pick_pav_model_execution" (
  "execution_id" TEXT PRIMARY KEY,
  "observation_set_id" TEXT NOT NULL REFERENCES "outcome_pick_pav_observation_set"("observation_set_id") ON DELETE RESTRICT,
  "observation_set_sha256" CHAR(64) NOT NULL,
  "environment" "OutcomeEnvironment" NOT NULL,
  "competition" TEXT NOT NULL,
  "release_id" TEXT NOT NULL,
  "policy_id" TEXT NOT NULL,
  "method_id" TEXT NOT NULL,
  "final_test_evaluation_started_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3) NOT NULL,
  "retained_at" TIMESTAMPTZ(3) NOT NULL,
  "execution_content_canonical_json" TEXT NOT NULL,
  "execution_canonical_json" TEXT NOT NULL,
  "execution_json" JSONB NOT NULL,
  "custody_receipt_id" TEXT NOT NULL UNIQUE,
  "custody_content_canonical_json" TEXT NOT NULL,
  "custody_canonical_json" TEXT NOT NULL,
  "custody_json" JSONB NOT NULL,
  "execution_readback_content_canonical_json" TEXT NOT NULL,
  "execution_readback_canonical_json" TEXT NOT NULL,
  "repository_assurance" TEXT NOT NULL,
  "custody_profile_id" TEXT,
  "execution_artifact_id" TEXT NOT NULL,
  "execution_artifact_sha256" CHAR(64) NOT NULL,
  "readback_receipt_artifact_id" TEXT NOT NULL,
  "readback_receipt_artifact_sha256" CHAR(64) NOT NULL,
  "status" TEXT NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT transaction_timestamp(),
  "registered_by" TEXT NOT NULL DEFAULT CURRENT_USER,
  CONSTRAINT "outcome_pick_pav_model_execution_identity_check" CHECK (
    "execution_id" ~ '^pick-pav-model-execution:[a-f0-9]{64}$' AND
    "observation_set_id" ~ '^pick-pav-observation-set:[a-f0-9]{64}$' AND
    "observation_set_sha256" ~ '^[a-f0-9]{64}$' AND
    "release_id" ~ '^outcome-release:[a-f0-9]{64}$' AND
    "policy_id" ~ '^pick-pav-policy:[a-f0-9]{64}$' AND
    "method_id" ~ '^hpn-pav-method:[a-f0-9]{64}$' AND
    "custody_receipt_id" ~ '^pick-pav-model-custody:[a-f0-9]{64}$' AND
    "execution_artifact_id" = 'artifact:' || "execution_artifact_sha256" AND
    "readback_receipt_artifact_id" = 'artifact:' || "readback_receipt_artifact_sha256" AND
    "status" = 'retained_verified' AND
    (
      ("repository_assurance"='fixture_memory' AND "environment"='test_fixture'
        AND "custody_profile_id" IS NULL) OR
      ("repository_assurance"='durable_object_storage'
        AND "custody_profile_id" ~ '^artifact-custody-profile:[a-f0-9]{64}$')
    )
  ),
  CONSTRAINT "outcome_pick_pav_model_execution_chronology_check" CHECK (
    "final_test_evaluation_started_at" <= "completed_at" AND
    "completed_at" <= "retained_at"
  )
);

CREATE INDEX "outcome_pick_pav_model_execution_scope_idx"
  ON "outcome_pick_pav_model_execution"("environment","competition","completed_at");
CREATE INDEX "outcome_pick_pav_model_execution_observation_idx"
  ON "outcome_pick_pav_model_execution"("observation_set_id","completed_at");

CREATE FUNCTION "validate_outcome_pick_pav_model_execution_insert"() RETURNS TRIGGER AS $$
DECLARE
  execution_content JSONB;
  custody_content JSONB;
  readback_content JSONB;
  observation RECORD;
BEGIN
  execution_content := NEW."execution_json"->'content';
  custody_content := NEW."custody_json"->'content';
  readback_content := custody_content->'executionReadback'->'content';

  SELECT observation_set_sha256,environment,competition,release_id,policy_id,created_at,
         observation_set_json,finalized_at,status
    INTO observation
    FROM outcome_pick_pav_observation_set
   WHERE observation_set_id=NEW."observation_set_id"
   FOR KEY SHARE;
  IF NOT FOUND OR observation.status<>'finalized' OR observation.finalized_at IS NULL THEN
    RAISE EXCEPTION 'Pick-PAV model execution requires an exact finalized observation set';
  END IF;

  IF NEW."environment" <> 'test_fixture' OR
     NEW."execution_content_canonical_json" IS DISTINCT FROM
       "outcome_afl_trade_canonical_json"(execution_content) OR
     NEW."execution_canonical_json" IS DISTINCT FROM
       "outcome_afl_trade_canonical_json"(NEW."execution_json") OR
     NEW."execution_content_canonical_json"::jsonb IS DISTINCT FROM execution_content OR
     NEW."execution_canonical_json"::jsonb IS DISTINCT FROM NEW."execution_json" OR
     NEW."execution_id" IS DISTINCT FROM 'pick-pav-model-execution:' ||
       encode(sha256(convert_to(NEW."execution_content_canonical_json",'UTF8')),'hex') OR
     NEW."execution_json"->>'executionId' IS DISTINCT FROM NEW."execution_id" OR
     execution_content->>'schemaVersion' IS DISTINCT FROM
       'afl-trade-pick-pav-model-execution/v1' OR
     execution_content->>'authorityBoundary' IS DISTINCT FROM
       'test_fixture_development_experiment_not_candidate_lock_gate_3_approval_grade_publication_or_fantasy_ownership' OR
     execution_content->'publicationEligible' IS DISTINCT FROM 'false'::jsonb OR
     execution_content->>'approvalStatus' IS DISTINCT FROM
       'development_only_not_eligible_for_gate_3' OR
     execution_content->>'environment' IS DISTINCT FROM NEW."environment"::text OR
     execution_content->>'competition' IS DISTINCT FROM NEW."competition" OR
     execution_content->>'observationSetId' IS DISTINCT FROM NEW."observation_set_id" OR
     execution_content->>'observationSetSha256' IS DISTINCT FROM NEW."observation_set_sha256" OR
     execution_content->>'releaseId' IS DISTINCT FROM NEW."release_id" OR
     execution_content->>'policyId' IS DISTINCT FROM NEW."policy_id" OR
     execution_content->>'methodId' IS DISTINCT FROM NEW."method_id" OR
     execution_content->>'valueUnit' IS DISTINCT FROM 'fixed_horizon_pav' OR
     (execution_content->>'finalTestEvaluationStartedAt')::timestamptz IS DISTINCT FROM
       NEW."final_test_evaluation_started_at" OR
     (execution_content->>'completedAt')::timestamptz IS DISTINCT FROM NEW."completed_at" OR
     execution_content->'observationSet' IS DISTINCT FROM observation.observation_set_json OR
     observation.observation_set_sha256 IS DISTINCT FROM NEW."observation_set_sha256" OR
     observation.environment IS DISTINCT FROM NEW."environment" OR
     observation.competition IS DISTINCT FROM NEW."competition" OR
     observation.release_id IS DISTINCT FROM NEW."release_id" OR
     observation.policy_id IS DISTINCT FROM NEW."policy_id" OR
     NEW."final_test_evaluation_started_at" < observation.created_at OR
     (execution_content->'validationConfig'->>'evaluatedAt')::timestamptz IS DISTINCT FROM
       NEW."final_test_evaluation_started_at" THEN
    RAISE EXCEPTION 'Pick-PAV model execution identity or ancestry mismatch';
  END IF;

  IF NEW."custody_content_canonical_json" IS DISTINCT FROM
       "outcome_afl_trade_canonical_json"(custody_content) OR
     NEW."custody_canonical_json" IS DISTINCT FROM
       "outcome_afl_trade_canonical_json"(NEW."custody_json") OR
     NEW."custody_content_canonical_json"::jsonb IS DISTINCT FROM custody_content OR
     NEW."custody_canonical_json"::jsonb IS DISTINCT FROM NEW."custody_json" OR
     NEW."custody_receipt_id" IS DISTINCT FROM 'pick-pav-model-custody:' ||
       encode(sha256(convert_to(NEW."custody_content_canonical_json",'UTF8')),'hex') OR
     NEW."custody_json"->>'custodyReceiptId' IS DISTINCT FROM NEW."custody_receipt_id" OR
     custody_content->>'schemaVersion' IS DISTINCT FROM
       'afl-trade-pick-pav-model-custody/v1' OR
     custody_content->'publicationEligible' IS DISTINCT FROM 'false'::jsonb OR
     custody_content->>'executionId' IS DISTINCT FROM NEW."execution_id" OR
     custody_content->>'environment' IS DISTINCT FROM NEW."environment"::text OR
     custody_content->>'repositoryAssurance' IS DISTINCT FROM NEW."repository_assurance" OR
     custody_content->>'artifactClass' IS DISTINCT FROM 'derived_private' OR
     custody_content->'custodyProfileId' IS DISTINCT FROM
       COALESCE(to_jsonb(NEW."custody_profile_id"),'null'::jsonb) OR
     (custody_content->>'retainedAt')::timestamptz IS DISTINCT FROM NEW."retained_at" OR
     custody_content->>'status' IS DISTINCT FROM 'retained_verified' OR
     custody_content->'readbackReceiptArtifactVerified' IS DISTINCT FROM 'true'::jsonb OR
     custody_content->'executionArtifact'->>'artifactId' IS DISTINCT FROM
       NEW."execution_artifact_id" OR
     custody_content->'executionArtifact'->>'contentSha256' IS DISTINCT FROM
       NEW."execution_artifact_sha256" OR
     custody_content->'executionArtifact'->>'storageUri' IS DISTINCT FROM
       'artifact://sha256/' || NEW."execution_artifact_sha256" OR
     custody_content->'executionArtifact'->>'mediaType' IS DISTINCT FROM 'application/json' OR
     (custody_content->'executionArtifact'->>'byteLength')::integer IS DISTINCT FROM
       octet_length(convert_to(NEW."execution_canonical_json",'UTF8')) OR
     (custody_content->'executionArtifact'->>'createdAt')::timestamptz IS DISTINCT FROM
       NEW."completed_at" OR
     NEW."execution_artifact_sha256" IS DISTINCT FROM
       encode(sha256(convert_to(NEW."execution_canonical_json",'UTF8')),'hex') THEN
    RAISE EXCEPTION 'Pick-PAV model custody identity or execution artifact mismatch';
  END IF;

  IF NEW."execution_readback_content_canonical_json" IS DISTINCT FROM
       "outcome_afl_trade_canonical_json"(readback_content) OR
     NEW."execution_readback_canonical_json" IS DISTINCT FROM
       "outcome_afl_trade_canonical_json"(custody_content->'executionReadback') OR
     NEW."execution_readback_content_canonical_json"::jsonb IS DISTINCT FROM readback_content OR
     NEW."execution_readback_canonical_json"::jsonb IS DISTINCT FROM
       custody_content->'executionReadback' OR
     custody_content->'executionReadback'->>'receiptId' IS DISTINCT FROM
       'artifact-readback:' ||
         encode(sha256(convert_to(NEW."execution_readback_content_canonical_json",'UTF8')),'hex') OR
     readback_content->>'schemaVersion' IS DISTINCT FROM 'afl-trade-artifact-readback/v4' OR
     readback_content->'artifact' IS DISTINCT FROM custody_content->'executionArtifact' OR
     readback_content->>'repositoryAssurance' IS DISTINCT FROM NEW."repository_assurance" OR
     readback_content->>'artifactClass' IS DISTINCT FROM 'derived_private' OR
     readback_content->'custodyProfileId' IS DISTINCT FROM
       COALESCE(to_jsonb(NEW."custody_profile_id"),'null'::jsonb) OR
     readback_content->>'custodyEnvironment' IS DISTINCT FROM NEW."environment"::text OR
     (readback_content->>'verifiedAt')::timestamptz < NEW."completed_at" OR
     (readback_content->>'verifiedAt')::timestamptz > NEW."retained_at" OR
     readback_content->>'status' IS DISTINCT FROM 'passed' OR
     custody_content->'readbackReceiptArtifact'->>'artifactId' IS DISTINCT FROM
       NEW."readback_receipt_artifact_id" OR
     custody_content->'readbackReceiptArtifact'->>'contentSha256' IS DISTINCT FROM
       NEW."readback_receipt_artifact_sha256" OR
     custody_content->'readbackReceiptArtifact'->>'storageUri' IS DISTINCT FROM
       'artifact://sha256/' || NEW."readback_receipt_artifact_sha256" OR
     custody_content->'readbackReceiptArtifact'->>'mediaType' IS DISTINCT FROM
       'application/json' OR
     (custody_content->'readbackReceiptArtifact'->>'byteLength')::integer IS DISTINCT FROM
       octet_length(convert_to(NEW."execution_readback_canonical_json",'UTF8')) OR
     (custody_content->'readbackReceiptArtifact'->>'createdAt')::timestamptz IS DISTINCT FROM
       (readback_content->>'verifiedAt')::timestamptz OR
     NEW."readback_receipt_artifact_sha256" IS DISTINCT FROM
       encode(sha256(convert_to(NEW."execution_readback_canonical_json",'UTF8')),'hex') OR
     NEW."retained_at" > date_trunc('milliseconds',transaction_timestamp()) THEN
    RAISE EXCEPTION 'Pick-PAV model custody readback or trusted chronology mismatch';
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Pick-PAV model execution contains invalid typed content';
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "reject_outcome_pick_pav_model_execution_mutation"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Pick-PAV model execution evidence is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_pick_pav_model_execution_insert_guard"
  BEFORE INSERT ON "outcome_pick_pav_model_execution"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_pick_pav_model_execution_insert"();

CREATE TRIGGER "outcome_pick_pav_model_execution_mutation_guard"
  BEFORE UPDATE OR DELETE ON "outcome_pick_pav_model_execution"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_pick_pav_model_execution_mutation"();
