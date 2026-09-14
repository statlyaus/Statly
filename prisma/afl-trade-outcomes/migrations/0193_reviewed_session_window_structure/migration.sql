-- Structural precision only: source authentication and canonical admission remain separate gates.
CREATE FUNCTION outcome_session_precision_bounds(session JSONB, allow_window BOOLEAN)
RETURNS DATERANGE LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE precision JSONB:=session->'datePrecision'; first_day DATE; last_day DATE;
BEGIN
 IF jsonb_typeof(session) IS DISTINCT FROM 'object' OR NOT(session ? 'eventDate')
 OR jsonb_typeof(session->'draftYear') IS DISTINCT FROM 'number' THEN RETURN NULL; END IF;
 IF session->'eventDate'='null'::jsonb THEN
  IF allow_window IS DISTINCT FROM TRUE OR jsonb_typeof(precision) IS DISTINCT FROM 'object'
  OR NOT(precision ?& ARRAY['precision','eventDate','earliestDate','latestDate'])
  OR precision-ARRAY['precision','eventDate','earliestDate','latestDate']<>'{}'::jsonb
  OR precision->>'precision' IS DISTINCT FROM 'window'
  OR precision->'eventDate' IS DISTINCT FROM 'null'::jsonb
  OR jsonb_typeof(precision->'earliestDate') IS DISTINCT FROM 'string'
  OR jsonb_typeof(precision->'latestDate') IS DISTINCT FROM 'string'
  OR precision->>'earliestDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  OR precision->>'latestDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  THEN RETURN NULL; END IF;
  first_day:=(precision->>'earliestDate')::DATE;
  last_day:=(precision->>'latestDate')::DATE;
  IF first_day>=last_day THEN RETURN NULL; END IF;
 ELSE
  IF session ? 'datePrecision' OR jsonb_typeof(session->'eventDate') IS DISTINCT FROM 'string'
  OR session->>'eventDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN NULL; END IF;
  first_day:=(session->>'eventDate')::DATE; last_day:=first_day;
 END IF;
 IF EXTRACT(YEAR FROM first_day) IS DISTINCT FROM (session->>'draftYear')::INTEGER
 OR EXTRACT(YEAR FROM last_day) IS DISTINCT FROM (session->>'draftYear')::INTEGER
 THEN RETURN NULL; END IF;
 RETURN daterange(first_day,last_day,'[]');
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN RETURN NULL;
END $$;

-- Extend the current successor validator in place; retain all ancestry/membership conservation.
DO $migration$
DECLARE definition TEXT; old_fragment TEXT; new_fragment TEXT;
BEGIN
 definition:=pg_get_functiondef('outcome_reviewed_session_transition_exact(jsonb,jsonb)'::regprocedure);
 old_fragment:=$old$'afl-trade-combined-draft-session-projection/v1','afl-trade-reported-draft-session-projection/v1'$old$;
 new_fragment:=old_fragment||$new$,'afl-trade-combined-draft-session-projection/v2'$new$;
 IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Missing projection version predecessor'; END IF;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old$session-ARRAY['draftYear','draftType','officialName','sessionOrdinal','eventDate','selectionIds','evidenceIds']$old$;
 new_fragment:=$new$session-ARRAY['draftYear','draftType','officialName','sessionOrdinal','eventDate','selectionIds','evidenceIds','datePrecision']$new$;
 IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Missing session field predecessor'; END IF;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old$OR EXTRACT(YEAR FROM (session->>'eventDate')::DATE) IS DISTINCT FROM (session->>'draftYear')::INTEGER
   OR (session->>'eventDate')::DATE<prior_date$old$;
 new_fragment:=$new$OR outcome_session_precision_bounds(session,projection->>'schemaVersion'='afl-trade-combined-draft-session-projection/v2') IS NULL
   OR (CASE WHEN projection->>'schemaVersion'='afl-trade-combined-draft-session-projection/v2'
    THEN lower(outcome_session_precision_bounds(session,TRUE))<=prior_date
    ELSE (session->>'eventDate')::DATE<prior_date END)$new$;
 IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Missing exact date predecessor'; END IF;
 definition:=replace(definition,old_fragment,new_fragment);
 old_fragment:=$old$prior_date:=(session->>'eventDate')::DATE;$old$;
 new_fragment:=$new$prior_date:=upper(outcome_session_precision_bounds(session,projection->>'schemaVersion'='afl-trade-combined-draft-session-projection/v2'))-1;$new$;
 IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'Missing chronology predecessor'; END IF;
 EXECUTE replace(definition,old_fragment,new_fragment);
END $migration$;
