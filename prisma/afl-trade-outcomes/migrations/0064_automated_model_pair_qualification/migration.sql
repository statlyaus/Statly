-- Automated model-pair qualification is non-production model-validity authority only. Legacy
-- review-pending execution records retain their original schema and meaning.

CREATE OR REPLACE FUNCTION "validate_outcome_governed_valuation_component_run_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  content JSONB := NEW."manifest_json"->'content';
  pending_state_valid BOOLEAN;
  component_artifact RECORD;
BEGIN
  SELECT * INTO component_artifact FROM "outcome_artifact_custody"
   WHERE "artifact_id"=NEW."artifact_id" FOR KEY SHARE;
  pending_state_valid :=
    (content->>'schemaVersion'='governed-valuation-component-run/v1'
      AND content->>'approvalState'='gate_3_review_required'
      AND NOT content ? 'qualificationState')
    OR
    (content->>'schemaVersion'='governed-valuation-component-run/v2'
      AND content->>'qualificationState'='automated_qualification_pending'
      AND NOT content ? 'approvalState');
  IF NEW."manifest_json"->>'runId' IS DISTINCT FROM NEW."run_id"
    OR NEW."content_sha256" IS DISTINCT FROM
       substring(NEW."run_id" FROM length('model-run:') + 1)
    OR NEW."content_canonical_json" IS DISTINCT FROM outcome_afl_trade_canonical_json(content)
    OR NEW."run_id" IS DISTINCT FROM 'model-run:' || encode(sha256(convert_to(
       NEW."content_canonical_json",'UTF8')),'hex')
    OR NEW."artifact_id" IS DISTINCT FROM 'artifact:' || encode(sha256(convert_to(
       outcome_afl_trade_canonical_json(NEW."manifest_json"),'UTF8')),'hex')
    OR component_artifact."content_sha256" IS DISTINCT FROM
       substring(NEW."artifact_id" FROM length('artifact:') + 1)
    OR component_artifact."storage_uri" IS DISTINCT FROM 'artifact://sha256/' ||
       component_artifact."content_sha256"
    OR component_artifact."media_type" IS DISTINCT FROM 'application/json'
    OR component_artifact."byte_length" IS DISTINCT FROM octet_length(convert_to(
       outcome_afl_trade_canonical_json(NEW."manifest_json"),'UTF8'))
    OR component_artifact."environment" IS DISTINCT FROM
       'non_production'::"OutcomeEnvironment"
    OR component_artifact."created_at" IS DISTINCT FROM NEW."registered_at"
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
    OR validate_outcome_prepared_valuation_input_v2_artifact(
         content->'nativeExecution'->'artifact','non_production'::"OutcomeEnvironment"
       ) IS DISTINCT FROM TRUE
    OR validate_outcome_prepared_valuation_input_v2_artifact(
         content->'protocolArtifact','non_production'::"OutcomeEnvironment"
       ) IS DISTINCT FROM TRUE
    OR validate_outcome_prepared_valuation_input_v2_artifact(
         content->'datasetArtifact','non_production'::"OutcomeEnvironment"
       ) IS DISTINCT FROM TRUE
    OR validate_outcome_prepared_valuation_input_v2_artifact(
         content->'datasetAdmissionArtifact','non_production'::"OutcomeEnvironment"
       ) IS DISTINCT FROM TRUE
    OR (content->'nativeExecution'->'artifact'->>'createdAt')::TIMESTAMPTZ>
       NEW."registered_at"
    OR (content->'protocolArtifact'->>'createdAt')::TIMESTAMPTZ>NEW."registered_at"
    OR (content->'datasetArtifact'->>'createdAt')::TIMESTAMPTZ>NEW."registered_at"
    OR (content->'datasetAdmissionArtifact'->>'createdAt')::TIMESTAMPTZ>
       NEW."registered_at"
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
    qualification_row RECORD;
    automated_qualification_id TEXT;
    automated_model_run_id TEXT;
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
    IF content->>'authorityKind'='automated_validation_record' THEN
      IF NEW."gate"<>'gate_3_model_validity'
        OR NEW."environment"<>'non_production'::"OutcomeEnvironment"
        OR content->>'state'<>'approved'
        OR content->'revalidateAt'<>'null'::JSONB
        OR jsonb_array_length(content->'reviewers')<>0
        OR (SELECT count(*) FROM jsonb_array_elements(content->'affectedArtifacts') artifact
             WHERE artifact->>'kind'='model_run')<>1
        OR (SELECT count(*) FROM jsonb_array_elements(content->'affectedArtifacts') artifact
             WHERE artifact->>'kind'='model_qualification')<>1
      THEN RAISE EXCEPTION 'Automated validation authority is limited to non-production Gate 3';
      END IF;
      SELECT artifact->>'artifactId' INTO STRICT automated_qualification_id
        FROM jsonb_array_elements(content->'affectedArtifacts') artifact
        WHERE artifact->>'kind'='model_qualification';
      SELECT artifact->>'artifactId' INTO STRICT automated_model_run_id
        FROM jsonb_array_elements(content->'affectedArtifacts') artifact
        WHERE artifact->>'kind'='model_run';
      SELECT * INTO STRICT qualification_row
        FROM "outcome_governed_valuation_model_qualification"
        WHERE "qualification_id"=automated_qualification_id FOR KEY SHARE;
      IF qualification_row."outcome"<>'qualified'
        OR qualification_row."scope_key" IS DISTINCT FROM content->'scope'->>'scopeKey'
        OR proposal_row."proposed_at"<qualification_row."evaluated_at"
        OR NEW."decided_at" IS NULL
        OR NEW."decided_at"<qualification_row."evaluated_at"
        OR NEW."effective_at" IS NULL
        OR NEW."effective_at"<qualification_row."evaluated_at"
        OR content->'scope' IS DISTINCT FROM proposal_row."proposal_json"->'content'->'scope'
        OR automated_model_run_id NOT IN (
          qualification_row."player_run_id", qualification_row."pick_run_id"
        )
        OR NEW."decision_key" IS DISTINCT FROM content->'scope'->>'scopeKey' || ':' ||
          (CASE WHEN automated_model_run_id=qualification_row."player_run_id"
             THEN 'player-model-validity' ELSE 'pick-model-validity' END)
        OR NOT (content->'authorityEvidenceIds' ? qualification_row."artifact_id")
        OR NOT (
          proposal_row."proposal_json"->'content'->'evidenceIds' ? qualification_row."artifact_id"
        )
      THEN RAISE EXCEPTION 'Automated Gate 3 requires its exact retained passing qualification';
      END IF;
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

CREATE OR REPLACE FUNCTION "outcome_afl_trade_jsonb_has_exact_keys"(
  document JSONB,
  expected_keys TEXT[]
) RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_typeof(document)='object'
    AND ARRAY(SELECT key FROM jsonb_object_keys(document) key ORDER BY key)
      = ARRAY(SELECT key FROM unnest(expected_keys) key ORDER BY key)
$$;

CREATE OR REPLACE FUNCTION "outcome_afl_trade_jsonb_is_artifact_ref"(document JSONB)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE AS $$
  SELECT outcome_afl_trade_jsonb_has_exact_keys(
      document,
      ARRAY['artifactId','byteLength','contentSha256','createdAt','mediaType','storageUri']
    )
    AND document->>'artifactId' ~ '^artifact:[a-f0-9]{64}$'
    AND document->>'contentSha256' ~ '^[a-f0-9]{64}$'
    AND document->>'artifactId' = ('artifact:' || (document->>'contentSha256'))
    AND document->>'storageUri' = ('artifact://sha256/' || (document->>'contentSha256'))
    AND length(document->>'mediaType') BETWEEN 1 AND 160
    AND jsonb_typeof(document->'byteLength')='number'
    AND (document->>'byteLength')::NUMERIC >= 0
    AND (document->>'byteLength')::NUMERIC = trunc((document->>'byteLength')::NUMERIC)
    AND document->>'createdAt' IS NOT NULL
$$;

CREATE TABLE "outcome_governed_component_validation_evidence" (
  "run_id" TEXT NOT NULL PRIMARY KEY,
  "role" TEXT NOT NULL,
  "native_execution_artifact_id" TEXT NOT NULL,
  "validation_report_id" TEXT NOT NULL,
  "validation_report_artifact_id" TEXT,
  "native_execution_json" JSONB NOT NULL,
  "validation_report_json" JSONB NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL,
  FOREIGN KEY ("run_id") REFERENCES "outcome_governed_valuation_component_run"("run_id") ON DELETE RESTRICT,
  FOREIGN KEY ("native_execution_artifact_id") REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT,
  FOREIGN KEY ("validation_report_artifact_id") REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_governed_component_validation_evidence_role_check" CHECK (
    "role" IN ('player_contribution_and_availability','draft_pick_and_future_pick_distribution')
  )
);

