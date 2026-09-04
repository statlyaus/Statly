-- Keep current-valuation normalization custody aligned with the reviewed AFL Tables player map.
-- Historical v1 runs remain immutable; new current evidence must authenticate the v2 map that
-- retains Brownlow votes.
CREATE OR REPLACE FUNCTION "claim_outcome_current_valuation_evidence_normalization"(
  target_source_key TEXT,
  target_source_content_sha256 TEXT,
  target_authority_sha256 TEXT,
  target_effective_capture_id TEXT,
  target_normalization_run_id TEXT
)
RETURNS TABLE(effective_capture_id TEXT,normalization_run_id TEXT)
LANGUAGE plpgsql AS $$
DECLARE
  expected_provider TEXT;
  expected_capability TEXT;
  expected_season SMALLINT;
  expected_field_map_id TEXT;
  retained RECORD;
BEGIN
  CASE target_source_key
    WHEN 'afl_tables:afl-tables-player-stats:2021' THEN expected_provider:='afl_tables'; expected_capability:='afl-tables-player-stats'; expected_season:=2021; expected_field_map_id:='afl-tables-player-stats-local-2021-v2';
    WHEN 'afl_tables:afl-tables-player-stats:2022' THEN expected_provider:='afl_tables'; expected_capability:='afl-tables-player-stats'; expected_season:=2022; expected_field_map_id:='afl-tables-player-stats-local-2022-v2';
    WHEN 'afl_tables:afl-tables-player-stats:2023' THEN expected_provider:='afl_tables'; expected_capability:='afl-tables-player-stats'; expected_season:=2023; expected_field_map_id:='afl-tables-player-stats-local-2023-v2';
    WHEN 'afl_tables:afl-tables-player-stats:2024' THEN expected_provider:='afl_tables'; expected_capability:='afl-tables-player-stats'; expected_season:=2024; expected_field_map_id:='afl-tables-player-stats-local-2024-v2';
    WHEN 'afl_tables:afl-tables-player-stats:2025' THEN expected_provider:='afl_tables'; expected_capability:='afl-tables-player-stats'; expected_season:=2025; expected_field_map_id:='afl-tables-player-stats-local-2025-v2';
    WHEN 'official_afl:official-afl-player-stats:2026' THEN expected_provider:='official_afl'; expected_capability:='official-afl-player-stats'; expected_season:=2026; expected_field_map_id:='official-afl-player-stats-local-2026-v1';
    WHEN 'afl_tables:afl-tables-results:2026' THEN expected_provider:='afl_tables'; expected_capability:='afl-tables-results'; expected_season:=2026; expected_field_map_id:='afl-tables-results-local-2026-v2';
    ELSE RAISE EXCEPTION 'Current valuation evidence source key is unsupported';
  END CASE;
  IF target_source_content_sha256 !~ '^[a-f0-9]{64}$'
     OR target_authority_sha256 !~ '^[a-f0-9]{64}$'
     OR NOT EXISTS (
       SELECT 1 FROM "outcome_source_capture" capture
       JOIN "outcome_artifact_custody" artifact ON artifact."artifact_id"=capture."source_artifact_id"
       JOIN "outcome_provider_normalization_run" run ON run."capture_id"=capture."capture_id"
       WHERE capture."capture_id"=target_effective_capture_id
         AND capture."environment"='non_production' AND capture."provider"=expected_provider
         AND capture."capability_id"=expected_capability AND capture."anchor_season_year"=expected_season
         AND capture."status"='staged' AND artifact."content_sha256"=target_source_content_sha256
         AND run."normalization_run_id"=target_normalization_run_id
         AND run."field_map_id"=expected_field_map_id
         AND run."status" IN ('staged','needs_review') AND run."finalized_at" IS NOT NULL
     )
     OR NOT EXISTS (
       SELECT 1 FROM "outcome_current_valuation_evidence_source_work" work
       WHERE work."source_key"=target_source_key
         AND work."source_content_sha256"=target_source_content_sha256
         AND work."authority_sha256"=target_authority_sha256
     ) THEN
    RAISE EXCEPTION 'Current valuation normalization claim is missing or mismatched';
  END IF;
  INSERT INTO "outcome_current_valuation_evidence_normalization_claim" VALUES (
    target_source_key,target_source_content_sha256,target_authority_sha256,
    target_effective_capture_id,target_normalization_run_id,statement_timestamp()
  ) ON CONFLICT ("source_key","source_content_sha256","authority_sha256") DO NOTHING;
  SELECT claim.* INTO retained FROM "outcome_current_valuation_evidence_normalization_claim" claim
   WHERE claim."source_key"=target_source_key
     AND claim."source_content_sha256"=target_source_content_sha256
     AND claim."authority_sha256"=target_authority_sha256;
  effective_capture_id:=retained."effective_capture_id";
  normalization_run_id:=retained."normalization_run_id";
  RETURN NEXT;
END $$;

DO $security$
DECLARE schema_name TEXT:=current_schema();
BEGIN
  EXECUTE format(
    'ALTER FUNCTION %I.claim_outcome_current_valuation_evidence_normalization(TEXT,TEXT,TEXT,TEXT,TEXT) SECURITY DEFINER SET search_path TO %I,pg_catalog,pg_temp',
    schema_name,schema_name
  );
END $security$;
