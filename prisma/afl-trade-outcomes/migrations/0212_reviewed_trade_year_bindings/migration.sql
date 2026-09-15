-- Legacy trades retain NULL dates. Their immutable promoted year may be bound in a
-- reviewed departure/spell record as a full-year uncertainty interval, never an exact day.
CREATE FUNCTION outcome_acquisition_trade_year_binding_exact(binding JSONB)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM outcome_event_version event
  JOIN outcome_event root USING(event_id)
  JOIN outcome_external_canonical_promotion_record member
    ON member.canonical_record_id=event.event_version_id
  JOIN outcome_external_canonical_promotion promotion USING(promotion_id)
  WHERE event.event_version_id=binding->>'eventVersionId'
    AND promotion.promotion_id=binding->>'promotionId'
    AND promotion.status='finalized' AND member.record_kind='transaction'
    AND member.source_import_row_id=event.source_import_row_id
    AND event.kind='trade' AND event.event_date IS NULL AND event.date_precision IS NULL
    AND member.record_json->>'transactionType'='trade'
    AND member.record_json->'occurredOn'='null'::jsonb
    AND member.record_json->'seasonYear'=to_jsonb(root.season_year)
    AND binding->'eventDate'='null'::jsonb
    AND binding->'datePrecision'=jsonb_build_object('precision','window','eventDate',NULL,
      'earliestDate',make_date(root.season_year,1,1)::TEXT,
      'latestDate',make_date(root.season_year,12,31)::TEXT)
 )
$$;

-- Replace only the chronology predicate; promotion review, identity, ownership,
-- evidence custody, ancestry and currentness checks remain in the same function.
DO $migration$
DECLARE definition TEXT;
 old_fragment TEXT := $old$(event.event_date IS NOT DISTINCT FROM (binding->>'eventDate')::DATE
    AND event.date_precision IS NOT DISTINCT FROM binding->'datePrecision'
    AND outcome_acquisition_binding_bounds(binding) IS NOT NULL
    AND outcome_event_evidenced_date_bounds(event.event_version_id)=outcome_acquisition_binding_bounds(binding))$old$;
BEGIN
 definition:=pg_get_functiondef('outcome_acquisition_promoted_event_current(jsonb,text,text,text,text,boolean,timestamp with time zone,timestamp with time zone)'::regprocedure);
 IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1
 THEN RAISE EXCEPTION 'Expected exact acquisition chronology predecessor'; END IF;
 EXECUTE replace(definition,old_fragment,'('||old_fragment||' OR outcome_acquisition_trade_year_binding_exact(binding))');
END $migration$;
