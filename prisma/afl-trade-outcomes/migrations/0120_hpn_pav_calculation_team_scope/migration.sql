-- A FULL JOIN must receive only this calculation's stored teams. Filtering in
-- its ON clause retains older calculations as false unmatched source rows.
DO $$
DECLARE
  definition TEXT;
  old_fragment CONSTANT TEXT := $old$FULL JOIN "outcome_hpn_pav_calculation_team" stored
      ON expected.team_id=stored."team_id" AND stored."calculation_id"=NEW."calculation_id"$old$;
  new_fragment CONSTANT TEXT := $new$FULL JOIN (
      SELECT * FROM "outcome_hpn_pav_calculation_team"
      WHERE "calculation_id"=NEW."calculation_id"
    ) stored ON expected.team_id=stored."team_id"$new$;
  occurrences INTEGER;
BEGIN
  SELECT pg_get_functiondef(to_regprocedure('finalize_outcome_hpn_pav_calculation()'))
    INTO definition;
  IF definition IS NULL THEN
    RAISE EXCEPTION 'Expected HPN PAV calculation finalizer was not found';
  END IF;
  occurrences := (length(definition)-length(replace(definition,old_fragment,'')))
    /length(old_fragment);
  IF occurrences<>1 THEN
    RAISE EXCEPTION 'Expected exactly one HPN PAV team source comparison; found %',occurrences;
  END IF;
  EXECUTE replace(definition,old_fragment,new_fragment);
END $$;
