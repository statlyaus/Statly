-- Preserve exact-day and completed trade-year behavior; release a window only after its latest day.
DO $migration$
DECLARE definition TEXT;
  predecessor CONSTANT TEXT := $old$OR (target_effective_time IS NULL AND (
       target_kind IS DISTINCT FROM 'trade'::"OutcomeEventKind"
       OR target_season_year IS NULL
       OR make_date(target_season_year+1,1,1)::timestamp AT TIME ZONE 'UTC' > cutoff))$old$;
BEGIN
  definition := pg_get_functiondef('validate_outcome_release_event_version_membership()'::regprocedure);
  IF (length(definition)-length(replace(definition,predecessor,'')))/length(predecessor) <> 1 THEN
    RAISE EXCEPTION 'Expected exact partial-date release membership predecessor';
  END IF;
  EXECUTE replace(definition,predecessor,$new$OR (target_effective_time IS NULL AND NOT (
       (target_kind='trade'::"OutcomeEventKind" AND target_season_year IS NOT NULL
        AND make_date(target_season_year+1,1,1)::timestamp AT TIME ZONE 'UTC' <= cutoff)
       OR (target_kind IN ('national_draft','preseason_draft','rookie_draft','midseason_draft','supplemental_selection')
         AND EXISTS (
           SELECT 1 FROM outcome_event_version window_event
           WHERE window_event.event_version_id=NEW.event_version_id
             AND window_event.date_precision IS NOT NULL
             AND outcome_session_precision_bounds(jsonb_build_object(
               'eventDate',NULL,'datePrecision',window_event.date_precision,
               'draftYear',target_season_year),TRUE) IS NOT NULL
             AND ((window_event.date_precision->>'latestDate')::DATE+1)::TIMESTAMP AT TIME ZONE 'UTC' <= cutoff
         ))
     ))$new$);
END $migration$;
