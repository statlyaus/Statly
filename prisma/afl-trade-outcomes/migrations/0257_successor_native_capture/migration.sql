-- A recaptured successor is also a capture in its own right.
--
-- 0252 let an arrival-only (v4) entry cite a recaptured successor in place of the lost capture it
-- succeeds: the arrival-event check maps every cited artifact to the lost original and matches that
-- against the promotion candidate's captures. Every recaptured successor is a real approved capture,
-- and a later candidate may bind it natively: the 2020 Jeremy Cameron trade promotion of 2026-09-30
-- captured the 2020 Official AFL draft page as artifact 98b59b2e…, which the #742 successor pass of
-- 2026-10-06 then recorded as the successor of the lost 2020 capture 3000f942…. An arrival entry on
-- the Cameron asset versions must cite 98b59b2e…, and the check mapped it to 3000f942…, which that
-- candidate never captured, so the five reviewed spells re-versioned by that promotion could not be
-- re-made (statlyaus/Statly#742 item 5, 2026-10-07). The same holds for all twelve recaptures.
--
-- Fix: in both capture clauses of outcome_acquisition_arrival_event_current a cited artifact matches
-- a candidate capture of the artifact itself or of the lost capture it succeeds. Nothing else
-- changes: a lost artifact still matches only itself, an omitted one still need not be cited, and
-- the promotion's captures must still all be cited. v1, v2 and v3 entries never read successors.
-- Asserted in-place replacement, as 0247, 0248, 0252, 0254 and 0256 do.

CREATE FUNCTION pg_temp.replace_capture_clause(target REGPROCEDURE, old TEXT, new TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE definition TEXT;
BEGIN
  definition:=pg_get_functiondef(target);
  IF array_length(string_to_array(definition,old),1)<>2 THEN
    RAISE EXCEPTION 'Expected exactly one capture fragment in %: %', target, old;
  END IF;
  EXECUTE replace(definition,old,new);
END $$;

DO $migration$
DECLARE fn CONSTANT TEXT:='outcome_acquisition_arrival_event_current(jsonb,text,text,text,text,boolean,timestamp with time zone,timestamp with time zone)';
BEGIN
 -- Every cited artifact is a capture of the candidate: itself, or the lost capture it succeeds.
 PERFORM pg_temp.replace_capture_clause(fn::regprocedure,
   $old$AND capture.source_artifact_id=outcome_source_capture_cited_original(ref->>'artifactId',proposal_at,cutoff)$old$,
   $new$AND capture.source_artifact_id IN (ref->>'artifactId',outcome_source_capture_cited_original(ref->>'artifactId',proposal_at,cutoff))$new$);
 -- Every capture of the candidate behind the asset and event is cited, the same two ways.
 PERFORM pg_temp.replace_capture_clause(fn::regprocedure,
   $old$WHERE outcome_source_capture_cited_original(ref->>'artifactId',proposal_at,cutoff)=capture.source_artifact_id)$old$,
   $new$WHERE capture.source_artifact_id IN (ref->>'artifactId',outcome_source_capture_cited_original(ref->>'artifactId',proposal_at,cutoff)))$new$);
END $migration$;

DROP FUNCTION pg_temp.replace_capture_clause(REGPROCEDURE, TEXT, TEXT);
