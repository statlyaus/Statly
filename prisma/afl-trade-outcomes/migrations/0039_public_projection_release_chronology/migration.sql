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
     artifact_row."created_at" < NEW."created_at" OR
     artifact_row."verified_at" > date_trunc('milliseconds',transaction_timestamp()) OR
     NEW."custody_index_id" IS DISTINCT FROM publication_row."custody_index_id" OR
     (NEW."custody_index_id" IS NOT NULL AND
      NEW."manifest_json"->'content'->'valuationOutputCustodyIndex' IS DISTINCT FROM
      publication_row."manifest_json"->'content'->'valuationOutputCustodyIndex') THEN
    RAISE EXCEPTION 'Valuation projection does not match its publication and verified custody';
  END IF;
  RETURN NEW;
END;
$$;
