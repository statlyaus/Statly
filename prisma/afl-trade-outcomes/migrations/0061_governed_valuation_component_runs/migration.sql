-- Role-aware component runs preserve their native player or pick execution while exposing one
-- content-addressed model-run identity for private Gate 3 review.

CREATE TABLE "outcome_governed_valuation_component_run" (
    "run_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "native_execution_kind" TEXT NOT NULL,
    "native_execution_id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "native_execution_artifact_id" TEXT NOT NULL,
    "protocol_id" TEXT NOT NULL,
    "protocol_artifact_id" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "dataset_artifact_id" TEXT NOT NULL,
    "dataset_admission_id" TEXT NOT NULL,
    "dataset_admission_artifact_id" TEXT NOT NULL,
    "dataset_admission_gate_ledger_revision" INTEGER NOT NULL,
    "registered_at" TIMESTAMPTZ(3) NOT NULL,
    "content_sha256" CHAR(64) NOT NULL,
    "content_canonical_json" TEXT NOT NULL,
    "manifest_json" JSONB NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "outcome_governed_valuation_component_run_pkey" PRIMARY KEY ("run_id"),
    CONSTRAINT "outcome_governed_valuation_component_run_native_key"
      UNIQUE ("native_execution_kind", "native_execution_id"),
    CONSTRAINT "outcome_governed_valuation_component_run_artifact_key" UNIQUE ("artifact_id"),
    CONSTRAINT "outcome_governed_valuation_component_run_id_check"
      CHECK ("run_id" ~ '^model-run:[a-f0-9]{64}$'),
    CONSTRAINT "outcome_governed_valuation_component_run_sha_check"
      CHECK ("content_sha256" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "outcome_governed_valuation_component_run_ancestry_check"
      CHECK (
        "protocol_id" ~ '^model-protocol:[a-f0-9]{64}$'
        AND "dataset_id" ~ '^dataset:[a-f0-9]{64}$'
        AND "dataset_admission_id" ~ '^dataset-admission:[a-f0-9]{64}$'
        AND "dataset_admission_gate_ledger_revision" > 0
      ),
    CONSTRAINT "outcome_governed_valuation_component_run_role_check"
      CHECK (
        ("role"='player_contribution_and_availability'
          AND "native_execution_kind"='admitted_player_model_run'
          AND "native_execution_id" ~ '^model-run:[a-f0-9]{64}$')
        OR
        ("role"='draft_pick_and_future_pick_distribution'
          AND "native_execution_kind"='pick_pav_model_execution'
          AND "native_execution_id" ~ '^pick-pav-model-execution:[a-f0-9]{64}$')
      ),
    CONSTRAINT "outcome_governed_valuation_component_run_artifact_fkey"
      FOREIGN KEY ("artifact_id") REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT,
    CONSTRAINT "outcome_governed_valuation_component_native_artifact_fkey"
      FOREIGN KEY ("native_execution_artifact_id") REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT,
    CONSTRAINT "outcome_governed_valuation_component_protocol_artifact_fkey"
      FOREIGN KEY ("protocol_artifact_id") REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT,
    CONSTRAINT "outcome_governed_valuation_component_dataset_artifact_fkey"
      FOREIGN KEY ("dataset_artifact_id") REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT,
    CONSTRAINT "outcome_governed_valuation_component_admission_artifact_fkey"
      FOREIGN KEY ("dataset_admission_artifact_id") REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION "validate_outcome_governed_valuation_component_run_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  content JSONB := NEW."manifest_json"->'content';
BEGIN
  IF NEW."manifest_json"->>'runId' IS DISTINCT FROM NEW."run_id"
    OR content->>'schemaVersion' IS DISTINCT FROM 'governed-valuation-component-run/v1'
    OR content->>'environment' IS DISTINCT FROM 'non_production'
    OR content->>'role' IS DISTINCT FROM NEW."role"
    OR content->>'approvalState' IS DISTINCT FROM 'gate_3_review_required'
    OR content->>'publicationEligible' IS DISTINCT FROM 'false'
    OR content->'nativeExecution'->>'kind' IS DISTINCT FROM NEW."native_execution_kind"
    OR content->'nativeExecution'->>'executionId' IS DISTINCT FROM NEW."native_execution_id"
    OR content->'nativeExecution'->'artifact'->>'artifactId' IS DISTINCT FROM NEW."native_execution_artifact_id"
    OR content->>'protocolId' IS DISTINCT FROM NEW."protocol_id"
    OR content->'protocolArtifact'->>'artifactId' IS DISTINCT FROM NEW."protocol_artifact_id"
    OR content->>'datasetId' IS DISTINCT FROM NEW."dataset_id"
    OR content->'datasetArtifact'->>'artifactId' IS DISTINCT FROM NEW."dataset_artifact_id"
    OR content->>'datasetAdmissionId' IS DISTINCT FROM NEW."dataset_admission_id"
    OR content->'datasetAdmissionArtifact'->>'artifactId' IS DISTINCT FROM NEW."dataset_admission_artifact_id"
    OR (content->>'datasetAdmissionGateLedgerRevision')::INTEGER IS DISTINCT FROM NEW."dataset_admission_gate_ledger_revision"
    OR (content->>'registeredAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."registered_at"
  THEN
    RAISE EXCEPTION 'Governed valuation component-run columns disagree with manifest JSON';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_governed_valuation_component_run_validate_insert"
BEFORE INSERT ON "outcome_governed_valuation_component_run"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_governed_valuation_component_run_insert"();

CREATE OR REPLACE FUNCTION "reject_outcome_governed_valuation_component_run_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Governed valuation component runs are append-only';
END $$;

CREATE TRIGGER "outcome_governed_valuation_component_run_append_only"
BEFORE UPDATE OR DELETE ON "outcome_governed_valuation_component_run"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_governed_valuation_component_run_mutation"();

CREATE INDEX "outcome_governed_valuation_component_run_role_idx"
  ON "outcome_governed_valuation_component_run"("role", "registered_at", "run_id");
CREATE INDEX "outcome_governed_valuation_component_run_ancestry_idx"
  ON "outcome_governed_valuation_component_run"("dataset_id", "dataset_admission_id", "protocol_id");
