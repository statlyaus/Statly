-- Governed private-evaluation lifecycle. All source, projection, and generation bytes must already
-- exist in immutable artifact custody before a serializable transition can point at them.

ALTER TABLE "outcome_operational_principal_authority"
  DROP CONSTRAINT "outcome_operational_authority_shape_check";

ALTER TABLE "outcome_operational_principal_authority"
  ADD CONSTRAINT "outcome_operational_authority_shape_check" CHECK (
    "authority_evidence_id" ~ '^reviewer-authority-evidence:[a-f0-9]{64}$'
    AND "role" IN (
      'afl_trade_identity_reviewer',
      'afl_trade_canonical_promoter',
      'afl_trade_external_identity_reviewer',
      'afl_trade_model_run_operator',
      'afl_trade_private_evaluation_operator'
    )
    AND "competition" IN ('AFLM','AFLW')
    AND "valid_from_season" BETWEEN 1897 AND 2200
    AND "valid_through_season" BETWEEN "valid_from_season" AND 2200
    AND ("valid_through" IS NULL OR "valid_through" >= "valid_from")
    AND (
      ("role" IN (
          'afl_trade_identity_reviewer',
          'afl_trade_canonical_promoter',
          'afl_trade_external_identity_reviewer'
        )
        AND "scope_key" = 'public-afl-draft-trade-outcomes')
      OR
      ("role" = 'afl_trade_model_run_operator'
        AND "provider" = 'statly_modeling'
        AND "capability_id" = 'execute_model_run')
      OR
      ("role" = 'afl_trade_private_evaluation_operator'
        AND "provider" = 'statly_modeling'
        AND "capability_id" = 'manage_private_trade_evaluation'
        AND (
          "scope_key" ~ '^afl-men:[0-9]{4}-trades$'
          OR "scope_key" = 'afl-trade-history:test-fixture'
        ))
    )
  );

