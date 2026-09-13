-- Store explicit window precision without assigning an exact event day.
ALTER TABLE outcome_event_version ADD COLUMN date_precision JSONB;
ALTER TABLE outcome_event_version DROP CONSTRAINT outcome_event_date_precision_check;
ALTER TABLE outcome_event_version ADD CONSTRAINT outcome_event_date_precision_check CHECK (
 (date_precision IS NULL AND (event_date IS NOT NULL OR kind='trade'))
 OR (event_date IS NULL AND date_precision IS NOT NULL
   AND kind IN ('national_draft','preseason_draft','rookie_draft','midseason_draft','supplemental_selection')
   AND outcome_session_precision_bounds(jsonb_build_object('eventDate',NULL,'datePrecision',date_precision,
     'draftYear',substring(date_precision->>'earliestDate' FROM 1 FOR 4)::INTEGER),TRUE) IS NOT NULL)
);

-- V7 must match a source-authenticated reviewed projection exactly, including its bounds.
DO $migration$
DECLARE definition TEXT;
BEGIN
 definition:=pg_get_functiondef('outcome_external_draft_sessions_exact(text,jsonb)'::regprocedure);
 IF position('afl-trade-external-canonical-promotion-proposal/v6' IN definition)=0 THEN RAISE EXCEPTION 'Expected v6 session validator'; END IF;
 ALTER FUNCTION outcome_external_draft_sessions_exact(TEXT,JSONB) RENAME TO outcome_external_draft_sessions_exact_before_v7;
 definition:=replace(definition,'outcome_external_draft_sessions_exact_before_v6(', 'outcome_external_draft_sessions_exact_before_v7(');
 definition:=replace(definition,'afl-trade-external-canonical-promotion-proposal/v6','afl-trade-external-canonical-promotion-proposal/v7');
 definition:=replace(definition,$old$p->>'schemaVersion'='afl-trade-combined-draft-session-projection/v1'$old$,
  $new$p->>'schemaVersion' IN ('afl-trade-combined-draft-session-projection/v1','afl-trade-combined-draft-session-projection/v2')$new$);
 EXECUTE definition;
END $migration$;

DO $migration$
DECLARE signature TEXT; definition TEXT;
 old_fragment TEXT:=$old$'afl-trade-external-canonical-promotion-proposal/v6')$old$;
 new_fragment CONSTANT TEXT:=$new$'afl-trade-external-canonical-promotion-proposal/v6','afl-trade-external-canonical-promotion-proposal/v7')$new$;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'validate_outcome_external_canonical_promotion_insert()',
  'validate_outcome_external_promotion_review_insert()',
  'require_outcome_external_draft_session_finalization()',
  'outcome_acquisition_registration_event_current(jsonb,text,text,text,text,boolean,timestamptz,timestamptz)'
 ] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
  THEN RAISE EXCEPTION 'Expected exact v7 predecessor in %',signature; END IF;
  EXECUTE replace(definition,old_fragment,new_fragment);
 END LOOP;
 definition:=pg_get_functiondef('require_outcome_external_draft_session_finalization()'::regprocedure);
 old_fragment:=$old$event.event_date=(session->>'eventDate')::DATE$old$;
 IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Expected event date finalization comparison'; END IF;
 EXECUTE replace(definition,old_fragment,$new$event.event_date IS NOT DISTINCT FROM (session->>'eventDate')::DATE
     AND event.date_precision IS NOT DISTINCT FROM session->'datePrecision'$new$);
END $migration$;