CREATE OR REPLACE FUNCTION "validate_outcome_governed_player_validation_metrics"(report JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  content JSONB := report->'content';
  metrics JSONB := report->'content'->'metrics';
  candidate_mae DOUBLE PRECISION;
  candidate_rmse DOUBLE PRECISION;
  games_mae DOUBLE PRECISION;
  games_rmse DOUBLE PRECISION;
  relative_mae DOUBLE PRECISION;
  relative_rmse DOUBLE PRECISION;
  expected_outcome TEXT;
BEGIN
  candidate_mae := (metrics->'candidate'->>'meanAbsoluteError')::DOUBLE PRECISION;
  candidate_rmse := (metrics->'candidate'->>'rootMeanSquaredError')::DOUBLE PRECISION;
  games_mae := (metrics->'gamesOnly'->>'meanAbsoluteError')::DOUBLE PRECISION;
  games_rmse := (metrics->'gamesOnly'->>'rootMeanSquaredError')::DOUBLE PRECISION;
  IF candidate_mae<0 OR candidate_rmse<0 OR games_mae<0 OR games_rmse<0
    OR jsonb_array_length(content->'comparableObservationIds')<
       (content->'config'->>'minimumComparableObservations')::INTEGER
    OR abs((metrics->'candidateMinusGamesOnly'->>'meanAbsoluteError')::DOUBLE PRECISION-
       (candidate_mae-games_mae))>1e-10
    OR abs((metrics->'candidateMinusGamesOnly'->>'rootMeanSquaredError')::DOUBLE PRECISION-
       (candidate_rmse-games_rmse))>1e-10
  THEN RETURN FALSE;
  END IF;
  IF games_mae=0 THEN
    IF candidate_mae=0 THEN relative_mae := 0;
    ELSIF metrics->'relativeImprovement'->'meanAbsoluteError' IS DISTINCT FROM 'null'::JSONB
      THEN RETURN FALSE;
    END IF;
  ELSE relative_mae := (games_mae-candidate_mae)/games_mae;
  END IF;
  IF games_rmse=0 THEN
    IF candidate_rmse=0 THEN relative_rmse := 0;
    ELSIF metrics->'relativeImprovement'->'rootMeanSquaredError' IS DISTINCT FROM 'null'::JSONB
      THEN RETURN FALSE;
    END IF;
  ELSE relative_rmse := (games_rmse-candidate_rmse)/games_rmse;
  END IF;
  IF (relative_mae IS NOT NULL AND (
       jsonb_typeof(metrics->'relativeImprovement'->'meanAbsoluteError') IS DISTINCT FROM 'number'
       OR abs((metrics->'relativeImprovement'->>'meanAbsoluteError')::DOUBLE PRECISION-
         relative_mae)>1e-10))
    OR (relative_rmse IS NOT NULL AND (
       jsonb_typeof(metrics->'relativeImprovement'->'rootMeanSquaredError') IS DISTINCT FROM 'number'
       OR abs((metrics->'relativeImprovement'->>'rootMeanSquaredError')::DOUBLE PRECISION-
         relative_rmse)>1e-10))
  THEN RETURN FALSE;
  END IF;
  expected_outcome := CASE WHEN relative_mae IS NOT NULL AND relative_rmse IS NOT NULL
      AND relative_mae>=(content->'config'->>'minimumRelativeMaeImprovement')::DOUBLE PRECISION
      AND relative_rmse>=(content->'config'->>'minimumRelativeRmseImprovement')::DOUBLE PRECISION
    THEN 'meets_declared_predictive_thresholds'
    ELSE 'does_not_meet_declared_predictive_thresholds' END;
  RETURN content->>'acceptanceOutcome' IS NOT DISTINCT FROM expected_outcome;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END $$;

CREATE OR REPLACE FUNCTION "validate_outcome_governed_pick_final_test_metrics"(report JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  content JSONB := report->'content';
  final_scope JSONB;
  prediction JSONB;
  probability JSONB;
  support_left JSONB;
  support_right JSONB;
  metrics JSONB;
  final_count INTEGER := 0;
  observed_index INTEGER;
  probability_index INTEGER;
  observed_probability DOUBLE PRECISION;
  predicted_cumulative DOUBLE PRECISION;
  support_count INTEGER;
  first_crps DOUBLE PRECISION;
  pairwise_crps DOUBLE PRECISION;
  brier DOUBLE PRECISION := 0;
  log_loss DOUBLE PRECISION := 0;
  ranked_score DOUBLE PRECISION := 0;
  contribution_crps DOUBLE PRECISION := 0;
  absolute_contribution_error DOUBLE PRECISION := 0;
  squared_contribution_error DOUBLE PRECISION := 0;
  absolute_games_error DOUBLE PRECISION := 0;
  squared_games_error DOUBLE PRECISION := 0;
  coverage DOUBLE PRECISION := 0;
  interval_width DOUBLE PRECISION := 0;
  probability_total DOUBLE PRECISION;
  zero_probability_count INTEGER := 0;
  all_zero_probability_count INTEGER;
  expected_evaluation_status TEXT;
  expected_ids JSONB;
  category_order TEXT[] := ARRAY[
    'no_afl_game','short_career','replacement_level','regular_contributor','high_quality','elite'
  ];
BEGIN
  IF jsonb_typeof(content->'predictions') IS DISTINCT FROM 'array'
    OR jsonb_typeof(content->'excludedObservations') IS DISTINCT FROM 'array'
    OR (content->>'inputObservationCount')::INTEGER IS DISTINCT FROM
       jsonb_array_length(content->'predictions') +
       jsonb_array_length(content->'excludedObservations')
    OR (SELECT count(*) FROM (
         SELECT entry->>'observationId' AS observation_id
           FROM jsonb_array_elements(content->'predictions') entry
         UNION ALL
         SELECT entry->>'observationId'
           FROM jsonb_array_elements(content->'excludedObservations') entry
       ) identifiers) IS DISTINCT FROM
       (SELECT count(DISTINCT observation_id) FROM (
         SELECT entry->>'observationId' AS observation_id
           FROM jsonb_array_elements(content->'predictions') entry
         UNION ALL
         SELECT entry->>'observationId'
           FROM jsonb_array_elements(content->'excludedObservations') entry
       ) identifiers)
  THEN RETURN FALSE;
  END IF;

  IF EXISTS (
       SELECT 1 FROM jsonb_array_elements(content->'predictions') prediction_entry
        WHERE (SELECT count(*) FROM jsonb_array_elements(
          prediction_entry->'categoryProbabilities') probability_entry
          WHERE probability_entry->>'category'=prediction_entry->>'observedCategory')<>1
     )
  THEN RETURN FALSE;
  END IF;
  SELECT count(*) INTO all_zero_probability_count
    FROM jsonb_array_elements(content->'predictions') prediction_entry
   WHERE EXISTS (
     SELECT 1 FROM jsonb_array_elements(
       prediction_entry->'categoryProbabilities') probability_entry
      WHERE probability_entry->>'category'=prediction_entry->>'observedCategory'
        AND (probability_entry->>'probability')::DOUBLE PRECISION=0
   );
  expected_evaluation_status := CASE
    WHEN jsonb_array_length(content->'predictions')<
         (content->'config'->>'minimumEligibleObservations')::INTEGER
      OR EXISTS (
        SELECT 1 FROM (VALUES ('calibration'),('validation'),('final_test')) partition(name)
         WHERE (SELECT count(*) FROM jsonb_array_elements(content->'predictions') entry
           WHERE entry->>'partition'=partition.name)<
           (content->'config'->>'minimumPartitionObservations')::INTEGER
      )
      THEN 'insufficient_eligible_observations_not_approved'
    WHEN all_zero_probability_count>0 THEN 'invalid_zero_probability_not_approved'
    ELSE 'scored_not_approved'
  END;
  IF content->>'evaluationStatus' IS DISTINCT FROM expected_evaluation_status THEN
    RETURN FALSE;
  END IF;

  SELECT scope INTO STRICT final_scope
    FROM jsonb_array_elements(content->'scoreScopes') scope
   WHERE scope->>'scope'='final_test';
  metrics := final_scope->'metrics';
  SELECT count(*),COALESCE(jsonb_agg(to_jsonb(entry->>'observationId')
      ORDER BY entry->>'observationId'),'[]'::JSONB)
    INTO final_count,expected_ids
    FROM jsonb_array_elements(content->'predictions') entry
   WHERE entry->>'partition'='final_test';
  IF (final_scope->>'observationCount')::INTEGER IS DISTINCT FROM final_count
    OR final_scope->'observationIds' IS DISTINCT FROM expected_ids
    OR (final_count=0 AND metrics IS NOT NULL)
    OR (final_count>0 AND jsonb_typeof(metrics) IS DISTINCT FROM 'object')
  THEN RETURN FALSE;
  END IF;
  IF final_count=0 THEN RETURN TRUE;
  END IF;

  FOR prediction IN
    SELECT entry FROM jsonb_array_elements(content->'predictions') entry
     WHERE entry->>'partition'='final_test'
  LOOP
    observed_index := array_position(category_order,prediction->>'observedCategory');
    IF observed_index IS NULL
      OR jsonb_array_length(prediction->'categoryProbabilities')<>array_length(category_order,1)
      OR jsonb_array_length(prediction->'empiricalSupport')=0
    THEN RETURN FALSE;
    END IF;
    observed_probability := NULL;
    predicted_cumulative := 0;
    probability_total := 0;
    FOR probability,probability_index IN
      SELECT entry,ordinality::INTEGER
        FROM jsonb_array_elements(prediction->'categoryProbabilities') WITH ORDINALITY value(entry,ordinality)
       ORDER BY ordinality
    LOOP
      IF probability->>'category' IS DISTINCT FROM category_order[probability_index]
        OR (probability->>'probability')::DOUBLE PRECISION NOT BETWEEN 0 AND 1
      THEN RETURN FALSE;
      END IF;
      brier := brier + power((probability->>'probability')::DOUBLE PRECISION -
        CASE WHEN probability_index=observed_index THEN 1 ELSE 0 END,2);
      probability_total := probability_total +
        (probability->>'probability')::DOUBLE PRECISION;
      IF probability_index=observed_index THEN
        observed_probability := (probability->>'probability')::DOUBLE PRECISION;
      END IF;
      IF probability_index<array_length(category_order,1) THEN
        predicted_cumulative := predicted_cumulative +
          (probability->>'probability')::DOUBLE PRECISION;
        ranked_score := ranked_score + power(predicted_cumulative -
          CASE WHEN observed_index<=probability_index THEN 1 ELSE 0 END,2) /
          (array_length(category_order,1)-1);
      END IF;
    END LOOP;
    IF abs(probability_total-1)>1e-10
      OR (prediction->>'supportObservationCount')::INTEGER IS DISTINCT FROM
         jsonb_array_length(prediction->'empiricalSupport')
      OR jsonb_array_length(prediction->'empiricalSupport') IS DISTINCT FROM
         (SELECT count(DISTINCT entry->>'observationId')
            FROM jsonb_array_elements(prediction->'empiricalSupport') entry)
      OR (prediction->>'p10Contribution')::DOUBLE PRECISION>
         (prediction->>'p50Contribution')::DOUBLE PRECISION
      OR (prediction->>'p50Contribution')::DOUBLE PRECISION>
         (prediction->>'p90Contribution')::DOUBLE PRECISION
      OR (prediction->>'p10Games')::DOUBLE PRECISION>
         (prediction->>'p50Games')::DOUBLE PRECISION
      OR (prediction->>'p50Games')::DOUBLE PRECISION>
         (prediction->>'p90Games')::DOUBLE PRECISION
    THEN RETURN FALSE;
    END IF;
    IF observed_probability=0 THEN zero_probability_count := zero_probability_count + 1;
    ELSE log_loss := log_loss - ln(observed_probability);
    END IF;

    support_count := jsonb_array_length(prediction->'empiricalSupport');
    first_crps := 0;
    pairwise_crps := 0;
    FOR support_left IN SELECT value FROM jsonb_array_elements(prediction->'empiricalSupport')
    LOOP
      first_crps := first_crps + abs((support_left->>'contribution')::DOUBLE PRECISION -
        (prediction->>'observedContribution')::DOUBLE PRECISION);
      FOR support_right IN SELECT value FROM jsonb_array_elements(prediction->'empiricalSupport')
      LOOP
        pairwise_crps := pairwise_crps + abs(
          (support_left->>'contribution')::DOUBLE PRECISION -
          (support_right->>'contribution')::DOUBLE PRECISION);
      END LOOP;
    END LOOP;
    contribution_crps := contribution_crps + first_crps/support_count -
      pairwise_crps/(2*power(support_count,2));
    absolute_contribution_error := absolute_contribution_error + abs(
      (prediction->>'predictedExpectedContribution')::DOUBLE PRECISION -
      (prediction->>'observedContribution')::DOUBLE PRECISION);
    squared_contribution_error := squared_contribution_error + power(
      (prediction->>'predictedExpectedContribution')::DOUBLE PRECISION -
      (prediction->>'observedContribution')::DOUBLE PRECISION,2);
    absolute_games_error := absolute_games_error + abs(
      (prediction->>'predictedExpectedGames')::DOUBLE PRECISION -
      (prediction->>'observedGames')::DOUBLE PRECISION);
    squared_games_error := squared_games_error + power(
      (prediction->>'predictedExpectedGames')::DOUBLE PRECISION -
      (prediction->>'observedGames')::DOUBLE PRECISION,2);
    IF (prediction->>'observedContribution')::DOUBLE PRECISION BETWEEN
       (prediction->>'p10Contribution')::DOUBLE PRECISION AND
       (prediction->>'p90Contribution')::DOUBLE PRECISION
    THEN coverage := coverage + 1;
    END IF;
    interval_width := interval_width +
      (prediction->>'p90Contribution')::DOUBLE PRECISION -
      (prediction->>'p10Contribution')::DOUBLE PRECISION;
  END LOOP;

  RETURN abs((metrics->>'multiclassBrierScore')::DOUBLE PRECISION-brier/final_count)<=1e-10
    AND ((zero_probability_count>0 AND metrics->'multiclassLogLoss'='null'::JSONB) OR
      (zero_probability_count=0 AND abs((metrics->>'multiclassLogLoss')::DOUBLE PRECISION-
        log_loss/final_count)<=1e-10))
    AND abs((metrics->>'rankedProbabilityScore')::DOUBLE PRECISION-
      ranked_score/final_count)<=1e-10
    AND abs((metrics->>'contributionCrps')::DOUBLE PRECISION-
      contribution_crps/final_count)<=1e-10
    AND abs((metrics->>'meanAbsoluteContributionError')::DOUBLE PRECISION-
      absolute_contribution_error/final_count)<=1e-10
    AND abs((metrics->>'rootMeanSquaredContributionError')::DOUBLE PRECISION-
      sqrt(squared_contribution_error/final_count))<=1e-10
    AND abs((metrics->>'meanAbsoluteGamesError')::DOUBLE PRECISION-
      absolute_games_error/final_count)<=1e-10
    AND abs((metrics->>'rootMeanSquaredGamesError')::DOUBLE PRECISION-
      sqrt(squared_games_error/final_count))<=1e-10
    AND abs((metrics->>'empiricalP10P90Coverage')::DOUBLE PRECISION-
      coverage/final_count)<=1e-10
    AND abs((metrics->>'meanEmpiricalIntervalWidth')::DOUBLE PRECISION-
      interval_width/final_count)<=1e-10
    AND (metrics->>'zeroProbabilityObservationCount')::INTEGER=zero_probability_count;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END $$;

CREATE OR REPLACE FUNCTION "validate_outcome_governed_component_validation_evidence"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  component RECORD;
  execution_content JSONB := NEW."native_execution_json"->'content';
  report_content JSONB := NEW."validation_report_json"->'content';
  report_artifact RECORD;
  player_execution RECORD;
  pick_execution RECORD;
BEGIN
  SELECT * INTO STRICT component
    FROM "outcome_governed_valuation_component_run"
   WHERE "run_id"=NEW."run_id" FOR KEY SHARE;
  IF component."role" IS DISTINCT FROM NEW."role"
    OR component."native_execution_artifact_id" IS DISTINCT FROM
       NEW."native_execution_artifact_id"
    OR NEW."native_execution_artifact_id" IS DISTINCT FROM 'artifact:' || encode(sha256(convert_to(
       outcome_afl_trade_canonical_json(NEW."native_execution_json"),'UTF8')),'hex')
    OR validate_outcome_prepared_valuation_input_v2_artifact(
         component."manifest_json"->'content'->'nativeExecution'->'artifact',
         'non_production'::"OutcomeEnvironment"
       ) IS DISTINCT FROM TRUE
    OR outcome_afl_trade_jsonb_has_exact_keys(
         NEW."validation_report_json",ARRAY['content','validationReportId']) IS DISTINCT FROM TRUE
    OR NEW."validation_report_json"->>'validationReportId' IS DISTINCT FROM
       NEW."validation_report_id"
    OR NEW."recorded_at"<component."registered_at"
  THEN RAISE EXCEPTION 'Governed component validation evidence ancestry mismatch';
  END IF;

  IF NEW."role"='player_contribution_and_availability' THEN
    SELECT * INTO player_execution FROM "outcome_valuation_model_run"
     WHERE "run_id"=component."native_execution_id" FOR KEY SHARE;
    SELECT * INTO STRICT report_artifact FROM "outcome_artifact_custody"
     WHERE "artifact_id"=NEW."validation_report_artifact_id" FOR KEY SHARE;
    IF player_execution."run_id" IS NULL
      OR player_execution."status" IS DISTINCT FROM 'succeeded'
      OR player_execution."run_json" IS DISTINCT FROM NEW."native_execution_json"
      OR component."native_execution_kind" IS DISTINCT FROM 'admitted_player_model_run'
      OR NEW."native_execution_json"->>'runId' IS DISTINCT FROM
         component."native_execution_id"
      OR NEW."native_execution_json"->>'runId' IS DISTINCT FROM 'model-run:' ||
         encode(sha256(convert_to(outcome_afl_trade_canonical_json(execution_content),'UTF8')),'hex')
      OR execution_content->>'schemaVersion' IS DISTINCT FROM 'afl-trade-model-run/v3'
      OR execution_content->'outcome'->>'status' IS DISTINCT FROM 'succeeded'
      OR execution_content->>'datasetId' IS DISTINCT FROM component."dataset_id"
      OR execution_content->>'datasetAdmissionId' IS DISTINCT FROM
         component."dataset_admission_id"
      OR execution_content->>'modelProtocolId' IS DISTINCT FROM component."protocol_id"
      OR execution_content->'outcome'->'validationReportArtifact'->>'artifactId'
         IS DISTINCT FROM NEW."validation_report_artifact_id"
      OR validate_outcome_prepared_valuation_input_v2_artifact(
           execution_content->'outcome'->'validationReportArtifact',
           'non_production'::"OutcomeEnvironment"
         ) IS DISTINCT FROM TRUE
      OR NEW."validation_report_artifact_id" IS DISTINCT FROM 'artifact:' || encode(sha256(convert_to(
         outcome_afl_trade_canonical_json(NEW."validation_report_json"),'UTF8')),'hex')
      OR report_artifact."content_sha256" IS DISTINCT FROM
         substring(NEW."validation_report_artifact_id" FROM length('artifact:') + 1)
      OR report_artifact."media_type" IS DISTINCT FROM 'application/json'
      OR report_artifact."byte_length" IS DISTINCT FROM octet_length(convert_to(
         outcome_afl_trade_canonical_json(NEW."validation_report_json"),'UTF8'))
      OR report_artifact."environment" IS DISTINCT FROM 'non_production'::"OutcomeEnvironment"
      OR report_artifact."created_at" IS DISTINCT FROM
         (execution_content->'outcome'->'validationReportArtifact'->>'createdAt')::TIMESTAMPTZ
      OR report_artifact."created_at"<(execution_content->>'finalTestEvaluatedAt')::TIMESTAMPTZ
      OR report_artifact."created_at">(execution_content->>'finishedAt')::TIMESTAMPTZ
      OR NEW."recorded_at"<report_artifact."created_at"
      OR NEW."validation_report_id" IS DISTINCT FROM 'player-validation-report:' ||
         encode(sha256(convert_to(outcome_afl_trade_canonical_json(report_content),'UTF8')),'hex')
      OR outcome_afl_trade_jsonb_has_exact_keys(report_content,ARRAY[
           'acceptanceOutcome','baselineFitId','candidateModelId','comparableObservationIds',
           'config','evaluatedPartition','evidenceLimitation','excludedObservations','metrics',
           'observationSetId','predictionSetId','publicIdentityBoundary','schemaVersion','valueUnitId'
         ]) IS DISTINCT FROM TRUE
      OR outcome_afl_trade_jsonb_has_exact_keys(report_content->'metrics',ARRAY[
           'candidate','candidateMinusGamesOnly','gamesOnly','relativeImprovement'
         ]) IS DISTINCT FROM TRUE
      OR outcome_afl_trade_jsonb_has_exact_keys(
           report_content->'metrics'->'relativeImprovement',
           ARRAY['meanAbsoluteError','rootMeanSquaredError']
         ) IS DISTINCT FROM TRUE
      OR report_content->>'schemaVersion' IS DISTINCT FROM
         'afl-trade-player-validation-report/v1'
      OR report_content->>'publicIdentityBoundary' IS DISTINCT FROM
         'source_native_no_fantasy_ownership'
      OR report_content->>'evaluatedPartition' IS DISTINCT FROM 'final_test'
      OR report_content->>'observationSetId' IS DISTINCT FROM
         execution_content->>'observationSetId'
      OR report_content->>'candidateModelId' IS DISTINCT FROM execution_content->>'modelId'
      OR jsonb_typeof(report_content->'comparableObservationIds') IS DISTINCT FROM 'array'
      OR jsonb_array_length(report_content->'comparableObservationIds') NOT BETWEEN 1 AND 100000
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(
           report_content->'comparableObservationIds') entry
         WHERE jsonb_typeof(entry) IS DISTINCT FROM 'string' OR entry#>>'{}'='')
      OR jsonb_array_length(report_content->'comparableObservationIds') IS DISTINCT FROM
         (SELECT count(DISTINCT entry#>>'{}') FROM jsonb_array_elements(
           report_content->'comparableObservationIds') entry)
      OR report_content->>'acceptanceOutcome' IS NULL
      OR report_content->>'acceptanceOutcome' NOT IN (
         'meets_declared_predictive_thresholds','does_not_meet_declared_predictive_thresholds')
      OR report_content->'config'->>'schemaVersion' IS DISTINCT FROM
         'afl-trade-player-validation-config/v1'
      OR report_content->'config'->>'acceptanceRule' IS DISTINCT FROM
         'candidate_improves_both_mae_and_rmse'
      OR report_content->'config'->>'incompletePredictionCoverage' IS DISTINCT FROM 'fail_closed'
      OR report_content->'config'->>'governanceEffect' IS DISTINCT FROM
         'evidence_only_no_gate_or_source_approval'
      OR report_content->>'evidenceLimitation' IS DISTINCT FROM
         'report_is_reproducible_evidence_not_source_approval_gate_approval_or_production_readiness'
      OR validate_outcome_governed_player_validation_metrics(
           NEW."validation_report_json") IS DISTINCT FROM TRUE
      OR jsonb_typeof(report_content->'metrics'->'relativeImprovement'->'meanAbsoluteError')
         NOT IN ('number','null')
      OR jsonb_typeof(report_content->'metrics'->'relativeImprovement'->'rootMeanSquaredError')
         NOT IN ('number','null')
    THEN RAISE EXCEPTION 'Governed player validation evidence mismatch';
    END IF;
  ELSE
    SELECT * INTO pick_execution FROM "outcome_governed_pick_pav_model_execution"
     WHERE "execution_id"=component."native_execution_id" FOR KEY SHARE;
    IF pick_execution."execution_id" IS NULL
      OR pick_execution."execution_json" IS DISTINCT FROM NEW."native_execution_json"
      OR component."native_execution_kind" IS DISTINCT FROM
       'governed_pick_pav_model_execution'
      OR NEW."validation_report_artifact_id" IS NOT NULL
      OR NEW."native_execution_json"->>'executionId' IS DISTINCT FROM
         component."native_execution_id"
      OR NEW."native_execution_json"->>'executionId' IS DISTINCT FROM
         'pick-pav-model-execution:' || encode(sha256(convert_to(
           outcome_afl_trade_canonical_json(execution_content),'UTF8')),'hex')
      OR execution_content->>'schemaVersion' IS DISTINCT FROM
         'afl-trade-pick-pav-model-execution/v3'
      OR execution_content->>'datasetId' IS DISTINCT FROM component."dataset_id"
      OR execution_content->>'datasetAdmissionId' IS DISTINCT FROM
         component."dataset_admission_id"
      OR (execution_content->>'datasetAdmissionGateLedgerRevision')::INTEGER
         IS DISTINCT FROM component."dataset_admission_gate_ledger_revision"
      OR execution_content->>'protocolId' IS DISTINCT FROM component."protocol_id"
      OR execution_content->'validationReport' IS DISTINCT FROM NEW."validation_report_json"
      OR report_content->>'environment' IS DISTINCT FROM execution_content->>'environment'
      OR report_content->>'competition' IS DISTINCT FROM execution_content->>'competition'
      OR report_content->>'observationSetId' IS DISTINCT FROM
         execution_content->>'observationSetId'
      OR report_content->>'benchmarkId' IS DISTINCT FROM
         execution_content->'benchmark'->>'benchmarkId'
      OR report_content->'config' IS DISTINCT FROM execution_content->'validationConfig'
      OR report_content->>'releaseId' IS DISTINCT FROM execution_content->>'releaseId'
      OR report_content->>'policyId' IS DISTINCT FROM execution_content->>'policyId'
      OR report_content->>'methodId' IS DISTINCT FROM execution_content->>'methodId'
      OR report_content->>'valueUnit' IS DISTINCT FROM execution_content->>'valueUnit'
      OR report_content->'fixedHorizonSeasons' IS DISTINCT FROM
         execution_content->'observationSet'->'content'->'policy'->'content'->'fixedHorizonSeasons'
      OR NEW."validation_report_id" IS DISTINCT FROM 'pick-pav-validation-report:' ||
         encode(sha256(convert_to(outcome_afl_trade_canonical_json(report_content),'UTF8')),'hex')
      OR outcome_afl_trade_jsonb_has_exact_keys(report_content,ARRAY[
           'approvalStatus','authorityBoundary','benchmarkId','competition','config','environment',
           'evaluationStatus','excludedObservations','fixedHorizonSeasons','inputObservationCount',
           'limitation','methodId','observationSetId','policyId','predictions','publicationEligible',
           'releaseId','schemaVersion','scoreScopes','valueUnit'
         ]) IS DISTINCT FROM TRUE
      OR report_content->>'schemaVersion' IS DISTINCT FROM
         'afl-trade-pick-pav-validation-report/v1'
      OR report_content->>'authorityBoundary' IS DISTINCT FROM
         'private_temporal_pick_pav_benchmark_evaluation_not_model_approval_grade_publication_or_fantasy_ownership'
      OR report_content->'publicationEligible' IS DISTINCT FROM 'false'::JSONB
      OR report_content->>'approvalStatus' IS DISTINCT FROM
         'not_assessed_by_validation_harness'
      OR report_content->>'limitation' IS DISTINCT FROM
         'Validation evidence is not Gate approval, deployment approval, a grade, or public numerical authority.'
      OR report_content->'config'->>'schemaVersion' IS DISTINCT FROM
         'afl-trade-pick-pav-validation-config/v1'
      OR (report_content->'config'->>'nominalIntervalCoverage')::DOUBLE PRECISION
         IS DISTINCT FROM 0.8::DOUBLE PRECISION
      OR report_content->>'evaluationStatus' IS NULL
      OR report_content->>'evaluationStatus' NOT IN (
         'scored_not_approved','insufficient_eligible_observations_not_approved',
         'invalid_zero_probability_not_approved')
      OR jsonb_typeof(report_content->'scoreScopes') IS DISTINCT FROM 'array'
      OR (SELECT count(*) FROM jsonb_array_elements(report_content->'scoreScopes') scope
           WHERE scope->>'scope'='final_test')<>1
      OR validate_outcome_governed_pick_final_test_metrics(
           NEW."validation_report_json") IS DISTINCT FROM TRUE
    THEN RAISE EXCEPTION 'Governed pick validation evidence mismatch';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_governed_component_validation_evidence_validate"
BEFORE INSERT ON "outcome_governed_component_validation_evidence"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_governed_component_validation_evidence"();

CREATE OR REPLACE FUNCTION "reject_outcome_governed_component_validation_evidence_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Governed component validation evidence is immutable'; END $$;
CREATE TRIGGER "outcome_governed_component_validation_evidence_append_only"
BEFORE UPDATE OR DELETE ON "outcome_governed_component_validation_evidence"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_governed_component_validation_evidence_mutation"();

CREATE OR REPLACE FUNCTION "validate_outcome_governed_model_qualification_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  content JSONB := NEW."qualification_json"->'content';
  policy JSONB;
  player_evidence JSONB;
  pick_evidence JSONB;
  pick_metrics JSONB;
  expected_failure_codes JSONB := '[]'::JSONB;
  player_failed BOOLEAN := FALSE;
  pick_failed BOOLEAN := FALSE;
  player_run RECORD;
  pick_run RECORD;
  player_native RECORD;
  pick_native RECORD;
  pick_final_test JSONB;
  qualification_artifact RECORD;
BEGIN
  SELECT * INTO STRICT player_run FROM "outcome_governed_valuation_component_run"
   WHERE "run_id"=NEW."player_run_id" FOR KEY SHARE;
  SELECT * INTO STRICT pick_run FROM "outcome_governed_valuation_component_run"
   WHERE "run_id"=NEW."pick_run_id" FOR KEY SHARE;
  SELECT * INTO player_native FROM "outcome_governed_component_validation_evidence"
   WHERE "run_id"=NEW."player_run_id" FOR KEY SHARE;
  SELECT * INTO pick_native FROM "outcome_governed_component_validation_evidence"
   WHERE "run_id"=NEW."pick_run_id" FOR KEY SHARE;
  IF player_native."run_id" IS NULL OR pick_native."run_id" IS NULL THEN
    RAISE EXCEPTION 'Governed model qualification native evidence mismatch';
  END IF;
  SELECT scope INTO STRICT pick_final_test
    FROM jsonb_array_elements(pick_native."validation_report_json"->'content'->'scoreScopes') scope
   WHERE scope->>'scope'='final_test';
  SELECT * INTO STRICT qualification_artifact FROM "outcome_artifact_custody"
   WHERE "artifact_id"=NEW."artifact_id" FOR KEY SHARE;
  policy:=content->'policy';
  player_evidence:=content->'player'->'validationEvidence';
  pick_evidence:=content->'pick'->'validationEvidence';
  pick_metrics:=pick_evidence->'metrics';
  IF outcome_afl_trade_jsonb_has_exact_keys(
       NEW."qualification_json", ARRAY['content','qualificationId'])
       IS DISTINCT FROM TRUE
    OR outcome_afl_trade_jsonb_has_exact_keys(
       content, ARRAY['environment','evaluatedAt','failureCodes','outcome','pick',
         'player','policy','policyArtifact','publicationEligible','schemaVersion','scopeKey'])
       IS DISTINCT FROM TRUE
    OR outcome_afl_trade_jsonb_has_exact_keys(
       policy, ARRAY['pick','player','policyVersion','schemaVersion']) IS DISTINCT FROM TRUE
    OR outcome_afl_trade_jsonb_has_exact_keys(
       policy->'player', ARRAY['minimumComparableObservations','minimumRelativeMaeImprovement',
         'minimumRelativeRmseImprovement','requiredAcceptanceOutcome','schemaVersion'])
       IS DISTINCT FROM TRUE
    OR outcome_afl_trade_jsonb_has_exact_keys(
       policy->'pick', ARRAY['evaluatedScope','maximumContributionCrps',
         'maximumEmpiricalP10P90Coverage','maximumMeanAbsoluteContributionError',
         'maximumMeanAbsoluteGamesError','maximumMeanEmpiricalIntervalWidth',
         'maximumMulticlassBrierScore','maximumMulticlassLogLoss',
         'maximumRankedProbabilityScore','maximumRootMeanSquaredContributionError',
         'maximumRootMeanSquaredGamesError','maximumZeroProbabilityObservationCount',
         'minimumEmpiricalP10P90Coverage','minimumObservations','schemaVersion'])
       IS DISTINCT FROM TRUE
    OR outcome_afl_trade_jsonb_has_exact_keys(
       content->'player', ARRAY['criteriaArtifact','passed','protocolArtifact','protocolId','role',
         'runArtifact','runId','validationEvidence','validationEvidenceArtifact'])
       IS DISTINCT FROM TRUE
    OR outcome_afl_trade_jsonb_has_exact_keys(
       content->'pick', ARRAY['criteriaArtifact','passed','protocolArtifact','protocolId','role',
         'runArtifact','runId','validationEvidence','validationEvidenceArtifact'])
       IS DISTINCT FROM TRUE
    OR outcome_afl_trade_jsonb_has_exact_keys(
       player_evidence, ARRAY['acceptanceOutcome','comparableObservationCount',
         'relativeMaeImprovement','relativeRmseImprovement','schemaVersion','validationReportId'])
       IS DISTINCT FROM TRUE
    OR outcome_afl_trade_jsonb_has_exact_keys(
       pick_evidence, ARRAY['evaluationStatus','metrics','observationCount','schemaVersion','scope',
         'validationReportId']) IS DISTINCT FROM TRUE
    OR content->>'schemaVersion' IS DISTINCT FROM 'governed-valuation-model-qualification/v1'
    OR policy->>'schemaVersion' IS DISTINCT FROM
       'governed-valuation-model-qualification-policy/v1'
    OR policy->'player'->>'schemaVersion' IS DISTINCT FROM
       'governed-player-model-qualification-criteria/v1'
    OR policy->'pick'->>'schemaVersion' IS DISTINCT FROM
       'governed-pick-model-qualification-criteria/v1'
    OR policy->'pick'->>'evaluatedScope' IS DISTINCT FROM 'final_test'
    OR player_evidence->>'schemaVersion' IS DISTINCT FROM
       'governed-player-model-qualification-evidence/v1'
    OR pick_evidence->>'schemaVersion' IS DISTINCT FROM
       'governed-pick-model-qualification-evidence/v1'
    OR pick_evidence->>'scope' IS DISTINCT FROM 'final_test'
    OR content->'player'->>'role' IS DISTINCT FROM 'player_contribution_and_availability'
    OR content->'pick'->>'role' IS DISTINCT FROM
       'draft_pick_and_future_pick_distribution'
    OR player_native."role" IS DISTINCT FROM content->'player'->>'role'
    OR pick_native."role" IS DISTINCT FROM content->'pick'->>'role'
    OR player_native."recorded_at">NEW."evaluated_at"
    OR pick_native."recorded_at">NEW."evaluated_at"
    OR player_evidence->>'validationReportId' IS DISTINCT FROM
       player_native."validation_report_id"
    OR (player_evidence->>'comparableObservationCount')::INTEGER IS DISTINCT FROM
       jsonb_array_length(player_native."validation_report_json"->'content'->'comparableObservationIds')
    OR player_evidence->>'acceptanceOutcome' IS DISTINCT FROM
       player_native."validation_report_json"->'content'->>'acceptanceOutcome'
    OR player_evidence->'relativeMaeImprovement' IS DISTINCT FROM
       player_native."validation_report_json"->'content'->'metrics'->'relativeImprovement'->'meanAbsoluteError'
    OR player_evidence->'relativeRmseImprovement' IS DISTINCT FROM
       player_native."validation_report_json"->'content'->'metrics'->'relativeImprovement'->'rootMeanSquaredError'
    OR pick_evidence->>'validationReportId' IS DISTINCT FROM pick_native."validation_report_id"
    OR pick_evidence->>'evaluationStatus' IS DISTINCT FROM
       pick_native."validation_report_json"->'content'->>'evaluationStatus'
    OR (pick_evidence->>'observationCount')::INTEGER IS DISTINCT FROM
       (pick_final_test->>'observationCount')::INTEGER
    OR pick_evidence->'metrics' IS DISTINCT FROM pick_final_test->'metrics'
    OR policy->'player'->>'requiredAcceptanceOutcome' IS DISTINCT FROM
       'meets_declared_predictive_thresholds'
    OR player_evidence->>'acceptanceOutcome' IS NULL
    OR player_evidence->>'acceptanceOutcome' NOT IN (
       'meets_declared_predictive_thresholds','does_not_meet_declared_predictive_thresholds')
    OR pick_evidence->>'evaluationStatus' IS NULL
    OR pick_evidence->>'evaluationStatus' NOT IN (
       'scored_not_approved','insufficient_eligible_observations_not_approved',
       'invalid_zero_probability_not_approved')
    OR jsonb_typeof(content->'publicationEligible') IS DISTINCT FROM 'boolean'
    OR content->'publicationEligible' IS DISTINCT FROM 'false'::JSONB
    OR jsonb_typeof(content->'player'->'passed') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(content->'pick'->'passed') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(content->'failureCodes') IS DISTINCT FROM 'array'
    OR jsonb_typeof(content->'scopeKey') IS DISTINCT FROM 'string'
    OR length(content->>'scopeKey') NOT BETWEEN 1 AND 200
    OR content->>'scopeKey' !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$'
    OR jsonb_typeof(content->'evaluatedAt') IS DISTINCT FROM 'string'
    OR content->>'evaluatedAt' !~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
    OR jsonb_typeof(player_evidence->'validationReportId') IS DISTINCT FROM 'string'
    OR player_evidence->>'validationReportId' !~ '^player-validation-report:[a-f0-9]{64}$'
    OR jsonb_typeof(pick_evidence->'validationReportId') IS DISTINCT FROM 'string'
    OR pick_evidence->>'validationReportId' !~ '^pick-pav-validation-report:[a-f0-9]{64}$'
  THEN RAISE EXCEPTION 'Governed model qualification nested or native evidence contract mismatch';
  END IF;
  IF EXISTS (
       SELECT 1 FROM jsonb_array_elements(jsonb_build_array(
         policy->'player'->'minimumComparableObservations',
         policy->'player'->'minimumRelativeMaeImprovement',
         policy->'player'->'minimumRelativeRmseImprovement',
         policy->'pick'->'minimumObservations',
         policy->'pick'->'maximumMulticlassBrierScore',
         policy->'pick'->'maximumMulticlassLogLoss',
         policy->'pick'->'maximumRankedProbabilityScore',
         policy->'pick'->'maximumContributionCrps',
         policy->'pick'->'maximumMeanAbsoluteContributionError',
         policy->'pick'->'maximumRootMeanSquaredContributionError',
         policy->'pick'->'maximumMeanAbsoluteGamesError',
         policy->'pick'->'maximumRootMeanSquaredGamesError',
         policy->'pick'->'minimumEmpiricalP10P90Coverage',
         policy->'pick'->'maximumEmpiricalP10P90Coverage',
         policy->'pick'->'maximumMeanEmpiricalIntervalWidth',
         policy->'pick'->'maximumZeroProbabilityObservationCount',
         player_evidence->'comparableObservationCount',
         pick_evidence->'observationCount'
       )) value WHERE jsonb_typeof(value)<>'number'
     )
    OR jsonb_typeof(player_evidence->'relativeMaeImprovement') NOT IN ('number','null')
    OR jsonb_typeof(player_evidence->'relativeRmseImprovement') NOT IN ('number','null')
    OR (policy->'player'->>'minimumComparableObservations')::NUMERIC NOT BETWEEN 1 AND 100000
    OR (policy->'player'->>'minimumComparableObservations')::NUMERIC <>
       trunc((policy->'player'->>'minimumComparableObservations')::NUMERIC)
    OR (policy->'player'->>'minimumRelativeMaeImprovement')::NUMERIC NOT BETWEEN 0 AND 1
    OR (policy->'player'->>'minimumRelativeMaeImprovement')::NUMERIC = 0
    OR (policy->'player'->>'minimumRelativeRmseImprovement')::NUMERIC NOT BETWEEN 0 AND 1
    OR (policy->'player'->>'minimumRelativeRmseImprovement')::NUMERIC = 0
    OR (policy->'pick'->>'minimumObservations')::NUMERIC NOT BETWEEN 1 AND 100000
    OR (policy->'pick'->>'minimumObservations')::NUMERIC <>
       trunc((policy->'pick'->>'minimumObservations')::NUMERIC)
    OR (player_evidence->>'comparableObservationCount')::NUMERIC NOT BETWEEN 0 AND 100000
    OR (player_evidence->>'comparableObservationCount')::NUMERIC <>
       trunc((player_evidence->>'comparableObservationCount')::NUMERIC)
    OR (pick_evidence->>'observationCount')::NUMERIC NOT BETWEEN 0 AND 100000
    OR (pick_evidence->>'observationCount')::NUMERIC <>
       trunc((pick_evidence->>'observationCount')::NUMERIC)
    OR (policy->'pick'->>'minimumEmpiricalP10P90Coverage')::NUMERIC NOT BETWEEN 0 AND 1
    OR (policy->'pick'->>'maximumEmpiricalP10P90Coverage')::NUMERIC NOT BETWEEN 0 AND 1
    OR (policy->'pick'->>'maximumEmpiricalP10P90Coverage')::NUMERIC <
       (policy->'pick'->>'minimumEmpiricalP10P90Coverage')::NUMERIC
    OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(jsonb_build_array(
         policy->'pick'->'maximumMulticlassBrierScore',
         policy->'pick'->'maximumMulticlassLogLoss',
         policy->'pick'->'maximumRankedProbabilityScore',
         policy->'pick'->'maximumContributionCrps',
         policy->'pick'->'maximumMeanAbsoluteContributionError',
         policy->'pick'->'maximumRootMeanSquaredContributionError',
         policy->'pick'->'maximumMeanAbsoluteGamesError',
         policy->'pick'->'maximumRootMeanSquaredGamesError',
         policy->'pick'->'maximumMeanEmpiricalIntervalWidth'
       )) value WHERE (value#>>'{}')::NUMERIC < 0
     )
    OR (policy->'pick'->>'maximumZeroProbabilityObservationCount')::NUMERIC < 0
    OR (policy->'pick'->>'maximumZeroProbabilityObservationCount')::NUMERIC <>
       trunc((policy->'pick'->>'maximumZeroProbabilityObservationCount')::NUMERIC)
  THEN RAISE EXCEPTION 'Governed model qualification numeric contract mismatch';
  END IF;
  IF pick_metrics IS NOT NULL AND pick_metrics<>'null'::JSONB THEN
    IF outcome_afl_trade_jsonb_has_exact_keys(
         pick_metrics, ARRAY['contributionCrps','empiricalP10P90Coverage',
           'meanAbsoluteContributionError','meanAbsoluteGamesError','meanEmpiricalIntervalWidth',
           'multiclassBrierScore','multiclassLogLoss','rankedProbabilityScore',
           'rootMeanSquaredContributionError','rootMeanSquaredGamesError',
           'zeroProbabilityObservationCount']) IS DISTINCT FROM TRUE
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(jsonb_build_array(
          pick_metrics->'multiclassBrierScore', pick_metrics->'rankedProbabilityScore',
          pick_metrics->'contributionCrps', pick_metrics->'meanAbsoluteContributionError',
          pick_metrics->'rootMeanSquaredContributionError', pick_metrics->'meanAbsoluteGamesError',
          pick_metrics->'rootMeanSquaredGamesError', pick_metrics->'empiricalP10P90Coverage',
          pick_metrics->'meanEmpiricalIntervalWidth',
          pick_metrics->'zeroProbabilityObservationCount'
        )) value WHERE jsonb_typeof(value)<>'number'
      )
      OR NOT (pick_metrics ? 'multiclassLogLoss')
      OR jsonb_typeof(pick_metrics->'multiclassLogLoss') NOT IN ('number','null')
      OR (pick_metrics->>'multiclassBrierScore')::NUMERIC < 0
      OR (pick_metrics->>'rankedProbabilityScore')::NUMERIC < 0
      OR (pick_metrics->>'contributionCrps')::NUMERIC < 0
      OR (pick_metrics->>'meanAbsoluteContributionError')::NUMERIC < 0
      OR (pick_metrics->>'rootMeanSquaredContributionError')::NUMERIC < 0
      OR (pick_metrics->>'meanAbsoluteGamesError')::NUMERIC < 0
      OR (pick_metrics->>'rootMeanSquaredGamesError')::NUMERIC < 0
      OR (pick_metrics->>'empiricalP10P90Coverage')::NUMERIC NOT BETWEEN 0 AND 1
      OR (pick_metrics->>'meanEmpiricalIntervalWidth')::NUMERIC < 0
      OR (pick_metrics->>'zeroProbabilityObservationCount')::NUMERIC < 0
      OR (pick_metrics->>'zeroProbabilityObservationCount')::NUMERIC <>
         trunc((pick_metrics->>'zeroProbabilityObservationCount')::NUMERIC)
      OR (pick_metrics->>'multiclassLogLoss')::NUMERIC < 0
    THEN RAISE EXCEPTION 'Governed model qualification metric contract mismatch';
    END IF;
  END IF;
  IF EXISTS (
       SELECT 1 FROM jsonb_array_elements(jsonb_build_array(
         content->'policyArtifact', content->'player'->'runArtifact',
         content->'player'->'protocolArtifact', content->'player'->'criteriaArtifact',
         content->'player'->'validationEvidenceArtifact', content->'pick'->'runArtifact',
         content->'pick'->'protocolArtifact', content->'pick'->'criteriaArtifact',
         content->'pick'->'validationEvidenceArtifact'
       )) reference
       WHERE outcome_afl_trade_jsonb_is_artifact_ref(reference) IS DISTINCT FROM TRUE
         OR "validate_outcome_prepared_valuation_input_v2_artifact"(
              reference, 'non_production'::"OutcomeEnvironment"
            ) IS DISTINCT FROM TRUE
     )
    OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(jsonb_build_array(
         content->'policyArtifact', content->'player'->'runArtifact',
         content->'player'->'protocolArtifact', content->'player'->'criteriaArtifact',
         content->'player'->'validationEvidenceArtifact', content->'pick'->'runArtifact',
         content->'pick'->'protocolArtifact', content->'pick'->'criteriaArtifact',
         content->'pick'->'validationEvidenceArtifact'
       )) reference
       WHERE (reference->>'createdAt')::TIMESTAMPTZ > (content->>'evaluatedAt')::TIMESTAMPTZ
     )
    OR content->'player'->>'runId'=content->'pick'->>'runId'
    OR content->'player'->>'protocolId'=content->'pick'->>'protocolId'
    OR content->'policyArtifact'->>'mediaType' IS DISTINCT FROM 'application/json'
    OR (content->'policyArtifact'->>'byteLength')::BIGINT IS DISTINCT FROM
       octet_length(convert_to(outcome_afl_trade_canonical_json(policy),'UTF8'))
    OR content->'player'->'criteriaArtifact'->>'mediaType' IS DISTINCT FROM 'application/json'
    OR (content->'player'->'criteriaArtifact'->>'byteLength')::BIGINT IS DISTINCT FROM
       octet_length(convert_to(outcome_afl_trade_canonical_json(policy->'player'),'UTF8'))
    OR content->'pick'->'criteriaArtifact'->>'mediaType' IS DISTINCT FROM 'application/json'
    OR (content->'pick'->'criteriaArtifact'->>'byteLength')::BIGINT IS DISTINCT FROM
       octet_length(convert_to(outcome_afl_trade_canonical_json(policy->'pick'),'UTF8'))
    OR content->'player'->'validationEvidenceArtifact'->>'mediaType'
       IS DISTINCT FROM 'application/json'
    OR (content->'player'->'validationEvidenceArtifact'->>'byteLength')::BIGINT
       IS DISTINCT FROM octet_length(convert_to(
         outcome_afl_trade_canonical_json(player_evidence),'UTF8'))
    OR content->'pick'->'validationEvidenceArtifact'->>'mediaType'
       IS DISTINCT FROM 'application/json'
    OR (content->'pick'->'validationEvidenceArtifact'->>'byteLength')::BIGINT
       IS DISTINCT FROM octet_length(convert_to(
         outcome_afl_trade_canonical_json(pick_evidence),'UTF8'))
  THEN RAISE EXCEPTION 'Governed model qualification lineage contract mismatch';
  END IF;
  IF (player_evidence->>'comparableObservationCount')::INTEGER <
       (policy->'player'->>'minimumComparableObservations')::INTEGER THEN
    expected_failure_codes:=expected_failure_codes || jsonb_build_array('player_observation_count_below_minimum');
    player_failed:=TRUE;
  END IF;
  IF player_evidence->>'acceptanceOutcome' IS DISTINCT FROM
       policy->'player'->>'requiredAcceptanceOutcome' THEN
    expected_failure_codes:=expected_failure_codes || jsonb_build_array('player_acceptance_outcome_not_met');
    player_failed:=TRUE;
  END IF;
  IF player_evidence->>'relativeMaeImprovement' IS NULL OR
     (player_evidence->>'relativeMaeImprovement')::NUMERIC <
       (policy->'player'->>'minimumRelativeMaeImprovement')::NUMERIC THEN
    expected_failure_codes:=expected_failure_codes || jsonb_build_array('player_mae_improvement_below_minimum');
    player_failed:=TRUE;
  END IF;
  IF player_evidence->>'relativeRmseImprovement' IS NULL OR
     (player_evidence->>'relativeRmseImprovement')::NUMERIC <
       (policy->'player'->>'minimumRelativeRmseImprovement')::NUMERIC THEN
    expected_failure_codes:=expected_failure_codes || jsonb_build_array('player_rmse_improvement_below_minimum');
    player_failed:=TRUE;
  END IF;
  IF pick_evidence->>'evaluationStatus' IS DISTINCT FROM 'scored_not_approved' THEN
    expected_failure_codes:=expected_failure_codes || jsonb_build_array('pick_evaluation_not_scored');
    pick_failed:=TRUE;
  END IF;
  IF (pick_evidence->>'observationCount')::INTEGER <
       (policy->'pick'->>'minimumObservations')::INTEGER THEN
    expected_failure_codes:=expected_failure_codes || jsonb_build_array('pick_observation_count_below_minimum');
    pick_failed:=TRUE;
  END IF;
  IF pick_metrics IS NULL OR pick_metrics='null'::JSONB THEN
    expected_failure_codes:=expected_failure_codes || jsonb_build_array('pick_metrics_unavailable');
    pick_failed:=TRUE;
  ELSE
    IF (pick_metrics->>'multiclassBrierScore')::NUMERIC > (policy->'pick'->>'maximumMulticlassBrierScore')::NUMERIC THEN expected_failure_codes:=expected_failure_codes || jsonb_build_array('pick_brier_score_above_maximum'); pick_failed:=TRUE; END IF;
    IF (pick_metrics->>'rankedProbabilityScore')::NUMERIC > (policy->'pick'->>'maximumRankedProbabilityScore')::NUMERIC THEN expected_failure_codes:=expected_failure_codes || jsonb_build_array('pick_ranked_probability_score_above_maximum'); pick_failed:=TRUE; END IF;
    IF (pick_metrics->>'contributionCrps')::NUMERIC > (policy->'pick'->>'maximumContributionCrps')::NUMERIC THEN expected_failure_codes:=expected_failure_codes || jsonb_build_array('pick_contribution_crps_above_maximum'); pick_failed:=TRUE; END IF;
    IF (pick_metrics->>'meanAbsoluteContributionError')::NUMERIC > (policy->'pick'->>'maximumMeanAbsoluteContributionError')::NUMERIC THEN expected_failure_codes:=expected_failure_codes || jsonb_build_array('pick_contribution_mae_above_maximum'); pick_failed:=TRUE; END IF;
    IF (pick_metrics->>'rootMeanSquaredContributionError')::NUMERIC > (policy->'pick'->>'maximumRootMeanSquaredContributionError')::NUMERIC THEN expected_failure_codes:=expected_failure_codes || jsonb_build_array('pick_contribution_rmse_above_maximum'); pick_failed:=TRUE; END IF;
    IF (pick_metrics->>'meanAbsoluteGamesError')::NUMERIC > (policy->'pick'->>'maximumMeanAbsoluteGamesError')::NUMERIC THEN expected_failure_codes:=expected_failure_codes || jsonb_build_array('pick_games_mae_above_maximum'); pick_failed:=TRUE; END IF;
    IF (pick_metrics->>'rootMeanSquaredGamesError')::NUMERIC > (policy->'pick'->>'maximumRootMeanSquaredGamesError')::NUMERIC THEN expected_failure_codes:=expected_failure_codes || jsonb_build_array('pick_games_rmse_above_maximum'); pick_failed:=TRUE; END IF;
    IF (pick_metrics->>'meanEmpiricalIntervalWidth')::NUMERIC > (policy->'pick'->>'maximumMeanEmpiricalIntervalWidth')::NUMERIC THEN expected_failure_codes:=expected_failure_codes || jsonb_build_array('pick_interval_width_above_maximum'); pick_failed:=TRUE; END IF;
    IF (pick_metrics->>'zeroProbabilityObservationCount')::INTEGER > (policy->'pick'->>'maximumZeroProbabilityObservationCount')::INTEGER THEN expected_failure_codes:=expected_failure_codes || jsonb_build_array('pick_zero_probability_count_above_maximum'); pick_failed:=TRUE; END IF;
    IF pick_metrics->>'multiclassLogLoss' IS NULL THEN expected_failure_codes:=expected_failure_codes || jsonb_build_array('pick_log_loss_unavailable'); pick_failed:=TRUE;
    ELSIF (pick_metrics->>'multiclassLogLoss')::NUMERIC > (policy->'pick'->>'maximumMulticlassLogLoss')::NUMERIC THEN expected_failure_codes:=expected_failure_codes || jsonb_build_array('pick_log_loss_above_maximum'); pick_failed:=TRUE; END IF;
    IF (pick_metrics->>'empiricalP10P90Coverage')::NUMERIC < (policy->'pick'->>'minimumEmpiricalP10P90Coverage')::NUMERIC THEN expected_failure_codes:=expected_failure_codes || jsonb_build_array('pick_coverage_below_minimum'); pick_failed:=TRUE; END IF;
    IF (pick_metrics->>'empiricalP10P90Coverage')::NUMERIC > (policy->'pick'->>'maximumEmpiricalP10P90Coverage')::NUMERIC THEN expected_failure_codes:=expected_failure_codes || jsonb_build_array('pick_coverage_above_maximum'); pick_failed:=TRUE; END IF;
  END IF;
  IF NEW."qualification_json"->>'qualificationId' IS DISTINCT FROM NEW."qualification_id"
    OR content->>'schemaVersion' IS DISTINCT FROM 'governed-valuation-model-qualification/v1'
    OR content->>'environment' IS DISTINCT FROM 'non_production'
    OR content->>'scopeKey' IS DISTINCT FROM NEW."scope_key"
    OR content->>'outcome' IS DISTINCT FROM NEW."outcome"
    OR content->'failureCodes' IS DISTINCT FROM expected_failure_codes
    OR content->'player'->'passed' IS DISTINCT FROM to_jsonb(NOT player_failed)
    OR content->'pick'->'passed' IS DISTINCT FROM to_jsonb(NOT pick_failed)
    OR content->>'outcome' IS DISTINCT FROM
      (CASE WHEN player_failed OR pick_failed THEN 'failed' ELSE 'qualified' END)
    OR content->'publicationEligible' IS DISTINCT FROM 'false'::JSONB
    OR content->'player'->>'runId' IS DISTINCT FROM NEW."player_run_id"
    OR content->'pick'->>'runId' IS DISTINCT FROM NEW."pick_run_id"
    OR content->'policyArtifact'->>'artifactId' IS DISTINCT FROM NEW."policy_artifact_id"
    OR policy->>'policyVersion' IS DISTINCT FROM 'model-qualification-policy:' || encode(sha256(convert_to(
      outcome_afl_trade_canonical_json(jsonb_build_object('player',policy->'player','pick',policy->'pick')),'UTF8')),'hex')
    OR NEW."policy_artifact_id" IS DISTINCT FROM 'artifact:' || encode(sha256(convert_to(
      outcome_afl_trade_canonical_json(policy),'UTF8')),'hex')
    OR content->'player'->'criteriaArtifact'->>'artifactId'
      IS DISTINCT FROM NEW."player_criteria_artifact_id"
    OR content->'pick'->'criteriaArtifact'->>'artifactId'
      IS DISTINCT FROM NEW."pick_criteria_artifact_id"
    OR content->'player'->'validationEvidenceArtifact'->>'artifactId'
      IS DISTINCT FROM NEW."player_evidence_artifact_id"
    OR content->'pick'->'validationEvidenceArtifact'->>'artifactId'
      IS DISTINCT FROM NEW."pick_evidence_artifact_id"
    OR NEW."player_criteria_artifact_id" IS DISTINCT FROM 'artifact:' || encode(sha256(convert_to(
      outcome_afl_trade_canonical_json(policy->'player'),'UTF8')),'hex')
    OR NEW."pick_criteria_artifact_id" IS DISTINCT FROM 'artifact:' || encode(sha256(convert_to(
      outcome_afl_trade_canonical_json(policy->'pick'),'UTF8')),'hex')
    OR NEW."player_evidence_artifact_id" IS DISTINCT FROM 'artifact:' || encode(sha256(convert_to(
      outcome_afl_trade_canonical_json(player_evidence),'UTF8')),'hex')
    OR NEW."pick_evidence_artifact_id" IS DISTINCT FROM 'artifact:' || encode(sha256(convert_to(
      outcome_afl_trade_canonical_json(pick_evidence),'UTF8')),'hex')
    OR (content->>'evaluatedAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."evaluated_at"
    OR NEW."content_sha256" IS DISTINCT FROM substring(NEW."qualification_id" FROM 21)
    OR NEW."content_canonical_json" IS DISTINCT FROM outcome_afl_trade_canonical_json(content)
    OR NEW."qualification_id" IS DISTINCT FROM 'model-qualification:' ||
      encode(sha256(convert_to(NEW."content_canonical_json",'UTF8')),'hex')
    OR NEW."artifact_id" IS DISTINCT FROM 'artifact:' || encode(sha256(convert_to(
      outcome_afl_trade_canonical_json(NEW."qualification_json"),'UTF8')),'hex')
    OR qualification_artifact."content_sha256" IS DISTINCT FROM
       substring(NEW."artifact_id" FROM length('artifact:') + 1)
    OR qualification_artifact."storage_uri" IS DISTINCT FROM
       'artifact://sha256/' || qualification_artifact."content_sha256"
    OR qualification_artifact."media_type" IS DISTINCT FROM 'application/json'
    OR qualification_artifact."byte_length" IS DISTINCT FROM
       octet_length(convert_to(outcome_afl_trade_canonical_json(NEW."qualification_json"),'UTF8'))
    OR qualification_artifact."environment" IS DISTINCT FROM
       'non_production'::"OutcomeEnvironment"
    OR qualification_artifact."created_at" IS DISTINCT FROM NEW."evaluated_at"
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

CREATE OR REPLACE FUNCTION "validate_outcome_automated_gate_pair_commit"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  automated_qualification_id TEXT;
  qualification_row RECORD;
  decision_count INTEGER;
  player_count INTEGER;
  pick_count INTEGER;
BEGIN
  IF NEW."decision_json"->'content'->>'authorityKind'<>'automated_validation_record' THEN
    RETURN NEW;
  END IF;
  SELECT artifact->>'artifactId' INTO STRICT automated_qualification_id
    FROM jsonb_array_elements(NEW."decision_json"->'content'->'affectedArtifacts') artifact
    WHERE artifact->>'kind'='model_qualification';
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'automated-gate-pair:' || automated_qualification_id,0
  ));
  SELECT * INTO STRICT qualification_row
    FROM "outcome_governed_valuation_model_qualification"
    WHERE "qualification_id"=automated_qualification_id;
  SELECT count(*),
         count(*) FILTER (WHERE EXISTS (
           SELECT 1
             FROM jsonb_array_elements(decision."decision_json"->'content'->'affectedArtifacts') artifact
            WHERE artifact->>'kind'='model_run'
              AND artifact->>'artifactId'=qualification_row."player_run_id"
         )),
         count(*) FILTER (WHERE EXISTS (
           SELECT 1
             FROM jsonb_array_elements(decision."decision_json"->'content'->'affectedArtifacts') artifact
            WHERE artifact->>'kind'='model_run'
              AND artifact->>'artifactId'=qualification_row."pick_run_id"
         ))
    INTO decision_count,player_count,pick_count
    FROM "outcome_gate_decision" decision
   WHERE decision."decision_json"->'content'->>'authorityKind'='automated_validation_record'
     AND EXISTS (
       SELECT 1
         FROM jsonb_array_elements(decision."decision_json"->'content'->'affectedArtifacts') artifact
        WHERE artifact->>'kind'='model_qualification'
          AND artifact->>'artifactId'=automated_qualification_id
     );
  IF decision_count<>2 OR player_count<>1 OR pick_count<>1 THEN
    RAISE EXCEPTION 'Automated Gate 3 authority requires one atomic role-specific decision pair';
  END IF;
  RETURN NEW;
