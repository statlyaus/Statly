-- Automated model-pair qualification is non-production model-validity authority only. Legacy
-- review-pending execution records retain their original schema and meaning.

CREATE OR REPLACE FUNCTION "validate_outcome_governed_valuation_component_run_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  content JSONB := NEW."manifest_json"->'content';
  pending_state_valid BOOLEAN;
BEGIN
  pending_state_valid :=
    (content->>'schemaVersion'='governed-valuation-component-run/v1'
      AND content->>'approvalState'='gate_3_review_required'
      AND NOT content ? 'qualificationState')
    OR
    (content->>'schemaVersion'='governed-valuation-component-run/v2'
      AND content->>'qualificationState'='automated_qualification_pending'
      AND NOT content ? 'approvalState');
  IF NEW."manifest_json"->>'runId' IS DISTINCT FROM NEW."run_id"
    OR NOT pending_state_valid
    OR content->>'environment' IS DISTINCT FROM 'non_production'
    OR content->>'role' IS DISTINCT FROM NEW."role"
    OR content->>'publicationEligible' IS DISTINCT FROM 'false'
    OR content->'nativeExecution'->>'kind' IS DISTINCT FROM NEW."native_execution_kind"
    OR content->'nativeExecution'->>'executionId' IS DISTINCT FROM NEW."native_execution_id"
    OR content->'nativeExecution'->'artifact'->>'artifactId'
      IS DISTINCT FROM NEW."native_execution_artifact_id"
    OR content->>'protocolId' IS DISTINCT FROM NEW."protocol_id"
    OR content->'protocolArtifact'->>'artifactId' IS DISTINCT FROM NEW."protocol_artifact_id"
    OR content->>'datasetId' IS DISTINCT FROM NEW."dataset_id"
    OR content->'datasetArtifact'->>'artifactId' IS DISTINCT FROM NEW."dataset_artifact_id"
    OR content->>'datasetAdmissionId' IS DISTINCT FROM NEW."dataset_admission_id"
    OR content->'datasetAdmissionArtifact'->>'artifactId'
      IS DISTINCT FROM NEW."dataset_admission_artifact_id"
    OR (content->>'datasetAdmissionGateLedgerRevision')::INTEGER
      IS DISTINCT FROM NEW."dataset_admission_gate_ledger_revision"
    OR (content->>'registeredAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."registered_at"
  THEN
    RAISE EXCEPTION 'Governed valuation component-run columns disagree with manifest JSON';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION "validate_outcome_governed_pick_pav_model_execution_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  content JSONB := NEW."execution_json"->'content';
  observation_row RECORD;
  dataset_row RECORD;
  admission_row RECORD;
  protocol_row RECORD;
  pending_state_valid BOOLEAN;
BEGIN
  SELECT * INTO observation_row FROM "outcome_pick_pav_observation_set"
   WHERE "observation_set_id"=NEW."observation_set_id" FOR SHARE;
  SELECT * INTO dataset_row FROM "outcome_valuation_dataset_candidate"
   WHERE "dataset_id"=NEW."dataset_id" FOR SHARE;
  SELECT * INTO admission_row FROM "outcome_valuation_dataset_admission"
   WHERE "admission_id"=NEW."dataset_admission_id" FOR SHARE;
  SELECT * INTO protocol_row FROM "outcome_valuation_model_protocol"
   WHERE "protocol_id"=NEW."protocol_id" FOR SHARE;
  pending_state_valid :=
    (content->>'schemaVersion'='afl-trade-pick-pav-model-execution/v2'
      AND content->>'approvalStatus'='gate_3_review_required'
      AND NOT content ? 'qualificationStatus')
    OR
    (content->>'schemaVersion'='afl-trade-pick-pav-model-execution/v3'
      AND content->>'qualificationStatus'='automated_qualification_pending'
      AND NOT content ? 'approvalStatus');

  IF NEW."execution_json"->>'executionId' IS DISTINCT FROM NEW."execution_id"
    OR NEW."content_sha256" IS DISTINCT FROM
      substring(NEW."execution_id" FROM length('pick-pav-model-execution:') + 1)
    OR NEW."content_canonical_json" IS DISTINCT FROM outcome_afl_trade_canonical_json(content)
    OR NEW."execution_id" IS DISTINCT FROM 'pick-pav-model-execution:' ||
      encode(sha256(convert_to(NEW."content_canonical_json",'UTF8')),'hex')
    OR NOT pending_state_valid
    OR content->>'environment' IS DISTINCT FROM 'non_production'
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

ALTER TABLE "outcome_gate_decision"
  DROP CONSTRAINT "outcome_gate_decision_approval_expiry_check";
ALTER TABLE "outcome_gate_decision"
  ADD CONSTRAINT "outcome_gate_decision_approval_expiry_check" CHECK (
    "state" <> 'approved'
    OR (
      "decision_json"->'content'->>'authorityKind'='automated_validation_record'
      AND "gate"='gate_3_model_validity'
      AND "environment"='non_production'::"OutcomeEnvironment"
      AND "revalidate_at" IS NULL
    )
    OR (
      "decision_json"->'content'->>'authorityKind'<>'automated_validation_record'
      AND "revalidate_at" IS NOT NULL
      AND "revalidate_at">"effective_at"
    )
  );

CREATE OR REPLACE FUNCTION "validate_outcome_gate_decision_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    proposal_row "outcome_gate_proposal"%ROWTYPE;
    predecessor "outcome_gate_decision"%ROWTYPE;
    content JSONB := NEW."decision_json"->'content';
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(
        'afl-trade-gate:' || NEW."gate" || ':' || NEW."environment"::TEXT || ':' || NEW."decision_key",
        0
    ));
    SELECT * INTO STRICT proposal_row FROM "outcome_gate_proposal"
     WHERE "proposal_id"=NEW."proposal_id";
    IF proposal_row."gate"<>NEW."gate" OR proposal_row."decision_key"<>NEW."decision_key"
       OR proposal_row."version"<>NEW."version" OR proposal_row."environment"<>NEW."environment"
    THEN RAISE EXCEPTION 'Gate decision identity does not match its proposal'; END IF;
    IF NEW."version"=1 THEN
      IF NEW."supersedes_decision_id" IS NOT NULL
      THEN RAISE EXCEPTION 'The first Gate decision cannot supersede another decision'; END IF;
    ELSE
      IF NEW."supersedes_decision_id" IS NULL
      THEN RAISE EXCEPTION 'A later Gate decision must supersede the current decision'; END IF;
      SELECT * INTO STRICT predecessor FROM "outcome_gate_decision"
       WHERE "decision_id"=NEW."supersedes_decision_id";
      IF predecessor."gate"<>NEW."gate" OR predecessor."environment"<>NEW."environment"
         OR predecessor."decision_key"<>NEW."decision_key" OR predecessor."version"<>NEW."version"-1
         OR predecessor."effective_at">NEW."effective_at"
         OR EXISTS (SELECT 1 FROM "outcome_gate_decision"
                     WHERE "supersedes_decision_id"=predecessor."decision_id")
      THEN RAISE EXCEPTION 'Gate decisions must form one chronological linear chain'; END IF;
    END IF;
    IF content->>'authorityKind'='automated_validation_record' AND (
      NEW."gate"<>'gate_3_model_validity'
      OR NEW."environment"<>'non_production'::"OutcomeEnvironment"
      OR content->>'state'<>'approved'
      OR jsonb_array_length(content->'reviewers')<>0
      OR (SELECT count(*) FROM jsonb_array_elements(content->'affectedArtifacts') artifact
           WHERE artifact->>'kind'='model_run')<>1
      OR (SELECT count(*) FROM jsonb_array_elements(content->'affectedArtifacts') artifact
           WHERE artifact->>'kind'='model_qualification')<>1
    ) THEN
      RAISE EXCEPTION 'Automated validation authority is limited to non-production Gate 3';
    END IF;
    IF NEW."state"='approved' AND NEW."environment"='production'::"OutcomeEnvironment"
       AND content->>'authorityKind'<>'external_human_record'
    THEN RAISE EXCEPTION 'Production Gate approval requires external human authority'; END IF;
    RETURN NEW;
