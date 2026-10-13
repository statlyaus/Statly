-- A reviewed canonical creation must not mint a second person under a name the canonical store
-- already holds (statlyaus/Statly#853). About 92 people were minted twice: once by an external
-- identity review (v2, Draftguru/Footyinfo) and again by a normalization-backed review (v1, AFL
-- Tables), because neither owner looked for an approved player with the same name before inserting.
-- Player identity repairs are explicit reviewed operations, so this refuses rather than merges.
--
-- Both owners now refuse to insert a player while an approved outcome_player has the same
-- normalised display name (case, whitespace and punctuation ignored), unless both birth dates are
-- known and differ, or the creating review lists that player's id in `distinctFromPlayerIds`. The
-- list is optional, player-only (v2: `create` only), a strictly ordered unique list of other ids,
-- and every listed id must be an approved player with the same normalised name. A replay or reuse
-- of an existing record inserts nothing and is unchanged, so existing duplicates are untouched.
--
-- The check sits in the SQL owners, not only in TypeScript, because they are the only writers of
-- outcome_player and can be called directly. One advisory lock per normalised name serialises two
-- concurrent same-name creations under READ COMMITTED; it is the last lock either owner takes.

CREATE FUNCTION outcome_canonical_player_name_key(display_name TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT regexp_replace(lower(display_name),'[^[:alnum:]]+','','g') $$;

CREATE FUNCTION outcome_require_canonical_player_name_reviewed(
  candidate_id TEXT, candidate_name TEXT, candidate_birth_date DATE, distinct_from JSONB
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE name_key TEXT:=outcome_canonical_player_name_key(candidate_name);
  listed TEXT[]:=ARRAY[]::TEXT[]; colliding TEXT[]; unreviewed TEXT[]; stale TEXT[];
BEGIN
  IF candidate_id IS NULL OR name_key IS NULL THEN
    RAISE EXCEPTION 'Canonical player name check requires an id and a display name'; END IF;
  IF distinct_from IS NOT NULL THEN
    IF jsonb_typeof(distinct_from) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Canonical player distinctFromPlayerIds must list 1 to 50 other player ids'; END IF;
    IF jsonb_array_length(distinct_from) NOT BETWEEN 1 AND 50
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(distinct_from) element
        WHERE jsonb_typeof(element)<>'string' OR btrim(element#>>'{}')='' OR element#>>'{}'=candidate_id)
    THEN RAISE EXCEPTION 'Canonical player distinctFromPlayerIds must list 1 to 50 other player ids'; END IF;
    SELECT array_agg(value ORDER BY ordinal) INTO listed
      FROM jsonb_array_elements_text(distinct_from) WITH ORDINALITY AS listing(value,ordinal);
    IF listed IS DISTINCT FROM (SELECT array_agg(value ORDER BY value COLLATE "C")
      FROM (SELECT DISTINCT value FROM unnest(listed) AS ids(value)) unique_ids)
    THEN RAISE EXCEPTION 'Canonical player distinctFromPlayerIds must be unique and in ascending order'; END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('outcome-canonical-player-name:'||name_key,0));
  SELECT coalesce(array_agg(player_id ORDER BY player_id COLLATE "C"),ARRAY[]::TEXT[]) INTO colliding
    FROM outcome_player WHERE status='approved' AND player_id<>candidate_id
      AND outcome_canonical_player_name_key(display_name)=name_key
      AND NOT (birth_date IS NOT NULL AND candidate_birth_date IS NOT NULL AND birth_date<>candidate_birth_date);
  SELECT array_agg(id ORDER BY id COLLATE "C") INTO unreviewed FROM unnest(colliding) AS ids(id) WHERE id<>ALL(listed);
  IF unreviewed IS NOT NULL THEN
    RAISE EXCEPTION 'Canonical player % shares a normalised display name with approved player(s) % not reviewed as distinct; reuse that player or list each id in distinctFromPlayerIds',
      candidate_id,array_to_string(unreviewed,', ');
  END IF;
  SELECT array_agg(id ORDER BY id COLLATE "C") INTO stale FROM unnest(listed) AS ids(id)
    WHERE NOT EXISTS (SELECT 1 FROM outcome_player player WHERE player.player_id=id AND player.status='approved'
      AND outcome_canonical_player_name_key(player.display_name)=name_key);
  IF stale IS NOT NULL THEN
    RAISE EXCEPTION 'Canonical player % lists distinctFromPlayerIds % that are not approved players with the same normalised display name',
      candidate_id,array_to_string(stale,', ');
  END IF;
END $$;
DO $path$ BEGIN EXECUTE format('ALTER FUNCTION outcome_require_canonical_player_name_reviewed(TEXT,TEXT,DATE,JSONB) SET search_path TO %I,pg_catalog,pg_temp',current_schema()); END $path$;
REVOKE ALL ON FUNCTION outcome_require_canonical_player_name_reviewed(TEXT,TEXT,DATE,JSONB) FROM PUBLIC;

-- Both owner bodies were assembled by fragment replacement (0126, 0128, 0145, 0232), so the deployed
-- definition is the only accurate source. Each fragment must occur exactly once.
CREATE FUNCTION outcome_0275_replace_fragment(signature TEXT,old_fragment TEXT,new_fragment TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$ DECLARE definition TEXT; occurrences INTEGER; BEGIN
  SELECT pg_get_functiondef(to_regprocedure(signature)) INTO definition;
  occurrences:=(length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment);
  IF definition IS NULL OR occurrences<>1 THEN
    RAISE EXCEPTION 'Expected exactly one fragment in %, found %',signature,occurrences; END IF;
  EXECUTE replace(definition,old_fragment,new_fragment);
END $$;

-- v1 (normalization-backed): admit the optional key for players only, then check before inserting.
SELECT outcome_0275_replace_fragment('register_outcome_reviewed_canonical_target(text,text,text,text)',
  $old$OR body IS DISTINCT FROM jsonb_build_object('schemaVersion'$old$,
  $new$OR (body ? 'distinctFromPlayerIds' AND kind IS DISTINCT FROM 'player')
    OR (body-'distinctFromPlayerIds') IS DISTINCT FROM jsonb_build_object('schemaVersion'$new$);
SELECT outcome_0275_replace_fragment('register_outcome_reviewed_canonical_target(text,text,text,text)',
  $old$INSERT INTO outcome_player(player_id,display_name,birth_date,status) VALUES(identifier,record->>'displayName',(record->>'birthDate')::DATE,'approved')$old$,
  $new$PERFORM outcome_require_canonical_player_name_reviewed(identifier,record->>'displayName',(record->>'birthDate')::DATE,body->'distinctFromPlayerIds');
      INSERT INTO outcome_player(player_id,display_name,birth_date,status) VALUES(identifier,record->>'displayName',(record->>'birthDate')::DATE,'approved')$new$);

-- v2 (external identity): admit the optional key for player creation only, then check before inserting.
SELECT outcome_0275_replace_fragment('register_outcome_external_reviewed_canonical_target(text,text,text,text)',
  $old$'supportingEvidence','rationale','decidedAt']) IS DISTINCT FROM '{}'::JSONB$old$,
  $new$'supportingEvidence','rationale','decidedAt','distinctFromPlayerIds']) IS DISTINCT FROM '{}'::JSONB
 OR (body ? 'distinctFromPlayerIds' AND (kind IS DISTINCT FROM 'player' OR body->>'action' IS DISTINCT FROM 'create'))$new$);
SELECT outcome_0275_replace_fragment('register_outcome_external_reviewed_canonical_target(text,text,text,text)',
  $old$INSERT INTO outcome_player(player_id,display_name,birth_date,status) VALUES(identifier,record->>'displayName',NULL,'approved')$old$,
  $new$PERFORM outcome_require_canonical_player_name_reviewed(identifier,record->>'displayName',NULL,body->'distinctFromPlayerIds');
   INSERT INTO outcome_player(player_id,display_name,birth_date,status) VALUES(identifier,record->>'displayName',NULL,'approved')$new$);

DROP FUNCTION outcome_0275_replace_fragment(TEXT,TEXT,TEXT);
