CREATE OR REPLACE FUNCTION "validate_outcome_local_private_trade_evaluation_generation_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE content JSONB;
BEGIN
  content := NEW.generation_json->'content';
  IF NEW.generation_json->>'generationId' IS DISTINCT FROM NEW.generation_id
     OR content->>'schemaVersion' NOT IN (
       'local-private-trade-evaluation-generation/v1',
       'local-private-trade-evaluation-generation/v2'
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
  THEN
    RAISE EXCEPTION 'Local private trade evaluation generation failed exact column authentication';
  END IF;
  RETURN NEW;
END $$;
