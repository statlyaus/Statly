-- A trade the source does not date may carry its season's reviewed trade-period window as explicit
-- precision (statlyaus/Statly#869). The window is the same device draft sessions use (migration
-- 0195): `event_date` stays NULL, `date_precision` holds the window, and no day is ever invented.
-- An arrival-only (v4) spell may then cite the windowed trade event and starts at the window's
-- earliest day. Exact-day events, draftee arrivals and year-only trades keep their meaning.

-- 1. A trade event may carry a window, under the same bounds check as a draft session.
ALTER TABLE outcome_event_version DROP CONSTRAINT outcome_event_date_precision_check;
ALTER TABLE outcome_event_version ADD CONSTRAINT outcome_event_date_precision_check CHECK (
 (date_precision IS NULL AND (event_date IS NOT NULL OR kind='trade'))
 OR (event_date IS NULL AND date_precision IS NOT NULL
   AND kind IN ('national_draft','preseason_draft','rookie_draft','midseason_draft','supplemental_selection','trade')
   AND outcome_session_precision_bounds(jsonb_build_object('eventDate',NULL,'datePrecision',date_precision,
     'draftYear',substring(date_precision->>'earliestDate' FROM 1 FOR 4)::INTEGER),TRUE) IS NOT NULL)
);

-- 2. A windowed trade event proves its bounds through its finalized promotion: the transaction
--    member and the approved proposal's coverage both carry exactly this window and no day.
DO $migration$
DECLARE definition TEXT;
 old_fragment CONSTANT TEXT := $old$ IF event.date_precision IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM outcome_external_canonical_promotion_record member
  JOIN outcome_external_canonical_promotion promotion USING(promotion_id)
  WHERE member.canonical_record_id=target_event_version AND member.record_kind='draft_event'$old$;
