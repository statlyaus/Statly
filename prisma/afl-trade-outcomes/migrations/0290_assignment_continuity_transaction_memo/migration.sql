-- Provider identity-assignment continuity is walked once per assignment case per transaction.
--
-- Every factual row insert asks outcome_provider_assignment_continuity_current for its player,
-- match and club assignment decisions. Each call walks the assignment chain from the origin
-- revision to the head: it try-locks every review subject on that span, row-locks the head and
-- runs two or three index probes per link. A season's fact batch inserts about 9,100 rows in one
-- transaction over about 70 club cases whose heads sit about 1,000 revisions above their origins,
-- so the same walks repeat thousands of times (one 1,147-link walk costs about 330 ms).
--
-- The function now remembers, for the rest of the transaction, what one walk proved about its
-- assignment case: for a head (revision and decision) and a lowest walked revision, the lowest
-- revision from which the suffix to the head satisfies every per-origin rule (the same walk as
-- outcome_provider_assignment_continuity_current_set, migration 0242). A later origin of the same
-- case at or above the walked revision is answered from that verdict; a lower origin walks again
-- and replaces it. The remembered verdict is exactly the per-origin answer because nothing it
-- read can change while it is used:
--  * other transactions: the walk holds, until this transaction ends, the head row FOR SHARE and
--    an advisory lock on every review subject of the walked span. A new link must advance the head
--    (the resolution writer requires revision head+1), and every review decision, including a
--    successor of a link's review (same subject only), takes its subject's advisory lock first;
--  * this transaction: every insert, update or delete of the five tables the walk reads bumps a
--    transaction-local generation from a BEFORE ROW trigger that sorts after every other BEFORE
--    trigger on those tables, so no trigger can remember a verdict between the bump and the row
--    change. The trigger fires under session_replication_role=replica too. A verdict from an older
--    generation is never used;
--  * savepoints: the verdict, the generation and the locks are all transaction-local and are
--    rolled back together with a rolled-back subtransaction.
-- Nothing is remembered from a call that fails on a held lock, a missing, moved or inactive head,
-- or a kind or identity mismatch; those calls repeat the full check every time, as before. Origins
-- the walk cannot represent exactly (a decision in more than one resolution table, or one without
-- an assignment revision) are delegated to the unchanged per-origin function, renamed
-- outcome_provider_assignment_continuity_current_uncached.
--
-- Each case's verdict lives in its own transaction-local setting,
-- statly_assignment_continuity.c<md5 of the case id>, and records the case, generation, current_user
-- and head it was proved for. Cases never share a setting: a fact batch interleaves hundreds of
-- short player and match cases with the long club cases, and a shared slot would keep evicting the
-- club verdicts.

