-- A fact retains the reviewed source occurrence, not whichever other occurrence most
-- recently confirmed the same provider identity. Keep every exact occurrence-head,
-- candidate, target, scope and assignment-origin check; only replace shared-head equality.
-- The existing continuity owner locks and validates the complete same-target chain,
-- refusing retargets, inactive assignments, withdrawn reviews and concurrent changes.
-- Occurrence-only players have no assignment chain. Lock their actual review/head
-- without inventing a reusable identity or waiting behind an in-flight withdrawal.
CREATE FUNCTION outcome_provider_candidate_only_player_resolution_current(origin_decision_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE resolution_case TEXT; current_resolution TEXT;
BEGIN
  SELECT resolution_case_id INTO resolution_case
    FROM outcome_provider_player_resolution
   WHERE decision_id=origin_decision_id AND resolution_scope='candidate_only'
     AND outcome='approved' AND player_identity_id IS NULL AND assignment_case_id IS NULL;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(
    'outcome-review-subject:provider_resolution_case:'||resolution_case,0)) THEN RETURN FALSE; END IF;
  -- Every legal new head requires a typed decision under this same review-subject
  -- lock; the head guard also requires the next immutable maximum. Plain SELECT
  -- preserves read-only consumers without granting them UPDATE just for a row lock.
  SELECT resolution_id INTO current_resolution FROM outcome_provider_player_resolution_head
   WHERE resolution_case_id=resolution_case;
  IF NOT FOUND OR current_resolution IS DISTINCT FROM origin_decision_id THEN RETURN FALSE; END IF;
  RETURN EXISTS (
    SELECT 1 FROM outcome_review_decision review
     WHERE review.decision_id=origin_decision_id AND review.decision='approved'
       AND review.subject_type='provider_resolution_case' AND review.subject_id=resolution_case
       AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor
                        WHERE successor.supersedes_decision_id=origin_decision_id)
  );
END $$;
DO $$ BEGIN
  EXECUTE format('ALTER FUNCTION outcome_provider_candidate_only_player_resolution_current(TEXT) SET search_path TO %I,pg_temp',current_schema());
END $$;

CREATE FUNCTION outcome_0132_replace_fragment(signature TEXT,old_fragment TEXT,new_fragment TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE definition TEXT; occurrences INTEGER;
BEGIN
  SELECT pg_get_functiondef(to_regprocedure(signature)) INTO definition;
  occurrences:=(length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment);
  IF definition IS NULL OR occurrences<>1 THEN
    RAISE EXCEPTION 'Expected exactly one factual continuity fragment in %, found %',signature,occurrences;
  END IF;
  EXECUTE replace(definition,old_fragment,new_fragment);
END $$;

SELECT outcome_0132_replace_fragment('validate_outcome_provider_match_fact()',
  'fact_context."assignment_head_decision" <> NEW."match_assignment_decision_id"',
  'NOT outcome_provider_assignment_continuity_current(NEW."match_assignment_decision_id")');

SELECT outcome_0132_replace_fragment('validate_outcome_provider_appearance_fact()',
  'fact_context."player_assignment_decision" IS DISTINCT FROM NEW."player_assignment_decision_id"',
  'NOT outcome_provider_assignment_continuity_current(NEW."player_assignment_decision_id")');
SELECT outcome_0132_replace_fragment('validate_outcome_provider_appearance_fact()',
  'fact_context."match_assignment_decision" <> NEW."match_assignment_decision_id"',
  'NOT outcome_provider_assignment_continuity_current(NEW."match_assignment_decision_id")');
SELECT outcome_0132_replace_fragment('validate_outcome_provider_appearance_fact()',
  'fact_context."club_assignment_decision" <> NEW."represented_club_assignment_decision_id"',
  'NOT outcome_provider_assignment_continuity_current(NEW."represented_club_assignment_decision_id")');

SELECT outcome_0132_replace_fragment('require_outcome_provider_fact_club_scope(text,"OutcomeEnvironment",integer,text,text,text,text,text,text)',
  'scope_context."assignment_decision" <> assignment_decision_id',
  'NOT outcome_provider_assignment_continuity_current(assignment_decision_id)');

SELECT outcome_0132_replace_fragment('validate_outcome_provider_metric_fact()',
  'fact_context."assignment_decision" IS DISTINCT FROM NEW."player_assignment_decision_id"',
  'NOT outcome_provider_assignment_continuity_current(NEW."player_assignment_decision_id")');
SELECT outcome_0132_replace_fragment('validate_outcome_provider_achievement_fact()',
  'fact_context."assignment_decision" IS DISTINCT FROM NEW."player_assignment_decision_id"',
  'NOT outcome_provider_assignment_continuity_current(NEW."player_assignment_decision_id")');

DO $$ DECLARE signature TEXT; BEGIN
  FOREACH signature IN ARRAY ARRAY['validate_outcome_provider_appearance_fact()',
    'validate_outcome_provider_metric_fact()','validate_outcome_provider_achievement_fact()'] LOOP
    PERFORM outcome_0132_replace_fragment(signature,
      '(fact_context."player_scope" = ''candidate_only'' AND (',
      '(fact_context."player_scope" = ''candidate_only'' AND (NOT outcome_provider_candidate_only_player_resolution_current(NEW."player_resolution_decision_id") OR ');
  END LOOP;
END $$;

SELECT outcome_0132_replace_fragment('outcome_hpn_pav_player_resolution_current(text,jsonb)',
  'resolution.resolution_scope=''candidate_only''',
  'resolution.resolution_scope=''candidate_only'' AND outcome_provider_candidate_only_player_resolution_current(resolution.decision_id)');

DROP FUNCTION outcome_0132_replace_fragment(TEXT,TEXT,TEXT);
