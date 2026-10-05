CREATE TABLE "outcome_local_private_trade_evaluation_generation" (
  "generation_id" TEXT PRIMARY KEY,
  "valuation_scope_key" TEXT NOT NULL,
  "trade_id" TEXT NOT NULL,
  "workbook_sha256" CHAR(64) NOT NULL CHECK ("workbook_sha256" ~ '^[a-f0-9]{64}$'),
  "dependency_fingerprint" TEXT NOT NULL,
  "generated_at" TIMESTAMPTZ(3) NOT NULL,
  "generation_content_sha256" CHAR(64) NOT NULL CHECK ("generation_content_sha256" ~ '^[a-f0-9]{64}$'),
  "artifact_sha256" CHAR(64) NOT NULL CHECK ("artifact_sha256" ~ '^[a-f0-9]{64}$'),
  "generation_json" JSONB NOT NULL,
  "artifact_json" JSONB NOT NULL,
  CONSTRAINT "outcome_local_private_trade_evaluation_generation_id_check"
    CHECK ("generation_id"='local-private-trade-evaluation-generation:' || "generation_content_sha256")
);

CREATE INDEX "outcome_local_private_trade_evaluation_generation_trade_idx"
  ON "outcome_local_private_trade_evaluation_generation"
  ("trade_id","generated_at" DESC,"generation_id" DESC);

CREATE TABLE "outcome_local_private_trade_evaluation_head" (
  "trade_id" TEXT PRIMARY KEY,
  "generation_id" TEXT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision">0),
  "status" TEXT NOT NULL CHECK ("status" IN ('active','withdrawn')),
  "withdrawal_reason" TEXT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "outcome_local_private_trade_evaluation_head_generation_fkey"
    FOREIGN KEY ("generation_id")
      REFERENCES "outcome_local_private_trade_evaluation_generation"("generation_id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outcome_local_private_trade_evaluation_head_state_check"
    CHECK (
      ("status"='active' AND "generation_id" IS NOT NULL AND "withdrawal_reason" IS NULL)
      OR
      ("status"='withdrawn' AND "generation_id" IS NULL AND length(btrim("withdrawal_reason")) BETWEEN 1 AND 2000)
    )
);

CREATE TABLE "outcome_local_private_trade_evaluation_transition" (
  "transition_id" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "trade_id" TEXT NOT NULL,
  "from_generation_id" TEXT NULL,
  "to_generation_id" TEXT NULL,
  "action" TEXT NOT NULL CHECK ("action" IN ('activate','rollback','withdraw')),
  "reason" TEXT NULL,
  "changed_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "outcome_local_private_trade_evaluation_transition_from_fkey"
    FOREIGN KEY ("from_generation_id")
      REFERENCES "outcome_local_private_trade_evaluation_generation"("generation_id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outcome_local_private_trade_evaluation_transition_to_fkey"
    FOREIGN KEY ("to_generation_id")
      REFERENCES "outcome_local_private_trade_evaluation_generation"("generation_id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outcome_local_private_trade_evaluation_transition_state_check"
    CHECK (
      ("action" IN ('activate','rollback') AND "to_generation_id" IS NOT NULL AND "reason" IS NULL)
      OR
      ("action"='withdraw' AND "to_generation_id" IS NULL AND length(btrim("reason")) BETWEEN 1 AND 2000)
    )
);

CREATE INDEX "outcome_local_private_trade_evaluation_transition_trade_idx"
  ON "outcome_local_private_trade_evaluation_transition" ("trade_id","changed_at");

CREATE FUNCTION "validate_outcome_local_private_trade_evaluation_generation_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE content JSONB;
BEGIN
  content := NEW.generation_json->'content';
  IF NEW.generation_json->>'generationId' IS DISTINCT FROM NEW.generation_id
     OR content->>'schemaVersion'<>'local-private-trade-evaluation-generation/v1'
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
  THEN
    RAISE EXCEPTION 'Local private trade evaluation generation failed exact column authentication';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_local_private_trade_evaluation_generation_insert_guard"
BEFORE INSERT ON "outcome_local_private_trade_evaluation_generation"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_local_private_trade_evaluation_generation_insert"();

CREATE FUNCTION "reject_outcome_local_private_trade_evaluation_generation_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Local private trade evaluation generations are append-only';
END $$;

CREATE TRIGGER "outcome_local_private_trade_evaluation_generation_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_local_private_trade_evaluation_generation"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_local_private_trade_evaluation_generation_mutation"();

CREATE FUNCTION "validate_outcome_local_private_trade_evaluation_head_write"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target_matches BOOLEAN;
BEGIN
  IF NEW.generation_id IS NOT NULL THEN
    EXECUTE format(
      'SELECT EXISTS (
         SELECT 1
           FROM %I.outcome_local_private_trade_evaluation_generation generation
          WHERE generation.generation_id=$1
            AND generation.trade_id=$2
       )',
      TG_TABLE_SCHEMA
    ) INTO target_matches USING NEW.generation_id, NEW.trade_id;
    IF NOT target_matches THEN
      RAISE EXCEPTION 'Local private trade evaluation head target belongs to another trade';
    END IF;
  END IF;
  IF TG_OP='UPDATE' AND NEW.revision<>OLD.revision+1 THEN
    RAISE EXCEPTION 'Local private trade evaluation head revision must advance exactly once';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "outcome_local_private_trade_evaluation_head_write_guard"
BEFORE INSERT OR UPDATE ON "outcome_local_private_trade_evaluation_head"
FOR EACH ROW EXECUTE FUNCTION "validate_outcome_local_private_trade_evaluation_head_write"();

CREATE FUNCTION "reject_outcome_local_private_trade_evaluation_transition_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Local private trade evaluation transitions are append-only';
END $$;

CREATE TRIGGER "outcome_local_private_trade_evaluation_transition_mutation_guard"
BEFORE UPDATE OR DELETE ON "outcome_local_private_trade_evaluation_transition"
FOR EACH ROW EXECUTE FUNCTION "reject_outcome_local_private_trade_evaluation_transition_mutation"();
