-- Private historical HPN season PAV: let a source-first projected field map for AFLM 2011-2024
-- carry a season-only scope key, `afl-men:hpn-pav-season-<YYYY>`.
--
-- outcome_hpn_source_first_projected_map_is_exact (0131, 0137) binds every assessment's
-- valuationScopeKey to the capture season through outcome_private_valuation_hpn_scope_season, which
-- only knows the two trade-valuation scopes (2025, 2026). A governed season PAV calculation for any
-- earlier season therefore could never admit its field maps, even with current rights, reviewed
-- captures and reviewed identities.
--
-- This does NOT widen the valuation scope policy: outcome_private_valuation_hpn_scope_season and
-- every valuation consumer that calls it (source admission, dispatch capture, factual output) are
-- unchanged, so a historical-season map can never be admitted into a trade valuation. Only the
-- projected-map verifier used by the HPN season input build accepts the new keys, and only for the
-- exact season the key names. The two trade scopes resolve exactly as before.
CREATE FUNCTION outcome_hpn_pav_historical_season_scope_season(target_scope_key TEXT)
RETURNS INTEGER LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE
    WHEN target_scope_key ~ '^afl-men:hpn-pav-season-[0-9]{4}$'
     AND substring(target_scope_key FROM '([0-9]{4})$')::INTEGER BETWEEN 2011 AND 2024
    THEN substring(target_scope_key FROM '([0-9]{4})$')::INTEGER
    ELSE NULL
  END
$$;

DO $$ DECLARE definition TEXT; old_clause TEXT :=
 'outcome_private_valuation_hpn_scope_season(content->>''valuationScopeKey'')=source.anchor_season_year';
BEGIN
 definition:=pg_get_functiondef('outcome_hpn_source_first_projected_map_is_exact(text)'::regprocedure);
 IF position(old_clause IN definition)=0 THEN RAISE EXCEPTION 'Source-first scope verifier drifted'; END IF;
 definition:=replace(definition,old_clause,
  'COALESCE(outcome_private_valuation_hpn_scope_season(content->>''valuationScopeKey''),'
  'outcome_hpn_pav_historical_season_scope_season(content->>''valuationScopeKey''))=source.anchor_season_year');
 EXECUTE definition;
END $$;
