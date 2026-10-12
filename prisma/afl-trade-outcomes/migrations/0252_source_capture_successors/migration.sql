-- Reviewed successors for lost source captures, cited only by arrival-only (v4) spell entries.
--
-- A promoted draft event binds its entry evidence to the exact source captures behind it, and a
-- reviewed spell must cite exactly that capture set. For 19 of the 22 captures behind the 247 v1
-- spells the bytes are lost, and a re-fetched page is never byte-identical, so no spell could be
-- re-made. A successor records, for one lost capture, either:
--   recaptured: a fresh approved capture of the same provider, dataset, competition, season and
--     source URL whose bytes are located, which an arrival entry may cite in place of the lost one;
--   omitted: no successor; an arrival entry may leave the lost capture out (owner decision
--     2026-10-05 on statlyaus/Statly#742 for two Official AFL articles edited since review).
-- Each successor carries its own review decision (subject type source_capture_successor) and is
-- current only while that review is. One successor per lost capture, append-only.
--
-- Only arrival-only (v4) entries read successors. outcome_acquisition_arrival_event_current is a
-- copy of the deployed promoted-event function with two asserted edits: a cited artifact counts as
-- the lost capture it succeeds, and an omitted capture need not be cited. v1, v2 and v3 entries keep
-- calling the unchanged function, so their meaning cannot change.

CREATE TABLE outcome_source_capture_successor (
  successor_id TEXT PRIMARY KEY,
  lost_artifact_id TEXT NOT NULL UNIQUE
    REFERENCES outcome_artifact_custody(artifact_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('recaptured','omitted')),
  successor_capture_id TEXT UNIQUE REFERENCES outcome_source_capture(capture_id) ON DELETE RESTRICT,
  successor_artifact_id TEXT UNIQUE
    REFERENCES outcome_artifact_custody(artifact_id) ON DELETE RESTRICT,
  record_json JSONB NOT NULL,
  approval_decision_id TEXT NOT NULL
    REFERENCES outcome_review_decision(decision_id) ON DELETE RESTRICT,
  recorded_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT outcome_source_capture_successor_kind_shape CHECK (
    (kind='recaptured' AND successor_capture_id IS NOT NULL AND successor_artifact_id IS NOT NULL
      AND successor_artifact_id<>lost_artifact_id)
    OR (kind='omitted' AND successor_capture_id IS NULL AND successor_artifact_id IS NULL)
  )
);

CREATE FUNCTION outcome_source_capture_successor_current(target_id TEXT, cutoff TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM outcome_source_capture_successor successor
  WHERE successor.successor_id=target_id AND successor.recorded_at<=cutoff
    AND outcome_acquisition_registration_review_current(successor.approval_decision_id,
      'source_capture_successor',successor.successor_id,successor.record_json,
      (successor.record_json->>'createdAt')::TIMESTAMPTZ,successor.recorded_at,cutoff)
 )
$$;

CREATE FUNCTION require_outcome_source_capture_successor() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE lost outcome_source_capture%ROWTYPE; fresh outcome_source_capture%ROWTYPE;
BEGIN
  IF NEW.record_json IS DISTINCT FROM jsonb_build_object(
       'schemaVersion','afl-trade-source-capture-successor/v1','kind',NEW.kind,
       'lostArtifactId',NEW.lost_artifact_id,'successorCaptureId',NEW.successor_capture_id,
       'successorArtifactId',NEW.successor_artifact_id,'createdAt',NEW.record_json->'createdAt')
     OR NEW.successor_id IS DISTINCT FROM 'source-capture-successor:'||encode(sha256(convert_to(
       outcome_afl_trade_canonical_json(NEW.record_json),'UTF8')),'hex')
     OR (NEW.record_json->>'createdAt')::TIMESTAMPTZ>NEW.recorded_at THEN
    RAISE EXCEPTION 'Source capture successor record must be exact and content-addressed';
  END IF;
  -- source_artifact_id is not unique: compare against the one approved capture, never an arbitrary row.
  IF (SELECT count(*) FROM outcome_source_capture WHERE source_artifact_id=NEW.lost_artifact_id
      AND status='approved')<>1 THEN
    RAISE EXCEPTION 'A successor needs exactly one approved source capture of the lost artifact';
  END IF;
  SELECT * INTO lost FROM outcome_source_capture WHERE source_artifact_id=NEW.lost_artifact_id
    AND status='approved';
  IF NOT FOUND OR EXISTS (SELECT 1 FROM outcome_artifact_custody_location
      WHERE artifact_id=NEW.lost_artifact_id) THEN
    RAISE EXCEPTION 'A successor may only replace an approved source capture whose bytes are lost';
  END IF;
  IF NEW.kind='recaptured' THEN
    SELECT * INTO fresh FROM outcome_source_capture WHERE capture_id=NEW.successor_capture_id;
    IF NOT FOUND OR fresh.status<>'approved'
       OR fresh.source_artifact_id IS DISTINCT FROM NEW.successor_artifact_id
       OR fresh.provider IS DISTINCT FROM lost.provider OR fresh.dataset IS DISTINCT FROM lost.dataset
       OR fresh.environment IS DISTINCT FROM lost.environment
       OR fresh.competition IS DISTINCT FROM lost.competition
       OR fresh.anchor_season_year IS DISTINCT FROM lost.anchor_season_year
       OR fresh.manifest_json->>'sourceUrl' IS DISTINCT FROM lost.manifest_json->>'sourceUrl'
       OR fresh.captured_at<=lost.captured_at
       OR NOT EXISTS (SELECT 1 FROM outcome_artifact_custody_location
         WHERE artifact_id=NEW.successor_artifact_id) THEN
      RAISE EXCEPTION 'A recaptured successor must be a later approved capture of the same source with located bytes';
    END IF;
  END IF;
  IF NOT outcome_acquisition_registration_review_current(NEW.approval_decision_id,
       'source_capture_successor',NEW.successor_id,NEW.record_json,
       (NEW.record_json->>'createdAt')::TIMESTAMPTZ,NEW.recorded_at,NEW.recorded_at) THEN
    RAISE EXCEPTION 'Source capture successor requires an exact current approval';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER outcome_source_capture_successor_guard
  BEFORE INSERT ON outcome_source_capture_successor FOR EACH ROW
  EXECUTE FUNCTION require_outcome_source_capture_successor();
CREATE TRIGGER outcome_source_capture_successor_no_write
  BEFORE UPDATE OR DELETE ON outcome_source_capture_successor FOR EACH ROW
  EXECUTE FUNCTION reject_outcome_authority_mutation();

-- The lost capture a cited artifact stands for: itself, or the lost capture of a current recaptured
-- successor recorded no later than the spell.
CREATE FUNCTION outcome_source_capture_cited_original(artifact TEXT, proposal_at TIMESTAMPTZ,
  cutoff TIMESTAMPTZ) RETURNS TEXT LANGUAGE sql STABLE AS $$
 SELECT COALESCE((SELECT successor.lost_artifact_id FROM outcome_source_capture_successor successor
   WHERE successor.successor_artifact_id=artifact AND successor.kind='recaptured'
     AND successor.recorded_at<=proposal_at
     AND outcome_source_capture_successor_current(successor.successor_id,cutoff)),artifact)
$$;

CREATE FUNCTION outcome_source_capture_omitted(artifact TEXT, proposal_at TIMESTAMPTZ,
  cutoff TIMESTAMPTZ) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT EXISTS (SELECT 1 FROM outcome_source_capture_successor successor
   WHERE successor.lost_artifact_id=artifact AND successor.kind='omitted'
     AND successor.recorded_at<=proposal_at
     AND outcome_source_capture_successor_current(successor.successor_id,cutoff))
$$;

DO $migration$
DECLARE definition TEXT; cited TEXT; covered TEXT; header TEXT;
BEGIN
 definition:=pg_get_functiondef('outcome_acquisition_promoted_event_current(jsonb,text,text,text,text,boolean,timestamp with time zone,timestamp with time zone)'::regprocedure);
 header:='outcome_acquisition_promoted_event_current(binding jsonb';
 cited:=$old$capture.source_artifact_id=ref->>'artifactId'$old$;
 covered:=$old$          WHERE ref->>'artifactId'=capture.source_artifact_id))$old$;
 IF array_length(string_to_array(definition,header),1)<>2
    OR array_length(string_to_array(definition,cited),1)<>2
    OR array_length(string_to_array(definition,covered),1)<>2 THEN
   RAISE EXCEPTION 'Expected exactly one header, cited-capture and covered-capture fragment in the promoted event function';
 END IF;
 definition:=replace(definition,header,'outcome_acquisition_arrival_event_current(binding jsonb');
 -- A cited artifact must stand for a capture that is not omitted, so an entry can never cite only an
 -- omitted page: with non-empty evidence it always cites at least one capture or successor.
 definition:=replace(definition,cited,
   $new$capture.source_artifact_id=outcome_source_capture_cited_original(ref->>'artifactId',proposal_at,cutoff)
     AND NOT outcome_source_capture_omitted(capture.source_artifact_id,proposal_at,cutoff)$new$);
 definition:=replace(definition,covered,$new$          WHERE outcome_source_capture_cited_original(ref->>'artifactId',proposal_at,cutoff)=capture.source_artifact_id)
          AND NOT outcome_source_capture_omitted(capture.source_artifact_id,proposal_at,cutoff))$new$);
 EXECUTE definition;

 definition:=pg_get_functiondef('outcome_acquisition_arrival_spell_registration_current(text,timestamp with time zone)'::regprocedure);
 cited:=$old$AND outcome_acquisition_registration_event_current(c->'entry',spell.player_id,spell.club_id,$old$;
 IF array_length(string_to_array(definition,cited),1)<>2 THEN
   RAISE EXCEPTION 'Expected exactly one entry check in the arrival spell currency function';
 END IF;
 EXECUTE replace(definition,cited,
   $new$AND outcome_acquisition_arrival_event_current(c->'entry',spell.player_id,spell.club_id,$new$);
END $migration$;
