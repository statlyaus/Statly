CREATE TABLE "outcome_private_evaluation_transition_intent" (
  "intent_id" TEXT PRIMARY KEY,
  "valuation_scope_key" TEXT NOT NULL,
  "trade_id" TEXT NOT NULL,
  "action" TEXT NOT NULL CHECK ("action" IN ('construct_and_activate','recover','rollback','withdraw')),
  "expected_head_generation_id" TEXT NULL,
  "expected_head_revision" INTEGER NOT NULL CHECK ("expected_head_revision">=0),
  "expected_head_status" TEXT NOT NULL CHECK ("expected_head_status" IN ('absent','active','withdrawn')),
  "target_generation_id" TEXT NULL,
  "authority_snapshot_id" TEXT NULL,
  "inspection_receipt_id" TEXT NULL,
  "reason" TEXT NULL,
  "operator_principal_id" TEXT NOT NULL CHECK (length(btrim("operator_principal_id")) BETWEEN 1 AND 400),
  "operator_rationale" TEXT NOT NULL CHECK (length(btrim("operator_rationale")) BETWEEN 1 AND 2000),
  "requested_at" TIMESTAMPTZ(3) NOT NULL,
  "intent_content_sha256" CHAR(64) NOT NULL CHECK ("intent_content_sha256" ~ '^[a-f0-9]{64}$'),
  "artifact_sha256" CHAR(64) NOT NULL CHECK ("artifact_sha256" ~ '^[a-f0-9]{64}$'),
  "publication_eligible" BOOLEAN NOT NULL DEFAULT FALSE CHECK ("publication_eligible"=FALSE),
  "publication_prohibited" BOOLEAN NOT NULL DEFAULT TRUE CHECK ("publication_prohibited"=TRUE),
  "intent_json" JSONB NOT NULL CHECK (jsonb_typeof("intent_json")='object'),
  "artifact_json" JSONB NOT NULL CHECK (jsonb_typeof("artifact_json")='object'),
  CONSTRAINT "outcome_private_evaluation_transition_intent_id_check"
    CHECK ("intent_id"='private-evaluation-transition-intent:' || "intent_content_sha256"),
  CONSTRAINT "outcome_private_evaluation_transition_intent_expected_fkey"
    FOREIGN KEY ("expected_head_generation_id")
      REFERENCES "outcome_local_private_trade_evaluation_generation"("generation_id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outcome_private_evaluation_transition_intent_target_fkey"
    FOREIGN KEY ("target_generation_id")
      REFERENCES "outcome_local_private_trade_evaluation_generation"("generation_id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outcome_private_evaluation_transition_intent_snapshot_fkey"
    FOREIGN KEY ("authority_snapshot_id")
      REFERENCES "outcome_private_evaluation_authority_snapshot"("snapshot_id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outcome_private_evaluation_transition_intent_inspection_fkey"
    FOREIGN KEY ("inspection_receipt_id")
      REFERENCES "outcome_private_evaluation_inspection_receipt"("receipt_id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outcome_private_evaluation_transition_intent_head_check"
    CHECK (
      ("expected_head_status"='absent' AND "expected_head_generation_id" IS NULL AND "expected_head_revision"=0)
      OR ("expected_head_status"='active' AND "expected_head_generation_id" IS NOT NULL AND "expected_head_revision">0)
      OR ("expected_head_status"='withdrawn' AND "expected_head_generation_id" IS NULL AND "expected_head_revision">0)
    ),
  CONSTRAINT "outcome_private_evaluation_transition_intent_semantics_check"
    CHECK (
      ("action" IN ('construct_and_activate','recover') AND "target_generation_id" IS NULL
        AND "authority_snapshot_id" IS NOT NULL AND "inspection_receipt_id" IS NOT NULL AND "reason" IS NULL)
      OR ("action"='rollback' AND "target_generation_id" IS NOT NULL
        AND "authority_snapshot_id" IS NOT NULL AND "inspection_receipt_id" IS NOT NULL AND "reason" IS NULL)
      OR ("action"='withdraw' AND "target_generation_id" IS NULL
        AND "authority_snapshot_id" IS NULL AND "inspection_receipt_id" IS NULL
        AND "expected_head_status"='active' AND length(btrim("reason")) BETWEEN 1 AND 2000)
    )
);

CREATE INDEX "outcome_private_evaluation_transition_intent_selector_idx"
  ON "outcome_private_evaluation_transition_intent"
  ("valuation_scope_key","trade_id","requested_at" DESC,"intent_id" DESC);

ALTER TABLE "outcome_local_private_trade_evaluation_generation"
  ADD COLUMN "authority_snapshot_id" TEXT NULL,
  ADD COLUMN "inspection_receipt_id" TEXT NULL,
  ADD COLUMN "transition_intent_id" TEXT NULL,
  ADD COLUMN "derivation_fingerprint" TEXT NULL,
  ADD CONSTRAINT "outcome_local_private_trade_evaluation_generation_snapshot_fkey"
    FOREIGN KEY ("authority_snapshot_id")
      REFERENCES "outcome_private_evaluation_authority_snapshot"("snapshot_id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "outcome_local_private_eval_generation_inspection_fkey"
    FOREIGN KEY ("inspection_receipt_id")
      REFERENCES "outcome_private_evaluation_inspection_receipt"("receipt_id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "outcome_local_private_trade_evaluation_generation_intent_fkey"
    FOREIGN KEY ("transition_intent_id")
      REFERENCES "outcome_private_evaluation_transition_intent"("intent_id")
      ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "outcome_private_evaluation_transition_receipt" (
  "receipt_id" TEXT PRIMARY KEY,
  "intent_id" TEXT NOT NULL UNIQUE,
  "previous_receipt_id" TEXT NULL,
  "valuation_scope_key" TEXT NOT NULL,
  "trade_id" TEXT NOT NULL,
  "action" TEXT NOT NULL CHECK ("action" IN ('construct_and_activate','recover','rollback','withdraw')),
  "generation_id" TEXT NULL,
  "authority_snapshot_id" TEXT NULL,
  "from_head_generation_id" TEXT NULL,
  "from_head_revision" INTEGER NOT NULL CHECK ("from_head_revision">=0),
  "from_head_status" TEXT NOT NULL CHECK ("from_head_status" IN ('absent','active','withdrawn')),
  "to_head_generation_id" TEXT NULL,
  "to_head_revision" INTEGER NOT NULL CHECK ("to_head_revision">0),
  "to_head_status" TEXT NOT NULL CHECK ("to_head_status" IN ('active','withdrawn')),
  "changed_at" TIMESTAMPTZ(3) NOT NULL,
  "receipt_content_sha256" CHAR(64) NOT NULL CHECK ("receipt_content_sha256" ~ '^[a-f0-9]{64}$'),
  "artifact_sha256" CHAR(64) NOT NULL CHECK ("artifact_sha256" ~ '^[a-f0-9]{64}$'),
  "publication_eligible" BOOLEAN NOT NULL DEFAULT FALSE CHECK ("publication_eligible"=FALSE),
  "publication_prohibited" BOOLEAN NOT NULL DEFAULT TRUE CHECK ("publication_prohibited"=TRUE),
  "receipt_json" JSONB NOT NULL CHECK (jsonb_typeof("receipt_json")='object'),
  "artifact_json" JSONB NOT NULL CHECK (jsonb_typeof("artifact_json")='object'),
  CONSTRAINT "outcome_private_evaluation_transition_receipt_id_check"
    CHECK ("receipt_id"='private-evaluation-transition-receipt:' || "receipt_content_sha256"),
  CONSTRAINT "outcome_private_evaluation_transition_receipt_intent_fkey"
    FOREIGN KEY ("intent_id")
      REFERENCES "outcome_private_evaluation_transition_intent"("intent_id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outcome_private_evaluation_transition_receipt_previous_fkey"
    FOREIGN KEY ("previous_receipt_id")
      REFERENCES "outcome_private_evaluation_transition_receipt"("receipt_id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outcome_private_evaluation_transition_receipt_generation_fkey"
    FOREIGN KEY ("generation_id")
      REFERENCES "outcome_local_private_trade_evaluation_generation"("generation_id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outcome_private_evaluation_transition_receipt_snapshot_fkey"
    FOREIGN KEY ("authority_snapshot_id")
      REFERENCES "outcome_private_evaluation_authority_snapshot"("snapshot_id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outcome_private_evaluation_transition_receipt_from_fkey"
    FOREIGN KEY ("from_head_generation_id")
      REFERENCES "outcome_local_private_trade_evaluation_generation"("generation_id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outcome_private_evaluation_transition_receipt_to_fkey"
    FOREIGN KEY ("to_head_generation_id")
      REFERENCES "outcome_local_private_trade_evaluation_generation"("generation_id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outcome_private_evaluation_transition_receipt_revision_check"
    CHECK ("to_head_revision"="from_head_revision"+1),
  CONSTRAINT "outcome_private_evaluation_transition_receipt_previous_check"
    CHECK (("from_head_revision"=0)=("previous_receipt_id" IS NULL)),
  CONSTRAINT "outcome_private_evaluation_transition_receipt_state_check"
    CHECK (
      ("action" IN ('construct_and_activate','recover','rollback')
        AND "generation_id" IS NOT NULL AND "authority_snapshot_id" IS NOT NULL
        AND "to_head_status"='active' AND "to_head_generation_id"="generation_id")
      OR ("action"='withdraw' AND "generation_id" IS NULL AND "authority_snapshot_id" IS NULL
        AND "to_head_status"='withdrawn' AND "to_head_generation_id" IS NULL)
    )
);

CREATE INDEX "outcome_private_evaluation_transition_receipt_selector_idx"
  ON "outcome_private_evaluation_transition_receipt"
  ("valuation_scope_key","trade_id","to_head_revision" DESC,"receipt_id" DESC);

ALTER TABLE "outcome_local_private_trade_evaluation_head"
  ADD COLUMN "transition_receipt_id" TEXT NULL,
  ADD CONSTRAINT "outcome_local_private_trade_evaluation_head_receipt_key"
    UNIQUE ("transition_receipt_id"),
  ADD CONSTRAINT "outcome_local_private_trade_evaluation_head_receipt_fkey"
    FOREIGN KEY ("transition_receipt_id")
      REFERENCES "outcome_private_evaluation_transition_receipt"("receipt_id")
      ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "validate_outcome_local_private_trade_evaluation_generation_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE content JSONB;
DECLARE schema_version TEXT;
BEGIN
  content := NEW.generation_json->'content';
  schema_version := content->>'schemaVersion';
  IF NEW.generation_json->>'generationId' IS DISTINCT FROM NEW.generation_id
     OR schema_version NOT IN (
       'local-private-trade-evaluation-generation/v1',
       'local-private-trade-evaluation-generation/v2',
       'local-private-trade-evaluation-generation/v3'
     )
     OR content->>'environment'<>'non_production'
     OR content->>'authority'<>'private_confirmed_local_evaluation'
     OR content->>'valuationScopeKey' IS DISTINCT FROM NEW.valuation_scope_key
     OR content->>'tradeId' IS DISTINCT FROM NEW.trade_id
     OR content->>'workbookSha256' IS DISTINCT FROM NEW.workbook_sha256
     OR content->>'dependencyFingerprint' IS DISTINCT FROM NEW.dependency_fingerprint
     OR (content->>'generatedAt')::timestamptz IS DISTINCT FROM NEW.generated_at
     OR content->'publicationEligible' IS DISTINCT FROM 'false'::jsonb
     OR content->'publicationProhibited' IS DISTINCT FROM 'true'::jsonb
     OR NEW.artifact_json->>'contentSha256' IS DISTINCT FROM NEW.artifact_sha256
     OR (
       schema_version='local-private-trade-evaluation-generation/v3'
       AND (
         content->'authorityReview'->>'authoritySnapshotId' IS DISTINCT FROM NEW.authority_snapshot_id
         OR content->'authorityReview'->>'inspectionReceiptId' IS DISTINCT FROM NEW.inspection_receipt_id
         OR content->'authorityReview'->>'transitionIntentId' IS DISTINCT FROM NEW.transition_intent_id
         OR content->>'derivationFingerprint' IS DISTINCT FROM NEW.derivation_fingerprint
         OR NEW.authority_snapshot_id IS NULL OR NEW.inspection_receipt_id IS NULL
         OR NEW.transition_intent_id IS NULL OR NEW.derivation_fingerprint IS NULL
       )
     )
     OR (
       schema_version<>'local-private-trade-evaluation-generation/v3'
       AND (NEW.authority_snapshot_id IS NOT NULL OR NEW.inspection_receipt_id IS NOT NULL
         OR NEW.transition_intent_id IS NOT NULL OR NEW.derivation_fingerprint IS NOT NULL)
     )
  THEN
    RAISE EXCEPTION 'Local private trade evaluation generation failed exact column authentication';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION "validate_outcome_private_evaluation_transition_intent_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE content JSONB;
BEGIN
  content := NEW.intent_json->'content';
  IF NEW.intent_json->>'intentId' IS DISTINCT FROM NEW.intent_id
     OR content->>'schemaVersion'<>'private-evaluation-transition-intent/v1'
     OR content->>'environment'<>'non_production'
     OR content->'selector'->>'valuationScopeKey' IS DISTINCT FROM NEW.valuation_scope_key
     OR content->'selector'->>'tradeId' IS DISTINCT FROM NEW.trade_id
     OR content->>'action' IS DISTINCT FROM NEW.action
     OR content->'expectedHead'->>'generationId' IS DISTINCT FROM NEW.expected_head_generation_id
     OR (content->'expectedHead'->>'revision')::integer IS DISTINCT FROM NEW.expected_head_revision
     OR content->'expectedHead'->>'status' IS DISTINCT FROM NEW.expected_head_status
     OR content->>'targetGenerationId' IS DISTINCT FROM NEW.target_generation_id
     OR content->>'authoritySnapshotId' IS DISTINCT FROM NEW.authority_snapshot_id
     OR content->>'inspectionReceiptId' IS DISTINCT FROM NEW.inspection_receipt_id
     OR content->>'reason' IS DISTINCT FROM NEW.reason
     OR content->'operator'->>'principalId' IS DISTINCT FROM NEW.operator_principal_id
     OR content->'operator'->>'rationale' IS DISTINCT FROM NEW.operator_rationale
     OR (content->>'requestedAt')::timestamptz IS DISTINCT FROM NEW.requested_at
     OR content->'publicationEligible' IS DISTINCT FROM 'false'::jsonb
     OR content->'publicationProhibited' IS DISTINCT FROM 'true'::jsonb
     OR NEW.artifact_json->>'contentSha256' IS DISTINCT FROM NEW.artifact_sha256
  THEN
    RAISE EXCEPTION 'Private evaluation transition intent failed exact column authentication';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_private_evaluation_transition_intent_insert_guard"
BEFORE INSERT ON "outcome_private_evaluation_transition_intent"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_evaluation_transition_intent_insert"();

CREATE FUNCTION "validate_outcome_private_evaluation_transition_receipt_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE content JSONB;
BEGIN
  content := NEW.receipt_json->'content';
  IF NEW.receipt_json->>'receiptId' IS DISTINCT FROM NEW.receipt_id
     OR content->>'schemaVersion'<>'private-evaluation-transition-receipt/v1'
     OR content->>'environment'<>'non_production'
     OR content->>'intentId' IS DISTINCT FROM NEW.intent_id
     OR content->>'previousReceiptId' IS DISTINCT FROM NEW.previous_receipt_id
     OR content->'selector'->>'valuationScopeKey' IS DISTINCT FROM NEW.valuation_scope_key
     OR content->'selector'->>'tradeId' IS DISTINCT FROM NEW.trade_id
     OR content->>'action' IS DISTINCT FROM NEW.action
     OR content->>'generationId' IS DISTINCT FROM NEW.generation_id
     OR content->>'authoritySnapshotId' IS DISTINCT FROM NEW.authority_snapshot_id
     OR content->'fromHead'->>'generationId' IS DISTINCT FROM NEW.from_head_generation_id
     OR (content->'fromHead'->>'revision')::integer IS DISTINCT FROM NEW.from_head_revision
     OR content->'fromHead'->>'status' IS DISTINCT FROM NEW.from_head_status
     OR content->'toHead'->>'generationId' IS DISTINCT FROM NEW.to_head_generation_id
     OR (content->'toHead'->>'revision')::integer IS DISTINCT FROM NEW.to_head_revision
     OR content->'toHead'->>'status' IS DISTINCT FROM NEW.to_head_status
     OR (content->>'changedAt')::timestamptz IS DISTINCT FROM NEW.changed_at
     OR content->'publicationEligible' IS DISTINCT FROM 'false'::jsonb
     OR content->'publicationProhibited' IS DISTINCT FROM 'true'::jsonb
     OR NEW.artifact_json->>'contentSha256' IS DISTINCT FROM NEW.artifact_sha256
  THEN
    RAISE EXCEPTION 'Private evaluation transition receipt failed exact column authentication';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_private_evaluation_transition_receipt_insert_guard"
BEFORE INSERT ON "outcome_private_evaluation_transition_receipt"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_private_evaluation_transition_receipt_insert"();

CREATE FUNCTION "reject_outcome_private_evaluation_transition_intent_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Transition intents are append-only';
END $$;

CREATE TRIGGER "outcome_private_evaluation_transition_intent_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_private_evaluation_transition_intent"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_evaluation_transition_intent_mutation"();

CREATE FUNCTION "reject_outcome_private_evaluation_transition_receipt_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Transition receipts are append-only';
END $$;

CREATE TRIGGER "outcome_private_evaluation_transition_receipt_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_private_evaluation_transition_receipt"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_evaluation_transition_receipt_mutation"();

CREATE OR REPLACE FUNCTION "validate_outcome_local_private_trade_evaluation_head_write"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target_matches BOOLEAN;
DECLARE target_is_v3 BOOLEAN;
DECLARE receipt_matches BOOLEAN;
BEGIN
  target_is_v3 := FALSE;
  IF NEW.generation_id IS NOT NULL THEN
    EXECUTE format(
      'SELECT EXISTS (
         SELECT 1
           FROM %I.outcome_local_private_trade_evaluation_generation generation
          WHERE generation.generation_id=$1
            AND generation.trade_id=$2
       ), EXISTS (
         SELECT 1
           FROM %I.outcome_local_private_trade_evaluation_generation generation
          WHERE generation.generation_id=$1
            AND generation.generation_json->''content''->>''schemaVersion''=
              ''local-private-trade-evaluation-generation/v3''
       )',
      TG_TABLE_SCHEMA,
      TG_TABLE_SCHEMA
    ) INTO target_matches,target_is_v3 USING NEW.generation_id,NEW.trade_id;
    IF NOT target_matches THEN
      RAISE EXCEPTION 'Local private trade evaluation head target belongs to another trade';
    END IF;
  END IF;
  IF TG_OP='UPDATE' AND NEW.revision<>OLD.revision+1 THEN
    RAISE EXCEPTION 'Local private trade evaluation head revision must advance exactly once';
  END IF;
  IF NEW.transition_receipt_id IS NOT NULL THEN
    EXECUTE format(
      'SELECT EXISTS (
         SELECT 1
           FROM %I.outcome_private_evaluation_transition_receipt receipt
          WHERE receipt.receipt_id=$1
            AND receipt.trade_id=$2
            AND receipt.to_head_generation_id IS NOT DISTINCT FROM $3
            AND receipt.to_head_revision=$4
            AND receipt.to_head_status=$5
       )',
      TG_TABLE_SCHEMA
    ) INTO receipt_matches USING NEW.transition_receipt_id,NEW.trade_id,
      NEW.generation_id,NEW.revision,NEW.status;
    IF NOT receipt_matches THEN
      RAISE EXCEPTION 'Private evaluation head transition receipt does not match its exact state';
    END IF;
  END IF;
  IF target_is_v3 AND NEW.transition_receipt_id IS NULL THEN
    RAISE EXCEPTION 'Private evaluation v3 head requires its exact transition receipt';
  END IF;
  RETURN NEW;
END $$;
