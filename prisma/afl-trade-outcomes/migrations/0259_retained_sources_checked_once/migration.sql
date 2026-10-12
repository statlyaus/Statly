-- Check the promotion's retained sources once per event currency check, not once per joined row.
--
-- outcome_acquisition_promoted_event_current and outcome_acquisition_arrival_event_current filter the
-- promotion's candidate with outcome_external_candidate_retained_sources_current(candidate, cutoff),
-- which re-validates every retained source of the candidate. The check sat inside the large join, so
-- the planner could evaluate it on the candidate scan inside a loop. Since 0258 tied the promoter's
-- authority to review.decided_at, the planner drives that join from the review decisions and the scan
-- runs once per review row: in the reviewed subset promotion suite the check ran for every finalized
-- candidate on every loop (83 loops x 5 candidates), each spell currency check took 18-19 s, and three
-- cases passed their 120 s limit on CI and on main. Declaring the function's cost did not change the
-- plan, so the check moves out of the join instead.
--
-- Equivalence: the join requires candidate.candidate_id = promotion.candidate_id and
-- promotion.promotion_id = binding->>'promotionId', and promotion_id is the primary key, so the only
-- candidate the check can ever apply to is that promotion's. It is now evaluated once, for that
-- candidate, beside the EXISTS. outcome_external_candidate_retained_sources_current returns FALSE for an
-- unknown candidate, so a binding naming no promotion is still FALSE. Every edit is an asserted in-place
-- replacement, as 0247, 0248, 0252, 0254, 0256, 0257 and 0258 do.

CREATE FUNCTION pg_temp.replace_once(target REGPROCEDURE, old TEXT, new TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE definition TEXT;
BEGIN
  definition:=pg_get_functiondef(target);
  IF array_length(string_to_array(definition,old),1)<>2 THEN
    RAISE EXCEPTION 'Expected exactly one fragment in %: %', target, old;
  END IF;
  EXECUTE replace(definition,old,new);
END $$;

DO $migration$
DECLARE fn TEXT;
BEGIN
 FOREACH fn IN ARRAY ARRAY[
   'outcome_acquisition_promoted_event_current(jsonb,text,text,text,text,boolean,timestamp with time zone,timestamp with time zone)',
   'outcome_acquisition_arrival_event_current(jsonb,text,text,text,text,boolean,timestamp with time zone,timestamp with time zone)'] LOOP
   PERFORM pg_temp.replace_once(fn::regprocedure,
     E' AND candidate.status=''finalized'' AND outcome_external_candidate_retained_sources_current(candidate.candidate_id,cutoff)\n',
     E' AND candidate.status=''finalized''\n');
   PERFORM pg_temp.replace_once(fn::regprocedure,
     E'AS $function$\n SELECT EXISTS (\n',
     E'AS $function$\n SELECT outcome_external_candidate_retained_sources_current((SELECT promotion.candidate_id FROM outcome_external_canonical_promotion promotion WHERE promotion.promotion_id=binding->>''promotionId''),cutoff) AND EXISTS (\n');
 END LOOP;
END $migration$;

DROP FUNCTION pg_temp.replace_once(REGPROCEDURE, TEXT, TEXT);
