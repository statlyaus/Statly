-- Preserve the core's additive total: normalize each independently derived component
-- to twelve decimal places before summing. Component validation remains unchanged.
DO $$
DECLARE
  definition TEXT;
  old_fragment CONSTANT TEXT :=
    'round(expected.offensive_pav+expected.midfield_pav+expected.defensive_pav,12)';
  new_fragment CONSTANT TEXT :=
    'round(round(expected.offensive_pav,12)+round(expected.midfield_pav,12)+round(expected.defensive_pav,12),12)';
  occurrences INTEGER;
BEGIN
  SELECT pg_get_functiondef(to_regprocedure('finalize_outcome_hpn_pav_calculation()'))
    INTO definition;
  IF definition IS NULL THEN
    RAISE EXCEPTION 'Expected HPN PAV calculation finalizer was not found';
  END IF;
  occurrences := (length(definition)-length(replace(definition,old_fragment,'')))
    /length(old_fragment);
  IF occurrences<>2 THEN
    RAISE EXCEPTION 'Expected exactly two HPN PAV team/player total checks; found %',occurrences;
  END IF;
  EXECUTE replace(definition,old_fragment,new_fragment);
END $$;