END $$;

CREATE CONSTRAINT TRIGGER "outcome_automated_gate_pair_commit_guard"
AFTER INSERT ON "outcome_gate_decision"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_automated_gate_pair_commit"();

CREATE OR REPLACE FUNCTION "outcome_automated_gate_artifact_id"(
  decision_document JSONB,
  artifact_kind TEXT
) RETURNS TEXT LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT artifact->>'artifactId'
    FROM jsonb_array_elements(decision_document->'content'->'affectedArtifacts') artifact
   WHERE artifact->>'kind'=artifact_kind
   LIMIT 1
$$;

CREATE UNIQUE INDEX "outcome_automated_gate_qualification_run_unique"
ON "outcome_gate_decision" (
  outcome_automated_gate_artifact_id("decision_json",'model_qualification'),
  outcome_automated_gate_artifact_id("decision_json",'model_run')
)
WHERE "decision_json"->'content'->>'authorityKind'='automated_validation_record';

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

CREATE OR REPLACE FUNCTION "validate_outcome_governed_model_qualification_work"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  content JSONB := NEW."work_json"->'content';
  qualification RECORD;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW."work_id" IS DISTINCT FROM OLD."work_id"
      OR NEW."scope_key" IS DISTINCT FROM OLD."scope_key"
      OR NEW."qualification_id" IS DISTINCT FROM OLD."qualification_id"
      OR NEW."player_gate3_decision_id" IS DISTINCT FROM OLD."player_gate3_decision_id"
      OR NEW."pick_gate3_decision_id" IS DISTINCT FROM OLD."pick_gate3_decision_id"
      OR NEW."available_at" IS DISTINCT FROM OLD."available_at"
      OR NEW."work_json" IS DISTINCT FROM OLD."work_json"
      OR NEW."recorded_at" IS DISTINCT FROM OLD."recorded_at"
    THEN RAISE EXCEPTION 'Governed model qualification work evidence is immutable';
    END IF;
    IF NOT (
      NEW."status"=OLD."status"
      OR (OLD."status"='pending' AND NEW."status" IN ('claimed','superseded'))
      OR (OLD."status"='claimed' AND NEW."status" IN ('pending','completed','superseded'))
    ) THEN RAISE EXCEPTION 'Invalid governed model qualification work status transition';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO STRICT qualification
    FROM "outcome_governed_valuation_model_qualification"
   WHERE "qualification_id"=NEW."qualification_id" FOR KEY SHARE;
  IF outcome_afl_trade_jsonb_has_exact_keys(NEW."work_json",ARRAY['content','workId'])
       IS DISTINCT FROM TRUE
    OR outcome_afl_trade_jsonb_has_exact_keys(content,ARRAY[
         'availableAt','cause','environment','pickGate3DecisionId','pickRunId',
         'playerGate3DecisionId','playerRunId','publicationEligible','qualificationId',
         'schemaVersion','scopeKey','status'
       ]) IS DISTINCT FROM TRUE
    OR NEW."work_json"->>'workId' IS DISTINCT FROM NEW."work_id"
    OR content->>'schemaVersion' IS DISTINCT FROM
       'governed-valuation-model-qualification-work/v1'
    OR content->>'environment' IS DISTINCT FROM 'non_production'
    OR content->>'cause' IS DISTINCT FROM 'current_qualified_model_pair_advanced'
    OR content->>'status' IS DISTINCT FROM 'pending'
    OR jsonb_typeof(content->'publicationEligible') IS DISTINCT FROM 'boolean'
    OR content->'publicationEligible' IS DISTINCT FROM 'false'::JSONB
    OR jsonb_typeof(content->'scopeKey') IS DISTINCT FROM 'string'
    OR length(content->>'scopeKey') NOT BETWEEN 1 AND 200
    OR content->>'scopeKey' !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$'
    OR content->>'qualificationId' !~ '^model-qualification:[a-f0-9]{64}$'
    OR content->>'playerRunId' !~ '^model-run:[a-f0-9]{64}$'
    OR content->>'pickRunId' !~ '^model-run:[a-f0-9]{64}$'
    OR content->>'playerGate3DecisionId' !~ '^gate-decision:[a-f0-9]{64}$'
    OR content->>'pickGate3DecisionId' !~ '^gate-decision:[a-f0-9]{64}$'
    OR jsonb_typeof(content->'availableAt') IS DISTINCT FROM 'string'
    OR content->>'availableAt' !~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
    OR NEW."work_id" IS DISTINCT FROM 'model-qualification-work:' || encode(sha256(convert_to(
       outcome_afl_trade_canonical_json(content),'UTF8')),'hex')
    OR NEW."scope_key" IS DISTINCT FROM content->>'scopeKey'
    OR NEW."qualification_id" IS DISTINCT FROM content->>'qualificationId'
    OR NEW."player_gate3_decision_id" IS DISTINCT FROM content->>'playerGate3DecisionId'
    OR NEW."pick_gate3_decision_id" IS DISTINCT FROM content->>'pickGate3DecisionId'
    OR NEW."available_at" IS DISTINCT FROM (content->>'availableAt')::TIMESTAMPTZ
    OR NEW."status" IS DISTINCT FROM 'pending'
    OR qualification."outcome" IS DISTINCT FROM 'qualified'
    OR qualification."scope_key" IS DISTINCT FROM NEW."scope_key"
    OR qualification."player_run_id" IS DISTINCT FROM content->>'playerRunId'
    OR qualification."pick_run_id" IS DISTINCT FROM content->>'pickRunId'
    OR NOT EXISTS (
      SELECT 1 FROM "outcome_gate_decision" decision
       WHERE decision."decision_id"=NEW."player_gate3_decision_id"
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(
           decision."decision_json"->'content'->'affectedArtifacts') artifact
           WHERE artifact->>'kind'='model_run'
             AND artifact->>'artifactId'=qualification."player_run_id")
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(
           decision."decision_json"->'content'->'affectedArtifacts') artifact
           WHERE artifact->>'kind'='model_qualification'
             AND artifact->>'artifactId'=qualification."qualification_id")
    )
    OR NOT EXISTS (
      SELECT 1 FROM "outcome_gate_decision" decision
       WHERE decision."decision_id"=NEW."pick_gate3_decision_id"
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(
           decision."decision_json"->'content'->'affectedArtifacts') artifact
           WHERE artifact->>'kind'='model_run'
             AND artifact->>'artifactId'=qualification."pick_run_id")
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(
           decision."decision_json"->'content'->'affectedArtifacts') artifact
           WHERE artifact->>'kind'='model_qualification'
             AND artifact->>'artifactId'=qualification."qualification_id")
    )
  THEN RAISE EXCEPTION 'Governed model qualification work contract mismatch';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_governed_model_qualification_work_validate"
