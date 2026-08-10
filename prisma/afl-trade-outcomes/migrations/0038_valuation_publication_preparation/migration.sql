CREATE TABLE "outcome_valuation_publication_preparation" (
  "preparation_key" TEXT PRIMARY KEY,
  "custody_index_id" TEXT NOT NULL,
  "environment" "OutcomeEnvironment" NOT NULL,
  "universal_layer" TEXT NOT NULL,
  "candidate_id" TEXT NOT NULL,
  "candidate_content_canonical_json" TEXT NOT NULL,
  "candidate_canonical_json" TEXT NOT NULL,
  "candidate_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT transaction_timestamp(),
  "registered_by" TEXT NOT NULL DEFAULT CURRENT_USER,
  CONSTRAINT "outcome_valuation_publication_preparation_custody_fkey"
    FOREIGN KEY ("custody_index_id")
    REFERENCES "outcome_valuation_output_custody_index"("custody_index_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outcome_valuation_publication_preparation_shape_check" CHECK (
    length("preparation_key") BETWEEN 1 AND 200 AND
    "preparation_key" ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$' AND
    "candidate_id" ~ '^publication:[a-f0-9]{64}$' AND
    "universal_layer" IN ('gross','list_spot_adjusted','scarcity_adjusted') AND
    jsonb_typeof("candidate_json")='object'
  )
);

CREATE INDEX "outcome_valuation_publication_preparation_scope_idx"
  ON "outcome_valuation_publication_preparation"
    ("environment","custody_index_id","universal_layer","created_at");

CREATE FUNCTION "validate_outcome_valuation_publication_preparation_insert"()
RETURNS TRIGGER AS $$
DECLARE custody "outcome_valuation_output_custody_index"%ROWTYPE;
        content JSONB;
        candidate_index JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('valuation-publication-preparation:' || NEW."preparation_key",0)
  );
  SELECT * INTO STRICT custody
    FROM "outcome_valuation_output_custody_index"
   WHERE "custody_index_id"=NEW."custody_index_id"
   FOR SHARE;
  content:=NEW."candidate_json"->'content';
  candidate_index:=content->'valuationOutputInventoryIndex';
  IF custody."finalized_at" IS NULL OR
     NEW."candidate_content_canonical_json" IS DISTINCT FROM
       "outcome_afl_trade_canonical_json"(content) OR
     NEW."candidate_canonical_json" IS DISTINCT FROM
       "outcome_afl_trade_canonical_json"(NEW."candidate_json") OR
     NEW."candidate_content_canonical_json"::jsonb IS DISTINCT FROM content OR
     NEW."candidate_canonical_json"::jsonb IS DISTINCT FROM NEW."candidate_json" OR
     NEW."candidate_id" IS DISTINCT FROM 'publication:' ||
       encode(sha256(convert_to(NEW."candidate_content_canonical_json",'UTF8')),'hex') OR
     NEW."candidate_json"->>'publicationId' IS DISTINCT FROM NEW."candidate_id" OR
     content->>'schemaVersion' IS DISTINCT FROM 'afl-trade-publication/v3' OR
     content->>'environment' IS DISTINCT FROM NEW."environment"::text OR
     content->'projectionPresentationPolicy'->>'universalLayer' IS DISTINCT FROM
       NEW."universal_layer" OR
     (content->>'createdAt')::timestamptz IS DISTINCT FROM NEW."created_at" OR
     (content->'publicationBundleArtifact'->>'createdAt')::timestamptz IS DISTINCT FROM
       NEW."created_at" OR
     custody."created_at" IS DISTINCT FROM NEW."created_at" OR
     custody."environment" IS DISTINCT FROM NEW."environment" OR
     content->>'valuationBundleId' IS DISTINCT FROM custody."valuation_bundle_id" OR
     content->>'scopeKey' IS DISTINCT FROM custody."scope_key" OR
     content->>'valueUnitId' IS DISTINCT FROM custody."value_unit_id" OR
     (content->>'entryCount')::integer IS DISTINCT FROM custody."entry_count" OR
     candidate_index->>'valuationOutputInventoryIndexId' IS DISTINCT FROM
       custody."inventory_index_id" OR
     candidate_index->>'inventorySetSha256' IS DISTINCT FROM
       custody."index_json"->'content'->'valuationOutputInventoryIndex'->>
         'inventorySetSha256' OR
     candidate_index->'artifactRef' IS DISTINCT FROM
       custody."index_json"->'content'->'valuationOutputInventoryIndex'->'artifactRef' THEN
    RAISE EXCEPTION 'Valuation publication preparation does not bind exact completed custody';
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR
  numeric_value_out_of_range OR no_data_found THEN
  RAISE EXCEPTION 'Valuation publication preparation contains invalid typed evidence';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "outcome_valuation_publication_preparation_insert_guard"
  BEFORE INSERT ON "outcome_valuation_publication_preparation"
  FOR EACH ROW EXECUTE FUNCTION
    "validate_outcome_valuation_publication_preparation_insert"();

CREATE TRIGGER "outcome_valuation_publication_preparation_append_only"
  BEFORE UPDATE OR DELETE ON "outcome_valuation_publication_preparation"
  FOR EACH ROW EXECUTE FUNCTION "reject_outcome_append_only_mutation"();
