CREATE TABLE "outcome_valuation_output_custody_operation" (
  "operation_id" TEXT PRIMARY KEY,
  "environment" "OutcomeEnvironment" NOT NULL,
  "valuation_output_inventory_id" TEXT NOT NULL,
  "output_set_sha256" CHAR(64) NOT NULL,
  "repository_assurance" TEXT NOT NULL,
  "custody_profile_id" TEXT,
  "artifact_count" INTEGER NOT NULL,
  "verified_at" TIMESTAMPTZ(3) NOT NULL,
  "operation_content_canonical_json" TEXT NOT NULL,
  "operation_canonical_json" TEXT NOT NULL,
  "operation_json" JSONB NOT NULL,
  "status" TEXT NOT NULL,
  "receipt_id" TEXT UNIQUE,
  "receipt_content_canonical_json" TEXT,
  "receipt_canonical_json" TEXT,
  "receipt_json" JSONB,
  "receipt_artifact_json" JSONB,
  "receipt_readback_content_canonical_json" TEXT,
  "receipt_readback_canonical_json" TEXT,
  "receipt_readback_json" JSONB,
  "receipt_readback_artifact_json" JSONB,
  "completed_at" TIMESTAMPTZ(3),
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT transaction_timestamp(),
  "registered_by" TEXT NOT NULL DEFAULT CURRENT_USER,
  CONSTRAINT "outcome_valuation_output_custody_scope_key"
    UNIQUE ("environment", "valuation_output_inventory_id"),
  CONSTRAINT "outcome_valuation_output_custody_shape_check" CHECK (
    "operation_id" ~ '^valuation-output-custody-operation:[a-f0-9]{64}$' AND
    "valuation_output_inventory_id" ~ '^valuation-output-inventory:[a-f0-9]{64}$' AND
    "output_set_sha256" ~ '^[a-f0-9]{64}$' AND
    "artifact_count" > 0 AND
    "repository_assurance" IN ('fixture_memory','durable_object_storage') AND
    (
      ("repository_assurance"='fixture_memory' AND "environment"='test_fixture'
        AND "custody_profile_id" IS NULL) OR
      ("repository_assurance"='durable_object_storage'
        AND "custody_profile_id" ~ '^artifact-custody-profile:[a-f0-9]{64}$')
    ) AND
    "status" IN ('open','completed') AND
    (
      ("status"='open' AND "receipt_id" IS NULL
        AND "receipt_content_canonical_json" IS NULL
        AND "receipt_canonical_json" IS NULL AND "receipt_json" IS NULL
        AND "receipt_artifact_json" IS NULL
        AND "receipt_readback_content_canonical_json" IS NULL
        AND "receipt_readback_canonical_json" IS NULL
        AND "receipt_readback_json" IS NULL
        AND "receipt_readback_artifact_json" IS NULL AND "completed_at" IS NULL) OR
      ("status"='completed' AND "receipt_id" IS NOT NULL
        AND "receipt_content_canonical_json" IS NOT NULL
        AND "receipt_canonical_json" IS NOT NULL AND "receipt_json" IS NOT NULL
        AND "receipt_artifact_json" IS NOT NULL
        AND "receipt_readback_content_canonical_json" IS NOT NULL
        AND "receipt_readback_canonical_json" IS NOT NULL
        AND "receipt_readback_json" IS NOT NULL
        AND "receipt_readback_artifact_json" IS NOT NULL AND "completed_at" IS NOT NULL)
    )
  )
);

CREATE INDEX "outcome_valuation_output_custody_status_idx"
  ON "outcome_valuation_output_custody_operation"("environment","status","verified_at");

