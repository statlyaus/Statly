-- HPN PAV finalization compares stored values with the independent derivation within 1e-9.
--
-- finalize_outcome_hpn_pav_calculation re-derives every league, team and player value in exact
-- NUMERIC and required the stored value to equal it after rounding both to 12 decimal places. The
-- stored values come from double-precision arithmetic, which carries 15-16 significant digits, so on
-- a genuine season (team values near 300, sums over about 10,000 rows) they differ from the exact
-- derivation by about 1e-12 and straddle the twelfth decimal. The first genuine calculation (AFLM
-- 2024) therefore failed with 98 of 676 values differing by at most 1.35e-12 and none by more.
--
-- Each comparison round(stored,12)<>round(expected,12) becomes abs((stored)-(expected))>1e-9. The
-- bound is a thousand times the observed arithmetic noise and nine orders of magnitude below any
-- reported precision, so a genuine value difference is still rejected. Every other condition of the
-- function is unchanged.

DO $migration$
DECLARE definition TEXT; patched TEXT; comparisons INTEGER;
BEGIN
  definition:=pg_get_functiondef('finalize_outcome_hpn_pav_calculation()'::regprocedure);
  -- An argument of round(...,12): any text without parentheses, or balanced groups nested two deep.
  comparisons:=(SELECT count(*) FROM regexp_matches(definition,
    'round\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*),12\)\s*<>\s*round\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*),12\)',
    'g'));
  IF comparisons=0 THEN
    RAISE EXCEPTION 'Expected HPN PAV twelve-decimal comparisons in finalization';
  END IF;
  patched:=regexp_replace(definition,
    'round\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*),12\)\s*<>\s*round\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*),12\)',
    'abs((\1)-(\2))>0.000000001','g');
  IF patched ~ ',12\)\s*<>' THEN
    RAISE EXCEPTION 'An HPN PAV twelve-decimal comparison was not converted';
  END IF;
  IF (SELECT count(*) FROM regexp_matches(patched,'abs\(\(.*?\)-\(.*?\)\)>0\.000000001','g'))<comparisons THEN
    RAISE EXCEPTION 'HPN PAV tolerance comparisons are incomplete';
  END IF;
  EXECUTE patched;
END $migration$;
