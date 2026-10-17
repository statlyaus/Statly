-- Pick-identity rule 5 (migration 0273, statlyaus/Statly#853) reads a Footyinfo board pick's
-- `routeClubIds`, which the reconciler leaves JSON null when a route club has no reviewed resolution.
-- The rule guarded `jsonb_array_length` with `jsonb_typeof(...)='array'` in the same AND list, but SQL
-- fixes no evaluation order, and finalizing a 2025 candidate with null routes failed with 22023
-- "cannot get array length of a scalar". Both length reads now sit inside a CASE on the type, so a
-- record with an unresolved route is skipped, as the rule intends, and an array route is checked as
-- before. Replaced by the exact-anchor pattern of migrations 0264, 0272 and 0273: each fragment must
-- occur exactly once in the deployed function.
DO $migration$
DECLARE definition TEXT;
 length_guard CONSTANT TEXT := $old$jsonb_typeof(board->'routeClubIds')='array' AND jsonb_array_length(board->'routeClubIds')>=2$old$;
 hop_series CONSTANT TEXT := $old$generate_series(1,jsonb_array_length(board->'routeClubIds')-1)$old$;
 route_length CONSTANT TEXT := $new$CASE WHEN jsonb_typeof(board->'routeClubIds')='array' THEN jsonb_array_length(board->'routeClubIds') ELSE 0 END$new$;
BEGIN
 definition:=pg_get_functiondef('finalize_outcome_external_reconciliation_candidate()'::regprocedure);
 IF (length(definition)-length(replace(definition,length_guard,'')))/length(length_guard)<>1
 THEN RAISE EXCEPTION 'Expected the exact rule 5 route-length guard in finalize_outcome_external_reconciliation_candidate'; END IF;
 IF (length(definition)-length(replace(definition,hop_series,'')))/length(hop_series)<>1
 THEN RAISE EXCEPTION 'Expected the exact rule 5 route-hop series in finalize_outcome_external_reconciliation_candidate'; END IF;
 definition:=replace(definition,length_guard,route_length||'>=2');
 definition:=replace(definition,hop_series,'generate_series(1,'||route_length||'-1)');
 EXECUTE definition;
END $migration$;