CREATE TABLE "outcome_private_evaluation_authority_snapshot" (
    "snapshot_id" TEXT NOT NULL,
    "valuation_scope_key" TEXT NOT NULL,
    "trade_id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL,
    "valid_through" TIMESTAMPTZ(3) NOT NULL,
    "expected_head_status" TEXT NOT NULL,
    "expected_head_revision" INTEGER NOT NULL,
    "expected_head_generation_id" TEXT,
    "content_sha256" CHAR(64) NOT NULL,
    "content_canonical_json" TEXT NOT NULL,
    "snapshot_json" JSONB NOT NULL,
    "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "outcome_private_evaluation_authority_snapshot_pkey" PRIMARY KEY ("snapshot_id"),
    CONSTRAINT "outcome_private_evaluation_authority_snapshot_scope_key"
      UNIQUE ("snapshot_id", "valuation_scope_key", "trade_id"),
    CONSTRAINT "outcome_private_evaluation_authority_snapshot_artifact_key" UNIQUE ("artifact_id"),
    CONSTRAINT "outcome_private_evaluation_authority_snapshot_id_check"
      CHECK ("snapshot_id" ~ '^private-evaluation-authority-snapshot:[a-f0-9]{64}$'),
    CONSTRAINT "outcome_private_evaluation_authority_snapshot_sha_check"
      CHECK ("content_sha256" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "outcome_private_evaluation_authority_snapshot_window_check"
      CHECK ("valid_through" > "captured_at"),
    CONSTRAINT "outcome_private_evaluation_authority_snapshot_head_check"
      CHECK (
        ("expected_head_status"='absent' AND "expected_head_revision"=0 AND "expected_head_generation_id" IS NULL)
        OR ("expected_head_status"='withdrawn' AND "expected_head_revision">0 AND "expected_head_generation_id" IS NULL)
        OR ("expected_head_status"='active' AND "expected_head_revision">0 AND "expected_head_generation_id" IS NOT NULL)
      ),
    CONSTRAINT "outcome_private_evaluation_authority_snapshot_artifact_fkey"
      FOREIGN KEY ("artifact_id") REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT
);

CREATE TABLE "outcome_private_evaluation_inspection_receipt" (
    "inspection_id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "valuation_scope_key" TEXT NOT NULL,
    "trade_id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "inspected_at" TIMESTAMPTZ(3) NOT NULL,
    "valid_through" TIMESTAMPTZ(3) NOT NULL,
    "expected_head_status" TEXT NOT NULL,
    "expected_head_revision" INTEGER NOT NULL,
    "expected_head_generation_id" TEXT,
    "content_sha256" CHAR(64) NOT NULL,
    "content_canonical_json" TEXT NOT NULL,
    "receipt_json" JSONB NOT NULL,
    "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "outcome_private_evaluation_inspection_receipt_pkey" PRIMARY KEY ("inspection_id"),
    CONSTRAINT "outcome_private_evaluation_inspection_receipt_artifact_key" UNIQUE ("artifact_id"),
    CONSTRAINT "outcome_private_evaluation_inspection_receipt_id_check"
      CHECK ("inspection_id" ~ '^private-evaluation-inspection:[a-f0-9]{64}$'),
    CONSTRAINT "outcome_private_evaluation_inspection_receipt_sha_check"
      CHECK ("content_sha256" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "outcome_private_evaluation_inspection_receipt_state_check"
      CHECK (
        ("state"='ready' AND "valid_through" IS NOT NULL AND "expected_head_status" IS NOT NULL AND "expected_head_revision" IS NOT NULL)
        OR ("state"='unavailable' AND "valid_through" IS NOT NULL AND "expected_head_status" IS NOT NULL AND "expected_head_revision" IS NOT NULL)
      ),
    CONSTRAINT "outcome_private_evaluation_inspection_receipt_head_check"
      CHECK (
        ("expected_head_status"='absent' AND "expected_head_revision"=0 AND "expected_head_generation_id" IS NULL)
        OR ("expected_head_status"='withdrawn' AND "expected_head_revision">0 AND "expected_head_generation_id" IS NULL)
        OR ("expected_head_status"='active' AND "expected_head_revision">0 AND "expected_head_generation_id" IS NOT NULL)
      ),
    CONSTRAINT "outcome_private_evaluation_inspection_receipt_snapshot_fkey"
      FOREIGN KEY ("snapshot_id") REFERENCES "outcome_private_evaluation_authority_snapshot"("snapshot_id") ON DELETE RESTRICT,
    CONSTRAINT "outcome_private_evaluation_inspection_receipt_artifact_fkey"
      FOREIGN KEY ("artifact_id") REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT
);

CREATE TABLE "outcome_private_evaluation_transition_intent" (
    "transition_intent_id" TEXT NOT NULL,
    "inspection_id" TEXT NOT NULL,
    "authority_snapshot_id" TEXT,
    "operation_id" TEXT NOT NULL,
    "valuation_scope_key" TEXT NOT NULL,
    "trade_id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "expected_head_status" TEXT NOT NULL,
    "expected_head_revision" INTEGER NOT NULL,
    "expected_head_generation_id" TEXT,
    "target_generation_id" TEXT,
    "requested_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "content_sha256" CHAR(64) NOT NULL,
    "content_canonical_json" TEXT NOT NULL,
    "intent_json" JSONB NOT NULL,
    "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "outcome_private_evaluation_transition_intent_pkey" PRIMARY KEY ("transition_intent_id"),
    CONSTRAINT "outcome_private_evaluation_transition_intent_inspection_key" UNIQUE ("inspection_id"),
    CONSTRAINT "outcome_private_evaluation_transition_intent_operation_key" UNIQUE ("operation_id"),
    CONSTRAINT "outcome_private_evaluation_transition_intent_artifact_key" UNIQUE ("artifact_id"),
    CONSTRAINT "outcome_private_evaluation_transition_intent_id_check"
      CHECK ("transition_intent_id" ~ '^private-evaluation-transition-intent:[a-f0-9]{64}$'),
    CONSTRAINT "outcome_private_evaluation_transition_intent_operation_check"
      CHECK ("operation_id" ~ '^private-evaluation-operation:[a-f0-9]{64}$'),
    CONSTRAINT "outcome_private_evaluation_transition_intent_action_check"
      CHECK ("action" IN ('construct_and_activate','withdraw','rollback','recover')),
    CONSTRAINT "outcome_private_evaluation_transition_intent_window_check"
      CHECK ("expires_at" > "requested_at"),
    CONSTRAINT "outcome_private_evaluation_transition_intent_target_check"
      CHECK (("action"='rollback') = ("target_generation_id" IS NOT NULL)),
    CONSTRAINT "outcome_private_evaluation_transition_intent_snapshot_check"
      CHECK (("action"='withdraw') = ("authority_snapshot_id" IS NULL)),
    CONSTRAINT "outcome_private_evaluation_transition_intent_inspection_fkey"
      FOREIGN KEY ("inspection_id") REFERENCES "outcome_private_evaluation_inspection_receipt"("inspection_id") ON DELETE RESTRICT,
    CONSTRAINT "outcome_private_evaluation_transition_intent_snapshot_fkey"
      FOREIGN KEY ("authority_snapshot_id", "valuation_scope_key", "trade_id")
      REFERENCES "outcome_private_evaluation_authority_snapshot"("snapshot_id", "valuation_scope_key", "trade_id") ON DELETE RESTRICT,
    CONSTRAINT "outcome_private_evaluation_transition_intent_artifact_fkey"
      FOREIGN KEY ("artifact_id") REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT
);

CREATE TABLE "outcome_local_private_trade_evaluation_generation" (
    "generation_id" TEXT NOT NULL,
    "valuation_scope_key" TEXT NOT NULL,
    "trade_id" TEXT NOT NULL,
    "transition_intent_id" TEXT NOT NULL,
    "generation_artifact_id" TEXT NOT NULL,
    "narrative_artifact_id" TEXT NOT NULL,
    "projection_manifest_artifact_id" TEXT NOT NULL,
    "generated_at" TIMESTAMPTZ(3) NOT NULL,
    "content_sha256" CHAR(64) NOT NULL,
    "content_canonical_json" TEXT NOT NULL,
    "generation_json" JSONB NOT NULL,
    "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "outcome_local_private_trade_evaluation_generation_pkey" PRIMARY KEY ("generation_id"),
    CONSTRAINT "outcome_local_private_trade_evaluation_generation_scope_key" UNIQUE ("valuation_scope_key", "trade_id", "generation_id"),
    CONSTRAINT "outcome_local_private_trade_evaluation_generation_intent_key" UNIQUE ("transition_intent_id"),
    CONSTRAINT "outcome_local_private_trade_evaluation_generation_artifact_key" UNIQUE ("generation_artifact_id"),
    CONSTRAINT "outcome_local_private_trade_evaluation_generation_id_check"
      CHECK ("generation_id" ~ '^local-private-trade-evaluation-generation:[a-f0-9]{64}$'),
    CONSTRAINT "outcome_local_private_trade_evaluation_generation_sha_check"
      CHECK ("content_sha256" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "outcome_local_private_trade_evaluation_generation_intent_fkey"
      FOREIGN KEY ("transition_intent_id") REFERENCES "outcome_private_evaluation_transition_intent"("transition_intent_id") ON DELETE RESTRICT,
    CONSTRAINT "outcome_local_private_trade_evaluation_generation_artifact_fkey"
      FOREIGN KEY ("generation_artifact_id") REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT,
    CONSTRAINT "outcome_local_private_trade_evaluation_narrative_artifact_fkey"
      FOREIGN KEY ("narrative_artifact_id") REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT,
    CONSTRAINT "outcome_local_private_trade_evaluation_projection_artifact_fkey"
      FOREIGN KEY ("projection_manifest_artifact_id") REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT
);

ALTER TABLE "outcome_private_evaluation_authority_snapshot"
  ADD CONSTRAINT "outcome_private_eval_snapshot_expected_gen_fkey"
  FOREIGN KEY ("valuation_scope_key", "trade_id", "expected_head_generation_id")
  REFERENCES "outcome_local_private_trade_evaluation_generation"("valuation_scope_key", "trade_id", "generation_id") ON DELETE RESTRICT;
ALTER TABLE "outcome_private_evaluation_inspection_receipt"
  ADD CONSTRAINT "outcome_private_eval_inspection_expected_gen_fkey"
  FOREIGN KEY ("valuation_scope_key", "trade_id", "expected_head_generation_id")
  REFERENCES "outcome_local_private_trade_evaluation_generation"("valuation_scope_key", "trade_id", "generation_id") ON DELETE RESTRICT;
ALTER TABLE "outcome_private_evaluation_transition_intent"
  ADD CONSTRAINT "outcome_private_eval_intent_expected_gen_fkey"
  FOREIGN KEY ("valuation_scope_key", "trade_id", "expected_head_generation_id")
  REFERENCES "outcome_local_private_trade_evaluation_generation"("valuation_scope_key", "trade_id", "generation_id") ON DELETE RESTRICT;
ALTER TABLE "outcome_private_evaluation_transition_intent"
  ADD CONSTRAINT "outcome_private_eval_intent_target_gen_fkey"
  FOREIGN KEY ("valuation_scope_key", "trade_id", "target_generation_id")
  REFERENCES "outcome_local_private_trade_evaluation_generation"("valuation_scope_key", "trade_id", "generation_id") ON DELETE RESTRICT;

CREATE TABLE "outcome_local_private_trade_evaluation_head" (
    "valuation_scope_key" TEXT NOT NULL,
    "trade_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "generation_id" TEXT,
    "last_transition_id" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "outcome_local_private_trade_evaluation_head_pkey" PRIMARY KEY ("valuation_scope_key", "trade_id"),
    CONSTRAINT "outcome_local_private_trade_evaluation_head_revision_check" CHECK ("revision">0),
    CONSTRAINT "outcome_local_private_trade_evaluation_head_state_check"
      CHECK ((status='active' AND generation_id IS NOT NULL) OR (status IN ('withdrawn') AND generation_id IS NULL)),
    CONSTRAINT "outcome_local_private_trade_evaluation_head_generation_fkey"
      FOREIGN KEY ("valuation_scope_key", "trade_id", "generation_id")
      REFERENCES "outcome_local_private_trade_evaluation_generation"("valuation_scope_key", "trade_id", "generation_id") ON DELETE RESTRICT
);

CREATE TABLE "outcome_private_evaluation_transition_receipt" (
    "transition_id" TEXT NOT NULL,
    "transition_intent_id" TEXT NOT NULL,
    "operation_id" TEXT NOT NULL,
    "valuation_scope_key" TEXT NOT NULL,
    "trade_id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "from_revision" INTEGER NOT NULL,
    "from_status" TEXT NOT NULL,
    "from_generation_id" TEXT,
    "to_revision" INTEGER NOT NULL,
    "to_status" TEXT NOT NULL,
    "to_generation_id" TEXT,
    "transitioned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "content_sha256" CHAR(64) NOT NULL,
    "content_canonical_json" TEXT NOT NULL,
    "receipt_json" JSONB NOT NULL,

    CONSTRAINT "outcome_private_evaluation_transition_receipt_pkey" PRIMARY KEY ("transition_id"),
    CONSTRAINT "outcome_private_evaluation_transition_receipt_intent_key" UNIQUE ("transition_intent_id"),
    CONSTRAINT "outcome_private_evaluation_transition_receipt_operation_key" UNIQUE ("operation_id"),
    CONSTRAINT "outcome_private_evaluation_transition_receipt_artifact_key" UNIQUE ("artifact_id"),
    CONSTRAINT "outcome_private_evaluation_transition_receipt_id_check"
      CHECK ("transition_id" ~ '^private-evaluation-transition:[a-f0-9]{64}$'),
    CONSTRAINT "outcome_private_evaluation_transition_receipt_action_check"
      CHECK ("action" IN ('construct_and_activate','withdraw','rollback','recover')),
    CONSTRAINT "outcome_private_evaluation_transition_receipt_revision_check"
      CHECK ("from_revision">=0 AND "to_revision"="from_revision"+1),
    CONSTRAINT "outcome_private_evaluation_transition_receipt_from_state_check"
      CHECK (("from_status"='absent' AND "from_revision"=0 AND "from_generation_id" IS NULL) OR ("from_status"='withdrawn' AND "from_revision">0 AND "from_generation_id" IS NULL) OR ("from_status"='active' AND "from_revision">0 AND "from_generation_id" IS NOT NULL)),
    CONSTRAINT "outcome_private_evaluation_transition_receipt_to_state_check"
      CHECK (("to_status"='withdrawn' AND "to_generation_id" IS NULL) OR ("to_status"='active' AND "to_generation_id" IS NOT NULL)),
    CONSTRAINT "outcome_private_evaluation_transition_receipt_intent_fkey"
      FOREIGN KEY ("transition_intent_id") REFERENCES "outcome_private_evaluation_transition_intent"("transition_intent_id") ON DELETE RESTRICT,
    CONSTRAINT "outcome_private_evaluation_transition_receipt_artifact_fkey"
      FOREIGN KEY ("artifact_id") REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT,
    CONSTRAINT "outcome_private_eval_receipt_from_gen_fkey"
      FOREIGN KEY ("valuation_scope_key", "trade_id", "from_generation_id")
      REFERENCES "outcome_local_private_trade_evaluation_generation"("valuation_scope_key", "trade_id", "generation_id") ON DELETE RESTRICT,
    CONSTRAINT "outcome_private_eval_receipt_to_gen_fkey"
      FOREIGN KEY ("valuation_scope_key", "trade_id", "to_generation_id")
      REFERENCES "outcome_local_private_trade_evaluation_generation"("valuation_scope_key", "trade_id", "generation_id") ON DELETE RESTRICT
);

ALTER TABLE "outcome_local_private_trade_evaluation_head"
  ADD CONSTRAINT "outcome_local_private_trade_evaluation_head_transition_fkey"
  FOREIGN KEY ("last_transition_id") REFERENCES "outcome_private_evaluation_transition_receipt"("transition_id") ON DELETE RESTRICT;

CREATE TABLE "outcome_private_evaluation_reconstruction_verification" (
    "verification_id" TEXT NOT NULL,
    "inspection_id" TEXT NOT NULL,
    "operation_id" TEXT NOT NULL,
    "valuation_scope_key" TEXT NOT NULL,
    "trade_id" TEXT NOT NULL,
    "generation_id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(3) NOT NULL,
    "exact_match" BOOLEAN NOT NULL,
    "content_sha256" CHAR(64) NOT NULL,
    "content_canonical_json" TEXT NOT NULL,
    "verification_json" JSONB NOT NULL,
    "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "outcome_private_evaluation_reconstruction_verification_pkey" PRIMARY KEY ("verification_id"),
    CONSTRAINT "outcome_private_eval_reconstruction_operation_key" UNIQUE ("operation_id"),
    CONSTRAINT "outcome_private_eval_reconstruction_artifact_key" UNIQUE ("artifact_id"),
    CONSTRAINT "outcome_private_evaluation_reconstruction_verification_id_check"
      CHECK ("verification_id" ~ '^private-evaluation-reconstruction-verification:[a-f0-9]{64}$'),
    CONSTRAINT "outcome_private_eval_reconstruction_operation_check"
      CHECK ("operation_id" ~ '^private-evaluation-operation:[a-f0-9]{64}$'),
    CONSTRAINT "outcome_private_eval_reconstruction_sha_check"
      CHECK ("content_sha256" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "outcome_private_eval_reconstruction_match_check"
      CHECK ("exact_match"=TRUE),
    CONSTRAINT "outcome_private_eval_reconstruction_inspection_fkey"
      FOREIGN KEY ("inspection_id") REFERENCES "outcome_private_evaluation_inspection_receipt"("inspection_id") ON DELETE RESTRICT,
    CONSTRAINT "outcome_private_eval_reconstruction_artifact_fkey"
      FOREIGN KEY ("artifact_id") REFERENCES "outcome_artifact_custody"("artifact_id") ON DELETE RESTRICT,
    CONSTRAINT "outcome_private_eval_reconstruction_generation_fkey"
      FOREIGN KEY ("valuation_scope_key", "trade_id", "generation_id")
      REFERENCES "outcome_local_private_trade_evaluation_generation"("valuation_scope_key", "trade_id", "generation_id") ON DELETE RESTRICT
);

CREATE INDEX "outcome_private_evaluation_snapshot_selector_idx"
  ON "outcome_private_evaluation_authority_snapshot"("valuation_scope_key", "trade_id", "captured_at");
CREATE INDEX "outcome_private_evaluation_generation_selector_idx"
  ON "outcome_local_private_trade_evaluation_generation"("valuation_scope_key", "trade_id", "generated_at");
CREATE INDEX "outcome_private_evaluation_transition_selector_idx"
  ON "outcome_private_evaluation_transition_receipt"("valuation_scope_key", "trade_id", "to_revision");
CREATE INDEX "outcome_private_evaluation_reconstruction_selector_idx"
  ON "outcome_private_evaluation_reconstruction_verification"("valuation_scope_key", "trade_id", "generation_id", "verified_at");

CREATE OR REPLACE FUNCTION "reject_outcome_private_evaluation_authority_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Private evaluation authority records are append-only';
END $$;

CREATE TRIGGER "outcome_private_evaluation_snapshot_append_only"
BEFORE UPDATE OR DELETE ON "outcome_private_evaluation_authority_snapshot"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_evaluation_authority_mutation"();
CREATE TRIGGER "outcome_private_evaluation_inspection_append_only"
BEFORE UPDATE OR DELETE ON "outcome_private_evaluation_inspection_receipt"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_evaluation_authority_mutation"();
CREATE TRIGGER "outcome_private_evaluation_intent_append_only"
BEFORE UPDATE OR DELETE ON "outcome_private_evaluation_transition_intent"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_evaluation_authority_mutation"();

CREATE OR REPLACE FUNCTION "reject_outcome_private_evaluation_generation_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Private evaluation generations are append-only';
END $$;
CREATE TRIGGER "outcome_private_evaluation_generation_append_only"
BEFORE UPDATE OR DELETE ON "outcome_local_private_trade_evaluation_generation"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_evaluation_generation_mutation"();

CREATE OR REPLACE FUNCTION "reject_outcome_private_evaluation_transition_receipt_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Private evaluation transition receipts are append-only';
END $$;
CREATE TRIGGER "outcome_private_evaluation_transition_receipt_append_only"
BEFORE UPDATE OR DELETE ON "outcome_private_evaluation_transition_receipt"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_evaluation_transition_receipt_mutation"();

CREATE OR REPLACE FUNCTION "reject_outcome_private_eval_reconstruction_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Private evaluation reconstruction verifications are append-only';
END $$;
CREATE TRIGGER "outcome_private_eval_reconstruction_append_only"
BEFORE UPDATE OR DELETE ON "outcome_private_evaluation_reconstruction_verification"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_private_eval_reconstruction_mutation"();