BEGIN
 definition:=pg_get_functiondef('outcome_event_evidenced_date_bounds(text)'::regprocedure);
 IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
 THEN RAISE EXCEPTION 'Expected the exact draft-session window proof in outcome_event_evidenced_date_bounds'; END IF;
 EXECUTE replace(definition,old_fragment,$new$ IF event.date_precision IS NOT NULL AND event.kind='trade' THEN
  IF NOT EXISTS (
   SELECT 1 FROM outcome_external_canonical_promotion_record member
   JOIN outcome_external_canonical_promotion promotion USING(promotion_id)
   WHERE member.canonical_record_id=target_event_version AND member.record_kind='transaction'
    AND member.source_import_row_id=event.source_import_row_id AND promotion.status='finalized'
    AND member.record_json->>'transactionType'='trade'
    AND member.record_json->'occurredOn'='null'::jsonb
    AND member.record_json->'datePrecision'=event.date_precision
    AND member.record_json->'seasonYear'=to_jsonb(event.season_year)
    AND EXISTS (
     SELECT 1 FROM jsonb_array_elements(promotion.proposal_json#>'{content,transactionDateCoverage}') item
     WHERE item->>'transactionId'=member.source_record_id
      AND item->'occurredOn'='null'::jsonb
      AND item->'datePrecision'=event.date_precision
      AND item->'seasonYear'=to_jsonb(event.season_year))
  ) THEN RETURN NULL; END IF;
  RETURN bounds;
 END IF;
 IF event.date_precision IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM outcome_external_canonical_promotion_record member
  JOIN outcome_external_canonical_promotion promotion USING(promotion_id)
  WHERE member.canonical_record_id=target_event_version AND member.record_kind='draft_event'$new$);
END $migration$;

-- 3. Finalization: a promoted trade event carries exactly the reviewed precision of its coverage.
DO $migration$
DECLARE definition TEXT;
 old_fragment CONSTANT TEXT := $old$AND value.event_date IS NOT DISTINCT FROM (coverage->>'occurredOn')::date$old$;
BEGIN
 definition:=pg_get_functiondef('finalize_outcome_external_canonical_promotion()'::regprocedure);
 IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
 THEN RAISE EXCEPTION 'Expected the exact coverage date comparison in finalize_outcome_external_canonical_promotion'; END IF;
 EXECUTE replace(definition,old_fragment,$new$AND value.event_date IS NOT DISTINCT FROM (coverage->>'occurredOn')::date
      AND value.date_precision IS NOT DISTINCT FROM coverage->'datePrecision'$new$);
END $migration$;

-- 4. Promotion and review validation: a coverage window belongs to a null-day transaction, lies
--    inside its season, and does not postdate the promotion or the decision.
DO $migration$
DECLARE definition TEXT;
 old_fragment CONSTANT TEXT := $old$OR proposed.occurred_on > (NEW.promoted_at AT TIME ZONE 'Australia/Melbourne')::date$old$;
BEGIN
 definition:=pg_get_functiondef('validate_outcome_external_canonical_promotion_insert()'::regprocedure);
 IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
 THEN RAISE EXCEPTION 'Expected the exact promotion-day guard in validate_outcome_external_canonical_promotion_insert'; END IF;
 EXECUTE replace(definition,old_fragment,old_fragment||$new$
        OR EXISTS (SELECT 1 FROM jsonb_array_elements((NEW.proposal_json->'content')->'transactionDateCoverage') item
          WHERE item->>'transactionId'=proposed.transaction_id AND item ? 'datePrecision'
            AND (item->'occurredOn' IS DISTINCT FROM 'null'::JSONB
              OR outcome_session_precision_bounds(jsonb_build_object('eventDate',NULL,'datePrecision',item->'datePrecision',
                   'draftYear',(item->>'seasonYear')::INTEGER),TRUE) IS NULL
              OR (item#>>'{datePrecision,latestDate}')::date > (NEW.promoted_at AT TIME ZONE 'Australia/Melbourne')::date))$new$);
END $migration$;

DO $migration$
DECLARE definition TEXT;
 old_fragment CONSTANT TEXT := $old$OR proposed.occurred_on > (NEW.decided_at AT TIME ZONE 'Australia/Melbourne')::date$old$;
BEGIN
 definition:=pg_get_functiondef('validate_outcome_external_promotion_review_insert()'::regprocedure);
 IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
 THEN RAISE EXCEPTION 'Expected the exact decision-day guard in validate_outcome_external_promotion_review_insert'; END IF;
 EXECUTE replace(definition,old_fragment,old_fragment||$new$
         OR EXISTS (SELECT 1 FROM jsonb_array_elements((content)->'transactionDateCoverage') item
           WHERE item->>'transactionId'=proposed.transaction_id AND item ? 'datePrecision'
             AND (item->'occurredOn' IS DISTINCT FROM 'null'::JSONB
               OR outcome_session_precision_bounds(jsonb_build_object('eventDate',NULL,'datePrecision',item->'datePrecision',
                    'draftYear',(item->>'seasonYear')::INTEGER),TRUE) IS NULL
               OR (item#>>'{datePrecision,latestDate}')::date > (NEW.decided_at AT TIME ZONE 'Australia/Melbourne')::date))$new$);
END $migration$;

-- 5. An arrival inside a window starts at the window's earliest day. The promoted-event check it
--    already calls matches window to window (migrations 0197 and 0247), so an exact-day arrival and
--    a windowed arrival are both current only against an event of the same precision.
DO $migration$
DECLARE definition TEXT;
 old_fragment CONSTANT TEXT := $old$AND (c#>>'{entry,eventDate}')::DATE=spell.start_date$old$;
BEGIN
 definition:=pg_get_functiondef('outcome_acquisition_arrival_spell_registration_current(text,timestamptz)'::regprocedure);
 IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
 THEN RAISE EXCEPTION 'Expected the exact arrival start-date predicate in outcome_acquisition_arrival_spell_registration_current'; END IF;
 EXECUTE replace(definition,old_fragment,$new$AND COALESCE((c#>>'{entry,eventDate}')::DATE,(c#>>'{entry,datePrecision,earliestDate}')::DATE)=spell.start_date
    AND (c#>'{entry,eventDate}'<>'null'::JSONB OR outcome_acquisition_binding_bounds(c->'entry') IS NOT NULL)$new$);
END $migration$;
