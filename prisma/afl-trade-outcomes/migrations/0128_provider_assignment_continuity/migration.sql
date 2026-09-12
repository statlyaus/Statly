-- Occurrence approval and shared identity assignment are distinct authorities.
-- A later same-target confirmation does not revoke an earlier occurrence. Any intervening
-- retarget, inactive assignment, or revoked review breaks continuity, including A -> B -> A.
CREATE INDEX outcome_provider_player_assignment_chain_idx ON outcome_provider_player_resolution(assignment_case_id,assignment_revision);
CREATE INDEX outcome_provider_club_assignment_chain_idx ON outcome_provider_club_resolution(assignment_case_id,assignment_revision);
CREATE INDEX outcome_provider_match_assignment_chain_idx ON outcome_provider_match_resolution(assignment_case_id,assignment_revision);

CREATE FUNCTION outcome_provider_assignment_continuity_current(origin_decision_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE origin RECORD; current_head RECORD; observed_head RECORD; link RECORD; previous_decision TEXT; expected_revision INTEGER; review_subject TEXT;
BEGIN
  SELECT * INTO origin FROM (
    SELECT assignment_case_id,assignment_entity_kind,assignment_identity_id,assignment_revision,decision_id,player_id AS target_id FROM outcome_provider_player_resolution
    UNION ALL SELECT assignment_case_id,assignment_entity_kind,assignment_identity_id,assignment_revision,decision_id,club_id FROM outcome_provider_club_resolution
    UNION ALL SELECT assignment_case_id,assignment_entity_kind,assignment_identity_id,assignment_revision,decision_id,match_id FROM outcome_provider_match_resolution
  ) resolutions WHERE decision_id=origin_decision_id;
  IF NOT FOUND OR origin.assignment_case_id IS NULL OR origin.target_id IS NULL THEN RETURN FALSE; END IF;
  SELECT * INTO observed_head FROM outcome_provider_identity_assignment_head
    WHERE assignment_case_id=origin.assignment_case_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  -- Writers take review-subject advisory locks before changing the assignment head.
  -- Preserve that order, and refuse a concurrently advanced snapshot rather than acquiring
  -- additional review locks while holding the head's row lock.
  FOR review_subject IN SELECT DISTINCT review.subject_type||':'||review.subject_id FROM (
    SELECT assignment_case_id,assignment_revision,decision_id FROM outcome_provider_player_resolution
    UNION ALL SELECT assignment_case_id,assignment_revision,decision_id FROM outcome_provider_club_resolution
    UNION ALL SELECT assignment_case_id,assignment_revision,decision_id FROM outcome_provider_match_resolution
  ) resolutions JOIN outcome_review_decision review USING(decision_id)
    WHERE resolutions.assignment_case_id=origin.assignment_case_id
      AND resolutions.assignment_revision BETWEEN origin.assignment_revision AND observed_head.revision
    ORDER BY 1
  LOOP
    -- Callers can already hold other assignment locks: never wait for a new chain lock.
    IF NOT pg_try_advisory_xact_lock(hashtextextended('outcome-review-subject:'||review_subject,0)) THEN RETURN FALSE; END IF;
  END LOOP;
  BEGIN
    SELECT * INTO current_head FROM outcome_provider_identity_assignment_head
      WHERE assignment_case_id=origin.assignment_case_id FOR SHARE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN RETURN FALSE;
  END;
  IF NOT FOUND OR current_head.revision IS DISTINCT FROM observed_head.revision
    OR current_head.decision_id IS DISTINCT FROM observed_head.decision_id THEN RETURN FALSE; END IF;
  IF NOT FOUND OR current_head.status<>'active' OR current_head.revision<origin.assignment_revision
    OR current_head.entity_kind IS DISTINCT FROM origin.assignment_entity_kind
    OR current_head.identity_id IS DISTINCT FROM origin.assignment_identity_id THEN RETURN FALSE; END IF;
  expected_revision:=origin.assignment_revision;
  FOR link IN SELECT * FROM (
    SELECT assignment_case_id,assignment_entity_kind,assignment_identity_id,assignment_revision,decision_id,
      supersedes_assignment_decision_id,assignment_status,outcome,player_id AS target_id FROM outcome_provider_player_resolution
    UNION ALL SELECT assignment_case_id,assignment_entity_kind,assignment_identity_id,assignment_revision,decision_id,
      supersedes_assignment_decision_id,assignment_status,outcome,club_id FROM outcome_provider_club_resolution
    UNION ALL SELECT assignment_case_id,assignment_entity_kind,assignment_identity_id,assignment_revision,decision_id,
      supersedes_assignment_decision_id,assignment_status,outcome,match_id FROM outcome_provider_match_resolution
  ) resolutions WHERE assignment_case_id=origin.assignment_case_id
      AND assignment_revision BETWEEN origin.assignment_revision AND current_head.revision
    ORDER BY assignment_revision
  LOOP
    IF link.assignment_revision<>expected_revision OR link.assignment_status<>'active' OR link.outcome<>'approved'
      OR link.target_id IS DISTINCT FROM origin.target_id
      OR link.assignment_entity_kind IS DISTINCT FROM origin.assignment_entity_kind
      OR link.assignment_identity_id IS DISTINCT FROM origin.assignment_identity_id
      OR (previous_decision IS NULL AND link.decision_id IS DISTINCT FROM origin_decision_id)
      OR (previous_decision IS NOT NULL AND link.supersedes_assignment_decision_id IS DISTINCT FROM previous_decision)
      THEN RETURN FALSE; END IF;
    IF NOT EXISTS(SELECT 1 FROM outcome_review_decision WHERE decision_id=link.decision_id AND decision='approved')
      OR EXISTS(SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=link.decision_id
        AND NOT EXISTS(SELECT 1 FROM (
          SELECT assignment_case_id,assignment_revision,decision_id FROM outcome_provider_player_resolution
          UNION ALL SELECT assignment_case_id,assignment_revision,decision_id FROM outcome_provider_club_resolution
          UNION ALL SELECT assignment_case_id,assignment_revision,decision_id FROM outcome_provider_match_resolution
        ) confirmation WHERE confirmation.assignment_case_id=origin.assignment_case_id
          AND confirmation.assignment_revision>link.assignment_revision AND confirmation.assignment_revision<=current_head.revision
          AND confirmation.decision_id=successor.decision_id AND successor.decision='approved'))
      THEN RETURN FALSE; END IF;
    previous_decision:=link.decision_id;
    expected_revision:=expected_revision+1;
  END LOOP;
  RETURN expected_revision=current_head.revision+1 AND previous_decision=current_head.decision_id;
END $$;

CREATE FUNCTION outcome_0128_replace_fragment(signature TEXT,old_fragment TEXT,new_fragment TEXT,expected_count INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$ DECLARE definition TEXT; occurrences INTEGER; BEGIN
  SELECT pg_get_functiondef(to_regprocedure(signature)) INTO definition;
  occurrences:=(length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment);
  IF definition IS NULL OR occurrences<>expected_count THEN RAISE EXCEPTION 'Expected % continuity fragments in %, found %',expected_count,signature,occurrences; END IF;
  EXECUTE replace(definition,old_fragment,new_fragment);
END $$;

SELECT outcome_0128_replace_fragment('validate_outcome_provider_resolution_insert()',
  'a.decision_id=r.decision_id','outcome_provider_assignment_continuity_current(r.decision_id)',2);
SELECT outcome_0128_replace_fragment('register_outcome_reviewed_canonical_target(text,text,text,text)',
  'assignment.decision_id=resolution.decision_id','outcome_provider_assignment_continuity_current(resolution.decision_id)',1);
SELECT outcome_0128_replace_fragment('outcome_hpn_pav_player_resolution_current(text,jsonb)',
  'assignment.decision_id=resolution.decision_id','outcome_provider_assignment_continuity_current(resolution.decision_id)',1);
SELECT outcome_0128_replace_fragment('outcome_hpn_pav_player_resolution_current(text,jsonb)',
  'assignment.decision_id=authority','resolution.decision_id=authority',1);
DO $$ DECLARE signature TEXT; BEGIN
  FOREACH signature IN ARRAY ARRAY['outcome_hpn_pav_match_resolution_current(text,jsonb)','outcome_hpn_pav_club_resolution_current(text,jsonb,text)'] LOOP
    PERFORM outcome_0128_replace_fragment(signature,
      'assignment."decision_id"=resolution."decision_id"','outcome_provider_assignment_continuity_current(resolution."decision_id")',1);
    PERFORM outcome_0128_replace_fragment(signature,
      'assignment."decision_id"=authority','resolution."decision_id"=authority',1);
  END LOOP;
  EXECUTE format('ALTER FUNCTION outcome_provider_assignment_continuity_current(TEXT) SET search_path TO %I,pg_temp',current_schema());
END $$;
DROP FUNCTION outcome_0128_replace_fragment(TEXT,TEXT,TEXT,INTEGER);