BEFORE INSERT OR UPDATE ON "outcome_governed_model_qualification_work"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_governed_model_qualification_work"();

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
    OR work."available_at" IS DISTINCT FROM target_advanced_at
    OR work."work_json"->'content'->>'scopeKey' IS DISTINCT FROM target_scope_key
    OR work."work_json"->'content'->>'qualificationId' IS DISTINCT FROM qualification."qualification_id"
    OR work."work_json"->'content'->>'playerRunId' IS DISTINCT FROM qualification."player_run_id"
    OR work."work_json"->'content'->>'pickRunId' IS DISTINCT FROM qualification."pick_run_id"
    OR work."work_json"->'content'->>'playerGate3DecisionId' IS DISTINCT FROM player_decision."decision_id"
    OR work."work_json"->'content'->>'pickGate3DecisionId' IS DISTINCT FROM pick_decision."decision_id"
    OR (work."work_json"->'content'->>'availableAt')::TIMESTAMPTZ IS DISTINCT FROM target_advanced_at
    OR work."player_gate3_decision_id"<>player_decision."decision_id"
    OR work."pick_gate3_decision_id"<>pick_decision."decision_id"
    OR player_decision."state"<>'approved' OR pick_decision."state"<>'approved'
    OR player_decision."gate"<>'gate_3_model_validity'
    OR pick_decision."gate"<>'gate_3_model_validity'
    OR player_decision."environment"<>'non_production'::"OutcomeEnvironment"
    OR pick_decision."environment"<>'non_production'::"OutcomeEnvironment"
    OR player_decision."decision_json"->'content'->'scope'->>'scopeKey' IS DISTINCT FROM target_scope_key
    OR pick_decision."decision_json"->'content'->'scope'->>'scopeKey' IS DISTINCT FROM target_scope_key
    OR player_decision."decision_json"->'content'->>'authorityKind'<>'automated_validation_record'
    OR pick_decision."decision_json"->'content'->>'authorityKind'<>'automated_validation_record'
    OR NOT (player_decision."decision_json"->'content'->'authorityEvidenceIds' ? qualification."artifact_id")
    OR NOT (pick_decision."decision_json"->'content'->'authorityEvidenceIds' ? qualification."artifact_id")
    OR target_advanced_at<qualification."evaluated_at"
    OR target_advanced_at<player_decision."effective_at"
    OR target_advanced_at<pick_decision."effective_at"
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
