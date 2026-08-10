ALTER TABLE "outcome_valuation_output_custody_operation"
  ADD CONSTRAINT "outcome_valuation_output_custody_operation_receipt_key"
  UNIQUE ("operation_id", "receipt_id");

CREATE FUNCTION "outcome_afl_trade_canonical_json"(value JSONB) RETURNS TEXT AS $$
DECLARE value_type TEXT;
BEGIN
  value_type:=jsonb_typeof(value);
  IF value_type='object' THEN
    RETURN '{' || COALESCE((SELECT string_agg(
      to_json(key)::text || ':' || "outcome_afl_trade_canonical_json"(item),
      ',' ORDER BY key COLLATE "C") FROM jsonb_each(value) entry(key,item)), '') || '}';
  ELSIF value_type='array' THEN
    RETURN '[' || COALESCE((SELECT string_agg(
      "outcome_afl_trade_canonical_json"(item),',' ORDER BY ordinal)
      FROM jsonb_array_elements(value) WITH ORDINALITY entry(item,ordinal)), '') || ']';
  ELSIF value_type='string' THEN
    RETURN to_json(value#>>'{}')::text;
  END IF;
  RETURN value::text;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

CREATE TABLE "outcome_valuation_output_custody_index" (
  "custody_index_id" TEXT PRIMARY KEY,
  "environment" "OutcomeEnvironment" NOT NULL,
  "valuation_bundle_id" TEXT NOT NULL,
  "inventory_index_id" TEXT NOT NULL,
  "scope_key" TEXT NOT NULL,
  "value_unit_id" TEXT NOT NULL,
  "entry_count" INTEGER NOT NULL,
  "custody_receipt_set_sha256" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "index_content_canonical_json" TEXT NOT NULL,
  "index_canonical_json" TEXT NOT NULL,
  "index_json" JSONB NOT NULL,
  "artifact_json" JSONB NOT NULL,
  "finalized_at" TIMESTAMPTZ(3),
  CONSTRAINT "outcome_valuation_output_custody_index_scope_key"
    UNIQUE ("environment", "valuation_bundle_id", "inventory_index_id"),
  CONSTRAINT "outcome_valuation_output_custody_index_shape_check" CHECK (
    "custody_index_id" ~ '^valuation-output-custody-index:[a-f0-9]{64}$' AND
    "valuation_bundle_id" ~ '^valuation-bundle:[a-f0-9]{64}$' AND
    "inventory_index_id" ~ '^valuation-output-inventory-index:[a-f0-9]{64}$' AND
    "entry_count" > 0 AND
    "custody_receipt_set_sha256" ~ '^[a-f0-9]{64}$' AND
    jsonb_typeof("index_json") = 'object' AND
    jsonb_typeof("artifact_json") = 'object' AND
    ("finalized_at" IS NULL OR "finalized_at" >= "created_at")
  )
);

CREATE INDEX "outcome_valuation_output_custody_index_scope_idx"
  ON "outcome_valuation_output_custody_index"("environment","scope_key","created_at");

CREATE TABLE "outcome_valuation_output_custody_index_entry" (
  "custody_index_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "trade_id" TEXT NOT NULL,
  "valuation_case_id" TEXT NOT NULL,
  "valuation_output_inventory_id" TEXT NOT NULL,
  "operation_id" TEXT NOT NULL,
  "receipt_id" TEXT NOT NULL,
  "entry_json" JSONB NOT NULL,
  CONSTRAINT "outcome_valuation_output_custody_index_entry_pkey"
    PRIMARY KEY ("custody_index_id", "ordinal"),
  CONSTRAINT "outcome_valuation_output_custody_index_trade_key"
    UNIQUE ("custody_index_id", "trade_id"),
  CONSTRAINT "outcome_valuation_output_custody_index_operation_key"
    UNIQUE ("custody_index_id", "operation_id"),
  CONSTRAINT "outcome_valuation_output_custody_index_receipt_key"
    UNIQUE ("custody_index_id", "receipt_id"),
  CONSTRAINT "outcome_valuation_output_custody_index_entry_shape_check" CHECK (
    "ordinal" >= 0 AND
    "valuation_case_id" ~ '^valuation-case:[a-f0-9]{64}$' AND
    "valuation_output_inventory_id" ~ '^valuation-output-inventory:[a-f0-9]{64}$' AND
    "operation_id" ~ '^valuation-output-custody-operation:[a-f0-9]{64}$' AND
    "receipt_id" ~ '^valuation-output-custody:[a-f0-9]{64}$' AND
    jsonb_typeof("entry_json") = 'object'
  ),
  CONSTRAINT "outcome_valuation_output_custody_index_entry_parent_fkey"
    FOREIGN KEY ("custody_index_id")
    REFERENCES "outcome_valuation_output_custody_index"("custody_index_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outcome_valuation_output_custody_index_entry_operation_fkey"
    FOREIGN KEY ("operation_id", "receipt_id")
    REFERENCES "outcome_valuation_output_custody_operation"("operation_id", "receipt_id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE FUNCTION "validate_outcome_valuation_output_custody_index_insert"() RETURNS TRIGGER AS $$
DECLARE content JSONB; artifact_sha TEXT;
BEGIN
  content := NEW."index_json"->'content';
  artifact_sha := encode(sha256(convert_to(NEW."index_canonical_json",'UTF8')),'hex');
  IF NEW."finalized_at" IS NOT NULL OR
     NEW."index_content_canonical_json" IS DISTINCT FROM
       "outcome_afl_trade_canonical_json"(content) OR
     NEW."index_canonical_json" IS DISTINCT FROM
       "outcome_afl_trade_canonical_json"(NEW."index_json") OR
     NEW."index_content_canonical_json"::jsonb IS DISTINCT FROM content OR
     NEW."index_canonical_json"::jsonb IS DISTINCT FROM NEW."index_json" OR
     NEW."custody_index_id" <> 'valuation-output-custody-index:' ||
       encode(sha256(convert_to(NEW."index_content_canonical_json",'UTF8')),'hex') OR
     NEW."index_json"->>'valuationOutputCustodyIndexId' IS DISTINCT FROM
       NEW."custody_index_id" OR
     content->>'schemaVersion' IS DISTINCT FROM
       'afl-trade-valuation-output-custody-index/v1' OR
     content->>'environment' IS DISTINCT FROM NEW."environment"::text OR
     content->>'valuationBundleId' IS DISTINCT FROM NEW."valuation_bundle_id" OR
     content->'valuationOutputInventoryIndex'->>'valuationOutputInventoryIndexId'
       IS DISTINCT FROM NEW."inventory_index_id" OR
     content->>'scopeKey' IS DISTINCT FROM NEW."scope_key" OR
     content->>'valueUnitId' IS DISTINCT FROM NEW."value_unit_id" OR
     (content->>'entryCount')::integer IS DISTINCT FROM NEW."entry_count" OR
     content->>'custodyReceiptSetSha256' IS DISTINCT FROM
       NEW."custody_receipt_set_sha256" OR
     (content->>'createdAt')::timestamptz IS DISTINCT FROM NEW."created_at" OR
     content->>'ordering' IS DISTINCT FROM 'trade_id_code_unit_ascending' OR
     content->>'verification' IS DISTINCT FROM
       'exact_inventory_index_to_completed_custody_set' OR
     content->'publicationEligible' IS DISTINCT FROM 'false'::jsonb OR
     jsonb_array_length(content->'entries') IS DISTINCT FROM NEW."entry_count" OR
     NEW."artifact_json"->>'contentSha256' IS DISTINCT FROM artifact_sha OR
     NEW."artifact_json"->>'artifactId' IS DISTINCT FROM 'artifact:' || artifact_sha OR
     NEW."artifact_json"->>'storageUri' IS DISTINCT FROM
       'artifact://sha256/' || artifact_sha OR
     NEW."artifact_json"->>'mediaType' IS DISTINCT FROM 'application/json' OR
     (NEW."artifact_json"->>'byteLength')::integer IS DISTINCT FROM
       octet_length(convert_to(NEW."index_canonical_json",'UTF8')) OR
     (NEW."artifact_json"->>'createdAt')::timestamptz IS DISTINCT FROM NEW."created_at" THEN
    RAISE EXCEPTION 'Valuation-output custody index identity or artifact mismatch';
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR
  numeric_value_out_of_range OR null_value_not_allowed THEN
  RAISE EXCEPTION 'Valuation-output custody index contains invalid typed content';
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "validate_outcome_valuation_output_custody_index_entry_insert"() RETURNS TRIGGER AS $$
DECLARE parent "outcome_valuation_output_custody_index"%ROWTYPE;
        operation "outcome_valuation_output_custody_operation"%ROWTYPE;
        receipt_content JSONB;
BEGIN
  SELECT * INTO STRICT parent FROM "outcome_valuation_output_custody_index"
   WHERE "custody_index_id"=NEW."custody_index_id" FOR UPDATE;
  SELECT * INTO STRICT operation FROM "outcome_valuation_output_custody_operation"
   WHERE "operation_id"=NEW."operation_id" AND "receipt_id"=NEW."receipt_id";
  receipt_content := operation."receipt_json"->'content';
  IF parent."finalized_at" IS NOT NULL OR
     parent."index_json"->'content'->'entries'->NEW."ordinal"
       IS DISTINCT FROM NEW."entry_json" OR
     NEW."entry_json"->>'tradeId' IS DISTINCT FROM NEW."trade_id" OR
     NEW."entry_json"->>'valuationCaseId' IS DISTINCT FROM NEW."valuation_case_id" OR
     NEW."entry_json"->>'valuationOutputInventoryId' IS DISTINCT FROM
       NEW."valuation_output_inventory_id" OR
     NEW."entry_json"->>'operationId' IS DISTINCT FROM NEW."operation_id" OR
     NEW."entry_json"->>'receiptId' IS DISTINCT FROM NEW."receipt_id" OR
     operation."status" <> 'completed' OR
     operation."environment" IS DISTINCT FROM parent."environment" OR
     operation."valuation_output_inventory_id" IS DISTINCT FROM
       NEW."valuation_output_inventory_id" OR
     receipt_content->>'environment' IS DISTINCT FROM parent."environment"::text OR
     receipt_content->>'valuationBundleId' IS DISTINCT FROM parent."valuation_bundle_id" OR
     receipt_content->>'tradeId' IS DISTINCT FROM NEW."trade_id" OR
     receipt_content->>'valuationCaseId' IS DISTINCT FROM NEW."valuation_case_id" OR
     receipt_content->>'valuationOutputInventoryId' IS DISTINCT FROM
       NEW."valuation_output_inventory_id" OR
     receipt_content->>'valueUnitId' IS DISTINCT FROM parent."value_unit_id" OR
     receipt_content->>'operationId' IS DISTINCT FROM NEW."operation_id" OR
     NEW."entry_json"->'receiptArtifactRef' IS DISTINCT FROM
       operation."receipt_artifact_json" OR
     NEW."entry_json"->'receiptReadbackArtifactRef' IS DISTINCT FROM
       operation."receipt_readback_artifact_json" OR
     (NEW."entry_json"->>'verifiedAt')::timestamptz IS DISTINCT FROM
       operation."verified_at" OR
     NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(receipt_content->'artifacts') artifact
        WHERE artifact->>'role'='valuation_output_inventory'
          AND artifact->>'semanticId'=NEW."valuation_output_inventory_id"
          AND artifact->'artifact' IS NOT DISTINCT FROM
            NEW."entry_json"->'inventoryArtifactRef'
     ) THEN
    RAISE EXCEPTION 'Valuation-output custody-index entry is not exact completed custody evidence';
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR
  numeric_value_out_of_range OR no_data_found THEN
  RAISE EXCEPTION 'Valuation-output custody-index entry contains invalid evidence';
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "finalize_outcome_valuation_output_custody_index"() RETURNS TRIGGER AS $$
DECLARE stored_count INTEGER; stored_entries JSONB;
BEGIN
  IF ROW(NEW."custody_index_id",NEW."environment",NEW."valuation_bundle_id",
         NEW."inventory_index_id",NEW."scope_key",NEW."value_unit_id",NEW."entry_count",
         NEW."custody_receipt_set_sha256",NEW."created_at",
         NEW."index_content_canonical_json",NEW."index_canonical_json",NEW."index_json",
         NEW."artifact_json") IS DISTINCT FROM
     ROW(OLD."custody_index_id",OLD."environment",OLD."valuation_bundle_id",
         OLD."inventory_index_id",OLD."scope_key",OLD."value_unit_id",OLD."entry_count",
         OLD."custody_receipt_set_sha256",OLD."created_at",
         OLD."index_content_canonical_json",OLD."index_canonical_json",OLD."index_json",
         OLD."artifact_json") OR
     OLD."finalized_at" IS NOT NULL OR
     NEW."finalized_at" IS DISTINCT FROM
       date_trunc('milliseconds',transaction_timestamp()) THEN
    RAISE EXCEPTION 'Valuation-output custody index permits only trusted finalization';
  END IF;
  SELECT count(*)::integer, COALESCE(jsonb_agg("entry_json" ORDER BY "ordinal"),'[]'::jsonb)
    INTO stored_count, stored_entries
    FROM "outcome_valuation_output_custody_index_entry"
   WHERE "custody_index_id"=NEW."custody_index_id";
  IF stored_count IS DISTINCT FROM NEW."entry_count" OR
     stored_entries IS DISTINCT FROM NEW."index_json"->'content'->'entries' OR
     encode(sha256(convert_to("outcome_afl_trade_canonical_json"(stored_entries),'UTF8')),'hex')
       IS DISTINCT FROM NEW."custody_receipt_set_sha256" THEN
    RAISE EXCEPTION 'Valuation-output custody index does not have its exact ordered entry set';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_valuation_output_custody_index_insert_guard"
  BEFORE INSERT ON "outcome_valuation_output_custody_index"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_valuation_output_custody_index_insert"();
CREATE TRIGGER "outcome_valuation_output_custody_index_entry_insert_guard"
  BEFORE INSERT ON "outcome_valuation_output_custody_index_entry"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_valuation_output_custody_index_entry_insert"();
CREATE TRIGGER "outcome_valuation_output_custody_index_finalize_guard"
  BEFORE UPDATE ON "outcome_valuation_output_custody_index"
  FOR EACH ROW EXECUTE FUNCTION "finalize_outcome_valuation_output_custody_index"();
CREATE TRIGGER "outcome_valuation_output_custody_index_delete_guard"
  BEFORE DELETE ON "outcome_valuation_output_custody_index"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_valuation_dataset_mutation"();
CREATE TRIGGER "outcome_valuation_output_custody_index_entry_append_only"
  BEFORE UPDATE OR DELETE ON "outcome_valuation_output_custody_index_entry"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_valuation_dataset_mutation"();

ALTER TABLE "outcome_valuation_publication_manifest"
  ADD COLUMN "custody_index_id" TEXT;
ALTER TABLE "outcome_valuation_projection_manifest"
  ADD COLUMN "custody_index_id" TEXT;
ALTER TABLE "outcome_valuation_publication_manifest"
  ADD CONSTRAINT "outcome_valuation_publication_custody_index_fkey"
  FOREIGN KEY ("custody_index_id")
  REFERENCES "outcome_valuation_output_custody_index"("custody_index_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outcome_valuation_projection_manifest"
  ADD CONSTRAINT "outcome_valuation_projection_custody_index_fkey"
  FOREIGN KEY ("custody_index_id")
  REFERENCES "outcome_valuation_output_custody_index"("custody_index_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "outcome_valuation_publication_manifest"
  DROP CONSTRAINT "outcome_valuation_publication_json_check";
ALTER TABLE "outcome_valuation_publication_manifest"
  ADD CONSTRAINT "outcome_valuation_publication_json_check" CHECK (
    jsonb_typeof("manifest_json")='object' AND
    "manifest_json"->>'publicationId'="publication_id" AND
    "manifest_json"->'content'->>'scopeKey'="scope_key" AND
    ("manifest_json"->'content'->>'createdAt')::timestamptz="created_at" AND
    (
      ("manifest_json"->'content'->>'schemaVersion' IN
        ('afl-trade-publication/v2','afl-trade-publication/v3') AND
       "custody_index_id" IS NULL) OR
      ("manifest_json"->'content'->>'schemaVersion'='afl-trade-publication/v4' AND
       "custody_index_id" IS NOT NULL AND
       "manifest_json"->'content'->'valuationOutputCustodyIndex'->>
         'valuationOutputCustodyIndexId'="custody_index_id")
    )
  );

ALTER TABLE "outcome_valuation_projection_manifest"
  DROP CONSTRAINT "outcome_valuation_projection_json_check";
ALTER TABLE "outcome_valuation_projection_manifest"
  ADD CONSTRAINT "outcome_valuation_projection_json_check" CHECK (
    jsonb_typeof("manifest_json")='object' AND
    "manifest_json"->>'projectionId'="projection_id" AND
    "manifest_json"->'content'->>'publicationId'="publication_id" AND
    ("manifest_json"->'content'->>'createdAt')::timestamptz="created_at" AND
    (
      ("manifest_json"->'content'->>'schemaVersion' IN
        ('afl-trade-projection/v1','afl-trade-projection/v2') AND
       "custody_index_id" IS NULL) OR
      ("manifest_json"->'content'->>'schemaVersion'='afl-trade-projection/v3' AND
       "custody_index_id" IS NOT NULL AND
       "manifest_json"->'content'->'valuationOutputCustodyIndex'->>
         'valuationOutputCustodyIndexId'="custody_index_id")
    )
  );

CREATE FUNCTION "validate_outcome_valuation_publication_custody"() RETURNS TRIGGER AS $$
DECLARE custody "outcome_valuation_output_custody_index"%ROWTYPE; binding JSONB;
BEGIN
  IF NEW."custody_index_id" IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO STRICT custody FROM "outcome_valuation_output_custody_index"
   WHERE "custody_index_id"=NEW."custody_index_id";
  binding := NEW."manifest_json"->'content'->'valuationOutputCustodyIndex';
  IF custody."finalized_at" IS NULL OR
     custody."environment"::text IS DISTINCT FROM
       NEW."manifest_json"->'content'->>'environment' OR
     custody."valuation_bundle_id" IS DISTINCT FROM
       NEW."manifest_json"->'content'->>'valuationBundleId' OR
     custody."scope_key" IS DISTINCT FROM NEW."scope_key" OR
     custody."value_unit_id" IS DISTINCT FROM
       NEW."manifest_json"->'content'->>'valueUnitId' OR
     custody."entry_count" IS DISTINCT FROM
       (NEW."manifest_json"->'content'->>'entryCount')::integer OR
     binding->>'schemaVersion' IS DISTINCT FROM
       custody."index_json"->'content'->>'schemaVersion' OR
     binding->'artifactRef' IS DISTINCT FROM custody."artifact_json" OR
     binding->>'valuationBundleId' IS DISTINCT FROM custody."valuation_bundle_id" OR
     binding->>'valuationOutputInventoryIndexId' IS DISTINCT FROM
       custody."inventory_index_id" OR
     binding->>'custodyReceiptSetSha256' IS DISTINCT FROM
       custody."custody_receipt_set_sha256" OR
     (binding->>'entryCount')::integer IS DISTINCT FROM custody."entry_count" OR
     custody."created_at" > NEW."created_at" THEN
    RAISE EXCEPTION 'Valuation publication does not bind one exact finalized custody index';
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR no_data_found THEN
  RAISE EXCEPTION 'Valuation publication contains invalid custody-index evidence';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_valuation_publication_custody_insert_guard"
  BEFORE INSERT ON "outcome_valuation_publication_manifest"
  FOR EACH ROW EXECUTE FUNCTION "validate_outcome_valuation_publication_custody"();

CREATE OR REPLACE FUNCTION "validate_outcome_valuation_projection_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE publication_row "outcome_valuation_publication_manifest"%ROWTYPE;
        artifact_row "outcome_artifact_custody"%ROWTYPE;
BEGIN
  SELECT * INTO STRICT publication_row FROM "outcome_valuation_publication_manifest"
   WHERE "publication_id"=NEW."publication_id";
  SELECT * INTO STRICT artifact_row FROM "outcome_artifact_custody"
   WHERE "artifact_id"=NEW."artifact_id";
  IF NEW."created_at" < publication_row."created_at" OR
     NEW."manifest_json"->'content'->>'scopeKey' <> publication_row."scope_key" OR
     artifact_row."artifact_class" <> 'public_projection'::"OutcomeArtifactClass" OR
     artifact_row."environment"::text <>
       publication_row."manifest_json"->'content'->>'environment' OR
     artifact_row."verified_at" > NEW."created_at" OR
     NEW."custody_index_id" IS DISTINCT FROM publication_row."custody_index_id" OR
     (NEW."custody_index_id" IS NOT NULL AND
      NEW."manifest_json"->'content'->'valuationOutputCustodyIndex' IS DISTINCT FROM
      publication_row."manifest_json"->'content'->'valuationOutputCustodyIndex') THEN
    RAISE EXCEPTION 'Valuation projection does not match its publication and verified custody';
  END IF;
  RETURN NEW;
END;
$$;