DO $migration$
BEGIN
  IF to_regprocedure('outcome_provider_assignment_continuity_current_uncached(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'outcome_provider_assignment_continuity_current_uncached already exists before 0290';
  END IF;
  -- The per-origin function exactly as migration 0128 created it.
  IF (SELECT md5(prosrc) FROM pg_proc
       WHERE oid=to_regprocedure('outcome_provider_assignment_continuity_current(text)'))
     IS DISTINCT FROM '8a4236e38d08cb21323080035578971a' THEN
    RAISE EXCEPTION 'Expected the 0128 per-origin assignment continuity function before 0290';
  END IF;
END $migration$;

ALTER FUNCTION outcome_provider_assignment_continuity_current(TEXT)
  RENAME TO outcome_provider_assignment_continuity_current_uncached;

COMMENT ON FUNCTION outcome_provider_assignment_continuity_current_uncached(TEXT) IS
  'The per-origin assignment continuity walk of migration 0128, without the 0290 transaction memo.';

CREATE FUNCTION outcome_provider_assignment_continuity_current(origin_decision_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  origin RECORD; observed_head RECORD; current_head RECORD; link RECORD; review_subject TEXT;
  generation TEXT; memo_name TEXT; memo TEXT[];
  expected_revision INTEGER; continuous_from INTEGER; previous_supersedes TEXT;
  head_target TEXT; head_entity_kind TEXT; head_identity_id TEXT;
BEGIN
  SELECT resolutions.*,count(*) OVER () AS matches INTO origin FROM (
    SELECT assignment_case_id,assignment_entity_kind,assignment_identity_id,assignment_revision,decision_id,player_id AS target_id FROM outcome_provider_player_resolution
    UNION ALL SELECT assignment_case_id,assignment_entity_kind,assignment_identity_id,assignment_revision,decision_id,club_id FROM outcome_provider_club_resolution
    UNION ALL SELECT assignment_case_id,assignment_entity_kind,assignment_identity_id,assignment_revision,decision_id,match_id FROM outcome_provider_match_resolution
  ) resolutions WHERE decision_id=origin_decision_id;
  IF FOUND AND (origin.matches>1 OR (origin.assignment_case_id IS NOT NULL
      AND origin.target_id IS NOT NULL AND origin.assignment_revision IS NULL)) THEN
    RETURN outcome_provider_assignment_continuity_current_uncached(origin_decision_id);
  END IF;
  IF NOT FOUND OR origin.assignment_case_id IS NULL OR origin.target_id IS NULL THEN RETURN FALSE; END IF;
  SELECT * INTO observed_head FROM outcome_provider_identity_assignment_head
    WHERE assignment_case_id=origin.assignment_case_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  generation:=COALESCE(current_setting('statly_assignment_continuity.generation',true),'');
  memo_name:='statly_assignment_continuity.c'||md5(origin.assignment_case_id);
  memo:=string_to_array(NULLIF(current_setting(memo_name,true),''),E'\x1f');
  -- memo: case, generation, user, head revision, head decision, walked from, continuous from.
  IF memo IS NOT NULL AND memo[1]=origin.assignment_case_id AND memo[2]=generation
    AND memo[3]=current_user AND memo[4]::INTEGER=observed_head.revision
    AND memo[5]=observed_head.decision_id AND observed_head.status='active'
    -- At or above the walked revision the verdict decides; below it, a break inside the walked
    -- span lies inside the origin's suffix too.
    AND (origin.assignment_revision>=memo[6]::INTEGER OR memo[7]::INTEGER>memo[6]::INTEGER) THEN
    RETURN origin.assignment_revision<=observed_head.revision
      AND observed_head.entity_kind IS NOT DISTINCT FROM origin.assignment_entity_kind
      AND observed_head.identity_id IS NOT DISTINCT FROM origin.assignment_identity_id
      AND origin.assignment_revision>=memo[7]::INTEGER;
  END IF;

  -- Writers take review-subject advisory locks before changing the assignment head. Preserve
  -- that order, and refuse a concurrently advanced snapshot rather than acquiring additional
  -- review locks while holding the head's row lock. Callers can already hold other assignment
  -- locks: never wait for a new chain lock.
  FOR review_subject IN SELECT DISTINCT review.subject_type||':'||review.subject_id FROM (
    SELECT assignment_case_id,assignment_revision,decision_id FROM outcome_provider_player_resolution
    UNION ALL SELECT assignment_case_id,assignment_revision,decision_id FROM outcome_provider_club_resolution
    UNION ALL SELECT assignment_case_id,assignment_revision,decision_id FROM outcome_provider_match_resolution
  ) resolutions JOIN outcome_review_decision review USING(decision_id)
    WHERE resolutions.assignment_case_id=origin.assignment_case_id
      AND resolutions.assignment_revision BETWEEN origin.assignment_revision AND observed_head.revision
    ORDER BY 1
  LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended('outcome-review-subject:'||review_subject,0)) THEN RETURN FALSE; END IF;
  END LOOP;
  BEGIN
    SELECT * INTO current_head FROM outcome_provider_identity_assignment_head
      WHERE assignment_case_id=origin.assignment_case_id FOR SHARE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN RETURN FALSE;
  END;
  IF NOT FOUND OR current_head.revision IS DISTINCT FROM observed_head.revision
    OR current_head.decision_id IS DISTINCT FROM observed_head.decision_id THEN RETURN FALSE; END IF;
  IF current_head.status<>'active' OR current_head.revision<origin.assignment_revision
    OR current_head.entity_kind IS DISTINCT FROM origin.assignment_entity_kind
    OR current_head.identity_id IS DISTINCT FROM origin.assignment_identity_id THEN RETURN FALSE; END IF;

  -- Walk from the head down to the origin (migration 0242's walk). continuous_from is the lowest
  -- revision whose suffix to the head satisfies every per-origin link rule.
  continuous_from:=current_head.revision+1; expected_revision:=current_head.revision;
  FOR link IN SELECT resolutions.*,
      EXISTS(SELECT 1 FROM outcome_review_decision WHERE decision_id=resolutions.decision_id AND decision='approved') AS review_approved,
      EXISTS(SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=resolutions.decision_id
        AND NOT EXISTS(SELECT 1 FROM (
          SELECT assignment_case_id,assignment_revision,decision_id FROM outcome_provider_player_resolution
          UNION ALL SELECT assignment_case_id,assignment_revision,decision_id FROM outcome_provider_club_resolution
          UNION ALL SELECT assignment_case_id,assignment_revision,decision_id FROM outcome_provider_match_resolution
        ) confirmation WHERE confirmation.assignment_case_id=origin.assignment_case_id
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
    ) resolutions WHERE resolutions.assignment_case_id=origin.assignment_case_id
        AND resolutions.assignment_revision BETWEEN origin.assignment_revision AND current_head.revision
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
  PERFORM set_config(memo_name,array_to_string(ARRAY[origin.assignment_case_id,generation,current_user::TEXT,
    current_head.revision::TEXT,current_head.decision_id,origin.assignment_revision::TEXT,continuous_from::TEXT],E'\x1f'),true);
  RETURN origin.assignment_revision>=continuous_from;
END $$;

COMMENT ON FUNCTION outcome_provider_assignment_continuity_current(TEXT) IS
  'Per-origin assignment continuity (migration 0128 rules), walked once per assignment case per transaction (0290).';

CREATE FUNCTION outcome_assignment_continuity_memo_invalidate() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  PERFORM set_config('statly_assignment_continuity.generation',
    (COALESCE(NULLIF(current_setting('statly_assignment_continuity.generation',true),''),'0')::BIGINT+1)::TEXT,true);
  IF TG_LEVEL='STATEMENT' OR TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION outcome_assignment_continuity_memo_invalidate() IS
  'Retires every assignment continuity verdict remembered earlier in the transaction (0290).';

DO $migration$
DECLARE
  watched CONSTANT TEXT[] := ARRAY['outcome_review_decision','outcome_provider_player_resolution',
    'outcome_provider_club_resolution','outcome_provider_match_resolution',
    'outcome_provider_identity_assignment_head'];
  trigger_name CONSTANT TEXT := 'zzz_outcome_assignment_continuity_memo';
  watched_table TEXT;
BEGIN
  EXECUTE format('ALTER FUNCTION outcome_provider_assignment_continuity_current(TEXT) SET search_path TO %I,pg_temp',current_schema());
  EXECUTE format('ALTER FUNCTION outcome_assignment_continuity_memo_invalidate() SET search_path TO %I,pg_temp',current_schema());
  FOREACH watched_table IN ARRAY watched LOOP
    -- The invalidation must be the last BEFORE ROW trigger of each table.
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=watched_table::regclass AND NOT tgisinternal
        AND tgname COLLATE "C">=trigger_name COLLATE "C") THEN
      RAISE EXCEPTION 'A trigger on % sorts after % before 0290',watched_table,trigger_name;
    END IF;
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW
      EXECUTE FUNCTION outcome_assignment_continuity_memo_invalidate()',trigger_name,watched_table);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT
      EXECUTE FUNCTION outcome_assignment_continuity_memo_invalidate()',trigger_name||'_truncate',watched_table);
    -- Writes under session_replication_role=replica retire remembered verdicts too.
    EXECUTE format('ALTER TABLE %I ENABLE ALWAYS TRIGGER %I',watched_table,trigger_name);
    EXECUTE format('ALTER TABLE %I ENABLE ALWAYS TRIGGER %I',watched_table,trigger_name||'_truncate');
  END LOOP;
END $migration$;
