-- A reviewer's authority is judged when the reviewer decided, not when the decision is read.
--
-- Every reviewer authority (outcome_operational_principal_authority) has a term, valid_from to
-- valid_through, and a season scope. Three read-time checks tested the term against the read-time
-- cutoff: outcome_acquisition_promoted_event_current and outcome_acquisition_arrival_event_current
-- (the canonical promoter's authority behind the promotion review, and the external identity
-- reviewer's authority behind the asset's identity decision) and
-- outcome_canonical_departure_before_identity_current (the promoter's authority behind the departure
-- approval). So a decision made under a valid authority stopped counting when the term ended. The
-- per-season identity-reviewer and promoter authorities behind the 2018-2024 decisions were issued on
-- 2026-09-10/11 with 30-day terms: every one of the 247 reviewed spells would have gone non-current
-- on 2026-10-10 (measured on the grading database on 2026-10-07: a current v4 spell is true at
-- cutoff 2026-10-09 and false at 2026-10-12). The nineteen other functions that read valid_through
-- test it when a decision is inserted and are unchanged.
--
-- Owner decision (statlyaus/Statly#742, 2026-10-07): the five clauses test the term against the
-- decision's own decided_at. Strictness is unchanged in every other respect: an authority that was
-- not valid when the reviewer decided still fails, an expired authority still refuses new decisions
-- at insert time, and the season scope, role, provider, capability, competition, evidence status and
-- approval supersession checks stay as they are.
--
-- The identity reviewer's season scope is also tested against the event's season instead of the
-- promotion candidate's anchor season. A candidate may span several drafts (the 2020 Jeremy Cameron
-- trade promotion anchors 2021 and carries 2020 and 2021 draftees), and the identity of a 2020
-- draftee is correctly reviewed under a 2020 authority. The promoter's scope keeps the candidate
-- anchor: the promotion is the candidate's. Every edit is an asserted in-place replacement, as 0247,
-- 0248, 0252, 0254, 0256 and 0257 do; the two term clauses in each event function are told apart
-- by their indentation, which pg_get_functiondef preserves.

CREATE FUNCTION pg_temp.replace_authority_clause(target REGPROCEDURE, old TEXT, new TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE definition TEXT;
BEGIN
  definition:=pg_get_functiondef(target);
  IF array_length(string_to_array(definition,old),1)<>2 THEN
    RAISE EXCEPTION 'Expected exactly one authority fragment in %: %', target, old;
  END IF;
  EXECUTE replace(definition,old,new);
END $$;

DO $migration$
DECLARE fn TEXT;
BEGIN
 FOREACH fn IN ARRAY ARRAY[
   'outcome_acquisition_promoted_event_current(jsonb,text,text,text,text,boolean,timestamp with time zone,timestamp with time zone)',
   'outcome_acquisition_arrival_event_current(jsonb,text,text,text,text,boolean,timestamp with time zone,timestamp with time zone)'] LOOP
   -- The promoter's authority, judged when the promotion review (review) was decided.
   PERFORM pg_temp.replace_authority_clause(fn::regprocedure,
     E'\n        AND authority.valid_from<=cutoff AND (authority.valid_through IS NULL OR authority.valid_through>cutoff)\n',
     E'\n        AND authority.valid_from<=review.decided_at AND (authority.valid_through IS NULL OR authority.valid_through>review.decided_at)\n');
   -- The identity reviewer's authority, judged when the identity decision (generic) was decided, and
   -- scoped by the event's season.
   PERFORM pg_temp.replace_authority_clause(fn::regprocedure,
     E'\n            AND authority.valid_from<=cutoff AND (authority.valid_through IS NULL OR authority.valid_through>cutoff)\n',
     E'\n            AND authority.valid_from<=generic.decided_at AND (authority.valid_through IS NULL OR authority.valid_through>generic.decided_at)\n');
   PERFORM pg_temp.replace_authority_clause(fn::regprocedure,
     E'\n            AND candidate.anchor_season_year BETWEEN authority.valid_from_season AND authority.valid_through_season\n',
     E'\n            AND EXTRACT(YEAR FROM event.event_date)::INTEGER BETWEEN authority.valid_from_season AND authority.valid_through_season\n');
 END LOOP;

 -- The promoter's authority behind a departure approval, judged when that approval was decided.
 PERFORM pg_temp.replace_authority_clause('outcome_canonical_departure_before_identity_current(text,timestamp with time zone)'::regprocedure,
   E'\n  AND authority.valid_from<=cutoff AND (authority.valid_through IS NULL OR authority.valid_through>cutoff)\n',
   E'\n  AND authority.valid_from<=review.decided_at AND (authority.valid_through IS NULL OR authority.valid_through>review.decided_at)\n');
END $migration$;

DROP FUNCTION pg_temp.replace_authority_clause(REGPROCEDURE, TEXT, TEXT);
