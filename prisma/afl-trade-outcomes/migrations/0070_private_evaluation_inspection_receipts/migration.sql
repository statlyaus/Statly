CREATE TABLE "outcome_private_evaluation_authority_snapshot" (
  "snapshot_id" TEXT PRIMARY KEY,
  "valuation_scope_key" TEXT NOT NULL,
  "trade_id" TEXT NOT NULL,
  "workbook_sha256" CHAR(64) NOT NULL CHECK ("workbook_sha256" ~ '^[a-f0-9]{64}$'),
  "captured_at" TIMESTAMPTZ(3) NOT NULL,
  "valid_through" TIMESTAMPTZ(3) NOT NULL,
  "expected_head_generation_id" TEXT NULL,
  "expected_head_revision" INTEGER NOT NULL CHECK ("expected_head_revision">=0),
  "expected_head_status" TEXT NOT NULL CHECK ("expected_head_status" IN ('absent','active','withdrawn')),
  "dependency_fingerprint" CHAR(64) NOT NULL CHECK ("dependency_fingerprint" ~ '^[a-f0-9]{64}$'),
  "snapshot_content_sha256" CHAR(64) NOT NULL CHECK ("snapshot_content_sha256" ~ '^[a-f0-9]{64}$'),
  "artifact_sha256" CHAR(64) NOT NULL CHECK ("artifact_sha256" ~ '^[a-f0-9]{64}$'),
  "publication_eligible" BOOLEAN NOT NULL DEFAULT FALSE CHECK ("publication_eligible"=FALSE),
  "publication_prohibited" BOOLEAN NOT NULL DEFAULT TRUE CHECK ("publication_prohibited"=TRUE),
  "snapshot_json" JSONB NOT NULL CHECK (jsonb_typeof("snapshot_json")='object'),
  "artifact_json" JSONB NOT NULL CHECK (jsonb_typeof("artifact_json")='object'),
  CONSTRAINT "outcome_private_evaluation_authority_snapshot_id_check"
    CHECK ("snapshot_id"='private-evaluation-authority-snapshot:' || "snapshot_content_sha256"),
  CONSTRAINT "outcome_private_eval_authority_snapshot_head_fkey"
    FOREIGN KEY ("expected_head_generation_id")
      REFERENCES "outcome_local_private_trade_evaluation_generation"("generation_id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outcome_private_evaluation_authority_snapshot_validity_check"
    CHECK ("valid_through">"captured_at"),
  CONSTRAINT "outcome_private_evaluation_authority_snapshot_head_check"
    CHECK (
      ("expected_head_status"='absent' AND "expected_head_generation_id" IS NULL AND "expected_head_revision"=0)
      OR ("expected_head_status"='active' AND "expected_head_generation_id" IS NOT NULL)
      OR ("expected_head_status"='withdrawn' AND "expected_head_generation_id" IS NULL AND "expected_head_revision">0)
    )
);

CREATE INDEX "outcome_private_evaluation_authority_snapshot_selector_idx"
  ON "outcome_private_evaluation_authority_snapshot"
  ("valuation_scope_key","trade_id","workbook_sha256","captured_at" DESC,"snapshot_id" DESC);

CREATE TABLE "outcome_private_evaluation_inspection_receipt" (
  "receipt_id" TEXT PRIMARY KEY,
  "authority_snapshot_id" TEXT NULL,
  "valuation_scope_key" TEXT NOT NULL,
  "trade_id" TEXT NOT NULL,
  "workbook_sha256" CHAR(64) NULL CHECK ("workbook_sha256" ~ '^[a-f0-9]{64}$'),
  "inspected_at" TIMESTAMPTZ(3) NOT NULL,
  "valid_through" TIMESTAMPTZ(3) NULL,
  "expected_head_generation_id" TEXT NULL,
  "expected_head_revision" INTEGER NOT NULL CHECK ("expected_head_revision">=0),
  "expected_head_status" TEXT NOT NULL CHECK ("expected_head_status" IN ('absent','active','withdrawn')),
  "state" TEXT NOT NULL CHECK ("state" IN ('ready','unavailable')),
  "blocker_count" INTEGER NOT NULL CHECK ("blocker_count">=0),
  "blocker_fingerprint" CHAR(64) NOT NULL CHECK ("blocker_fingerprint" ~ '^[a-f0-9]{64}$'),
  "receipt_content_sha256" CHAR(64) NOT NULL CHECK ("receipt_content_sha256" ~ '^[a-f0-9]{64}$'),
  "artifact_sha256" CHAR(64) NOT NULL CHECK ("artifact_sha256" ~ '^[a-f0-9]{64}$'),
  "publication_eligible" BOOLEAN NOT NULL DEFAULT FALSE CHECK ("publication_eligible"=FALSE),
  "publication_prohibited" BOOLEAN NOT NULL DEFAULT TRUE CHECK ("publication_prohibited"=TRUE),
  "receipt_json" JSONB NOT NULL CHECK (jsonb_typeof("receipt_json")='object'),
  "artifact_json" JSONB NOT NULL CHECK (jsonb_typeof("artifact_json")='object'),
  CONSTRAINT "outcome_private_evaluation_inspection_receipt_id_check"
    CHECK ("receipt_id"='private-evaluation-inspection:' || "receipt_content_sha256"),
  CONSTRAINT "outcome_private_evaluation_inspection_receipt_snapshot_fkey"
    FOREIGN KEY ("authority_snapshot_id")
      REFERENCES "outcome_private_evaluation_authority_snapshot"("snapshot_id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outcome_private_eval_inspection_receipt_head_fkey"
    FOREIGN KEY ("expected_head_generation_id")
      REFERENCES "outcome_local_private_trade_evaluation_generation"("generation_id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "private_eval_inspection_receipt_readiness_check"
    CHECK (
      ("state"='ready' AND "authority_snapshot_id" IS NOT NULL AND "valid_through" IS NOT NULL AND "blocker_count"=0)
      OR ("state"='unavailable' AND "valid_through" IS NULL AND "blocker_count">0)
    ),
  CONSTRAINT "outcome_private_evaluation_inspection_receipt_head_check"
    CHECK (
      ("expected_head_status"='absent' AND "expected_head_generation_id" IS NULL AND "expected_head_revision"=0)
      OR ("expected_head_status"='active' AND "expected_head_generation_id" IS NOT NULL)
      OR ("expected_head_status"='withdrawn' AND "expected_head_generation_id" IS NULL AND "expected_head_revision">0)
    )
);

CREATE INDEX "outcome_private_evaluation_inspection_receipt_selector_idx"
  ON "outcome_private_evaluation_inspection_receipt"
  ("valuation_scope_key","trade_id","workbook_sha256","inspected_at" DESC,"receipt_id" DESC);

CREATE FUNCTION "validate_outcome_private_evaluation_authority_snapshot_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE content JSONB;
BEGIN
  content := NEW.snapshot_json->'content';
  IF NEW.snapshot_json->>'snapshotId' IS DISTINCT FROM NEW.snapshot_id
     OR content->>'schemaVersion'<>'private-evaluation-authority-snapshot/v1'
     OR content->>'environment'<>'non_production'
     OR content->>'valuationScopeKey' IS NOT NULL
     OR content->'selector'->>'valuationScopeKey' IS DISTINCT FROM NEW.valuation_scope_key
     OR content->'selector'->>'tradeId' IS DISTINCT FROM NEW.trade_id
     OR content->>'promotedWorkbookSha256' IS DISTINCT FROM NEW.workbook_sha256
     OR (content->>'capturedAt')::timestamptz IS DISTINCT FROM NEW.captured_at
     OR (content->>'validThrough')::timestamptz IS DISTINCT FROM NEW.valid_through
     OR content->'expectedHead'->>'generationId' IS DISTINCT FROM NEW.expected_head_generation_id
     OR (content->'expectedHead'->>'revision')::integer IS DISTINCT FROM NEW.expected_head_revision
     OR content->'expectedHead'->>'status' IS DISTINCT FROM NEW.expected_head_status
     OR content->>'dependencyFingerprint' IS DISTINCT FROM NEW.dependency_fingerprint
     OR content->'publicationEligible' IS DISTINCT FROM 'false'::jsonb
     OR content->'publicationProhibited' IS DISTINCT FROM 'true'::jsonb
     OR NEW.artifact_json->>'contentSha256' IS DISTINCT FROM NEW.artifact_sha256
  THEN
    RAISE EXCEPTION 'Private evaluation authority snapshot failed exact column authentication';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_private_evaluation_authority_snapshot_insert_guard"
BEFORE INSERT ON "outcome_private_evaluation_authority_snapshot"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_evaluation_authority_snapshot_insert"();

CREATE FUNCTION "validate_outcome_private_evaluation_inspection_receipt_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE content JSONB;
BEGIN
  content := NEW.receipt_json->'content';
  IF NEW.receipt_json->>'receiptId' IS DISTINCT FROM NEW.receipt_id
     OR content->>'schemaVersion'<>'private-evaluation-inspection/v1'
     OR content->>'environment'<>'non_production'
     OR content->>'authoritySnapshotId' IS DISTINCT FROM NEW.authority_snapshot_id
     OR content->'selector'->>'valuationScopeKey' IS DISTINCT FROM NEW.valuation_scope_key
     OR content->'selector'->>'tradeId' IS DISTINCT FROM NEW.trade_id
     OR content->>'promotedWorkbookSha256' IS DISTINCT FROM NEW.workbook_sha256
     OR (content->>'inspectedAt')::timestamptz IS DISTINCT FROM NEW.inspected_at
     OR (
       CASE
         WHEN content->>'validThrough' IS NULL THEN NEW.valid_through IS NOT NULL
         ELSE (content->>'validThrough')::timestamptz IS DISTINCT FROM NEW.valid_through
       END
     )
     OR content->'expectedHead'->>'generationId' IS DISTINCT FROM NEW.expected_head_generation_id
     OR (content->'expectedHead'->>'revision')::integer IS DISTINCT FROM NEW.expected_head_revision
     OR content->'expectedHead'->>'status' IS DISTINCT FROM NEW.expected_head_status
     OR content->>'state' IS DISTINCT FROM NEW.state
     OR jsonb_typeof(content->'observedDependencies') IS DISTINCT FROM 'array'
     OR jsonb_array_length(content->'blockers') IS DISTINCT FROM NEW.blocker_count
     OR content->>'blockerFingerprint' IS DISTINCT FROM NEW.blocker_fingerprint
     OR content->'publicationEligible' IS DISTINCT FROM 'false'::jsonb
     OR content->'publicationProhibited' IS DISTINCT FROM 'true'::jsonb
     OR NEW.artifact_json->>'contentSha256' IS DISTINCT FROM NEW.artifact_sha256
  THEN
    RAISE EXCEPTION 'Private evaluation inspection receipt failed exact column authentication';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_private_evaluation_inspection_receipt_insert_guard"
BEFORE INSERT ON "outcome_private_evaluation_inspection_receipt"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_evaluation_inspection_receipt_insert"();

CREATE FUNCTION "reject_outcome_private_evaluation_authority_snapshot_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Authority snapshots are append-only';
END $$;

CREATE TRIGGER "outcome_private_evaluation_authority_snapshot_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_private_evaluation_authority_snapshot"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_evaluation_authority_snapshot_mutation"();

CREATE FUNCTION "reject_outcome_private_evaluation_inspection_receipt_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Inspection receipts are append-only';
END $$;

CREATE TRIGGER "outcome_private_evaluation_inspection_receipt_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_private_evaluation_inspection_receipt"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_evaluation_inspection_receipt_mutation"();
