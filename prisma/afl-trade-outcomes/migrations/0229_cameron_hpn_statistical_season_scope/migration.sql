-- Permit exact Cameron pilot seasons in the isolated statistical-map verifier.
-- Valuation dispatch scopes and source-use rights remain unchanged; archive-only
-- 2020 captures still fail the verifier's existing Gate 0A and field-rights checks.
DO $$
DECLARE
  definition TEXT;
  previous_scope TEXT :=
    '(content->>''valuationScopeKey''=''cameron-2018-private-pilot'' AND source.anchor_season_year=2018 AND source.capture_id=target_capture_id AND source.normalization_run_id=target_run_id)';
  pilot_scope TEXT :=
    '(content->>''valuationScopeKey''=(''cameron-''||source.anchor_season_year::text||''-private-pilot'') AND source.anchor_season_year IN (2018,2020,2021,2022,2023) AND source.capture_id=target_capture_id AND source.normalization_run_id=target_run_id)';
BEGIN
  definition := pg_get_functiondef(
    'outcome_hpn_statistical_source_map_is_exact(text,text,text)'::regprocedure
  );
  IF (length(definition)-length(replace(definition,previous_scope,'')))/length(previous_scope)<>1
  THEN
    RAISE EXCEPTION 'Expected isolated Cameron statistical-map scope is unavailable';
  END IF;
  EXECUTE replace(definition,previous_scope,pilot_scope);
END $$;
