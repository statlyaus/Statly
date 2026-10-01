-- Provider identity-assignment continuity is evaluated once per assignment case, not once per row.
--
-- Building a genuine HPN season input asked outcome_provider_assignment_continuity_current once per
-- decoded row for its player, match, home-club and away-club resolution, and finalization asked it
-- again for every input row. Each call re-reads the whole assignment chain from its origin revision
-- to the head: it try-locks every distinct review subject on that span, row-locks the head, and
-- walks the span link by link with three index probes per link. Rows whose resolutions share an
-- assignment case (every club occurrence shares its club's chain of about 1,700 revisions) repeat
-- that work, so a 2025 build ran for more than an hour of CPU time. The per-row cost is quadratic in
-- the chain length.
--
-- outcome_provider_assignment_continuity_current_set evaluates many origin decisions at once. For
-- each assignment case it:
--  1. try-locks the review subjects of the union of the origins' spans, in the same sorted order,
--     never waiting; an origin whose own span holds a subject that could not be locked is not
--     current, exactly as its per-origin call would return FALSE on that subject;
--  2. row-locks the head FOR SHARE NOWAIT once and refuses a head that advanced after it was read;
--  3. walks the span once, from the head downwards. Every per-origin rule is a property of the
--     suffix from the origin to the head (contiguous revisions, one row per revision, supersession
--     links, active and approved links, one target, kind and identity, approved reviews, confirmed
--     successors, and the head decision), so the lowest revision from which the suffix holds
--     decides every origin of the case.
-- Origins the set walk cannot represent exactly (a decision recorded in more than one resolution
-- table, or an origin without an assignment revision) are delegated to the per-origin function.
-- The per-origin function is unchanged for every other caller.
--
-- HPN input finalization evaluates the continuity of every row's assignment decision once, before
-- its row loop. Its per-row resolution checks use derived functions that take that result as an
-- argument; each is byte-identical to its deployed original apart from the argument. Every edit is
-- fragment-asserted, reverse-asserted, and refuses re-application.

CREATE FUNCTION outcome_provider_assignment_continuity_current_set(origin_decision_ids TEXT[])
RETURNS TABLE(continuity_decision_id TEXT, continuity_current BOOLEAN)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  assignment_case RECORD; observed_head RECORD; current_head RECORD; link RECORD; subject_lock RECORD;
  head_found BOOLEAN; head_available BOOLEAN; locked_through INTEGER; continuous_from INTEGER;
  expected_revision INTEGER; head_target TEXT; head_entity_kind TEXT; head_identity_id TEXT;
  previous_supersedes TEXT;
  evaluated_cases TEXT[]:='{}'; evaluated_valid BOOLEAN[]:='{}'; evaluated_revisions INTEGER[]:='{}';
  evaluated_entity_kinds TEXT[]:='{}'; evaluated_identity_ids TEXT[]:='{}';
  evaluated_continuous_from INTEGER[]:='{}'; evaluated_locked_through INTEGER[]:='{}';
BEGIN
  FOR assignment_case IN
    WITH requested AS (
      SELECT DISTINCT requested_id FROM unnest(origin_decision_ids) requested_id
       WHERE requested_id IS NOT NULL
    ), matched AS (
      SELECT requested.requested_id,resolutions.assignment_case_id,resolutions.assignment_revision,
             resolutions.target_id,count(*) OVER (PARTITION BY requested.requested_id) AS matches
        FROM requested JOIN (
          SELECT assignment_case_id,assignment_revision,decision_id,player_id AS target_id FROM outcome_provider_player_resolution
          UNION ALL SELECT assignment_case_id,assignment_revision,decision_id,club_id FROM outcome_provider_club_resolution
          UNION ALL SELECT assignment_case_id,assignment_revision,decision_id,match_id FROM outcome_provider_match_resolution
        ) resolutions ON resolutions.decision_id=requested.requested_id
    )
    SELECT matched.assignment_case_id,min(matched.assignment_revision) AS lowest_revision,
           max(matched.assignment_revision) AS highest_revision
      FROM matched
     WHERE matched.matches=1 AND matched.assignment_case_id IS NOT NULL
       AND matched.target_id IS NOT NULL AND matched.assignment_revision IS NOT NULL
     GROUP BY matched.assignment_case_id
     ORDER BY matched.assignment_case_id
  LOOP
    SELECT * INTO observed_head FROM outcome_provider_identity_assignment_head
      WHERE assignment_case_id=assignment_case.assignment_case_id;
    IF NOT FOUND THEN
      evaluated_cases:=evaluated_cases||assignment_case.assignment_case_id;
      evaluated_valid:=evaluated_valid||FALSE; evaluated_revisions:=evaluated_revisions||NULL::INTEGER;
      evaluated_entity_kinds:=evaluated_entity_kinds||NULL::TEXT;
      evaluated_identity_ids:=evaluated_identity_ids||NULL::TEXT;
      evaluated_continuous_from:=evaluated_continuous_from||NULL::INTEGER;
      evaluated_locked_through:=evaluated_locked_through||NULL::INTEGER;
      CONTINUE;
    END IF;
    -- Writers take review-subject advisory locks before changing the assignment head. Preserve
    -- that order, never wait for a chain lock, and record the highest revision whose subject could
    -- not be locked: every origin at or below it fails, as its own call would.
    locked_through:=NULL;
    FOR subject_lock IN SELECT review.subject_type||':'||review.subject_id AS subject,
        max(resolutions.assignment_revision) AS through_revision FROM (
      SELECT assignment_case_id,assignment_revision,decision_id FROM outcome_provider_player_resolution
      UNION ALL SELECT assignment_case_id,assignment_revision,decision_id FROM outcome_provider_club_resolution
      UNION ALL SELECT assignment_case_id,assignment_revision,decision_id FROM outcome_provider_match_resolution
    ) resolutions JOIN outcome_review_decision review USING(decision_id)
      WHERE resolutions.assignment_case_id=assignment_case.assignment_case_id
        AND resolutions.assignment_revision BETWEEN assignment_case.lowest_revision AND observed_head.revision
      GROUP BY 1
      ORDER BY 1
    LOOP
      IF NOT pg_try_advisory_xact_lock(hashtextextended('outcome-review-subject:'||subject_lock.subject,0)) THEN
        locked_through:=GREATEST(locked_through,subject_lock.through_revision);
        -- Every origin of the case has failed, so none of them would lock anything further.
        EXIT WHEN locked_through>=assignment_case.highest_revision;
      END IF;
    END LOOP;
    head_found:=FALSE; head_available:=TRUE;
    IF locked_through IS NULL OR locked_through<assignment_case.highest_revision THEN
      BEGIN
        SELECT * INTO current_head FROM outcome_provider_identity_assignment_head
          WHERE assignment_case_id=assignment_case.assignment_case_id FOR SHARE NOWAIT;
        head_found:=FOUND;
      EXCEPTION WHEN lock_not_available THEN head_available:=FALSE;
      END;
    END IF;
    IF NOT head_found OR NOT head_available
      OR current_head.revision IS DISTINCT FROM observed_head.revision
      OR current_head.decision_id IS DISTINCT FROM observed_head.decision_id
      OR current_head.status<>'active' THEN
      evaluated_cases:=evaluated_cases||assignment_case.assignment_case_id;
      evaluated_valid:=evaluated_valid||FALSE; evaluated_revisions:=evaluated_revisions||NULL::INTEGER;
      evaluated_entity_kinds:=evaluated_entity_kinds||NULL::TEXT;
      evaluated_identity_ids:=evaluated_identity_ids||NULL::TEXT;
      evaluated_continuous_from:=evaluated_continuous_from||NULL::INTEGER;
      evaluated_locked_through:=evaluated_locked_through||NULL::INTEGER;
      CONTINUE;
    END IF;
    -- Walk from the head downwards. continuous_from is the lowest revision whose suffix to the
    -- head satisfies every per-origin link rule; an origin below it is not continuous.
    continuous_from:=current_head.revision+1; expected_revision:=current_head.revision;
    previous_supersedes:=NULL; head_target:=NULL; head_entity_kind:=NULL; head_identity_id:=NULL;
    FOR link IN SELECT resolutions.*,
        EXISTS(SELECT 1 FROM outcome_review_decision WHERE decision_id=resolutions.decision_id AND decision='approved') AS review_approved,
        EXISTS(SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=resolutions.decision_id
          AND NOT EXISTS(SELECT 1 FROM (
            SELECT assignment_case_id,assignment_revision,decision_id FROM outcome_provider_player_resolution
            UNION ALL SELECT assignment_case_id,assignment_revision,decision_id FROM outcome_provider_club_resolution
            UNION ALL SELECT assignment_case_id,assignment_revision,decision_id FROM outcome_provider_match_resolution
          ) confirmation WHERE confirmation.assignment_case_id=assignment_case.assignment_case_id
            AND confirmation.assignment_revision>resolutions.assignment_revision
            AND confirmation.assignment_revision<=current_head.revision
            AND confirmation.decision_id=successor.decision_id AND successor.decision='approved')) AS successor_unconfirmed
      FROM (
        SELECT assignment_case_id,assignment_entity_kind,assignment_identity_id,assignment_revision,decision_id,
          supersedes_assignment_decision_id,assignment_status,outcome,player_id AS target_id FROM outcome_provider_player_resolution
        UNION ALL SELECT assignment_case_id,assignment_entity_kind,assignment_identity_id,assignment_revision,decision_id,
          supersedes_assignment_decision_id,assignment_status,outcome,club_id FROM outcome_provider_club_resolution
        UNION ALL SELECT assignment_case_id,assignment_entity_kind,assignment_identity_id,assignment_revision,decision_id,
          supersedes_assignment_decision_id,assignment_status,outcome,match_id FROM outcome_provider_match_resolution
      ) resolutions WHERE resolutions.assignment_case_id=assignment_case.assignment_case_id
          AND resolutions.assignment_revision BETWEEN assignment_case.lowest_revision AND current_head.revision
      ORDER BY resolutions.assignment_revision DESC
    LOOP
      IF link.assignment_revision<>expected_revision THEN
        -- A second row at the revision just accepted breaks it too; a gap breaks everything below.
        IF link.assignment_revision=expected_revision+1 THEN continuous_from:=expected_revision+2; END IF;
        EXIT;
      END IF;
      IF expected_revision=current_head.revision THEN
        head_target:=link.target_id; head_entity_kind:=link.assignment_entity_kind;
        head_identity_id:=link.assignment_identity_id;
      END IF;
      IF link.assignment_status<>'active' OR link.outcome<>'approved'
        OR link.target_id IS DISTINCT FROM head_target
        OR link.assignment_entity_kind IS DISTINCT FROM head_entity_kind
        OR link.assignment_identity_id IS DISTINCT FROM head_identity_id
        OR (expected_revision=current_head.revision AND link.decision_id IS DISTINCT FROM current_head.decision_id)
        OR (expected_revision<current_head.revision AND previous_supersedes IS DISTINCT FROM link.decision_id)
        OR NOT link.review_approved OR link.successor_unconfirmed
        THEN EXIT; END IF;
      continuous_from:=expected_revision;
      previous_supersedes:=link.supersedes_assignment_decision_id;
      expected_revision:=expected_revision-1;
    END LOOP;
    evaluated_cases:=evaluated_cases||assignment_case.assignment_case_id;
    evaluated_valid:=evaluated_valid||TRUE; evaluated_revisions:=evaluated_revisions||current_head.revision;
    evaluated_entity_kinds:=evaluated_entity_kinds||current_head.entity_kind;
    evaluated_identity_ids:=evaluated_identity_ids||current_head.identity_id;
    evaluated_continuous_from:=evaluated_continuous_from||continuous_from;
    evaluated_locked_through:=evaluated_locked_through||locked_through;
  END LOOP;

  RETURN QUERY
    WITH requested AS (
      SELECT DISTINCT requested_id FROM unnest(origin_decision_ids) requested_id
       WHERE requested_id IS NOT NULL
    ), matched AS (
      SELECT requested.requested_id,resolutions.assignment_case_id,resolutions.assignment_entity_kind,
             resolutions.assignment_identity_id,resolutions.assignment_revision,resolutions.target_id,
             count(resolutions.decision_id) OVER (PARTITION BY requested.requested_id) AS matches
        FROM requested LEFT JOIN (
          SELECT assignment_case_id,assignment_entity_kind,assignment_identity_id,assignment_revision,decision_id,player_id AS target_id FROM outcome_provider_player_resolution
          UNION ALL SELECT assignment_case_id,assignment_entity_kind,assignment_identity_id,assignment_revision,decision_id,club_id FROM outcome_provider_club_resolution
          UNION ALL SELECT assignment_case_id,assignment_entity_kind,assignment_identity_id,assignment_revision,decision_id,match_id FROM outcome_provider_match_resolution
        ) resolutions ON resolutions.decision_id=requested.requested_id
    ), origins AS (
      SELECT DISTINCT ON (matched.requested_id) matched.* FROM matched ORDER BY matched.requested_id
    ), evaluated AS (
      SELECT * FROM unnest(evaluated_cases,evaluated_valid,evaluated_revisions,evaluated_entity_kinds,
        evaluated_identity_ids,evaluated_continuous_from,evaluated_locked_through)
        AS evaluated(assignment_case_id,valid,head_revision,head_entity_kind,head_identity_id,
          continuous_from,locked_through)
    )
    SELECT origins.requested_id,
      CASE
        WHEN origins.matches>1 OR (origins.matches=1 AND origins.assignment_case_id IS NOT NULL
            AND origins.target_id IS NOT NULL AND origins.assignment_revision IS NULL)
          THEN outcome_provider_assignment_continuity_current(origins.requested_id)
        WHEN origins.matches=0 OR origins.assignment_case_id IS NULL OR origins.target_id IS NULL
          THEN FALSE
        ELSE COALESCE(evaluated.valid
          AND origins.assignment_revision<=evaluated.head_revision
          AND evaluated.head_entity_kind IS NOT DISTINCT FROM origins.assignment_entity_kind
          AND evaluated.head_identity_id IS NOT DISTINCT FROM origins.assignment_identity_id
          AND origins.assignment_revision>=evaluated.continuous_from
          AND (evaluated.locked_through IS NULL OR origins.assignment_revision>evaluated.locked_through),FALSE)
      END
      FROM origins LEFT JOIN evaluated ON evaluated.assignment_case_id=origins.assignment_case_id
     ORDER BY origins.requested_id;
END $$;

COMMENT ON FUNCTION outcome_provider_assignment_continuity_current_set(TEXT[]) IS
  'outcome_provider_assignment_continuity_current for many origin decisions, evaluated once per assignment case.';

DO $migration$ BEGIN
  EXECUTE format('ALTER FUNCTION outcome_provider_assignment_continuity_current_set(TEXT[]) SET search_path TO %I,pg_temp',current_schema());
END $migration$;

-- The finalizer's per-row resolution checks, with the assignment continuity of the row's
-- authority supplied by the caller. Each is derived byte-for-byte from the deployed function.
DO $migration$
DECLARE
  original_definition TEXT;
  derived_definition TEXT;
  entry TEXT[];
  derivations CONSTANT TEXT[][] := ARRAY[
    ARRAY['outcome_hpn_pav_player_resolution_current(text,jsonb)',
      'outcome_hpn_pav_player_resolution_current_with_assignment(text,jsonb,boolean)',
      'outcome_hpn_pav_player_resolution_current(decoded_row_id text, authority jsonb)',
      'outcome_hpn_pav_player_resolution_current_with_assignment(decoded_row_id text, authority jsonb, assignment_is_current boolean)',
      'outcome_provider_assignment_continuity_current(resolution.decision_id)'],
    ARRAY['outcome_hpn_pav_match_resolution_current(text,jsonb)',
      'outcome_hpn_pav_match_resolution_current_with_assignment(text,jsonb,boolean)',
      'outcome_hpn_pav_match_resolution_current(decoded_row_id text, authority jsonb)',
      'outcome_hpn_pav_match_resolution_current_with_assignment(decoded_row_id text, authority jsonb, assignment_is_current boolean)',
      'outcome_provider_assignment_continuity_current(resolution."decision_id")'],
    ARRAY['outcome_hpn_pav_club_resolution_current(text,jsonb,text)',
      'outcome_hpn_pav_club_resolution_current_with_assignment(text,jsonb,text,boolean)',
      'outcome_hpn_pav_club_resolution_current(decoded_row_id text, authority jsonb, required_side text)',
      'outcome_hpn_pav_club_resolution_current_with_assignment(decoded_row_id text, authority jsonb, required_side text, assignment_is_current boolean)',
      'outcome_provider_assignment_continuity_current(resolution."decision_id")']];
  derived_argument CONSTANT TEXT := 'assignment_is_current';
BEGIN
  FOREACH entry SLICE 1 IN ARRAY derivations LOOP
    IF to_regprocedure(entry[2]) IS NOT NULL THEN
      RAISE EXCEPTION 'Derived HPN resolution currency % already exists before 0242',entry[2];
    END IF;
    SELECT pg_get_functiondef(to_regprocedure(entry[1])) INTO original_definition;
    IF original_definition IS NULL
      OR (length(original_definition)-length(replace(original_definition,entry[3],'')))/length(entry[3])<>1
      OR (length(original_definition)-length(replace(original_definition,entry[5],'')))/length(entry[5])<>1
      OR position('outcome_provider_assignment_continuity_current' IN replace(original_definition,entry[5],''))>0
      OR position(derived_argument IN original_definition)>0 THEN
      RAISE EXCEPTION 'Expected exact per-row HPN resolution currency % before 0242',entry[1];
    END IF;
    derived_definition:=replace(replace(original_definition,entry[3],entry[4]),entry[5],derived_argument);
    -- The derived signature names the argument too, so it is restored first.
    IF replace(replace(derived_definition,entry[4],entry[3]),derived_argument,entry[5])
        IS DISTINCT FROM original_definition THEN
      RAISE EXCEPTION 'Derived HPN resolution currency % differs beyond its continuity argument',entry[2];
    END IF;
    EXECUTE derived_definition;
  END LOOP;
END $migration$;

COMMENT ON FUNCTION outcome_hpn_pav_player_resolution_current_with_assignment(TEXT,JSONB,BOOLEAN) IS
  'outcome_hpn_pav_player_resolution_current with the assignment continuity of its authority supplied by a set-based caller.';
COMMENT ON FUNCTION outcome_hpn_pav_match_resolution_current_with_assignment(TEXT,JSONB,BOOLEAN) IS
  'outcome_hpn_pav_match_resolution_current with the assignment continuity of its authority supplied by a set-based caller.';
COMMENT ON FUNCTION outcome_hpn_pav_club_resolution_current_with_assignment(TEXT,JSONB,TEXT,BOOLEAN) IS
  'outcome_hpn_pav_club_resolution_current with the assignment continuity of its authority supplied by a set-based caller.';

DO $migration$
DECLARE
  original_definition TEXT;
  corrected_definition TEXT;
  reversed_definition TEXT;
  declare_fragment CONSTANT TEXT := 'lock_subject TEXT; row_record RECORD; registered_spells TEXT[];';
  declare_hoisted CONSTANT TEXT := 'lock_subject TEXT; row_record RECORD; registered_spells TEXT[]; current_assignments JSONB;';
  loop_fragment CONSTANT TEXT := $old$
  FOR row_record IN SELECT * FROM "outcome_hpn_pav_input_row"
    WHERE "input_set_id"=NEW."input_set_id"
  LOOP$old$;
  loop_hoisted CONSTANT TEXT := $new$
  -- 0242: the assignment continuity of every row's authority is evaluated once per assignment
  -- case, not once per row check. Keys are the current assignment decisions; a jsonb key lookup
  -- is a binary search, so each row check stays logarithmic in the input set.
  current_assignments:=COALESCE((
    SELECT jsonb_object_agg(continuity.continuity_decision_id,TRUE)
      FROM outcome_provider_assignment_continuity_current_set(ARRAY(
        SELECT DISTINCT authority.decision_id
          FROM "outcome_hpn_pav_input_row" member
          CROSS JOIN LATERAL (VALUES
            (member."row_json"#>>'{player,assignmentDecision,id}'),
            (member."row_json"#>>'{club,assignmentDecision,id}'),
            (member."row_json"#>>'{match,assignmentDecision,id}'),
            (member."row_json"#>>'{homeClub,assignmentDecision,id}'),
            (member."row_json"#>>'{awayClub,assignmentDecision,id}')) authority(decision_id)
         WHERE member."input_set_id"=NEW."input_set_id" AND authority.decision_id IS NOT NULL)) continuity
     WHERE continuity.continuity_current),'{}'::JSONB);
  FOR row_record IN SELECT * FROM "outcome_hpn_pav_input_row"
    WHERE "input_set_id"=NEW."input_set_id"
  LOOP$new$;
  -- Each per-row check's continuity is that of its authority's assignment decision: every checked
  -- resolution must carry that decision, so the argument equals the per-row call it replaces.
  argument_pairs CONSTANT TEXT[][] := ARRAY[
    ARRAY[$old$row_json"->'match')$old$,
      $new$row_json"->'match',COALESCE(current_assignments?(row_record."row_json"#>>'{match,assignmentDecision,id}'),FALSE))$new$],
    ARRAY[$old$row_json"->'player')$old$,
      $new$row_json"->'player',COALESCE(current_assignments?(row_record."row_json"#>>'{player,assignmentDecision,id}'),FALSE))$new$],
    ARRAY[$old$row_json"->'homeClub','home')$old$,
      $new$row_json"->'homeClub','home',COALESCE(current_assignments?(row_record."row_json"#>>'{homeClub,assignmentDecision,id}'),FALSE))$new$],
    ARRAY[$old$row_json"->'awayClub','away')$old$,
      $new$row_json"->'awayClub','away',COALESCE(current_assignments?(row_record."row_json"#>>'{awayClub,assignmentDecision,id}'),FALSE))$new$],
    ARRAY[$old$row_json"->'club','home')$old$,
      $new$row_json"->'club','home',COALESCE(current_assignments?(row_record."row_json"#>>'{club,assignmentDecision,id}'),FALSE))$new$],
    ARRAY[$old$row_json"->'club','away')$old$,
      $new$row_json"->'club','away',COALESCE(current_assignments?(row_record."row_json"#>>'{club,assignmentDecision,id}'),FALSE))$new$]];
  argument_counts CONSTANT INTEGER[] := ARRAY[2,1,1,1,1,1];
  call_fragment CONSTANT TEXT := '_resolution_current"(';
  call_hoisted CONSTANT TEXT := '_resolution_current_with_assignment"(';
  position_index INTEGER;
BEGIN
  SELECT pg_get_functiondef('finalize_outcome_hpn_pav_input_set_v2()'::regprocedure) INTO original_definition;
  IF original_definition IS NULL OR position('current_assignments' IN original_definition)>0
    OR position('_with_assignment' IN original_definition)>0 THEN
    RAISE EXCEPTION 'Expected HPN input finalization before 0242';
  END IF;
  IF (length(original_definition)-length(replace(original_definition,declare_fragment,'')))/length(declare_fragment)<>1
    OR (length(original_definition)-length(replace(original_definition,loop_fragment,'')))/length(loop_fragment)<>1
    OR (length(original_definition)-length(replace(original_definition,call_fragment,'')))/length(call_fragment)<>7 THEN
    RAISE EXCEPTION 'Expected the declarations, one row loop and seven per-row resolution checks before 0242';
  END IF;
  corrected_definition:=replace(replace(replace(original_definition,
    declare_fragment,declare_hoisted),loop_fragment,loop_hoisted),call_fragment,call_hoisted);
  FOR position_index IN 1..array_length(argument_pairs,1) LOOP
    IF (length(original_definition)-length(replace(original_definition,argument_pairs[position_index][1],'')))
        /length(argument_pairs[position_index][1])<>argument_counts[position_index] THEN
      RAISE EXCEPTION 'Expected % per-row resolution arguments % before 0242',
        argument_counts[position_index],argument_pairs[position_index][1];
    END IF;
    corrected_definition:=replace(corrected_definition,argument_pairs[position_index][1],argument_pairs[position_index][2]);
  END LOOP;
  reversed_definition:=corrected_definition;
  FOR position_index IN REVERSE array_length(argument_pairs,1)..1 LOOP
    reversed_definition:=replace(reversed_definition,argument_pairs[position_index][2],argument_pairs[position_index][1]);
  END LOOP;
  reversed_definition:=replace(replace(replace(reversed_definition,
    call_hoisted,call_fragment),loop_hoisted,loop_fragment),declare_hoisted,declare_fragment);
  IF reversed_definition IS DISTINCT FROM original_definition
    OR position('outcome_hpn_pav_player_resolution_current"(' IN corrected_definition)>0
    OR position('outcome_hpn_pav_match_resolution_current"(' IN corrected_definition)>0
    OR position('outcome_hpn_pav_club_resolution_current"(' IN corrected_definition)>0 THEN
    RAISE EXCEPTION 'Hoisted HPN finalization altered unrelated bytes';
  END IF;
  EXECUTE corrected_definition;
END $migration$;