END $$;

CREATE TABLE "outcome_governed_valuation_model_qualification" (
  "qualification_id" TEXT NOT NULL PRIMARY KEY,
  "scope_key" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "artifact_id" TEXT NOT NULL UNIQUE,
  "player_run_id" TEXT NOT NULL,
  "pick_run_id" TEXT NOT NULL,
  "policy_artifact_id" TEXT NOT NULL,
  "player_criteria_artifact_id" TEXT NOT NULL,
  "pick_criteria_artifact_id" TEXT NOT NULL,
  "player_evidence_artifact_id" TEXT NOT NULL,
  "pick_evidence_artifact_id" TEXT NOT NULL,
  "evaluated_at" TIMESTAMPTZ(3) NOT NULL,
  "content_sha256" CHAR(64) NOT NULL,
  "content_canonical_json" TEXT NOT NULL,
  "qualification_json" JSONB NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "outcome_governed_model_qualification_id_check"
    CHECK ("qualification_id" ~ '^model-qualification:[a-f0-9]{64}$'),
  CONSTRAINT "outcome_governed_model_qualification_outcome_check"
    CHECK ("outcome" IN ('qualified','failed')),
  CONSTRAINT "outcome_governed_model_qualification_artifact_fkey"
    FOREIGN KEY ("artifact_id") REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_governed_model_qualification_player_run_fkey"
    FOREIGN KEY ("player_run_id") REFERENCES "outcome_governed_valuation_component_run"("run_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_governed_model_qualification_pick_run_fkey"
    FOREIGN KEY ("pick_run_id") REFERENCES "outcome_governed_valuation_component_run"("run_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_governed_model_qualification_policy_artifact_fkey"
    FOREIGN KEY ("policy_artifact_id") REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_governed_model_qualification_player_criteria_fkey"
    FOREIGN KEY ("player_criteria_artifact_id") REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_governed_model_qualification_pick_criteria_fkey"
    FOREIGN KEY ("pick_criteria_artifact_id") REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_governed_model_qualification_player_evidence_fkey"
    FOREIGN KEY ("player_evidence_artifact_id") REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_governed_model_qualification_pick_evidence_fkey"
    FOREIGN KEY ("pick_evidence_artifact_id") REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION "validate_outcome_governed_model_qualification_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  content JSONB := NEW."qualification_json"->'content';
  player_run RECORD;
  pick_run RECORD;
BEGIN
  SELECT * INTO STRICT player_run FROM "outcome_governed_valuation_component_run"
   WHERE "run_id"=NEW."player_run_id" FOR KEY SHARE;
  SELECT * INTO STRICT pick_run FROM "outcome_governed_valuation_component_run"
   WHERE "run_id"=NEW."pick_run_id" FOR KEY SHARE;
  IF NEW."qualification_json"->>'qualificationId' IS DISTINCT FROM NEW."qualification_id"
    OR content->>'schemaVersion' IS DISTINCT FROM 'governed-valuation-model-qualification/v1'
    OR content->>'environment' IS DISTINCT FROM 'non_production'
    OR content->>'scopeKey' IS DISTINCT FROM NEW."scope_key"
    OR content->>'outcome' IS DISTINCT FROM NEW."outcome"
    OR content->>'publicationEligible' IS DISTINCT FROM 'false'
    OR content->'player'->>'runId' IS DISTINCT FROM NEW."player_run_id"
    OR content->'pick'->>'runId' IS DISTINCT FROM NEW."pick_run_id"
    OR content->'policyArtifact'->>'artifactId' IS DISTINCT FROM NEW."policy_artifact_id"
    OR content->'player'->'criteriaArtifact'->>'artifactId'
      IS DISTINCT FROM NEW."player_criteria_artifact_id"
    OR content->'pick'->'criteriaArtifact'->>'artifactId'
      IS DISTINCT FROM NEW."pick_criteria_artifact_id"
    OR content->'player'->'validationEvidenceArtifact'->>'artifactId'
      IS DISTINCT FROM NEW."player_evidence_artifact_id"
    OR content->'pick'->'validationEvidenceArtifact'->>'artifactId'
      IS DISTINCT FROM NEW."pick_evidence_artifact_id"
    OR (content->>'evaluatedAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."evaluated_at"
    OR NEW."content_sha256" IS DISTINCT FROM substring(NEW."qualification_id" FROM 21)
    OR NEW."content_canonical_json" IS DISTINCT FROM outcome_afl_trade_canonical_json(content)
    OR NEW."qualification_id" IS DISTINCT FROM 'model-qualification:' ||
      encode(sha256(convert_to(NEW."content_canonical_json",'UTF8')),'hex')
    OR NEW."artifact_id" IS DISTINCT FROM 'artifact:' || encode(sha256(convert_to(
      outcome_afl_trade_canonical_json(NEW."qualification_json"),'UTF8')),'hex')
    OR player_run."role"<>'player_contribution_and_availability'
    OR pick_run."role"<>'draft_pick_and_future_pick_distribution'
    OR player_run."artifact_id" IS DISTINCT FROM content->'player'->'runArtifact'->>'artifactId'
    OR pick_run."artifact_id" IS DISTINCT FROM content->'pick'->'runArtifact'->>'artifactId'
    OR player_run."protocol_id" IS DISTINCT FROM content->'player'->>'protocolId'
    OR pick_run."protocol_id" IS DISTINCT FROM content->'pick'->>'protocolId'
    OR player_run."protocol_artifact_id"
      IS DISTINCT FROM content->'player'->'protocolArtifact'->>'artifactId'
    OR pick_run."protocol_artifact_id"
      IS DISTINCT FROM content->'pick'->'protocolArtifact'->>'artifactId'
  THEN RAISE EXCEPTION 'Governed model qualification ancestry or retained JSON mismatch'; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_governed_model_qualification_validate_insert"
BEFORE INSERT ON "outcome_governed_valuation_model_qualification"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_governed_model_qualification_insert"();

CREATE OR REPLACE FUNCTION "reject_outcome_governed_model_qualification_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Governed valuation model qualifications are append-only'; END $$;
CREATE TRIGGER "outcome_governed_model_qualification_append_only"
BEFORE UPDATE OR DELETE ON "outcome_governed_valuation_model_qualification"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_governed_model_qualification_mutation"();

CREATE TABLE "outcome_governed_model_qualification_work" (
  "work_id" TEXT NOT NULL PRIMARY KEY,
  "scope_key" TEXT NOT NULL,
  "qualification_id" TEXT NOT NULL UNIQUE,
  "player_gate3_decision_id" TEXT NOT NULL,
  "pick_gate3_decision_id" TEXT NOT NULL,
  "available_at" TIMESTAMPTZ(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "work_json" JSONB NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "outcome_governed_model_qualification_work_id_check"
    CHECK ("work_id" ~ '^model-qualification-work:[a-f0-9]{64}$'),
  CONSTRAINT "outcome_governed_model_qualification_work_status_check"
    CHECK ("status" IN ('pending','claimed','completed','superseded')),
  FOREIGN KEY ("qualification_id") REFERENCES "outcome_governed_valuation_model_qualification"("qualification_id") ON DELETE RESTRICT,
  FOREIGN KEY ("player_gate3_decision_id") REFERENCES "outcome_gate_decision"("decision_id") ON DELETE RESTRICT,
  FOREIGN KEY ("pick_gate3_decision_id") REFERENCES "outcome_gate_decision"("decision_id") ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION "reject_outcome_governed_model_qualification_work_delete"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Governed model qualification work is durable'; END $$;
CREATE TRIGGER "outcome_governed_model_qualification_work_no_delete"
BEFORE DELETE ON "outcome_governed_model_qualification_work"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_governed_model_qualification_work_delete"();

CREATE TABLE "outcome_current_governed_valuation_model_pair" (
  "scope_key" TEXT NOT NULL PRIMARY KEY,
  "revision" INTEGER NOT NULL,
  "qualification_id" TEXT NOT NULL UNIQUE,
  "player_run_id" TEXT NOT NULL,
  "pick_run_id" TEXT NOT NULL,
  "player_gate3_decision_id" TEXT NOT NULL UNIQUE,
  "pick_gate3_decision_id" TEXT NOT NULL UNIQUE,
  "work_id" TEXT NOT NULL UNIQUE,
  "advanced_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "outcome_current_governed_model_pair_revision_check" CHECK ("revision">0),
  FOREIGN KEY ("qualification_id") REFERENCES "outcome_governed_valuation_model_qualification"("qualification_id") ON DELETE RESTRICT,
  FOREIGN KEY ("player_run_id") REFERENCES "outcome_governed_valuation_component_run"("run_id") ON DELETE RESTRICT,
  FOREIGN KEY ("pick_run_id") REFERENCES "outcome_governed_valuation_component_run"("run_id") ON DELETE RESTRICT,
  FOREIGN KEY ("player_gate3_decision_id") REFERENCES "outcome_gate_decision"("decision_id") ON DELETE RESTRICT,
  FOREIGN KEY ("pick_gate3_decision_id") REFERENCES "outcome_gate_decision"("decision_id") ON DELETE RESTRICT,
  FOREIGN KEY ("work_id") REFERENCES "outcome_governed_model_qualification_work"("work_id") ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION "advance_outcome_current_governed_valuation_model_pair"(
  target_scope_key TEXT,
  target_qualification_id TEXT,
  target_player_gate3_decision_id TEXT,
  target_pick_gate3_decision_id TEXT,
  target_work_id TEXT,
  expected_revision INTEGER,
  target_advanced_at TIMESTAMPTZ
) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  current_revision INTEGER;
  qualification RECORD;
  work RECORD;
  player_decision RECORD;
  pick_decision RECORD;
  next_revision INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('governed-model-pair:' || target_scope_key,0));
  SELECT revision INTO current_revision FROM "outcome_current_governed_valuation_model_pair"
   WHERE "scope_key"=target_scope_key FOR UPDATE;
  current_revision:=COALESCE(current_revision,0);
  IF current_revision<>expected_revision THEN RAISE EXCEPTION 'Stale current model-pair revision'; END IF;
  SELECT * INTO STRICT qualification FROM "outcome_governed_valuation_model_qualification"
   WHERE "qualification_id"=target_qualification_id FOR KEY SHARE;
  SELECT * INTO STRICT work FROM "outcome_governed_model_qualification_work"
   WHERE "work_id"=target_work_id FOR KEY SHARE;
  SELECT * INTO STRICT player_decision FROM "outcome_gate_decision"
   WHERE "decision_id"=target_player_gate3_decision_id FOR KEY SHARE;
  SELECT * INTO STRICT pick_decision FROM "outcome_gate_decision"
   WHERE "decision_id"=target_pick_gate3_decision_id FOR KEY SHARE;
  IF qualification."outcome"<>'qualified' OR qualification."scope_key"<>target_scope_key
    OR work."qualification_id"<>qualification."qualification_id"
    OR work."scope_key"<>target_scope_key OR work."status"<>'pending'
    OR work."player_gate3_decision_id"<>player_decision."decision_id"
    OR work."pick_gate3_decision_id"<>pick_decision."decision_id"
    OR player_decision."state"<>'approved' OR pick_decision."state"<>'approved'
    OR player_decision."gate"<>'gate_3_model_validity'
    OR pick_decision."gate"<>'gate_3_model_validity'
    OR player_decision."environment"<>'non_production'::"OutcomeEnvironment"
    OR pick_decision."environment"<>'non_production'::"OutcomeEnvironment"
    OR player_decision."decision_json"->'content'->>'authorityKind'<>'automated_validation_record'
    OR pick_decision."decision_json"->'content'->>'authorityKind'<>'automated_validation_record'
    OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(
        player_decision."decision_json"->'content'->'affectedArtifacts'
      ) artifact
      WHERE artifact->>'kind'='model_run'
        AND artifact->>'artifactId'=qualification."player_run_id"
    )
    OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(
        player_decision."decision_json"->'content'->'affectedArtifacts'
      ) artifact
      WHERE artifact->>'kind'='model_qualification'
        AND artifact->>'artifactId'=qualification."qualification_id"
    )
    OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(
        pick_decision."decision_json"->'content'->'affectedArtifacts'
      ) artifact
      WHERE artifact->>'kind'='model_run'
        AND artifact->>'artifactId'=qualification."pick_run_id"
    )
    OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(
        pick_decision."decision_json"->'content'->'affectedArtifacts'
      ) artifact
      WHERE artifact->>'kind'='model_qualification'
        AND artifact->>'artifactId'=qualification."qualification_id"
    )
    OR EXISTS (SELECT 1 FROM "outcome_gate_decision" successor
                WHERE successor."supersedes_decision_id" IN
                  (player_decision."decision_id",pick_decision."decision_id"))
  THEN RAISE EXCEPTION 'Current governed valuation model pairs require a passing qualification'; END IF;
  next_revision:=current_revision+1;
  INSERT INTO "outcome_current_governed_valuation_model_pair"
    ("scope_key","revision","qualification_id","player_run_id","pick_run_id",
     "player_gate3_decision_id","pick_gate3_decision_id","work_id","advanced_at")
  VALUES (target_scope_key,next_revision,qualification."qualification_id",
          qualification."player_run_id",qualification."pick_run_id",
          player_decision."decision_id",pick_decision."decision_id",work."work_id",target_advanced_at)
  ON CONFLICT ("scope_key") DO UPDATE SET
    "revision"=EXCLUDED."revision","qualification_id"=EXCLUDED."qualification_id",
    "player_run_id"=EXCLUDED."player_run_id","pick_run_id"=EXCLUDED."pick_run_id",
    "player_gate3_decision_id"=EXCLUDED."player_gate3_decision_id",
    "pick_gate3_decision_id"=EXCLUDED."pick_gate3_decision_id",
    "work_id"=EXCLUDED."work_id","advanced_at"=EXCLUDED."advanced_at";
  RETURN next_revision;
END $$;

CREATE INDEX "outcome_governed_model_qualification_scope_idx"
  ON "outcome_governed_valuation_model_qualification"("scope_key","evaluated_at","qualification_id");
CREATE INDEX "outcome_governed_model_qualification_work_pending_idx"
  ON "outcome_governed_model_qualification_work"("status","available_at","scope_key");