CREATE FUNCTION "validate_outcome_valuation_output_custody_insert"() RETURNS TRIGGER AS $$
DECLARE content JSONB;
BEGIN
  content := NEW."operation_json"->'content';
  IF NEW."operation_content_canonical_json"::jsonb IS DISTINCT FROM content OR
     NEW."operation_canonical_json"::jsonb IS DISTINCT FROM NEW."operation_json" OR
     NEW."operation_id" <> 'valuation-output-custody-operation:' ||
       encode(sha256(convert_to(NEW."operation_content_canonical_json",'UTF8')),'hex') OR
     NEW."operation_json"->>'operationId' IS DISTINCT FROM NEW."operation_id" OR
     content->>'schemaVersion' IS DISTINCT FROM
       'afl-trade-valuation-output-custody-operation/v1' OR
     content->>'environment' IS DISTINCT FROM NEW."environment"::text OR
     content->>'valuationOutputInventoryId' IS DISTINCT FROM
       NEW."valuation_output_inventory_id" OR
     content->>'outputSetSha256' IS DISTINCT FROM NEW."output_set_sha256" OR
     content->>'repositoryAssurance' IS DISTINCT FROM NEW."repository_assurance" OR
     content->'custodyProfileId' IS DISTINCT FROM
       COALESCE(to_jsonb(NEW."custody_profile_id"),'null'::jsonb) OR
     (content->>'artifactCount')::integer IS DISTINCT FROM NEW."artifact_count" OR
     (content->>'verifiedAt')::timestamptz IS DISTINCT FROM NEW."verified_at" OR
     NEW."verified_at" IS DISTINCT FROM
       date_trunc('milliseconds',transaction_timestamp()) OR
     NEW."status" <> 'open' THEN
    RAISE EXCEPTION 'Valuation-output custody operation identity or trusted scope mismatch';
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Valuation-output custody operation contains invalid typed content';
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "validate_outcome_valuation_output_custody_completion"() RETURNS TRIGGER AS $$
DECLARE receipt_content JSONB; readback_content JSONB; receipt_sha TEXT; readback_sha TEXT;
BEGIN
  IF ROW(
       NEW."operation_id",NEW."environment",NEW."valuation_output_inventory_id",
       NEW."output_set_sha256",NEW."repository_assurance",NEW."custody_profile_id",
       NEW."artifact_count",NEW."verified_at",NEW."operation_canonical_json",
       NEW."operation_content_canonical_json",NEW."operation_json",
       NEW."registered_at",NEW."registered_by"
     ) IS DISTINCT FROM ROW(
       OLD."operation_id",OLD."environment",OLD."valuation_output_inventory_id",
       OLD."output_set_sha256",OLD."repository_assurance",OLD."custody_profile_id",
       OLD."artifact_count",OLD."verified_at",OLD."operation_canonical_json",
       OLD."operation_content_canonical_json",OLD."operation_json",
       OLD."registered_at",OLD."registered_by"
     ) OR OLD."status" <> 'open' OR NEW."status" <> 'completed' THEN
    RAISE EXCEPTION 'Valuation-output custody permits only one exact open-to-completed transition';
  END IF;

  receipt_content := NEW."receipt_json"->'content';
  readback_content := NEW."receipt_readback_json"->'content';
  receipt_sha := encode(sha256(convert_to(NEW."receipt_canonical_json",'UTF8')),'hex');
  readback_sha := encode(sha256(convert_to(NEW."receipt_readback_canonical_json",'UTF8')),'hex');

  IF NEW."completed_at" IS DISTINCT FROM
       date_trunc('milliseconds',transaction_timestamp()) OR
     NEW."completed_at" < NEW."verified_at" OR
     NEW."receipt_content_canonical_json"::jsonb IS DISTINCT FROM receipt_content OR
     NEW."receipt_canonical_json"::jsonb IS DISTINCT FROM NEW."receipt_json" OR
     NEW."receipt_id" <> 'valuation-output-custody:' ||
       encode(sha256(convert_to(NEW."receipt_content_canonical_json",'UTF8')),'hex') OR
     NEW."receipt_json"->>'receiptId' IS DISTINCT FROM NEW."receipt_id" OR
     receipt_content->>'schemaVersion' IS DISTINCT FROM
       'afl-trade-valuation-output-custody/v1' OR
     receipt_content->>'environment' IS DISTINCT FROM NEW."environment"::text OR
     receipt_content->>'operationId' IS DISTINCT FROM NEW."operation_id" OR
     receipt_content->'operation' IS DISTINCT FROM NEW."operation_json" OR
     receipt_content->>'valuationOutputInventoryId' IS DISTINCT FROM
       NEW."valuation_output_inventory_id" OR
     (receipt_content->>'artifactCount')::integer IS DISTINCT FROM NEW."artifact_count" OR
     jsonb_array_length(receipt_content->'artifacts') IS DISTINCT FROM NEW."artifact_count" OR
     (receipt_content->>'verifiedAt')::timestamptz IS DISTINCT FROM NEW."verified_at" OR
     receipt_content->>'verification' IS DISTINCT FROM
       'exact_replay_then_immutable_readback' OR
     receipt_content->'publicationEligible' IS DISTINCT FROM 'false'::jsonb OR
     NEW."receipt_artifact_json"->>'contentSha256' IS DISTINCT FROM receipt_sha OR
     NEW."receipt_artifact_json"->>'artifactId' IS DISTINCT FROM 'artifact:' || receipt_sha OR
     NEW."receipt_artifact_json"->>'storageUri' IS DISTINCT FROM
       'artifact://sha256/' || receipt_sha OR
     NEW."receipt_artifact_json"->>'mediaType' IS DISTINCT FROM 'application/json' OR
     (NEW."receipt_artifact_json"->>'byteLength')::integer IS DISTINCT FROM
       octet_length(convert_to(NEW."receipt_canonical_json",'UTF8')) OR
     (NEW."receipt_artifact_json"->>'createdAt')::timestamptz IS DISTINCT FROM
       NEW."verified_at" THEN
    RAISE EXCEPTION 'Valuation-output custody receipt identity or operation binding mismatch';
  END IF;

  IF NEW."receipt_readback_content_canonical_json"::jsonb IS DISTINCT FROM readback_content OR
     NEW."receipt_readback_canonical_json"::jsonb IS DISTINCT FROM
       NEW."receipt_readback_json" OR
     NEW."receipt_readback_json"->>'receiptId' IS DISTINCT FROM
       'artifact-readback:' ||
         encode(sha256(convert_to(NEW."receipt_readback_content_canonical_json",'UTF8')),'hex') OR
     readback_content->>'schemaVersion' IS DISTINCT FROM 'afl-trade-artifact-readback/v4' OR
     readback_content->'artifact' IS DISTINCT FROM NEW."receipt_artifact_json" OR
     readback_content->>'repositoryAssurance' IS DISTINCT FROM NEW."repository_assurance" OR
     readback_content->>'artifactClass' IS DISTINCT FROM 'derived_private' OR
     readback_content->'custodyProfileId' IS DISTINCT FROM
       COALESCE(to_jsonb(NEW."custody_profile_id"),'null'::jsonb) OR
     readback_content->>'custodyEnvironment' IS DISTINCT FROM NEW."environment"::text OR
     (readback_content->>'verifiedAt')::timestamptz IS DISTINCT FROM NEW."verified_at" OR
     readback_content->>'verification' IS DISTINCT FROM
       'exact_reference_and_sha256_bytes' OR
     readback_content->>'status' IS DISTINCT FROM 'passed' OR
     NEW."receipt_readback_artifact_json"->>'contentSha256' IS DISTINCT FROM readback_sha OR
     NEW."receipt_readback_artifact_json"->>'artifactId' IS DISTINCT FROM
       'artifact:' || readback_sha OR
     NEW."receipt_readback_artifact_json"->>'storageUri' IS DISTINCT FROM
       'artifact://sha256/' || readback_sha OR
     NEW."receipt_readback_artifact_json"->>'mediaType' IS DISTINCT FROM
       'application/json' OR
     (NEW."receipt_readback_artifact_json"->>'byteLength')::integer IS DISTINCT FROM
       octet_length(convert_to(NEW."receipt_readback_canonical_json",'UTF8')) OR
     (NEW."receipt_readback_artifact_json"->>'createdAt')::timestamptz IS DISTINCT FROM
       NEW."verified_at" THEN
    RAISE EXCEPTION 'Valuation-output custody terminal readback identity mismatch';
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Valuation-output custody completion contains invalid typed content';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_valuation_output_custody_insert_guard"
  BEFORE INSERT ON "outcome_valuation_output_custody_operation"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_valuation_output_custody_insert"();

CREATE TRIGGER "outcome_valuation_output_custody_completion_guard"
  BEFORE UPDATE ON "outcome_valuation_output_custody_operation"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_valuation_output_custody_completion"();

CREATE TRIGGER "outcome_valuation_output_custody_delete_guard"
  BEFORE DELETE ON "outcome_valuation_output_custody_operation"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_valuation_dataset_mutation"();
