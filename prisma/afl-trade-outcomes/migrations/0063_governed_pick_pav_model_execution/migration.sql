-- Governed pick-PAV executions are a separate non-production authority path. The existing
-- test-fixture execution registry remains unchanged and cannot become Gate 3 eligible.

CREATE TABLE "outcome_governed_pick_pav_model_execution" (
    "execution_id" TEXT NOT NULL,
    "observation_set_id" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "dataset_artifact_id" TEXT NOT NULL,
    "dataset_admission_id" TEXT NOT NULL,
    "dataset_admission_artifact_id" TEXT NOT NULL,
    "dataset_admission_gate_ledger_revision" INTEGER NOT NULL,
    "protocol_id" TEXT NOT NULL,
    "protocol_artifact_id" TEXT NOT NULL,
    "execution_artifact_id" TEXT NOT NULL,
    "final_test_evaluation_started_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3) NOT NULL,
    "content_sha256" CHAR(64) NOT NULL,
    "content_canonical_json" TEXT NOT NULL,
    "execution_json" JSONB NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "recorded_by" TEXT NOT NULL DEFAULT current_user,

    CONSTRAINT "outcome_governed_pick_pav_model_execution_pkey"
      PRIMARY KEY ("execution_id"),
    CONSTRAINT "outcome_governed_pick_pav_model_execution_artifact_key"
      UNIQUE ("execution_artifact_id"),
    CONSTRAINT "outcome_governed_pick_pav_model_execution_identity_check"
      CHECK (
        "execution_id" ~ '^pick-pav-model-execution:[a-f0-9]{64}$'
        AND "content_sha256" ~ '^[a-f0-9]{64}$'
        AND "dataset_id" ~ '^dataset:[a-f0-9]{64}$'
        AND "dataset_admission_id" ~ '^dataset-admission:[a-f0-9]{64}$'
        AND "protocol_id" ~ '^model-protocol:[a-f0-9]{64}$'
        AND "dataset_admission_gate_ledger_revision" > 0
        AND "completed_at" >= "final_test_evaluation_started_at"
      ),
    CONSTRAINT "outcome_governed_pick_pav_model_execution_observation_fkey"
      FOREIGN KEY ("observation_set_id")
      REFERENCES "outcome_pick_pav_observation_set"("observation_set_id") ON DELETE RESTRICT,
    CONSTRAINT "outcome_governed_pick_pav_model_execution_dataset_fkey"
      FOREIGN KEY ("dataset_id")
      REFERENCES "outcome_valuation_dataset_candidate"("dataset_id") ON DELETE RESTRICT,
    CONSTRAINT "outcome_governed_pick_pav_model_execution_admission_fkey"
      FOREIGN KEY ("dataset_admission_id")
      REFERENCES "outcome_valuation_dataset_admission"("admission_id") ON DELETE RESTRICT,
    CONSTRAINT "outcome_governed_pick_pav_model_execution_protocol_fkey"
      FOREIGN KEY ("protocol_id")
      REFERENCES "outcome_valuation_model_protocol"("protocol_id") ON DELETE RESTRICT,
    CONSTRAINT "outcome_governed_pick_pav_model_execution_artifact_fkey"
      FOREIGN KEY ("execution_artifact_id")
      REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT,
    CONSTRAINT "outcome_governed_pick_pav_model_execution_dataset_artifact_fkey"
      FOREIGN KEY ("dataset_artifact_id")
      REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT,
    CONSTRAINT "outcome_governed_pick_exec_admission_artifact_fkey"
      FOREIGN KEY ("dataset_admission_artifact_id")
      REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT,
    CONSTRAINT "outcome_governed_pick_exec_protocol_artifact_fkey"
      FOREIGN KEY ("protocol_artifact_id")
      REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION "validate_outcome_governed_pick_pav_model_execution_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  content JSONB := NEW."execution_json"->'content';
  observation_row RECORD;
  dataset_row RECORD;
  admission_row RECORD;
  protocol_row RECORD;
BEGIN
  SELECT * INTO observation_row FROM "outcome_pick_pav_observation_set"
   WHERE "observation_set_id"=NEW."observation_set_id" FOR SHARE;
  SELECT * INTO dataset_row FROM "outcome_valuation_dataset_candidate"
   WHERE "dataset_id"=NEW."dataset_id" FOR SHARE;
  SELECT * INTO admission_row FROM "outcome_valuation_dataset_admission"
   WHERE "admission_id"=NEW."dataset_admission_id" FOR SHARE;
  SELECT * INTO protocol_row FROM "outcome_valuation_model_protocol"
   WHERE "protocol_id"=NEW."protocol_id" FOR SHARE;

  IF NEW."execution_json"->>'executionId' IS DISTINCT FROM NEW."execution_id"
    OR NEW."content_sha256" IS DISTINCT FROM
      substring(NEW."execution_id" FROM length('pick-pav-model-execution:') + 1)
    OR NEW."content_canonical_json" IS DISTINCT FROM outcome_afl_trade_canonical_json(content)
    OR NEW."execution_id" IS DISTINCT FROM 'pick-pav-model-execution:' ||
      encode(sha256(convert_to(NEW."content_canonical_json",'UTF8')),'hex')
    OR content->>'schemaVersion' IS DISTINCT FROM 'afl-trade-pick-pav-model-execution/v2'
    OR content->>'environment' IS DISTINCT FROM 'non_production'
    OR content->>'approvalStatus' IS DISTINCT FROM 'gate_3_review_required'
    OR content->>'publicationEligible' IS DISTINCT FROM 'false'
    OR content->>'observationSetId' IS DISTINCT FROM NEW."observation_set_id"
    OR content->>'datasetId' IS DISTINCT FROM NEW."dataset_id"
    OR content->'datasetArtifact'->>'artifactId' IS DISTINCT FROM NEW."dataset_artifact_id"
    OR content->>'datasetAdmissionId' IS DISTINCT FROM NEW."dataset_admission_id"
    OR content->'datasetAdmissionArtifact'->>'artifactId'
      IS DISTINCT FROM NEW."dataset_admission_artifact_id"
    OR (content->>'datasetAdmissionGateLedgerRevision')::INTEGER
      IS DISTINCT FROM NEW."dataset_admission_gate_ledger_revision"
    OR content->>'protocolId' IS DISTINCT FROM NEW."protocol_id"
    OR content->'protocolArtifact'->>'artifactId' IS DISTINCT FROM NEW."protocol_artifact_id"
    OR (content->>'finalTestEvaluationStartedAt')::TIMESTAMPTZ
      IS DISTINCT FROM NEW."final_test_evaluation_started_at"
    OR (content->>'completedAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."completed_at"
    OR observation_row."status" IS DISTINCT FROM 'finalized'
    OR observation_row."environment" IS DISTINCT FROM 'non_production'::"OutcomeEnvironment"
    OR dataset_row."status" IS DISTINCT FROM 'finalized'
    OR dataset_row."environment" IS DISTINCT FROM 'non_production'::"OutcomeEnvironment"
    OR admission_row."status" IS DISTINCT FROM 'finalized'
    OR admission_row."environment" IS DISTINCT FROM 'non_production'::"OutcomeEnvironment"
    OR admission_row."dataset_id" IS DISTINCT FROM NEW."dataset_id"
    OR admission_row."gate_ledger_revision"
      IS DISTINCT FROM NEW."dataset_admission_gate_ledger_revision"
    OR protocol_row."environment" IS DISTINCT FROM 'non_production'::"OutcomeEnvironment"
    OR protocol_row."dataset_id" IS DISTINCT FROM NEW."dataset_id"
    OR protocol_row."admission_id" IS DISTINCT FROM NEW."dataset_admission_id"
    OR NEW."dataset_artifact_id" IS DISTINCT FROM 'artifact:' || encode(sha256(convert_to(
      outcome_afl_trade_canonical_json(dataset_row."dataset_json"),'UTF8')),'hex')
    OR NEW."dataset_admission_artifact_id" IS DISTINCT FROM 'artifact:' || encode(sha256(convert_to(
      outcome_afl_trade_canonical_json(admission_row."admission_json"),'UTF8')),'hex')
    OR NEW."protocol_artifact_id" IS DISTINCT FROM 'artifact:' || encode(sha256(convert_to(
      outcome_afl_trade_canonical_json(protocol_row."protocol_json"),'UTF8')),'hex')
    OR observation_row."release_id" IS DISTINCT FROM
      dataset_row."dataset_json"->'content'->'factualParent'->>'factualReleaseId'
    OR observation_row."release_id" IS DISTINCT FROM
      admission_row."admission_json"->'content'->>'factualReleaseId'
  THEN
    RAISE EXCEPTION 'Governed pick-PAV execution authority or ancestry mismatch';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_governed_pick_pav_model_execution_validate_insert"
BEFORE INSERT ON "outcome_governed_pick_pav_model_execution"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_governed_pick_pav_model_execution_insert"();

CREATE OR REPLACE FUNCTION "reject_outcome_governed_pick_pav_model_execution_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Governed pick-PAV model executions are append-only';
END $$;

CREATE TRIGGER "outcome_governed_pick_pav_model_execution_append_only"
BEFORE UPDATE OR DELETE ON "outcome_governed_pick_pav_model_execution"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_governed_pick_pav_model_execution_mutation"();

CREATE INDEX "outcome_governed_pick_pav_model_execution_ancestry_idx"
  ON "outcome_governed_pick_pav_model_execution"
    ("dataset_id", "dataset_admission_id", "protocol_id", "completed_at");

ALTER TABLE "outcome_governed_valuation_component_run"
  DROP CONSTRAINT "outcome_governed_valuation_component_run_role_check";
ALTER TABLE "outcome_governed_valuation_component_run"
  ADD CONSTRAINT "outcome_governed_valuation_component_run_role_check"
  CHECK (
    ("role"='player_contribution_and_availability'
      AND "native_execution_kind"='admitted_player_model_run'
      AND "native_execution_id" ~ '^model-run:[a-f0-9]{64}$')
    OR
    ("role"='draft_pick_and_future_pick_distribution'
      AND "native_execution_kind" IN
        ('pick_pav_model_execution','governed_pick_pav_model_execution')
      AND "native_execution_id" ~ '^pick-pav-model-execution:[a-f0-9]{64}$')
  );
