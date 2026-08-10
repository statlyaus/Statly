CREATE TABLE "outcome_external_evidence_batch" (
  "batch_id" TEXT PRIMARY KEY,
  "capture_id" TEXT NOT NULL UNIQUE,
  "provider" TEXT NOT NULL,
  "evidence_count" INTEGER NOT NULL CHECK ("evidence_count" >= 0),
  "issue_count" INTEGER NOT NULL CHECK ("issue_count" >= 0),
  "row_set_sha256" CHAR(64) NOT NULL CHECK ("row_set_sha256" ~ '^[a-f0-9]{64}$'),
  "issue_set_sha256" CHAR(64) NOT NULL CHECK ("issue_set_sha256" ~ '^[a-f0-9]{64}$'),
  "status" TEXT NOT NULL CHECK ("status" IN ('open', 'finalized')),
  "finalized_at" TIMESTAMPTZ(3),
  "batch_json" JSONB NOT NULL,
  CONSTRAINT "outcome_external_evidence_batch_capture_fkey"
    FOREIGN KEY ("capture_id") REFERENCES "outcome_source_capture"("capture_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_external_evidence_batch_id_check"
    CHECK ("batch_id" ~ '^external-evidence-batch:[a-f0-9]{64}$'),
  CONSTRAINT "outcome_external_evidence_batch_finalization_check"
    CHECK (("status" = 'open' AND "finalized_at" IS NULL) OR
           ("status" = 'finalized' AND "finalized_at" IS NOT NULL))
);

CREATE INDEX "outcome_external_evidence_batch_provider_status_idx"
  ON "outcome_external_evidence_batch"("provider", "status", "finalized_at");

CREATE TABLE "outcome_external_evidence_row" (
  "evidence_id" TEXT PRIMARY KEY,
  "batch_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL CHECK ("ordinal" > 0),
  "source_key" TEXT NOT NULL,
  "claim_kind" TEXT NOT NULL CHECK ("claim_kind" IN (
    'transaction', 'transaction_party', 'directed_transfer', 'draft_selection',
    'pick_custody', 'player_draft_detail'
  )),
  "evidence_json" JSONB NOT NULL,
  CONSTRAINT "outcome_external_evidence_row_batch_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "outcome_external_evidence_batch"("batch_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_external_evidence_row_id_check"
    CHECK ("evidence_id" ~ '^external-evidence:[a-f0-9]{64}$'),
  CONSTRAINT "outcome_external_evidence_row_batch_ordinal_key" UNIQUE ("batch_id", "ordinal"),
  CONSTRAINT "outcome_external_evidence_row_batch_source_key" UNIQUE ("batch_id", "source_key")
);

CREATE INDEX "outcome_external_evidence_row_kind_batch_idx"
  ON "outcome_external_evidence_row"("claim_kind", "batch_id");

CREATE TABLE "outcome_external_evidence_issue" (
  "issue_id" TEXT PRIMARY KEY,
  "batch_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL CHECK ("ordinal" > 0),
  "code" TEXT NOT NULL,
  "source_key" TEXT NOT NULL,
  "detail" TEXT NOT NULL,
  "issue_json" JSONB NOT NULL,
  CONSTRAINT "outcome_external_evidence_issue_batch_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "outcome_external_evidence_batch"("batch_id") ON DELETE RESTRICT,
  CONSTRAINT "outcome_external_evidence_issue_id_check"
    CHECK ("issue_id" ~ '^external-evidence-issue:[a-f0-9]{64}$'),
  CONSTRAINT "outcome_external_evidence_issue_batch_ordinal_key" UNIQUE ("batch_id", "ordinal")
);

CREATE INDEX "outcome_external_evidence_issue_batch_code_idx"
  ON "outcome_external_evidence_issue"("batch_id", "code");

CREATE FUNCTION "validate_outcome_external_evidence_batch_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  capture_provider TEXT;
BEGIN
  IF NEW.status <> 'open' OR NEW.finalized_at IS NOT NULL THEN
    RAISE EXCEPTION 'External evidence batches must be inserted open';
  END IF;
  SELECT capture.provider INTO capture_provider
    FROM outcome_source_capture capture
   WHERE capture.capture_id = NEW.capture_id
   FOR SHARE;
  IF NOT FOUND OR capture_provider IS DISTINCT FROM NEW.provider THEN
    RAISE EXCEPTION 'External evidence batch provider/capture mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "outcome_external_evidence_batch_insert_guard"
BEFORE INSERT ON "outcome_external_evidence_batch"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_external_evidence_batch_insert"();

CREATE FUNCTION "finalize_outcome_external_evidence_batch"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  stored_evidence_count INTEGER;
  stored_issue_count INTEGER;
  capture_environment "OutcomeEnvironment";
  execution_schema_version TEXT;
  lease_expires_at TIMESTAMPTZ;
BEGIN
  IF OLD.status <> 'open' OR NEW.status <> 'finalized' OR
     NEW.finalized_at IS NULL OR NEW.batch_id <> OLD.batch_id OR
     NEW.capture_id <> OLD.capture_id OR NEW.provider <> OLD.provider OR
     NEW.evidence_count <> OLD.evidence_count OR NEW.issue_count <> OLD.issue_count OR
     NEW.row_set_sha256 <> OLD.row_set_sha256 OR NEW.issue_set_sha256 <> OLD.issue_set_sha256 OR
     NEW.batch_json <> OLD.batch_json THEN
    RAISE EXCEPTION 'External evidence batch update is not the exact finalization transition';
  END IF;
  SELECT count(*) INTO stored_evidence_count
    FROM outcome_external_evidence_row WHERE batch_id = NEW.batch_id;
  SELECT count(*) INTO stored_issue_count
    FROM outcome_external_evidence_issue WHERE batch_id = NEW.batch_id;
  IF stored_evidence_count <> NEW.evidence_count OR stored_issue_count <> NEW.issue_count THEN
    RAISE EXCEPTION 'External evidence batch child counts do not reconcile';
  END IF;
  SELECT capture.environment,
         capture.manifest_json->'executionReceipt'->'content'->>'schemaVersion',
         (capture.manifest_json->'executionReceipt'->'content'->'admission'->>'leaseExpiresAt')::timestamptz
    INTO capture_environment, execution_schema_version, lease_expires_at
    FROM outcome_source_capture capture
   WHERE capture.capture_id=NEW.capture_id
   FOR SHARE;
  IF NOT FOUND OR
     (capture_environment <> 'test_fixture'::"OutcomeEnvironment" AND
      (execution_schema_version <> 'afl-trade-external-capture-execution/v2' OR
       lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())) THEN
    RAISE EXCEPTION 'External evidence finalization requires the current unexpired execution lease';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "outcome_external_evidence_batch_finalization_guard"
BEFORE UPDATE ON "outcome_external_evidence_batch"
FOR EACH ROW EXECUTE FUNCTION "finalize_outcome_external_evidence_batch"();

CREATE FUNCTION "guard_outcome_external_evidence_child_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  parent_status TEXT;
BEGIN
  SELECT batch.status INTO parent_status
    FROM outcome_external_evidence_batch batch
   WHERE batch.batch_id = NEW.batch_id
   FOR SHARE;
  IF NOT FOUND OR parent_status <> 'open' THEN
    RAISE EXCEPTION 'External evidence children require an open parent batch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "outcome_external_evidence_row_insert_guard"
BEFORE INSERT ON "outcome_external_evidence_row"
FOR EACH ROW EXECUTE FUNCTION "guard_outcome_external_evidence_child_insert"();

CREATE TRIGGER "outcome_external_evidence_issue_insert_guard"
BEFORE INSERT ON "outcome_external_evidence_issue"
FOR EACH ROW EXECUTE FUNCTION "guard_outcome_external_evidence_child_insert"();

CREATE FUNCTION "reject_outcome_external_evidence_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'External evidence staging is append-only';
END;
$$;

CREATE TRIGGER "outcome_external_evidence_batch_delete_guard"
BEFORE DELETE ON "outcome_external_evidence_batch"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_external_evidence_mutation"();

CREATE TRIGGER "outcome_external_evidence_row_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_external_evidence_row"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_external_evidence_mutation"();

CREATE TRIGGER "outcome_external_evidence_issue_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_external_evidence_issue"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_external_evidence_mutation"();
