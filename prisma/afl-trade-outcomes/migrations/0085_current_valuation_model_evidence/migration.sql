CREATE TABLE "outcome_current_valuation_model_evidence_operation" (
  "operation_id" TEXT PRIMARY KEY,
  "scope_key" TEXT NOT NULL,
  "factual_operation_id" TEXT NOT NULL,
  "factual_candidate_id" TEXT NOT NULL,
  "factual_revision" INTEGER NOT NULL CHECK ("factual_revision">0),
  "expected_model_revision" INTEGER NOT NULL CHECK ("expected_model_revision">=0),
  "result_state" TEXT NOT NULL CHECK ("result_state" IN ('qualified','qualification_failed')),
  "result_json" JSONB NOT NULL,
  "captured_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3) NOT NULL CHECK ("completed_at">="captured_at"),
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "outcome_current_model_evidence_factual_operation_fkey"
    FOREIGN KEY ("factual_operation_id")
    REFERENCES "outcome_current_valuation_factual_refresh_operation"("operation_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_current_model_evidence_factual_candidate_fkey"
    FOREIGN KEY ("factual_candidate_id")
    REFERENCES "outcome_private_factual_candidate"("candidate_id")
    ON DELETE RESTRICT
);

CREATE INDEX "outcome_current_model_evidence_scope_idx"
  ON "outcome_current_valuation_model_evidence_operation"("scope_key","completed_at");

CREATE FUNCTION "validate_outcome_current_valuation_model_evidence_operation"()
RETURNS TRIGGER AS $$
DECLARE content JSONB:=NEW."result_json";
BEGIN
  IF content->>'operationId' IS DISTINCT FROM NEW."operation_id"
     OR content->>'scopeKey' IS DISTINCT FROM NEW."scope_key"
     OR content->>'factualOperationId' IS DISTINCT FROM NEW."factual_operation_id"
     OR content->'privateFactualAuthority'->>'candidateId' IS DISTINCT FROM NEW."factual_candidate_id"
     OR (content->'privateFactualAuthority'->>'revision')::INTEGER IS DISTINCT FROM NEW."factual_revision"
     OR (content->>'expectedModelRevision')::INTEGER IS DISTINCT FROM NEW."expected_model_revision"
     OR content->>'state' IS DISTINCT FROM NEW."result_state"
     OR (content->>'capturedAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."captured_at"
     OR (content->>'completedAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."completed_at"
     OR content->>'schemaVersion' IS DISTINCT FROM 'afl-current-valuation-model-evidence-result/v1'
     OR content->>'executionLocation' IS DISTINCT FROM 'local'
     OR content->>'visibility' IS DISTINCT FROM 'private'
     OR content->>'environment' IS DISTINCT FROM 'non_production'
     OR content->'publicationEligible' IS DISTINCT FROM 'false'::JSONB
     OR content->'publicationProhibited' IS DISTINCT FROM 'true'::JSONB
     OR (NEW."result_state"='qualified' AND
         (content->>'modelRevision')::INTEGER<>NEW."expected_model_revision"+1)
     OR (NEW."result_state"='qualification_failed' AND
         (content->>'modelRevision')::INTEGER<>NEW."expected_model_revision")
  THEN
    RAISE EXCEPTION 'Current valuation model evidence operation is invalid or misbound';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_current_valuation_model_evidence_operation_validate"
BEFORE INSERT ON "outcome_current_valuation_model_evidence_operation"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_current_valuation_model_evidence_operation"();

REVOKE ALL ON TABLE "outcome_current_valuation_model_evidence_operation" FROM PUBLIC;
GRANT SELECT,INSERT ON TABLE "outcome_current_valuation_model_evidence_operation"
  TO "afl_trade_private_evaluation_coordinator";
