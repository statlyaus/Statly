-- Private, durable model-execution authority. This migration creates no public
-- grade/publication pointer and no fantasy user, league, roster or ownership relation.

ALTER TABLE "outcome_operational_principal_authority"
  DROP CONSTRAINT "outcome_operational_authority_shape_check";
ALTER TABLE "outcome_operational_principal_authority"
  ADD CONSTRAINT "outcome_operational_authority_shape_check" CHECK (
    "authority_evidence_id" ~ '^reviewer-authority-evidence:[a-f0-9]{64}$'
    AND "role" IN ('afl_trade_identity_reviewer','afl_trade_model_run_operator')
    AND "competition" IN ('AFLM','AFLW')
    AND "valid_from_season" BETWEEN 1897 AND 2200
    AND "valid_through_season" BETWEEN "valid_from_season" AND 2200
    AND ("valid_through" IS NULL OR "valid_through">="valid_from")
    AND (
      ("role"='afl_trade_identity_reviewer'
        AND "scope_key"='public-afl-draft-trade-outcomes')
      OR
      ("role"='afl_trade_model_run_operator'
        AND "provider"='statly_modeling' AND "capability_id"='execute_model_run')
    )
  );

CREATE TABLE "outcome_valuation_model_protocol" (
  "protocol_id" TEXT PRIMARY KEY,
  "environment" "OutcomeEnvironment" NOT NULL,
  "dataset_id" TEXT NOT NULL,
  "admission_id" TEXT NOT NULL,
  "analytical_authority_receipt_id" TEXT NOT NULL,
  "prepared_at" TIMESTAMPTZ(3) NOT NULL,
  "protocol_canonical_json" TEXT NOT NULL,
  "protocol_json" JSONB NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "registered_by" TEXT NOT NULL DEFAULT current_user,
  CONSTRAINT "outcome_valuation_model_protocol_dataset_fkey"
    FOREIGN KEY ("dataset_id") REFERENCES "outcome_valuation_dataset_candidate"("dataset_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_model_protocol_admission_fkey"
    FOREIGN KEY ("admission_id") REFERENCES "outcome_valuation_dataset_admission"("admission_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_model_protocol_authority_fkey"
    FOREIGN KEY ("analytical_authority_receipt_id")
    REFERENCES "outcome_valuation_dataset_operation_authority"("receipt_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_model_protocol_ancestry_key"
    UNIQUE ("dataset_id","admission_id","protocol_id"),
  CONSTRAINT "outcome_valuation_model_protocol_id_check"
    CHECK ("protocol_id" ~ '^model-protocol:[a-f0-9]{64}$'
      AND "analytical_authority_receipt_id"
        ~ '^architecture-operation-receipt:[a-f0-9]{64}$')
);

CREATE INDEX "outcome_valuation_model_protocol_scope_idx"
  ON "outcome_valuation_model_protocol"("environment","dataset_id","prepared_at");

CREATE TABLE "outcome_valuation_player_observation_set" (
  "observation_set_id" TEXT PRIMARY KEY,
  "environment" "OutcomeEnvironment" NOT NULL,
  "dataset_id" TEXT NOT NULL,
  "admission_id" TEXT NOT NULL,
  "protocol_id" TEXT NOT NULL,
  "dataset_row_set_sha256" CHAR(64) NOT NULL,
  "observation_count" INTEGER NOT NULL,
  "observation_canonical_json" TEXT NOT NULL,
  "observation_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "outcome_valuation_player_observation_set_dataset_fkey"
    FOREIGN KEY ("dataset_id") REFERENCES "outcome_valuation_dataset_candidate"("dataset_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_player_observation_set_admission_fkey"
    FOREIGN KEY ("admission_id") REFERENCES "outcome_valuation_dataset_admission"("admission_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_player_observation_set_protocol_fkey"
    FOREIGN KEY ("protocol_id") REFERENCES "outcome_valuation_model_protocol"("protocol_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_observation_set_ancestry_key"
    UNIQUE ("dataset_id","admission_id","protocol_id","observation_set_id"),
  CONSTRAINT "outcome_valuation_player_observation_set_shape_check"
    CHECK ("observation_set_id" ~ '^player-observation-set:[a-f0-9]{64}$'
      AND "dataset_row_set_sha256" ~ '^[a-f0-9]{64}$'
      AND "observation_count">0 AND "observation_count"<=100000)
);

CREATE INDEX "outcome_valuation_observation_set_scope_idx"
  ON "outcome_valuation_player_observation_set"("environment","dataset_id","created_at");

CREATE TABLE "outcome_valuation_model_run_intent" (
  "intent_id" TEXT PRIMARY KEY,
  "environment" "OutcomeEnvironment" NOT NULL,
  "dataset_id" TEXT NOT NULL,
  "admission_id" TEXT NOT NULL,
  "protocol_id" TEXT NOT NULL,
  "observation_set_id" TEXT NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "intent_canonical_json" TEXT NOT NULL,
  "intent_json" JSONB NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "registered_by" TEXT NOT NULL DEFAULT current_user,
  CONSTRAINT "outcome_valuation_model_run_intent_dataset_fkey"
    FOREIGN KEY ("dataset_id") REFERENCES "outcome_valuation_dataset_candidate"("dataset_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_model_run_intent_admission_fkey"
    FOREIGN KEY ("admission_id") REFERENCES "outcome_valuation_dataset_admission"("admission_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_model_run_intent_protocol_fkey"
    FOREIGN KEY ("protocol_id") REFERENCES "outcome_valuation_model_protocol"("protocol_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_model_run_intent_observation_fkey"
    FOREIGN KEY ("observation_set_id")
    REFERENCES "outcome_valuation_player_observation_set"("observation_set_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_model_run_intent_ancestry_key"
    UNIQUE ("dataset_id","admission_id","protocol_id","observation_set_id","intent_id"),
  CONSTRAINT "outcome_valuation_model_run_intent_id_check"
    CHECK ("intent_id" ~ '^model-run-intent:[a-f0-9]{64}$')
);

CREATE INDEX "outcome_valuation_model_run_intent_scope_idx"
  ON "outcome_valuation_model_run_intent"("environment","dataset_id","started_at");

CREATE TABLE "outcome_valuation_model_run_operational_authorization" (
  "receipt_id" TEXT PRIMARY KEY,
  "intent_id" TEXT NOT NULL UNIQUE,
  "environment" "OutcomeEnvironment" NOT NULL,
  "dataset_id" TEXT NOT NULL,
  "admission_id" TEXT NOT NULL,
  "protocol_id" TEXT NOT NULL,
  "observation_set_id" TEXT NOT NULL,
  "authorized_at" TIMESTAMPTZ(3) NOT NULL,
  "valid_through" TIMESTAMPTZ(3) NOT NULL,
  "principal_ref" TEXT NOT NULL,
  "authority_evidence_id" TEXT NOT NULL,
  "receipt_canonical_json" TEXT NOT NULL,
  "receipt_json" JSONB NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  "registered_by" TEXT NOT NULL DEFAULT current_user,
  CONSTRAINT "outcome_valuation_model_run_operation_intent_fkey"
    FOREIGN KEY ("intent_id") REFERENCES "outcome_valuation_model_run_intent"("intent_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_model_run_operation_dataset_fkey"
    FOREIGN KEY ("dataset_id") REFERENCES "outcome_valuation_dataset_candidate"("dataset_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_model_run_operation_admission_fkey"
    FOREIGN KEY ("admission_id") REFERENCES "outcome_valuation_dataset_admission"("admission_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_model_run_operation_protocol_fkey"
    FOREIGN KEY ("protocol_id") REFERENCES "outcome_valuation_model_protocol"("protocol_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_model_run_operation_observation_fkey"
    FOREIGN KEY ("observation_set_id")
    REFERENCES "outcome_valuation_player_observation_set"("observation_set_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_model_run_operation_authority_fkey"
    FOREIGN KEY ("authority_evidence_id")
    REFERENCES "outcome_operational_principal_authority"("authority_evidence_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_model_run_operation_ancestry_key"
    UNIQUE ("dataset_id","admission_id","protocol_id","observation_set_id","intent_id"),
  CONSTRAINT "outcome_valuation_model_run_operation_shape_check"
    CHECK ("receipt_id" ~ '^architecture-operation-receipt:[a-f0-9]{64}$'
      AND "valid_through">"authorized_at")
);

CREATE INDEX "outcome_valuation_model_run_operation_validity_idx"
  ON "outcome_valuation_model_run_operational_authorization"("environment","valid_through");
CREATE INDEX "outcome_valuation_model_run_operation_authority_idx"
  ON "outcome_valuation_model_run_operational_authorization"
    ("authority_evidence_id","valid_through");

CREATE TABLE "outcome_valuation_model_run_authorization" (
  "authorization_id" TEXT PRIMARY KEY,
  "intent_id" TEXT NOT NULL UNIQUE,
  "operational_authorization_receipt_id" TEXT NOT NULL UNIQUE,
  "gate_ledger_revision" INTEGER NOT NULL,
  "authorized_at" TIMESTAMPTZ(3) NOT NULL,
  "valid_through" TIMESTAMPTZ(3) NOT NULL,
  "consumed_at" TIMESTAMPTZ(3),
  "authorization_canonical_json" TEXT NOT NULL,
  "authorization_json" JSONB NOT NULL,
  CONSTRAINT "outcome_valuation_model_run_authorization_intent_fkey"
    FOREIGN KEY ("intent_id") REFERENCES "outcome_valuation_model_run_intent"("intent_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_model_run_authorization_operation_fkey"
    FOREIGN KEY ("operational_authorization_receipt_id")
    REFERENCES "outcome_valuation_model_run_operational_authorization"("receipt_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_model_run_authorization_shape_check"
    CHECK ("authorization_id" ~ '^model-run-authorization:[a-f0-9]{64}$'
      AND "gate_ledger_revision">=0
      AND "valid_through">"authorized_at"
      AND "valid_through"<="authorized_at"+INTERVAL '30 seconds'
      AND ("consumed_at" IS NULL OR
        ("consumed_at">="authorized_at" AND "consumed_at"<"valid_through")))
);

CREATE INDEX "outcome_valuation_model_run_authorization_availability_idx"
  ON "outcome_valuation_model_run_authorization"("valid_through","consumed_at");

CREATE TABLE "outcome_valuation_model_run" (
  "run_id" TEXT PRIMARY KEY,
  "intent_id" TEXT NOT NULL UNIQUE,
  "authorization_id" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "finished_at" TIMESTAMPTZ(3) NOT NULL,
  "run_canonical_json" TEXT NOT NULL,
  "run_json" JSONB NOT NULL,
  CONSTRAINT "outcome_valuation_model_run_intent_fkey"
    FOREIGN KEY ("intent_id") REFERENCES "outcome_valuation_model_run_intent"("intent_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_model_run_authorization_fkey"
    FOREIGN KEY ("authorization_id")
    REFERENCES "outcome_valuation_model_run_authorization"("authorization_id")
    ON DELETE RESTRICT,
  CONSTRAINT "outcome_valuation_model_run_shape_check"
    CHECK ("run_id" ~ '^model-run:[a-f0-9]{64}$'
      AND "status" IN ('succeeded','failed','cancelled')
      AND "finished_at">="started_at")
);

CREATE INDEX "outcome_valuation_model_run_status_idx"
  ON "outcome_valuation_model_run"("status","finished_at");

CREATE FUNCTION "validate_outcome_valuation_model_protocol_insert"() RETURNS TRIGGER AS $$
DECLARE dataset_row RECORD; admission_row RECORD; authority_row RECORD;
BEGIN
  IF NEW."protocol_id" <> 'model-protocol:' ||
       encode(sha256(convert_to(NEW."protocol_canonical_json",'UTF8')),'hex') THEN
    RAISE EXCEPTION 'Model protocol identity mismatch';
  END IF;
  SELECT * INTO dataset_row FROM "outcome_valuation_dataset_candidate"
   WHERE "dataset_id"=NEW."dataset_id" FOR SHARE;
  SELECT * INTO admission_row FROM "outcome_valuation_dataset_admission"
   WHERE "admission_id"=NEW."admission_id" FOR SHARE;
  SELECT * INTO authority_row FROM "outcome_valuation_dataset_operation_authority"
   WHERE "receipt_id"=NEW."analytical_authority_receipt_id" FOR SHARE;
  IF dataset_row."status"<>'finalized' OR admission_row."status"<>'finalized' OR
     admission_row."dataset_id"<>NEW."dataset_id" OR
     dataset_row."environment"<>NEW."environment" OR
     admission_row."environment"<>NEW."environment" OR
     authority_row."authority_kind"<>'analytical_authority' OR
     authority_row."dataset_id"<>NEW."dataset_id" OR
     authority_row."authorized_at">NEW."prepared_at" OR
     authority_row."valid_through"<=clock_timestamp() OR
     NEW."prepared_at"<admission_row."admitted_at" OR NEW."prepared_at">clock_timestamp() OR
     NEW."protocol_json"->>'protocolId'<>NEW."protocol_id" OR
     NEW."protocol_json"->'content'->>'datasetId'<>NEW."dataset_id" OR
     NEW."protocol_json"->'content'->'datasetAdmission'->>'admissionId'<>NEW."admission_id" OR
     (NEW."protocol_json"->'content'->>'environment')::"OutcomeEnvironment"<>NEW."environment" THEN
    RAISE EXCEPTION 'Model protocol authority or ancestry mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_valuation_model_protocol_insert_guard"
  BEFORE INSERT ON "outcome_valuation_model_protocol"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_valuation_model_protocol_insert"();

CREATE FUNCTION "validate_outcome_valuation_observation_set_insert"() RETURNS TRIGGER AS $$
DECLARE dataset_row RECORD; admission_row RECORD; protocol_row RECORD;
BEGIN
  IF NEW."observation_set_id" <> 'player-observation-set:' ||
       encode(sha256(convert_to(NEW."observation_canonical_json",'UTF8')),'hex') THEN
    RAISE EXCEPTION 'Player observation-set identity mismatch';
  END IF;
  SELECT * INTO dataset_row FROM "outcome_valuation_dataset_candidate"
   WHERE "dataset_id"=NEW."dataset_id" FOR SHARE;
  SELECT * INTO admission_row FROM "outcome_valuation_dataset_admission"
   WHERE "admission_id"=NEW."admission_id" FOR SHARE;
  SELECT * INTO protocol_row FROM "outcome_valuation_model_protocol"
   WHERE "protocol_id"=NEW."protocol_id" FOR SHARE;
  IF dataset_row."status"<>'finalized' OR admission_row."status"<>'finalized' OR
     admission_row."dataset_id"<>NEW."dataset_id" OR
     protocol_row."dataset_id"<>NEW."dataset_id" OR
     protocol_row."admission_id"<>NEW."admission_id" OR
     dataset_row."environment"<>NEW."environment" OR
     NEW."dataset_row_set_sha256"<>dataset_row."row_set_sha256" OR
     NEW."observation_count"<>dataset_row."row_count" OR
     NEW."observation_count"<>jsonb_array_length(NEW."observation_json"->'content'->'observations') OR
     NEW."observation_json"->>'observationSetId'<>NEW."observation_set_id" OR
     NEW."observation_json"->'content'->>'datasetId'<>NEW."dataset_id" OR
     NEW."observation_json"->'content'->>'datasetAdmissionId'<>NEW."admission_id" OR
     NEW."observation_json"->'content'->>'modelProtocolId'<>NEW."protocol_id" OR
     NEW."observation_json"->'content'->>'datasetRowSetSha256'<>NEW."dataset_row_set_sha256" THEN
    RAISE EXCEPTION 'Player observation-set ancestry mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_valuation_observation_set_insert_guard"
  BEFORE INSERT ON "outcome_valuation_player_observation_set"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_valuation_observation_set_insert"();

CREATE FUNCTION "validate_outcome_valuation_model_intent_insert"() RETURNS TRIGGER AS $$
DECLARE protocol_row RECORD; observation_row RECORD;
BEGIN
  IF NEW."intent_id" <> 'model-run-intent:' ||
       encode(sha256(convert_to(NEW."intent_canonical_json",'UTF8')),'hex') THEN
    RAISE EXCEPTION 'Model-run intent identity mismatch';
  END IF;
  SELECT * INTO protocol_row FROM "outcome_valuation_model_protocol"
   WHERE "protocol_id"=NEW."protocol_id" FOR SHARE;
  SELECT * INTO observation_row FROM "outcome_valuation_player_observation_set"
   WHERE "observation_set_id"=NEW."observation_set_id" FOR SHARE;
  IF protocol_row."dataset_id"<>NEW."dataset_id" OR
     protocol_row."admission_id"<>NEW."admission_id" OR
     observation_row."dataset_id"<>NEW."dataset_id" OR
     observation_row."admission_id"<>NEW."admission_id" OR
     observation_row."protocol_id"<>NEW."protocol_id" OR
     NEW."environment"<>protocol_row."environment" OR
     NEW."intent_json"->>'intentId'<>NEW."intent_id" OR
     NEW."intent_json"->'content'->>'schemaVersion'<>
       'afl-trade-model-run-intent/v1' OR
     NEW."intent_json"->'content'->>'authorityBoundary'<>
       'pre_execution_model_intent_no_fit_grade_publication_or_fantasy_ownership' OR
     NEW."intent_json"->'content'->>'publicationEligible'<>'false' OR
     NEW."intent_json"->'content'->>'datasetId'<>NEW."dataset_id" OR
     NEW."intent_json"->'content'->>'datasetAdmissionId'<>NEW."admission_id" OR
     NEW."intent_json"->'content'->>'modelProtocolId'<>NEW."protocol_id" OR
     NEW."intent_json"->'content'->>'observationSetId'<>NEW."observation_set_id" OR
     (NEW."intent_json"->'content'->>'environment')::"OutcomeEnvironment"<>NEW."environment" OR
     (NEW."intent_json"->'content'->>'startedAt')::TIMESTAMPTZ<>NEW."started_at" OR
     NEW."intent_json"->'content'->>'modelId' IS NULL OR
     NEW."intent_json"->'content'->>'modelVersion' IS NULL OR
     NEW."intent_json"->'content'->>'codeCommitSha' IS NULL OR
     NEW."intent_json"->'content'->>'codeCommitSha' !~ '^[a-f0-9]{40}([a-f0-9]{24})?$' OR
     NEW."intent_json"->'content'->'cleanWorktree' IS DISTINCT FROM 'true'::JSONB OR
     jsonb_typeof(NEW."intent_json"->'content'->'seed') IS DISTINCT FROM 'number' OR
     jsonb_typeof(NEW."intent_json"->'content'->'job') IS DISTINCT FROM 'object' OR
     jsonb_typeof(NEW."intent_json"->'content'->'windows') IS DISTINCT FROM 'object' OR
     jsonb_typeof(NEW."intent_json"->'content'->'sourceCodeArtifact') IS DISTINCT FROM 'object' OR
     jsonb_typeof(NEW."intent_json"->'content'->'dependencyLockArtifact') IS DISTINCT FROM 'object' OR
     jsonb_typeof(NEW."intent_json"->'content'->'runtimeArtifact') IS DISTINCT FROM 'object' OR
     jsonb_typeof(NEW."intent_json"->'content'->'containerArtifact') IS DISTINCT FROM 'object' OR
     jsonb_typeof(NEW."intent_json"->'content'->'configurationArtifact') IS DISTINCT FROM 'object' OR
     jsonb_typeof(NEW."intent_json"->'content'->'environmentArtifact') IS DISTINCT FROM 'object' OR
     jsonb_typeof(NEW."intent_json"->'content'->'featureDefinitionArtifacts') IS DISTINCT FROM
       'array' OR
     jsonb_array_length(NEW."intent_json"->'content'->'featureDefinitionArtifacts')<1 OR
     jsonb_typeof(NEW."intent_json"->'content'->'modelTrainingEvaluationReceiptIds') IS DISTINCT
       FROM 'array' OR
     jsonb_array_length(
       NEW."intent_json"->'content'->'modelTrainingEvaluationReceiptIds')<1 THEN
    RAISE EXCEPTION 'Model-run intent ancestry mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_valuation_model_intent_insert_guard"
  BEFORE INSERT ON "outcome_valuation_model_run_intent"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_valuation_model_intent_insert"();

CREATE FUNCTION "validate_outcome_valuation_model_run_operation_insert"() RETURNS TRIGGER AS $$
DECLARE
  intent_row RECORD;
  dataset_row RECORD;
  authority_row RECORD;
  content JSONB;
  trusted_now TIMESTAMPTZ(3):=clock_timestamp();
BEGIN
  SELECT * INTO intent_row FROM "outcome_valuation_model_run_intent"
   WHERE "intent_id"=NEW."intent_id" FOR SHARE;
  SELECT * INTO dataset_row FROM "outcome_valuation_dataset_candidate"
   WHERE "dataset_id"=NEW."dataset_id" FOR SHARE;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-review-subject:governed_evidence_reference:' || NEW."authority_evidence_id", 0
  ));
  SELECT operational.*,evidence."environment" AS evidence_environment,
         evidence."reference_sha256",evidence."approval_decision_id",
         evidence."evidence_json"
    INTO authority_row
    FROM "outcome_operational_principal_authority" operational
    JOIN "outcome_governed_evidence_reference" evidence
      ON evidence."reference_id"=operational."authority_evidence_id"
   WHERE operational."authority_evidence_id"=NEW."authority_evidence_id" FOR SHARE;
  content:=NEW."receipt_json"->'content';
  IF NEW."receipt_id" <> 'architecture-operation-receipt:' ||
       encode(sha256(convert_to(NEW."receipt_canonical_json",'UTF8')),'hex') OR
     intent_row."intent_id" IS NULL OR dataset_row."dataset_id" IS NULL OR
     NEW."environment"<>intent_row."environment" OR
     NEW."dataset_id"<>intent_row."dataset_id" OR
     NEW."admission_id"<>intent_row."admission_id" OR
     NEW."protocol_id"<>intent_row."protocol_id" OR
     NEW."observation_set_id"<>intent_row."observation_set_id" OR
     NEW."authorized_at">intent_row."started_at" OR
     NEW."authorized_at">trusted_now OR NEW."valid_through"<=trusted_now OR
     authority_row."authority_evidence_id" IS NULL OR
     authority_row."principal_ref"<>NEW."principal_ref" OR
     authority_row."role"<>'afl_trade_model_run_operator' OR
     authority_row."scope_key"<>dataset_row."scope_key" OR
     authority_row."provider"<>'statly_modeling' OR
     authority_row."capability_id"<>'execute_model_run' OR
     authority_row."competition"<>dataset_row."competition" OR
     authority_row."evidence_environment"<>NEW."environment" OR
     (authority_row."evidence_json"->>'validFrom')::TIMESTAMPTZ IS DISTINCT FROM
       authority_row."valid_from" OR
     (authority_row."evidence_json"->>'validThrough')::TIMESTAMPTZ IS DISTINCT FROM
       authority_row."valid_through" OR
     authority_row."valid_from">trusted_now OR
     (authority_row."valid_through" IS NOT NULL AND
       authority_row."valid_through"<=trusted_now) OR
     (authority_row."valid_through" IS NOT NULL AND
       NEW."valid_through">authority_row."valid_through") OR
     EXISTS (SELECT 1 FROM "outcome_valuation_dataset_row" dataset_member
       WHERE dataset_member."dataset_id"=NEW."dataset_id"
         AND dataset_member."season_year" NOT BETWEEN
           authority_row."valid_from_season" AND authority_row."valid_through_season") OR
     EXISTS (SELECT 1 FROM "outcome_review_decision" successor
       WHERE successor."supersedes_decision_id"=authority_row."approval_decision_id") OR
     NEW."receipt_json"->>'receiptId'<>NEW."receipt_id" OR
     content->>'schemaVersion'<>'afl-trade-model-run-operational-authorization/v1' OR
     content->>'operation'<>'execute_model_run' OR
     content->>'authorityBoundary'<>
       'human_operational_authorization_for_one_exact_model_run_intent' OR
     content->'publicationEligible' IS DISTINCT FROM 'false'::JSONB OR
     content->>'environment' IS DISTINCT FROM NEW."environment"::TEXT OR
     content->>'runIntentId'<>NEW."intent_id" OR
     content->>'datasetId'<>NEW."dataset_id" OR
     content->>'datasetAdmissionId'<>NEW."admission_id" OR
     content->>'modelProtocolId'<>NEW."protocol_id" OR
     content->>'observationSetId'<>NEW."observation_set_id" OR
     (content->>'authorizedAt')::TIMESTAMPTZ<>NEW."authorized_at" OR
     (content->>'validThrough')::TIMESTAMPTZ<>NEW."valid_through" OR
     content->>'principalRef'<>NEW."principal_ref" OR
     content->>'role'<>'afl_trade_model_run_operator' OR
     content->'authorityEvidence'->>'id'<>NEW."authority_evidence_id" OR
     content->'authorityEvidence'->>'sha256'<>authority_row."reference_sha256" OR
     (NEW."environment"<>'test_fixture' AND
       current_user<>'afl_trade_operational_authorization_registry_writer') THEN
    RAISE EXCEPTION 'Model-run operational authorization is invalid or misbound';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_valuation_model_run_operation_insert_guard"
  BEFORE INSERT ON "outcome_valuation_model_run_operational_authorization"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_valuation_model_run_operation_insert"();

CREATE FUNCTION "validate_outcome_valuation_model_authorization_insert"() RETURNS TRIGGER AS $$
DECLARE
  intent_row RECORD;
  observation_row RECORD;
  protocol_row RECORD;
  analytical_authority RECORD;
  operational_authority RECORD;
  operator_trust RECORD;
  admission_row RECORD;
  dataset_row RECORD;
  admission_gate2 RECORD;
  gate2 RECORD;
  trusted_now TIMESTAMPTZ(3):=clock_timestamp();
  current_revision INTEGER;
  requested_receipt_count INTEGER;
  current_receipt_count INTEGER;
  required_proposal_count INTEGER;
  covered_proposal_count INTEGER;
BEGIN
  SELECT * INTO intent_row FROM "outcome_valuation_model_run_intent"
   WHERE "intent_id"=NEW."intent_id" FOR SHARE;
  SELECT * INTO observation_row FROM "outcome_valuation_player_observation_set"
   WHERE "observation_set_id"=intent_row."observation_set_id" FOR SHARE;
  SELECT * INTO protocol_row FROM "outcome_valuation_model_protocol"
   WHERE "protocol_id"=intent_row."protocol_id" FOR SHARE;
  SELECT * INTO analytical_authority FROM "outcome_valuation_dataset_operation_authority"
   WHERE "receipt_id"=protocol_row."analytical_authority_receipt_id" FOR SHARE;
  SELECT * INTO operational_authority
    FROM "outcome_valuation_model_run_operational_authorization"
   WHERE "receipt_id"=NEW."operational_authorization_receipt_id" FOR SHARE;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'outcome-review-subject:governed_evidence_reference:' ||
      operational_authority."authority_evidence_id", 0
  ));
  SELECT operational.*,evidence."environment" AS evidence_environment,
         evidence."reference_sha256",evidence."approval_decision_id",
         evidence."evidence_json"
    INTO operator_trust
    FROM "outcome_operational_principal_authority" operational
    JOIN "outcome_governed_evidence_reference" evidence
      ON evidence."reference_id"=operational."authority_evidence_id"
   WHERE operational."authority_evidence_id"=operational_authority."authority_evidence_id"
   FOR SHARE;
  SELECT * INTO admission_row FROM "outcome_valuation_dataset_admission"
   WHERE "admission_id"=intent_row."admission_id" FOR SHARE;
  SELECT * INTO dataset_row FROM "outcome_valuation_dataset_candidate"
   WHERE "dataset_id"=intent_row."dataset_id" FOR SHARE;
  SELECT decision.* INTO admission_gate2
    FROM "outcome_valuation_dataset_admission" admission
    JOIN "outcome_gate_decision" decision ON decision."decision_id"=admission."gate2_decision_id"
   WHERE admission."admission_id"=intent_row."admission_id" FOR SHARE OF admission,decision;
  SELECT "revision" INTO current_revision FROM "outcome_gate_ledger_head"
   WHERE "singleton_id"=1 FOR SHARE;
  SELECT * INTO gate2 FROM "outcome_gate_decision"
   WHERE "decision_id"=NEW."authorization_json"->'content'->>'gate2DecisionId' FOR SHARE;
  SELECT jsonb_array_length(
    NEW."authorization_json"->'content'->'modelTrainingEvaluationReceiptIds'
  ) INTO requested_receipt_count;
  SELECT count(*) INTO current_receipt_count
    FROM jsonb_array_elements_text(
      NEW."authorization_json"->'content'->'modelTrainingEvaluationReceiptIds'
    ) requested("receipt_id")
    JOIN "outcome_valuation_dataset_gate0_evaluation" receipt
      ON receipt."receipt_id"=requested."receipt_id"
    JOIN "outcome_gate_decision" decision ON decision."decision_id"=receipt."decision_id"
    JOIN "outcome_source_rights_proposal" rights
      ON rights."rights_artifact_id"=receipt."rights_artifact_id"
    JOIN LATERAL jsonb_array_elements(
      admission_row."admission_json"->'content'->'sourceRightsEvaluations'
    ) required("evaluation")
      ON required."evaluation"->>'proposalId'=receipt."rights_artifact_id"
    JOIN "outcome_valuation_dataset_gate0_evaluation" admission_receipt
      ON admission_receipt."receipt_id"=
        required."evaluation"->>'admissionEvaluationReceiptId'
   WHERE receipt."environment"=intent_row."environment"
     AND receipt."operation_kind"='model_training'
     AND receipt."evaluated_at"=intent_row."started_at"
     AND receipt."recorded_at"=intent_row."started_at"
     AND decision."gate"='gate_0a_permission_to_evaluate'
     AND decision."state"='approved'
     AND decision."effective_at"<=trusted_now
     AND decision."revalidate_at">trusted_now
     AND NEW."valid_through"<=decision."revalidate_at"
     AND ((receipt."receipt_json"->'content'->'request') - 'evaluatedAt'::TEXT)
       IS NOT DISTINCT FROM
       ((admission_receipt."receipt_json"->'content'->'request') - 'evaluatedAt'::TEXT)
     AND receipt."receipt_json"->'content'->'request'->'operations' ? 'model_training'
     AND EXISTS (SELECT 1
       FROM jsonb_array_elements(
         receipt."receipt_json"->'content'->'request'->'fieldUses'
       ) field_use WHERE field_use->>'use'='model_training')
     AND NOT EXISTS (SELECT 1 FROM "outcome_gate_decision" successor
       WHERE successor."supersedes_decision_id"=decision."decision_id")
     AND (rights."content_json"->'content'->>'termsExpireAt' IS NULL OR
       ((rights."content_json"->'content'->>'termsExpireAt')::TIMESTAMPTZ>trusted_now AND
        NEW."valid_through"<=
          (rights."content_json"->'content'->>'termsExpireAt')::TIMESTAMPTZ));
  SELECT jsonb_array_length(
    admission_row."admission_json"->'content'->'sourceRightsEvaluations'
  ) INTO required_proposal_count;
  SELECT count(*) INTO covered_proposal_count
    FROM jsonb_array_elements(
      admission_row."admission_json"->'content'->'sourceRightsEvaluations'
    ) required("evaluation")
   WHERE EXISTS (
     SELECT 1
       FROM jsonb_array_elements_text(
         NEW."authorization_json"->'content'->'modelTrainingEvaluationReceiptIds'
       ) requested("receipt_id")
       JOIN "outcome_valuation_dataset_gate0_evaluation" receipt
         ON receipt."receipt_id"=requested."receipt_id"
      WHERE receipt."rights_artifact_id"=required."evaluation"->>'proposalId'
   );
  IF NEW."authorization_id" <> 'model-run-authorization:' ||
       encode(sha256(convert_to(NEW."authorization_canonical_json",'UTF8')),'hex') OR
     NEW."gate_ledger_revision"<>current_revision OR
     NEW."authorized_at">trusted_now OR trusted_now>=NEW."valid_through" OR
     trusted_now-intent_row."started_at">INTERVAL '5 seconds' OR
     trusted_now<intent_row."started_at" OR
     analytical_authority."authority_kind"<>'analytical_authority' OR
     analytical_authority."environment"<>intent_row."environment" OR
     analytical_authority."dataset_id"<>intent_row."dataset_id" OR
     analytical_authority."authorized_at">trusted_now OR
     analytical_authority."valid_through"<=trusted_now OR
     NEW."valid_through">analytical_authority."valid_through" OR
     operational_authority."receipt_id" IS NULL OR
     operational_authority."intent_id"<>intent_row."intent_id" OR
     operational_authority."environment"<>intent_row."environment" OR
     operational_authority."dataset_id"<>intent_row."dataset_id" OR
     operational_authority."admission_id"<>intent_row."admission_id" OR
     operational_authority."protocol_id"<>intent_row."protocol_id" OR
     operational_authority."observation_set_id"<>intent_row."observation_set_id" OR
     operational_authority."authorized_at">intent_row."started_at" OR
     operational_authority."authorized_at">trusted_now OR
     operational_authority."valid_through"<=trusted_now OR
     NEW."valid_through">operational_authority."valid_through" OR
     operator_trust."authority_evidence_id" IS NULL OR
     operator_trust."principal_ref"<>operational_authority."principal_ref" OR
     operator_trust."role"<>'afl_trade_model_run_operator' OR
     operator_trust."scope_key"<>dataset_row."scope_key" OR
     operator_trust."provider"<>'statly_modeling' OR
     operator_trust."capability_id"<>'execute_model_run' OR
     operator_trust."competition"<>dataset_row."competition" OR
     operator_trust."evidence_environment"<>intent_row."environment" OR
     operator_trust."valid_from">trusted_now OR
     (operator_trust."valid_through" IS NOT NULL AND
       operator_trust."valid_through"<=trusted_now) OR
     (operator_trust."valid_through" IS NOT NULL AND
       NEW."valid_through">operator_trust."valid_through") OR
     (operator_trust."evidence_json"->>'validFrom')::TIMESTAMPTZ IS DISTINCT FROM
       operator_trust."valid_from" OR
     (operator_trust."evidence_json"->>'validThrough')::TIMESTAMPTZ IS DISTINCT FROM
       operator_trust."valid_through" OR
     EXISTS (SELECT 1 FROM "outcome_valuation_dataset_row" dataset_member
       WHERE dataset_member."dataset_id"=intent_row."dataset_id"
         AND dataset_member."season_year" NOT BETWEEN
           operator_trust."valid_from_season" AND operator_trust."valid_through_season") OR
     EXISTS (SELECT 1 FROM "outcome_review_decision" successor
       WHERE successor."supersedes_decision_id"=operator_trust."approval_decision_id") OR
     gate2."gate"<>'gate_2_corpus_lineage' OR gate2."state"<>'approved' OR
     gate2."environment"<>intent_row."environment" OR
     gate2."decision_key"<>admission_gate2."decision_key" OR
     gate2."decision_json"->'content'->'scope'->>'scopeKey'<>dataset_row."scope_key" OR
     (SELECT count(*) FROM jsonb_array_elements(
       gate2."decision_json"->'content'->'scope'->'dimensions') dimension
       WHERE dimension->>'name'='scope'
         AND dimension->'values'=jsonb_build_array(dataset_row."scope_key"))<>1 OR
     (SELECT count(*) FROM jsonb_array_elements(
       gate2."decision_json"->'content'->'scope'->'dimensions') dimension
       WHERE dimension->>'name'='competition'
         AND dimension->'values'=jsonb_build_array(dataset_row."competition"))<>1 OR
     gate2."effective_at">trusted_now OR gate2."revalidate_at" IS NULL OR
     gate2."revalidate_at"<=trusted_now OR
     NEW."valid_through">gate2."revalidate_at" OR
     EXISTS (SELECT 1 FROM "outcome_gate_decision" successor
       WHERE successor."supersedes_decision_id"=gate2."decision_id") OR
     jsonb_array_length(gate2."decision_json"->'content'->'affectedArtifacts')<>4 OR
     NOT EXISTS (SELECT 1
       FROM jsonb_array_elements(gate2."decision_json"->'content'->'affectedArtifacts') artifact
      WHERE artifact->>'kind'='corpus_manifest'
        AND artifact->>'artifactId'=admission_row."admission_json"->'content'->>'corpusId') OR
     NOT EXISTS (SELECT 1
       FROM jsonb_array_elements(gate2."decision_json"->'content'->'affectedArtifacts') artifact
      WHERE artifact->>'kind'='corpus_factual_lineage'
        AND artifact->>'artifactId'=
          admission_row."admission_json"->'content'->>'corpusToCandidateLineageId') OR
     NOT EXISTS (SELECT 1
       FROM jsonb_array_elements(gate2."decision_json"->'content'->'affectedArtifacts') artifact
      WHERE artifact->>'kind'='factual_release'
        AND artifact->>'artifactId'=
          admission_row."admission_json"->'content'->>'factualReleaseId') OR
     NOT EXISTS (SELECT 1
       FROM jsonb_array_elements(gate2."decision_json"->'content'->'affectedArtifacts') artifact
      WHERE artifact->>'kind'='factual_release_candidate'
        AND artifact->>'artifactId'=
          admission_row."admission_json"->'content'->>'factualCandidateId') OR
     requested_receipt_count<1 OR requested_receipt_count<>current_receipt_count OR
     required_proposal_count<1 OR required_proposal_count<>covered_proposal_count OR
     required_proposal_count<>requested_receipt_count OR
     EXISTS (
       SELECT 1
         FROM jsonb_array_elements_text(
           NEW."authorization_json"->'content'->'modelTrainingEvaluationReceiptIds'
         ) requested("receipt_id")
         JOIN "outcome_valuation_dataset_gate0_evaluation" receipt
           ON receipt."receipt_id"=requested."receipt_id"
        WHERE NOT EXISTS (
          SELECT 1
            FROM jsonb_array_elements(
              admission_row."admission_json"->'content'->'sourceRightsEvaluations'
            ) required("evaluation")
           WHERE required."evaluation"->>'proposalId'=receipt."rights_artifact_id"
        )
     ) OR
     NEW."authorization_json"->>'authorizationId'<>NEW."authorization_id" OR
     NEW."authorization_json"->'content'->>'schemaVersion'<>
       'afl-trade-model-run-authorization/v1' OR
     NEW."authorization_json"->'content'->>'authorityBoundary'<>
       'model_run_start_authority_no_grade_publication_or_fantasy_ownership' OR
     NEW."authorization_json"->'content'->>'publicationEligible'<>'false' OR
     NEW."authorization_json"->'content'->>'runIntentId'<>NEW."intent_id" OR
     (NEW."authorization_json"->'content'->>'gateLedgerRevision')::INTEGER<>
       NEW."gate_ledger_revision" OR
     NEW."authorization_json"->'content'->>'environment' IS DISTINCT FROM
       intent_row."environment"::TEXT OR
     NEW."authorization_json"->'content'->>'datasetId' IS DISTINCT FROM intent_row."dataset_id" OR
     NEW."authorization_json"->'content'->>'datasetAdmissionId' IS DISTINCT FROM
       intent_row."admission_id" OR
     NEW."authorization_json"->'content'->>'modelProtocolId' IS DISTINCT FROM
       intent_row."protocol_id" OR
     NEW."authorization_json"->'content'->>'observationSetId' IS DISTINCT FROM
       intent_row."observation_set_id" OR
     NEW."authorization_json"->'content'->>'operationalAuthorizationReceiptId' IS DISTINCT FROM
       operational_authority."receipt_id" OR
     NEW."authorization_json"->'content'->>'datasetRowSetSha256' IS DISTINCT FROM
       observation_row."dataset_row_set_sha256" OR
     NEW."authorization_json"->'content'->'modelTrainingEvaluationReceiptIds' IS DISTINCT FROM
       intent_row."intent_json"->'content'->'modelTrainingEvaluationReceiptIds' OR
     (NEW."authorization_json"->'content'->>'authorizedAt')::TIMESTAMPTZ<>NEW."authorized_at" OR
     (NEW."authorization_json"->'content'->>'validThrough')::TIMESTAMPTZ<>NEW."valid_through" THEN
    RAISE EXCEPTION 'Model-run authorization is invalid, stale, or misbound';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_valuation_model_authorization_insert_guard"
  BEFORE INSERT ON "outcome_valuation_model_run_authorization"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_valuation_model_authorization_insert"();

CREATE FUNCTION "consume_outcome_valuation_model_authorization"() RETURNS TRIGGER AS $$
DECLARE trusted_now TIMESTAMPTZ(3):=clock_timestamp();
BEGIN
  IF OLD."consumed_at" IS NOT NULL OR NEW."consumed_at" IS NULL OR
     (to_jsonb(NEW)-'consumed_at') IS DISTINCT FROM (to_jsonb(OLD)-'consumed_at') OR
     trusted_now<OLD."authorized_at" OR trusted_now>=OLD."valid_through" THEN
    RAISE EXCEPTION 'Model-run authorization is immutable, expired, or already consumed';
  END IF;
  NEW."consumed_at":=trusted_now;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_valuation_model_authorization_consume_guard"
  BEFORE UPDATE ON "outcome_valuation_model_run_authorization"
  FOR EACH ROW EXECUTE FUNCTION "consume_outcome_valuation_model_authorization"();

CREATE FUNCTION "validate_outcome_valuation_model_run_insert"() RETURNS TRIGGER AS $$
DECLARE authorization_row RECORD; intent_row RECORD; run_content JSONB; intent_content JSONB;
BEGIN
  SELECT * INTO authorization_row FROM "outcome_valuation_model_run_authorization"
   WHERE "authorization_id"=NEW."authorization_id" FOR SHARE;
  SELECT * INTO intent_row FROM "outcome_valuation_model_run_intent"
   WHERE "intent_id"=NEW."intent_id" FOR SHARE;
  run_content:=NEW."run_json"->'content';
  intent_content:=intent_row."intent_json"->'content';
  IF NEW."run_id" <> 'model-run:' || encode(sha256(convert_to(NEW."run_canonical_json",'UTF8')),'hex') OR
     authorization_row."intent_id"<>NEW."intent_id" OR authorization_row."consumed_at" IS NULL OR
     NEW."run_json"->>'runId'<>NEW."run_id" OR
     run_content->>'schemaVersion'<>'afl-trade-model-run/v3' OR
     run_content->>'runIntentId'<>NEW."intent_id" OR
     run_content->>'runAuthorizationId'<>NEW."authorization_id" OR
     run_content->'outcome'->>'status'<>NEW."status" OR
     (run_content->>'startedAt')::TIMESTAMPTZ<>NEW."started_at" OR
     run_content->>'startedAt'<>intent_content->>'startedAt' OR
     (run_content->>'finishedAt')::TIMESTAMPTZ<>NEW."finished_at" OR
     run_content->>'environment'<>intent_content->>'environment' OR
     run_content->>'modelId'<>intent_content->>'modelId' OR
     run_content->>'modelVersion'<>intent_content->>'modelVersion' OR
     run_content->>'datasetId'<>intent_content->>'datasetId' OR
     run_content->>'datasetAdmissionId'<>intent_content->>'datasetAdmissionId' OR
     run_content->>'modelProtocolId'<>intent_content->>'modelProtocolId' OR
     run_content->>'observationSetId'<>intent_content->>'observationSetId' OR
     run_content->>'codeCommitSha'<>intent_content->>'codeCommitSha' OR
     run_content->'cleanWorktree' IS DISTINCT FROM intent_content->'cleanWorktree' OR
     run_content->'seed' IS DISTINCT FROM intent_content->'seed' OR
     run_content->'job' IS DISTINCT FROM intent_content->'job' OR
     run_content->'windows' IS DISTINCT FROM intent_content->'windows' OR
     run_content->'sourceCodeArtifact' IS DISTINCT FROM intent_content->'sourceCodeArtifact' OR
     run_content->'dependencyLockArtifact' IS DISTINCT FROM intent_content->'dependencyLockArtifact' OR
     run_content->'runtimeArtifact' IS DISTINCT FROM intent_content->'runtimeArtifact' OR
     run_content->'containerArtifact' IS DISTINCT FROM intent_content->'containerArtifact' OR
     run_content->'configurationArtifact' IS DISTINCT FROM intent_content->'configurationArtifact' OR
     run_content->'environmentArtifact' IS DISTINCT FROM intent_content->'environmentArtifact' OR
     run_content->'featureDefinitionArtifacts' IS DISTINCT FROM
       intent_content->'featureDefinitionArtifacts' OR
     run_content->'modelTrainingEvaluationReceiptIds' IS DISTINCT FROM
       intent_content->'modelTrainingEvaluationReceiptIds' THEN
    RAISE EXCEPTION 'Completed model run does not match its consumed authorization';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_valuation_model_run_insert_guard"
  BEFORE INSERT ON "outcome_valuation_model_run"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_valuation_model_run_insert"();

CREATE TRIGGER "outcome_valuation_model_protocol_append_only"
  BEFORE UPDATE OR DELETE ON "outcome_valuation_model_protocol"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_valuation_dataset_mutation"();
CREATE TRIGGER "outcome_valuation_observation_set_append_only"
  BEFORE UPDATE OR DELETE ON "outcome_valuation_player_observation_set"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_valuation_dataset_mutation"();
CREATE TRIGGER "outcome_valuation_model_intent_append_only"
  BEFORE UPDATE OR DELETE ON "outcome_valuation_model_run_intent"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_valuation_dataset_mutation"();
CREATE TRIGGER "outcome_valuation_model_run_operation_append_only"
  BEFORE UPDATE OR DELETE ON "outcome_valuation_model_run_operational_authorization"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_valuation_dataset_mutation"();
CREATE TRIGGER "outcome_valuation_model_authorization_delete_guard"
  BEFORE DELETE ON "outcome_valuation_model_run_authorization"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_valuation_dataset_mutation"();
CREATE TRIGGER "outcome_valuation_model_run_append_only"
  BEFORE UPDATE OR DELETE ON "outcome_valuation_model_run"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_valuation_dataset_mutation"();
